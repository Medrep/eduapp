/* global URL, process, atob, fetch, crypto, console */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { chromium, firefox } from "@playwright/test";
import { isCatalog, isPairReply } from "../../packages/contracts/src/device.ts";
import { admin, adminOrigin, childOrigin, disposableLogin, fingerprint, issue, local, newLesson } from "./local-helpers.mjs";

async function shell(origin) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html lang=pl><title>Próba CORS</title><p>Próba lokalna</p></html>");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(new URL(origin).port), "127.0.0.1", resolve);
  });
  return server;
}

const fixture = await readFile(new URL("../../fixtures/rocks-soil.html", import.meta.url));
const engine = process.env.MOJA_S3_BROWSER === "firefox" ? firefox : chromium;

test(`AT-11/12 and SEC-03 local browser CORS and credentialless signed PUT/GET in ${engine.name()}`, async () => {
  const servers = [];
  let browser;
  try {
    servers.push(await shell(adminOrigin));
    servers.push(await shell(childOrigin));
    browser = await engine.launch();
    const ownerPage = await browser.newPage();
    const childPage = await browser.newPage();
    await Promise.all([ownerPage.goto(adminOrigin), childPage.goto(childOrigin)]);
    const owner = await disposableLogin(true);
    const lesson = await newLesson(owner, "Próba przeglądarkowa");
    const hash = fingerprint(fixture);
    const ownerObservation = await ownerPage.evaluate(async ({ api, lessonId, ownerToken, encoded, hash }) => {
      const source = Uint8Array.from(atob(encoded), (byte) => byte.charCodeAt(0));
      const root = api + "/functions/v1/admin-api/admin/v1/lessons/" + lessonId;
      const withOwner = { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" };
      const init = await fetch(root + "/upload-init", {
        method: "POST", headers: withOwner, credentials: "omit",
        body: JSON.stringify({ filename: "rocks-soil.html", sizeBytes: source.length, sha256: hash, contentType: "text/html" }),
      });
      if (!init.ok) return { init: init.status };
      const { uploadUrl, uploadId } = await init.json();
      if (new URL(uploadUrl).origin !== api) return { init: 0 };
      const uploaded = await fetch(uploadUrl, {
        method: "PUT", headers: { "Content-Type": "text/html" }, body: source, credentials: "omit", redirect: "error",
      });
      if (!uploaded.ok) return { uploaded: uploaded.status };
      const finalized = await fetch(root + "/upload-finalize", {
        method: "POST", headers: withOwner, credentials: "omit", body: JSON.stringify({ uploadId }),
      });
      const value = await finalized.json();
      return { init: init.status, uploaded: uploaded.status, final: finalized.status, version: value.version };
    }, { api: local.origin, lessonId: lesson.id, ownerToken: owner.token, encoded: fixture.toString("base64"), hash });
    assert.equal(ownerObservation.init, 200);
    assert.equal(ownerObservation.uploaded, 200);
    assert.equal(ownerObservation.final, 200);
    assert.equal(ownerObservation.version.sha256, hash);
    const versionId = ownerObservation.version.id;
    await admin(owner, `lessons/${lesson.id}/publish`, "POST", { versionId, expectedUpdatedAt: lesson.updatedAt });
    const { code } = await issue(owner);
    const paired = await childPage.evaluate(async ({ api, code }) => {
      const response = await fetch(api + "/functions/v1/device-api/device/v1/pair", {
        method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairingCode: code, deviceLabel: "Tablet przeglądarkowy" }),
      });
      return response.json();
    }, { api: local.origin, code });
    assert.ok(isPairReply(paired));
    const childObservation = await childPage.evaluate(async ({ api, token, lessonId, versionId }) => {
      const root = api + "/functions/v1/device-api/device/v1";
      const auth = { Authorization: `Bearer ${token}` };
      const catalog = await fetch(root + "/catalog", { headers: auth, credentials: "omit" });
      const grant = await fetch(root + "/download-url", {
        method: "POST", credentials: "omit", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId, versionId }),
      });
      if (!catalog.ok || !grant.ok) return { catalogStatus: catalog.status, grantStatus: grant.status };
      const metadata = await grant.json();
      if (new URL(metadata.signedUrl).origin !== api) return { grantStatus: 0 };
      const downloaded = await fetch(metadata.signedUrl, { credentials: "omit", redirect: "error" });
      const bytes = await downloaded.arrayBuffer();
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      let denied = false;
      try {
        await fetch(api + "/functions/v1/admin-api/admin/v1/subjects", { credentials: "omit", headers: auth });
      } catch {
        denied = true;
      }
      return {
        catalogStatus: catalog.status, catalog: await catalog.json(), grantStatus: grant.status,
        downloaded: downloaded.status, type: downloaded.headers.get("Content-Type"), denied,
        sha256: Array.from(digest, (part) => part.toString(16).padStart(2, "0")).join(""), size: bytes.byteLength,
      };
    }, { api: local.origin, token: paired.deviceToken, lessonId: lesson.id, versionId });
    assert.equal(childObservation.catalogStatus, 200);
    assert.ok(isCatalog(childObservation.catalog));
    assert.equal(childObservation.catalog.lessons.find((entry) => entry.id === lesson.id).version.id, versionId);
    assert.equal(childObservation.grantStatus, 200);
    assert.equal(childObservation.downloaded, 200);
    assert.match(childObservation.type, /^application\/octet-stream/);
    assert.equal(childObservation.sha256, hash);
    assert.equal(childObservation.size, fixture.length);
    assert.equal(childObservation.denied, true);
    console.log(JSON.stringify({ engine: engine.name(), version: browser.version(), signedPut: ownerObservation.uploaded,
      signedGet: childObservation.downloaded, exactOriginalBytes: childObservation.size, deniedCrossOrigin: childObservation.denied }));
  } finally {
    await browser?.close();
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  }
});
