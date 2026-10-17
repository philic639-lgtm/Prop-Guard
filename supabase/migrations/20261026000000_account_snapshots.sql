-- Account snapshots + account ownership integrity.
--
-- 1. `screenshots` (existing table + private `screenshots` bucket, files under <user_id>/...)
--    now also holds account-overview snapshots: the REDACTED reference copy a trader chose
--    to keep (account numbers / emails blacked out on the device before upload), linked to
--    the account and to the update-history record it belongs to.
-- 2. Rows that point at an account (trades, sessions, plans, pending trades, events,
--    screenshots, rules) must point at an account of the SAME user. Row-level security
--    alone does not guarantee this: a foreign-key check ignores RLS, so a client could
--    otherwise attach its rows to another user's account id.

alter table public.screenshots
  add column if not exists account_id uuid references public.accounts (id) on delete cascade,
  add column if not exists kind text not null default 'trade' check (kind in ('trade', 'account')),
  add column if not exists redacted boolean not null default false,
  add column if not exists record_id text,
  add column if not exists dashboard_date date;
create index if not exists screenshots_account_idx on public.screenshots (account_id, created_at desc) where account_id is not null;

create or replace function public.assert_account_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.account_id is not null and not exists (
    select 1 from public.accounts a where a.id = new.account_id and a.user_id = new.user_id
  ) then
    raise exception 'account % does not belong to this user', new.account_id using errcode = '42501';
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['prop_rules', 'sessions', 'trades', 'discipline_events', 'trade_plans', 'pending_trades', 'screenshots'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_account_owner', t);
    execute format(
      'create trigger %I before insert or update of account_id, user_id on public.%I for each row execute function public.assert_account_owner()',
      t || '_account_owner', t
    );
  end loop;
end $$;
