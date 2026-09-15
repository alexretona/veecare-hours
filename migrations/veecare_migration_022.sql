-- =====================================================================
-- veecare_migration_022.sql — surface holiday pay already inside old invoices
-- =====================================================================
-- Mari's invoice #048 (and any like it): the total includes 8 hrs of Labor Day
-- pay, but the saved row has holiday_off_hours = 0 and custom_holiday_hours = 0
-- because it was written before migrations 019/021 added those columns - the
-- app's migration safety net kept the total and dropped the columns it could
-- not write. So the money is in the total and missing from the rows, and the
-- header reads "72 Hours" when 80 are being paid. She is right to say the
-- hours do not add up, and the app cannot fix a snapshot by itself.
--
-- The code fix only helps invoices generated from now on. This repairs the
-- existing ones, under a condition that makes it safe:
--
--   The invoice must ALREADY be paying the holiday. We only fill in
--   holiday_off_hours where the gap between total_amount and the sum of every
--   visible row (plus line items) equals the holiday's hours x the invoice's
--   base rate, to the cent. The total is never changed. This adds the row that
--   explains money already there - nothing more.
--
-- Idempotent: an invoice with holiday_off_hours already set is skipped, and an
-- invoice whose rows already add up to its total has no gap and is skipped.
-- Run this in the Supabase SQL editor.
-- =====================================================================

with visible as (
  -- what the rows on the printed invoice add up to, before the day-off row
  select i.id,
         i.user_id,
         i.period_start,
         i.period_end,
         i.rate,
         i.total_amount,
         round(
             coalesce(i.regular_hours, 0)          * coalesce(i.rate, 0)
           + coalesce(i.overtime_hours, 0)         * coalesce(i.rate, 0)
           + coalesce(i.holiday_hours, 0)          * coalesce(i.holiday_rate, i.rate, 0)
           + coalesce(i.special_holiday_hours, 0)  * coalesce(i.special_holiday_rate, 0)
           + coalesce(i.rest_day_holiday_hours, 0) * coalesce(i.rest_day_holiday_rate, 0)
           + coalesce(i.custom_holiday_hours, 0)   * coalesce(i.custom_holiday_rate, 0)
           + coalesce(i.leave_hours, 0)            * coalesce(i.rate, 0)
           + coalesce((select sum(case when li.line_type = 'deduction' then -li.amount else li.amount end)
                         from invoice_line_items li where li.invoice_id = i.id), 0)
         , 2) as rows_total
    from invoices i
   where coalesce(i.holiday_off_hours, 0) = 0
     and coalesce(i.pay_basis, 'hourly') = 'hourly'
),
unworked_holiday as (
  -- a paid holiday in the period that this person did NOT clock in on
  select v.id,
         sum(h.hours) as hours
    from visible v
    join holidays h
      on h.holiday_date between v.period_start and v.period_end
     and h.paid
     and (h.user_id = v.user_id or h.user_id is null)
   where not exists (
     select 1 from time_entries t
      where t.user_id = v.user_id
        and t.work_date = h.holiday_date
        and t.deleted_at is null
        and t.status = 'completed'
   )
   group by v.id
),
fixable as (
  select v.id, u.hours, v.total_amount, v.rows_total
    from visible v
    join unworked_holiday u on u.id = v.id
   -- the safety condition: the gap IS the holiday pay, to the cent
   where round(v.total_amount - v.rows_total, 2) = round(u.hours * coalesce(v.rate, 0), 2)
     and u.hours > 0
)
update invoices i
   set holiday_off_hours = f.hours
  from fixable f
 where f.id = i.id;

-- ---------------------------------------------------------------------
-- What it did. Empty means nothing matched - either no old invoice carried
-- hidden holiday pay, or their totals were adjusted by hand and the gap did
-- not match, in which case they need a manual revise-and-resend.
-- ---------------------------------------------------------------------
-- select i.invoice_no, p.name, i.holiday_off_hours, i.total_amount
--   from invoices i join profiles p on p.id = i.user_id
--  where i.holiday_off_hours > 0
--  order by i.invoice_no;
