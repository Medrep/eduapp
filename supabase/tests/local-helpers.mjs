/* global URL, fetch, AbortSignal, Buffer */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { localConfig } from "../local-runtime.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
export const adminOrigin = "http://127.0.0.1:4174";
export const childOrigin = "http://127.0.0.1:4173";
export const ownerFamilyId = "00000000-0000-4000-8000-000000000001";

export const local = localConfig();

export function fingerprint(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function credentials(key) {
  return { apikey: key, ...(!key.startsWith("sb_") ? { Authorization: `Bearer ${key}` } : {}) };
}

export function request(path, { method = "GET", body, headers = {} } = {}) {
  return fetch(new URL(path, local.origin), {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(90000),
  });
}

export async function result(response, status, label) {
  if (response.status !== status) {
    const error = await response.json().catch(() => ({}));
    const safe = String(error?.error?.code ?? "").match(/^[A-Z_]+$/)?.[0];
    const message = String(error?.error?.message ?? "").match(/^[\p{L}\p{N} .,!-]{1,160}$/u)?.[0];
    throw new Error(`${label}: expected ${status}, received ${response.status}${safe ? " " + safe : ""}${message ? " " + message : ""}`);
  }
  return await response.json().catch(() => null);
}

export async function disposableLogin(owner = false) {
  const email = `s3-${randomUUID()}@example.com`;
  const password = randomBytes(24).toString("base64url") + "A!7";
  const created = await request("/auth/v1/admin/users", {
    method: "POST", headers: credentials(local.serviceKey), body: { email, password, email_confirm: true },
  });
  if (!created.ok) throw new Error(`Disposable Auth account creation failed: ${created.status}`);
  const account = await created.json();
  if (owner) {
    const setup = spawnSync("bash", [repo + "supabase/register-local-owner.sh", account.id], {
      cwd: repo, encoding: "utf8",
    });
    if (setup.status !== 0) throw new Error("Local owner registration failed.");
  }
  async function signIn() {
    const login = await result(await request("/auth/v1/token?grant_type=password", {
      method: "POST", headers: { apikey: local.publicKey }, body: { email, password },
    }), 200, "Auth login");
    assert.equal(typeof login.access_token, "string");
    return { id: account.id, token: login.access_token };
  }
  return { ...await signIn(), signIn };
}

export function edge(kind, path, { method, body, token, origin } = {}) {
  return request(`/functions/v1/${kind}-api/${kind}/v1/${path}`, {
    method, body,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
  });
}

export async function admin(owner, path, method = "GET", body, status = 200) {
  return await result(await edge("admin", path, { method, body, token: owner.token }), status, `admin ${method} ${path.split("/")[0]}`);
}

export async function newLesson(owner, title, body = {}) {
  const { subjects } = await admin(owner, "subjects");
  const subjectId = subjects.find((item) => item.slug === "przyroda")?.id;
  assert.equal(typeof subjectId, "string");
  const { lesson } = await admin(owner, "lessons", "POST", { title, subjectId, ...body }, 201);
  return lesson;
}

export async function startUpload(owner, lesson, bytes, overrides = {}) {
  const hash = fingerprint(bytes);
  const pending = await admin(owner, `lessons/${lesson.id}/upload-init`, "POST", {
    filename: "lesson.html", sha256: hash, sizeBytes: bytes.length, contentType: "text/html", ...overrides,
  });
  const target = new URL(pending.uploadUrl);
  assert.equal(target.origin, local.origin, "Signed upload must stay on the local Storage origin.");
  assert.ok(target.pathname.startsWith("/storage/v1/object/upload/sign/lesson-staging/uploads/"));
  assert.deepEqual(Object.keys(pending).sort(), ["expiresAt", "uploadId", "uploadUrl"]);
  const encoded = target.searchParams.get("token")?.split(".")[1];
  assert.ok(encoded, "Storage grant has signed claims.");
  const providerExpiry = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")).exp * 1000;
  const applicationExpiry = Date.parse(pending.expiresAt);
  assert.ok(applicationExpiry > Date.now() && applicationExpiry <= providerExpiry,
    "Upload expiry must be usable and must not exceed the underlying Storage signature.");
  assert.equal(pending.expiresAt, new Date(applicationExpiry).toISOString());
  return { ...pending, hash };
}

export async function putStage(url, bytes, origin) {
  return await fetch(url, {
    method: "PUT", headers: { "Content-Type": "text/html", ...(origin ? { Origin: origin } : {}) }, body: bytes,
    redirect: "error", signal: AbortSignal.timeout(90000),
  });
}

export async function finishUpload(owner, lesson, uploadId) {
  const response = await admin(owner, `lessons/${lesson.id}/upload-finalize`, "POST", { uploadId });
  return response.version;
}

export async function upload(owner, lesson, bytes) {
  const pending = await startUpload(owner, lesson, bytes);
  const staged = await putStage(pending.uploadUrl, bytes);
  if (!staged.ok) throw new Error(`Signed upload failed: ${staged.status}`);
  await staged.body?.cancel();
  const version = await finishUpload(owner, lesson, pending.uploadId);
  assert.equal(version.sizeBytes, bytes.length);
  assert.equal(version.sha256, pending.hash);
  assert.equal(version.validationReport.valid, true);
  return version;
}

export async function issue(owner, familyId = ownerFamilyId) {
  return await admin(owner, `families/${familyId}/pairing-codes`, "POST", {});
}

export function device(path, token, body, method = body === undefined ? "GET" : "POST") {
  return edge("device", path, { method, body, token });
}
