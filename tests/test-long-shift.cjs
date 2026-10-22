/* Long shifts must be confirmed, never silently recorded.
 *
 * 2026-10-22: Diane's shift was force-closed by an admin 16.86 hrs after she
 * clocked in. The modal pre-filled "now" (it only switched to clock-in + 8h
 * past 20 hrs) and it was saved as-is. Five such force-closes since July, plus
 * employees who forgot and clocked out hours later. Both doors now stop at
 * LONG_SHIFT_HOURS (12) and ask; the timesheet flags any that get through. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'demo.html'), 'utf8');
const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.test/' }).window;
const results = [];
const check = (n, g, wnt) => results.push({ n, ok: JSON.stringify(g) === JSON.stringify(wnt), g, wnt });
const tick = (ms = 80) => new Promise(r => setTimeout(r, ms));
const $ = id => w.document.getElementById(id);
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const hoursAgo = h => new Date(Date.now() - h * 3600e3).toISOString();

setTimeout(async () => {
  try {
    const D = w.eval('D');
    w.demoViewAs('admin-1');
    await tick(300);
    const emps = D.users.filter(u => u.role === 'employee' && !u.terminatedAt);
    const [a, b] = emps;
    D.entries.length = 0;
    const open = (id, u, h) => { const e = { id, userId: u.id, date: w.today(), status: 'in-progress', clockIn: hoursAgo(h), clockOut: null, pauses: [], lunchStart: null, lunchEnd: null }; D.entries.push(e); w.eval('DB').time_entries.push({ id, user_id: u.id, work_date: e.date, status: 'in-progress', clock_in: e.clockIn, clock_out: null, pauses: [] }); return e; };

    // ---------- admin force clock-out, 16.86 hrs open ----------
    const diane = open('long-1', a, 16.86);
    w.openForceClockOutModal('long-1');
    const tz = a.timezone || w.eval('ACTIVE_TZ');
    const expectedDefault = new Date(new Date(diane.clockIn).getTime() + 8 * 3600e3).toISOString();
    check('1. force: 16.86h open no longer defaults to now (defaults to clock-in + 8h)', $('fco-time').value, w.isoToZoneHHMM(expectedDefault, tz));
    check('2. force: preview says how many hours it will record (minute precision)', /This records (7\.9\d|8) hours/.test($('fco-preview').textContent), true);
    // admin types "now" anyway
    const nowIso = new Date(Date.now() - 60e3).toISOString();
    $('fco-date').value = w.zoneYmd(new Date(nowIso), tz);
    $('fco-time').value = w.isoToZoneHHMM(nowIso, tz);
    w.previewForceClockOut();
    check('3. force: preview turns into a warning past 12h', /longer than 12/.test($('fco-preview').textContent), true);
    w.submitForceClockOut();
    await tick();
    const msg = $('confirm-message').textContent;
    check('4. force: confirm states the hours and warns', /This records 16\.\d+ hours/.test(msg) && /longer than 12 hours/.test(msg), true);
    w.resolveAppConfirm(false);
    await tick();
    check('5. force: cancelling leaves the shift open', D.entries.find(e => e.id === 'long-1').status, 'in-progress');
    w.closeForceClockOutModal && w.closeForceClockOutModal();

    // ---------- employee clocks out of their own 14h shift ----------
    D.entries.length = 0; w.eval('DB').time_entries.length = 0;
    const mine = open('long-2', b, 14);
    w.demoViewAs(b.id);
    await tick(300);
    w.clockOut();
    await tick();
    check('6. employee: 14h shift opens the long-shift modal, not a plain confirm',
      [$('late-clockout-modal').classList.contains('active'), $('confirm-modal').classList.contains('active')], [true, false]);
    check('7. employee: modal says how long ago they clocked in', /14 hours ago/.test($('lco-info').textContent), true);
    const myTz = w.eval('ACTIVE_TZ');
    // a time before clock-in is refused
    const before = new Date(new Date(mine.clockIn).getTime() - 3600e3).toISOString();
    $('lco-date').value = w.zoneYmd(new Date(before), myTz); $('lco-time').value = w.isoToZoneHHMM(before, myTz);
    await w.lateClockOutAt();
    check('8. employee: an end time before clock-in is refused', D.entries.find(e => e.id === 'long-2').status, 'in-progress');
    // real end: 9h after clock-in
    const real = new Date(new Date(mine.clockIn).getTime() + 9 * 3600e3).toISOString();
    $('lco-date').value = w.zoneYmd(new Date(real), myTz); $('lco-time').value = w.isoToZoneHHMM(real, myTz);
    w.previewLateClockOut();
    check('9. employee: preview shows the hours their time records (minute precision)', /This records (8\.9\d|9) hours/.test($('lco-preview').textContent), true);
    click([...w.document.querySelectorAll('#late-clockout-modal button')].find(x => /Clock out at this time/.test(x.textContent)));
    await tick(200);
    const done = D.entries.find(e => e.id === 'long-2');
    check('10. employee: shift closed at the time they gave (9 hrs, not 14)', [done.status, Math.round(w.workedHours(done))], ['completed', 9]);

    // ---------- normal shift: unchanged behaviour ----------
    D.entries.length = 0; w.eval('DB').time_entries.length = 0;
    open('short-1', b, 5);
    w.clockOut();
    await tick();
    check('11. employee: a 5h shift gets the normal confirm, no long-shift modal',
      [$('late-clockout-modal').classList.contains('active'), $('confirm-modal').classList.contains('active')], [false, true]);
    w.resolveAppConfirm(false);
    await tick();

    // ---------- admin timesheet flags long finished shifts ----------
    w.demoViewAs('admin-1');
    await tick(300);
    D.entries.length = 0;
    D.entries.push({ id: 'f1', userId: a.id, date: w.today(), status: 'completed', clockIn: hoursAgo(20), clockOut: hoursAgo(3), pauses: [] });
    D.entries.push({ id: 'f2', userId: b.id, date: w.today(), status: 'completed', clockIn: hoursAgo(12), clockOut: hoursAgo(3), pauses: [] });
    w.switchAdminView('timesheets');
    $('admin-ts-period').value = 'this-week';
    w.renderAdminTimesheets();
    const rowOf = n => [...w.document.querySelectorAll('#admin-ts-rows tr')].find(tr => tr.textContent.includes(n) && /\d/.test(tr.cells[4]?.textContent || ''));
    check('12. timesheet: a 17h shift is flagged', /long shift/.test(rowOf(a.name).textContent), true);
    check('13. timesheet: a 9h shift is not', /long shift/.test(rowOf(b.name).textContent), false);
  } catch (e) { results.push({ n: 'EXCEPTION', ok: false, g: e.message + '\n' + e.stack, wnt: '' }); }
  let bad = 0;
  for (const r of results) { if (r.ok) console.log('  PASS  ' + r.n); else { bad++; console.log('  FAIL  ' + r.n + '\n        got  ' + JSON.stringify(r.g) + '\n        want ' + JSON.stringify(r.wnt)); } }
  console.log('\n' + (results.length - bad) + '/' + results.length + ' passed'); process.exit(bad ? 1 : 0);
}, 700);
