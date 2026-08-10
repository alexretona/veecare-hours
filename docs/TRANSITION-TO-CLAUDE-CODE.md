# Moving VeeCare to Claude Code

One-time setup. After this, Claude Code works directly in your repo — it can read
and edit files, run git, and (once connected) query Supabase and deploy to Vercel,
instead of us passing files back and forth.

---

## 1. Install Claude Code

**macOS / Linux / WSL**
```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**Windows PowerShell**
```powershell
irm https://claude.ai/install.ps1 | iex
```

Verify:
```bash
claude --version
claude doctor      # diagnoses install/auth/config issues
```

Requires a Pro, Max, Team, Enterprise, or Console account — the free plan
doesn't include Claude Code. On Windows, installing
[Git for Windows](https://git-scm.com/downloads/win) is recommended.

Prefer a GUI over the terminal? There's a desktop app —
see https://code.claude.com/docs/en/desktop-quickstart

---

## 2. Get the repo locally

If the project is already on GitHub:
```bash
git clone <your-repo-url>
cd <repo>
```

If it isn't yet, create the repo on GitHub first, then:
```bash
mkdir veecare-hours && cd veecare-hours
git init
# copy index.html + demo.html + the migration .sql files in here
git add .
git commit -m "Initial commit: VeeCare hours & invoicing app"
git remote add origin <your-repo-url>
git push -u origin main
```

---

## 3. Drop in the handoff files

Put these at the repo root:

- **`CLAUDE.md`** — project context, conventions, domain logic, and the list of
  real bugs not to reintroduce. Claude Code reads this automatically at the start
  of every session. This is the single most valuable file in the handoff.
- **`docs/`** — put `invoice-requirements.md`, `invoice-technical-spec.md`, and
  `holiday-rate-enhancement.md` here.
- **`migrations/`** — all `veecare_migration*.sql` files.

Suggested layout:
```
├── CLAUDE.md
├── index.html
├── demo.html
├── migrations/
│   ├── veecare_migration.sql
│   └── veecare_migration_003.sql … _012.sql
└── docs/
    ├── invoice-requirements.md
    ├── invoice-technical-spec.md
    └── holiday-rate-enhancement.md
```

---

## 4. Start it up

```bash
cd <repo>
claude
```

First run opens a browser to log in. Then try:

```
Read CLAUDE.md, then give me a summary of how the invoice request flow works.
```

If it explains the 3-step employee flow and the auto-complete rule, the context
carried over correctly.

---

## 5. Connect GitHub, Vercel, Supabase

Claude Code already does git out of the box (`commit`, `branch`, `push`) — no
setup needed. For the rest, connect them as MCP servers.

Ask Claude Code directly:
```
Help me connect the GitHub, Supabase, and Vercel MCP servers.
```
It will walk you through it interactively, which is easier than following static
instructions — and the exact setup differs per provider.

Reference: https://code.claude.com/docs/en/mcp

**On credentials — important:**
- Put keys in a `.env` file and add `.env` to `.gitignore`. Never commit them.
- Your Supabase **anon key** is already public in `index.html` — that's normal and
  safe, since RLS is what actually protects the data.
- Your Supabase **service_role key** must never go in any file that reaches the
  browser. It bypasses RLS entirely.
- Use a **read-only** Supabase connection for the MCP server unless you
  specifically need writes.

---

## 6. Recommended first session

Good warm-up tasks that prove the setup works:

```
Read CLAUDE.md. Then verify index.html and demo.html are in sync — list any
functions that exist in one but not the other, or that differ meaningfully.
```

```
Set up the test tooling described in CLAUDE.md (jsdom + Playwright) and write a
smoke test that loads demo.html, runs the full invoice request round trip, and
asserts the resulting invoice totals.
```

That second one is worth doing early — it turns the manual testing routine into
something repeatable.

---

## 7. Still outstanding

Carry these over:

1. **Jona's invoice #017 needs re-issuing.** Saved with the wrong period
   (Jul 13–24, before she started Jul 28). The date-persistence bug is fixed, but
   it doesn't retroactively correct already-saved invoices. Open it → Revise →
   set the correct period → save.
2. **Investigate the 72 hours on that invoice.** A period before her start date
   should compute to zero hours, so those were likely entered manually. Worth
   confirming her real time entries exist for Jul 27–Aug 7.
3. **Migration 012 must be run** in Supabase if you haven't already (adds
   `holiday_rate`).
4. **Phases 3–5 from the invoice spec were never built** — notification
   reminders, break-overage visibility, and the employee-facing calculation
   breakdown. See `docs/invoice-technical-spec.md` §7.
5. **Open decision:** the pause/break limit. We assumed 60 minutes to mirror the
   lunch limit, but you never confirmed a number, and it's currently not enforced
   at all for flex-hours pauses.

---

## Handy commands

| Command | What it does |
|---|---|
| `claude` | Start a session in the current directory |
| `claude doctor` | Diagnose install, auth, and config |
| `/clear` | Clear context between unrelated tasks |
| `/config` | Settings, including auto-update channel |
| `claude update` | Update immediately |

Docs: https://code.claude.com/docs/en/setup
