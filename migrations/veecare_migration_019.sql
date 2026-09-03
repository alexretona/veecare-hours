-- =====================================================================
-- veecare_migration_019.sql — a one-off premium on a single holiday
-- =====================================================================
-- The three standard types (regular 2x, special non-working 1.3x, special
-- holiday 1.5x) cover the rules. They do not cover "this one date, for these
-- contractors, pays something else" — which HR asked for as a one-off.
--
-- A fourth holiday type, 'custom', carrying its own multiplier on the row.
-- It is deliberately a TYPE rather than an override on the existing three:
-- the invoice already keeps one bucket per rate so each rate prints as its own
-- auditable line, and a custom rate is simply a fourth bucket. Making it an
-- override would have meant two different rates inside one bucket, which the
-- invoice cannot show honestly.
--
-- LIMITATION, stated rather than hidden: one cutoff can show ONE custom rate.
-- Two custom-rate holidays with DIFFERENT multipliers in the same period have
-- no honest single line to print, so the app refuses to guess and warns the
-- admin instead of silently blending them into an average nobody can audit.
-- For a genuine one-off that situation should not arise; if it starts to, the
-- fix is per-holiday invoice lines, not a weighted average.
--
-- Idempotent: safe to run more than once.
-- Run this in the Supabase SQL editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The per-holiday premium. NULL for the three standard types, which
--    keep resolving through holidayMultipliers() exactly as before.
-- ---------------------------------------------------------------------
alter table holidays add column if not exists multiplier numeric;

-- ---------------------------------------------------------------------
-- 2. Allow the new type. Same discover-and-recreate shape migration 016
--    used, so this does not depend on the constraint's current contents.
-- ---------------------------------------------------------------------
alter table holidays drop constraint if exists holidays_holiday_type_chk;
alter table holidays
  add constraint holidays_holiday_type_chk
  check (holiday_type in ('regular','special','special_rest_day','custom'));

-- A custom holiday without a rate would silently pay nothing, so require it —
-- and forbid a stray multiplier on the standard types, where it would be read
-- as meaningful and then ignored.
alter table holidays drop constraint if exists holidays_custom_multiplier_chk;
alter table holidays
  add constraint holidays_custom_multiplier_chk
  check (
    (holiday_type = 'custom' and multiplier is not null and multiplier > 0)
    or
    (holiday_type <> 'custom' and multiplier is null)
  );

-- ---------------------------------------------------------------------
-- 3. The invoice bucket. Mirrors the rest_day_holiday_* columns exactly,
--    which is what keeps every total calculation symmetric.
-- ---------------------------------------------------------------------
alter table invoices add column if not exists custom_holiday_hours  numeric not null default 0;
alter table invoices add column if not exists custom_holiday_rate   numeric not null default 0;
alter table invoices add column if not exists custom_holiday_amount numeric not null default 0;

-- Existing invoices predate all of this and correctly carry 0, so they render
-- exactly as they always did. No backfill is needed or wanted.

-- ---------------------------------------------------------------------
-- 4. Check it registered:
--
--   select column_name from information_schema.columns
--    where table_name = 'invoices' and column_name like 'custom_holiday%';
--   -- expect 3 rows
--
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'holidays_holiday_type_chk';
--   -- expect ... in ('regular','special','special_rest_day','custom')
-- ---------------------------------------------------------------------
