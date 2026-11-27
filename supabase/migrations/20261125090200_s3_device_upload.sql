create function mn_internal.take_pair_attempt(p_scope text, p_limit integer, p_now timestamptz)
returns boolean language sql set search_path = '' as $$
  insert into mn_internal.pairing_rate as slot (scope, window_start, attempts)
  values (p_scope, date_bin(interval '1 minute', p_now, '2000-01-01 00:00:00Z'::timestamptz), 1)
  on conflict (scope) do update set
    window_start = greatest(slot.window_start, excluded.window_start),
    attempts = case when slot.window_start < excluded.window_start then 1
      else least(slot.attempts + 1, p_limit + 1) end
  returning attempts <= p_limit;
$$;

create function public.mn_consume_pair(p_hash bytea, p_ip_hash text, p_token_hash bytea, p_label text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  issued_at timestamptz := clock_timestamp();
  code public.pairing_codes;
  household public.families;
  device public.devices;
begin
  if not mn_internal.take_pair_attempt('global', 100, issued_at) then
    return jsonb_build_object('status', 429);
  end if;
  if not mn_internal.take_pair_attempt('ip:' || p_ip_hash, 10, issued_at) then
    return jsonb_build_object('status', 429);
  end if;
  delete from mn_internal.pairing_rate where window_start < issued_at - interval '5 minutes';

  select * into code from public.pairing_codes where code_hash = p_hash for update;
  if not found then return jsonb_build_object('status', 400); end if;
  if code.attempts >= 5 then return jsonb_build_object('status', 429); end if;
  select * into household from public.families where id = code.family_id and enabled for share;
  if not found or code.expires_at <= clock_timestamp() or code.consumed_at is not null then
    update public.pairing_codes set attempts = attempts + 1 where id = code.id;
    return jsonb_build_object('status', 400);
  end if;

  update public.pairing_codes set consumed_at = clock_timestamp() where id = code.id;
  insert into public.devices (family_id, label, token_hash) values (code.family_id, p_label, p_token_hash)
    returning * into device;
  return jsonb_build_object('status', 200, 'deviceId', device.id, 'familyId', household.id,
    'familyLabel', household.label, 'serverTime', clock_timestamp());
end;
$$;

create function mn_internal.device_family(p_hash bytea)
returns public.families language plpgsql stable set search_path = '' as $$
declare
  device public.devices;
  household public.families;
begin
  select * into device from public.devices where token_hash = p_hash;
  if not found then raise sqlstate 'PT401' using message = 'Authentication required'; end if;
  select * into household from public.families where id = device.family_id and enabled;
  if not found or device.revoked_at is not null then
    raise sqlstate 'PT403' using message = 'Device access denied';
  end if;
  return household;
end;
$$;

create function mn_internal.visible_lessons(p_family uuid)
returns setof public.lessons language sql stable set search_path = '' as $$
  select l.* from public.lessons l
  where l.deleted_at is null and l.status = 'published' and (
    l.visibility = 'all'
    or exists (select 1 from public.lesson_families f where f.lesson_id = l.id and f.family_id = p_family)
  );
$$;

create function public.mn_authorized_catalog(p_hash bytea)
returns jsonb language sql stable security definer set search_path = '' as $$
  with household as materialized (select h.* from mn_internal.device_family(p_hash) h),
  visible as materialized (
    select l.* from household h cross join lateral mn_internal.visible_lessons(h.id) l
  )
  select jsonb_build_object(
    'schemaVersion', 1, 'revision', r.revision, 'generatedAt', statement_timestamp(),
    'family', jsonb_build_object('id', h.id, 'label', h.label),
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'slug', s.slug, 'namePl', s.name_pl,
        'sortOrder', s.sort_order) order by s.sort_order, s.name_pl, s.id)
      from public.subjects s where exists (select 1 from visible where subject_id = s.id)
    ), '[]'::jsonb),
    'lessons', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'subjectId', l.subject_id, 'title', l.title,
        'description', l.description, 'grade', l.grade, 'publishedAt', l.published_at,
        'version', jsonb_build_object('id', v.id, 'number', v.version_number,
          'sha256', v.sha256, 'sizeBytes', v.size_bytes)) order by l.published_at desc, l.id)
      from visible l join public.lesson_versions v on v.id = l.active_version_id
    ), '[]'::jsonb)
  )
  from public.catalog_revision r cross join household h where r.singleton;
$$;

