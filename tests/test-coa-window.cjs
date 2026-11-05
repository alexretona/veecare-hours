/* COA dates must cover the cutoff the employee can still invoice AND the one
 * before it.
 *
 * 2026-11-04: Angela (monthly cutoff, Oct 1-31) was asked by HR to file a COA
 * for Fri Oct 2. The date list only went back 30 days - to Oct 5 - so the
 * first four days of her still-open cutoff could not be corrected at all. */
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
    const u = D.users.find(x => x.id === 'u-angela');
    w.demoViewAs(u.id);
    await tick(300);
    w.eval("today = () => '2026-11-04'");
    u.cycleFrequency = 'monthly'; u.cycleAnchor = '2026-07-01';
    D.coas.length = 0;
    const vals = () => w.eligibleCoaDates().map(d => d.value);

    check('1. Oct 2 is offered', vals().includes('2026-10-02'), true);
    check('2. so is Oct 1', vals().includes('2026-10-01'), true);
    check('3. reaches back to Sep 1, the cutoff before the open one', vals()[vals().length - 1], '2026-09-01');
    check('3a. but not Aug 31', vals().includes('2026-08-31'), false);
    check('4. still offers yesterday', vals()[0], '2026-11-03');

    // Angela's REAL setup (checked in the database 2026-11-05): monthly,
    // anchored on the 3rd, so cutoffs run 3rd-2nd. Oct 2 is the last day of
    // Sep 3 - Oct 2, which invoice #067 already covers (acknowledged).
    w.eval("today = () => '2026-11-05'");
    u.cycleAnchor = '2026-07-03';
    D.invoices.length = 0;
    D.invoices.push(w.invoiceFromRow({ id: 'i67', invoice_no: '067', user_id: u.id, period_start: '2026-09-03', period_end: '2026-10-02', invoice_date: '2026-10-05', rate: 300, workflow: 'acknowledged' }));
    D.invoices.push(w.invoiceFromRow({ id: 'i93', invoice_no: '093', user_id: u.id, period_start: '2026-10-03', period_end: '2026-11-02', invoice_date: '2026-11-03', rate: 300, workflow: 'acknowledged' }));
    check('1b. real setup: Oct 2 is offered', vals().includes('2026-10-02'), true);
    check('2b. back to Sep 3, start of the cutoff before the open one', vals()[vals().length - 1], '2026-09-03');
    check('3b. but not Sep 2 (two cutoffs back)', vals().includes('2026-09-02'), false);
    w.openCoaModal();
    const opts = [...w.document.querySelectorAll('#coa-date option')].map(o => o.value);
    check('5. the dropdown lists Oct 2', opts.includes('2026-10-02'), true);

    const sel = w.document.getElementById('coa-date');
    sel.value = '2026-10-02'; w.prefillCoaForDate();
    check('5b. the form says Oct 2 is already on invoice #067', /already on invoice #067/.test(w.document.getElementById('coa-type-note').textContent), true);
    sel.value = '2026-11-04'; w.prefillCoaForDate();
    check('5c. a day on no invoice has no such note', /already on invoice/.test(w.document.getElementById('coa-type-note').textContent), false);

    // Admin approving a COA on an invoiced day is told the invoice will not change.
    w.eval("today = () => '2026-11-04'");
    D.coas.push({ id: 'cx', userId: u.id, date: '2026-10-02', status: 'pending', createdAt: '2026-11-05T00:00:00Z',
      clockIn: '2026-10-02T12:00:00Z', clockOut: '2026-10-02T21:00:00Z', lunchStart: null, lunchEnd: null, reason: 'test' });
    w.demoViewAs('admin-1'); await tick(300);
    const D2 = w.eval('D');
    if (!D2.coas.find(c => c.id === 'cx')) D2.coas.push({ id: 'cx', userId: u.id, date: '2026-10-02', status: 'pending', createdAt: '2026-11-05T00:00:00Z', clockIn: '2026-10-02T12:00:00Z', clockOut: '2026-10-02T21:00:00Z', lunchStart: null, lunchEnd: null, reason: 'test' });
    if (!D2.invoices.find(i => i.id === 'i67')) D2.invoices.push(w.invoiceFromRow({ id: 'i67', invoice_no: '067', user_id: u.id, period_start: '2026-09-03', period_end: '2026-10-02', invoice_date: '2026-10-05', rate: 300, workflow: 'acknowledged' }));
    let p = w.approveCoa('cx'); await tick();
    check('5d. approving asks first, naming the invoice', w.document.getElementById('confirm-modal').classList.contains('active') &&
      /#067/.test(w.document.getElementById('confirm-message').textContent), true);
    w.resolveAppConfirm(false); await p; await tick();
    check('5e. Cancel leaves it pending', D2.coas.find(c => c.id === 'cx').status, 'pending');
    D2.coas.splice(D2.coas.findIndex(c => c.id === 'cx'), 1);
    w.demoViewAs(u.id); await tick(300);
    w.eval("today = () => '2026-11-04'");
    D.invoices.length = 0;
    u.cycleAnchor = '2026-07-01';

    // A bi-weekly employee keeps the plain 30-day window: their open cutoff is shorter.
    u.cycleFrequency = 'biweekly'; u.cycleAnchor = '2026-07-27';
    check('6. bi-weekly: oldest offered is 30 days back', vals()[vals().length - 1], '2026-10-05');
    // No cutoff configured: 30 days, as before.
    u.cycleAnchor = null;
    check('7. no cutoff: oldest offered is 30 days back', vals()[vals().length - 1], '2026-10-05');
    // A pending COA still hides its date.
    u.cycleFrequency = 'monthly'; u.cycleAnchor = '2026-07-01';
    D.coas.push({ id: 'c1', userId: u.id, date: '2026-10-02', status: 'pending', createdAt: '2026-11-04T00:00:00Z' });
    check('8. a date with a pending COA is not offered twice', vals().includes('2026-10-02'), false);
  } catch (e) { results.push({ n: 'EXCEPTION', ok: false, g: e.message + '\n' + e.stack, wnt: '' }); }
  let bad = 0;
  for (const r of results) { if (r.ok) console.log('  PASS  ' + r.n); else { bad++; console.log('  FAIL  ' + r.n + '\n        got  ' + JSON.stringify(r.g) + '\n        want ' + JSON.stringify(r.wnt)); } }
  console.log('\n' + (results.length - bad) + '/' + results.length + ' passed'); process.exit(bad ? 1 : 0);
}, 700);
