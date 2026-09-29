/* The reported bug, reproduced against the mechanism that caused it:
 * a server that caps every response at 1000 rows and says nothing. Before the
 * fix, hydrate() kept 1000 of them - the oldest - and the newest days vanished
 * from every admin screen. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('C:/Users/alexr/source/repos/veecare-hours/demo.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.test/' });
const w = dom.window;
const results = [];
const check = (n, g, wnt) => results.push({ n, ok: JSON.stringify(g) === JSON.stringify(wnt), g, wnt });

setTimeout(async () => {
  try {
    const CAP = 1000;
    /* A fake PostgREST: honours order + range, and never returns more than CAP
     * rows in one response - silently, exactly like the real one. */
    const rows = [];
    for (let i = 0; i < 2350; i++) {
      rows.push({ id: String(i).padStart(6, '0'), n: i });
    }
    let calls = 0;
    const build = () => ({
      order() { return this; },
      range(from, to) {
        calls++;
        const want = Math.min(to - from + 1, CAP);
        return Promise.resolve({ data: rows.slice(from, from + want), error: null });
      }
    });

    const fetchAllRows = w.eval('fetchAllRows');
    const res = await fetchAllRows(build, 'fake');
    check('1. every row is fetched, not just the first page', res.data.length, 2350);
    check('2. no error', res.error, null);
    check('3. the NEWEST rows are present (this is what admins lost)',
      res.data[res.data.length - 1].n, 2349);
    check('4. nothing duplicated', new Set(res.data.map(r => r.id)).size, 2350);
    check('5. it paged rather than guessing', calls, 3);

    /* An error on a later page must surface, not be swallowed. */
    let n = 0;
    const failing = () => ({
      order() { return this; },
      range(from, to) {
        n++;
        if (n === 2) return Promise.resolve({ data: null, error: { message: 'boom' } });
        return Promise.resolve({ data: rows.slice(from, from + CAP), error: null });
      }
    });
    const bad = await fetchAllRows(failing, 'fake');
    check('6. an error on page 2 is returned, not silently truncated',
      [bad.data, bad.error && bad.error.message], [null, 'boom']);

    /* A short first page ends it in one call. */
    calls = 0;
    const small = () => ({
      order() { return this; },
      range() { calls++; return Promise.resolve({ data: rows.slice(0, 12), error: null }); }
    });
    const s = await fetchAllRows(small, 'fake');
    check('7. a small table costs exactly one request', [s.data.length, calls], [12, 1]);

    /* And the demo's own mock honours range, so the demo cannot silently
     * reproduce the production bug. */
    const DB = w.eval('DB');
    DB.holidays.length = 0;
    for (let i = 0; i < 5; i++) DB.holidays.push({ id: 'h' + i, holiday_date: '2026-09-0' + (i + 1), name: 'H' + i, paid: true, hours: 8, holiday_type: 'regular' });
    const sb = w.eval('sb');
    const page = await sb.from('holidays').select('*').order('id', { ascending: true }).range(1, 2);
    check('8. mock range() is inclusive, like PostgREST',
      page.data.map(r => r.id), ['h1', 'h2']);

  } catch (e) { results.push({ n: 'EXCEPTION', ok: false, g: e.message + '\n' + e.stack, wnt: '' }); }
  let bad = 0;
  for (const r of results) { if (r.ok) console.log('  PASS  ' + r.n); else { bad++; console.log('  FAIL  ' + r.n + '\n        got  ' + JSON.stringify(r.g) + '\n        want ' + JSON.stringify(r.wnt)); } }
  console.log('\n' + (results.length - bad) + '/' + results.length + ' passed'); process.exit(bad ? 1 : 0);
}, 500);
