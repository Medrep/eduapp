import { useCallback, useEffect, useRef, useState } from "react";
import { pairingCodePattern, sameIntegrity } from "../../../packages/contracts/src/device.ts";
import { pairingEpoch, readLibrary, resetChildData, storeIdentity } from "./catalog-store.ts";
import { synchronize, type Download, type Library } from "./catalog-sync.ts";
import { failure, pairDevice, SyncError, type Failure } from "./device-api.ts";

type StorageInfo = { persisted?: boolean; estimate?: StorageEstimate };

async function storageInfo(requestPersistence: boolean): Promise<StorageInfo> {
  const storage = navigator.storage;
  const method = requestPersistence ? storage?.persist : storage?.persisted;
  const [persisted, estimate] = await Promise.all([
    (method?.call(storage) ?? Promise.resolve(undefined)).catch(() => undefined),
    (storage?.estimate?.() ?? Promise.resolve(undefined)).catch(() => undefined),
  ]);
  return { ...(persisted === undefined ? {} : { persisted }), ...(estimate ? { estimate } : {}) };
}

export function useLibrary() {
  const [library, setLibrary] = useState<Library>();
  const [error, setError] = useState<Failure>();
  const [items, setItems] = useState(new Map<string, Download>());
  const [working, setWorking] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [storage, setStorage] = useState<StorageInfo>({});
  const signal = useRef<BroadcastChannel | null>(null);
  const active = useRef<AbortController | null>(null);
  const pairingTask = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const current = useRef<Library | undefined>(undefined);
  const everPaired = useRef(false);

  const accept = useCallback((data: Library) => {
    const previous = current.current;
    if (data.device?.generation === previous?.device?.generation &&
        data.catalog && previous?.catalog && data.catalog.revision < previous.catalog.revision) return;
    if (data.device) everPaired.current = true;
    let next = data;
    if (previous?.device?.generation !== data.device?.generation) {
      active.current?.abort();
      active.current = null;
      setWorking(false);
      setError(undefined);
      setItems(new Map());
    } else if (previous) {
      const { serverAccess } = previous;
      const observed = data.serverAccess;
      if (serverAccess.sequence > observed.sequence ||
          (serverAccess.sequence === observed.sequence && serverAccess.denied && !observed.denied)) {
        next = { ...data, serverAccess };
      }
    }
    current.current = next;
    setLibrary(next);
  }, []);

  const acceptAuthority = useCallback((data: Pick<Library, "device" | "catalog" | "invalidIdentity" | "serverAccess">) => {
    const previous = current.current;
    const sameDevice = previous?.device?.generation === data.device?.generation;
    const installed = new Map<string, { versionId: string }>();
    if (sameDevice && previous) {
      const desired = new Map(previous.catalog?.lessons.map(entry => [entry.id, entry.version]));
      for (const lesson of data.catalog?.lessons ?? []) {
        const local = previous.installed.get(lesson.id);
        const before = desired.get(lesson.id);
        if (local && (before?.id !== lesson.version.id || sameIntegrity(before, lesson.version))) installed.set(lesson.id, local);
      }
    }
    accept({ ...data, installed, missing: sameDevice && previous ? previous.missing : new Set() });
  }, [accept]);

  const refresh = useCallback(async () => {
    const reading = ++revision.current;
    try {
      const data = await readLibrary(authority => { if (reading === revision.current) acceptAuthority(authority); });
      if (reading === revision.current) accept(data);
    } catch (cause) {
      if (reading === revision.current) setError(failure(cause));
    }
  }, [accept, acceptAuthority]);

  const changed = useCallback(() => signal.current?.postMessage("library-changed"), []);

  const sync = useCallback(async (manual = false) => {
    const generation = current.current?.device?.generation;
    if (active.current || !generation || (!manual && !navigator.onLine)) return;
    const task = new AbortController();
    active.current = task;
    const isCurrent = () => !task.signal.aborted && current.current?.device?.generation === generation;
    setWorking(true);
    setError(undefined);
    setItems(new Map());
    try {
      await synchronize(generation, {
        changed,
        catalog: (observedGeneration, catalog) => {
          const data = current.current;
          if (!isCurrent() || !data || observedGeneration !== generation ||
              (data.catalog?.revision ?? 0) > catalog.revision) return;
          setOnline(true);
          acceptAuthority({ ...data, catalog });
        },
        library: data => { if (isCurrent() && data.device?.generation === generation) accept(data); },
        item: (id, status) => {
          if (!isCurrent()) return;
          setItems(previous => {
            const next = new Map(previous);
            if (status) next.set(id, status);
            else next.delete(id);
            return next;
          });
        },
        installed: (observedGeneration, lesson) => {
          const currentLibrary = current.current;
          if (!isCurrent() || !currentLibrary || observedGeneration !== generation ||
              currentLibrary.catalog?.lessons.find(entry => entry.id === lesson.id)?.version.id !== lesson.version.id) return;
          const installed = new Map(currentLibrary.installed);
          const missing = new Set(currentLibrary.missing);
          installed.set(lesson.id, { versionId: lesson.version.id });
          missing.delete(lesson.id);
          accept({ ...currentLibrary, installed, missing });
        },
      }, task.signal);
    } catch (cause) {
      const code = failure(cause);
      if (isCurrent() && code !== "auth") setError(code);
    } finally {
      if (active.current === task) {
        active.current = null;
        setWorking(false);
        if (!task.signal.aborted) void refresh();
      }
    }
  }, [accept, acceptAuthority, changed, refresh]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let notice: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { void refresh().then(() => sync()); }, 150);
    };
    const connection = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) schedule();
      else void refresh();
    };
    const visibility = () => { if (document.visibilityState === "visible") schedule(); };
    const refreshOnly = () => {
      clearTimeout(notice);
      notice = setTimeout(() => { void refresh(); }, 60);
    };
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("mojanauka-library");
    signal.current = channel;
    channel?.addEventListener("message", refreshOnly);
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    window.addEventListener("pageshow", visibility);
    document.addEventListener("visibilitychange", visibility);
    const check = setInterval(() => {
      if (document.visibilityState === "visible" && !active.current && current.current?.device) void refresh();
    }, 30_000);
    schedule();
    void storageInfo(false).then(setStorage);
    return () => {
      clearTimeout(timer);
      clearTimeout(notice);
      clearInterval(check);
      channel?.close();
      signal.current = null;
      active.current?.abort();
      pairingTask.current?.abort();
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
      window.removeEventListener("pageshow", visibility);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [refresh, sync]);

  async function pair(code: string, label: string) {
    if (!navigator.onLine || pairingTask.current) return;
    const normalized = code.trim().toUpperCase();
    setError(undefined);
    if (!pairingCodePattern.test(normalized)) { setError("pair"); return; }
    const task = new AbortController();
    pairingTask.current = task;
    setPairing(true);
    void storageInfo(true).then(setStorage);
    try {
      const epoch = await pairingEpoch();
      const deviceLabel = label.trim() || "Mój tablet";
      if (deviceLabel.length > 80) throw new SyncError("pair");
      const reply = await pairDevice(normalized, deviceLabel, task.signal);
      task.signal.throwIfAborted();
      await storeIdentity(reply, epoch, deviceLabel);
      changed();
      await refresh();
      await sync();
    } catch (cause) {
      if (!task.signal.aborted) setError(failure(cause));
    } finally {
      if (pairingTask.current === task) {
        pairingTask.current = null;
        setPairing(false);
      }
    }
  }

  async function reset() {
    active.current?.abort();
    pairingTask.current?.abort();
    active.current = null;
    pairingTask.current = null;
    setWorking(false);
    setPairing(false);
    setError(undefined);
    ++revision.current;
    try {
      await resetChildData();
      everPaired.current = false;
      changed();
      await refresh();
      return true;
    } catch (cause) {
      setError(failure(cause));
      return false;
    }
  }

  return { library, error: library?.serverAccess.denied ? "auth" as const : error, items, working, pairing, online, storage, everPaired: everPaired.current, pair, reset, sync, refresh };
}
