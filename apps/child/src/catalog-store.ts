import {
  integrityFields, isIdentity, isInstalled, isLessonBytes, isSnapshot, record, sameIntegrity, timestamp, uuid,
  type Catalog, type Identity, type Lesson, type LessonBytes, type PairReply, type Snapshot,
} from "../../../packages/contracts/src/device.ts";
import { SyncError, type Failure } from "./device-api.ts";
import { verifiesBlob } from "../../../packages/contracts/src/storage-transfer.ts";

const database = "mojanauka-child-v1";
export const childDatabaseVersion = 2;
const storeNames = ["identity", "authorizedCatalog", "lessonBytes", "installations", "syncMeta"] as const;
type StoreName = typeof storeNames[number];
type Stores = Record<StoreName, IDBObjectStore>;
type Access = Pick<Identity, "deviceId" | "familyId" | "generation">;
type SyncState = { sequence: number; lastAttemptAt: string; deniedAt?: number; authorizedAt?: number; lastErrorCode?: Failure };
export type SyncRun = { identity: Identity; sequence: number };

async function syncState(stores: Stores): Promise<SyncState | undefined> {
  const entry: unknown = await get(stores.syncMeta.get("status"));
  if (!record(entry) || typeof entry.sequence !== "number" || !Number.isSafeInteger(entry.sequence) ||
      entry.sequence < 1 || !timestamp(entry.lastAttemptAt)) return undefined;
  const { sequence, lastAttemptAt } = entry;
  const validSequence = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= sequence;
  return { sequence, lastAttemptAt,
    ...(validSequence(entry.authorizedAt) ? { authorizedAt: entry.authorizedAt } : {}),
    ...(validSequence(entry.deniedAt) ? { deniedAt: entry.deniedAt } : {}),
  };
}
type Lease = Access & { lessonId: string; versionId: string; pinnedAt: number; locked: boolean };
const leaseKey = (id: string) => `viewer:${id}`;

export function openChildDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(database, childDatabaseVersion);
    let blocked = false;
    opening.onblocked = () => {
      blocked = true;
      reject(new SyncError("storage"));
    };
    opening.onupgradeneeded = () => {
      const db = opening.result;
      const migration = opening.transaction;
      if (!migration) throw new SyncError("storage");
      for (const store of storeNames) {
        if (db.objectStoreNames.contains(store)) continue;
        if (store === "lessonBytes") db.createObjectStore(store, { keyPath: ["lessonId", "versionId"] });
        else if (store === "installations") db.createObjectStore(store, { keyPath: "lessonId" });
        else db.createObjectStore(store);
      }
      // Extend a valid v1 identity in place. Legacy unpaired proof bytes never grant S2 authorization.
      const identities = migration.objectStore("identity");
      const existing = identities.get("identity");
      existing.onsuccess = () => {
        if (!record(existing.result) || isIdentity(existing.result)) return;
        const migrated: unknown = { ...existing.result, generation: crypto.randomUUID() };
        if (isIdentity(migrated)) identities.put(migrated, "identity");
      };
    };
    opening.onsuccess = () => {
      const db = opening.result;
      db.onversionchange = () => db.close();
      if (blocked) db.close();
      else resolve(db);
    };
    opening.onerror = () => reject(opening.error?.name === "VersionError" ? new SyncError("schema") : opening.error);
  });
}

export function get<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new SyncError("storage"));
  });
}

async function transact<T>(mode: IDBTransactionMode, action: (stores: Stores) => Promise<T>) {
  const db = await openChildDatabase();
  try {
    const tx = db.transaction(storeNames, mode);
    const done = transactionDone(tx);
    void done.catch(() => undefined);
    try {
      const stores = Object.fromEntries(storeNames.map(name => [name, tx.objectStore(name)])) as Stores;
      const result = await action(stores);
      await done;
      return result;
    } catch (error) {
      try { tx.abort(); } catch { /* The transaction has already ended. */ }
      throw error;
    }
  } finally {
    db.close();
  }
}

function sameAccess(identity: Identity | undefined, expected: Access) {
  return identity?.deviceId === expected.deviceId && identity.familyId === expected.familyId &&
    identity.generation === expected.generation;
}

