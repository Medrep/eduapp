import {
  hasIntegrity, integrityFields, isCatalog, isPairReply, record, sameIntegrity, timestamp,
  type Identity, type Lesson,
} from "../../../packages/contracts/src/device.ts";
import { signedLessonDownload, verifiedHtmlResponse } from "../../../packages/contracts/src/storage-transfer.ts";

declare const __SUPABASE_ORIGIN__: string | null;

export type Failure = "network" | "auth" | "schema" | "integrity" | "quota" | "pair" | "storage" | "stale";

export class SyncError extends Error {
  readonly code: Failure;
  readonly retry: boolean;

  constructor(code: Failure, retry = false) {
    super(code);
    this.code = code;
    this.retry = retry;
  }
}

export function failure(error: unknown): Failure {
  if (error instanceof SyncError) return error.code;
  if (error instanceof DOMException && error.name === "QuotaExceededError") return "quota";
  return "storage";
}

function options(signal: AbortSignal): RequestInit {
  return { cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal };
}

async function request(path: string, signal: AbortSignal, identity?: Identity, payload?: object): Promise<unknown> {
  const headers = new Headers();
  if (identity) headers.set("Authorization", `Bearer ${identity.deviceToken}`);
  const init = options(AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
  if (payload) {
    headers.set("Content-Type", "application/json");
    init.method = "POST";
    init.body = JSON.stringify(payload);
  }
  let response: Response;
  try {
    const url = __SUPABASE_ORIGIN__ ? `${__SUPABASE_ORIGIN__}/functions/v1/device-api${path}` : path;
    response = await fetch(url, { ...init, headers });
  } catch {
    throw new SyncError("network", true);
  }
  if (response.status === 401 || response.status === 403) throw new SyncError(identity ? "auth" : "pair");
  if (!identity && [400, 404, 409, 429].includes(response.status)) throw new SyncError("pair");
  if (response.status !== 200) throw new SyncError("network", response.status >= 500 || response.status === 429);
  try {
    return await response.json();
  } catch {
    throw new SyncError("schema");
  }
}

export async function pairDevice(pairingCode: string, deviceLabel: string, signal: AbortSignal) {
  const response = await request("/device/v1/pair", signal, undefined, { pairingCode, deviceLabel });
  if (!isPairReply(response)) throw new SyncError("schema");
  return response;
}

export async function loadCatalog(identity: Identity, signal: AbortSignal) {
  const response = await request("/device/v1/catalog", signal, identity);
  if (!isCatalog(response) || response.family.id !== identity.familyId) throw new SyncError("schema");
  return response;
}

function downloadUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname === "127.0.0.1" && value === location.origin + url.pathname &&
        /^\/__device-mock\/content\/[0-9a-f]{64}$/.test(url.pathname)) return url;
  } catch {
    return undefined;
  }
}

export async function fetchLesson(identity: Identity, lesson: Lesson, signal: AbortSignal) {
  const data = await request("/device/v1/download-url", signal, identity, { lessonId: lesson.id, versionId: lesson.version.id });
  if (!record(data) || typeof data.signedUrl !== "string" || !timestamp(data.expiresAt) ||
      !hasIntegrity(data) || !sameIntegrity(data, lesson.version)) throw new SyncError("integrity");
  const url = __SUPABASE_ORIGIN__
    ? signedLessonDownload(data.signedUrl, __SUPABASE_ORIGIN__, lesson.id, lesson.version.id)
    : downloadUrl(data.signedUrl);
  if (!url) throw new SyncError("integrity");
  if (Date.parse(data.expiresAt) <= Date.now()) throw new SyncError("network", true);
  let response: Response;
  const limited = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  try {
    response = await fetch(url, options(limited));
  } catch {
    throw new SyncError("network", true);
  }
  if (response.status !== 200) {
    void response.body?.cancel().catch(() => undefined);
    throw new SyncError("network", [401, 403, 404, 410, 429].includes(response.status) || response.status >= 500);
  }
  const blob = await verifiedHtmlResponse(response, integrityFields(data), limited).catch(() => {
    throw new SyncError("network", true);
  });
  if (!blob) throw new SyncError("integrity", true);
  return blob;
}
