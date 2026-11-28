import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { wrapperHeaders, type ViewerRole } from "../packages/contracts/src/viewer-wrapper.ts";
import { buildViewerWrapper, shellContentSecurityPolicy } from "./shell-config.ts";

export const stagingBackend = "https://spvzlwyqytytwvvfrwqs.supabase.co";
export const stagingOrigins = {
  child: "https://moja-nauka-child-staging.vercel.app",
  admin: "https://moja-nauka-admin-staging.vercel.app",
} as const;

const repo = fileURLToPath(new URL("../", import.meta.url));
const immutable = "public, max-age=31536000, immutable";
const securityHeaders = {
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Strict-Transport-Security": "max-age=31536000",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
};
const denial = {
  ...securityHeaders,
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
};
const versionedAsset = /^assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8}\.(?:js|css)$/;

export function vercelStagingConfig(role: ViewerRole) {
  const wrapper = buildViewerWrapper(role);
  const wrapperExpression = wrapper.path.replaceAll(".", "\\.");
  return {
    version: 3,
    routes: [
      {
        src: "^/__(?:offline_lesson|preview_lesson)(?:/.*)?$",
        status: 404,
        headers: denial,
      },
      {
        src: `^${wrapperExpression}$`,
        methods: ["GET", "HEAD"],
        headers: { ...securityHeaders, ...wrapperHeaders, "X-Frame-Options": "SAMEORIGIN", "Cache-Control": immutable },
        continue: true,
      },
      {
        src: "^/(?:index\\.html)?$",
        methods: ["GET", "HEAD"],
        headers: {
          ...securityHeaders,
          "Cache-Control": "no-cache",
          "Content-Security-Policy": shellContentSecurityPolicy(stagingOrigins[role], wrapper.path, stagingBackend),
          "X-Frame-Options": "DENY",
        },
        continue: true,
      },
      { src: "^/$", dest: "/index.html", methods: ["GET", "HEAD"] },
      {
        src: "^/sw\\.js$",
        methods: ["GET", "HEAD"],
        headers: {
          ...securityHeaders,
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "no-cache",
          "Service-Worker-Allowed": "/",
        },
        continue: true,
      },
      {
        src: "^/assets/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8}\\.(?:js|css)$",
        methods: ["GET", "HEAD"],
        headers: { ...securityHeaders, "Cache-Control": immutable },
        continue: true,
      },
      {
        src: "^/(?:manifest\\.webmanifest|favicon\\.(?:svg|ico)|icons/bright-pages\\.svg|icons/icon-(?:maskable-)?(?:192|512)\\.png)$",
        methods: ["GET", "HEAD"],
        headers: { ...securityHeaders, "Cache-Control": "no-cache" },
        continue: true,
      },
      { handle: "filesystem" },
      { src: ".*", status: 404, headers: denial },
    ],
  };
}

function emitRole(root: string, role: ViewerRole, publishableKey: string) {
  const output = join(root, role, ".vercel", "output");
  const staticDir = join(output, "static");
  const env = { ...process.env, VITE_SUPABASE_URL: stagingBackend, VITE_SUPABASE_PUBLISHABLE_KEY: "" };
  if (role === "admin") env.VITE_SUPABASE_PUBLISHABLE_KEY = publishableKey;
  execFileSync("pnpm", ["--filter", `@moja-nauka/${role}`, "exec", "vite", "build", "--outDir", staticDir], {
    cwd: repo,
    env,
    stdio: "inherit",
  });

  const wrapper = buildViewerWrapper(role);
  const config = vercelStagingConfig(role);
  const files = readdirSync(staticDir, { recursive: true, withFileTypes: true })
    .filter(entry => !entry.isDirectory())
    .map(entry => join(entry.parentPath.slice(staticDir.length), entry.name).replace(/^\//, ""))
    .sort();
  const expected = [
    "index.html", "sw.js", wrapper.path.slice(1), "favicon.ico", "favicon.svg", "icons/bright-pages.svg",
    ...(role === "child" ? ["manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
      "icons/icon-maskable-192.png", "icons/icon-maskable-512.png"] : []),
  ];
  assert.ok(expected.every(file => files.includes(file)), role + " static inventory is incomplete");
  assert.ok(files.every(file => expected.includes(file) || versionedAsset.test(file)), role + " includes unexpected output");
  assert.equal(readFileSync(join(staticDir, wrapper.path), "utf8"), wrapper.html);
  const assets = files.map(file => {
    const content = readFileSync(join(staticDir, file));
    if (/\bsb_secret_[A-Za-z0-9_-]{12,}|["']role["']\s*:\s*["']service_role["']/.test(content.toString("utf8"))) {
      throw new Error("A server-only credential pattern was found in browser output.");
    }
    return { file, bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") };
  });
  const bundles = files.filter(file => file.endsWith(".js") && versionedAsset.test(file))
    .map(file => readFileSync(join(staticDir, file), "utf8")).join("\n");
  assert.ok(bundles.includes(stagingBackend), role + " does not target the approved API");
  assert.equal(bundles.includes(publishableKey), role === "admin");
  writeFileSync(join(output, "config.json"), JSON.stringify(config, null, 2) + "\n");
  return { role, origin: stagingOrigins[role], backend: stagingBackend, assets };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const destination = process.argv[2];
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!destination || !key || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error("Supply an output directory and the approved staging project's publishable browser key.");
  }
  const root = resolve(destination);
  mkdirSync(root);
  const builds = (["child", "admin"] as const).map(role => emitRole(root, role, key));
  writeFileSync(join(root, "build-receipt.json"), JSON.stringify(builds, null, 2) + "\n");
}
