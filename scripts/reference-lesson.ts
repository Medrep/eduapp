// Loopback proof accepts the owner-supplied lesson, never arbitrary HTML.
export const referenceLesson = {
  lessonId: "6e64c984-c836-4371-a01a-a67cc3b940dd",
  versionId: "fa1467c2-fe4d-418f-97ce-bfca70165956",
  sizeBytes: 333033,
  sha256: "7590b609c72a5e454887707ed16a5e3de6bec759ea1fc2e88247f9654265566c",
};

function sha256Bytes(bytes: ArrayBuffer) {
  return crypto.subtle.digest("SHA-256", bytes).then((digest) =>
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
}

export async function verifyReferenceLesson(file: File) {
  if (file.size !== referenceLesson.sizeBytes) {
    throw new Error("Niezgodny rozmiar lub suma SHA-256 lekcji wzorcowej.");
  }
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== referenceLesson.sizeBytes || await sha256Bytes(bytes) !== referenceLesson.sha256) {
    throw new Error("Niezgodny rozmiar lub suma SHA-256 lekcji wzorcowej.");
  }
  return new Blob([bytes], { type: "text/html;charset=utf-8" });
}
