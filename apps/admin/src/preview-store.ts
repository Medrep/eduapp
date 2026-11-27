import { hasIntegrity, sameIntegrity, type Integrity } from "../../../packages/contracts/src/device.ts";
import { verifiesBlob } from "../../../packages/contracts/src/storage-transfer.ts";

const database = "mojanauka-admin-preview-v1";
const storeName = "previewBytes";
export const previewTtlMs = 10 * 60 * 1000;

type Preview = { id: string; blob: Blob; sha256: string; sizeBytes: number; createdAt: number; expiresAt: number };

function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(storeName, { keyPath: "id" });
      store.createIndex("expiresAt", "expiresAt");
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: "readonly" | "readwrite",
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await open();
  try {
    const transaction = db.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    return await new Promise<T>((resolve, reject) => {
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? new Error("Przerwano transakcję IndexedDB."));
    });
  } finally {
    db.close();
  }
}

export async function savePreview(blob: Blob, sha256: string) {
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const expiresAt = createdAt + previewTtlMs;
  const preview = { id, blob, sha256, sizeBytes: blob.size, createdAt, expiresAt };
  await withStore("readwrite", (store) => store.add(preview));
  return { id, expiresAt };
}

export async function deletePreview(id: string) {
  await withStore("readwrite", (store) => store.delete(id));
}

export async function sweepExpiredPreviews() {
  const db = await open();
  try {
    const now = Date.now();
    const transaction = db.transaction(storeName, "readwrite");
    const cursor = transaction.objectStore(storeName).index("expiresAt").openCursor();
    let nextExpiry: number | undefined;
    cursor.onsuccess = () => {
      const record = cursor.result;
      if (!record || typeof record.key !== "number") return;
      if (record.key <= now) {
        record.delete();
        record.continue();
      } else {
        nextExpiry = record.key;
      }
    };
    return await new Promise<number | undefined>((resolve, reject) => {
      transaction.oncomplete = () => resolve(nextExpiry);
      transaction.onabort = () => reject(transaction.error ?? new Error("Przerwano transakcję IndexedDB."));
    });
  } finally {
    db.close();
  }
}

export function maintainPreviewExpiry() {
  let stopped = false;
  let running = false;
  let timer: number | undefined;
  function resweep() {
    if (running || stopped) return;
    running = true;
    window.clearTimeout(timer);
    const startedAt = Date.now();
    // Revisit the store within one TTL even if other tabs create records while this one is idle.
    const fallback = startedAt + previewTtlMs;
    void sweepExpiredPreviews().then(next => Math.min(next ?? fallback, fallback), () => startedAt + 60_000)
      .then(next => {
        running = false;
        if (!stopped) timer = window.setTimeout(resweep, Math.max(0, next - Date.now()));
      });
  }
  const onVisible = () => { if (document.visibilityState === "visible") resweep(); };
  window.addEventListener("pageshow", resweep);
  document.addEventListener("visibilitychange", onVisible);
  resweep();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    window.removeEventListener("pageshow", resweep);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export async function readPreview(id: string, expected: Integrity) {
  const record = await withStore<Preview | undefined>("readonly", (store) => store.get(id));
  if (record?.id !== id || !Number.isFinite(record.expiresAt)) return undefined;
  if (record.expiresAt <= Date.now()) {
    await deletePreview(id);
    return undefined;
  }
  if (!(record.blob instanceof Blob) || !Number.isSafeInteger(record.sizeBytes) || record.sizeBytes < 1 ||
      record.sizeBytes > 20 * 1024 * 1024 || record.blob.size !== record.sizeBytes ||
      !/^[a-f0-9]{64}$/.test(record.sha256) || !Number.isFinite(record.createdAt) ||
      record.createdAt > Date.now() || record.expiresAt - record.createdAt !== previewTtlMs ||
      !sameIntegrity(record, expected)
  ) return undefined;
  return await verifiesBlob(record.blob, record) && record.expiresAt > Date.now() ? record.blob : undefined;
}

// The technical proof resumes only a preview matching the expected fixture integrity.
export async function latestPreview(expected: Integrity) {
  const cursor = await withStore("readonly", (store) => {
    const request = store.index("expiresAt").openCursor(IDBKeyRange.lowerBound(Date.now(), true), "prev");
    request.onsuccess = () => {
      const current = request.result;
      if (!current) return;
      const value: unknown = current.value;
      if (!hasIntegrity(value) || !sameIntegrity(value, expected)) current.continue();
    };
    return request;
  });
  const current: Preview | undefined = cursor?.value;
  return current && await readPreview(current.id, expected)
    ? { id: current.id, expiresAt: current.expiresAt }
    : undefined;
}
