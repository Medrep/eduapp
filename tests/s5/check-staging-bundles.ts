import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { chromium } from "@playwright/test";
import { buildViewerWrapper } from "../../scripts/shell-config.ts";
import { stagingBackend, stagingOrigins, vercelStagingConfig } from "../../scripts/build-vercel-staging.ts";
import { workerPathForWrapper, wrapperHeaders, type ViewerRole } from "../../packages/contracts/src/viewer-wrapper.ts";

const root = process.argv[2];
assert.ok(root, "Supply the local staging build-output root.");
const roles: ViewerRole[] = ["child", "admin"];
const output = (role: ViewerRole) => join(root, role, ".vercel", "output");
const configs = Object.fromEntries(roles.map(role => {
  const config = vercelStagingConfig(role);
  assert.deepEqual(JSON.parse(readFileSync(join(output(role), "config.json"), "utf8")), config);
  return [role, config];
})) as Record<ViewerRole, ReturnType<typeof vercelStagingConfig>>;

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png",
};

function route(role: ViewerRole, pathname: string, method: string) {
  const files = resolve(output(role), "static");
  const headers: Record<string, string> = {};
  let path = pathname;
  for (const rule of configs[role].routes) {
    if ("handle" in rule) {
      const diskPath = resolve(files, "." + path);
      if (["GET", "HEAD"].includes(method) && diskPath.startsWith(files + sep) &&
          existsSync(diskPath) && statSync(diskPath).isFile()) {
        headers["Content-Type"] ??= mime[extname(diskPath)] ?? "application/octet-stream";
        return { status: 200, headers, body: method === "GET" ? readFileSync(diskPath) : undefined };
      }
    } else if ("src" in rule && rule.src && new RegExp(rule.src).test(path) &&
      (!rule.methods || rule.methods.includes(method))) {
      Object.assign(headers, rule.headers);
      if (rule.dest) path = rule.dest;
      if (rule.status) return { status: rule.status, headers, body: undefined };
    }
  }
  throw new Error("Unexpected unmatched local test route");
}

function previewServer(key: Buffer, cert: Buffer): Server {
  return createServer({ key, cert }, (request, response) => {
    const role = roles.find(candidate => new URL(stagingOrigins[candidate]).host === request.headers.host);
    if (!role) { response.writeHead(404).end(); return; }
    const path = new URL(request.url ?? "/", stagingOrigins[role]).pathname;
    const result = route(role, path, request.method ?? "GET");
    response.writeHead(result.status, result.headers).end(result.body);
  });
}

const temporary = mkdtempSync(join(tmpdir(), "moja-s5-tls-"));
const keyPath = join(temporary, "key.pem");
const certPath = join(temporary, "cert.pem");
let key: Buffer;
let cert: Buffer;
try {
  const hosts = roles.map(role => "DNS:" + new URL(stagingOrigins[role]).hostname).join(",");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", keyPath, "-out", certPath, "-subj", "/CN=Moja Nauka local build test",
    "-addext", "subjectAltName=" + hosts], { stdio: "ignore" });
  key = readFileSync(keyPath);
  cert = readFileSync(certPath);
} finally {
  rmSync(temporary, { recursive: true });
}
const publicKey = new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" });
const pin = createHash("sha256").update(publicKey).digest("base64");
const server = previewServer(key, cert);
await new Promise<void>((accept, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", accept);
});

