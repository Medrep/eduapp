import { referenceLesson } from "../../../scripts/reference-lesson.ts";

const database = "mojanauka-s1-regression";
const catalogKey = "current";
const stores = ["authorizedCatalog", "installations", "lessonBytes"];

type Version = { id: string; sha256: string; sizeBytes: number };
type CatalogLesson = { id: string; version: Version };
type Installed = { lessonId: string; installedVersionId: string; sha256: string; sizeBytes: number };
type LessonBytes = { lessonId: string; versionId: string; sha256: string; sizeBytes: number; blob: Blob };
type LocalCatalog = { schemaVersion: 1; lessons: CatalogLesson[] };

function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("identity");
      db.createObjectStore("authorizedCatalog");
      db.createObjectStore("lessonBytes", { keyPath: ["lessonId", "versionId"] });
      db.createObjectStore("installations", { keyPath: "lessonId" });
      db.createObjectStore("syncMeta");
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Przerwano transakcję IndexedDB."));
  });
}

function read<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function catalogLesson(catalog: LocalCatalog | undefined, lessonId: string) {
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.lessons)) return undefined;
  const lesson = catalog.lessons.find((entry) => entry?.id === lessonId);
  const version = lesson?.version;
  if (!version || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(version.id) ||
      !/^[0-9a-f]{64}$/.test(version.sha256) || !Number.isSafeInteger(version.sizeBytes) ||
      version.sizeBytes < 1 || version.sizeBytes > 20 * 1024 * 1024
  ) return undefined;
  return lesson;
}

function matchesReference(catalog: LocalCatalog | undefined) {
  const version = catalogLesson(catalog, referenceLesson.lessonId)?.version;
  return version?.id === referenceLesson.versionId &&
    version.sha256 === referenceLesson.sha256 && version.sizeBytes === referenceLesson.sizeBytes;
}

async function seedCatalog(db: IDBDatabase, now: string) {
  // Separate origin-local proof snapshot, with no device identity or issued credentials.
  const tx = db.transaction("authorizedCatalog", "readwrite");
  const done = transactionDone(tx);
  const catalog = tx.objectStore("authorizedCatalog");
  const current = catalog.get(catalogKey);
  current.onsuccess = () => {
    if (current.result !== undefined) return;
    catalog.put({
      schemaVersion: 1,
      revision: 1,
      generatedAt: now,
      receivedAt: now,
      lastSuccessfulSyncAt: now,
      family: { id: "9fdd4a77-ff54-4f1b-825b-6102451dcdba", label: "Próba lokalna" },
      subjects: [{ id: "60c0572e-eeab-43b2-ba75-c5c0f7d9275d", slug: "przyroda", namePl: "Przyroda", sortOrder: 1 }],
      lessons: [{
        id: referenceLesson.lessonId,
        subjectId: "60c0572e-eeab-43b2-ba75-c5c0f7d9275d",
        title: "Skały i gleba",
        description: null,
        grade: null,
        publishedAt: now,
        version: { id: referenceLesson.versionId, number: 1, sha256: referenceLesson.sha256, sizeBytes: referenceLesson.sizeBytes },
      }],
    }, catalogKey);
  };
  await done;
}

export async function storeReferenceLesson(blob: Blob) {
  const db = await open();
  const now = new Date().toISOString();
  try {
    await seedCatalog(db, now);
    const tx = db.transaction(stores, "readwrite");
    const done = transactionDone(tx);
    const request = tx.objectStore("authorizedCatalog").get(catalogKey);
    request.onsuccess = () => {
      if (!matchesReference(request.result)) {
        tx.abort();
        return;
      }
      const { lessonId, versionId, sha256, sizeBytes } = referenceLesson;
      tx.objectStore("lessonBytes").put({ lessonId, versionId, sha256, sizeBytes, blob, verifiedAt: now });
      tx.objectStore("installations").put({ lessonId, installedVersionId: versionId, sha256, sizeBytes, installedAt: now });
    };
    await done;
  } finally {
    db.close();
  }
}

export async function readInstalledLesson(lessonId: string, versionId: string) {
  const db = await open();
  let bytes: LessonBytes | undefined;
  try {
    const tx = db.transaction(stores, "readonly");
    const [catalog, installed, stored] = await Promise.all([
      read<LocalCatalog | undefined>(tx.objectStore("authorizedCatalog").get(catalogKey)),
      read<Installed | undefined>(tx.objectStore("installations").get(lessonId)),
      read<LessonBytes | undefined>(tx.objectStore("lessonBytes").get([lessonId, versionId])),
      transactionDone(tx),
    ]);
    const authorized = catalogLesson(catalog, lessonId);
    if (!authorized || installed?.lessonId !== lessonId || installed.installedVersionId !== versionId ||
      stored?.lessonId !== lessonId || stored.versionId !== versionId ||
      stored.sha256 !== installed.sha256 || !/^[a-f0-9]{64}$/.test(stored.sha256) ||
      stored.sizeBytes !== installed.sizeBytes || !(stored.blob instanceof Blob) ||
      !Number.isSafeInteger(stored.sizeBytes) || stored.sizeBytes < 1 || stored.sizeBytes > 20 * 1024 * 1024 || stored.blob.size !== stored.sizeBytes
    ) return undefined;

    // A still-authorized installed older version may remain readable in a future sync slice.
    if (authorized.version.id === versionId &&
      (authorized.version.sha256 !== stored.sha256 || authorized.version.sizeBytes !== stored.sizeBytes)
    ) return undefined;
    bytes = stored;
  } finally {
    db.close();
  }
  const digest = await crypto.subtle.digest("SHA-256", await bytes.blob.arrayBuffer());
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return hash === bytes.sha256 ? bytes.blob : undefined;
}
