-- =====================================================================
-- veecare_migration_014.sql — leave balances: EL, admin adjustment,
--                             pre-system backfill, annual reset history
-- =====================================================================
-- The tool went live mid-2026, so staff had already taken VL/SL earlier in the
-- year outside the system and their in-app balances are too high. This adds:
--
--   * profiles.el_balance            Emergency Leave now has a balance (default 5)
--   * leave_requests.is_backfill     marks leave taken BEFORE the tool existed
--   * leave_balance_adjustments      audit of every manual balance change
--   * leave_year_snapshots           prior-year balances, kept for admins only
--
-- Idempotent: safe to run more than once.
-- Run this in the Supabase SQL editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Emergency Leave balance.
--    Nullable with no default: NULL means "never configured". Only employees
--    who already have leaves switched on get the 5-day starting allocation, so
--    this cannot silently hand leave credits to someone who should not have any.
-- ---------------------------------------------------------------------
alter table profiles add column if not exists el_balance numeric;

update profiles
   set el_balance = 5
 where el_balance is null
   and leaves_enabled = true;

-- ---------------------------------------------------------------------
-- 2. Backfilled (pre-system) leave.
--    These are real leave_requests rows so they appear in history and draw down
--    the balance like any other approved leave — but flagged, because they were
--    never actually requested or approved inside the app.
-- ---------------------------------------------------------------------
alter table leave_requests add column if not exists is_backfill boolean not null default false;
alter table leave_requests add column if not exists backfill_note text;

create index if not exists leave_requests_backfill_idx
  on leave_requests (user_id) where is_backfill;

-- ---------------------------------------------------------------------
-- 3. Audit trail for manual balance edits.
--    Balances feed payroll, so every hand adjustment records who/when/why and
--    both the old and new value. There is no audit of this today at all.
-- ---------------------------------------------------------------------
create table if not exists leave_balance_adjustments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  leave_type   text not null,
  old_balance  numeric,
  new_balance  numeric,
  reason       text not null,
  leave_year   int  not null default extract(year from now()),
  adjusted_by  uuid,
  adjusted_at  timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lba_leave_type_chk') then
    alter table leave_balance_adjustments
      add constraint lba_leave_type_chk
      check (leave_type in ('Vacation','Sick','Emergency'));
  end if;
end $$;

create index if not exists lba_user_idx on leave_balance_adjustments (user_id, adjusted_at desc);

-- ---------------------------------------------------------------------
-- 4. Year-end snapshots.
--    Balances reset each January; this preserves what each employee finished
--    the previous year with. Admin-visible only — employees see the current
--    year. The reset job itself is a later change; this is the store it needs.
-- ---------------------------------------------------------------------
create table if not exists leave_year_snapshots (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  leave_year   int  not null,
  vl_balance   numeric,
  sl_balance   numeric,
  el_balance   numeric,
  snapshot_at  timestamptz not null default now(),
  snapshot_by  uuid
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lys_user_year_uniq') then
    alter table leave_year_snapshots
      add constraint lys_user_year_uniq unique (user_id, leave_year);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. RLS.
--    Adjustments and snapshots are ADMIN-ONLY in both directions — an employee
--    must not see last year's balances or who edited them.
-- ---------------------------------------------------------------------
alter table leave_balance_adjustments enable row level security;
alter table leave_year_snapshots      enable row level security;

drop policy if exists lba_admin_all on leave_balance_adjustments;
create policy lba_admin_all on leave_balance_adjustments
  for all
  using      (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists lys_admin_all on leave_year_snapshots;
create policy lys_admin_all on leave_year_snapshots
  for all
  using      (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
