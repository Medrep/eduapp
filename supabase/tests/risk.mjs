/* global URL, process, Buffer, console, fetch, AbortSignal */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { admin, disposableLogin, fingerprint, finishUpload, local, newLesson, putStage, startUpload } from "./local-helpers.mjs";

const maxBytes = 20 * 1024 * 1024;
const original = await readFile(new URL("../../fixtures/rocks-soil.html", import.meta.url));
const requested = process.argv[2];
const pad = Buffer.alloc(maxBytes - original.length, 0x61);
pad.write("<!--", 0);
pad.write("-->", pad.length - 3);
const bytes = requested ? await readFile(requested) : Buffer.concat([original, pad]);
assert.equal(bytes.length, maxBytes, "The experiment requires exactly 20 MiB of HTML.");

const owner = await disposableLogin(true);
const lesson = await newLesson(owner, "Lokalna próba dokładnego limitu");
const pending = await startUpload(owner, lesson, bytes);
const startUploadAt = performance.now();
const stage = await putStage(pending.uploadUrl, bytes);
if (!stage.ok) throw new Error(`Actual 20 MiB signed upload failed: ${stage.status}`);
await stage.body?.cancel();
const finalizeAt = performance.now();
const first = await finishUpload(owner, lesson, pending.uploadId);
const done = performance.now();
const repeat = await finishUpload(owner, lesson, pending.uploadId);
const { versions } = await admin(owner, `lessons/${lesson.id}/versions`);
assert.equal(first.sizeBytes, maxBytes);
assert.equal(first.sha256, pending.hash);
assert.equal(first.validationReport.valid, true);
assert.equal(first.id, repeat.id);
assert.equal(versions.length, 1);
const grant = await admin(owner, `lessons/${lesson.id}/versions/${first.id}/download-url`, "POST", {});
const downloadUrl = new URL(grant.signedUrl);
assert.equal(downloadUrl.origin, local.origin);
const downloaded = await fetch(downloadUrl, { redirect: "error", signal: AbortSignal.timeout(90000) });
assert.equal(downloaded.status, 200, "The immutable object must support a real signed download.");
const roundTrip = Buffer.from(await downloaded.arrayBuffer());
assert.equal(roundTrip.length, maxBytes);
assert.equal(fingerprint(roundTrip), first.sha256);
console.log(JSON.stringify({
  environment: "isolated local Supabase",
  requestedInput: requested ? "operator-provided" : "verified fixture with synthetic comment padding",
  sizeBytes: first.sizeBytes,
  sha256: first.sha256,
  signedUploadMs: Math.round(finalizeAt - startUploadAt),
  finalizeMs: Math.round(done - finalizeAt),
  validation: first.validationReport,
  exactSignedDownload: true,
  idempotent: true,
}));
