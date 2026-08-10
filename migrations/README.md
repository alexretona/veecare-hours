# Migrations

SQL migrations are run **by hand** — pasted into the Supabase SQL editor. There is
no migration runner. See `CLAUDE.md` § "SQL migrations are run by hand".

Expected files (base, then 003–012 in order):

```
veecare_migration.sql          base schema
veecare_migration_003.sql
…
veecare_migration_007.sql      termination
veecare_migration_008.sql      line items + request flow
veecare_migration_009.sql      request concern note
veecare_migration_010.sql      employee-proposed allowances
veecare_migration_011.sql      leave hours
veecare_migration_012.sql      separate holiday rate (holiday_rate)
```

## ⚠️ These files are not in the repo yet

They were referenced in the Claude Code handoff but were **not included in the
handoff bundle** and were not found on the local machine. To restore them, either:

- recover the `.sql` files from the original chat/handoff and drop them here, or
- regenerate the current schema from Supabase:
  Dashboard → Project → **Database → Schema Visualizer / SQL Editor**, or
  `supabase db dump --schema public` with the CLI.

Until then, treat the live Supabase schema as the source of truth.

**Outstanding:** migration 012 (`holiday_rate`) must be run in Supabase if it
hasn't been already.
