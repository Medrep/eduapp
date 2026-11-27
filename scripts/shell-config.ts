import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { isRetiredViewerPath, passiveWrapperHtml, wrapperHeaders, type ViewerRole, type ViewerWrapper } from "../packages/contracts/src/viewer-wrapper.ts";

export function buildViewerWrapper(role: ViewerRole): ViewerWrapper {
  const html = passiveWrapperHtml(role);
  const version = createHash("sha256").update(html, "utf8").digest("hex");
  return { html, path: `/__viewer/${role}-${version}.html` };
}

export function shellContentSecurityPolicy(origin: string, wrapperPath: string, backendOrigin?: string | null) {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "manifest-src 'self'",
    `connect-src 'self'${backendOrigin ? ` ${backendOrigin}` : ""}`,
    "worker-src 'self'",
    `frame-src ${new URL(wrapperPath, origin).href}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

function fail(response: ServerResponse) {
  response.writeHead(404, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  response.end("Lekcja jest niedostępna.");
}

export function shellConfig(port: number, wrapper: ViewerWrapper, backendOrigin?: string | null) {
  const options = { host: "127.0.0.1", port, strictPort: true };
  const expectedBytes = Buffer.from(wrapper.html, "utf8");
  const middleware = (builtFile?: string) => async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    const target = request.url ?? "/";
    if (!target.startsWith("/") || target.startsWith("//")) return fail(response);
    const protocol = "encrypted" in request.socket && request.socket.encrypted ? "https" : "http";
    let parsed: URL;
    try {
      parsed = new URL(target, `${protocol}://${request.headers.host ?? `127.0.0.1:${port}`}`);
    } catch {
      return fail(response);
    }
    const path = parsed.pathname;
    response.setHeader("Content-Security-Policy", shellContentSecurityPolicy(parsed.origin, wrapper.path, backendOrigin));
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (path === "/sw.js") response.setHeader("Cache-Control", "no-cache");
    if (isRetiredViewerPath(path)) return fail(response);
    if (path !== "/__viewer" && !path.startsWith("/__viewer/")) return next();
    if (path !== wrapper.path || parsed.search || !["GET", "HEAD"].includes(request.method ?? "")) {
      return fail(response);
    }
    try {
      const asset = builtFile === undefined ? expectedBytes : await readFile(builtFile);
      if (!asset.equals(expectedBytes)) return fail(response);
      response.writeHead(200, { ...wrapperHeaders, "Cache-Control": "public, max-age=31536000, immutable" });
      response.end(request.method === "HEAD" ? undefined : asset);
    } catch {
      fail(response);
    }
  };
  const wrapperPlugin: Plugin = {
    name: "moja-nauka-passive-wrapper",
    configureServer(server) {
      server.middlewares.use(middleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(resolve(server.config.root, server.config.build.outDir, wrapper.path.slice(1))));
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: wrapper.path.slice(1), source: wrapper.html });
    },
  };
  return {
    define: { __VIEWER_WRAPPER__: JSON.stringify(wrapper) },
    plugins: [wrapperPlugin],
    appType: "mpa" as const,
    server: { ...options, hmr: false as const },
    preview: options,
  };
}
