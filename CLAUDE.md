# VeeCare Staffing Solutions — Hours & Invoicing App

Internal workforce app for VeeCare Staffing Solutions PH. Contractors clock in/out,
request leave and attendance corrections, and request invoices; admins approve
everything and issue invoices billed to CVS Homes.

---

## Critical conventions — read before writing any code

### 1. Two files must stay in sync
- **`index.html`** — the real app. Supabase-backed. This is what deploys.
- **`demo.html`** — a standalone, no-login demo with an in-memory mock DB and a
  "View as" role switcher. Used for showing the client and for testing.

**Every feature/fix ships in BOTH files, identically.** The JS is largely
duplicated between them; `demo.html` swaps the Supabase client for a mock.
A change landed in only one file is a bug.

### 2. Single-file architecture (deliberate)
Both are single HTML files: markup + `<style>` + one big `<script>`. No build
step, no framework, no bundler. Vercel serves `index.html` directly.

Don't "modernize" this into a framework/build pipeline unless explicitly asked.
It's intentional — the owner edits and deploys without a toolchain.

### 3. SQL migrations are run by hand
Migrations live as numbered `veecare_migration_NNN.sql` files. The owner pastes
them into the **Supabase SQL editor** manually. There is no migration runner.

- Always write migrations as **idempotent** (`add column if not exists`,
  `drop policy if exists` before `create policy`).
- Always **backfill** when adding a column that existing rows need.
- Never assume a migration has been run — new columns need safe fallbacks in the
  JS mappers (see `holidayRate` falling back to `rate`).

---

## Stack
- **Frontend**: single-file HTML/CSS/vanilla JS
- **Backend**: Supabase (Postgres + Auth + RLS)
- **Hosting**: Vercel, deployed from GitHub
- **Auth**: Supabase email/password. Employees log in with full email
  `@veecarestaffingsolutions.com`.

---

## Data model (Supabase)

| Table | Purpose |
|---|---|
| `profiles` | Employees + admins. Rate, pay basis, cutoff config, leave balances, termination |
| `time_entries` | Clock in/out, lunch, pauses. Soft-deleted via `deleted_at` |
| `leave_requests` | VL/SL/EL. `status` pending/approved/rejected. Full or partial-day. `is_backfill` marks pre-system leave |
| `coa_requests` | Attendance correction requests |
| `holidays` | Company-wide or per-employee. Paid/unpaid, hours |
| `invoices` | Invoice snapshots + workflow state |
| `invoice_line_items` | Allowances / incentives / deductions per invoice |
| `org_settings` | Single pinned row (`id = 1`). Company-wide holiday multipliers |
| `leave_balance_adjustments` | Audit of every manual balance edit. **Admin-only (RLS)** |
| `leave_year_snapshots` | Prior-year balances kept for the annual reset. **Admin-only (RLS)** |

### Migration history
`veecare_migration.sql` is the base; then 003–013 in order.
Notable: 007 termination · 008 line items + request flow · 009 request concern
note · 010 employee-proposed allowances · 011 leave hours · 012 separate holiday rate
· 013 holiday multipliers + holiday types · 014 EL balance, admin balance
adjustment + audit, pre-system backfill, year snapshots.

### Leave balances
`vl_balance` / `sl_balance` / `el_balance` on `profiles` hold **remaining days**
(not the annual allocation). All three draw down through a single helper,
`drawDownLeaveBalance(user, type, days)` — used by both `approveLeave()` and the
pre-system backfill, so approval and backfill can never diverge. It clamps at 0
and is a no-op for an unrecognised type.

The app went live mid-2026, so balances started too high — staff had already
taken leave outside the system. Two admin tools fix that, both under
**Employees → Leaves**: *Adjust* sets the remaining days (reason required, every
change written to `leave_balance_adjustments`), and *Past leave* files the
pre-system leave itself as an already-approved, `is_backfill`-flagged record so
it shows in history and draws the balance down normally.

**Not built yet:** the January reset itself. `leave_year_snapshots` is the store
it will write to; prior-year balances stay admin-only.

⚠️ Only `013` exists as a file in `migrations/`. Everything before it was never
handed over — treat the **live Supabase schema as the source of truth**.

---

## Core domain logic

### `computeInvoice(user, start, end)`
**The single source of truth for invoice math.** Both the admin builder and the
employee request flow call it. Change it and everything downstream follows.

Per-day precedence — do not reorder:
```
worked entry  >  approved leave  >  paid holiday  >  unpaid absence
```
A day with an actual time entry never also gets leave/holiday hours credited.

- Full-day leave credits `STANDARD_DAY_HOURS` (8); partial-day credits its stored hours.
- Hours above the employee's `capHours` become `excessHours` (shown, not billed).

**Paid time off consumes the cap.** Approved leave *and* paid holidays come OUT
of the cutoff's approved hours, not on top of them:

```
paidTimeOff = leaveHours + holidayHours
billable    = min(worked, capHours - paidTimeOff)
excess      = max(0, worked - (capHours - paidTimeOff))
```

An 80-hour cutoff with one 8-hour VL day bills **72 regular + 8 leave = 80** —
never 79 + 8 = 87. Before this rule the admin was correcting every such invoice
by hand. Holidays behaved differently (credited on top) until the owner
confirmed on 2026-08-17 that they should count the same way — **don't revert
holidays to on-top.**

