create function public.mn_admin_session(p_user uuid, p_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_users a
    join auth.sessions s on s.id = p_session and s.user_id = a.user_id
    where a.user_id = p_user and a.active
      and (s.not_after is null or s.not_after > statement_timestamp())
  );
$$;

create function mn_internal.require_admin(p_user uuid, p_session uuid)
returns void language plpgsql set search_path = '' as $$
begin
  if not public.mn_admin_session(p_user, p_session) then
    raise sqlstate 'PT403' using message = 'Owner access required';
  end if;
end;
$$;

create function mn_internal.bump_catalog()
returns void language sql set search_path = '' as $$
  update public.catalog_revision set revision = revision + 1, updated_at = clock_timestamp()
  where singleton;
$$;

create function public.mn_write_subject(p_user uuid, p_session uuid, p_id uuid, p_values jsonb)
returns public.subjects language plpgsql security definer set search_path = '' as $$
declare
  entry public.subjects;
begin
  perform mn_internal.require_admin(p_user, p_session);
  if p_id is null then
    insert into public.subjects (slug, name_pl, sort_order)
      values (p_values->>'slug', p_values->>'namePl', (p_values->>'sortOrder')::integer)
      returning * into entry;
  else
    update public.subjects set
      slug = coalesce(p_values->>'slug', slug),
      name_pl = coalesce(p_values->>'namePl', name_pl),
      sort_order = coalesce((p_values->>'sortOrder')::integer, sort_order),
      archived_at = case
        when not (p_values ? 'archived') then archived_at
        when (p_values->>'archived')::boolean then coalesce(archived_at, clock_timestamp())
        else null
      end
    where id = p_id returning * into entry;
    if not found then raise sqlstate 'PT404' using message = 'Subject unavailable'; end if;
  end if;
  perform mn_internal.bump_catalog();
  return entry;
end;
$$;

create function mn_internal.check_enabled_families(ids uuid[], p_require_one boolean)
returns void language plpgsql set search_path = '' as $$
begin
  if (p_require_one and cardinality(ids) = 0)
     or (select count(*) from public.families where enabled and id = any(ids)) <> cardinality(ids) then
    raise sqlstate 'PT400' using message = 'Choose enabled families';
  end if;
end;
$$;

create function mn_internal.lock_lesson(p_id uuid)
returns public.lessons language plpgsql set search_path = '' as $$
declare
  entry public.lessons;
begin
  select * into entry from public.lessons where id = p_id and deleted_at is null for update;
  if not found then raise sqlstate 'PT404' using message = 'Lesson unavailable'; end if;
  return entry;
end;
$$;

create function mn_internal.require_revision(entry public.lessons, p_expected timestamptz, p_required boolean)
returns void language plpgsql set search_path = '' as $$
begin
  if p_required and p_expected is null then
    raise sqlstate 'PT400' using message = 'expectedUpdatedAt is required';
  end if;
  if p_expected is not null and entry.updated_at <> p_expected then
    raise sqlstate 'PT409' using message = 'Lesson changed';
  end if;
end;
$$;

create function mn_internal.lesson_with_families(entry public.lessons)
returns jsonb language sql stable set search_path = '' as $$
  select to_jsonb(entry) || jsonb_build_object('family_ids', coalesce(
    (select jsonb_agg(family_id order by family_id) from public.lesson_families where lesson_id = entry.id),
    '[]'::jsonb
  ));
$$;

