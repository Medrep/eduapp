\set ON_ERROR_STOP on
begin read only;

do $audit$
declare
  table_name text;
  app_tables text[] := array[
    'admin_users', 'families', 'subjects', 'lessons', 'lesson_families',
    'lesson_versions', 'pending_uploads', 'devices', 'pairing_codes', 'catalog_revision'
  ];
  app_role text;
  protected_table regclass;
  grant_name text;
  definer record;
begin
  foreach table_name in array app_tables loop
    protected_table := to_regclass(format('public.%I', table_name));
    if protected_table is null or not (select relrowsecurity from pg_class where oid = protected_table) then
      raise exception 'App table missing or RLS disabled: %', table_name;
    end if;
    foreach app_role in array array['anon', 'authenticated'] loop
      foreach grant_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
        if has_table_privilege(app_role, protected_table, grant_name) then
          raise exception 'Unexpected browser table privilege: % % %', app_role, grant_name, table_name;
        end if;
      end loop;
    end loop;
  end loop;

  for definer in
    select p.oid, p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    if has_function_privilege('anon', definer.oid, 'EXECUTE')
      or has_function_privilege('authenticated', definer.oid, 'EXECUTE') then
      raise exception 'Unexpected browser EXECUTE on privileged RPC: %', definer.signature;
    end if;
  end loop;

  if (select count(*) from storage.buckets
       where id in ('lesson-staging', 'lesson-bundles') and not public) <> 2 then
    raise exception 'Required private staging and final buckets were not both created';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
    raise exception 'Storage object RLS is disabled';
  end if;
end
$audit$;

select 'RLS and denied direct grants verified on 10 application tables' as observed;
select id, public, file_size_limit from storage.buckets where id in ('lesson-staging', 'lesson-bundles') order by id;
select 'Seed subjects present' as observed, count(*) as count
from public.subjects where slug in ('przyroda', 'matematyka', 'jezyk-polski', 'historia', 'inne');
select 'Enabled owner family seed present' as observed, exists(select 1 from public.families where label = 'Dom' and enabled);
commit;
