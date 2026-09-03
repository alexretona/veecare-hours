-- =====================================================================
-- veecare_migration_020.sql — a holiday inside leave is LEAVE (reverses 017's
--                             holiday exemption)
-- =====================================================================
-- Migration 017 stopped a paid holiday inside approved leave from consuming a
-- leave credit, on the reasoning that nobody had to work that day. HR has since
-- confirmed the contractors have no such benefit: a holiday landing inside
-- approved leave is leave. The credit is consumed and it pays the plain rate,
-- with no holiday premium.
--
-- That restores the precedence this app documented all along:
--     worked entry  >  approved leave  >  paid holiday
--
-- Two things to undo:
--
--   1. `balance_deducted` was computed excluding paid holidays, so any leave
--      overlapping one recorded LESS than it should have.
--   2. Section 5 of 017 refunded the difference. Anyone who had a holiday
--      inside a leave range was handed days back that they should have kept
--      spent.
--
-- This corrects both, and writes an audit row for every balance it moves.
--
-- Idempotent: it only acts on rows where the stored deduction disagrees with
-- the corrected one, so a second run finds nothing to do.
-- Run this in the Supabase SQL editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Work out what each approved leave SHOULD have charged.
--
--    Chargeable = every day in from..to that the filer did not un-tick.
--    Weekends stay excluded (that part of 017 was correct and stands);
--    holidays no longer are.
-- ---------------------------------------------------------------------
create temporary table _lv020 as
select l.id,
       l.user_id,
       l.type,
       l.from_date,
       l.to_date,
       coalesce(l.balance_deducted, 0) as stored,
       case
         when l.type in ('Vacation', 'Sick') then
           count(*) filter (
             where not (to_char(g.d, 'YYYY-MM-DD') = any(l.excluded_dates))
           )
         else 0
       end as should_charge
  from leave_requests l
  cross join lateral generate_series(l.from_date::date, l.to_date::date, interval '1 day') g(d)
 where l.status = 'approved'
   and coalesce(l.duration_type, 'full') = 'full'
 group by l.id;

-- Only the rows that actually disagree — i.e. a paid holiday fell inside them.
delete from _lv020 where should_charge <= stored;

-- ---------------------------------------------------------------------
-- 2. Audit FIRST, while the pre-correction balance is still readable.
--    A balance that moves without a trace is worse than one that is wrong.
-- ---------------------------------------------------------------------
insert into leave_balance_adjustments
  (user_id, leave_type, old_balance, new_balance, reason, adjusted_by)
select r.user_id,
       r.type,
       case when r.type = 'Vacation' then p.vl_balance else p.sl_balance end,
       greatest(0, round(coalesce(case when r.type = 'Vacation' then p.vl_balance else p.sl_balance end, 0)
                         - (r.should_charge - r.stored), 2)),
       'Migration 020 - holiday inside leave ' || r.from_date ||
         case when r.from_date = r.to_date then '' else ' to ' || r.to_date end ||
         ' is charged as leave; reversing ' || round(r.should_charge - r.stored, 2) ||
         ' day(s) refunded in error by migration 017',
       null
  from _lv020 r
  join profiles p on p.id = r.user_id;

-- ---------------------------------------------------------------------
-- 3. Take the wrongly-refunded days back off the balance.
--    greatest(0, ...) so a balance can never go negative.
-- ---------------------------------------------------------------------
update profiles p
   set vl_balance = greatest(0, round(coalesce(p.vl_balance, 0) - (r.should_charge - r.stored), 2))
  from _lv020 r
 where r.user_id = p.id and r.type = 'Vacation';

update profiles p
   set sl_balance = greatest(0, round(coalesce(p.sl_balance, 0) - (r.should_charge - r.stored), 2))
  from _lv020 r
 where r.user_id = p.id and r.type = 'Sick';

-- ---------------------------------------------------------------------
-- 4. Record the corrected deduction on the leave itself, so a later
--    cancellation returns the right amount.
-- ---------------------------------------------------------------------
update leave_requests l
   set balance_deducted = r.should_charge
  from _lv020 r
 where r.id = l.id;

drop table if exists _lv020;

-- ---------------------------------------------------------------------
-- 5. What changed — run this afterwards.
--
--   select p.name, a.leave_type, a.old_balance, a.new_balance, a.reason
--     from leave_balance_adjustments a
--     join profiles p on p.id = a.user_id
--    where a.reason like 'Migration 020%'
--    order by p.name;
--
-- No rows means no approved leave overlapped a paid holiday, so nothing was
-- ever wrongly refunded and there was nothing to undo.
-- ---------------------------------------------------------------------
