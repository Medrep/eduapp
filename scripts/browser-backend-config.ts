import { Buffer } from "node:buffer";
import { loadEnv } from "vite";

export function browserBackendConfig(mode: string, role: "admin" | "child") {
  const env = loadEnv(mode, process.cwd(), "VITE_SUPABASE_");
  const rawOrigin = env.VITE_SUPABASE_URL;
  const publishableKey = role === "admin" ? env.VITE_SUPABASE_PUBLISHABLE_KEY : undefined;
  if (!rawOrigin && !publishableKey) return { origin: null, publishableKey: null };
  if (!rawOrigin) throw new Error("VITE_SUPABASE_URL is required for the configured backend.");
  const url = URL.parse(rawOrigin);
  const loopback = url && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (!url || ![url.origin, `${url.origin}/`].includes(rawOrigin) ||
      (!loopback && !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(url.hostname)) ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
    throw new Error("VITE_SUPABASE_URL must be an exact HTTPS origin or a loopback HTTP origin.");
  }
  if (role === "admin" && !isPublishableKey(publishableKey)) {
    throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY must be a publishable key or legacy anon key.");
  }
  return { origin: url.origin, publishableKey: publishableKey ?? null };
}

function isPublishableKey(key: string | undefined) {
  if (!key) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  const jwt = /^[\w-]+\.([\w-]+)\.[\w-]+$/.exec(key);
  if (!jwt?.[1]) return false;
  try {
    const claims: unknown = JSON.parse(Buffer.from(jwt[1], "base64url").toString("utf8"));
    return Boolean(claims && typeof claims === "object" && "role" in claims && claims.role === "anon");
  } catch {
    return false;
  }
}
