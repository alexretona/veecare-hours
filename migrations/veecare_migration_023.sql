-- =====================================================================
-- veecare_migration_023.sql — relabel old-model "one-off" day-off pay
-- =====================================================================
-- Mari's #048 turned out NOT to be missing its row: custom_holiday_hours = 8
-- was saved fine. Her browser was simply running code from before the row
-- existed (a tab that was never reloaded). But once she reloads, that row
-- prints under the NEW model's label, "ONE-OFF RATE - WORKED" - for a day she
-- did not work. Under the old model (before 2026-09-14) the one-off bucket
-- held the UNWORKED day; under the new one it holds hours worked.
--
-- Where the one-off rate equals the invoice's base rate - i.e. it was really
-- just "pay the day off at the normal rate", which is exactly what
-- holiday_off_hours means now - move the hours across. Same hours, same
-- amount, same total; only the label changes from "worked" to "not worked",
-- which is the truth.
--
-- Invoices where the one-off rate DIFFERS from the base rate are left alone:
-- moving them would change the amount, and an issued invoice is a snapshot.
--
-- Idempotent: once moved, custom_holiday_hours is 0 and the row no longer
-- matches. Run this in the Supabase SQL editor.
-- =====================================================================

update invoices i
   set holiday_off_hours    = coalesce(i.holiday_off_hours, 0) + i.custom_holiday_hours,
       custom_holiday_hours = 0,
       custom_holiday_amount = 0
 where coalesce(i.custom_holiday_hours, 0) > 0
   and round(coalesce(i.custom_holiday_rate, 0), 2) = round(coalesce(i.rate, 0), 2)
   -- and they genuinely did not work the holiday date(s) in that period
   and not exists (
     select 1
       from holidays h
       join time_entries t
         on t.user_id = i.user_id
        and t.work_date = h.holiday_date
        and t.deleted_at is null
        and t.status = 'completed'
      where h.holiday_date between i.period_start and i.period_end
        and h.holiday_type = 'custom'
        and (h.user_id = i.user_id or h.user_id is null)
   );

-- What moved:
-- select i.invoice_no, p.name, i.holiday_off_hours, i.total_amount
--   from invoices i join profiles p on p.id = i.user_id
--  where i.holiday_off_hours > 0 order by i.invoice_no;
