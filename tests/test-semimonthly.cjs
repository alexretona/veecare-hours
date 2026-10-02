/* Twice-a-month cutoffs (Maine: 1-15 / 16-end, Jessie: 11-25 / 26-10) and the
 * per-cutoff share of a monthly salary. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'demo.html'), 'utf8');
const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.test/' }).window;
const results = [];
const check = (n, g, wnt) => results.push({ n, ok: JSON.stringify(g) === JSON.stringify(wnt), g, wnt });
setTimeout(() => {
  try {
    const maine = { cycleFrequency: 'semimonthly', cycleAnchor: '2026-09-01' };
    const jessie = { cycleFrequency: 'semimonthly', cycleAnchor: '2026-09-11' };
    const jessie2 = { cycleFrequency: 'semimonthly', cycleAnchor: '2026-09-26' };   /* anchored on the 2nd half */
    const span = (u, d) => { const c = w.cycleForDate(u, d); return c && [c.start, c.end]; };

    check('1. Maine 1-15', span(maine, '2026-10-02'), ['2026-10-01', '2026-10-15']);
    check('2. Maine 16-end (31-day month)', span(maine, '2026-10-20'), ['2026-10-16', '2026-10-31']);
    check('3. Maine Feb ends on the 28th', span(maine, '2027-02-20'), ['2027-02-16', '2027-02-28']);
    check('4. Jessie 11-25', span(jessie, '2026-10-02'), ['2026-09-26', '2026-10-10']);
    check('5. Jessie 26-10 spans the month', span(jessie, '2026-10-25'), ['2026-10-11', '2026-10-25']);
    check('6. Jessie anchored on the 26th is the same schedule', span(jessie2, '2026-10-02'), span(jessie, '2026-10-02'));
    check('7. boundary days belong to the new cutoff', [span(maine, '2026-10-15')[0], span(maine, '2026-10-16')[0]], ['2026-10-01', '2026-10-16']);

    /* No gaps, no overlaps, across a year boundary and backwards. */
    for (const [name, u] of [['Maine', maine], ['Jessie', jessie]]) {
      let c = w.cycleForDate(u, '2025-11-03'), ok = true, n = 0;
      while (c.start < '2027-03-01') {
        const nx = w.shiftCycle(u, c, 1), back = w.shiftCycle(u, nx, -1);
        if (nx.start !== w.addDays(c.end, 1) || back.start !== c.start) { ok = false; break; }
        c = nx; n++;
      }
      check('8. ' + name + ' contiguous for ' + n + ' cutoffs, shift +1/-1 round-trips', ok, true);
    }

    /* Salary: monthly figure halves per cutoff, nothing else changes. */
    check('9. 25,000/mo twice a month -> 12,500', w.cycleSalary({ monthlySalary: 25000, cycleFrequency: 'semimonthly' }), 12500);
    check('10. monthly cutoff keeps the full salary', w.cycleSalary({ monthlySalary: 25000, cycleFrequency: 'monthly' }), 25000);
    check('11. bi-weekly untouched', w.cycleSalary({ monthlySalary: 25000, cycleFrequency: 'biweekly' }), 25000);
    check('12. existing frequencies still derive', [span({ cycleFrequency: 'biweekly', cycleAnchor: '2026-06-22' }, '2026-06-30'), span({ cycleFrequency: 'monthly', cycleAnchor: '2026-07-03' }, '2026-07-20')],
      [['2026-06-22', '2026-07-03'], ['2026-07-03', '2026-08-02']]);
  } catch (e) { results.push({ n: 'EXCEPTION', ok: false, g: e.message + '\n' + e.stack, wnt: '' }); }
  let bad = 0;
  for (const r of results) { if (r.ok) console.log('  PASS  ' + r.n); else { bad++; console.log('  FAIL  ' + r.n + '\n        got  ' + JSON.stringify(r.g) + '\n        want ' + JSON.stringify(r.wnt)); } }
  console.log('\n' + (results.length - bad) + '/' + results.length + ' passed'); process.exit(bad ? 1 : 0);
}, 700);
