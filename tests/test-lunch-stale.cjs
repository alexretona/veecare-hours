/* A screen left open must not overwrite a lunch that was already recorded.
 *
 * 2026-11-11, Mari: clocked in 8:50 PM Nov 10, lunch 2:29-3:10 AM. At 6:00 AM
 * a page still open from before her lunch offered "Start lunch break"; the
 * click wrote lunch_start = 6:00 AM over the finished lunch (end 3:10 AM) and
 * left the shift open. An admin later force-closed it at the clock-in + 8h
 * default (4:50 AM), and the backwards lunch counted as -170 min, so the
 * shift showed 10.82 hrs instead of 8. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'demo.html'), 'utf8');
const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.test/' }).window;
const results = [];
const check = (n, g, wnt) => results.push({ n, ok: JSON.stringify(g) === JSON.stringify(wnt), g, wnt });
const tick = (ms = 80) => new Promise(r => setTimeout(r, ms));
const hoursAgo = h => new Date(Date.now() - h * 3600e3).toISOString();

setTimeout(async () => {
  try {
    const D = w.eval('D');
    const DB = w.eval('DB');
    const u = D.users.find(x => x.role === 'employee' && !x.terminatedAt);
    w.demoViewAs(u.id);
    await tick(300);

    // ---- the exact row: backwards lunch must not add hours ----
    const mari = { clockIn: '2026-11-10T12:50:35Z', clockOut: '2026-11-10T20:50:00Z',
      lunchStart: '2026-11-10T22:00:06Z', lunchEnd: '2026-11-10T19:10:07Z', pauses: [] };
    check('1. lunch ending before it starts counts as 0 min, not negative', w.lunchMinutes(mari), 0);
    check('2. so that shift is 7.99 hrs (8 on the clock), not 10.82', w.round2(w.workedHours(mari)), 7.99);
    check('3. a normal lunch still subtracts', w.round2(w.workedHours(Object.assign({}, mari, { lunchStart: '2026-11-10T18:29:07Z' }))), 7.31);

    // ---- stale screen: database already has a finished lunch ----
    D.entries.length = 0;
    DB.time_entries.length = 0;
    const id = 'stale-1', inAt = hoursAgo(9), ls = hoursAgo(3.5), le = hoursAgo(2.8);
    DB.time_entries.push({ id, user_id: u.id, work_date: w.today(), status: 'in-progress', clock_in: inAt, clock_out: null,
      lunch_start: ls, lunch_end: le, pauses: [], deleted_at: null });
    // this screen loaded before lunch: it still thinks no lunch was taken
    D.entries.push({ id, userId: u.id, date: w.today(), status: 'in-progress', clockIn: inAt, clockOut: null, lunchStart: null, lunchEnd: null, pauses: [] });
    w.renderEmployee();
    await w.startLunch();
    check('4. stale "Start lunch" does not overwrite the recorded lunch start', DB.time_entries[0].lunch_start, ls);
    check('5. ...and the lunch end is untouched', DB.time_entries[0].lunch_end, le);
    const local = D.entries.find(e => e.id === id);
    check('6. the screen re-reads the real row', [local.lunchStart, local.lunchEnd], [ls, le]);
    check('7. and says it was out of date', /out of date/.test(w.document.querySelector('.toast, #toast') ? w.document.querySelector('.toast, #toast').textContent : ''), true);

    // ---- normal flow still works ----
    DB.time_entries[0].lunch_start = null; DB.time_entries[0].lunch_end = null;
    local.lunchStart = null; local.lunchEnd = null;
    await w.startLunch();
    check('8. a real lunch start still saves', !!DB.time_entries[0].lunch_start, true);
    await w.endLunch();
    check('9. and ends', !!DB.time_entries[0].lunch_end, true);

    // stale "End lunch": database already ended it
    const realEnd = DB.time_entries[0].lunch_end;
    local.lunchEnd = null;
    await tick(20);
    await w.endLunch();
    check('10. stale "End lunch" does not move the recorded end', DB.time_entries[0].lunch_end, realEnd);

    // a shift already clocked out elsewhere cannot get a lunch started
    DB.time_entries[0].status = 'completed'; DB.time_entries[0].clock_out = hoursAgo(0.1);
    DB.time_entries[0].lunch_start = null; DB.time_entries[0].lunch_end = null;
    local.status = 'in-progress'; local.clockOut = null; local.lunchStart = null; local.lunchEnd = null;
    await w.startLunch();
    check('11. no lunch written onto a shift already clocked out', DB.time_entries[0].lunch_start, null);

    // clock-out may not land before a lunch that started
    check('12. earliest clock-out is after the lunch start too', w.earliestClockOut(mari), mari.lunchStart);
  } catch (e) { results.push({ n: 'EXCEPTION', ok: false, g: e.message + '\n' + e.stack, wnt: '' }); }
  let bad = 0;
  for (const r of results) { if (r.ok) console.log('  PASS  ' + r.n); else { bad++; console.log('  FAIL  ' + r.n + '\n        got  ' + JSON.stringify(r.g) + '\n        want ' + JSON.stringify(r.wnt)); } }
  console.log('\n' + (results.length - bad) + '/' + results.length + ' passed'); process.exit(bad ? 1 : 0);
}, 700);
