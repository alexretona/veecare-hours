# Handover — moving VeeCare Hours to a new owner

A step-by-step checklist for handing the whole app (code, hosting, database,
logins) to a new owner **without rebuilding anything**. Tick the boxes as you
go. Every phase ends with a **Checkpoint** — if a checkpoint fails, stop and fix
it before moving on.

> Written 2026-10-19. Menu names and plan rules on GitHub, Vercel and Supabase
> change over time — where this says *"verify in the UI"*, check the current
> screen rather than trusting the wording here.

---

## The one rule: transfer, don't rebuild

GitHub, Vercel and Supabase all let you **hand an existing project to another
account**. Everything stays exactly as it is — the same web address, the same
database, every employee's login and password.

The alternative — making a fresh Supabase project and copying data across —
means a new database address and key inside `index.html`, re-creating every
security rule and function by hand, and **every employee resetting their
password**. Don't do that unless a transfer is genuinely impossible.

---

## 1. What exists today (inventory)

| What | Where | Today's owner |
|---|---|---|
| Code | GitHub repo `alexretona/veecare-hours` | Personal GitHub account `alexretona` |
| Hosting | Vercel project `veecare-hours` → https://veecare-hours.vercel.app | Vercel team "alexretona's projects" (`alexretonas-projects`) |
| Database + logins | Supabase project **VeeCare Staffing Solutions** (`ajcsvguwsmganaxusgfp`, region ap-southeast-1) | Supabase organization **VeeCare Solutions** — **Free plan** |
| App admin | One admin login in the app: username `admin` (name "Owner") | Whoever knows that password |
| Login email for the above | Most likely `alexretona@gmail.com` | Personal — **cannot be transferred** |
| Staff email domain | `@veecarestaffingsolutions.com` (some staff use other domains) | Fill in: who controls this domain? ______ |
| AI assistant | Claude Code sessions + connectors (GitHub, Supabase, Vercel) | Your claude.ai account — does **not** transfer |

**What is NOT tied to you** (and so needs nothing): employee logins and
passwords (they live in Supabase), all payroll data, invoices, leave records.

**Secrets check (done 2026-10-19):** the only key in the code is Supabase's
*public* key in `index.html`, which is meant to be public — the database rules
enforce access since migration 025. No private keys or passwords are in the
repo. Nothing needs rotating because of the handover itself.

---

## 2. Decisions to make first

Write the answers here before starting.

- [ ] **Who is the new owner account?** Strongly recommended: a **company-owned**
      login (e.g. `admin@veecarestaffingsolutions.com` or similar), **not** the
      next person's personal Gmail — otherwise this whole exercise repeats at
      the next handover.
      → New owner email: ____________________
- [ ] **GitHub:** transfer to a personal account, or to a GitHub *organization*
      owned by the company? (Organization is better long-term — people can be
      added and removed without moving the repo again.)
      → ____________________
- [ ] **Vercel plan.** Vercel's free *Hobby* plan is for **personal,
      non-commercial use**. A company payroll app should sit on a *Pro* team
      owned by the company. Decide who pays. *(Verify current plan terms and
      prices in the UI.)*
      → ____________________
- [ ] **Supabase plan.** Free is working today, but has **no automatic backups
      you can download** and pauses projects that go unused. For payroll data,
      consider *Pro* (daily backups). Decide who pays.
      → ____________________
- [ ] **Who will be the app admin(s)?** Keep **at least two** admin logins
      during the handover, so nobody is ever locked out.
      → ____________________
- [ ] **Handover day.** Pick a quiet weekday. Avoid:
      - the day after any cutoff closes (people request invoices then) — today
        cutoffs end on the 10th, 15th, 25th, end of month, and every other Friday;
      - any day with invoices waiting in **Invoices → Requested**.
      → Date: ____________________

---

## 3. Phase A — Preparation (2–4 weeks before)

### A1. Set up the new owner account
- [ ] Create the new owner's email account (from decision above).
- [ ] Turn on **two-factor authentication** on it.
- [ ] Store its password in a company password manager, not in someone's head.
- [ ] With that email, create accounts on **GitHub**, **Vercel** and **Supabase**
      (and turn on two-factor on each).

### A2. Take a full backup (do this — it's the only undo for the database)
The Free plan has no downloadable automatic backups, so make your own.

- [ ] Supabase dashboard → project → **Connect** → copy the *direct* database
      connection string (it contains the database password — treat it as a secret).
