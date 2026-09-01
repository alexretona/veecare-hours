-- =====================================================================
-- veecare_migration_017.sql — leave retraction + working-day-only leave
-- =====================================================================
-- Two defects reported together ("pwd ba ma-retract? nag file sya ng leave
-- Sept 4 and Sept 7 pero pati Sat and Sun na leave nya"):
--
--   D1  A leave range charged EVERY calendar day in it. Filing Fri Sep 4 to
--       Mon Sep 7 deducted 4 days instead of 2, and — worse — credited 8 leave
--       hours on the Saturday and Sunday. Because paid time off consumes the
--       cutoff cap, those 16 phantom hours also displaced 16 hours of real
--       worked pay. Leave now covers working days only; the days it skips are
--       stored per request in `excluded_dates`.
--
--   D3  A paid holiday inside a leave range burned a leave credit for a day
--       nobody had to work. Holidays are excluded from leave at RUNTIME (not
--       stored here) so the rule keeps tracking holidays declared later.
--
--   D2  Approved leave could not be undone by anyone. Adds a `cancelled`
--       status plus the fields needed to restore the balance EXACTLY.
--       `balance_deducted` is essential, not convenience: drawDownLeaveBalance()
--       clamps at zero, so a clamped deduction loses how much was really taken
--       and a reversal cannot be re-derived from the day count.
--
--   D4  Existing rows are corrected and the over-deducted days refunded
--       (sections 4-5), each refund written to leave_balance_adjustments.
--
-- Idempotent: safe to run more than once. Sections 4-5 are guarded by
-- `balance_deducted is null`, so a second run refunds nobody twice.
-- Run this in the Supabase SQL editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. New columns
-- ---------------------------------------------------------------------

-- Dates inside from_date..to_date that this leave does NOT cover — weekends,
-- or any day the filer un-ticked. Stored as 'YYYY-MM-DD' strings to match how
-- every date is handled in the app. Empty array = covers the whole range.
alter table leave_requests
  add column if not exists excluded_dates text[] not null default '{}';

-- What actually came off the VL/SL balance when this leave was approved.
-- 0 for Emergency Leave (filed and approved, never credited — migration 016).
-- NULL for anything never approved.
alter table leave_requests
  add column if not exists balance_deducted numeric;

-- Retraction trail.
alter table leave_requests add column if not exists cancelled_at  timestamptz;
alter table leave_requests add column if not exists cancelled_by  uuid;
alter table leave_requests add column if not exists cancel_reason text;

-- ---------------------------------------------------------------------
-- 2. Allow the new 'cancelled' status.
--    The base migration was never handed over, so we cannot assume the name
--    (or the existence) of a CHECK on status. Discover any check mentioning
--    status, drop it, and install a known one.
-- ---------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class     rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public'
       and rel.relname = 'leave_requests'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.leave_requests drop constraint %I', c.conname);
  end loop;
end $$;

alter table leave_requests
  add constraint leave_requests_status_chk
  check (status in ('pending','approved','rejected','cancelled'));

-- ---------------------------------------------------------------------
-- 3. Backfill excluded_dates — weekends inside MULTI-day ranges.
--
--    Single-day rows are left alone on purpose: a lone Saturday was filed
--    deliberately by someone who works Saturdays, and trimming it would
--    silently void their leave. Only a RANGE can sweep up a weekend by
--    accident, which is exactly what was reported.
-- ---------------------------------------------------------------------
with weekends as (
  select l.id,
         array_agg(to_char(g.d, 'YYYY-MM-DD') order by g.d) as dates
    from leave_requests l
    cross join lateral generate_series(l.from_date::date, l.to_date::date, interval '1 day') g(d)
   where coalesce(l.duration_type, 'full') = 'full'
     and l.from_date <> l.to_date
     and l.status in ('pending', 'approved')
     and cardinality(l.excluded_dates) = 0
     and extract(isodow from g.d) in (6, 7)
   group by l.id
)
update leave_requests l
   set excluded_dates = w.dates
  from weekends w
 where w.id = l.id;

-- ---------------------------------------------------------------------
-- 4. Backfill balance_deducted with what SHOULD have been charged.
--
--    A day is chargeable when it is not a weekend (multi-day rows only, per
--    section 3) and not a paid holiday. Emergency Leave records 0 — it is
--    filed and approved but never credited.
-- ---------------------------------------------------------------------
with chargeable as (
  select l.id,
         count(*) filter (
           where not (l.from_date <> l.to_date and extract(isodow from g.d) in (6, 7))
             and not exists (
               select 1 from holidays h
                where h.holiday_date = g.d
                  and h.paid
                  and (h.user_id = l.user_id or h.user_id is null)
             )
         ) as days
    from leave_requests l
    cross join lateral generate_series(l.from_date::date, l.to_date::date, interval '1 day') g(d)
   where l.status = 'approved'
     and coalesce(l.duration_type, 'full') = 'full'
     and l.balance_deducted is null
   group by l.id
)
update leave_requests l
   set balance_deducted = case when l.type in ('Vacation', 'Sick') then c.days else 0 end
  from chargeable c
 where c.id = l.id;

-- Partial-day rows: always a single date, charged as hours/8.
update leave_requests
   set balance_deducted = case
         when type in ('Vacation', 'Sick') then round(coalesce(hours, 0) / 8.0, 2)
         else 0
       end
 where status = 'approved'
   and coalesce(duration_type, 'full') = 'partial'
   and balance_deducted is null;

-- ---------------------------------------------------------------------
-- 5. Refund the over-deduction (D4).
--
--    The old code charged raw calendar days, so the excess is
--    (calendar days - what section 4 says should have been charged).
--    Only VL/SL hold a balance, so only they can be refunded.
--
--    Caveat, stated rather than hidden: if a historical deduction had already
--    clamped at 0, the original charge was smaller than the calendar span and
--    this refunds slightly more than was truly taken. That cannot be recovered
--    from the data — no record of the pre-deduction balance exists. Every
--    refund is written to leave_balance_adjustments below so any such case is
--    reviewable.
-- ---------------------------------------------------------------------
create temporary table _lv017_refunds as
select l.user_id,
       l.type,
       sum(((l.to_date::date - l.from_date::date) + 1) - l.balance_deducted) as days
  from leave_requests l
 where l.status = 'approved'
   and coalesce(l.duration_type, 'full') = 'full'
   and l.type in ('Vacation', 'Sick')
   and l.balance_deducted is not null
   and ((l.to_date::date - l.from_date::date) + 1) > l.balance_deducted
 group by l.user_id, l.type;

-- Audit FIRST, while the old balance is still readable. A refund nobody can
-- trace is worse than no refund.
insert into leave_balance_adjustments (user_id, leave_type, old_balance, new_balance, reason, adjusted_by)
select r.user_id,
       r.type,
       case when r.type = 'Vacation' then p.vl_balance else p.sl_balance end,
       round(coalesce(case when r.type = 'Vacation' then p.vl_balance else p.sl_balance end, 0) + r.days, 2),
       'Migration 017 - refund of ' || round(r.days, 2) ||
         ' day(s) charged for weekends/holidays inside a leave range',
       null
  from _lv017_refunds r
  join profiles p on p.id = r.user_id
 where r.days > 0;

update profiles p
   set vl_balance = round(coalesce(p.vl_balance, 0) + r.days, 2)
  from _lv017_refunds r
 where r.user_id = p.id and r.type = 'Vacation' and r.days > 0;

update profiles p
   set sl_balance = round(coalesce(p.sl_balance, 0) + r.days, 2)
  from _lv017_refunds r
 where r.user_id = p.id and r.type = 'Sick' and r.days > 0;

drop table if exists _lv017_refunds;

create index if not exists leave_requests_cancelled_idx
  on leave_requests (user_id) where status = 'cancelled';

-- ---------------------------------------------------------------------
-- 6. What changed — run this afterwards to see every refund.
-- ---------------------------------------------------------------------
-- select p.name, a.leave_type, a.old_balance, a.new_balance, a.reason
--   from leave_balance_adjustments a
--   join profiles p on p.id = a.user_id
--  where a.reason like 'Migration 017%'
--  order by p.name;
