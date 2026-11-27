import {
  isAdminLesson, isAdminSubject, isAdminVersion, isDevice, isFamily, isPairingCode,
  type AdminLesson, type AdminVersion, type LessonInput, type SubjectInput,
} from "../../../packages/contracts/src/admin.ts";
import { boundedText, hasIntegrity, maxLessonBytes, record, sameIntegrity, timestamp, uuid } from "../../../packages/contracts/src/device.ts";
import { blobSha256, signedLessonDownload, signedStageUpload, verifiedHtmlResponse } from "../../../packages/contracts/src/storage-transfer.ts";

declare const __SUPABASE_ORIGIN__: string | null;
declare const __ADMIN_PUBLISHABLE_KEY__: string | null;

export function adminBackendConfigured() {
  return __SUPABASE_ORIGIN__ !== null && __ADMIN_PUBLISHABLE_KEY__ !== null;
}

export class AdminError extends Error {
  readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? ({
      400: "Sprawdź wprowadzone dane i spróbuj ponownie.",
      401: "Sesja wygasła. Zaloguj się ponownie.",
      403: "Brak uprawnień.",
      404: "Ten element jest już niedostępny. Odśwież listę.",
      409: "Dane zmieniły się w międzyczasie lub już istnieją. Odśwież listę i spróbuj ponownie.",
      413: "Plik HTML może mieć najwyżej 20 MiB.",
      422: "Plik nie przeszedł walidacji.",
      429: "Za dużo prób. Zaczekaj chwilę i spróbuj ponownie.",
    }[status] ?? "Nie udało się wykonać operacji. Spróbuj ponownie."));
    this.status = status;
  }
}

type Session = { token: string; expiresAt: number; controller: AbortController };
type Guard<T> = (value: unknown) => value is T;
const jwt = /^[\w-]+\.[\w-]+\.[\w-]+$/;

function read<T>(value: unknown, guard: Guard<T>): T {
  if (!guard(value)) throw new AdminError(503, "Serwer zwrócił nieprawidłowe dane.");
  return value;
}

function item<T>(value: unknown, key: string, guard: Guard<T>): T {
  return read(record(value) ? value[key] : undefined, guard);
}

function list<T>(value: unknown, key: string, guard: Guard<T>): T[] {
  return item(value, key, (candidate): candidate is T[] => Array.isArray(candidate) && candidate.every(guard));
}

async function fetchSafely(url: string | URL, signal: AbortSignal, init?: RequestInit) {
  try {
    return await fetch(url, { ...init, cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal });
  } catch {
    throw new AdminError(503, "Nie udało się połączyć z serwerem. Sprawdź połączenie i spróbuj ponownie.");
  }
}

async function responseData(response: Response): Promise<unknown> {
  const value: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const detail = response.status === 422 && record(value) && record(value.error) && boundedText(value.error.message, 300)
      ? value.error.message : undefined;
    throw new AdminError(response.status, detail);
  }
  return value;
}

