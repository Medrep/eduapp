/* global fetch, AbortSignal, console */
import { localConfig, localPsql } from "./local-runtime.mjs";

const { origin, serviceKey } = localConfig();
const cleanupEligible = `
  stage_removed_at is null
  and state <> 'uploaded'
  and greatest(expires_at, coalesce(grant_expires_at, expires_at)) < clock_timestamp() - interval '5 minutes'
`;
const rows = localPsql(`
  select temp_storage_path
  from public.pending_uploads
  where ${cleanupEligible}
  order by expires_at, id limit 100 for update skip locked;
`);
const paths = rows ? rows.split("\n") : [];
if (paths.some((path) => !/^uploads\/[0-9a-f-]{36}\.html$/.test(path))) {
  throw new Error("Unexpected staged path.");
}
if (paths.length) {
  const reply = await fetch(origin + "/storage/v1/object/lesson-staging", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      ...(!serviceKey.startsWith("sb_") ? { Authorization: `Bearer ${serviceKey}` } : {}),
    },
    body: JSON.stringify({ prefixes: paths }),
    signal: AbortSignal.timeout(45000),
    redirect: "error",
  });
  await reply.body?.cancel();
  if (!reply.ok) throw new Error(`Local staged cleanup did not complete (${reply.status}).`);
  localPsql(`
    update public.pending_uploads
    set stage_removed_at = clock_timestamp(),
        state = case when state = 'finalized' then state else 'failed' end
    where temp_storage_path = any(string_to_array(:'selected', ','))
      and ${cleanupEligible};
  `, { selected: paths.join(",") });
}
console.log(JSON.stringify({ localOnly: true, expiredStagedObjectsProcessed: paths.length }));