async function authorization(stores: Stores) {
  const [rawIdentity, rawCatalog] = await Promise.all([
    get<unknown>(stores.identity.get("identity")),
    get<unknown>(stores.authorizedCatalog.get("current")),
  ]);
  const identity = isIdentity(rawIdentity) ? rawIdentity : undefined;
  const catalog = identity && isSnapshot(rawCatalog) && rawCatalog.family.id === identity.familyId ? rawCatalog : undefined;
  return { identity, catalog, invalidIdentity: rawIdentity !== undefined && !identity };
}

export function pairingEpoch() {
  return transact("readonly", async stores => {
    const [state, epoch] = await Promise.all([authorization(stores), get<unknown>(stores.syncMeta.get("epoch"))]);
    if (state.identity || state.invalidIdentity) throw new SyncError("stale");
    return uuid(epoch) ? epoch : undefined;
  });
}

function clearChildData(stores: Stores) {
  return Promise.all(storeNames.map(name => get(stores[name].clear())));
}

export function storeIdentity(reply: PairReply, expectedEpoch: string | undefined, deviceLabel: string) {
  return transact("readwrite", async stores => {
    const [state, epoch] = await Promise.all([authorization(stores), get<unknown>(stores.syncMeta.get("epoch"))]);
    if (state.identity || state.invalidIdentity || (uuid(epoch) ? epoch : undefined) !== expectedEpoch) throw new SyncError("stale");
    await clearChildData(stores);
    const identity: Identity = {
      schemaVersion: 1, deviceId: reply.deviceId, familyId: reply.familyId, familyLabel: reply.familyLabel,
      deviceToken: reply.deviceToken, deviceLabel, pairedAt: new Date().toISOString(), generation: crypto.randomUUID(),
    };
    await get(stores.identity.put(identity, "identity"));
  });
}

export function resetChildData() {
  return transact("readwrite", async stores => {
    await clearChildData(stores);
    await get(stores.syncMeta.put(crypto.randomUUID(), "epoch"));
  });
}

export function beginSync(generation: string) {
  return transact("readwrite", async stores => {
    const [{ identity }, status] = await Promise.all([authorization(stores), syncState(stores)]);
    if (!identity || identity.generation !== generation) return undefined;
    const sequence = (status?.sequence ?? 0) + 1;
    await get(stores.syncMeta.put({ ...status, sequence, lastAttemptAt: new Date().toISOString() }, "status"));
    return { identity, sequence };
  });
}

export function syncFailed(run: SyncRun, code: Failure) {
  return transact("readwrite", async stores => {
    const [{ identity }, status] = await Promise.all([authorization(stores), syncState(stores)]);
    if (!sameAccess(identity, run.identity) || !status) return;
    const deny = code === "auth" && run.sequence >= (status.authorizedAt ?? 0) && run.sequence >= (status.deniedAt ?? 0);
    if (!deny && status.sequence !== run.sequence) return;
    await get(stores.syncMeta.put({ ...status, lastErrorCode: code,
      ...(deny ? { deniedAt: run.sequence } : {}),
    }, "status"));
  });
}

export function storeCatalog(run: SyncRun, value: Catalog) {
  return transact("readwrite", async stores => {
    const [{ identity, catalog }, status] = await Promise.all([authorization(stores), syncState(stores)]);
    if (!sameAccess(identity, run.identity) || value.family.id !== run.identity.familyId) throw new SyncError("stale");
    if ((status?.deniedAt ?? 0) >= run.sequence) throw new SyncError("auth");
    if (status && run.sequence > (status.authorizedAt ?? 0)) {
      await get(stores.syncMeta.put({
        sequence: status.sequence, lastAttemptAt: status.lastAttemptAt, authorizedAt: run.sequence,
      }, "status"));
    }
    // For equal revisions the already committed snapshot wins, even if a response differs.
    if (catalog && value.revision < catalog.revision) return catalog;
    const now = new Date().toISOString();
    const saved: Snapshot = catalog?.revision === value.revision
      ? { ...catalog, lastSuccessfulSyncAt: now }
      : { ...value, receivedAt: now, lastSuccessfulSyncAt: now };
    await get(stores.authorizedCatalog.put(saved, "current"));
    return saved;
  });
}

