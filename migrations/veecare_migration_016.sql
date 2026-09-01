-- =====================================================================
-- veecare_migration_016.sql — 1.5x rest-day holiday type; remove EL credits
-- =====================================================================
-- Two stakeholder decisions:
--
--   R1  A third holiday category paying 1.5x, chosen like the other two rather
--       than only available as a per-person override. PH rule: a special
--       non-working day falling on a rest day pays 150%. Per-employee
--       overrides stay (decision C = both).
--
--   R2  Emergency Leave should NOT be credited. EL becomes an untracked leave
--       type: employees file it, admins approve it, nothing is deducted.
--       Balances are cleared and the columns dropped.
--
-- ⚠ SECTION 2 IS DESTRUCTIVE. It drops the EL balance/allocation columns and
--   the EL fields on year-end snapshots. That data cannot be recovered. This
--   is the explicit instruction ("clear it" / "drop them"), and EL balances
--   only ever held the default 5 seeded by migration 014.
--
-- Idempotent: safe to run more than once.
-- Run this in the Supabase SQL editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. R1 — the 1.5x rest-day holiday
-- ---------------------------------------------------------------------

-- Company default, alongside the 2.0 / 1.3 from migration 013.
alter table org_settings
  add column if not exists rest_day_holiday_multiplier numeric not null default 1.5;

-- Per-employee override. NULL = inherit the company default, same as the others.
alter table profiles
  add column if not exists rest_day_holiday_multiplier numeric;

-- Widen the allowed holiday types. Drop the old constraint first so this can
-- be re-run; existing 'regular'/'special' rows stay valid either way.
alter table holidays drop constraint if exists holidays_holiday_type_chk;
alter table holidays
  add constraint holidays_holiday_type_chk
  check (holiday_type in ('regular','special','special_rest_day'));

-- Invoice snapshot: a third holiday bucket so all three can be billed and
-- displayed at their own rate. Existing invoices default to 0 and render
-- exactly as they do today.
alter table invoices add column if not exists rest_day_holiday_hours numeric not null default 0;
alter table invoices add column if not exists rest_day_holiday_rate  numeric not null default 0;

-- ---------------------------------------------------------------------
-- 2. R2 — remove Emergency Leave credits  (DESTRUCTIVE)
-- ---------------------------------------------------------------------
-- Clear balances first so the intent is recorded even if a later step is
-- edited out; the drops below make this redundant but harmless.
update profiles set el_balance = null where el_balance is not null;

alter table profiles            drop column if exists el_balance;
alter table profiles            drop column if exists el_allocation;
alter table org_settings        drop column if exists default_el_allocation;

-- Year-end snapshots carried an EL figure too. leave_year_snapshots is only
-- written by the annual reset, which has not run yet, so this is almost
-- certainly empty - but it is still a drop, hence the warning above.
alter table leave_year_snapshots drop column if exists el_balance;
alter table leave_year_snapshots drop column if exists el_allocation_applied;

-- leave_balance_adjustments keeps any historical 'Emergency' audit rows on
-- purpose: they record what was done at the time and are not corrected
-- (stakeholder: "no correction needed"). The CHECK still allows the value so
-- those rows remain readable.
