/* global AbortSignal, fetch, URL, console, process */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { localConfig, localPsql } from "../../supabase/local-runtime.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const ref = "spvzlwyqytytwvvfrwqs";
const local = "http://127.0.0.1:54321";
const staging = "https://" + ref + ".supabase.co";
const childHost = "moja-nauka-child-staging.vercel.app";
const adminHost = "moja-nauka-admin-staging.vercel.app";
const runId = "s4-" + randomBytes(6).toString("hex");
const mode = process.argv[2];
const browser = process.argv[3];
assert.ok(mode === "local" || mode === "staging", "Choose local or staging.");
assert.ok(["chromium", "firefox", "tablet"].includes(browser), "Choose chromium, firefox or tablet.");
assert.ok(mode === "local" || browser !== "firefox", "The staging loopback harness requires Chromium.");
const hosted = mode === "staging";
const origin = hosted ? staging : local;
const runnerEnv = { ...process.env, CI: "1", DO_NOT_TRACK: "1", SUPABASE_TELEMETRY_DISABLED: "1" };
const secrets = [];

function cli(args, options = {}) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd: repo, env: runnerEnv, encoding: "utf8", ...options,
  });
  if (result.status !== 0) {
    throw new Error(args.slice(0, 3).join(" ") + " failed (" + (result.status ?? result.error?.code ?? "signal") + ").");
  }
  return result;
}

function remote(args, extra = []) {
  const { stdout, stderr } = cli(["supabase", ...args, "--remote=" + ref, "--output-format", "json", ...extra]);
  const reply = JSON.parse(stdout);
  if (args[0] === "db" && args[1] === "query" && !reply.target) {
    // The database query serializer reports its exact resolved target in stderr.
    assert.ok(stderr.split("\n").some(line => line.startsWith("Target: project EduApp (" + ref + ")")),
      "CLI did not report the approved EduApp project.");
  } else {
    assert.equal(reply.target?.project_ref, ref, "CLI resolved a different project.");
  }
  return reply;
}

function preflight() {
  if (!hosted) return localConfig();
  const functions = remote(["functions", "list"]).functions.map(({ slug, version, status }) =>
    [slug, version, status]).sort();
  assert.deepEqual(functions, [["admin-api", 1, "ACTIVE"], ["device-api", 1, "ACTIVE"]]);
  const keys = remote(["projects", "api-keys"], ["--reveal"]).keys;
  const find = type => {
    const key = keys.find(entry => entry.type === type && entry.name === "default");
    const value = key?.api_key ?? key?.apiKey ?? key?.key;
    assert.ok(typeof value === "string" && value.startsWith("sb_" + type + "_"), type + " key unavailable.");
    return value;
  };
  console.log(JSON.stringify({ stagingProject: ref, activeFunctions: functions }));
  return { publicKey: find("publishable"), serviceKey: find("secret") };
}

function sql(statement) {
  if (hosted) {
    const receipt = remote(["db", "query", "--yes", statement]).rows[0].receipt;
    return typeof receipt === "string" ? JSON.parse(receipt) : receipt;
  }
  return JSON.parse(localPsql(statement));
}

function userId(value) {
  assert.ok(typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value));
  return "'" + value + "'::uuid";
}

function auth(serviceKey, suffix, method, body) {
  const headers = { apikey: serviceKey, "content-type": "application/json" };
  if (!serviceKey.startsWith("sb_")) headers.Authorization = "Bearer " + serviceKey;
  return fetch(origin + "/auth/v1/admin/users" + suffix, {
    method, headers, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(30_000),
  });
}

function register(id) {
  const inserted = sql("with owner as (insert into public.admin_users (user_id,active) values (" +
    userId(id) + ",true) returning user_id) select json_build_object('user_id',user_id) as receipt from owner");
  assert.equal(inserted.user_id, id);
}

async function closeOwner(serviceKey, id) {
  const exactOwner = userId(id);
  const response = await auth(serviceKey, "/" + id, "PUT", { ban_duration: "87600h" });
  assert.equal(response.status, 200, "Disposable owner ban.");
  const account = await response.json();
  assert.equal(account.id, id);
  assert.ok(Date.parse(account.banned_until) > Date.now());
  const result = sql(`with fam as materialized (
    select id from public.families where label='${runId} rodzina'
  ), candidates as materialized (
    select l.id,l.status from public.lessons l
    join public.lesson_families f on f.lesson_id=l.id
    where f.family_id in (select id from fam)
      and l.title in ('${runId} skały i gleba','${runId} bez zmian')
  ), lessons_close as (
    update public.lessons l set status='unpublished',active_version_id=null,published_at=null,
      deleted_at=coalesce(l.deleted_at,statement_timestamp()),updated_at=statement_timestamp()
    from candidates c where l.id=c.id returning c.status
  ), revision as (
    update public.catalog_revision set revision=revision+1,updated_at=statement_timestamp()
    where singleton and exists(select 1 from lessons_close where status='published') returning revision
  ), families_close as (
    update public.families set enabled=false,updated_at=statement_timestamp()
    where id in (select id from fam) returning id
  ), devices_close as (
    update public.devices set revoked_at=coalesce(revoked_at,statement_timestamp())
    where family_id in (select id from fam) and label='${runId} tablet' returning id
  ), codes_removed as (
    delete from public.pairing_codes where created_by=${exactOwner}
    and family_id in (select id from fam) returning id
  ), subjects_close as (
    update public.subjects set archived_at=coalesce(archived_at,statement_timestamp())
    where slug='${runId}' and name_pl in ('${runId} przedmiot','${runId} przedmiot zmieniony') returning id
  ), owner_close as (
    update public.admin_users set active=false where user_id=${exactOwner} returning user_id
  ), sessions_close as (
    delete from auth.sessions where user_id=${exactOwner} returning id
  )
  select json_build_object(
    'lessons', (select count(*) from lessons_close),
    'families', (select count(*) from families_close),
    'devices', (select count(*) from devices_close),
    'subjects', (select count(*) from subjects_close),
    'owners', (select count(*) from owner_close),
    'pairing_codes', (select count(*) from codes_removed),
    'sessions', (select count(*) from sessions_close),
    'immutable_versions_retained', (select count(*) from public.lesson_versions where created_by=${exactOwner}),
    'pending_stages', (select count(*) from public.pending_uploads where created_by=${exactOwner} and stage_removed_at is null),
    'safe_stage_cleanup_after', (select max(greatest(expires_at,coalesce(grant_expires_at,expires_at))+interval '5 minutes')
      from public.pending_uploads where created_by=${exactOwner} and stage_removed_at is null and state<>'uploaded')) as receipt`);
  console.log(JSON.stringify({ disposableCleanup: result, disposableOwnerDeactivated: true }));
}

