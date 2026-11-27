import { uuid } from "./contracts.ts";
import { ApiError, bearer, configuredOrigin, env, validated } from "./http.ts";

export type Row = Record<string, unknown>;
export type Actor = { p_user: string; p_session: string };

function object(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(503);
  return value as Row;
}

function backendUrl(path: string): URL {
  return new URL(path, env("SUPABASE_URL"));
}

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const single = Deno.env.get("SUPABASE_SECRET_KEY");
  if (single) return single;
  const keys = object(JSON.parse(env("SUPABASE_SECRET_KEYS")));
  if (typeof keys.default !== "string") throw new ApiError(503);
  return keys.default;
}

function credentials(key: string): Headers {
  const headers = new Headers({ apikey: key });
  if (!key.startsWith("sb_")) headers.set("Authorization", `Bearer ${key}`);
  return headers;
}

async function call(path: string, options: RequestInit = {}, headers = credentials(serviceKey())) {
  new Headers(options.headers).forEach((value, name) => headers.set(name, value));
  try {
    return await fetch(backendUrl(path), { ...options, headers, redirect: "error",
      signal: AbortSignal.timeout(45000) });
  } catch {
    throw new ApiError(503);
  }
}

function json(value: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(value), headers: { "Content-Type": "application/json" } };
}

function sqlStatus(code: unknown): number {
  if (typeof code !== "string") return 503;
  if (/^PT(?:400|401|403|404|409|413|422|429|503)$/.test(code)) return Number(code.slice(2));
  if (code === "23505") return 409;
  if (["23502", "23503", "23514", "22P02"].includes(code)) return 400;
  return 503;
}

export async function rpc<T>(name: string, values: Row): Promise<T> {
  const response = await call(`/rest/v1/rpc/${name}`, json(values));
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const code = body && typeof body === "object" && "code" in body ? body.code : undefined;
    throw new ApiError(sqlStatus(code));
  }
  if (response.status === 204) return null as T;
  return await response.json() as T;
}

export async function select(table: string, filters: Record<string, string>): Promise<Row[]> {
  const response = await call(`/rest/v1/${table}?${new URLSearchParams(filters)}`);
  if (!response.ok) throw new ApiError(503);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new ApiError(503);
  return rows.map(object);
}

function tokenClaims(token: string, failure = 401): Row {
  const payload = token.split(".")[1];
  if (!payload) throw new ApiError(failure);
  try {
    const bytes = Uint8Array.from(atob(payload.replaceAll("-", "+").replaceAll("_", "/")), (byte) => byte.charCodeAt(0));
    const claims: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) throw new Error();
    return claims as Row;
  } catch {
    throw new ApiError(failure);
  }
}

export async function requireOwner(request: Request): Promise<Actor> {
  const token = bearer(request);
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw new ApiError(401);
  const response = await call("/auth/v1/user", { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new ApiError(response.status >= 500 ? 503 : 401);

  // Only use session claims after the Auth server has validated the signed token.
  const user = object(await response.json());
  const claims = tokenClaims(token);
  if (claims.role !== "authenticated" || claims.sub !== user.id || typeof claims.exp !== "number" ||
      claims.exp <= Date.now() / 1000) throw new ApiError(401);
  const actor = { p_user: validated(uuid, user.id, 401), p_session: validated(uuid, claims.session_id, 401) };
  await checkOwner(actor);
  return actor;
}

export async function checkOwner(actor: Actor): Promise<void> {
  if (await rpc<boolean>("mn_admin_session", actor) !== true) throw new ApiError(403);
}

export const staging = "lesson-staging";
export const bundles = "lesson-bundles";
const grantSeconds = 5 * 60;

function publicGrant(raw: unknown, expectedPath: string): URL {
  if (typeof raw !== "string" || !raw.startsWith("/object/")) throw new ApiError(503);
  const origin = configuredOrigin("PUBLIC_STORAGE_ORIGIN");
  const url = new URL("/storage/v1" + raw, origin);
  const tokens = url.searchParams.getAll("token");
  if (url.origin !== origin || url.pathname !== "/storage/v1" + expectedPath || url.hash ||
      tokens.length !== 1 || !tokens[0] || [...url.searchParams.keys()].some((key) => key !== "token")) {
    throw new ApiError(503);
  }
  return url;
}

export async function signUpload(path: string): Promise<{ uploadUrl: string; grantExpiresAt: string }> {
  const target = `/object/upload/sign/${staging}/${path}`;
  const response = await call("/storage/v1" + target, json({}));
  if (!response.ok) throw new ApiError(503);
  const url = publicGrant(object(await response.json()).url, target);
  const expiry = tokenClaims(url.searchParams.get("token") ?? "", 503).exp;
  if (typeof expiry !== "number" || !Number.isSafeInteger(expiry) || expiry <= Date.now() / 1000 ||
      expiry > 8_640_000_000_000) throw new ApiError(503);
  return { uploadUrl: url.href, grantExpiresAt: new Date(expiry * 1000).toISOString() };
}

export async function signDownload(path: string): Promise<{ signedUrl: string; expiresAt: string }> {
  const target = `/object/sign/${bundles}/${path}`;
  const requestedAt = Date.now();
  const response = await call("/storage/v1" + target, json({ expiresIn: grantSeconds }));
  if (!response.ok) throw new ApiError(response.status === 404 ? 404 : 503);
  const url = publicGrant(object(await response.json()).signedURL, target);
  // Deliver even a manually followed link as an attachment. Storage holds generic bytes.
  url.searchParams.set("download", "lesson.html");
  return { signedUrl: url.href, expiresAt: new Date(requestedAt + grantSeconds * 1000).toISOString() };
}

export async function getObject(bucket: typeof staging | typeof bundles, path: string): Promise<Response> {
  const response = await call(`/storage/v1/object/authenticated/${bucket}/${path}`);
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiError(response.status === 404 || response.status === 400 ? 404 : 503);
  }
  return response;
}

export async function insertBundle(path: string, bytes: Uint8Array): Promise<boolean> {
  const response = await call(`/storage/v1/object/${bundles}/${path}`, {
    method: "POST",
    body: bytes,
    headers: { "Content-Type": "application/octet-stream", "Cache-Control": "max-age=0", "x-upsert": "false" },
  });
  await response.body?.cancel();
  if (response.ok) return true;
  if (response.status === 409 || response.status === 400) return false;
  throw new ApiError(503);
}

