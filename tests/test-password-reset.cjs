/* "Forgot password" must not hide a failed send.
 *
 * 2026-11-16: a contractor asked for a reset link that never came. The address
 * typed was kylieadriennechia@gmail.com; the account is adriennekyliechia@.
 * The screen said "a reset link is on its way" either way - and it also said
 * that when Supabase itself failed to send, because the error was swallowed. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'demo.html'), 'utf8');
const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.test/' }).window;
const results = [];
const check = (n, g, wnt) => results.push({ n, ok: JSON.stringify(g) === JSON.stringify(wnt), g, wnt });
const $ = id => w.document.getElementById(id);

setTimeout(async () => {
  try {
    const sb = w.eval('sb');
    const msg = () => $('fp-msg').textContent;
    let sentTo = null;
    sb.auth.resetPasswordForEmail = async (email) => { sentTo = email; return { data: {}, error: null }; };
    $('fp-email').value = '  KylieAdrienneChia@gmail.com ';
    await w.sendPasswordReset();
    check('1. sends to the trimmed, lower-cased address', sentTo, 'kylieadriennechia@gmail.com');
    check('2. echoes the address so a typo can be spotted', msg().includes('kylieadriennechia@gmail.com'), true);
    check('3. stays neutral about whether the account exists', /If kylieadriennechia@gmail.com has a VeeCare account/.test(msg()), true);
    check('4. button is usable again', [$('fp-send-btn').disabled, $('fp-send-btn').textContent], [false, 'Send reset link']);

    sb.auth.resetPasswordForEmail = async () => ({ data: null, error: { message: 'Email rate limit exceeded' } });
    await w.sendPasswordReset();
    check('5. a failed send is reported, not shown as success', /Could not send the reset email/.test(msg()) && !/on its way/.test(msg()), true);
    check('6. it names the reason and who to ask', /rate limit/.test(msg()) && /admin/.test(msg()), true);

    sb.auth.resetPasswordForEmail = async () => { throw new Error('Failed to fetch'); };
    await w.sendPasswordReset();
    check('7. a network failure is reported too', msg().includes('Could not send the reset email right now (Failed to fetch)'), true);
    check('8. button is usable again after a failure', $('fp-send-btn').disabled, false);
  } catch (e) { results.push({ n: 'EXCEPTION', ok: false, g: e.message + '\n' + e.stack, wnt: '' }); }
  let bad = 0;
  for (const r of results) { if (r.ok) console.log('  PASS  ' + r.n); else { bad++; console.log('  FAIL  ' + r.n + '\n        got  ' + JSON.stringify(r.g) + '\n        want ' + JSON.stringify(r.wnt)); } }
  console.log('\n' + (results.length - bad) + '/' + results.length + ' passed'); process.exit(bad ? 1 : 0);
}, 700);
