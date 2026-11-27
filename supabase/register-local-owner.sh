#!/usr/bin/env bash
set -euo pipefail

owner_uuid=${1:-}
if [[ ! "$owner_uuid" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]; then
  printf '%s\n' 'Usage: supabase/register-local-owner.sh <existing Auth user UUID>' >&2
  exit 2
fi

container=supabase_db_moja-nauka-local
docker exec -i "$container" psql -X -q -v ON_ERROR_STOP=1 -v owner_uuid="$owner_uuid" -U postgres -d postgres <<'SQL'
begin;
insert into public.admin_users (user_id, active)
values (:'owner_uuid'::uuid, true)
on conflict (user_id) do update set active = true;
commit;
SQL
printf '%s\n' 'Registered the existing Auth UUID in the local Moja Nauka admin allowlist.'
