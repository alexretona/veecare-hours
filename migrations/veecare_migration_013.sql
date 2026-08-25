-- =====================================================================
-- veecare_migration_013.sql — permanent holiday pay multipliers
-- =====================================================================
-- Lets HR set holiday premiums ONCE instead of retyping the holiday rate
-- on every invoice.
--
--   * org_settings          company-wide defaults (2.0x regular, 1.3x special)
--   * profiles.*_multiplier per-employee override; NULL = inherit the default
--   * holidays.holiday_type 'regular' | 'special'  (special non-working)
--   * invoices.special_*    snapshot columns so the two holiday buckets are
--                           billed and displayed separately
--
-- Idempotent: safe to run more than once.
-- Run this in the Supabase SQL editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Company-wide defaults (single row, id is pinned to 1)
-- ---------------------------------------------------------------------
create table if not exists org_settings (
  id                          int primary key default 1,
  regular_holiday_multiplier  numeric not null default 2.0,
  special_holiday_multiplier  numeric not null default 1.3,
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'org_settings_single_row'
  ) then
    alter table org_settings
      add constraint org_settings_single_row check (id = 1);
  end if;
end $$;

insert into org_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. Per-employee overrides. NULL means "use the company default", which is
--    why these are nullable with NO default — a 0 or 1 default would silently
--    wipe out the premium for everyone.
-- ---------------------------------------------------------------------
alter table profiles add column if not exists regular_holiday_multiplier numeric;
alter table profiles add column if not exists special_holiday_multiplier numeric;

-- ---------------------------------------------------------------------
-- 3. Classify holidays. Everything that already exists predates the split and
--    is treated as a regular holiday, matching how it was already being paid.
-- ---------------------------------------------------------------------
alter table holidays add column if not exists holiday_type text;
update holidays set holiday_type = 'regular' where holiday_type is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'holidays_holiday_type_chk'
  ) then
    alter table holidays
      add constraint holidays_holiday_type_chk
      check (holiday_type in ('regular','special'));
  end if;
end $$;

alter table holidays alter column holiday_type set default 'regular';
alter table holidays alter column holiday_type set not null;

-- ---------------------------------------------------------------------
-- 4. Invoice snapshot: a second holiday bucket. The existing holiday_hours /
--    holiday_rate keep their meaning and now hold the REGULAR-holiday bucket;
--    special non-working hours get their own pair so an invoice can show both
--    at their true rates. Existing invoices keep their stored values untouched.
-- ---------------------------------------------------------------------
alter table invoices add column if not exists special_holiday_hours numeric not null default 0;
alter table invoices add column if not exists special_holiday_rate  numeric not null default 0;

-- ---------------------------------------------------------------------
-- 5. RLS: everyone signed in can READ the multipliers (the employee invoice
--    request needs them to compute its own preview); only admins may change them.
-- ---------------------------------------------------------------------
alter table org_settings enable row level security;

drop policy if exists org_settings_select on org_settings;
create policy org_settings_select on org_settings
  for select using (auth.role() = 'authenticated');

drop policy if exists org_settings_update on org_settings;
create policy org_settings_update on org_settings
  for update using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  );

drop policy if exists org_settings_insert on org_settings;
create policy org_settings_insert on org_settings
  for insert with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  );
