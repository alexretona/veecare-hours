-- 025: self-signup accounts wait for admin approval, and profiles are guarded
--      server-side.
--
-- Found 2026-10-12: Joanne mistyped her email at sign-in (joanee@ for
-- joannee@), used "Create account" with the typo, and clocked in on the new
-- account. Later she signed into her real one and clocked in again - two
-- "Joanne Marie Espejon" rows on the Overview. The signup screen promised
-- "Owner approves later"; nothing enforced it.
--
-- Looking at why exposed something worse. Both profile policies scoped only
-- the ROW, never the columns:
--   "Admin inserts profiles"   with check (is_admin() or id = auth.uid())
--   "Users update own profile" using (id = auth.uid())
-- so any signed-in user could write role = 'admin', their own rate, leave
-- balances, or clear their own termination - and anyone holding the public
-- anon key could sign up and insert an admin profile. The client never sent
-- such values, but a client-side guard is a hint, not a control.
--
-- Idempotent; safe to re-run.

-- 1. Approval flag. Existing accounts are all live staff: they default to false.
alter table public.profiles
  add column if not exists pending_approval boolean not null default false;

-- 2. Guard every profile write made directly by a signed-in user.
--    The SQL editor, the service role and SECURITY DEFINER functions
--    (cancel_own_leave() refunds a balance) run as postgres, not as
--    'authenticated', and pass straight through. So does an admin.
create or replace function public.guard_profile_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare tz text;
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Self-signup. The signer chooses id, username and name; everything that
    -- moves pay, access or leave is forced to the new-hire default, and the
    -- account waits for an admin. A NEW profile column that carries pay or
    -- access must be added here too.
    new.role                        := 'employee';
    new.pending_approval            := true;
    new.rate                        := 0;
    new.employment_status           := 'Probationary';
    new.leaves_enabled              := false;
    new.vl_balance                  := 0;
    new.sl_balance                  := 0;
    new.vl_allocation               := null;
    new.sl_allocation               := null;
    new.flex_enabled                := false;
    new.cycle_frequency             := 'biweekly';
    new.cycle_anchor                := null;
    new.cap_hours                   := null;
    new.pay_basis                   := 'hourly';
    new.monthly_salary              := null;
    new.standard_monthly_hours      := 160;
    new.regular_holiday_multiplier  := null;
    new.special_holiday_multiplier  := null;
    new.rest_day_holiday_multiplier := null;
    new.bank_name := null; new.bank_account_name := null; new.bank_account_no := null;
    new.bank_email := null; new.bank_address := null;
    new.terminated_at := null; new.termination_reason := null; new.terminated_by := null;
    return new;
  end if;

  -- UPDATE of one's own row: the only thing an employee ever writes to their
  -- own profile is the detected timezone. Every other column keeps its old
  -- value - a whitelist, so a column added later is protected by default.
  -- (Copy the record, don't rebuild it via jsonb_populate_record: on rows
  -- written before a column was added, that returned NULL for the new column
  -- and tripped its NOT NULL.)
  tz := new.timezone;
  new := old;
  new.timezone := tz;
  return new;
end;
$$;

drop trigger if exists profiles_guard_write on public.profiles;
create trigger profiles_guard_write
  before insert or update on public.profiles
  for each row execute function public.guard_profile_write();

-- 3. "Is the caller an approved, current member of staff?" Used by the
--    insert policies below so a pending or terminated account can't record
--    time, leave, corrections or invoice requests even with the UI bypassed.
create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and terminated_at is null
      and not coalesce(pending_approval, false)
  );
$$;

drop policy if exists "Entries: insert own" on public.time_entries;
create policy "Entries: insert own" on public.time_entries
  for insert with check (user_id = auth.uid() and public.is_active_member());

drop policy if exists "Leaves: insert own" on public.leave_requests;
create policy "Leaves: insert own" on public.leave_requests
  for insert with check (user_id = auth.uid() and public.is_active_member());

drop policy if exists "COA: insert own" on public.coa_requests;
create policy "COA: insert own" on public.coa_requests
  for insert with check (user_id = auth.uid() and public.is_active_member());

drop policy if exists invoices_emp_request on public.invoices;
create policy invoices_emp_request on public.invoices
  for insert with check (user_id = auth.uid() and workflow = 'requested' and public.is_active_member());
