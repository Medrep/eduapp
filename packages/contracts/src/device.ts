export const maxLessonBytes = 20 * 1024 * 1024;
export const pairingCodePattern = /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;

export type Integrity = { sha256: string; sizeBytes: number };
export type Version = Integrity & { id: string; number: number };
export type Lesson = {
  id: string; subjectId: string; title: string; description: string | null; grade: number | null;
  publishedAt: string; version: Version;
};
export type Subject = { id: string; slug: string; namePl: string; sortOrder: number };
export type Catalog = {
  schemaVersion: 1; revision: number; generatedAt: string;
  family: { id: string; label: string }; subjects: Subject[]; lessons: Lesson[];
};
export type Snapshot = Catalog & { receivedAt: string; lastSuccessfulSyncAt: string };
export type PairReply = { deviceId: string; familyId: string; familyLabel: string; deviceToken: string; serverTime: string };
export type Identity = Omit<PairReply, "serverTime"> & { schemaVersion: 1; pairedAt: string; generation: string; deviceLabel?: string };
export type Installed = Integrity & { lessonId: string; installedVersionId: string; installedAt: string };
export type LessonBytes = Integrity & { lessonId: string; versionId: string; blob: Blob; verifiedAt: string };
export type OfflineStatus = "ready_latest" | "ready_old_version" | "downloading" | "not_downloaded" | "failed" | "storage_missing";

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fields(value: Record<string, unknown>, required: string[]) {
  return Object.keys(value).length === required.length && required.every(key => Object.hasOwn(value, key));
}

export function uuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

export function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

export function timestamp(value: unknown): value is string {
  if (typeof value !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
      !Number.isFinite(Date.parse(value))) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= (monthDays[month - 1] ?? 0) && Number(value.slice(11, 13)) < 24;
}

function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

export function hasIntegrity(value: unknown): value is Record<string, unknown> & Integrity {
  return record(value) && typeof value.sha256 === "string" && /^[0-9a-f]{64}$/.test(value.sha256) &&
    integer(value.sizeBytes, 1, maxLessonBytes);
}

export function sameIntegrity(first: Integrity, second: Integrity) {
  return first.sha256 === second.sha256 && first.sizeBytes === second.sizeBytes;
}

function version(value: unknown): value is Version {
  return record(value) && fields(value, ["id", "number", "sha256", "sizeBytes"]) &&
    uuid(value.id) && integer(value.number, 1) && hasIntegrity(value);
}

function lesson(value: unknown): value is Lesson {
  return record(value) && fields(value, ["id", "subjectId", "title", "description", "grade", "publishedAt", "version"]) &&
    uuid(value.id) && uuid(value.subjectId) && boundedText(value.title, 120) &&
    (value.description === null || (typeof value.description === "string" && value.description.length <= 500)) &&
    (value.grade === null || integer(value.grade, 1, 8)) && timestamp(value.publishedAt) && version(value.version);
}

function subject(value: unknown): value is Subject {
  return record(value) && fields(value, ["id", "slug", "namePl", "sortOrder"]) && uuid(value.id) && typeof value.slug === "string" && /^[a-z0-9-]{2,50}$/.test(value.slug) &&
    boundedText(value.namePl, 60) && integer(value.sortOrder, -2147483648, 2147483647);
}

const catalogFields = ["schemaVersion", "revision", "generatedAt", "family", "subjects", "lessons"];

function catalogShape(value: unknown, local: boolean): value is Catalog {
  if (!record(value) || !fields(value, local ? [...catalogFields, "receivedAt", "lastSuccessfulSyncAt"] : catalogFields) ||
      value.schemaVersion !== 1 || !integer(value.revision, 0) || !timestamp(value.generatedAt) ||
      !record(value.family) || !fields(value.family, ["id", "label"]) || !uuid(value.family.id) || !boundedText(value.family.label, 80) ||
      !Array.isArray(value.subjects) || !value.subjects.every(subject) ||
      !Array.isArray(value.lessons) || !value.lessons.every(lesson)) return false;
  const subjects = new Set(value.subjects.map(entry => entry.id));
  return subjects.size === value.subjects.length &&
    new Set(value.subjects.map(entry => entry.slug)).size === subjects.size &&
    new Set(value.lessons.map(entry => entry.id)).size === value.lessons.length &&
    new Set(value.lessons.map(entry => entry.version.id)).size === value.lessons.length &&
    value.lessons.every(entry => subjects.has(entry.subjectId));
}

export function isCatalog(value: unknown): value is Catalog {
  return catalogShape(value, false);
}

export function isSnapshot(value: unknown): value is Snapshot {
  return record(value) && timestamp(value.receivedAt) && timestamp(value.lastSuccessfulSyncAt) && catalogShape(value, true);
}

function credentials(value: Record<string, unknown>) {
  return uuid(value.deviceId) && uuid(value.familyId) && boundedText(value.familyLabel, 80) &&
    typeof value.deviceToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(value.deviceToken);
}

export function isPairReply(value: unknown): value is PairReply {
  return record(value) && credentials(value) && timestamp(value.serverTime);
}

export function isIdentity(value: unknown): value is Identity {
  return record(value) && value.schemaVersion === 1 && credentials(value) &&
    timestamp(value.pairedAt) && uuid(value.generation) &&
    (value.deviceLabel === undefined || boundedText(value.deviceLabel, 80));
}

export function isInstalled(value: unknown): value is Installed {
  return record(value) && uuid(value.lessonId) && uuid(value.installedVersionId) &&
    timestamp(value.installedAt) && hasIntegrity(value) &&
    (value.lastOpenedAt === undefined || timestamp(value.lastOpenedAt));
}

export function isLessonBytes(value: unknown): value is LessonBytes {
  return record(value) && uuid(value.lessonId) && uuid(value.versionId) && timestamp(value.verifiedAt) &&
    value.blob instanceof Blob && hasIntegrity(value) && value.blob.size === value.sizeBytes;
}

export function integrityFields(value: Integrity): Integrity {
  return { sha256: value.sha256, sizeBytes: value.sizeBytes };
}
