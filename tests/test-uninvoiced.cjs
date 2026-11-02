/* Two safeguards added 2026-11-02 after Jona could not request Oct 19-30.
 *
 * 1. Her bi-weekly cutoff anchor had been saved as a TUESDAY (Jul 28), so her
 *    cutoffs ran Tue-Mon. Invoice #081 (Oct 6-19) took the next cutoff's
 *    Monday and the app said her last completed cutoff was already invoiced.
 *    The cycle form now warns, and asks before saving, a non-Monday anchor.
 *
 * 2. An employee can only request their MOST RECENT finished cutoff, so a
 *    missed one can never be requested again. Jona's Sep 21 - Oct 2 and
 *    Daryl's Sep 14-25 sat uninvoiced for weeks. The Invoices page now lists
 *    finished cutoffs with shifts no invoice covers. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'demo.html'), 'utf8');
const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.test/' }).window;
const results = [];
const check = (n, g, wnt) => results.push({ n, ok: JSON.stringify(g) === JSON.stringify(wnt), g, wnt });
const tick = (ms = 80) => new Promise(r => setTimeout(r, ms));
const $ = id => w.document.getElementById(id);

const shift = (id, userId, date, hrs) => ({ id, userId, date, status: 'completed',
  clockIn: date + 'T01:00:00Z', clockOut: date + 'T' + String(1 + hrs).padStart(2, '0') + ':00:00Z',
  pauses: [], lunchStart: null, lunchEnd: null });
const inv = (id, userId, from, to, workflow) => w.invoiceFromRow({ id, invoice_no: id, user_id: userId,
  period_start: from, period_end: to, invoice_date: to, rate: 100, workflow: workflow || 'acknowledged' });

setTimeout(async () => {
  try {
    const D = w.eval('D');
    w.eval("today = () => '2026-11-02'");
    w.demoViewAs('admin-1');
    await tick(300);
    w.eval("today = () => '2026-11-02'");
    const emps = D.users.filter(u => u.role === 'employee' && !u.terminatedAt);
    const [a, b] = emps;

    // ---------- 1. the anchor warning ----------
    check('1. Tuesday bi-weekly anchor warns', /Tuesday/.test(w.cycleAnchorWarning('2026-07-28', 'biweekly')), true);
    check('2. Monday bi-weekly anchor is fine', w.cycleAnchorWarning('2026-07-27', 'biweekly'), '');
    check('3. monthly anchor on a Tuesday is fine', w.cycleAnchorWarning('2026-07-28', 'monthly'), '');
    check('4. twice-a-month anchor on a Tuesday is fine', w.cycleAnchorWarning('2026-09-01', 'semimonthly'), '');

    w.switchAdminView('employees');
    w.openCycleModal(a.id);
    $('cyc-freq').value = 'biweekly';
    $('cyc-anchor').value = '2026-07-28';
    $('cyc-anchor').dispatchEvent(new w.Event('change'));
    check('5. preview shows the warning', /starts on a Tuesday/.test($('cyc-preview').textContent), true);
    $('cyc-anchor').value = '2026-07-27';
    $('cyc-anchor').dispatchEvent(new w.Event('change'));
    check('6. preview is clean for a Monday', /starts on a/.test($('cyc-preview').textContent), false);

    // Save a Tuesday: must ask; Cancel keeps the old anchor.
    const before = a.cycleAnchor;
    $('cyc-anchor').value = '2026-07-28';
    let p = w.saveCycle();
    await tick();
    check('7. saving a Tuesday asks first', $('confirm-modal').classList.contains('active'), true);
    check('8. ...and says why', /Tuesday/.test($('confirm-message').textContent), true);
    w.resolveAppConfirm(false); await p; await tick();
    check('9. Cancel does not save', a.cycleAnchor, before);
    p = w.saveCycle(); await tick();
    $('confirm-ok-btn').click(); await p; await tick();
    check('10. Save anyway saves it', a.cycleAnchor, '2026-07-28');
    // Monday saves without asking
    w.openCycleModal(a.id);
    $('cyc-freq').value = 'biweekly';
    $('cyc-anchor').value = '2026-07-27';
    p = w.saveCycle(); await tick();
    check('11. a Monday saves without a prompt', $('confirm-modal').classList.contains('active'), false);
    await p;
    check('12. ...and is saved', a.cycleAnchor, '2026-07-27');

    // ---------- 2. shifts not on any invoice ----------
    // a: Mon Jul 27 anchor. Today Mon Nov 2 starts a new cutoff (Nov 2-13), so
    // the one they can still request is Oct 19-30.
    b.cycleAnchor = '2026-07-27'; b.cycleFrequency = 'biweekly';
    D.entries.length = 0; D.invoices.length = 0; D.leaves.length = 0; D.holidays.length = 0;
    D.entries.push(
      shift('e0', a.id, '2026-08-25', 8),   // before their first invoice: ignored
      shift('e1', a.id, '2026-09-08', 8),   // covered by Sep 7-18
      shift('e2', a.id, '2026-09-22', 8),   // GAP (Sep 21 - Oct 2)
      shift('e3', a.id, '2026-09-23', 7),   // GAP
      shift('e4', a.id, '2026-10-06', 8),   // covered by Oct 5-16
      shift('e5', a.id, '2026-10-20', 8),   // the cutoff they CAN still request: not flagged
      shift('e6', b.id, '2026-09-22', 8));  // covered by a REQUESTED invoice: not flagged
    D.invoices.push(inv('i1', a.id, '2026-09-07', '2026-09-18'), inv('i2', a.id, '2026-10-05', '2026-10-16'),
      inv('i3', b.id, '2026-09-21', '2026-10-02', 'requested'));
    const gaps = w.findUninvoicedShifts(a);
    check('13. one gap found for a', gaps.length, 1);
    check('14. gap is Sep 22-23, 2 shifts, 15 hrs',
      gaps[0] && [gaps[0].from, gaps[0].to, gaps[0].shifts, gaps[0].hours], ['2026-09-22', '2026-09-23', 2, 15]);
    check('15. grouped under its cutoff Sep 21 - Oct 2', gaps[0] && [gaps[0].cutoff.start, gaps[0].cutoff.end], ['2026-09-21', '2026-10-02']);
    check('16. a requested invoice counts as covering', w.findUninvoicedShifts(b).length, 0);
    const c = emps[2];
    if (c) {
      D.entries.push(shift('e7', c.id, '2026-09-22', 8));
      check('17. no invoices yet -> nothing flagged (no baseline)', w.findUninvoicedShifts(c).length, 0);
    }

    w.switchAdminView('invoices');
    const panel = $('uninvoiced-panel');
    check('18. panel lists the gap', /Shifts not on any invoice \(1\)/.test(panel.textContent) && panel.textContent.includes(a.name), true);
    check('19. Invoices nav badge shows 1', [$('inv-gap-dot').style.display, $('inv-gap-dot').textContent], ['inline-block', '1']);

    // Create invoice... opens the builder on exactly the loose days
    panel.querySelector('[data-gap-invoice]').click();
    await tick();
    check('20. builder opens', $('invoice-builder-modal').classList.contains('active'), true);
    check('21. on Sep 22-23', [$('ib-from').value, $('ib-to').value, w.eval('IB.start'), w.eval('IB.end')],
      ['2026-09-22', '2026-09-23', '2026-09-22', '2026-09-23']);
    w.closeInvoiceBuilder && w.closeInvoiceBuilder();

    // Once invoiced, it disappears
    D.invoices.push(inv('i4', a.id, '2026-09-21', '2026-10-02', 'draft'));
    w.renderCutoffs();
    check('22. an invoice over the dates clears it', [panel.textContent.trim(), $('inv-gap-dot').style.display], ['', 'none']);
    D.invoices.pop();

    // Hide (already paid another way)
    w.renderCutoffs();
    panel.querySelector('[data-gap-hide]').click(); await tick();
    check('23. hide asks first', $('confirm-modal').classList.contains('active'), true);
    $('confirm-ok-btn').click(); await tick();
    check('24. hidden rows go away', [panel.textContent.trim(), $('inv-gap-dot').style.display], ['', 'none']);
    check('25. remembered in this browser', JSON.parse(w.localStorage.getItem('vc_uninvoiced_ok')).sort(),
      [a.id + '|2026-09-22', a.id + '|2026-09-23']);

    // A new loose shift in the same cutoff still shows
    D.entries.push(shift('e8', a.id, '2026-09-24', 8));
    w.renderCutoffs();
    check('26. a new loose day still shows', w.findUninvoicedShifts(a).map(g => g.dates), [['2026-09-24']]);

    // Terminated employees are not listed
    a.terminatedAt = '2026-10-31T00:00:00Z';
    check('27. terminated -> not listed', w.allUninvoicedGaps().length, 0);
    a.terminatedAt = null;
  } catch (e) { results.push({ n: 'EXCEPTION', ok: false, g: e.message + '\n' + e.stack, wnt: '' }); }
  let bad = 0;
  for (const r of results) { if (r.ok) console.log('  PASS  ' + r.n); else { bad++; console.log('  FAIL  ' + r.n + '\n        got  ' + JSON.stringify(r.g) + '\n        want ' + JSON.stringify(r.wnt)); } }
  console.log('\n' + (results.length - bad) + '/' + results.length + ' passed'); process.exit(bad ? 1 : 0);
}, 700);
