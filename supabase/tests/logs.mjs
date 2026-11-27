/* global console, process */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const logPath = process.argv[2];
assert.ok(logPath, "Supply the private local Edge serve log to verify.");
const raw = await readFile(logPath, "utf8");
const allowedKeys = new Set(["requestId", "gateway", "endpoint", "status", "errorCode", "durationMs", "uploadSizeBucket"]);
const stableEndpoints = {
  admin: new Set([
    "subjects.list", "subjects.create", "subjects.update", "lessons.list", "lessons.create", "lessons.update",
    "lessons.publish", "lessons.unpublish", "uploads.init", "uploads.finalize", "versions.list",
    "versions.download-url", "families.list", "families.create", "pairing-codes.create",
    "devices.list", "devices.revoke", "unmatched",
  ]),
  device: new Set(["pair", "catalog", "download-url", "unmatched"]),
};
const errorCodes = new Set([
  "INVALID_REQUEST", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "METHOD_NOT_ALLOWED", "CONFLICT",
  "TOO_LARGE", "INVALID_LESSON", "RATE_LIMITED", "INTERNAL_ERROR", "UNAVAILABLE",
]);
const knownStatuses = new Set([200, 201, 204, 400, 401, 403, 404, 405, 409, 413, 422, 429, 500, 503]);
const uploadBuckets = new Set(["unknown", "1-mib-or-less", "over-1-to-5-mib", "over-5-to-20-mib", "over-20-mib"]);
let checked = 0;
let uploadEvents = 0;
let realMaxFinalizations = 0;
let oversizeRejections = 0;
for (const line of raw.split(/\r?\n/)) {
  const start = line.indexOf('{"requestId"');
  if (start === -1) continue;
  let entry;
  try {
    entry = JSON.parse(line.slice(start).trim());
  } catch {
    throw new Error("A gateway event did not contain valid structured JSON.");
  }
  assert.ok(Object.keys(entry).every((key) => allowedKeys.has(key)), "Gateway event used an unapproved field.");
  assert.ok(typeof entry.requestId === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(entry.requestId),
  "Gateway event has no safe generated request ID.");
  assert.ok(entry.gateway === "admin" || entry.gateway === "device", "Gateway value is outside the fixed domain.");
  assert.ok(stableEndpoints[entry.gateway].has(entry.endpoint), "Endpoint value is outside the fixed domain.");
  assert.ok(knownStatuses.has(entry.status) && Number.isInteger(entry.durationMs) && entry.durationMs >= 0,
    "Status or duration is outside the expected domain.");
  assert.ok(entry.status >= 400 ? errorCodes.has(entry.errorCode) : entry.errorCode === undefined,
    "Gateway event has an unapproved error classification.");
  const upload = entry.endpoint === "uploads.init" || entry.endpoint === "uploads.finalize";
  assert.ok(upload ? uploadBuckets.has(entry.uploadSizeBucket) : entry.uploadSizeBucket === undefined,
    "Gateway event is missing its coarse upload class or has an unapproved upload value.");
  if (upload) uploadEvents += 1;
  if (entry.endpoint === "uploads.finalize" && entry.status === 200 && entry.uploadSizeBucket === "over-5-to-20-mib") {
    realMaxFinalizations += 1;
  }
  if (entry.endpoint === "uploads.init" && entry.status === 413 && entry.uploadSizeBucket === "over-20-mib") {
    oversizeRejections += 1;
  }
  checked += 1;
}
assert.ok(checked > 0 && uploadEvents > 0, "Exercise the actual local gateways before verifying the logs.");
assert.ok(realMaxFinalizations > 0 && oversizeRejections > 0, "Expected both max-size success and oversize denial logs.");
console.log(JSON.stringify({ structuredGatewayEvents: checked, classifiedUploadEvents: uploadEvents,
  maxSizeBucketSuccesses: realMaxFinalizations, oversizeBucketDenials: oversizeRejections, fixedDomainsOnly: true }));
