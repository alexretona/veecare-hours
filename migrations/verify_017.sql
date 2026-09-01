-- =====================================================================
-- verify_017.sql — read-only check that migration 017 landed correctly.
-- Nothing here writes. Paste into the Supabase SQL editor and read the
-- `result` column: every row should say OK.
-- =====================================================================

-- 1. The five new columns.
select '1. columns' as check,
       case when count(*) = 5 then 'OK - all 5 present'
            else 'PROBLEM - only ' || count(*) || ' of 5: ' || string_agg(column_name, ', ')
       end as result
  from information_schema.columns
 where table_name = 'leave_requests'
   and column_name in ('excluded_dates','balance_deducted','cancelled_at','cancelled_by','cancel_reason')

union all

-- 2. The status CHECK must accept 'cancelled', or every retraction fails at
--    the database with a 23514 that the app cannot work around.
select '2. cancelled status allowed',
       coalesce(
         (select case when pg_get_constraintdef(con.oid) ilike '%cancelled%'
                      then 'OK - ' || con.conname
                      else 'PROBLEM - constraint does not list cancelled: ' || pg_get_constraintdef(con.oid)
                 end
            from pg_constraint con
            join pg_class rel on rel.oid = con.conrelid
            join pg_namespace nsp on nsp.oid = rel.relnamespace
           where nsp.nspname = 'public' and rel.relname = 'leave_requests'
             and con.contype = 'c' and pg_get_constraintdef(con.oid) ilike '%status%'
           limit 1),
         'OK - no CHECK on status, so any value is accepted')

union all

-- 3. No APPROVED leave should still be charging a weekend inside a range.
--    This is the actual bug; it must return zero.
select '3. weekends still charged',
       case when count(*) = 0 then 'OK - none'
            else 'PROBLEM - ' || count(*) || ' leave row(s) still charge a weekend'
       end
  from leave_requests l
  cross join lateral generate_series(l.from_date::date, l.to_date::date, interval '1 day') g(d)
 where l.status = 'approved'
   and coalesce(l.duration_type,'full') = 'full'
   and l.from_date <> l.to_date
   and extract(isodow from g.d) in (6,7)
   and not (to_char(g.d,'YYYY-MM-DD') = any(l.excluded_dates))

union all

-- 4. Every approved leave should have recorded what it deducted, so a later
--    cancellation can return exactly that.
select '4. deductions recorded',
       case when count(*) = 0 then 'OK - every approved leave has one'
            else 'PROBLEM - ' || count(*) || ' approved leave(s) with no balance_deducted'
       end
  from leave_requests
 where status = 'approved' and balance_deducted is null

union all

-- 5. The refunds the migration paid out.
select '5. refunds issued',
       case when count(*) = 0 then 'OK - nothing needed refunding'
            else count(*) || ' refund(s) totalling ' ||
                 round(sum(new_balance - old_balance), 2) || ' day(s) - listed below'
       end
  from leave_balance_adjustments
 where reason like 'Migration 017%';

-- ---------------------------------------------------------------------
-- The refunds themselves, if check 5 found any.
-- ---------------------------------------------------------------------
select p.name,
       a.leave_type,
       a.old_balance as before,
       a.new_balance as after,
       round(a.new_balance - a.old_balance, 2) as refunded
  from leave_balance_adjustments a
  join profiles p on p.id = a.user_id
 where a.reason like 'Migration 017%'
 order by p.name, a.leave_type;
