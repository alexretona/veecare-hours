/* A shift that is still open is not an absence.
 *
 * 2026-10-21: Jessie checked All timesheets at ~2:30 AM after her own shift and
 * saw six night-shift colleagues tagged ABSENT for Tue Oct 20. They had all
 * clocked in that evening and were still working; the timesheet built its
 * "has an entry" set from COMPLETED entries only, so every night-shift worker
 * read as absent for "yesterday" until they clocked out the next morning.
 * The employee's own timesheet had the same logic. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'demo.html'), 'utf8');
const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.test/' }).window;
const results = [];
const check = (n, g, wnt) => results.push({ n, ok: JSON.stringify(g) === JSON.stringify(wnt), g, wnt });
const tick = (ms = 80) => new Promise(r => setTimeout(r, ms));

setTimeout(async () => {
  try {
    const D = w.eval('D');
    w.eval("today = () => '2026-10-21'");
    w.demoViewAs('admin-1');
    await tick(300);
    const emps = D.users.filter(u => u.role === 'employee' && !u.terminatedAt);
    const [night, day] = emps;
    D.entries.length = 0; D.leaves.length = 0; D.holidays.length = 0;
    // night shift: clocked in Tue 8pm PH, still working at 2:30am Wed
    D.entries.push({ id: 'open-1', userId: night.id, date: '2026-10-20', status: 'in-progress',
      clockIn: '2026-10-20T12:00:00Z', clockOut: null, pauses: [], lunchStart: null, lunchEnd: null });
    // day shift: finished
    D.entries.push({ id: 'done-1', userId: day.id, date: '2026-10-20', status: 'completed',
      clockIn: '2026-10-20T01:00:00Z', clockOut: '2026-10-20T09:00:00Z', pauses: [], lunchStart: null, lunchEnd: null });

    // ---- admin: All timesheets, this week ----
    w.switchAdminView('timesheets');
    w.document.getElementById('admin-ts-period').value = 'this-week';
    w.renderAdminTimesheets();
    const rowFor = (tbodyId, name, dateTxt) => [...w.document.querySelectorAll('#' + tbodyId + ' tr')]
      .find(tr => tr.textContent.includes(name) && tr.textContent.includes(dateTxt));
    const nightRow = rowFor('admin-ts-rows', night.name, 'Oct 20');
    check('1. admin: open night shift is NOT tagged absent', !!nightRow && /Absent/.test(nightRow.textContent), false);
    check('2. admin: it shows as still working', !!nightRow && /Still working|No clock-out/.test(nightRow.textContent), true);
    check('3. admin: the finished shift still shows normally', !!rowFor('admin-ts-rows', day.name, 'Oct 20'), true);
    check('4. admin: total counts only finished hours (8)', w.document.getElementById('admin-ts-total').textContent, '8 hrs');
    const absentDays = [...w.document.querySelectorAll('#admin-ts-rows tr')].filter(tr => tr.textContent.includes(night.name) && /Absent/.test(tr.textContent)).map(tr => tr.textContent.match(/Oct \d+/)[0]);
    check('5. admin: other days with no entry are still absent (Mon)', absentDays.includes('Oct 19'), true);

    // ---- employee: their own timesheet ----
    w.demoViewAs(night.id);
    await tick(300);
    w.eval("today = () => '2026-10-21'");
    w.document.getElementById('ts-period').value = 'this-week';
    w.renderTimesheet();
    const myRow = [...w.document.querySelectorAll('#timesheet-rows tr')].find(tr => tr.textContent.includes('Oct 20'));
    check('6. employee: own open shift is NOT absent', !!myRow && /Absent/.test(myRow.textContent), false);
    check('7. employee: own open shift shows as clocked in', !!myRow && /Clocked in|No clock-out/.test(myRow.textContent), true);
    check('8. employee: total counts no hours for the open shift', w.document.getElementById('ts-total').textContent, '0 hrs');
  } catch (e) { results.push({ n: 'EXCEPTION', ok: false, g: e.message + '\n' + e.stack, wnt: '' }); }
  let bad = 0;
  for (const r of results) { if (r.ok) console.log('  PASS  ' + r.n); else { bad++; console.log('  FAIL  ' + r.n + '\n        got  ' + JSON.stringify(r.g) + '\n        want ' + JSON.stringify(r.wnt)); } }
  console.log('\n' + (results.length - bad) + '/' + results.length + ' passed'); process.exit(bad ? 1 : 0);
}, 700);