function previewProxy() {
  const temp = mkdtempSync(join(tmpdir(), "moja-s4-preview-"));
  const keyFile = join(temp, "key.pem");
  const certFile = join(temp, "cert.pem");
  cli(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", keyFile, "-out", certFile, "-subj", "/CN=" + adminHost,
    "-addext", "subjectAltName=DNS:" + adminHost + ",DNS:" + childHost]);
  const cert = readFileSync(certFile);
  const key = readFileSync(keyFile);
  rmSync(temp, { recursive: true });
  const spki = new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" });
  const pinnedKey = createHash("sha256").update(spki).digest("base64");
  const server = createServer({ cert, key }, (incoming, outgoing) => {
    const host = incoming.headers.host;
    const port = host === adminHost ? 4174 : host === childHost ? 4173 : undefined;
    const path = incoming.url;
    if (!port || !path?.startsWith("/") || path.startsWith("//") || !["GET", "HEAD"].includes(incoming.method)) {
      outgoing.writeHead(404).end();
      return;
    }
    const source = "http://127.0.0.1:" + port;
    const forwarding = request(source + path, { method: incoming.method }, response => {
      const headers = { ...response.headers };
      const csp = headers["content-security-policy"];
      if (csp) {
        headers["content-security-policy"] = csp.replace("frame-src " + source + "/", "frame-src https://" + host + "/");
      }
      outgoing.writeHead(response.statusCode ?? 500, headers);
      response.pipe(outgoing);
    });
    forwarding.on("error", () => outgoing.writeHead(502).end());
    forwarding.end();
  });
  return { server, pinnedKey };
}

function play(env) {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "playwright", "test", "-c", "tests/s4/playwright.config.ts", "--reporter=line"], {
      cwd: repo, env,
    });
    const buffers = [];
    for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => buffers.push(String(chunk)));
    child.once("error", reject);
    child.once("close", code => {
      let output = buffers.join("");
      for (const secret of secrets) output = output.replaceAll(secret, "[redacted]");
      output = output.replaceAll(/(token=)[^\s&"'<>]+/gi, "$1[redacted]")
        .replaceAll(/\b[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}\b/g, "[pairing code redacted]")
        .replaceAll(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[JWT redacted]");
      process.stdout.write(output);
      resolve(code);
    });
  });
}

let disposableId;
let preview;
let serviceKey;
try {
  const keys = preflight();
  serviceKey = keys.serviceKey;
  secrets.push(serviceKey);
  const buildEnv = { ...runnerEnv, VITE_SUPABASE_URL: origin, VITE_SUPABASE_PUBLISHABLE_KEY: keys.publicKey };
  cli(["pnpm", "build"], { env: buildEnv });
  const email = runId + "@example.com";
  const password = randomBytes(32).toString("base64url") + "A!7";
  secrets.push(email, password);
  const created = await auth(serviceKey, "", "POST", { email, password, email_confirm: true });
  assert.ok([200, 201].includes(created.status), "Disposable owner creation failed (" + created.status + ").");
  disposableId = (await created.json()).id;
  register(disposableId);
  const testEnv = { ...buildEnv, MOJA_S4_TARGET: mode, MOJA_S4_BROWSER: browser,
    MOJA_S4_RUN_ID: runId, MOJA_S4_OWNER_EMAIL: email, MOJA_S4_OWNER_PASSWORD: password };
  if (hosted) {
    preview = previewProxy();
    await new Promise((resolve, reject) => {
      preview.server.once("error", reject);
      preview.server.listen(0, "127.0.0.1", resolve);
    });
    testEnv.MOJA_S4_TEST_TLS_PORT = String(preview.server.address().port);
    testEnv.MOJA_S4_TEST_TLS_SPKI = preview.pinnedKey;
  }
  console.log(JSON.stringify({ runId, mode, browser }));
  process.exitCode = (await play(testEnv)) || 0;
} catch (error) {
  console.error(error instanceof Error && /^[\w .():,-]{1,200}$/.test(error.message) ? error.message : "S4 setup or execution failed.");
  process.exitCode = 1;
} finally {
  preview?.server.close();
  if (disposableId && serviceKey) {
    try { await closeOwner(serviceKey, disposableId); }
    catch { console.error("Disposable owner deactivation or cleanup did not complete for", runId); process.exitCode = 1; }
  }
}
