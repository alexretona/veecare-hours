-- =====================================================================
-- veecare_migration_021.sql — holiday premiums apply to WORKED hours
-- =====================================================================
-- HR's rule, confirmed by the owner on 2026-09-14:
--
--   Paid holiday, did NOT clock in  ->  the holiday's hours at the plain rate
--   Paid holiday, DID clock in      ->  the hours worked at that type's premium
--                                       (regular 2x, special non-working 1.3x,
--                                       special holiday 1.5x, one-off N x)
--   Unpaid holiday, DID clock in    ->  plain rate, no premium
--
-- Until now the app had it the other way round: the premium multiplied the
-- UNWORKED day, and working on a holiday earned nothing extra - the time entry
-- simply won and the holiday was ignored. The four holiday buckets on an
-- invoice therefore change meaning: they now hold hours WORKED on a holiday.
--
-- The unworked day needs a bucket of its own so it prints as its own line
-- ("didn't reflect on her end" was exactly a hidden bucket). It pays at the
-- base rate, so it needs hours only - the rate is the invoice's own.
--
-- Idempotent: safe to run more than once.
-- Run this in the Supabase SQL editor.
-- =====================================================================

alter table invoices
  add column if not exists holiday_off_hours numeric not null default 0;

-- Existing invoices predate the rule change and correctly carry 0 here. They
-- were computed under the old model and stay as issued - an invoice is a
-- snapshot. Only invoices generated from now on use the new rule.

-- Check it registered:
--   select column_name from information_schema.columns
--    where table_name = 'invoices' and column_name = 'holiday_off_hours';
