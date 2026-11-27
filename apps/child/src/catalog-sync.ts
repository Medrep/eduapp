import { type Lesson, type Snapshot } from "../../../packages/contracts/src/device.ts";
import {
  beginSync, canDownload, collectObsolete, commitLesson, readLibrary, storeCatalog, syncFailed, type SyncRun,
} from "./catalog-store.ts";
import { failure, fetchLesson, loadCatalog, SyncError, type Failure } from "./device-api.ts";

export type Library = Awaited<ReturnType<typeof readLibrary>>;
export type Download = "downloading" | Failure;

type Progress = {
  catalog: (generation: string, value: Snapshot) => void;
  library: (value: Library) => void;
  item: (lessonId: string, value?: Download) => void;
  installed: (generation: string, lesson: Lesson) => void;
  changed: () => void;
};

function backoff(delay: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delay);
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function retry<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (const delay of [0, 250, 1_000]) {
    if (delay) await backoff(delay, signal);
    signal.throwIfAborted();
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof SyncError && error.retry) || delay === 1_000) throw error;
    }
  }
  throw new SyncError("network");
}

export async function synchronize(generation: string, progress: Progress, signal: AbortSignal) {
  const run = await beginSync(generation);
  if (!run) return;
  const { identity } = run;
  try {
    const catalog = await retry(() => loadCatalog(identity, signal), signal);
    signal.throwIfAborted();
    const saved = await storeCatalog(run, catalog);
    progress.catalog(identity.generation, saved);
    progress.changed();
    await syncLessons(progress, signal, run);
  } catch (error) {
    if (!signal.aborted) {
      await syncFailed(run, failure(error));
      progress.changed();
    }
    throw error;
  }
}

async function syncLessons(progress: Progress, signal: AbortSignal, run: SyncRun) {
  const { identity } = run;
  const library = await readLibrary();
  signal.throwIfAborted();
  if (library.device?.generation !== identity.generation) return;
  progress.library(library);
  const queue = (library.catalog?.lessons ?? [])
    .filter(lesson => library.installed.get(lesson.id)?.versionId !== lesson.version.id);
  await collectObsolete(identity);
  let index = 0;
  let denied = false;
  const pending = new AbortController();
  const downloading = AbortSignal.any([signal, pending.signal]);

  async function worker() {
    while (index < queue.length && !signal.aborted && !denied) {
      const lesson = queue[index++];
      if (!lesson) continue;
      progress.item(lesson.id, "downloading");
      try {
        const blob = await retry(async () => {
          if (denied || !await canDownload(identity, lesson)) throw new SyncError("stale");
          return fetchLesson(identity, lesson, downloading);
        }, downloading);
        if (signal.aborted || denied) return;
        if (await commitLesson(identity, lesson, blob)) {
          progress.installed(identity.generation, lesson);
          progress.changed();
          await collectObsolete(identity);
        }
        progress.item(lesson.id);
      } catch (error) {
        if (signal.aborted) return;
        const code = failure(error);
        progress.item(lesson.id, code === "stale" || denied ? undefined : code);
        if (code === "auth") {
          denied = true;
          pending.abort();
          await syncFailed(run, code);
        }
      }
    }
  }

  await Promise.all([worker(), worker()]);
  if (denied) throw new SyncError("auth");
}
