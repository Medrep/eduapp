/* global URL, Buffer, fetch, AbortSignal, process */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { isCatalog, isPairReply } from "../../packages/contracts/src/device.ts";
import { localPsql } from "../local-runtime.mjs";
import {
  admin, adminOrigin, childOrigin, credentials, device, disposableLogin, edge, fingerprint, finishUpload,
  issue, local, newLesson, ownerFamilyId, putStage, request, result, startUpload, upload,
} from "./local-helpers.mjs";

const fixture = await readFile(new URL("../../fixtures/rocks-soil.html", import.meta.url));
const document = (markup = "<p>Próba lokalna</p>") => Buffer.from(
  '<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
  `</head><body>${markup}</body></html>`,
);

async function denied(response, status) {
  const returned = await result(response, status, "expected safe denial");
  assert.deepEqual(Object.keys(returned), ["error"]);
  assert.deepEqual(Object.keys(returned.error).sort(), ["code", "message", "requestId"]);
  assert.match(returned.error.code, /^[A-Z_]+$/);
  assert.match(returned.error.requestId, /^[a-f0-9-]{36}$/);
  return returned.error;
}

async function catalog(token) {
  const value = await result(await device("catalog", token), 200, "device catalog");
  assert.ok(isCatalog(value), "The real backend catalog must satisfy the accepted S2 runtime parser.");
  return value;
}

async function pair(code) {
  const value = await result(await device("pair", undefined, { pairingCode: code, deviceLabel: "Tablet testowy" }), 200, "pair");
  assert.ok(isPairReply(value), "The real pairing response must satisfy the accepted S2 runtime parser.");
  return value;
}

async function publish(owner, lesson, version) {
  return (await admin(owner, `lessons/${lesson.id}/publish`, "POST", {
    versionId: version.id, expectedUpdatedAt: lesson.updatedAt,
  })).lesson;
}

async function assertBytes(url, bytes) {
  const parsed = new URL(url);
  assert.equal(parsed.origin, local.origin);
  const response = await fetch(parsed, { redirect: "error", signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`Signed download failed: ${response.status}`);
  assert.match(response.headers.get("content-type") ?? "", /^application\/octet-stream/);
  assert.match(response.headers.get("content-disposition") ?? "", /^attachment/);
  assert.equal(fingerprint(Buffer.from(await response.arrayBuffer())), fingerprint(bytes));
}

function clearPairLimit() {
  localPsql("truncate mn_internal.pairing_rate;");
}

async function withRowLock(table, id, exercise) {
  const relation = { lesson: "public.lessons", upload: "public.pending_uploads" }[table];
  assert.ok(relation);
  const holder = spawn("docker", ["exec", "-i", "supabase_db_moja-nauka-local",
    "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres",
    "-v", `record_id=${id}`], { stdio: ["pipe", "pipe", "ignore"] });
  const exited = new Promise((resolve) => {
    holder.once("error", () => resolve(1));
    holder.once("close", resolve);
  });
  const lines = createInterface({ input: holder.stdout });
  const locked = new Promise((resolve) => {
    lines.on("line", (line) => { if (line === "mojanauka-locked") resolve(true); });
  });
  holder.stdin.on("error", () => undefined);
  holder.stdin.write(`begin; select id from ${relation} where id = :'record_id'::uuid for update;\n\\echo mojanauka-locked\n`);
  try {
    const acquired = await Promise.race([locked, exited.then(() => false), delay(5_000, false, { ref: false })]);
    assert.ok(acquired, "The separate SQL session must hold the row lock.");
    await exercise();
  } finally {
    holder.stdin.end("rollback;\n\\q\n");
    await exited;
    lines.close();
  }
}

async function waitForDatabase(check, description) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(40);
  }
  assert.fail(description);
}

function uploadState(uploadId, lessonId) {
  return JSON.parse(localPsql(`
    select json_build_object(
      'reserved', reserved_at is not null,
      'ready', state = 'finalized',
      'expired', expires_at <= clock_timestamp(),
      'hasBundle', exists (select 1 from storage.objects
        where bucket_id = 'lesson-bundles'
        and name = 'lessons/' || :'lesson_id' || '/versions/' || :'upload_id' || '.html'),
      'hasVersion', exists (select 1 from public.lesson_versions where id = :'upload_id'::uuid)
    )
    from public.pending_uploads where id = :'upload_id'::uuid;
  `, { upload_id: uploadId, lesson_id: lessonId }));
}