create function public.mn_device_download(p_hash bytea, p_lesson uuid, p_version uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  household public.families := mn_internal.device_family(p_hash);
  version public.lesson_versions;
begin
  select v.* into version
    from mn_internal.visible_lessons(household.id) l
    join public.lesson_versions v on v.id = l.active_version_id
    where l.id = p_lesson and v.id = p_version;
  if not found then raise sqlstate 'PT404' using message = 'Lesson version unavailable'; end if;
  return jsonb_build_object('path', version.storage_path, 'sha256', version.sha256, 'sizeBytes', version.size_bytes);
end;
$$;

create function public.mn_begin_upload(
  p_user uuid, p_session uuid, p_lesson uuid, p_id uuid, p_hash text, p_size integer
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform mn_internal.require_admin(p_user, p_session);
  perform mn_internal.lock_lesson(p_lesson);
  insert into public.pending_uploads (id, lesson_id, temp_storage_path, expected_sha256, expected_size_bytes, expires_at, created_by)
  values (p_id, p_lesson, 'uploads/' || p_id || '.html', p_hash, p_size, clock_timestamp() + interval '2 hours', p_user);
end;
$$;

create function public.mn_record_upload_grant(
  p_user uuid, p_session uuid, p_lesson uuid, p_id uuid, p_grant_expires_at timestamptz
)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  usable_until timestamptz;
begin
  perform mn_internal.require_admin(p_user, p_session);
  update public.pending_uploads
  set grant_expires_at = p_grant_expires_at, expires_at = least(expires_at, p_grant_expires_at)
  where id = p_id and lesson_id = p_lesson and created_by = p_user and state = 'issued'
    and grant_expires_at is null and stage_removed_at is null
    and expires_at > clock_timestamp() and isfinite(p_grant_expires_at) and p_grant_expires_at > clock_timestamp()
  returning expires_at into usable_until;
  if not found then raise sqlstate 'PT409' using message = 'Upload unavailable'; end if;
  perform mn_internal.require_admin(p_user, p_session);
  return usable_until;
end;
$$;

create function public.mn_get_upload(p_user uuid, p_session uuid, p_lesson uuid, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  entry public.pending_uploads;
begin
  perform mn_internal.require_admin(p_user, p_session);
  select * into entry from public.pending_uploads
    where id = p_id and lesson_id = p_lesson and created_by = p_user;
  if not found then raise sqlstate 'PT404' using message = 'Upload unavailable'; end if;
  if entry.state = 'finalized' then
    return jsonb_build_object('version', (select to_jsonb(v) from public.lesson_versions v where v.id = p_id));
  end if;
  if entry.state = 'failed' or entry.grant_expires_at is null or entry.stage_removed_at is not null or
      (entry.state = 'issued' and entry.expires_at <= statement_timestamp()) then
    raise sqlstate 'PT409' using message = 'Upload unavailable';
  end if;
  return to_jsonb(entry);
end;
$$;

create function public.mn_reject_upload(p_user uuid, p_session uuid, p_lesson uuid, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform mn_internal.require_admin(p_user, p_session);
  update public.pending_uploads
  set state = 'failed'
  where id = p_id and lesson_id = p_lesson and created_by = p_user and state = 'issued'
    and expires_at > clock_timestamp();
end;
$$;

create function public.mn_reserve_upload(p_user uuid, p_session uuid, p_lesson uuid, p_id uuid, p_report jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  entry public.pending_uploads;
  reserved timestamptz;
begin
  perform mn_internal.require_admin(p_user, p_session);
  select * into entry from public.pending_uploads
    where id = p_id and lesson_id = p_lesson and created_by = p_user for update;
  if not found then raise sqlstate 'PT404' using message = 'Upload unavailable'; end if;
  perform mn_internal.require_admin(p_user, p_session);
  if entry.state = 'finalized' then
    return jsonb_build_object('version', (select to_jsonb(v) from public.lesson_versions v where v.id = p_id));
  end if;
  if entry.state = 'uploaded' then return null; end if;
  reserved := clock_timestamp();
  if entry.state <> 'issued' or entry.grant_expires_at is null or entry.stage_removed_at is not null or
      entry.expires_at <= reserved then
    raise sqlstate 'PT409' using message = 'Upload unavailable';
  end if;
  update public.pending_uploads
    set state = 'uploaded', reserved_at = reserved, validation_report = p_report
    where id = p_id;
  return null;
end;
$$;

create function public.mn_finish_upload(p_user uuid, p_session uuid, p_lesson uuid, p_id uuid)
returns public.lesson_versions language plpgsql security definer set search_path = '' as $$
declare
  entry public.pending_uploads;
  version public.lesson_versions;
  destination text := 'lessons/' || p_lesson || '/versions/' || p_id || '.html';
begin
  perform mn_internal.require_admin(p_user, p_session);
  perform mn_internal.lock_lesson(p_lesson);
  select * into entry from public.pending_uploads
    where id = p_id and lesson_id = p_lesson and created_by = p_user for update;
  if not found then raise sqlstate 'PT404' using message = 'Upload unavailable'; end if;
  perform mn_internal.require_admin(p_user, p_session);
  if entry.state = 'finalized' then
    select * into strict version from public.lesson_versions where id = p_id;
    return version;
  end if;
  if entry.state <> 'uploaded' or entry.reserved_at is null then
    raise sqlstate 'PT409' using message = 'Upload unavailable';
  end if;
  if not exists (
    select 1 from storage.objects where bucket_id = 'lesson-bundles' and name = destination
      and (metadata->>'size')::bigint = entry.expected_size_bytes
  ) then
    raise sqlstate 'PT503' using message = 'Verified object unavailable';
  end if;

  insert into public.lesson_versions (id, lesson_id, version_number, storage_path, sha256, size_bytes, validation_report, created_by)
  values (p_id, p_lesson,
    1 + (select coalesce(max(version_number), 0) from public.lesson_versions where lesson_id = p_lesson),
    destination, entry.expected_sha256, entry.expected_size_bytes, entry.validation_report, p_user
  ) returning * into version;
  update public.pending_uploads set state = 'finalized' where id = p_id;
  return version;
end;
$$;

do $$
declare item record;
begin
  for item in
    select oid::regprocedure as routine, pronamespace = 'public'::regnamespace as api
    from pg_proc
    where pronamespace = 'mn_internal'::regnamespace
      or (pronamespace = 'public'::regnamespace and left(proname, 3) = 'mn_')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', item.routine);
    if item.api then execute format('grant execute on function %s to service_role', item.routine); end if;
  end loop;
end;
$$;
