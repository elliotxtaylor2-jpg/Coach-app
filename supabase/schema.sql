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
