/* The multi-select filter component.
 *
 * The ticked set IS the filter. Everything ticked (the default) shows
 * everything; ticking "All" selects every option; unticking it clears them and
 * the button says "None selected" so an empty table never reads as lost data.
 *
 * New hires stay covered without any clearing trick: setMultiOptions()
 * re-selects everything when everything WAS selected. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'demo.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.test/' });
const w = dom.window;
const results = [];
const check = (n, g, wnt) => results.push({ n, ok: JSON.stringify(g) === JSON.stringify(wnt), g, wnt });

setTimeout(async () => {
  try {
    const D = w.eval('D');
    const $ = id => w.document.getElementById(id);
    w.demoViewAs('admin-1');
    await new Promise(r => setTimeout(r, 300));
    w.switchAdminView('timesheets');

    const emps = D.users.filter(u => u.role === 'employee' && !u.terminatedAt);
    const rows = () => w.document.querySelectorAll('#admin-ts-rows tr').length;
    const ID = 'admin-ts-emp';

    // ---------- default: everything ticked ----------
    const all = rows();
    check('1. everything is ticked by default', w.multiValues(ID).length, emps.length);
    check('2. button reads the all-label', $(ID + '-btn').textContent, 'All employees');
    check('3. all-ticked is not styled as filtering', $(ID + '-btn').classList.contains('active'), false);

    w.toggleMultiPanel(ID);
    check('4. the All checkbox is ticked in the panel',
      $(ID + '-panel').querySelector('.multi-all input').checked, true);
    check('5. and so is every individual box',
      [...$(ID + '-panel').querySelectorAll('.multi-opt:not(.multi-all) input')].every(i => i.checked), true);
    w.closeAllMultiPanels();

    // ---------- unticking All clears, and says so ----------
    w.setMultiAll(ID, false);
    check('6. unticking All clears every box', w.multiValues(ID), []);
    check('7. the button says None selected', $(ID + '-btn').textContent, 'None selected');
    check('8. with its own warning style', $(ID + '-btn').classList.contains('empty'), true);
    /* One row remains: the empty state itself, asserted next. */
    check('9. no data rows are shown',
      w.document.querySelectorAll('#admin-ts-rows tr td.empty').length, 1);
    check('10. the empty state explains why, not "no entries"',
      /No employees selected/.test($('admin-ts-rows').textContent), true);

    // ---------- picking several ----------
    w.onMultiToggle(ID, emps[0].id, true);
    const one = rows();
    check('11. one pick narrows the table', one > 0 && one < all, true);
    check('12. one pick shows that name', $(ID + '-btn').textContent, emps[0].name);
    check('13. and is styled as filtering', $(ID + '-btn').classList.contains('active'), true);

    w.onMultiToggle(ID, emps[1].id, true);
    check('14. two picks show both employees', rows(), one * 2);
    check('15. label switches to a count', $(ID + '-btn').textContent, '2 employees');

    w.onMultiToggle(ID, emps[2].id, true);
    check('16. three picks', [w.multiValues(ID).length, $(ID + '-btn').textContent], [3, '3 employees']);

    w.onMultiToggle(ID, emps[1].id, false);
    check('17. unticking one narrows again', w.multiValues(ID).length, 2);

    // ---------- All puts everything back ----------
    w.setMultiAll(ID, true);
    check('18. All selects every option', w.multiValues(ID).length, emps.length);
    check('19. the table is whole again', rows(), all);
    check('20. and it stops looking filtered', $(ID + '-btn').classList.contains('active'), false);

    // ---------- selection survives a roster re-render ----------
    w.setMultiAll(ID, false);
    w.onMultiToggle(ID, emps[0].id, true);
    w.populateEmpFilter();
    check('21. a partial selection survives a roster refresh', w.multiValues(ID), [emps[0].id]);

    /* An ALL selection must stay all when the roster grows, or a new hire is
     * silently left out of a filter that reads "All employees". */
    w.setMultiAll(ID, true);
    const grown = emps.map(u => ({ value: u.id, label: u.name }))
      .concat([{ value: 'new-hire', label: 'New Hire' }]);
    w.setMultiOptions(ID, grown);
    check('22. a new hire joins an "All" selection',
      w.multiValues(ID).indexOf('new-hire') !== -1, true);

    /* A name that leaves the roster leaves the selection, rather than
     * filtering the table to nothing with no visible cause. */
    w.setMultiOptions(ID, emps.map(u => ({ value: u.id, label: u.name })));
    w.setMultiAll(ID, false);
    w.onMultiToggle(ID, emps[0].id, true);
    w.setMultiOptions(ID, emps.slice(1).map(u => ({ value: u.id, label: u.name })));
    check('23. a removed option drops out of the selection', w.multiValues(ID), []);
    w.populateEmpFilter();
    w.setMultiAll(ID, true);

    // ---------- panel open / close ----------
    w.toggleMultiPanel(ID);
    check('24. panel opens', $(ID + '-panel').hidden, false);
    check('25. aria-expanded tracks it', $(ID + '-btn').getAttribute('aria-expanded'), 'true');
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
    check('26. Escape closes it', $(ID + '-panel').hidden, true);
    w.toggleMultiPanel(ID);
    w.document.body.click();
    check('27. an outside click closes it', $(ID + '-panel').hidden, true);

    // ---------- REAL clicks, not handler calls ----------
    /* This is the gap that let a shipped bug through: every assertion above
     * calls onMultiToggle/setMultiAll directly, so it passed while clicking an
     * actual checkbox did nothing. The inline onchange was built with
     * JSON.stringify(value), whose double quotes closed the HTML attribute. */
    w.switchAdminView('timesheets');
    w.setMultiAll(ID, true);
    w.toggleMultiPanel(ID);
    const boxes = () => [...$(ID + '-panel').querySelectorAll('.multi-opt:not(.multi-all) input')];
    const allBox = () => $(ID + '-panel').querySelector('.multi-all input');

    allBox().click();                      /* untick All */
    check('34. clicking All unticks everything', w.multiValues(ID), []);

    boxes()[0].click();
    check('35. clicking a checkbox registers in state', w.multiValues(ID), [emps[0].id]);
    check('36. and the button follows', $(ID + '-btn').textContent, emps[0].name);

    boxes()[2].click();
    check('37. a second click adds to the selection', w.multiValues(ID).length, 2);
    check('38. and the table shows both', rows(), one * 2);

    /* The clicked node must survive: rebuilding the list mid-interaction reset
     * the panel scroll and dropped focus in a real browser. */
    const node = boxes()[2];
    boxes()[1].click();
    check('39. an earlier checkbox node is not replaced by a later click',
      boxes()[2] === node, true);
    check('40. three selected', w.multiValues(ID).length, 3);

    boxes()[1].click();
    check('41. clicking again removes it', w.multiValues(ID).length, 2);

    allBox().click();                      /* tick All */
    check('42. clicking All selects every option', w.multiValues(ID).length, emps.length);
    check('43. and every box shows ticked', boxes().every(b => b.checked), true);
    w.closeAllMultiPanels();

    // ---------- status filters: same component, separate state ----------
    w.switchAdminView('approvals');
    const u0 = D.users.find(x => x.role === 'employee');
    D.leaves.length = 0;
    [['approved', 3], ['rejected', 2], ['cancelled', 1]].forEach(([st, n]) => {
      for (let i = 0; i < n; i++) {
        D.leaves.push({ id: st + i, userId: u0.id, type: 'Vacation',
          from: '2026-09-0' + (i + 1), to: '2026-09-0' + (i + 1), status: st,
          durationType: 'full', hours: null, excludedDates: [], balanceDeducted: 1,
          reason: 'x', createdAt: w.nowISO(), decidedAt: w.nowISO() });
      }
    });
    w.renderLeaveHistory();
    const hist = () => w.document.querySelectorAll('#leave-history-rows tr').length;
    check('28. all six decided leaves show by default', hist(), 6);

    w.setMultiAll('leave-history-filter', false);
    w.onMultiToggle('leave-history-filter', 'approved', true);
    check('29. approved only', hist(), 3);
    w.onMultiToggle('leave-history-filter', 'cancelled', true);
    check('30. approved + cancelled', hist(), 4);
    check('31. two statuses reads as a count', $('leave-history-filter-btn').textContent, '2 statuses');
    w.setMultiAll('leave-history-filter', true);
    check('32. All shows every status again', hist(), 6);

    check('33. the two filters keep separate state',
      [w.multiValues(ID).length === emps.length, w.multiValues('leave-history-filter').length],
      [true, 3]);

  } catch (e) {
    results.push({ n: 'EXCEPTION', ok: false, g: e.message + '\n' + e.stack, wnt: '' });
  }
  let bad = 0;
  for (const r of results) {
    if (r.ok) console.log('  PASS  ' + r.n);
    else { bad++; console.log('  FAIL  ' + r.n + '\n        got  ' + JSON.stringify(r.g) + '\n        want ' + JSON.stringify(r.wnt)); }
  }
  console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
  process.exit(bad ? 1 : 0);
}, 700);
