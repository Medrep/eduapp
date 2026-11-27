import type { ZodType } from "npm:zod@4.1.12";

const errors: Record<number, [string, string]> = {
  400: ["INVALID_REQUEST", "Nieprawidłowe dane żądania."],
  401: ["UNAUTHENTICATED", "Wymagane uwierzytelnienie."],
  403: ["FORBIDDEN", "Brak uprawnień."],
  404: ["NOT_FOUND", "Zasób jest niedostępny."],
  405: ["METHOD_NOT_ALLOWED", "Metoda jest niedostępna."],
  409: ["CONFLICT", "Stan zasobu zmienił się. Odśwież i spróbuj ponownie."],
  413: ["TOO_LARGE", "Przekroczono limit rozmiaru."],
  422: ["INVALID_LESSON", "Plik nie spełnia wymagań lekcji offline."],
  429: ["RATE_LIMITED", "Zbyt wiele prób. Spróbuj ponownie później."],
  500: ["INTERNAL_ERROR", "Nie można przetworzyć żądania."],
  503: ["UNAVAILABLE", "Usługa jest tymczasowo niedostępna."],
};

export class ApiError extends Error {
  readonly code: string;
  constructor(readonly status: number, message?: string) {
    const [code, defaultMessage] = errors[status] ?? errors[500]!;
    super(message ?? defaultMessage);
    this.code = code;
  }
}

export function validated<T>(schema: ZodType<T>, value: unknown, status = 400): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(status);
  return parsed.data;
}

export async function boundedBytes(response: Request | Response, limit: number): Promise<Uint8Array> {
  const advertised = response.headers.get("content-length");
  if (advertised !== null && Number(advertised) > limit) {
    await response.body?.cancel();
    throw new ApiError(413);
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const buffer = new Uint8Array(limit);
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (size + next.value.byteLength > limit) {
        await reader.cancel();
        throw new ApiError(413);
      }
      buffer.set(next.value, size);
      size += next.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return buffer.subarray(0, size);
}

export async function readBody<T>(request: Request, schema: ZodType<T>, allowEmpty = false): Promise<T> {
  if (allowEmpty && !request.body) return validated(schema, {});
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new ApiError(400);
  }
  const bytes = await boundedBytes(request, 64 * 1024);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError(400);
  }
  return validated(schema, value);
}

export function bearer(request: Request): string {
  const match = /^Bearer (\S{1,8192})$/i.exec(request.headers.get("authorization") ?? "");
  if (!match?.[1]) throw new ApiError(401);
  return match[1];
}

export function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new ApiError(503);
  return value;
}

