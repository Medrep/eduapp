/* global URL, process */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));

export function localConfig() {
  const cli = spawnSync("supabase", ["status", "-o", "json"], {
    cwd: repo, env: { ...process.env, DO_NOT_TRACK: "1" }, encoding: "utf8",
  });
  if (cli.status !== 0) throw new Error("The dedicated local Supabase stack is not available.");
  const status = JSON.parse(cli.stdout);
  const api = new URL(status.API_URL);
  assert.equal(api.origin, "http://127.0.0.1:54321", "Only the dedicated loopback API may be used.");
  return { origin: api.origin, publicKey: status.ANON_KEY || status.PUBLISHABLE_KEY,
    serviceKey: status.SERVICE_ROLE_KEY || status.SECRET_KEY };
}


export function localPsql(sql, parameters = {}) {
  const bind = Object.entries(parameters).flatMap(([name, value]) => ["-v", `${name}=${value}`]);
  const result = spawnSync("docker", ["exec", "-i", "supabase_db_moja-nauka-local",
    "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", ...bind], {
    input: sql, encoding: "utf8",
  });
  if (result.status !== 0) throw new Error("The dedicated local database command failed.");
  return result.stdout.trim();
}