function matchingBytes(pointer: unknown, stored: unknown, lesson: Lesson): LessonBytes | undefined {
  if (!isInstalled(pointer) || !isLessonBytes(stored) || pointer.lessonId !== lesson.id ||
      stored.lessonId !== lesson.id || stored.versionId !== pointer.installedVersionId || !sameIntegrity(pointer, stored)) return;
  if (stored.versionId === lesson.version.id && !sameIntegrity(stored, lesson.version)) return;
  return stored;
}

async function localBytes(stores: Stores, lesson: Lesson) {
  const pointer: unknown = await get(stores.installations.get(lesson.id));
  if (!isInstalled(pointer)) return { hadPointer: pointer !== undefined };
  const stored: unknown = await get(stores.lessonBytes.get([lesson.id, pointer.installedVersionId]));
  return { hadPointer: true, bytes: matchingBytes(pointer, stored, lesson) };
}

function deviceSummary(identity: Identity | undefined) {
  if (!identity) return undefined;
  return { familyLabel: identity.familyLabel, generation: identity.generation,
    deviceId: identity.deviceId, label: identity.deviceLabel };
}

type Authority = {
  catalog: Snapshot | undefined; device: ReturnType<typeof deviceSummary>; invalidIdentity: boolean;
  serverAccess: { sequence: number; denied: boolean };
};

export async function readLibrary(onAuthority?: (data: Authority) => void) {
  const { authority, local } = await transact("readonly", async stores => {
    const [{ catalog, identity, invalidIdentity }, state] = await Promise.all([authorization(stores), syncState(stores)]);
    const deniedAt = identity ? (state?.deniedAt ?? 0) : 0;
    const authorizedAt = identity ? (state?.authorizedAt ?? 0) : 0;
    const authority: Authority = {
      catalog, device: deviceSummary(identity), invalidIdentity,
      serverAccess: { sequence: Math.max(deniedAt, authorizedAt), denied: deniedAt > 0 && deniedAt >= authorizedAt },
    };
    onAuthority?.(authority);
    const local = await Promise.all((catalog?.lessons ?? []).map(lesson => localBytes(stores, lesson)));
    return { authority, local };
  });
  const installed = new Map<string, { versionId: string }>();
  const missing = new Set<string>();
  let next = 0;
  const inspect = async () => {
    while (next < local.length) {
      const index = next++;
      const entry = local[index];
      if (!entry) continue;
      const { bytes, hadPointer } = entry;
      if (bytes && await verifiesBlob(bytes.blob, bytes)) installed.set(bytes.lessonId, { versionId: bytes.versionId });
      else if (hadPointer) {
        const lesson = authority.catalog?.lessons[index];
        if (lesson) missing.add(lesson.id);
      }
    }
  };
  await Promise.all([inspect(), inspect()]);
  return { ...authority, installed, missing };
}

export function commitLesson(expected: Access, lesson: Lesson, blob: Blob) {
  const now = new Date().toISOString();
  const { id: versionId } = lesson.version;
  const integrity = integrityFields(lesson.version);
  return transact("readwrite", async stores => {
    const [{ identity, catalog }, status] = await Promise.all([authorization(stores), syncState(stores)]);
    const desired = catalog?.lessons.find(item => item.id === lesson.id)?.version;
    if (!sameAccess(identity, expected) || status?.deniedAt || desired?.id !== versionId || !sameIntegrity(desired, integrity)) return false;
    await Promise.all([
      get(stores.lessonBytes.put({ lessonId: lesson.id, versionId, ...integrity, blob, verifiedAt: now })),
      get(stores.installations.put({ lessonId: lesson.id, installedVersionId: versionId, ...integrity, installedAt: now })),
    ]);
    return true;
  });
}