export async function signIn(email: string, password: string): Promise<Session> {
  const response = await fetchSafely(`${__SUPABASE_ORIGIN__}/auth/v1/token?grant_type=password`, AbortSignal.timeout(15_000), {
    method: "POST",
    headers: { apikey: __ADMIN_PUBLISHABLE_KEY__!, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (response.status === 400 || response.status === 401) throw new AdminError(401, "Sprawdź adres e-mail i hasło.");
  const value = await responseData(response);
  if (!record(value) || typeof value.access_token !== "string" || value.access_token.length > 8192 ||
      !jwt.test(value.access_token) || typeof value.expires_at !== "number" ||
      !Number.isSafeInteger(value.expires_at) || value.expires_at <= Date.now() / 1000) {
    throw new AdminError(503, "Serwer nie zwrócił prawidłowej sesji.");
  }
  return { token: value.access_token, expiresAt: value.expires_at * 1000, controller: new AbortController() };
}

export async function signOut(session: Session) {
  session.controller.abort();
  const response = await fetchSafely(`${__SUPABASE_ORIGIN__}/auth/v1/logout?scope=local`, AbortSignal.timeout(10_000), {
    method: "POST",
    headers: { apikey: __ADMIN_PUBLISHABLE_KEY__!, Authorization: `Bearer ${session.token}` },
  });
  if (!response.ok && ![401, 403, 404].includes(response.status)) {
    throw new AdminError(503, "Sesja w tym panelu została zamknięta. Serwer nie potwierdził wylogowania.");
  }
}

type Upload = { id: string; file: File; sha256: string };

export function adminApi(session: Session) {
  const origin = __SUPABASE_ORIGIN__!;
  const root = `${origin}/functions/v1/admin-api/admin/v1/`;
  const limit = (milliseconds: number) => AbortSignal.any([session.controller.signal, AbortSignal.timeout(milliseconds)]);

  async function request(path: string, method = "GET", payload?: object) {
    if (session.expiresAt <= Date.now()) throw new AdminError(401);
    const headers = new Headers({ Authorization: `Bearer ${session.token}` });
    if (payload) headers.set("Content-Type", "application/json");
    return responseData(await fetchSafely(root + path, limit(method === "GET" ? 15_000 : 60_000), {
      method, headers, ...(payload ? { body: JSON.stringify(payload) } : {}),
    }));
  }

  return {
    subjects: async () => list(await request("subjects"), "subjects", isAdminSubject),
    createSubject: async (input: SubjectInput) => item(await request("subjects", "POST", input), "subject", isAdminSubject),
    saveSubject: async (id: string, input: Partial<Pick<SubjectInput, "namePl" | "sortOrder">> & { archived?: boolean }) =>
      item(await request(`subjects/${id}`, "PATCH", input), "subject", isAdminSubject),
    lessons: async () => list(await request("lessons"), "lessons", isAdminLesson),
    createLesson: async (input: LessonInput) => item(await request("lessons", "POST", input), "lesson", isAdminLesson),
    saveLesson: async (lesson: AdminLesson, input: LessonInput) => item(await request(`lessons/${lesson.id}`, "PATCH",
      { ...input, expectedUpdatedAt: lesson.updatedAt }), "lesson", isAdminLesson),
    families: async () => list(await request("families"), "families", isFamily),
    createFamily: async (label: string) => item(await request("families", "POST", { label }), "family", isFamily),
    devices: async () => list(await request("devices"), "devices", isDevice),
    revoke: async (id: string) => item(await request(`devices/${id}/revoke`, "POST", {}), "device", isDevice),
    issueCode: async (id: string) => read(await request(`families/${id}/pairing-codes`, "POST", {}), isPairingCode),
    versions: async (id: string) => list(await request(`lessons/${id}/versions`), "versions", isAdminVersion),
    publish: async (lesson: AdminLesson, versionId: string) => item(await request(`lessons/${lesson.id}/publish`, "POST",
      { versionId, expectedUpdatedAt: lesson.updatedAt }), "lesson", isAdminLesson),
    unpublish: async (lesson: AdminLesson) => item(await request(`lessons/${lesson.id}/unpublish`, "POST",
      { expectedUpdatedAt: lesson.updatedAt }), "lesson", isAdminLesson),

    async stageUpload(lessonId: string, file: File, stageChanged: (stage: "hashing" | "putting") => void): Promise<Upload> {
      if (file.name.length < 6 || file.name.length > 255 || !file.name.toLowerCase().endsWith(".html") ||
          file.name.includes("/") || file.name.includes("\\") || [...file.name].some(character => character.charCodeAt(0) < 32) ||
          (file.type && file.type !== "text/html")) {
        throw new AdminError(400, "Wybierz jeden plik z rozszerzeniem .html.");
      }
      if (file.size === 0) throw new AdminError(400, "Plik HTML jest pusty.");
      if (file.size > maxLessonBytes) throw new AdminError(413);
      stageChanged("hashing");
      const sha256 = await blobSha256(file);
      const grant = await request(`lessons/${lessonId}/upload-init`, "POST", {
        filename: file.name, sha256, sizeBytes: file.size, contentType: "text/html",
      });
      if (!record(grant) || !uuid(grant.uploadId) || !timestamp(grant.expiresAt) || Date.parse(grant.expiresAt) <= Date.now()) {
        throw new AdminError(503, "Brak ważnego adresu przesyłania pliku.");
      }
      const url = signedStageUpload(grant.uploadUrl, origin, grant.uploadId);
      if (!url) throw new AdminError(503, "Serwer zwrócił nieprawidłowy adres przesyłania pliku.");
      stageChanged("putting");
      const response = await fetchSafely(url, limit(120_000), {
        method: "PUT", headers: { "Content-Type": "text/html" }, body: file,
      });
      void response.body?.cancel().catch(() => undefined);
      if (!response.ok) throw new AdminError(503, "Nie udało się przesłać pliku. Spróbuj ponownie.");
      return { id: grant.uploadId, file, sha256 };
    },

    async finalizeUpload(lessonId: string, upload: Upload) {
      const version = item(await request(`lessons/${lessonId}/upload-finalize`, "POST", { uploadId: upload.id }), "version", isAdminVersion);
      if (version.id !== upload.id || !sameIntegrity(version, { sha256: upload.sha256, sizeBytes: upload.file.size })) {
        throw new AdminError(503, "Suma kontrolna zapisanej wersji jest niezgodna z plikiem.");
      }
      return version;
    },

    async downloadVersion(lessonId: string, version: AdminVersion) {
      const grant = await request(`lessons/${lessonId}/versions/${version.id}/download-url`, "POST", {});
      if (!hasIntegrity(grant) || !sameIntegrity(grant, version) || !timestamp(grant.expiresAt) ||
          Date.parse(grant.expiresAt) <= Date.now()) {
        throw new AdminError(503, "Nie można potwierdzić autoryzacji i sumy kontrolnej podglądu.");
      }
      const url = signedLessonDownload(grant.signedUrl, origin, lessonId, version.id);
      if (!url) throw new AdminError(503, "Serwer zwrócił nieprawidłowy adres podglądu.");
      const signal = limit(60_000);
      const response = await fetchSafely(url, signal);
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw new AdminError(503, "Nie udało się pobrać pliku podglądu. Spróbuj ponownie.");
      }
      const blob = await verifiedHtmlResponse(response, version, signal).catch(() => undefined);
      if (!blob) throw new AdminError(503, "Nie można potwierdzić sumy kontrolnej pobranego pliku.");
      return blob;
    },
  };
}

export type AdminApi = ReturnType<typeof adminApi>;
export type { Session, Upload };