- [ ] On a computer with PostgreSQL 17 client tools installed, run:
      ```bash
      pg_dump "<connection string>" -Fc -f veecare-backup-YYYY-MM-DD.dump
      ```
      This includes the staff logins (`auth` schema) as well as all payroll tables.
- [ ] Check the file is not tiny (a few MB is expected; a few KB means it failed).
- [ ] Store it somewhere **private and company-owned**. It contains every
      employee's data and their (hashed) passwords — do not email it or put it
      in a shared chat.

Also export the code: GitHub → repo → **Code → Download ZIP**, and store it with
the backup.

### A3. Write down the settings that live outside the code
These move with a transfer, but note them so you can confirm nothing changed.

- [ ] **Supabase → Authentication → URL Configuration**: Site URL and Redirect
      URLs. (Password-reset emails return to the app's own address; it must be
      listed here.) → ____________________
- [ ] **Supabase → Authentication → Emails / SMTP**: are emails sent by
      Supabase's default sender, or through a custom SMTP server? **If it uses
      your personal Gmail as SMTP, it must be switched to a company mailbox
      before you leave**, or password-reset emails will stop.
      → ____________________
- [ ] **Vercel → Project → Settings → Environment Variables**: expected to be
      **empty** (the app keeps no secrets in Vercel). → ____________________
- [ ] **Vercel → Project → Settings → Domains**: expected: only
      `veecare-hours.vercel.app`. If a custom domain was added, note who owns
      its DNS. → ____________________
- [ ] **GitHub → repo → Settings → Integrations / GitHub Apps**: note what is
      installed (Vercel, Claude). → ____________________

### Checkpoint A
- [ ] Backup file exists, is a sensible size, and is stored safely.
- [ ] All the blanks in sections 1–3 are filled in.

---

## 4. Phase B — Overlap (1–2 weeks before)

The new owner works **alongside** you, with full access, before anything moves.

### B1. Give them access everywhere
- [ ] **GitHub:** repo → Settings → **Collaborators** → invite the new owner
      (Admin, or Write at minimum). They accept the email invite.
- [ ] **Vercel:** team → **Members** → invite them. *(On Hobby, team members
      may not be available — verify in the UI; if not, skip to transfer day.)*
- [ ] **Supabase:** organization **VeeCare Solutions** → **Team** → invite them
      as **Owner**. They accept.

### B2. Make them an admin inside the app
- [ ] Log into the app as admin → Employees → **+ Add employee** → create their
      login (use the new owner email).
- [ ] Supabase → **SQL Editor**, run (replace the username — it's the part of
      their email before the `@`):
      ```sql
      update profiles set role = 'admin' where username = 'their-username';
      select username, role from profiles where role = 'admin';
      ```
      The second line should now list **two** admins.
      *(Since migration 025 the app deliberately won't let anyone make
      themselves admin — the SQL editor is the way.)*
- [ ] They log in and can see the admin screens.

### B3. Dry run — they make one real change
- [ ] They set up Claude Code on **their own** Claude account
      (see `docs/TRANSITION-TO-CLAUDE-CODE.md`) and connect their GitHub,
      Supabase and Vercel.
- [ ] They make a harmless change (e.g. add their name to this file's log at
      the bottom), push it, and watch Vercel deploy it.
- [ ] They run a read-only query in the Supabase SQL editor, e.g.
      `select count(*) from profiles;`

### Checkpoint B
- [ ] The new owner has deployed a change and run a query **without your help**.
- [ ] There are two working admin logins in the app.

---

## 5. Phase C — Transfer day

Do these **in this order**, one at a time, with the checkpoint after each.
Leave time — the whole day, not an hour.

### Before you start
- [ ] **Invoices → Requested** is empty (or you've told the team to wait).
- [ ] Take a **fresh backup** (repeat A2) — this morning's, not last month's.

### C1. GitHub — transfer the repository
- [ ] Repo → **Settings → General → Danger Zone → Transfer ownership** →
      enter the new owner (user or organization) → confirm.
- [ ] The new owner accepts if asked.

**Checkpoint C1**
- [ ] The repo appears under the new owner.
- [ ] The old address `github.com/alexretona/veecare-hours` redirects to it.
- [ ] The live app still works (nothing has changed for it yet).

### C2. Vercel — reconnect the code
After the repo moves, Vercel may lose track of it.
- [ ] Vercel → project `veecare-hours` → **Settings → Git**: check it points at
      the repo's **new** location. If not, disconnect and connect it again.
- [ ] If Vercel asks to install its GitHub app on the new owner's account /
      organization, allow it for this repo.

**Checkpoint C2**
- [ ] Push a tiny change (e.g. a line in the log below). A new deployment
      appears in Vercel and turns **Ready**.
- [ ] https://veecare-hours.vercel.app shows the change after a hard refresh.

### C3. Vercel — transfer the project
- [ ] Vercel → project → **Settings → General → Transfer project** → choose the
      new owner's team → confirm. *(Verify in the UI; the receiving team may need
      a paid plan.)*