export async function collectObsolete(expected: Access) {
  const scannedAt = Date.now();
  const live = await navigator.locks?.query().catch(() => undefined);
  const held = live ? new Set(live.held?.map(lock => lock.name)) : undefined;
  return transact("readwrite", async stores => {
    const [{ identity, catalog }, pointers, keys, meta] = await Promise.all([
      authorization(stores), get<unknown[]>(stores.installations.getAll()),
      get(stores.lessonBytes.getAllKeys()),
      Promise.all([get(stores.syncMeta.getAllKeys()), get<unknown[]>(stores.syncMeta.getAll())]),
    ]);
    if (!sameAccess(identity, expected) || !catalog) return;
    const authorized = new Set(catalog.lessons.map(lesson => lesson.id));
    const retained = new Set<string>();
    for (const pointer of pointers) {
      if (!isInstalled(pointer)) continue;
      if (authorized.has(pointer.lessonId)) retained.add(`${pointer.lessonId}/${pointer.installedVersionId}`);
      else await get(stores.installations.delete(pointer.lessonId));
    }
    const [metaKeys, metaValues] = meta;
    for (const [index, key] of metaKeys.entries()) {
      if (typeof key !== "string" || !key.startsWith("viewer:")) continue;
      const value = metaValues[index];
      if (!record(value) || value.generation !== expected.generation || value.deviceId !== expected.deviceId ||
          value.familyId !== expected.familyId || !uuid(value.lessonId) || !uuid(value.versionId) ||
          typeof value.pinnedAt !== "number") continue;
      // A suspended context cannot renew a timer. Reclaim only with positive liveness evidence.
      const abandoned = value.pinnedAt < scannedAt && value.locked === true && held && !held.has(key);
      if (abandoned) stores.syncMeta.delete(key);
      else retained.add(`${value.lessonId}/${value.versionId}`);
    }
    for (const key of keys) {
      if (Array.isArray(key) && !retained.has(key.join("/"))) stores.lessonBytes.delete(key);
    }
  });
}

export async function openLesson(lessonId: string, versionId: string, leaseId: string, locked: boolean) {
  const candidate = await transact("readonly", async stores => {
    const { identity, catalog } = await authorization(stores);
    const lesson = catalog?.lessons.find(item => item.id === lessonId);
    if (!identity || !lesson) return;
    const { bytes } = await localBytes(stores, lesson);
    if (bytes?.versionId !== versionId) return;
    return { identity, bytes };
  });
  if (!candidate || !await verifiesBlob(candidate.bytes.blob, candidate.bytes)) return;
  const leased = await transact("readwrite", async stores => {
    const { identity, catalog } = await authorization(stores);
    const lesson = catalog?.lessons.find(item => item.id === lessonId);
    if (!identity || !sameAccess(identity, candidate.identity) || !lesson) return false;
    const { bytes } = await localBytes(stores, lesson);
    if (!bytes || bytes.versionId !== versionId || bytes.verifiedAt !== candidate.bytes.verifiedAt ||
        !sameIntegrity(bytes, candidate.bytes)) return false;
    const { deviceId, familyId, generation } = identity;
    const lease: Lease = { deviceId, familyId, generation, lessonId, versionId, pinnedAt: Date.now(), locked };
    await get(stores.syncMeta.put(lease, leaseKey(leaseId)));
    return true;
  });
  return leased ? candidate.bytes.blob : undefined;
}

export function releaseLesson(leaseId: string) {
  return transact("readwrite", async stores => {
    await get(stores.syncMeta.delete(leaseKey(leaseId)));
  });
}

export function canDownload(expected: Access, lesson: Lesson) {
  return transact("readonly", async stores => {
    const [{ identity, catalog }, status] = await Promise.all([authorization(stores), syncState(stores)]);
    const desired = catalog?.lessons.find(item => item.id === lesson.id)?.version;
    return sameAccess(identity, expected) && !status?.deniedAt && desired?.id === lesson.version.id && sameIntegrity(desired, lesson.version);
  });
}

export function holdViewerLease(leaseId: string) {
  let release: () => void = () => undefined;
  let resolveReady: (locked: boolean) => void = () => undefined;
  const ready = new Promise<boolean>(resolve => { resolveReady = resolve; });
  const lifetime = new Promise<void>(resolve => { release = resolve; });
  if (navigator.locks) {
    void navigator.locks.request(leaseKey(leaseId), () => {
      resolveReady(true);
      return lifetime;
    }).catch(() => resolveReady(false));
  } else {
    resolveReady(false);
  }
  return { ready, release };
}

export function viewerStillAuthorized(leaseId: string) {
  return transact("readonly", async stores => {
    const [{ identity, catalog }, lease] = await Promise.all([
      authorization(stores), get<unknown>(stores.syncMeta.get(leaseKey(leaseId))),
    ]);
    return Boolean(identity && record(lease) && lease.generation === identity.generation && lease.deviceId === identity.deviceId &&
      lease.familyId === identity.familyId && catalog?.lessons.some(item => item.id === lease.lessonId));
  });
}
