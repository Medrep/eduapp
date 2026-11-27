export type ViewerRole = "child" | "admin";

export type ViewerWrapper = Readonly<{ path: string; html: string }>;

export const wrapperResourcePolicy = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "media-src data:",
  "connect-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

export const wrapperHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": `${wrapperResourcePolicy}; frame-ancestors 'self'`,
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

export function passiveWrapperHtml(role: ViewerRole) {
  return '<!doctype html><html lang="pl"><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${wrapperResourcePolicy}">` +
    `<meta name="viewer-build" content="s1-srcdoc-v1-${role}"><title>Moja Nauka</title>` +
    "<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}" +
    "iframe{display:block;border:0;width:100%;height:100%}</style></head><body></body></html>";
}

export async function matchesWrapperResponse(response: Response, url: string, wrapper: ViewerWrapper) {
  if (response.status !== 200 || response.redirected || response.url !== url ||
      !Object.entries(wrapperHeaders).every(([name, expected]) => response.headers.get(name) === expected)) {
    return false;
  }
  const bytes = await response.clone().arrayBuffer();
  return decodeExactUtf8(bytes) === wrapper.html;
}

export function decodeExactUtf8(bytes: ArrayBuffer) {
  const html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const original = new Uint8Array(bytes);
  const encoded = new TextEncoder().encode(html);
  if (encoded.length !== original.length || !encoded.every((byte, position) => byte === original[position])) {
    throw new Error("Invalid UTF-8 source");
  }
  return html;
}

export function workerPathForWrapper(wrapperPath: string) {
  return `/sw.js?${new URLSearchParams({ viewer: wrapperPath })}`;
}

export function isRetiredViewerPath(path: string) {
  return /^\/__(offline_lesson|preview_lesson)(?:\/|$)/.test(path);
}