**Checkpoint C3**
- [ ] The project shows under the new owner's team.
- [ ] https://veecare-hours.vercel.app still loads and you can sign in.
- [ ] Push another tiny change → it deploys from the new team.

### C4. Supabase — transfer the database
Either option keeps the same project address, key, data and logins.

- **Option 1 (simplest):** the new owner is already an **Owner** of the
  organization *VeeCare Solutions* (from B1). Leave the organization as is —
  you just remove yourself in Phase D.
- **Option 2:** move the project into the new owner's own organization:
  project → **Settings → General → Transfer project** → choose their
  organization. *(Verify in the UI — plan rules apply to the receiving
  organization.)*

- [ ] Done via option: ______

**Checkpoint C4 — full app smoke test**
- [ ] Sign in as an **employee** (test account or a willing staff member):
      dashboard loads, today's hours show.
- [ ] Sign in as **admin**: Overview, Employees, Timesheets, Payroll, Invoices all load.
- [ ] **Forgot password** on a test account → the email arrives → the link opens
      the app and the new password works.
- [ ] Supabase SQL editor works for the new owner.
- [ ] A test clock-in / clock-out works (then delete it, or use a test account).

### C5. The AI assistant
- [ ] The new owner's Claude Code is connected to the repo at its **new**
      location, and to Supabase and Vercel under **their** accounts.
- [ ] Nothing to copy: the project knowledge lives in the repo — `CLAUDE.md`
      (read automatically by Claude Code), `docs/`, and `migrations/`.

---

## 6. Phase D — After the handover

Wait **at least one full payroll cycle** (one cutoff closing, invoices requested
and approved) before removing yourself — so if anything breaks you can still help.

- [ ] One full cutoff has been invoiced successfully under the new owner.
- [ ] **App:** demote your admin login, or terminate it (Employees → Terminate).
      Keep at least one *other* admin first.
      ```sql
      select username, role from profiles where role = 'admin';
      ```
- [ ] **Supabase:** leave the organization (or be removed).
- [ ] **Vercel:** leave the team.
- [ ] **GitHub:** remove yourself as collaborator.
- [ ] **Revoke anything personal:** Supabase access tokens, Vercel tokens, GitHub
      personal access tokens you made for this project, and the GitHub /
      Supabase / Vercel connectors in your Claude account.
- [ ] Hand the backups from A2 to the new owner, then delete your copies.
- [ ] Update section 1 of this file with the new owners.

---

## 7. If something goes wrong

| Problem | What to do |
|---|---|
| GitHub transfer went to the wrong place | The new owner transfers it back (same menu). |
| Vercel stops deploying after C1 | Re-do C2 (reconnect Git). The **last good deployment keeps serving** the app meanwhile — staff are not affected. |
| Vercel project transfer fails / is blocked by plan | Stay on the current team for now, add the new owner as a member, and retry after the plan is sorted. |
| Supabase transfer blocked by plan | Use Option 1 (new owner as Owner of the existing organization). |
| Password-reset emails stop | Check Supabase → Authentication → SMTP (A3) and URL Configuration. |
| Nobody can log in as admin | Supabase SQL editor: `update profiles set role = 'admin' where username = '…';` |
| Data lost or damaged | Restore from the backup in A2 (`pg_restore`). Ask for help before doing this on the live database. |

### Never do these
- Don't create a new Supabase project and copy data unless a transfer is truly
  impossible (see "The one rule").
- Don't remove the **last** admin login.
- Don't delete your old accounts until Phase D is complete.
- Don't run the handover on a payroll day.
- Don't send the backup file or database connection string over email or chat.

---

## Handover log

| Date | Step | Who | Notes |
|---|---|---|---|
| 2026-10-19 | Checklist written | Alex | |
| | | | |
