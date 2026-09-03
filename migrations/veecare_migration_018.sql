-- =====================================================================
-- veecare_migration_018.sql — employees cancel their own leave
-- =====================================================================
-- Stakeholder decisions:
--   D1 (a)  An employee can cancel their own leave immediately, approved or
--           not, with a reason.
--   D2 (b)  ...but only BEFORE it starts. Once the dates are behind them the
--           day may already be on a timesheet and cancelling turns it into an
--           unpaid absence, so that stays an admin action.
--
-- Why a function instead of an RLS policy:
--
--   Cancelling an approved leave has to put days BACK on profiles.vl_balance /
--   sl_balance. Employees must never be able to write their own leave balance
--   directly — that is the whole point of the balance. So the write happens
--   inside a SECURITY DEFINER function that re-checks every rule server-side.
--
--   It also means the rules are actually enforced. The same checks exist in the
--   app for a decent error message, but a client-side guard on something that
--   moves payroll numbers is a hint, not a control.
--
-- Requires migration 017 (balance_deducted, cancel trail, 'cancelled' status).
-- Idempotent: create or replace. Run this in the Supabase SQL editor.
-- =====================================================================

create or replace function public.cancel_own_leave(p_leave_id uuid, p_reason text)
returns numeric
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_leave  leave_requests%rowtype;
  v_today  date := (now() at time zone 'Asia/Manila')::date;
  v_days   numeric;
  v_before numeric;
  v_after  numeric;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required.';
  end if;

  select * into v_leave from leave_requests where id = p_leave_id;
  if not found then
    raise exception 'That leave no longer exists.';
  end if;

  -- Ownership. This is what makes SECURITY DEFINER safe here.
  if v_leave.user_id is distinct from auth.uid() then
    raise exception 'You can only cancel your own leave.';
  end if;

  if v_leave.status <> 'approved' then
    raise exception 'Only approved leave is cancelled here.';
  end if;

  -- D2(b): already started is the admin's call.
  if v_leave.from_date <= v_today then
    raise exception 'That leave has already started, so your admin has to cancel it.';
  end if;

  -- Cancelling under an issued invoice would disagree with a document the
  -- client already holds.
  if exists (
    select 1 from invoices i
     where i.user_id = v_leave.user_id
       and i.period_start <= v_leave.to_date
       and v_leave.from_date <= i.period_end
  ) then
    raise exception 'An invoice already covers those dates. Ask your admin.';
  end if;

  update leave_requests
     set status        = 'cancelled',
         cancelled_at  = now(),
         cancelled_by  = auth.uid(),
         cancel_reason = p_reason
   where id = p_leave_id;

  -- Hand back exactly what was taken. NEVER a recomputed day count: the
  -- draw-down clamps at zero, so a clamped deduction took less than the dates
  -- imply and recomputing would invent credits. See migration 017.
  v_days := coalesce(v_leave.balance_deducted, 0);
  if v_days <= 0 then
    return 0;
  end if;

  if v_leave.type = 'Vacation' then
    select coalesce(vl_balance, 0) into v_before from profiles where id = v_leave.user_id;
    v_after := round(v_before + v_days, 2);
    update profiles set vl_balance = v_after where id = v_leave.user_id;
  elsif v_leave.type = 'Sick' then
    select coalesce(sl_balance, 0) into v_before from profiles where id = v_leave.user_id;
    v_after := round(v_before + v_days, 2);
    update profiles set sl_balance = v_after where id = v_leave.user_id;
  else
    -- Emergency Leave is uncredited (migration 016) — nothing to return.
    return 0;
  end if;

  -- Every balance move stays auditable, exactly as an admin's would.
  insert into leave_balance_adjustments
    (user_id, leave_type, old_balance, new_balance, reason, adjusted_by)
  values
    (v_leave.user_id, v_leave.type, v_before, v_after,
     'Employee cancelled their approved leave ' || v_leave.from_date ||
       case when v_leave.from_date = v_leave.to_date then '' else ' to ' || v_leave.to_date end ||
       ' - ' || p_reason,
     auth.uid());

  return v_days;
end
$fn$;

-- Callable by signed-in users only, and only ever for their own leave.
revoke all on function public.cancel_own_leave(uuid, text) from public;
grant execute on function public.cancel_own_leave(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Check it registered:
--   select proname, prosecdef from pg_proc where proname = 'cancel_own_leave';
-- prosecdef must be true.
-- ---------------------------------------------------------------------