test("S3 local gateways and Storage through the real isolated stack", async (suite) => {
  const owner = await disposableLogin(true);
  const outsider = await disposableLogin();
  clearPairLimit();

  await suite.test("AT-11 explicit active owner, Auth signup disabled, and distinct allowlisted origins", async () => {
    await denied(await edge("admin", "subjects"), 401);
    await denied(await edge("admin", "subjects", { token: outsider.token }), 403);
    await denied(await edge("admin", "subjects", { token: owner.token, origin: childOrigin }), 403);
    await denied(await edge("device", "catalog", { token: owner.token }), 401);
    const signup = await request("/auth/v1/signup", {
      method: "POST", headers: { apikey: local.publicKey },
      body: { email: `disabled-${randomUUID()}@example.com`, password: randomUUID() + "A!7z" },
    });
    assert.ok(!signup.ok, "Browser signup must be disabled in the real Auth service.");
    await signup.body?.cancel();
    const good = await request("/functions/v1/admin-api/admin/v1/subjects", {
      method: "OPTIONS", headers: { Origin: adminOrigin, "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization,content-type" },
    });
    assert.equal(good.status, 204);
    assert.equal(good.headers.get("access-control-allow-origin"), adminOrigin);
    assert.match(good.headers.get("access-control-allow-headers") ?? "", /authorization/);
    const blocked = await request("/functions/v1/device-api/device/v1/catalog", {
      method: "OPTIONS", headers: { Origin: adminOrigin, "Access-Control-Request-Method": "GET" },
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get("access-control-allow-origin"), null);
    const { subject } = await admin(owner, "subjects", "POST", {
      slug: "lokalny-" + randomUUID().slice(0, 10), namePl: "Temat testowy", sortOrder: 90,
    }, 201);
    const edited = await admin(owner, `subjects/${subject.id}`, "PATCH", { namePl: "Poprawiony temat", archived: true });
    assert.equal(edited.subject.namePl, "Poprawiony temat");
    assert.ok(edited.subject.archivedAt);
    await denied(await edge("admin", "subjects", { token: owner.token, method: "POST", body: { slug: "123" } }), 400);
  });

  const { family } = await admin(owner, "families", "POST", { label: "Zaproszona rodzina testowa" }, 201);
  const a = await newLesson(owner, "Tylko rodzina Dom");
  const b = await newLesson(owner, "Tylko rodzina zaproszona", { familyIds: [family.id] });
  const shared = await newLesson(owner, "Lekcja wspólna", { visibility: "all" });
  assert.deepEqual(a.familyIds, [ownerFamilyId]);
  assert.equal(a.visibility, "selected");
  assert.deepEqual(shared.familyIds, []);
  const { lessons } = await admin(owner, "lessons?status=draft&q=rodzina");
  assert.ok(lessons.some((item) => item.id === a.id));

  const codeA = await issue(owner);
  const concurrent = await Promise.all([0, 1].map(() => device("pair", undefined, {
    pairingCode: codeA.code, deviceLabel: "Tablet równoległy",
  })));
  assert.deepEqual(concurrent.map((response) => response.status).sort(), [200, 400]);
  const pairA = await concurrent.find((response) => response.status === 200).json();
  assert.ok(isPairReply(pairA));
  await denied(concurrent.find((response) => response.status === 400), 400);
  const pairB = await pair((await issue(owner, family.id)).code);

  await suite.test("AT-12 actual original fixture, signed write once, and idempotent immutable registration", async () => {
    assert.equal(fixture.length, 333033);
    assert.equal(fingerprint(fixture), "7590b609c72a5e454887707ed16a5e3de6bec759ea1fc2e88247f9654265566c");
    const pending = await startUpload(owner, a, fixture);
    const stage = await putStage(pending.uploadUrl, fixture);
    if (!stage.ok) throw new Error(`Signed original fixture PUT failed: ${stage.status}`);
    await stage.body?.cancel();
    const repeatedPut = await putStage(pending.uploadUrl, document());
    assert.ok(!repeatedPut.ok, "A staging grant cannot overwrite the first bytes.");
    await repeatedPut.body?.cancel();
    const repeated = await Promise.all([
      finishUpload(owner, a, pending.uploadId),
      finishUpload(owner, a, pending.uploadId),
    ]);
    assert.equal(repeated[0].id, repeated[1].id);
    assert.equal(repeated[0].sha256, fingerprint(fixture));
    assert.equal(repeated[0].sizeBytes, fixture.length);
    assert.equal((await admin(owner, `lessons/${a.id}/versions`)).versions.length, 1);
    assert.ok(!(await catalog(pairA.deviceToken)).lessons.some((item) => item.id === a.id));
    const signed = await admin(owner, `lessons/${a.id}/versions/${repeated[0].id}/download-url`, "POST", {});
    await assertBytes(signed.signedUrl, fixture);
  });

  await suite.test("AT-12 bounded upload expiry and expired-before-reservation denial leave no immutable object", async () => {
    const pending = await startUpload(owner, a, document());
    const staged = await putStage(pending.uploadUrl, document());
    assert.ok(staged.ok);
    await staged.body?.cancel();
    localPsql(`
      update public.pending_uploads
      set expires_at = clock_timestamp() + interval '2 seconds'
      where id = :'upload_id'::uuid;
    `, { upload_id: pending.uploadId });
    let blocked;
    await withRowLock("upload", pending.uploadId, async () => {
      blocked = edge("admin", `lessons/${a.id}/upload-finalize`, {
        token: owner.token, method: "POST", body: { uploadId: pending.uploadId },
      });
      await waitForDatabase(() => localPsql(`
        select exists (select 1 from pg_stat_activity
          where pid <> pg_backend_pid() and wait_event_type = 'Lock'
          and query like '%mn_reserve_upload%');
      `) === "t", "Finalize must reach the reservation lock after validating the stage.");
      await waitForDatabase(() => uploadState(pending.uploadId, a.id).expired, "Application deadline did not pass.");
    });
    await denied(await blocked, 409);
    assert.deepEqual(uploadState(pending.uploadId, a.id), {
      reserved: false, ready: false, expired: true, hasBundle: false, hasVersion: false,
    });
  });

  await suite.test("AT-12 reservation and immutable write survive actual in-flight application expiry", async () => {
    const lesson = await newLesson(owner, "Rezerwacja przed końcem ważności");
    const pending = await startUpload(owner, lesson, fixture);
    const staged = await putStage(pending.uploadUrl, fixture);
    assert.ok(staged.ok);
    await staged.body?.cancel();
    let finishing;
    await withRowLock("lesson", lesson.id, async () => {
      localPsql(`
        update public.pending_uploads set expires_at = clock_timestamp() + interval '2 seconds'
        where id = :'upload_id'::uuid;
      `, { upload_id: pending.uploadId });
      finishing = edge("admin", `lessons/${lesson.id}/upload-finalize`, {
        method: "POST", token: owner.token, body: { uploadId: pending.uploadId },
      });
      await waitForDatabase(() => {
        const phase = uploadState(pending.uploadId, lesson.id);
        return phase.reserved && phase.hasBundle && !phase.expired && !phase.hasVersion;
      }, "The real Edge request must reserve and write before expiry while registration is locked.");
      await waitForDatabase(() => uploadState(pending.uploadId, lesson.id).expired, "Application deadline did not pass.");
      assert.equal(uploadState(pending.uploadId, lesson.id).hasVersion, false);
    });
    const { version } = await result(await finishing, 200, "in-flight finalization after expiry");
    assert.equal(version.sha256, fingerprint(fixture));
    assert.equal((await finishUpload(owner, lesson, pending.uploadId)).id, version.id);
    assert.equal((await admin(owner, `lessons/${lesson.id}/versions`)).versions.length, 1);
  });

  await suite.test("AT-11/12 logout interrupts registration and the same owner recovers once under a fresh session", async () => {
    const firstSession = await disposableLogin(true);
    const lesson = await newLesson(firstSession, "Wznowienie rezerwacji po wylogowaniu");
    const pending = await startUpload(firstSession, lesson, fixture);
    const staged = await putStage(pending.uploadUrl, fixture);
    assert.ok(staged.ok);
    await staged.body?.cancel();
    let interrupted;
    await withRowLock("lesson", lesson.id, async () => {
      localPsql(`
        update public.pending_uploads set expires_at = clock_timestamp() + interval '2 seconds'
        where id = :'upload_id'::uuid;
      `, { upload_id: pending.uploadId });
      interrupted = edge("admin", `lessons/${lesson.id}/upload-finalize`, {
        method: "POST", token: firstSession.token, body: { uploadId: pending.uploadId },
      });
      await waitForDatabase(() => {
        const phase = uploadState(pending.uploadId, lesson.id);
        return phase.reserved && phase.hasBundle && !phase.hasVersion;
      }, "The real request did not reach its reserved immutable write.");
      const logout = await request("/auth/v1/logout?scope=local", {
        method: "POST", headers: { apikey: local.publicKey, Authorization: `Bearer ${firstSession.token}` },
      });
      assert.equal(logout.status, 204);
      await waitForDatabase(() => uploadState(pending.uploadId, lesson.id).expired, "Application deadline did not pass.");
    });
    await denied(await interrupted, 403);
    const staleGrant = await edge("admin", `lessons/${lesson.id}/upload-init`, {
      method: "POST", token: firstSession.token, body: {
        filename: "lesson.html", contentType: "text/html", sha256: fingerprint(fixture), sizeBytes: fixture.length,
      },
    });
    assert.ok(staleGrant.status === 401 || staleGrant.status === 403);
    await denied(staleGrant, staleGrant.status);
    assert.deepEqual(uploadState(pending.uploadId, lesson.id), {
      reserved: true, ready: false, expired: true, hasBundle: true, hasVersion: false,
    });
    assert.ok(!(await catalog(pairA.deviceToken)).lessons.some((item) => item.id === lesson.id));
    await denied(await device("download-url", pairA.deviceToken, {
      lessonId: lesson.id, versionId: pending.uploadId,
    }), 404);
    const fresh = await firstSession.signIn();
    assert.equal(fresh.id, firstSession.id);
    const version = await finishUpload(fresh, lesson, pending.uploadId);
    assert.equal(version.id, pending.uploadId);
    assert.equal((await finishUpload(fresh, lesson, pending.uploadId)).id, version.id);
    assert.equal((await admin(fresh, `lessons/${lesson.id}/versions`)).versions.length, 1);
    const grant = await admin(fresh, `lessons/${lesson.id}/versions/${version.id}/download-url`, "POST", {});
    await assertBytes(grant.signedUrl, fixture);
    assert.ok(!(await catalog(pairA.deviceToken)).lessons.some((item) => item.id === lesson.id));
    await denied(await device("download-url", pairA.deviceToken, {
      lessonId: lesson.id, versionId: version.id,
    }), 404);
  });

  await suite.test("AT-12 and SEC-07 reject bad metadata, bytes, digest and active-content dependencies", async () => {
    const base = { filename: "valid.html", sha256: fingerprint(fixture), sizeBytes: fixture.length, contentType: "text/html" };
    for (const [override, status] of [
      [{ sizeBytes: 20 * 1024 * 1024 + 1 }, 413],
      [{ sizeBytes: 0 }, 400],
      [{ filename: "notes.txt" }, 400],
      [{ contentType: "text/plain" }, 400],
    ]) {
      await denied(await edge("admin", `lessons/${a.id}/upload-init`, {
        token: owner.token, method: "POST", body: { ...base, ...override },
      }), status);
    }
    const cases = [
      ["digest", document(), { sha256: "0".repeat(64) }, 422],
      ["truncated", document(), { sizeBytes: document().length + 1 }, 422],
      ["larger", document(), { sizeBytes: document().length - 1 }, 413],
      ["utf8", Buffer.from([0xff, 0xfe, 0x61]), {}, 422],
      ["external script", document('<script src="https://example.invalid/a.js"></script>'), {}, 422],
      ["external image", document('<img src="picture.png">'), {}, 422],
      ["external stylesheet", document('<link rel="stylesheet" href="https://example.invalid/a.css">'), {}, 422],
      ["stylesheet import", document('<style>@import "theme.css";</style>'), {}, 422],
      ["CSS image-set", document('<style>p{background:image-set("picture.png" 1x)}</style>'), {}, 422],
      ["frame", document("<iframe></iframe>"), {}, 422],
      ["worker", document('<script>new Worker("worker.js")</script>'), {}, 422],
      ["script import", document('<script>import("./app.js")</script>'), {}, 422],
    ];
    for (const [label, bytes, override, status] of cases) {
      const pending = await startUpload(owner, a, bytes, override);
      const staged = await putStage(pending.uploadUrl, bytes);
      assert.ok(staged.ok, label);
      await staged.body?.cancel();
      await denied(await edge("admin", `lessons/${a.id}/upload-finalize`, {
        token: owner.token, method: "POST", body: { uploadId: pending.uploadId },
      }), status);
    }
    assert.equal((await admin(owner, `lessons/${a.id}/versions`)).versions.length, 1);
  });

  const first = (await admin(owner, `lessons/${a.id}/versions`)).versions[0];
  const versionB = await upload(owner, b, document("<p>Rodzina B</p>"));
  const versionShared = await upload(owner, shared, document("<p>Dla wszystkich</p>"));
  let publishedA = await publish(owner, a, first);
  await publish(owner, b, versionB);
  await publish(owner, shared, versionShared);

  await suite.test("AT-08 and AT-14 distinct device authorizations with private default and no metadata leakage", async () => {
    const snapshots = await Promise.all([catalog(pairA.deviceToken), catalog(pairB.deviceToken)]);
    const selected = new Set([a.id, b.id, shared.id]);
    assert.deepEqual(snapshots[0].lessons.filter((item) => selected.has(item.id)).map((item) => item.id).sort(), [a.id, shared.id].sort());
    assert.deepEqual(snapshots[1].lessons.filter((item) => selected.has(item.id)).map((item) => item.id).sort(), [b.id, shared.id].sort());
    assert.equal(snapshots[0].revision, snapshots[1].revision);
    await denied(await device("download-url", pairB.deviceToken, { lessonId: a.id, versionId: first.id }), 404);
    await denied(await device("download-url", pairA.deviceToken, { lessonId: b.id, versionId: versionB.id }), 404);
    const signed = await result(await device("download-url", pairA.deviceToken, { lessonId: a.id, versionId: first.id }), 200, "authorized grant");
    assert.equal(signed.sha256, first.sha256);
    await assertBytes(signed.signedUrl, fixture);
    await denied(await edge("admin", "subjects", { token: pairA.deviceToken }), 401);

    const moved = await admin(owner, `lessons/${a.id}`, "PATCH", {
      familyIds: [family.id], expectedUpdatedAt: publishedA.updatedAt,
    });
    publishedA = moved.lesson;
    const next = await catalog(pairA.deviceToken);
    assert.equal(next.revision, snapshots[0].revision + 1);
    assert.ok(!next.lessons.some((item) => item.id === a.id));
    assert.ok((await catalog(pairB.deviceToken)).lessons.some((item) => item.id === a.id));
    await denied(await device("download-url", pairA.deviceToken, { lessonId: a.id, versionId: first.id }), 404);
  });

  await suite.test("AT-13 concurrent optimistic publish, exact revision, draft invisibility, rollback and unpublish", async () => {
    const base = await catalog(pairB.deviceToken);
    const updatedBytes = document("<p>Nowsza wersja testowa</p>");
    const second = await upload(owner, a, updatedBytes);
    const draft = await catalog(pairB.deviceToken);
    assert.equal(draft.revision, base.revision);
    assert.equal(draft.lessons.find((item) => item.id === a.id).version.id, first.id);
    const versions = await Promise.all([first.id, second.id].map((versionId) =>
      edge("admin", `lessons/${a.id}/publish`, { method: "POST", token: owner.token,
        body: { versionId, expectedUpdatedAt: publishedA.updatedAt } })));
    assert.deepEqual(versions.map((response) => response.status).sort(), [200, 409]);
    await denied(versions.find((response) => response.status === 409), 409);
    publishedA = (await versions.find((response) => response.status === 200).json()).lesson;
    let current = await catalog(pairB.deviceToken);
    assert.equal(current.revision, base.revision + 1);
    assert.equal(current.lessons.find((item) => item.id === a.id).version.id, publishedA.activeVersionId);

    if (publishedA.activeVersionId !== second.id) publishedA = await publish(owner, publishedA, second);
    await denied(await device("download-url", pairB.deviceToken, { lessonId: a.id, versionId: first.id }), 404);
    const currentFile = await result(await device("download-url", pairB.deviceToken, {
      lessonId: a.id, versionId: second.id,
    }), 200, "current version grant");
    await assertBytes(currentFile.signedUrl, updatedBytes);
    const beforeRollback = await catalog(pairB.deviceToken);
    publishedA = await publish(owner, publishedA, first);
    current = await catalog(pairB.deviceToken);
    assert.equal(current.revision, beforeRollback.revision + 1);
    assert.equal(current.lessons.find((item) => item.id === a.id).version.id, first.id);
    const older = await admin(owner, `lessons/${a.id}/versions/${first.id}/download-url`, "POST", {});
    await assertBytes(older.signedUrl, fixture);
    await denied(await edge("admin", `lessons/${a.id}/unpublish`, {
      token: owner.token, method: "POST", body: {},
    }), 400);
    await admin(owner, `lessons/${a.id}/unpublish`, "POST", { expectedUpdatedAt: publishedA.updatedAt });
    const hidden = await catalog(pairB.deviceToken);
    assert.equal(hidden.revision, current.revision + 1);
    assert.ok(!hidden.lessons.some((item) => item.id === a.id));
    await denied(await device("download-url", pairB.deviceToken, { lessonId: a.id, versionId: first.id }), 404);
  });

  await suite.test("SEC-03/04/06 direct RLS/privacy, expired/reused codes, per-code/IP/global throttling and revoke", async () => {
    for (const key of [local.publicKey, outsider.token]) {
      const headers = { apikey: local.publicKey, Authorization: `Bearer ${key}` };
      const direct = await request("/rest/v1/lessons?select=id", { headers });
      assert.ok(!direct.ok, "Direct catalog table reads must be denied.");
      await direct.body?.cancel();
      const privileged = await request("/rest/v1/rpc/mn_admin_session", {
        method: "POST", headers, body: { p_user: owner.id, p_session: randomUUID() },
      });
      assert.ok(!privileged.ok, "Privileged RPC must be denied to a browser role.");
      await privileged.body?.cancel();
      const list = await request("/storage/v1/object/list/lesson-bundles", { method: "POST", headers, body: { prefix: "" } });
      assert.ok(!list.ok || (await list.json()).length === 0, "Direct Storage listing must never expose object paths.");
    }
    const directFile = await request(`/storage/v1/object/public/lesson-bundles/lessons/${a.id}/versions/${first.id}.html`);
    assert.ok(!directFile.ok);
    await directFile.body?.cancel();
    await admin(owner, `devices/${pairB.deviceId}/revoke`, "POST", {});
    await denied(await device("catalog", pairB.deviceToken), 403);
    await denied(await device("download-url", pairB.deviceToken, { lessonId: shared.id, versionId: versionShared.id }), 403);
    await denied(await device("catalog", "A".repeat(43)), 401);
    assert.ok((await admin(owner, "devices")).devices.every((entry) => !("tokenHash" in entry)));

    clearPairLimit();
    const fresh = await issue(owner);
    const ttl = Date.parse(fresh.expiresAt) - Date.now();
    assert.ok(ttl >= 890000 && ttl <= 900000);
    localPsql(`
      update public.pairing_codes set created_at = statement_timestamp() - interval '16 minutes',
        expires_at = statement_timestamp() - interval '1 minute'
      where id = (select id from public.pairing_codes where family_id = :'family'::uuid order by created_at desc limit 1);
    `, { family: ownerFamilyId });
    for (let repeat = 0; repeat < 5; repeat += 1) {
      await denied(await device("pair", undefined, { pairingCode: fresh.code }), 400);
    }
    await denied(await device("pair", undefined, { pairingCode: fresh.code }), 429);
    clearPairLimit();
    for (let repeat = 0; repeat < 10; repeat += 1) {
      await denied(await device("pair", undefined, { pairingCode: "ZZZZZ-ZZZZZ" }), 400);
    }
    await denied(await device("pair", undefined, { pairingCode: "ZZZZZ-ZZZZZ" }), 429);
    clearPairLimit();
    localPsql(`
      do $$ begin
        for attempt in 1..100 loop
          if not mn_internal.take_pair_attempt('global', 100, statement_timestamp()) then
            raise exception 'Global budget advanced too soon';
          end if;
        end loop;
        if mn_internal.take_pair_attempt('global', 100, statement_timestamp()) then
          raise exception 'Global budget did not hold';
        end if;
      end $$;
    `);
    clearPairLimit();
  });

  await suite.test("Expired staging cleanup preserves active grants and every immutable version", async () => {
    const expired = randomUUID();
    const expiredPath = `/storage/v1/object/lesson-staging/uploads/${expired}.html`;
    const bytes = document("<p>Bufor testowy</p>");
    const headers = { ...credentials(local.serviceKey), "Content-Type": "text/html" };
    const created = await fetch(local.origin + expiredPath, { method: "POST", headers, body: bytes });
    assert.ok(created.ok, "Disposable expired object preparation failed.");
    await created.body?.cancel();
    localPsql(`
      insert into public.pending_uploads (
        id, lesson_id, temp_storage_path, expected_sha256, expected_size_bytes, expires_at, created_by, created_at
      )
      values (:'expired'::uuid, :'lesson'::uuid, 'uploads/' || :'expired' || '.html', :'sha', :'size'::integer,
        statement_timestamp() - interval '20 minutes', :'owner'::uuid, statement_timestamp() - interval '3 hours');
    `, { expired, lesson: a.id, sha: fingerprint(bytes), size: bytes.length, owner: owner.id });

    const current = await startUpload(owner, a, bytes);
    const stage = await putStage(current.uploadUrl, bytes);
    assert.ok(stage.ok, "Disposable active staging object preparation failed.");
    await stage.body?.cancel();
    const recovery = await startUpload(owner, a, bytes);
    const recoverableStage = await putStage(recovery.uploadUrl, bytes);
    assert.ok(recoverableStage.ok);
    await recoverableStage.body?.cancel();
    // Move this verified fixture's clocks only to exercise cleanup after both deadlines.
    localPsql(`
      update public.pending_uploads
      set state = 'uploaded',
          created_at = statement_timestamp() - interval '30 minutes',
          reserved_at = statement_timestamp() - interval '20 minutes',
          expires_at = statement_timestamp() - interval '15 minutes',
          grant_expires_at = statement_timestamp() - interval '10 minutes',
          validation_report = '{"valid":true}'
      where id = :'id'::uuid;
    `, { id: recovery.uploadId });
    const cleanup = spawnSync(process.execPath, [
      fileURLToPath(new URL("../cleanup-local-stages.mjs", import.meta.url)),
    ], { encoding: "utf8" });
    assert.equal(cleanup.status, 0, "Dedicated local staging cleanup failed.");
    assert.ok(JSON.parse(cleanup.stdout).expiredStagedObjectsProcessed >= 1);

    const absent = await fetch(local.origin + expiredPath.replace("/object/", "/object/authenticated/"), { headers });
    assert.ok(!absent.ok, "Expired staged object was preserved.");
    await absent.body?.cancel();
    const tracked = localPsql("select state = 'failed' and stage_removed_at is not null from public.pending_uploads where id = :'expired'::uuid;",
      { expired });
    assert.equal(tracked, "t");
    assert.equal((await finishUpload(owner, a, current.uploadId)).sha256, fingerprint(bytes));
    assert.equal(localPsql(`
      select stage_removed_at is null and state = 'uploaded'
      from public.pending_uploads where id = :'reserved_id'::uuid;
    `, { reserved_id: recovery.uploadId }), "t");
    assert.equal((await finishUpload(owner, a, recovery.uploadId)).sha256, fingerprint(bytes));
    const preserved = await admin(owner, `lessons/${a.id}/versions/${first.id}/download-url`, "POST", {});
    await assertBytes(preserved.signedUrl, fixture);
  });

  await suite.test("AT-11 Auth logout closes owner routes even for the previous bearer", async () => {
    const logout = await request("/auth/v1/logout?scope=local", {
      method: "POST", headers: { apikey: local.publicKey, Authorization: `Bearer ${owner.token}` },
    });
    assert.equal(logout.status, 204);
    const replay = await edge("admin", "subjects", { token: owner.token });
    assert.ok(replay.status === 401 || replay.status === 403, "A logged-out owner's old bearer is not authorized.");
    await denied(replay, replay.status);
  });
});
