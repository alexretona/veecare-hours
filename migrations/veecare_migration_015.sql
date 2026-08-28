-- =====================================================================
-- veecare_migration_015.sql — annual leave allocations (what a reset resets TO)
-- =====================================================================
-- Migration 014 added the snapshot table for closing out a leave year, but the
-- app only ever stored REMAINING days - never the yearly entitlement. Without
-- an entitlement there is nothing to reset a balance back to, and resetting
-- everyone to a hardcoded 12/5/5 would silently wipe anyone on a negotiated
-- allocation.
--
-- Same shape as the holiday multipliers in 013: a company default, with an
-- optional per-employee override. NULL on the profile means "inherit".
--
-- Idempotent: safe to run more than once.
-- Run this in the Supabase SQL editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Company-wide default entitlement, alongside the holiday multipliers.
--    12 / 5 / 5 matches what toggleLeavesEnabled() already grants today, so
--    this changes nothing for existing staff - it just makes it configurable
--    and gives the annual reset something to aim at.
-- ---------------------------------------------------------------------
alter table org_settings add column if not exists default_vl_allocation numeric not null default 12;
alter table org_settings add column if not exists default_sl_allocation numeric not null default 5;
alter table org_settings add column if not exists default_el_allocation numeric not null default 5;

-- ---------------------------------------------------------------------
-- 2. Per-employee override. NULL = inherit the company default.
--    Deliberately NOT backfilled: anyone left NULL follows the company number,
--    so raising the company default later lifts everybody automatically.
-- ---------------------------------------------------------------------
alter table profiles add column if not exists vl_allocation numeric;
alter table profiles add column if not exists sl_allocation numeric;
alter table profiles add column if not exists el_allocation numeric;

-- ---------------------------------------------------------------------
-- 3. Record which leave year a snapshot closed, and who ran the reset.
--    leave_year_snapshots already exists from 014 with a (user_id, leave_year)
--    unique constraint, which is what makes re-running a reset for the same
--    year a no-op rather than a double-reset.
-- ---------------------------------------------------------------------
alter table leave_year_snapshots add column if not exists vl_allocation_applied numeric;
alter table leave_year_snapshots add column if not exists sl_allocation_applied numeric;
alter table leave_year_snapshots add column if not exists el_allocation_applied numeric;