try {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const mapping = roles.map(role =>
    "MAP " + new URL(stagingOrigins[role]).hostname + " 127.0.0.1:" + address.port).join(",");
  const browser = await chromium.launch({ args: ["--ignore-certificate-errors-spki-list=" + pin,
    "--host-resolver-rules=" + mapping, "--no-proxy-server"] });
  try {
    const uncontrolled = await browser.newContext({ serviceWorkers: "block" });
    try {
      for (const role of roles) {
        const page = await uncontrolled.newPage();
        for (const path of ["/__offline_lesson/sample", "/__preview_lesson/sample", "/__viewer/unknown.html"]) {
          const response = await page.goto(stagingOrigins[role] + path);
          assert.equal(response?.status(), 404);
          assert.equal(response?.fromServiceWorker(), false);
          assert.equal(await response.headerValue("content-security-policy"), "default-src 'none'; frame-ancestors 'none'");
          assert.equal(await response.headerValue("cache-control"), "no-store");
          assert.equal(await response.headerValue("x-content-type-options"), "nosniff");
          assert.doesNotMatch(await response.text(), /id="root"/);
        }
        console.log(JSON.stringify({ role, uncontrolledHostDenials: [404, 404, 404], workerInvolved: false }));
        await page.close();
      }
    } finally {
      await uncontrolled.close();
    }
    const context = await browser.newContext();
    const permittedOrigins = Object.values(stagingOrigins) as string[];
    await context.route("**/*", request => permittedOrigins.includes(new URL(request.request().url()).origin)
      ? request.continue() : request.abort());
    for (const role of roles) {
      const page = await context.newPage();
      const wrapper = buildViewerWrapper(role);
      const origin = stagingOrigins[role];
      const shell = await page.goto(origin);
      assert.equal(shell?.status(), 200);
      const csp = await shell!.headerValue("content-security-policy");
      assert.ok(csp?.includes("connect-src 'self' " + stagingBackend + ";"));
      assert.ok(csp?.includes("frame-src " + origin + wrapper.path + ";"));
      assert.ok(csp?.includes("script-src 'self';"));
      assert.equal(await shell!.headerValue("x-frame-options"), "DENY");
      assert.equal(await shell!.headerValue("strict-transport-security"), "max-age=31536000");
      assert.equal(new URL(page.url()).origin, origin);
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      const responses = await page.evaluate(async ({ worker, wrapperPath }) => {
        const result = async (path: string) => {
          const r = await fetch(path, { cache: "no-store", redirect: "error" });
          return { status: r.status, text: await r.text(), headers: Object.fromEntries(r.headers) };
        };
        const script = document.querySelector<HTMLScriptElement>("script[src]")?.src;
        if (!script) throw new Error("Shell lacks hashed script.");
        const registration = await navigator.serviceWorker.getRegistration();
        return {
          scope: registration?.scope,
          worker: await result(worker),
          wrapper: await result(wrapperPath),
          hashed: await result(script),
          retiredChild: await result("/__offline_lesson/sample"),
          retiredAdmin: await result("/__preview_lesson/sample"),
          wrongWrapper: await result("/__viewer/unknown.html"),
        };
      }, { worker: workerPathForWrapper(wrapper.path), wrapperPath: wrapper.path });
      assert.equal(responses.scope, origin + "/");
      assert.equal(responses.worker.status, 200);
      assert.equal(responses.worker.headers["cache-control"], "no-cache");
      assert.equal(responses.worker.headers["service-worker-allowed"], "/");
      assert.equal(responses.wrapper.status, 200);
      assert.equal(responses.wrapper.text, wrapper.html);
      for (const [name, value] of Object.entries(wrapperHeaders)) {
        assert.equal(responses.wrapper.headers[name.toLowerCase()], value);
      }
      assert.equal(responses.wrapper.headers["cache-control"], "public, max-age=31536000, immutable");
      assert.equal(responses.hashed.headers["cache-control"], "public, max-age=31536000, immutable");
      for (const denied of [responses.retiredChild, responses.retiredAdmin, responses.wrongWrapper]) {
        assert.equal(denied.status, 404);
        assert.doesNotMatch(denied.text, /id="root"/);
      }
      if (role === "child") {
        const manifest = await page.evaluate(async () => (await fetch("/manifest.webmanifest")).json());
        assert.deepEqual([manifest.scope, manifest.start_url, manifest.display], ["/", "/", "standalone"]);
        await context.setOffline(true);
        await page.reload();
        assert.equal(await page.getByRole("heading", { name: "Moja Nauka", exact: true }).count(), 1);
        await context.setOffline(false);
      } else {
        assert.equal(await page.getByRole("button", { name: "Zaloguj", exact: true }).count(), 1);
      }
      console.log(JSON.stringify({ role, browser: browser.version(), exactOrigin: origin, workerScope: responses.scope,
        immutableWrapper: true, immutableBundle: true, shellPolicy: true, retiredRoutes: [404, 404], wrongWrapper: 404,
        stagedApiConfiguration: true, offlineChildShell: role === "child" }));
      await page.close();
    }
    await context.close();
  } finally {
    await browser.close();
  }
} finally {
  await new Promise<void>(accept => server.close(() => accept()));
}
