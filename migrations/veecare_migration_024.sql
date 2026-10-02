-- 024: twice-a-month cutoffs  (profiles.cycle_frequency = 'semimonthly')
--
-- Maine: 1-15 / 16-end.  Jessie: 11-25 / 26-10.  No new column is needed: the
-- existing cycle_anchor's day-of-month defines the two start days.
--
-- cycle_frequency may carry a CHECK constraint from before the migrations were
-- handed over (the live schema is the source of truth), which would reject the
-- new value. Drop whatever CHECK mentions the column, then re-add one that
-- allows all three. Idempotent: safe to run again.

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%cycle_frequency%'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.profiles
  add constraint profiles_cycle_frequency_check
  check (cycle_frequency is null or cycle_frequency in ('biweekly', 'monthly', 'semimonthly'));
