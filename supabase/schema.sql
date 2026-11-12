-- Coach App: database schema for Supabase (Postgres).
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run.

-- Profiles: one per signed-up user, created automatically from sign-up metadata.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('coach', 'member')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
    case when new.raw_user_meta_data ->> 'role' = 'coach' then 'coach' else 'member' end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Workout data. Ids are generated on the device so rows can be created offline.
-- updated_at is set by the device; sync resolves conflicts by last write wins.
create table if not exists public.workouts (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  updated_at timestamptz not null,
  deleted boolean not null default false
);

create table if not exists public.workout_exercises (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  workout_id uuid not null references public.workouts (id) on delete cascade,
  exercise_name text not null,
  position integer not null,
  updated_at timestamptz not null,
  deleted boolean not null default false
);

create table if not exists public.sets (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  workout_id uuid not null references public.workouts (id) on delete cascade,
  workout_exercise_id uuid not null references public.workout_exercises (id) on delete cascade,
  position integer not null,
  weight_kg numeric(6, 2) check (weight_kg is null or weight_kg >= 0),
  reps integer check (reps is null or reps >= 0),
  done boolean not null default false,
  updated_at timestamptz not null,
  deleted boolean not null default false
);

create index if not exists workouts_user_updated on public.workouts (user_id, updated_at);
create index if not exists workout_exercises_user_updated on public.workout_exercises (user_id, updated_at);
create index if not exists sets_user_updated on public.sets (user_id, updated_at);

-- Row-level security: every user sees and changes only their own rows (T03).
-- Coach access to members' data is added in M2, once subscriptions link coaches to members.
alter table public.profiles enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.sets enable row level security;

drop policy if exists "Own profile: read" on public.profiles;
create policy "Own profile: read" on public.profiles for select using (auth.uid() = id);
drop policy if exists "Own profile: update name" on public.profiles;
create policy "Own profile: update name" on public.profiles for update using (auth.uid() = id)
  with check (auth.uid() = id and role = (select p.role from public.profiles p where p.id = auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['workouts', 'workout_exercises', 'sets'] loop
    execute format('drop policy if exists "Own rows" on public.%I', t);
    execute format(
      'create policy "Own rows" on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t
    );
  end loop;
end $$;

-- ============================================================
-- M2: coaches, programmes, versions, enrolments.
-- Safe to run again on a project that already has M1.
-- ============================================================

create table if not exists public.coach_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade check (user_id = id),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  display_name text not null,
  bio text not null default '',
  specialism text not null default '',
  price_gbp numeric(8, 2) not null check (price_gbp >= 1 and price_gbp <= 500),
  featured_programme_id uuid,
  -- Public summaries of published programmes: [{programmeId, title, description, weeks, daysPerWeek}].
  offers jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null,
  deleted boolean not null default false
);

-- Drafts live here and are visible to the coach only.
create table if not exists public.programmes (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text not null default '',
  draft jsonb not null,
  latest_version integer not null default 0,
  updated_at timestamptz not null,
  deleted boolean not null default false
);

-- Published snapshots. Never edited after publishing; a new publish adds a new row.
create table if not exists public.programme_versions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  programme_id uuid not null references public.programmes (id) on delete cascade,
  version integer not null,
  title text not null,
  content jsonb not null,
  published_at timestamptz not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  unique (programme_id, version)
);

-- A member following a coach. user_id is the member.
create table if not exists public.enrolments (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  coach_id uuid not null references public.coach_profiles (id) on delete cascade,
  programme_id uuid not null references public.programmes (id) on delete cascade,
  member_name text not null,
  status text not null check (status in ('active', 'cancelled')),
  started_at timestamptz not null,
  updated_at timestamptz not null,
  deleted boolean not null default false
);

alter table public.workouts add column if not exists enrolment_id uuid references public.enrolments (id) on delete set null;
alter table public.workouts add column if not exists programme_version_id uuid references public.programme_versions (id) on delete set null;
alter table public.workouts add column if not exists week_index integer;
alter table public.workouts add column if not exists day_index integer;
alter table public.workout_exercises add column if not exists target jsonb;

create index if not exists coach_profiles_updated on public.coach_profiles (updated_at);
create index if not exists programme_versions_programme on public.programme_versions (programme_id, updated_at);
create index if not exists enrolments_member on public.enrolments (user_id, updated_at);
create index if not exists enrolments_coach on public.enrolments (coach_id, updated_at);

alter table public.coach_profiles enable row level security;
alter table public.programmes enable row level security;
alter table public.programme_versions enable row level security;
alter table public.enrolments enable row level security;

-- Coach pages are public (the share link works signed out). Only the coach edits theirs.
drop policy if exists "Coach pages: anyone reads" on public.coach_profiles;
create policy "Coach pages: anyone reads" on public.coach_profiles for select using (deleted = false or auth.uid() = user_id);
drop policy if exists "Coach pages: owner writes" on public.coach_profiles;
create policy "Coach pages: owner writes" on public.coach_profiles for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'coach'));

drop policy if exists "Own rows" on public.programmes;
create policy "Own rows" on public.programmes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Versions: the coach, plus members actively enrolled in that programme.
drop policy if exists "Versions: coach" on public.programme_versions;
create policy "Versions: coach" on public.programme_versions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Versions: enrolled members read" on public.programme_versions;
create policy "Versions: enrolled members read" on public.programme_versions for select using (
  exists (select 1 from public.enrolments e
          where e.user_id = auth.uid() and e.programme_id = programme_versions.programme_id
            and e.status = 'active' and not e.deleted)
);

-- Enrolments: the member manages theirs; the coach can see who follows them.
drop policy if exists "Enrolments: member" on public.enrolments;
create policy "Enrolments: member" on public.enrolments for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'member'));
drop policy if exists "Enrolments: coach reads" on public.enrolments;
create policy "Enrolments: coach reads" on public.enrolments for select using (auth.uid() = coach_id);

-- Coaches read the full training logs of members actively enrolled with them (read only).
do $$
declare t text;
begin
  foreach t in array array['workouts', 'workout_exercises', 'sets'] loop
    execute format('drop policy if exists "Coach reads members" on public.%I', t);
    execute format(
      'create policy "Coach reads members" on public.%I for select using (exists (
         select 1 from public.enrolments e
         where e.coach_id = auth.uid() and e.user_id = %I.user_id and e.status = ''active'' and not e.deleted))', t, t
    );
  end loop;
end $$;
