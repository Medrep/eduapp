import { type Integrity } from "./device.ts";

export function signedStorageUrl(value: unknown, origin: string, path: string, action: "upload" | "download") {
  if (typeof value !== "string") return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.origin !== origin || url.pathname !== path || url.username || url.password ||
      url.hash || url.href !== value) return undefined;
  const tokens = url.searchParams.getAll("token");
  if (tokens.length !== 1 || !tokens[0]) return undefined;
  const expected = action === "download" ? ["token", "download"] : ["token"];
  const keys = [...url.searchParams.keys()];
  if (keys.length !== expected.length || keys.some(key => !expected.includes(key)) ||
      (action === "download" && url.searchParams.get("download") !== "lesson.html")) return undefined;
  return url;
}

export function signedLessonDownload(value: unknown, origin: string, lessonId: string, versionId: string) {
  return signedStorageUrl(value, origin,
    `/storage/v1/object/sign/lesson-bundles/lessons/${lessonId}/versions/${versionId}.html`, "download");
}

export function signedStageUpload(value: unknown, origin: string, uploadId: string) {
  return signedStorageUrl(value, origin,
    `/storage/v1/object/upload/sign/lesson-staging/uploads/${uploadId}.html`, "upload");
}

async function sha256(bytes: ArrayBuffer) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function blobSha256(blob: Blob) {
  return sha256(await blob.arrayBuffer());
}

export async function verifiesBlob(blob: Blob, integrity: Integrity) {
  if (blob.size !== integrity.sizeBytes) return false;
  try {
    const bytes = await blob.arrayBuffer();
    if (await sha256(bytes) !== integrity.sha256) return false;
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export async function verifiedHtmlResponse(response: Response, integrity: Integrity, signal: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > integrity.sizeBytes) {
        void reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(part.value.slice().buffer);
    }
  } catch (cause) {
    void reader.cancel().catch(() => undefined);
    throw cause;
  } finally {
    reader.releaseLock();
  }
  if (size !== integrity.sizeBytes) return undefined;
  const blob = new Blob(chunks, { type: "text/html;charset=utf-8" });
  return await verifiesBlob(blob, integrity) ? blob : undefined;
}
