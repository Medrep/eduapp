import { ApiError, env } from "./http.ts";

const encoder = new TextEncoder();
const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function digest(bytes: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

async function hmac(secretName: string, value: string): Promise<string> {
  const secret = encoder.encode(env(secretName));
  if (secret.byteLength < 32) throw new ApiError(503);
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

export function randomPairingCode(): string {
  const chars = Array.from(crypto.getRandomValues(new Uint8Array(10)), (byte) => crockford[byte & 31]).join("");
  return chars.slice(0, 5) + "-" + chars.slice(5);
}

export function randomDeviceToken(): string {
  const random = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...random)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function codeHash(code: string): Promise<string> {
  return "\\x" + await hmac("PAIRING_CODE_HMAC_SECRET", "pair-code:" + code);
}

export async function peerHash(peer: string): Promise<string> {
  return await hmac("PAIRING_CODE_HMAC_SECRET", "pair-peer:" + peer);
}

function normalizedIp(value: string): string | undefined {
  if (value.includes(":")) {
    if (!/^[0-9a-f:.]+$/i.test(value)) return undefined;
    try {
      return new URL(`http://[${value}]/`).hostname;
    } catch {
      return undefined;
    }
  }
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    ? parts.map(Number).join(".")
    : undefined;
}

export function ingressPeer(request: Request, transportPeer: string): string {
  const gateway = new URL(env("SUPABASE_URL")).origin;
  const isLocalKong = Deno.env.get("PUBLIC_STORAGE_ORIGIN") === "http://127.0.0.1:54321" &&
    ["http://kong:8000", "http://supabase_kong_moja-nauka-local:8000"].includes(gateway);
  // The dedicated Kong image overwrites this header with its transport client address.
  // Other ingress configurations use the runtime peer until their trusted boundary is verified.
  const forwarded = isLocalKong ? request.headers.get("x-real-ip") : null;
  return (forwarded ? normalizedIp(forwarded) : undefined) ?? transportPeer;
}

export async function deviceHash(token: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(401);
  return "\\x" + await hmac("DEVICE_TOKEN_PEPPER", "device:" + token);
}