`leaveHours` / `holidayHours` are themselves **never clamped** to the cap. They
come in whole half/full days (4h, 8h, …) set by the time off actually taken, so
trimming them would misstate it. Only the room left for *worked* hours shrinks.

### Rates — three distinct concepts
- **Regular rate** — shared by Regular, Overtime, and Leave.
- **Holiday rate** — **independent**, and *derived from a multiplier*, never typed
  per invoice. *Never re-merge holiday rate with the regular rate.*

  Two holiday types, each with its own premium (migration 013):

  | Type | `holidays.holiday_type` | Default |
  |---|---|---|
  | Regular holiday | `regular` | 2.0× |
  | Special non-working day | `special` | 1.3× |

  Resolution order, implemented **only** in `holidayMultipliers(user)` — never
  duplicate it: the employee's own `profiles.regular_holiday_multiplier` /
  `special_holiday_multiplier` (NULL = inherit) → `org_settings` → the statutory
  constants. A per-person override is how a contractor gets e.g. 1.5×.

  `computeInvoice` returns both buckets (`holidayHours` / `specialHolidayHours`)
  with `holidayRate` / `specialHolidayRate` already multiplied out, and the
  invoice prints them as **separate rows** so each rate is auditable. The row is
  only labelled "REGULAR HOLIDAY" once a special bucket exists, so older
  invoices keep their original wording.

  HR sets the company rates under **Holidays → Company holiday rates** and
  per-person overrides under **Employees → Edit pay**. Nothing about holiday pay
  should require editing an invoice by hand.
- **Monthly basis** — fixed salary, doesn't multiply by hours; holiday/leave add on top.

### Invoice workflow
```
employee requests → requested ─┐
                               ├→ sent → acknowledged
admin creates    → draft ──────┘    ↑        │
                                    └── disputed (revise & re-send)
```

**Auto-complete rule:** when an admin approves a `requested` invoice **without
changing anything**, it goes straight to `acknowledged` — the employee's request
was their sign-off. If the admin changes *anything* (hours, rates, line items,
dates) OR the employee raised a concern, it goes to `sent` and needs their
acknowledgement. See `sameLineItems()` and the `approvedUnchanged` check.

### Employee request flow (3 steps)
1. **Review your hours** (`emp-hours-modal`) — editable Regular/OT/Holiday/Leave,
   pre-filled from real data. **Rate is locked** — employees never set pay rates.
2. **Preview invoice** — rendered invoice + optional allowances + optional concern
   note. Can go "← Back to hours" without losing anything.
3. **Submit** → lands as `requested` for admin review.

Rules: only the **most recently completed** cutoff is requestable; **one request
per cutoff**; **no withdrawal** after submitting.

---

## Hard-won gotchas (these were real bugs — don't reintroduce)

1. **Admin review must load the SUBMITTED values, not a fresh recompute.**
   `reviewRequestedInvoice()` deliberately overwrites the freshly-seeded fields
   with what the employee actually submitted, and diffs them to show a
   "what changed" banner. A fresh recompute silently discards employee edits.

2. **`saveInvoice()` must persist `period_start` / `period_end` / `invoice_date`.**
   Omitting these silently reverted admin date corrections — invoices came out
   dated for periods before a contractor had even started.

3. **Never use `window.confirm()` for critical actions.** Browsers let users
   permanently suppress dialogs, after which `confirm()` returns `false` with no
   prompt — silently breaking clock in/out. Use the in-app `appConfirm()` modal.

4. **Don't discard line items with a blank label** — fall back to the type name.
   Silently dropping them ate people's allowances.

5. **Modals must cap at viewport height with a scrollable body.** Otherwise tall
   modals push their footer (and the Save button) off-screen. See `.modal`.

6. **Table action buttons: single line, panel scrolls.** `.actions-cell` is
   `nowrap`; `.panel` is `overflow-x: auto` with a visible scrollbar. Never
   `overflow: hidden` — it silently clips buttons.

7. **Terminated employees** are excluded from Timesheets/Payroll/pickers entirely
   and blocked at login *and* session restore. Historical data is preserved and
   reachable via Employees → Terminated.

8. **Preserve state across back-navigation.** `continueToRequestPreview()` keeps
   previously entered allowances/concern instead of resetting.

---

## Testing (do this — the app handles real payroll)

No test framework is wired up. The established workflow:

```bash
npm install jsdom          # logic/DOM assertions
pip install playwright && playwright install chromium   # real rendering
```

- **Parse check both files** after every change — extract the `<script>` and
  `eval` it with stubbed `window`/`document`.
- **jsdom** for logic: invoice math, workflow transitions, persistence.
- **Playwright** for anything visual — layout, overflow, button visibility.
  jsdom does not do real layout and will report a clipped button as "visible".
- **Verify div balance** in `demo.html` after markup surgery — an unclosed div
  once nested the entire app inside a `display:none` container and blanked the page.

Always test the **full round trip** for invoice changes:
employee requests → admin reviews → approves → employee sees result.

---

## Working style the owner expects
- Fix root causes, not symptoms.
- Say clearly what was **not** done or **not** tested.
- Flag assumptions rather than silently guessing.
- Reproduce a reported bug before fixing it, then verify the fix against that repro.
- Communication is a mix of English and Filipino/Tagalog.