export function configuredOrigin(name: string): string {
  const url = new URL(env(name));
  if (url.href !== url.origin + "/" || !["https:", "http:"].includes(url.protocol) ||
      (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) {
    throw new ApiError(503);
  }
  return url.origin;
}

type Result = { status: number; data: unknown };
export type RequestTrace = { uploadSize: (bytes: unknown) => void };
type GatewayKind = "admin" | "device";
type Handler = (
  request: Request, path: string, query: URLSearchParams, peer: string, trace: RequestTrace,
) => Promise<Result>;
const allowHeaders = new Set(["authorization", "content-type", "apikey", "x-client-info"]);
const allowedMethods = new Set(["GET", "POST", "PATCH"]);
const endpoints: Record<GatewayKind, [string, RegExp, string][]> = {
  admin: [
    ["GET", /^subjects$/, "subjects.list"],
    ["POST", /^subjects$/, "subjects.create"],
    ["PATCH", /^subjects\/[^/]+$/, "subjects.update"],
    ["GET", /^lessons$/, "lessons.list"],
    ["POST", /^lessons$/, "lessons.create"],
    ["PATCH", /^lessons\/[^/]+$/, "lessons.update"],
    ["POST", /^lessons\/[^/]+\/upload-init$/, "uploads.init"],
    ["POST", /^lessons\/[^/]+\/upload-finalize$/, "uploads.finalize"],
    ["POST", /^lessons\/[^/]+\/publish$/, "lessons.publish"],
    ["POST", /^lessons\/[^/]+\/unpublish$/, "lessons.unpublish"],
    ["GET", /^lessons\/[^/]+\/versions$/, "versions.list"],
    ["POST", /^lessons\/[^/]+\/versions\/[^/]+\/download-url$/, "versions.download-url"],
    ["GET", /^families$/, "families.list"],
    ["POST", /^families$/, "families.create"],
    ["POST", /^families\/[^/]+\/pairing-codes$/, "pairing-codes.create"],
    ["GET", /^devices$/, "devices.list"],
    ["POST", /^devices\/[^/]+\/revoke$/, "devices.revoke"],
  ],
  device: [
    ["POST", /^pair$/, "pair"],
    ["GET", /^catalog$/, "catalog"],
    ["POST", /^download-url$/, "download-url"],
  ],
};

function endpointLabel(kind: GatewayKind, method: string, path: string): string {
  return endpoints[kind].find(([verb, pattern]) => verb === method && pattern.test(path))?.[2] ?? "unmatched";
}

export function data(value: unknown, status = 200): Result {
  return { status, data: value };
}

export function gateway(kind: GatewayKind, handler: Handler) {
  return async (request: Request, info: Deno.ServeHandlerInfo<Deno.NetAddr>): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const started = performance.now();
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
    });
    let result: Result;
    let errorCode: string | undefined;
    let endpoint = "unmatched";
    let uploadSizeBucket: string | undefined;
    const trace: RequestTrace = {
      uploadSize(bytes) {
        if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes <= 0) return;
        const mib = bytes / (1024 * 1024);
        uploadSizeBucket = mib <= 1 ? "1-mib-or-less" : mib <= 5 ? "over-1-to-5-mib" :
          mib <= 20 ? "over-5-to-20-mib" : "over-20-mib";
      },
    };
    function log(status: number) {
      console.info(JSON.stringify({
        requestId, gateway: kind, endpoint, status, errorCode, durationMs: Math.round(performance.now() - started),
        uploadSizeBucket: endpoint === "uploads.init" || endpoint === "uploads.finalize"
          ? uploadSizeBucket ?? "unknown"
          : undefined,
      }));
    }
    try {
      const url = new URL(request.url);
      const gatewayPrefix = new RegExp(`^/(?:functions/v1/)?${kind}-api(?=/)`);
      const path = url.pathname.replace(gatewayPrefix, "");
      const prefix = `/${kind}/v1/`;
      const relative = path.startsWith(prefix) ? path.slice(prefix.length) : "";
      const preflightMethod = request.headers.get("access-control-request-method");
      endpoint = endpointLabel(kind, request.method === "OPTIONS" ? preflightMethod ?? "" : request.method, relative);

      const allowedOrigin = configuredOrigin(kind === "admin" ? "ADMIN_ORIGIN" : "CHILD_ORIGIN");
      const origin = request.headers.get("origin");
      if (origin && origin !== allowedOrigin) throw new ApiError(403);
      if (origin) headers.set("Access-Control-Allow-Origin", origin);
      if (!path.startsWith(prefix)) throw new ApiError(404);

      if (request.method === "OPTIONS") {
        const names = (request.headers.get("access-control-request-headers") ?? "").toLowerCase()
          .split(",").map((name) => name.trim()).filter(Boolean);
        if (!origin || !preflightMethod || !allowedMethods.has(preflightMethod) || names.some((name) => !allowHeaders.has(name))) {
          throw new ApiError(403);
        }
        headers.set("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers");
        headers.set("Access-Control-Allow-Methods", [...allowedMethods].join(", "));
        headers.set("Access-Control-Allow-Headers", [...allowHeaders].join(", "));
        log(204);
        return new Response(null, { status: 204, headers });
      }
      if (!allowedMethods.has(request.method)) throw new ApiError(405);
      result = await handler(request, relative, url.searchParams, info.remoteAddr.hostname, trace);
    } catch (error) {
      const safe = error instanceof ApiError ? error : new ApiError(500);
      errorCode = safe.code;
      if (safe.status === 429) headers.set("Retry-After", "60");
      result = { status: safe.status, data: { error: { code: safe.code, message: safe.message, requestId } } };
    }
    log(result.status);
    return new Response(JSON.stringify(result.data), { status: result.status, headers });
  };
}
