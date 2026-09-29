/* The multi-select filter component. The load-bearing choice is that an EMPTY
 * selection means "all": every caller keeps its old no-filter branch, and a
 * newly hired employee is included automatically rather than being left out of
 * an "everyone" that was frozen at selection time. */
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
    const $ = id => w.document.getElementById(id);
    w.demoViewAs('admin-1'); await new Promise(r => setTimeout(r, 300));
    w.switchAdminView('timesheets');

    const emps = D.users.filter(u => u.role === 'employee' && !u.terminatedAt);
    const rows = () => w.document.querySelectorAll('#admin-ts-rows tr').length;

    const all = rows();
    check('1. no selection shows everyone', w.multiValues('admin-ts-emp'), []);
    check('2. button reads the all-label', $('admin-ts-emp-btn').textContent, 'All employees');
    check('3. and is not styled as filtering', $('admin-ts-emp-btn').classList.contains('active'), false);

    w.onMultiToggle('admin-ts-emp', emps[0].id, true);
    const one = rows();
    check('4. one pick narrows the table', one < all && one > 0, true);
    check('5. one pick shows that name', $('admin-ts-emp-btn').textContent, emps[0].name);
    check('6. and is styled as filtering', $('admin-ts-emp-btn').classList.contains('active'), true);

    w.onMultiToggle('admin-ts-emp', emps[1].id, true);
    check('7. two picks show both', rows(), one * 2);
    check('8. label switches to a count', $('admin-ts-emp-btn').textContent, '2 employees');

    w.onMultiToggle('admin-ts-emp', emps[1].id, false);
    check('9. unticking narrows back', rows(), one);

    w.clearMultiFilter('admin-ts-emp');
    check('10. "All" clears rather than selecting everything', w.multiValues('admin-ts-emp'), []);
    check('11. and the table is whole again', rows(), all);

    /* A selection must survive the roster being re-rendered. */
    w.onMultiToggle('admin-ts-emp', emps[0].id, true);
    w.populateEmpFilter();
    check('12. selection survives a roster refresh', w.multiValues('admin-ts-emp'), [emps[0].id]);

    /* A name that disappears from the roster drops out of the selection
     * rather than filtering the table to nothing invisibly. */
    w.setMultiOptions('admin-ts-emp', emps.slice(1).map(u => ({ value: u.id, label: u.name })));
    check('13. a removed option drops out of the selection', w.multiValues('admin-ts-emp'), []);
    w.populateEmpFilter();

    /* Panel open/close. */
    w.toggleMultiPanel('admin-ts-emp');
    check('14. panel opens', $('admin-ts-emp-panel').hidden, false);
    check('15. aria-expanded tracks it', $('admin-ts-emp-btn').getAttribute('aria-expanded'), 'true');
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
    check('16. Escape closes it', $('admin-ts-emp-panel').hidden, true);
    w.toggleMultiPanel('admin-ts-emp');
    w.document.body.click();
    check('17. an outside click closes it', $('admin-ts-emp-panel').hidden, true);

    /* Status filters: independent state, same semantics. */
    w.switchAdminView('approvals');
    const u0 = D.users.find(x => x.role === 'employee');
    D.leaves.length = 0;
    [['approved', 3], ['rejected', 2], ['cancelled', 1]].forEach(([st, n]) => {
      for (let i = 0; i < n; i++) D.leaves.push({ id: st + i, userId: u0.id, type: 'Vacation',
        from: '2026-09-0' + (i + 1), to: '2026-09-0' + (i + 1), status: st, durationType: 'full',
        hours: null, excludedDates: [], balanceDeducted: 1, reason: 'x', createdAt: w.nowISO(), decidedAt: w.nowISO() });
    });
    w.renderLeaveHistory();
    const hist = () => w.document.querySelectorAll('#leave-history-rows tr').length;
    check('18. all six decided leaves show', hist(), 6);
    w.onMultiToggle('leave-history-filter', 'approved', true);
    check('19. approved only', hist(), 3);
    w.onMultiToggle('leave-history-filter', 'cancelled', true);
    check('20. approved + cancelled', hist(), 4);
    check('21. two statuses reads as a count', $('leave-history-filter-btn').textContent, '2 statuses');
    w.clearMultiFilter('leave-history-filter');
    check('22. reset', hist(), 6);
    check('23. the two filters keep separate state',
      [w.multiValues('admin-ts-emp'), w.multiValues('leave-history-filter')], [[], []]);
  } catch (e) { results.push({ n: 'EXCEPTION', ok: false, g: e.message + '\n' + e.stack, wnt: '' }); }
  let bad = 0;
  for (const r of results) { if (r.ok) console.log('  PASS  ' + r.n); else { bad++; console.log('  FAIL  ' + r.n + '\n        got  ' + JSON.stringify(r.g) + '\n        want ' + JSON.stringify(r.wnt)); } }
  console.log('\n' + (results.length - bad) + '/' + results.length + ' passed'); process.exit(bad ? 1 : 0);
}, 700);
