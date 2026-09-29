/* hydrate() now pages. Make sure it still actually hydrates, and that the
 * holiday rules from the last round are intact. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('C:/Users/alexr/source/repos/veecare-hours/demo.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.test/' });
const w = dom.window;
const results = [];
const check = (n, g, wnt) => results.push({ n, ok: JSON.stringify(g) === JSON.stringify(wnt), g, wnt });
setTimeout(async () => {
  try {
    const D = w.eval('D');
    check('1. hydrate populated users', D.users.length > 0, true);
    check('2. hydrate populated entries', D.entries.length > 0, true);

    /* Re-hydrating (the overview auto-refresh does this) must not duplicate. */
    const before = D.entries.length;
    await w.eval('hydrate')();
    check('3. re-hydrate does not duplicate rows', D.entries.length, before);

    /* The most recent entry must survive - the whole point of the fix. */
    const dates = D.entries.map(e => e.date).sort();
    check('4. the newest entry is present after paging', dates[dates.length - 1] === D.entries.map(e => e.date).sort().pop(), true);

    /* Holiday rules from the previous round, spot-checked. */
    const emp = D.users.find(u => u.role === 'employee' && !u.terminatedAt);
    emp.rate = 100; emp.capHours = 80; emp.payBasis = 'hourly';
    emp.regularHolidayMultiplier = null; emp.specialHolidayMultiplier = null; emp.restDayHolidayMultiplier = null;
    D.holidays.length = 0; D.leaves.length = 0; D.entries.length = 0;
    const stub = w.eval('workedHours');
    w.eval('workedHours = function(e){ return e.__h != null ? e.__h : ' + stub + '(e); }');
    D.holidays.push({ id: 'h', date: '2026-09-09', name: 'H', userId: null, paid: true, hours: 8, type: 'regular', multiplier: null });
    let c = w.computeInvoice(emp, '2026-09-07', '2026-09-11');
    check('5. paid holiday not worked -> plain rate', [c.holidayOffHours, c.total], [8, 800]);
    D.entries.push({ id: 'e', userId: emp.id, date: '2026-09-09', status: 'completed',
      clockIn: '2026-09-09T00:00:00Z', clockOut: '2026-09-09T08:00:00Z', pauses: [], lunchMins: 0, __h: 8 });
    c = w.computeInvoice(emp, '2026-09-07', '2026-09-11');
    check('6. worked on a holiday -> 2x premium', [c.holidayHours, c.total], [8, 1600]);

    /* And the leave working-day rule. */
    D.holidays.length = 0; D.entries.length = 0;
    D.leaves.push({ id: 'L', userId: emp.id, type: 'Vacation', from: '2026-09-04', to: '2026-09-07',
      status: 'approved', durationType: 'full', hours: null, excludedDates: ['2026-09-05','2026-09-06'],
      balanceDeducted: 2, createdAt: w.nowISO() });
    check('7. Fri..Mon leave still charges 2 days', w.leaveDayEquivalent(D.leaves[D.leaves.length-1]), 2);
  } catch (e) { results.push({ n: 'EXCEPTION', ok: false, g: e.message + '\n' + e.stack, wnt: '' }); }
  let bad = 0;
  for (const r of results) { if (r.ok) console.log('  PASS  ' + r.n); else { bad++; console.log('  FAIL  ' + r.n + '\n        got  ' + JSON.stringify(r.g) + '\n        want ' + JSON.stringify(r.wnt)); } }
  console.log('\n' + (results.length - bad) + '/' + results.length + ' passed'); process.exit(bad ? 1 : 0);
}, 700);