create function public.mn_write_lesson(p_user uuid, p_session uuid, p_id uuid, p_values jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  entry public.lessons;
  selected uuid[];
  scope text;
  was_published boolean := false;
begin
  perform mn_internal.require_admin(p_user, p_session);
  if p_id is not null then
    entry := mn_internal.lock_lesson(p_id);
    was_published := entry.status = 'published';
    perform mn_internal.require_revision(entry, (p_values->>'expectedUpdatedAt')::timestamptz, was_published);
  end if;
  scope := coalesce(p_values->>'visibility', entry.visibility, 'selected');

  if p_values ? 'familyIds' then
    select array(select value::uuid from jsonb_array_elements_text(p_values->'familyIds')) into selected;
  elsif p_id is null or entry.visibility = 'all' then
    selected := array['00000000-0000-4000-8000-000000000001'::uuid];
  else
    select array(select family_id from public.lesson_families where lesson_id = p_id) into selected;
  end if;

  if scope = 'all' then
    if p_values ? 'familyIds' and cardinality(selected) <> 0 then
      raise sqlstate 'PT400' using message = 'Family assignments require selected visibility';
    end if;
    selected := array[]::uuid[];
  else
    perform mn_internal.check_enabled_families(selected, was_published);
  end if;

  if p_id is null then
    insert into public.lessons (subject_id, title, description, grade, visibility)
    values ((p_values->>'subjectId')::uuid, p_values->>'title', p_values->>'description',
             (p_values->>'grade')::smallint, scope) returning * into entry;
  else
    update public.lessons set
      subject_id = coalesce((p_values->>'subjectId')::uuid, subject_id),
      title = coalesce(p_values->>'title', title),
      description = case when p_values ? 'description' then p_values->>'description' else description end,
      grade = case when p_values ? 'grade' then (p_values->>'grade')::smallint else grade end,
      visibility = scope,
      updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
    where id = p_id returning * into entry;
  end if;

  delete from public.lesson_families where lesson_id = entry.id and not (family_id = any(selected));
  insert into public.lesson_families (lesson_id, family_id)
    select entry.id, unnest(selected) on conflict do nothing;
  if was_published then perform mn_internal.bump_catalog(); end if;
  return mn_internal.lesson_with_families(entry);
end;
$$;

create function public.mn_publication(p_user uuid, p_session uuid, p_id uuid, p_version uuid, p_expected timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  entry public.lessons;
begin
  perform mn_internal.require_admin(p_user, p_session);
  entry := mn_internal.lock_lesson(p_id);
  perform mn_internal.require_revision(entry, p_expected, p_version is not null or entry.status = 'published');
  if p_version is not null then
    if not exists (select 1 from public.lesson_versions v where v.lesson_id = p_id and v.id = p_version) then
      raise sqlstate 'PT404' using message = 'Version unavailable';
    end if;
    if entry.visibility = 'selected' then
      if not exists (
        select 1 from public.lesson_families a join public.families f on f.id = a.family_id
        where a.lesson_id = p_id and f.enabled
      ) then
        raise sqlstate 'PT400' using message = 'Choose an enabled family';
      end if;
    end if;
    update public.lessons
      set status = 'published', active_version_id = p_version, published_at = clock_timestamp(),
          updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
      where id = p_id returning * into entry;
  else
    update public.lessons
      set status = 'unpublished',
          updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
      where id = p_id returning * into entry;
  end if;
  perform mn_internal.bump_catalog();
  return mn_internal.lesson_with_families(entry);
end;
$$;

create function public.mn_create_family(p_user uuid, p_session uuid, p_label text)
returns public.families language plpgsql security definer set search_path = '' as $$
declare
  entry public.families;
begin
  perform mn_internal.require_admin(p_user, p_session);
  insert into public.families (label) values (p_label) returning * into entry;
  return entry;
end;
$$;

create function public.mn_issue_pair(p_user uuid, p_session uuid, p_family uuid, p_hash bytea)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  issued timestamptz := clock_timestamp();
  expires timestamptz := issued + interval '15 minutes';
begin
  perform mn_internal.require_admin(p_user, p_session);
  if not exists (select 1 from public.families where id = p_family and enabled) then
    raise sqlstate 'PT404' using message = 'Family unavailable';
  end if;
  insert into public.pairing_codes (family_id, code_hash, expires_at, created_by, created_at)
    values (p_family, p_hash, expires, p_user, issued);
  return expires;
end;
$$;

create function public.mn_revoke_device(p_user uuid, p_session uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  entry public.devices;
begin
  perform mn_internal.require_admin(p_user, p_session);
  update public.devices set revoked_at = coalesce(revoked_at, clock_timestamp())
    where id = p_id returning * into entry;
  if not found then raise sqlstate 'PT404' using message = 'Device unavailable'; end if;
  return to_jsonb(entry) - 'token_hash';
end;
$$;

do $$
declare routine regprocedure;
begin
  for routine in
    select oid::regprocedure from pg_proc
    where pronamespace in ('public'::regnamespace, 'mn_internal'::regnamespace)
      and (proname like 'mn\_%' escape '\' or pronamespace = 'mn_internal'::regnamespace)
  loop
    execute format('revoke all on function %s from public, anon, authenticated', routine);
    if routine::text like 'mn\_%' escape '\' then
      execute format('grant execute on function %s to service_role', routine);
    end if;
  end loop;
end;
$$;
