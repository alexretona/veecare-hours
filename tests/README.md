# Tests

jsdom suites run against `demo.html` (same JS as `index.html`, mock DB).

```bash
npm install jsdom
node tests/test-paging.cjs      # fetchAllRows: the 1000-row silent truncation
node tests/test-smoke.cjs       # hydrate + the holiday and leave rules
node tests/test-multi.cjs       # the multi-select filter component
node tests/test-semimonthly.cjs # twice-a-month cutoffs + per-cutoff salary
```

They live in the repo on purpose: earlier suites were written in a temp
scratchpad and lost between sessions, so a regression run after a two-week
gap was impossible. Anything worth asserting belongs here.
