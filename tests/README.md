# Tests

jsdom suites run against `demo.html` (same JS as `index.html`, mock DB).

```bash
npm install jsdom
node tests/test-paging.cjs      # fetchAllRows: the 1000-row silent truncation
node tests/test-smoke.cjs       # hydrate + the holiday and leave rules
node tests/test-multi.cjs       # the multi-select filter component
node tests/test-semimonthly.cjs # twice-a-month cutoffs + per-cutoff salary
node tests/test-signup-approval.cjs # pending signups: kept off rosters, approve/reject by click
node tests/test-open-shift-not-absent.cjs # a shift still open is not an absence
node tests/test-long-shift.cjs        # 12+ hour shifts must be confirmed, never silently recorded
```

They live in the repo on purpose: earlier suites were written in a temp
scratchpad and lost between sessions, so a regression run after a two-week
gap was impossible. Anything worth asserting belongs here.
