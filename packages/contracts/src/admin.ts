import { boundedText, hasIntegrity, pairingCodePattern, record, timestamp, uuid, type Integrity } from "./device.ts";

export type AdminSubject = { id: string; slug: string; namePl: string; sortOrder: number; archivedAt: string | null };
export type SubjectInput = Pick<AdminSubject, "slug" | "namePl" | "sortOrder">;
export type Family = { id: string; label: string; enabled: boolean; createdAt: string };
export type Device = { id: string; familyId: string; label: string; lastSeenAt: string | null; revokedAt: string | null };
export type Visibility = "selected" | "all";
export type LessonInput = {
  subjectId: string; title: string; description: string | null; grade: number | null;
  visibility: Visibility; familyIds: string[];
};
export type AdminLesson = LessonInput & {
  id: string; status: "draft" | "published" | "unpublished"; activeVersionId: string | null;
  publishedAt: string | null; createdAt: string; updatedAt: string;
};
export type AdminVersion = Integrity & {
  id: string; versionNumber: number; validationReport: { valid: true; checked: string[] }; createdAt: string;
};
export type PairingCode = { code: string; expiresAt: string };

export function isAdminSubject(value: unknown): value is AdminSubject {
  return record(value) && uuid(value.id) && typeof value.slug === "string" && /^[a-z0-9-]{2,50}$/.test(value.slug) &&
    boundedText(value.namePl, 60) && typeof value.sortOrder === "number" && Number.isInteger(value.sortOrder) &&
    value.sortOrder >= -2147483648 && value.sortOrder <= 2147483647 && nullableTimestamp(value.archivedAt);
}

function nullableTimestamp(value: unknown) {
  return value === null || timestamp(value);
}

export function isFamily(value: unknown): value is Family {
  return record(value) && uuid(value.id) && boundedText(value.label, 80) && typeof value.enabled === "boolean" &&
    timestamp(value.createdAt);
}

export function isDevice(value: unknown): value is Device {
  return record(value) && uuid(value.id) && uuid(value.familyId) && boundedText(value.label, 80) &&
    nullableTimestamp(value.lastSeenAt) && nullableTimestamp(value.revokedAt);
}

export function isAdminLesson(value: unknown): value is AdminLesson {
  return record(value) && uuid(value.id) && uuid(value.subjectId) && boundedText(value.title, 120) &&
    (value.description === null || (typeof value.description === "string" && value.description.length <= 500)) &&
    (value.grade === null || (typeof value.grade === "number" && Number.isInteger(value.grade) && value.grade >= 1 && value.grade <= 8)) &&
    (value.visibility === "selected" || value.visibility === "all") &&
    (value.status === "draft" || value.status === "published" || value.status === "unpublished") &&
    (value.activeVersionId === null || uuid(value.activeVersionId)) && nullableTimestamp(value.publishedAt) &&
    (value.status !== "published" || (value.activeVersionId !== null && value.publishedAt !== null)) &&
    timestamp(value.createdAt) && timestamp(value.updatedAt) && Array.isArray(value.familyIds) && value.familyIds.every(uuid) &&
    new Set(value.familyIds).size === value.familyIds.length;
}

export function isAdminVersion(value: unknown): value is AdminVersion {
  return hasIntegrity(value) && uuid(value.id) && typeof value.versionNumber === "number" &&
    Number.isSafeInteger(value.versionNumber) && value.versionNumber > 0 && timestamp(value.createdAt) &&
    record(value.validationReport) && value.validationReport.valid === true && Array.isArray(value.validationReport.checked) &&
    value.validationReport.checked.every(entry => boundedText(entry, 80));
}

export function isPairingCode(value: unknown): value is PairingCode {
  return record(value) && typeof value.code === "string" && pairingCodePattern.test(value.code) && timestamp(value.expiresAt);
}
