import { z } from "npm:zod@4.1.12";

export const maxLessonBytes = 20 * 1024 * 1024;
export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const timestamp = z.iso.datetime({ offset: true });
const requiredLabel = (limit: number) => z.string().trim().min(1).max(limit);
export const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const bytes = z.number().int().min(1).max(maxLessonBytes);
const grade = z.number().int().min(1).max(8).nullable();
const visibility = z.enum(["selected", "all"]);
const familyIds = z.array(uuid).max(1000).refine((ids) => new Set(ids).size === ids.length);
const fields = {
  subjectId: uuid,
  title: requiredLabel(120),
  description: z.string().max(500).nullable().optional(),
  grade: grade.optional(),
  visibility: visibility.optional(),
  familyIds: familyIds.optional(),
};
const subject = z.strictObject({
  slug: z.string().regex(/^[a-z0-9-]{2,50}$/),
  namePl: requiredLabel(60),
  sortOrder: z.number().int().min(-2147483648).max(2147483647),
});
export const createSubject = subject;
export const editSubject = subject.extend({ archived: z.boolean() }).partial().refine((value) => Object.keys(value).length > 0);
export const createLesson = z.strictObject(fields);
export const editLesson = z.strictObject(fields).partial().extend({
  expectedUpdatedAt: timestamp.optional(),
}).refine((value) => Object.keys(value).some((key) => key !== "expectedUpdatedAt"));
export const lessonQuery = z.strictObject({
  subjectId: uuid.optional(),
  status: z.enum(["draft", "published", "unpublished"]).optional(),
  q: requiredLabel(120).optional(),
});
export const uploadInit = z.strictObject({
  filename: z.string().min(6).max(255).regex(/\.html$/i).refine((name) =>
    !name.includes("/") && !name.includes("\\") && [...name].every((character) => character.charCodeAt(0) >= 32)),
  sha256,
  sizeBytes: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  contentType: z.literal("text/html"),
});
export const uploadFinalize = z.strictObject({ uploadId: uuid });
export const publish = z.strictObject({ versionId: uuid, expectedUpdatedAt: timestamp });
export const unpublish = z.strictObject({ expectedUpdatedAt: timestamp.optional() });
export const createFamily = z.strictObject({ label: requiredLabel(80) });
export const empty = z.strictObject({});
export const pairRequest = z.strictObject({
  pairingCode: z.string().trim().toUpperCase().regex(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/),
  deviceLabel: requiredLabel(80).optional(),
});
export const downloadRequest = z.strictObject({ lessonId: uuid, versionId: uuid });
export const grantDescriptor = z.strictObject({
  path: z.string(),
  sha256,
  sizeBytes: bytes,
});
