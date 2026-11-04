/* COA dates must cover the whole cutoff the employee can still invoice.
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

    check('1. Oct 2 is offered (Angela\'s case)', vals().includes('2026-10-02'), true);
    check('2. so is Oct 1, the first day of the open cutoff', vals().includes('2026-10-01'), true);
    check('3. but not Sep 30, the cutoff before it', vals().includes('2026-09-30'), false);
    check('4. still offers yesterday', vals()[0], '2026-11-03');

    w.openCoaModal();
    const opts = [...w.document.querySelectorAll('#coa-date option')].map(o => o.value);
    check('5. the dropdown lists Oct 2', opts.includes('2026-10-02'), true);

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
