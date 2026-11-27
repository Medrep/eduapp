import assert from "node:assert/strict";
import { test } from "node:test";
import { isCatalog, isIdentity, isLessonBytes, maxLessonBytes, timestamp } from "./device.ts";

const id = "9fdd4a77-ff54-4f1b-825b-6102451dcdba";
const versionId = "fa1467c2-fe4d-418f-97ce-bfca70165956";
const generatedAt = "2024-02-29T01:02:03.999Z";
const sha256 = "1".repeat(64);
const version = { id: versionId, number: 1, sha256, sizeBytes: maxLessonBytes };
const subject = { id, slug: "historia", namePl: "Historia", sortOrder: -1 };
const lesson = { id, subjectId: id, title: "Lekcja", description: null, grade: 4, publishedAt: generatedAt, version };
const catalog = { schemaVersion: 1, revision: 0, generatedAt, family: { id, label: "Dom" }, subjects: [subject], lessons: [lesson] };

test("catalog exact major, integrity bounds, UUIDs and subject relation", () => {
  assert.equal(isCatalog(catalog), true);
  for (const invalid of [
    { ...catalog, schemaVersion: 2 },
    { ...catalog, revision: -1 },
    { ...catalog, deviceToken: "synthetic-forbidden-extra" },
    { ...catalog, lessons: [{ ...lesson, version: { ...version, signedUrl: "synthetic-forbidden-extra" } }] },
    { ...catalog, lessons: [{ ...lesson, storagePath: "synthetic-forbidden-extra" }] },
    { ...catalog, lessons: [lesson, lesson] },
    { ...catalog, subjects: [subject, subject] },
    { ...catalog, subjects: [] },
    { ...catalog, lessons: [{ ...lesson, grade: 9 }] },
    { ...catalog, lessons: [{ ...lesson, version: { ...version, sha256: "A".repeat(64) } }] },
    { ...catalog, lessons: [{ ...lesson, version: { ...version, sizeBytes: maxLessonBytes + 1 } }] },
    { ...catalog, lessons: [{ ...lesson, version: { ...version, id: "not-a-uuid" } }] },
  ]) assert.equal(isCatalog(invalid), false);
});

test("strict dates reject date rollover and ambiguous local timestamps", () => {
  assert.equal(timestamp(generatedAt), true);
  assert.equal(timestamp("2026-11-25T23:58:01+01:00"), true);
  for (const value of [
    "2026-02-29T01:02:03Z", "2026-04-31T01:02:03Z", "2025-01-01T24:00:00Z",
    "2026-11-25T12:00:00", "2026-11-25T12:00:00+26:00", "2026-13-25T12:00:00Z",
  ]) assert.equal(timestamp(value), false);
});

test("runtime records reject incorrect pairing generation and inconsistent Blob size", () => {
  const identity = { schemaVersion: 1, deviceId: id, familyId: id, familyLabel: "Dom",
    deviceToken: "A".repeat(43), pairedAt: generatedAt, generation: versionId };
  assert.equal(isIdentity(identity), true);
  assert.equal(isIdentity({ ...identity, generation: undefined }), false);
  assert.equal(isIdentity({ ...identity, deviceToken: "abc" }), false);
  const bytes = { lessonId: id, versionId, sha256, sizeBytes: 1, blob: new Blob(["a"]), verifiedAt: generatedAt };
  assert.equal(isLessonBytes(bytes), true);
  assert.equal(isLessonBytes({ ...bytes, blob: new Blob(["two"]) }), false);
});
