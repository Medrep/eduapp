/* global console */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { localPsql } from "../local-runtime.mjs";
import { request } from "./local-helpers.mjs";

const route = "/functions/v1/device-api/device/v1/pair";
const invalidCode = { pairingCode: "ZZZZZ-ZZZZZ" };
const bucketCount = () => Number(localPsql("select count(*) from mn_internal.pairing_rate where scope like 'ip:%';"));

test("SEC-06 actual local gateway separates clients and overwrites caller-supplied peer addresses", async () => {
  localPsql("truncate mn_internal.pairing_rate;");
  try {
    for (const testAddress of ["192.0.2.1", "192.0.2.2"]) {
      const attempt = await request(route, {
        method: "POST", body: invalidCode, headers: { "X-Real-IP": testAddress, "X-Forwarded-For": testAddress },
      });
      assert.equal(attempt.status, 400);
      await attempt.body?.cancel();
    }
    assert.equal(bucketCount(), 1, "The same client's supplied headers must not split its rate bucket.");
    const probe = `fetch("http://supabase_kong_moja-nauka-local:8000${route}", {
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(${JSON.stringify(invalidCode)})
    }).then(r=>console.log(r.status)).catch(()=>process.exit(1));`;
    const actualOtherPeer = spawnSync("docker", ["exec", "supabase_storage_moja-nauka-local", "node", "-e", probe], {
      encoding: "utf8",
    });
    assert.equal(actualOtherPeer.status, 0);
    assert.equal(actualOtherPeer.stdout.trim(), "400");
    assert.equal(bucketCount(), 2, "Distinct local transport clients must get different buckets from Kong.");
    console.log(JSON.stringify({ distinctLocalClientSources: 2, rateBuckets: bucketCount(), callerHeadersIgnored: true }));
  } finally {
    localPsql("truncate mn_internal.pairing_rate;");
  }
});
