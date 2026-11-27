\set ON_ERROR_STOP on
begin;

do $$
declare
  relation regclass;
  routine regprocedure;
  owner_id uuid := gen_random_uuid();
  subject_id uuid;
  lesson_one uuid := gen_random_uuid();
  lesson_two uuid := gen_random_uuid();
  version_id uuid := gen_random_uuid();
begin
  foreach relation in array array[
    'public.admin_users'::regclass, 'public.families'::regclass, 'public.subjects'::regclass,
    'public.lessons'::regclass, 'public.lesson_families'::regclass, 'public.lesson_versions'::regclass,
    'public.pending_uploads'::regclass, 'public.devices'::regclass, 'public.pairing_codes'::regclass, 'public.catalog_revision'::regclass
  ] loop
    if not (select relrowsecurity from pg_class where oid = relation)
       or has_table_privilege('anon', relation, 'SELECT')
       or has_table_privilege('authenticated', relation, 'SELECT')
       or has_table_privilege('authenticated', relation, 'INSERT') then
      raise exception 'Application table lacks the expected access restrictions';
    end if;
  end loop;

  for routine in select oid::regprocedure from pg_proc where pronamespace = 'public'::regnamespace and left(proname, 3) = 'mn_'
  loop
    if has_function_privilege('anon', routine, 'EXECUTE') or has_function_privilege('authenticated', routine, 'EXECUTE')
       or not has_function_privilege('service_role', routine, 'EXECUTE') then
      raise exception 'Unexpected RPC access';
    end if;
  end loop;

  if (select count(*) from storage.buckets where id in ('lesson-staging', 'lesson-bundles') and not public
      and file_size_limit = 20971520) <> 2 then raise exception 'Private buckets are missing'; end if;
  if not exists (select 1 from public.families where id = '00000000-0000-4000-8000-000000000001' and label = 'Dom' and enabled)
  then raise exception 'Private owner family is missing'; end if;
  if (select count(*) from public.subjects where slug in ('przyroda', 'matematyka', 'jezyk-polski', 'historia', 'inne')) <> 5
  then raise exception 'Default subjects are missing'; end if;

  select id into subject_id from public.subjects where slug = 'przyroda';
  insert into auth.users (id, email) values (owner_id, owner_id::text || '@example.com');
  insert into public.lessons (id, subject_id, title) values (lesson_one, subject_id, 'Próba pierwsza'),
    (lesson_two, subject_id, 'Próba druga');
  insert into public.lesson_versions (id, lesson_id, version_number, storage_path, sha256, size_bytes, validation_report, created_by)
  values (version_id, lesson_one, 1, 'lessons/' || lesson_one || '/versions/' || version_id || '.html',
    repeat('1',64), 1, '{"valid":true}', owner_id);
  begin
    update public.lesson_versions set size_bytes = 2 where id = version_id;
    raise exception 'Version became mutable';
  exception when check_violation then null;
  end;
  begin
    update public.lessons set active_version_id = version_id, status = 'published', published_at = now() where id = lesson_two;
    raise exception 'Active version identifier crossed lesson boundaries';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.lessons set status = 'published', published_at = now() where id = lesson_one;
    raise exception 'Published lesson was allowed without an active version';
  exception when check_violation then null;
  end;
  begin
    insert into public.pairing_codes (family_id, code_hash, expires_at, created_by)
      values ('00000000-0000-4000-8000-000000000001', decode(repeat('ab',32),'hex'), now() + interval '30 minutes', owner_id);
    raise exception 'Pairing code lifetime bypassed the constraint';
  exception when check_violation then null;
  end;
  raise notice 'PASS seeded model, RLS/grants, private Storage limits, immutable version and publication/pair constraints';
end;
$$;

rollback;
