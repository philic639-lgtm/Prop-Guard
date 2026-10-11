-- =====================================================================
-- Prop Guard — account copier setup (master → followers). Additive.
-- Setup / preview only: live copying needs a connected broker integration,
-- which does not exist yet, so the app never stores 'running' without one.
-- =====================================================================

create table if not exists public.copy_groups (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'My trade copier',
  master_account_id uuid,
  followers jsonb not null default '[]',
  state text not null default 'setup' check (state in ('setup','running','paused','stopped')),
  activity jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists copy_groups_user_idx on public.copy_groups (user_id, updated_at desc);
alter table public.copy_groups enable row level security;
drop policy if exists "owner access" on public.copy_groups;
create policy "owner access" on public.copy_groups
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
