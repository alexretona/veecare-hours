/* Self-signups wait for an admin (migration 025).
 *
 * 2026-10-12: Joanne mistyped her sign-in email (joanee@ for joannee@), used
 * "Create account" with the typo and clocked in on the new account, then on
 * her real one - two "Joanne Marie Espejon" rows on the Overview. The signup
 * screen said "Owner approves later"; nothing enforced it. The database now
 * marks self-signups pending and refuses their clock-ins; these tests cover
 * the app side: pending accounts stay out of every roster, the admin sees
 * them with a duplicate-name warning, and Approve / Reject work by CLICKING. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'demo.html'), 'utf8');
const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.test/' }).window;
const results = [];
const check = (n, g, wnt) => results.push({ n, ok: JSON.stringify(g) === JSON.stringify(wnt), g, wnt });
const tick = (ms = 60) => new Promise(r => setTimeout(r, ms));
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

setTimeout(async () => {
  try {
    const D = w.eval('D');
    const DB = w.eval('DB');
    w.demoViewAs('admin-1');
    await tick(300);
    const real = D.users.find(u => u.role === 'employee' && !u.terminatedAt);
    const before = D.users.length;

    // A duplicate of an existing employee (same name, different case) and an unrelated new hire.
    DB.profiles.push({ id: 'dup-1', username: 'joanee', name: real.name.toUpperCase(), role: 'employee', rate: 0,
      pending_approval: true, created_at: '2026-10-12T06:08:57Z', employment_status: 'Probationary' });
    DB.profiles.push({ id: 'new-1', username: 'newhire', name: 'Zed Newhire', role: 'employee', rate: 0,
      pending_approval: true, created_at: '2026-10-12T07:00:00Z', employment_status: 'Probationary' });
    await w.hydrate();

    check('1. pending accounts are NOT in D.users', D.users.some(u => u.id === 'dup-1' || u.id === 'new-1'), false);
    check('2. ...they are in D.pendingUsers', D.pendingUsers.map(u => u.id).sort(), ['dup-1', 'new-1']);
    check('3. roster size unchanged', D.users.length, before);

    w.switchAdminView('employees');
    await tick();
    const box = w.document.getElementById('pending-approvals');
    check('4. approval panel lists both', box.querySelectorAll('tbody tr').length, 2);
    const rowOf = name => [...box.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes(name));
    check('5. duplicate name is flagged', /probably a duplicate/.test(rowOf('joanee').textContent), true);
    check('6. unrelated new hire is not flagged', /probably a duplicate/.test(rowOf('newhire').textContent), false);
    const dot = w.document.getElementById('emp-pending-dot');
    check('7. Employees nav shows the count', [dot.style.display, dot.textContent], ['inline-block', '2']);
    check('8. pending people are not in the Employees table', w.document.getElementById('employees-table').textContent.includes('Zed Newhire'), false);

    // Reject the duplicate - real clicks, through the in-app confirm.
    click(rowOf('joanee').querySelector('button.btn-ghost'));
    await tick();
    click(w.document.getElementById('confirm-ok-btn'));
    await tick(150);
    const dupRow = DB.profiles.find(p => p.id === 'dup-1');
    check('9. reject: deactivated in the database', [!!dupRow.terminated_at, dupRow.pending_approval], [true, false]);
    check('10. reject: shows under Terminated, not active', [!!D.users.find(u => u.id === 'dup-1').terminatedAt, D.pendingUsers.length], [true, 1]);

    // Approve the new hire.
    click(rowOf('newhire').querySelector('button.btn:not(.btn-ghost)'));
    await tick();
    click(w.document.getElementById('confirm-ok-btn'));
    await tick(150);
    check('11. approve: cleared in the database', DB.profiles.find(p => p.id === 'new-1').pending_approval, false);
    check('12. approve: now on the active roster', !!D.users.find(u => u.id === 'new-1' && !u.terminatedAt), true);
    check('13. panel and badge clear when nothing is pending', [box.innerHTML, dot.style.display], ['', 'none']);

    // The locked-out screen explains itself.
    w.showAccessRevoked('pending');
    check('14. pending screen title', w.document.getElementById('access-revoked-title').textContent, 'Waiting for approval');
    check('15. pending screen points them back to their real account', /Already have an account\? Sign in/.test(w.document.getElementById('access-revoked-msg').textContent), true);
    w.showAccessRevoked();
    check('16. terminated screen unchanged', w.document.getElementById('access-revoked-title').textContent, 'Access revoked');
  } catch (e) { results.push({ n: 'EXCEPTION', ok: false, g: e.message + '\n' + e.stack, wnt: '' }); }
  let bad = 0;
  for (const r of results) { if (r.ok) console.log('  PASS  ' + r.n); else { bad++; console.log('  FAIL  ' + r.n + '\n        got  ' + JSON.stringify(r.g) + '\n        want ' + JSON.stringify(r.wnt)); } }
  console.log('\n' + (results.length - bad) + '/' + results.length + ' passed'); process.exit(bad ? 1 : 0);
}, 700);
