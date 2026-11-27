create schema mn_internal;
revoke all on schema mn_internal from public, anon, authenticated;

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.families (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,50}$'),
  name_pl text not null check (char_length(btrim(name_pl)) between 1 and 60),
  sort_order integer not null default 0,
  archived_at timestamptz
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text check (char_length(description) <= 500),
  grade smallint check (grade between 1 and 8),
  visibility text not null default 'selected' check (visibility in ('selected', 'all')),
  status text not null default 'draft' check (status in ('draft', 'published', 'unpublished')),
  active_version_id uuid,
  published_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'published' or
    (active_version_id is not null and published_at is not null and deleted_at is null))
);

create table public.lesson_families (
  lesson_id uuid not null references public.lessons(id),
  family_id uuid not null references public.families(id),
  primary key (lesson_id, family_id)
);

create table public.lesson_versions (
  id uuid primary key,
  lesson_id uuid not null references public.lessons(id),
  version_number integer not null check (version_number > 0),
  storage_path text not null unique,
  sha256 char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes integer not null check (size_bytes between 1 and 20971520),
  validation_state text not null default 'valid' check (validation_state = 'valid'),
  validation_report jsonb not null check (jsonb_typeof(validation_report) = 'object'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (lesson_id, version_number),
  unique (lesson_id, id),
  check (storage_path = 'lessons/' || lesson_id || '/versions/' || id || '.html')
);

alter table public.lessons add constraint active_version_belongs_to_lesson
  foreign key (id, active_version_id) references public.lesson_versions(lesson_id, id);

create table public.pending_uploads (
  id uuid primary key,
  lesson_id uuid not null references public.lessons(id),
  temp_storage_path text not null unique check (temp_storage_path = 'uploads/' || id || '.html'),
  expected_sha256 char(64) not null check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  expected_size_bytes integer not null check (expected_size_bytes between 1 and 20971520),
  state text not null default 'issued' check (state in ('issued', 'uploaded', 'finalized', 'failed')),
  stage_removed_at timestamptz,
  grant_expires_at timestamptz,
  reserved_at timestamptz,
  validation_report jsonb,
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (grant_expires_at is null or (isfinite(grant_expires_at) and expires_at <= grant_expires_at)),
  check ((state in ('uploaded', 'finalized')) = (reserved_at is not null and validation_report is not null)),
  check (reserved_at is null or (grant_expires_at is not null and reserved_at <= expires_at)),
  check (validation_report is null or jsonb_typeof(validation_report) = 'object')
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.pairing_codes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id),
  code_hash bytea not null unique check (octet_length(code_hash) = 32),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (expires_at = created_at + interval '15 minutes')
);

create table public.catalog_revision (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

create table mn_internal.pairing_rate (
  scope text primary key,
  window_start timestamptz not null,
  attempts integer not null check (attempts > 0)
);

create index lessons_subject_status_updated_idx on public.lessons(subject_id, status, updated_at);
create index lesson_families_family_idx on public.lesson_families(family_id, lesson_id);
create index pending_uploads_expiry_idx on public.pending_uploads(expires_at);
create index pairing_codes_expiry_idx on public.pairing_codes(expires_at);

do $$
declare
  target regclass;
begin
  foreach target in array array[
    'public.admin_users'::regclass, 'public.families'::regclass, 'public.subjects'::regclass,
    'public.lessons'::regclass, 'public.lesson_families'::regclass, 'public.lesson_versions'::regclass,
    'public.pending_uploads'::regclass, 'public.devices'::regclass, 'public.pairing_codes'::regclass,
    'public.catalog_revision'::regclass, 'mn_internal.pairing_rate'::regclass
  ] loop
    execute format('alter table %s enable row level security', target);
    execute format('revoke all on table %s from public, anon, authenticated, service_role', target);
  end loop;
end;
$$;
grant select on public.families, public.subjects, public.lessons, public.lesson_families,
  public.lesson_versions, public.devices to service_role;

create function mn_internal.protect_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '23514', message = 'Lesson versions are immutable';
end;
$$;
create trigger immutable_lesson_version before update or delete on public.lesson_versions
  for each row execute function mn_internal.protect_version();

insert into public.catalog_revision default values;
insert into public.families (id, label) values ('00000000-0000-4000-8000-000000000001', 'Dom');
insert into public.subjects (slug, name_pl, sort_order) values
  ('przyroda', 'Przyroda', 10), ('matematyka', 'Matematyka', 20),
  ('jezyk-polski', 'Język polski', 30), ('historia', 'Historia', 40), ('inne', 'Inne', 50);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('lesson-staging', 'lesson-staging', false, 20971520, array['text/html']),
  ('lesson-bundles', 'lesson-bundles', false, 20971520, array['application/octet-stream']);

create policy deny_direct_lesson_objects on storage.objects as restrictive for all to anon, authenticated
  using (bucket_id not in ('lesson-bundles', 'lesson-staging'))
  with check (bucket_id not in ('lesson-bundles', 'lesson-staging'));
create policy deny_direct_lesson_buckets on storage.buckets as restrictive for all to anon, authenticated
  using (id not in ('lesson-bundles', 'lesson-staging'))
  with check (id not in ('lesson-bundles', 'lesson-staging'));

revoke all on function mn_internal.protect_version() from public, anon, authenticated;
