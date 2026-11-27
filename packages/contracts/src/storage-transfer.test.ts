import assert from "node:assert/strict";
import { test } from "node:test";
import { blobSha256, signedLessonDownload, signedStageUpload, verifiedHtmlResponse } from "./storage-transfer.ts";

const origin = "https://example.supabase.co";
const lesson = "00000000-0000-4000-8000-000000000001";
const version = "00000000-0000-4000-8000-000000000002";
const download = `${origin}/storage/v1/object/sign/lesson-bundles/lessons/${lesson}/versions/${version}.html?token=example&download=lesson.html`;
const upload = `${origin}/storage/v1/object/upload/sign/lesson-staging/uploads/${version}.html?token=example`;

test("a signed Storage grant is usable only for the configured origin, object and operation", () => {
  assert.equal(signedLessonDownload(download, origin, lesson, version)?.href, download);
  assert.equal(signedStageUpload(upload, origin, version)?.href, upload);
  assert.equal(signedLessonDownload(download, origin, lesson, lesson), undefined);
  assert.equal(signedStageUpload(upload, origin, lesson), undefined);
  assert.equal(signedStageUpload(download, origin, version), undefined);
  for (const candidate of [
    download.replace("https:", "http:"), download.replace(origin, origin + ":8443"),
    download.replace("example.supabase.co", "example.supabase.co.invalid"),
    download.replace("example.supabase.co", "any:secret@example.supabase.co"),
    download.replace(`/lessons/${lesson}/`, `/lessons/${version}/`),
    download.replace("/versions/", "/anything/../versions/"),
    download.replace("example&", "&"), download.replace("lesson.html", "another.html"),
    download + "&token=duplicate", download + "&other=extra", download + "#fragment",
  ]) {
    assert.equal(signedLessonDownload(candidate, origin, lesson, version), undefined);
  }
});

test("response verification requires complete authentic UTF-8 bytes", async () => {
  const html = "<!doctype html><html>łóżko</html>";
  const asset = new Blob([html]);
  const integrity = { sha256: await blobSha256(asset), sizeBytes: asset.size };
  const { signal } = new AbortController();
  assert.equal(await (await verifiedHtmlResponse(new Response(asset), integrity, signal))?.text(), html);
  assert.equal(await verifiedHtmlResponse(new Response(asset.slice(0, -1)), integrity, signal), undefined);
  assert.equal(await verifiedHtmlResponse(new Response(html + "!"), integrity, signal), undefined);
  assert.equal(await verifiedHtmlResponse(new Response(asset), { ...integrity, sha256: "0".repeat(64) }, signal), undefined);
  const invalid = new Blob([new Uint8Array([255])]);
  assert.equal(await verifiedHtmlResponse(new Response(invalid), { sha256: await blobSha256(invalid), sizeBytes: 1 }, signal), undefined);
});
