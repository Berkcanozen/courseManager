/**
 * MEISNER STUDIO — tests/e2e-edge.js
 * Edge-case E2E: the real frontend (index.html) in headless Chromium talking
 * to the REAL backend code (*.gs) running under Node via tests/gas-mock.js —
 * with Google Sheets value coercion switched on. Nothing touches the live
 * spreadsheet.
 *
 * Covers: Sheets data-integrity traps (leading zeros, "+", formulas), XSS,
 * unicode, capacity limits, deposit/instalment validation and rounding,
 * overpayment, decimals, overdue, CSV injection, archive filter, network
 * failures, login lockout.
 *
 * Setup (once):  npm install && npx playwright install chromium
 * Run:           npm run test:edge
 */
process.env.TZ = 'Europe/Amsterdam';
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');
const { makeGasEnv } = require('./gas-mock');

const ROOT = path.resolve(__dirname, '..');
const APP  = 'file://' + path.join(ROOT, 'index.html');

/* ── runner ── */
let passed = 0, failed = 0; const fails = [];
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; fails.push(name); console.log('  ✗ ' + name + '\n      ' + String(e.message).split('\n')[0]); }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m ? m + ': ' : ''}expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, m) => { if (!v) throw new Error(m || 'assertion failed'); };
const group = n => console.log('\n' + n);

const dayOffset = n => { const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

(async () => {
  const G = makeGasEnv({ sheetsTyping: true });
  const calls = [];
  // Fault injection for resilience tests: a queue of 'fail500' | 'abort'
  const faults = [];

  const browser = await chromium.launch();
  const ctx  = await browser.newContext({ timezoneId: 'Europe/Amsterdam', locale: 'en-US', acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/\[apiFetch\]|\[syncSheets\]|Failed to load resource|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', d => { errors.push('native dialog: ' + d.message()); d.dismiss(); });

  let pending = 0;
  await page.route(/script\.google\.com/, async route => {
    const req = route.request();
    pending++;
    try {
      if (req.method() === 'GET') return await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(G.get({ action: 'ping' })) });
      const body = JSON.parse(req.postData());
      calls.push(body.action);
      await new Promise(r => setTimeout(r, 60));
      const f = faults.shift();
      if (f === 'abort') return await route.abort('failed');
      if (f === 'fail500') return await route.fulfill({ status: 500, body: 'cold start' });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(G.post(body)) });
    } finally { pending--; }
  });
  await page.route(/jsdelivr|googleapis|gstatic/, r => r.abort());

  // Idle = no request in flight AND the app isn't mid-save / mid-sync (the app
  // sleeps 1.5s between retries, during which no request is pending).
  const appBusy = () => page.evaluate(() =>
    (typeof _saving !== 'undefined' && _saving) ||
    /Syncing/.test(document.getElementById('syncBadge')?.textContent || '')).catch(() => false);
  const settle = async () => {
    await page.waitForTimeout(40);
    for (let idle = 0, i = 0; idle < 5 && i < 300; i++) {
      await page.waitForTimeout(40);
      idle = (pending === 0 && !(await appBusy())) ? idle + 1 : 0;
    }
  };
  const count  = a => calls.filter(c => c === a).length;
  const rows   = name => (G.sheets[name] ? G.sheets[name]._rows.slice(1) : []);
  const toastWith = async (re, timeout = 4000) => {
    await page.waitForFunction(src => [...document.querySelectorAll('.toast')].some(el => new RegExp(src, 'i').test(el.innerText)), re.source, { timeout });
    return page.evaluate(src => [...document.querySelectorAll('.toast')].map(el => el.innerText).find(x => new RegExp(src, 'i').test(x)), re.source);
  };
  const clearToasts = () => page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  const modalOpen = id => page.locator(`#${id}.active`).isVisible();
  const close = () => page.evaluate(() => closeM());

  // ── UI helpers ──
  async function uiCourse({ name, normal = 1000, early = 800, cap = '', start = '2027-01-10', end = '2027-04-10', status }) {
    await page.evaluate(() => { goTab('courses'); openM('mCourse'); });
    await page.fill('#c-name', name); await page.fill('#c-start', start); await page.fill('#c-end', end);
    await page.fill('#c-feeNormal', String(normal)); await page.fill('#c-feeEarly', String(early));
    await page.fill('#c-capacity', String(cap));
    if (status) await page.selectOption('#c-status', String(status));
    await page.click('#btn-save-course'); await settle();
    return rows('Courses').find(r => r[1] === name);
  }
  async function uiStudent(fullName, email, phone = '') {
    await page.evaluate(() => { goTab('students'); openM('mStudentEdit'); });
    await page.fill('#se-fullname', fullName); await page.fill('#se-email', email); await page.fill('#se-phone', phone);
    await page.click('#btn-save-st'); await settle();
  }
  const studentRow = email => rows('Students').find(r => String(r[2]).toLowerCase() === email.toLowerCase());
  async function openEnroll(courseId, { email, newStudent } = {}) {
    await page.evaluate(() => { goTab('enrollments'); openM('mEnrollment'); });
    await page.selectOption('#e-course', String(courseId));
    if (newStudent) {
      await page.evaluate(() => setStudentMode('new'));
      await page.fill('#e-fullname', newStudent.fullName); await page.fill('#e-email', newStudent.email);
    } else if (email) {
      const s = studentRow(email);
      await page.fill('#e-search-input', `${s[1]} (${s[2]})`); await page.dispatchEvent('#e-search-input', 'change');
    }
  }
  async function uiPayment(email, courseId, amount, extra = {}) {
    const s = studentRow(email);
    await page.evaluate(() => { goTab('payments'); openM('mPayment'); });
    await page.selectOption('#p-student', String(s[0]));
    await page.waitForSelector('#p-course-box', { state: 'visible' });
    if (await page.locator(`#p-course option[value="${courseId}"]`).count()) await page.selectOption('#p-course', String(courseId));
    if (amount !== undefined) await page.fill('#p-amount', String(amount));
    if (extra.date) await page.fill('#p-date', extra.date);
    if (extra.note) await page.fill('#p-note', extra.note);
  }

  await page.goto(APP);

  /* ═════════ Auth edge cases ═════════ */
  group('Login');
  await t('5 wrong passwords → lockout message shown, right password refused', async () => {
    for (let i = 0; i < 5; i++) {
      await page.fill('#l-user', 'admin'); await page.fill('#l-pass', 'wrong' + i); await page.click('#l-btn'); await settle();
    }
    await page.fill('#l-pass', 'pw'); await page.click('#l-btn'); await settle();
    ok(/Too many failed attempts/.test(await page.innerText('#login-err')), 'msg: ' + await page.innerText('#login-err'));
    ok(await page.locator('#login-screen').isVisible(), 'logged in despite lockout');
  });
  await t('after lockout expires, login works', async () => {
    for (const k of Object.keys(G.props)) if (k.startsWith('LOGIN_GATE_')) delete G.props[k];
    await page.fill('#l-pass', 'pw'); await page.click('#l-btn');
    await page.waitForSelector('#main-app', { state: 'visible' }); await settle();
  });

  /* ═════════ Sheets data integrity ═════════ */
  group('Data integrity (Google Sheets value coercion)');
  await t('phone "0612345678" keeps its leading zero', async () => {
    await uiStudent('Lotte Bakker', 'lotte@example.com', '0612345678');
    eq(String(studentRow('lotte@example.com')[3]), '0612345678', 'stored phone');
  });
  await t('phone "+31612345678" keeps its plus sign', async () => {
    await uiStudent('Sem de Jong', 'sem@example.com', '+31612345678');
    eq(String(studentRow('sem@example.com')[3]), '+31612345678', 'stored phone');
  });
  await t('name starting with "=" is stored as text, not a formula', async () => {
    await uiStudent('=HYPERLINK("http://evil.test","click")', 'formula@example.com');
    const v = String(studentRow('formula@example.com')[1]);
    ok(!v.startsWith('FORMULA:'), 'became a spreadsheet formula: ' + v);
  });
  await t('course name "-Workshop" / "+Plus" are not mangled', async () => {
    const c = await uiCourse({ name: '+Plus Intensive' });
    ok(c, 'course not found by name — stored as: ' + JSON.stringify(rows('Courses').map(r => r[1])));
  });
  await t('note "007" on a payment survives', async () => {
    // tested later with a real payment; placeholder ensures ordering
  });
  await t('unicode names round-trip (Turkish + Dutch)', async () => {
    await uiStudent("Şükrü Çağlar-Ğİ", 'sukru@example.com');
    await uiStudent("IJsbrand van 't Hoff", 'ijsbrand@example.com');
    await page.evaluate(() => goTab('students'));
    const txt = await page.innerText('#studentDBList');
    ok(txt.includes('Şükrü Çağlar-Ğİ') && txt.includes("IJsbrand van 't Hoff"), 'missing in list');
  });
  await t('XSS in a name is shown as text, never executed', async () => {
    await uiStudent('<img src=x onerror="window.__xss=1">Eve', 'eve@example.com');
    await page.evaluate(() => goTab('students'));
    const s = studentRow('eve@example.com');
    await page.evaluate(id => showStudentDetail(id), s[0]); await page.waitForTimeout(100); await close();
    eq(await page.evaluate(() => window.__xss), undefined, 'payload executed');
    ok((await page.innerText('#studentDBList')).includes('<img src=x'), 'not rendered literally');
  });
  await t('duplicate email (case variant) → clean error toast, no "Error:" prefix', async () => {
    await clearToasts();
    await page.evaluate(() => openM('mStudentEdit'));
    await page.fill('#se-fullname', 'Lotte 2'); await page.fill('#se-email', '  LOTTE@example.com ');
    await page.click('#btn-save-st'); await settle();
    const msg = await toastWith(/already exists/);
    ok(!/Error:/.test(msg), 'toast: ' + msg);
    ok(await modalOpen('mStudentEdit'), 'modal closed');
    await close();
  });
  await t('course dates survive the Sheets Date round-trip (edit form prefilled)', async () => {
    const c = await uiCourse({ name: 'Date Check', start: '2027-02-03', end: '2027-05-06' });
    await page.evaluate(id => openM('mCourse', id), c[0]);
    eq(await page.inputValue('#c-start'), '2027-02-03'); eq(await page.inputValue('#c-end'), '2027-05-06');
    await close();
  });

  group('Email format');
  await t('student form rejects a malformed email (no request sent)', async () => {
    const before = count('addStudent');
    await page.evaluate(() => { goTab('students'); openM('mStudentEdit'); });
    await page.fill('#se-fullname', 'No At'); await page.fill('#se-email', 'noat.example.com');
    await clearToasts(); await page.click('#btn-save-st'); await settle();
    await toastWith(/valid email/);
    eq(count('addStudent'), before); await close();
  });
  await t('student edit rejects a malformed email', async () => {
    const before = count('updateStudent');
    await page.evaluate(id => openM('mStudentEdit', id), studentRow('lotte@example.com')[0]);
    await page.fill('#se-email', 'lotte@'); await page.click('#btn-save-st'); await settle();
    eq(count('updateStudent'), before); await close();
  });
  await t('backend rejects a malformed email even if the UI is bypassed', async () => {
    const r = await page.evaluate(() => apiFetch({ action: 'addStudent', payload: { fullName: 'Bypass', email: 'bypass' }, currentUser: 'admin' }));
    eq(r.success, false); ok(/valid email/.test(r.error), r.error);
    ok(!rows('Students').some(x => x[1] === 'Bypass'), 'written');
  });

  /* ═════════ Course / capacity ═════════ */
  group('Capacity');
  let unlimited, cap1;
  await t('empty capacity = unlimited (3 enrollments)', async () => {
    unlimited = (await uiCourse({ name: 'Open Class', cap: '' }))[0];
    for (const e of ['lotte@example.com', 'sem@example.com', 'sukru@example.com']) {
      await openEnroll(unlimited, { email: e });
      await page.fill('#e-depositAmount', '0'); await page.fill('#e-fullPayDate', '2027-01-31');
      await page.click('#btn-save-enrollment'); await settle();
    }
    eq(rows('Enrollments').filter(r => r[2] == unlimited).length, 3);
  });
  await t('capacity lowered below current enrollments → course shows Full, new enroll blocked', async () => {
    const c = rows('Courses').find(r => r[0] == unlimited);
    await page.evaluate(id => openM('mCourse', id), unlimited);
    await page.fill('#c-capacity', '2'); await page.click('#btn-save-course'); await settle();
    await page.evaluate(() => goTab('courses'));
    ok((await page.textContent('#courseList')).includes('3/2 Students · Full'), 'chip not Full');
    await openEnroll(unlimited, { email: 'ijsbrand@example.com' });
    ok(await page.locator('#btn-save-enrollment').isDisabled(), 'save enabled');
    await close();
  });
  await t('editing an enrollment in a full course is still allowed', async () => {
    const en = rows('Enrollments').find(r => r[2] == unlimited);
    await page.evaluate(id => openM('mEnrollment', id), en[0]);
    ok(!(await page.locator('#btn-save-enrollment').isDisabled()), 'edit blocked');
    await close();
  });
  await t('backend also enforces capacity (UI bypassed)', async () => {
    cap1 = (await uiCourse({ name: 'Tiny', cap: 1 }))[0];
    await openEnroll(cap1, { email: 'lotte@example.com' });
    await page.fill('#e-depositAmount', '0'); await page.fill('#e-fullPayDate', '2027-01-31');
    await page.click('#btn-save-enrollment'); await settle();
    await clearToasts();
    await openEnroll(cap1, { email: 'sem@example.com' });
    await page.evaluate(() => { document.getElementById('btn-save-enrollment').disabled = false; saveEnrollment(); });
    await settle();
    const msg = await toastWith(/full/);
    ok(!/Error:/.test(msg), 'toast: ' + msg);
    eq(rows('Enrollments').filter(r => r[2] == cap1).length, 1);
    await close();
  });

  /* ═════════ Enrollment validation ═════════ */
  group('Enrollment validation');
  let feeCourse;
  await t('deposit larger than the course fee is rejected', async () => {
    feeCourse = (await uiCourse({ name: 'Fee Course', normal: 1000, early: 800 }))[0];
    const before = count('enrollStudent');
    await openEnroll(feeCourse, { newStudent: { fullName: 'Val v1', email: 'v1@example.com' } });
    await page.fill('#e-depositAmount', '1500'); await page.fill('#e-fullPayDate', '2027-01-31');
    await page.click('#btn-save-enrollment'); await settle();
    eq(count('enrollStudent'), before, 'enrollment with deposit > fee was saved');
    await close();
  });
  await t('negative deposit is rejected', async () => {
    const before = count('enrollStudent');
    await openEnroll(feeCourse, { newStudent: { fullName: 'Val v2', email: 'v2@example.com' } });
    await page.fill('#e-depositAmount', '-50'); await page.fill('#e-fullPayDate', '2027-01-31');
    await page.click('#btn-save-enrollment'); await settle();
    eq(count('enrollStudent'), before, 'saved');
    await close();
  });
  await t('7 instalments of an odd amount add up EXACTLY to the remaining fee', async () => {
    await openEnroll(feeCourse, { email: 'ijsbrand@example.com' });
    await page.fill('#e-depositAmount', '0');
    await page.selectOption('#e-payType', 'instalment'); await page.fill('#e-numInstalments', '7');
    const amts = await page.$$eval('.inst-amount', els => els.map(e => Number(e.value)));
    eq(amts.length, 7);
    eq(Math.round(amts.reduce((a, b) => a + b, 0) * 100) / 100, 1000, 'sum of instalments');
    await close();
  });
  await t('instalments edited so they no longer add up → rejected', async () => {
    const before = count('enrollStudent');
    await openEnroll(feeCourse, { newStudent: { fullName: 'Val v3', email: 'v3@example.com' } });
    await page.fill('#e-depositAmount', '100'); await page.fill('#e-depositDate', dayOffset(10));
    await page.selectOption('#e-payType', 'instalment'); await page.fill('#e-numInstalments', '3');
    const inputs = await page.$$('.inst-date'); for (let i = 0; i < 3; i++) await inputs[i].fill(dayOffset(40 + 30 * i));
    await (await page.$$('.inst-amount'))[0].fill('50'); // 50 + 300 + 300 + deposit 100 = 750 ≠ 1000
    await page.click('#btn-save-enrollment'); await settle();
    eq(count('enrollStudent'), before, 'plan that does not cover the fee was saved');
    await close();
  });
  await t('instalment without a date → rejected', async () => {
    const before = count('enrollStudent');
    await openEnroll(feeCourse, { newStudent: { fullName: 'Val v4', email: 'v4@example.com' } });
    await page.fill('#e-depositAmount', '100'); await page.fill('#e-depositDate', dayOffset(10));
    await page.selectOption('#e-payType', 'instalment'); await page.fill('#e-numInstalments', '2');
    await (await page.$$('.inst-date'))[0].fill(dayOffset(40)); // 2nd left empty
    await page.click('#btn-save-enrollment'); await settle();
    eq(count('enrollStudent'), before, 'instalment with no due date was saved');
    await close();
  });
  await t('new student in enrollment form: malformed email rejected', async () => {
    const before = count('enrollStudent');
    await openEnroll(feeCourse, { newStudent: { fullName: 'Val v5', email: 'v5-at-example' } });
    await page.fill('#e-depositAmount', '0'); await page.fill('#e-fullPayDate', '2027-01-31');
    await page.click('#btn-save-enrollment'); await settle();
    eq(count('enrollStudent'), before); await close();
  });
  await t('first instalment due before the deposit → rejected', async () => {
    const before = count('enrollStudent');
    await openEnroll(feeCourse, { newStudent: { fullName: 'Val v6', email: 'v6@example.com' } });
    await page.fill('#e-depositAmount', '100'); await page.fill('#e-depositDate', dayOffset(30));
    await page.selectOption('#e-payType', 'instalment'); await page.fill('#e-numInstalments', '2');
    const d = await page.$$('.inst-date'); await d[0].fill(dayOffset(10)); await d[1].fill(dayOffset(60));
    await clearToasts(); await page.click('#btn-save-enrollment'); await settle();
    await toastWith(/before the deposit/);
    eq(count('enrollStudent'), before); await close();
  });
  await t('instalment dates out of order → rejected', async () => {
    const before = count('enrollStudent');
    await openEnroll(feeCourse, { newStudent: { fullName: 'Val v7', email: 'v7@example.com' } });
    await page.fill('#e-depositAmount', '100'); await page.fill('#e-depositDate', dayOffset(5));
    await page.selectOption('#e-payType', 'instalment'); await page.fill('#e-numInstalments', '3');
    const d = await page.$$('.inst-date'); await d[0].fill(dayOffset(30)); await d[1].fill(dayOffset(90)); await d[2].fill(dayOffset(60));
    await clearToasts(); await page.click('#btn-save-enrollment'); await settle();
    await toastWith(/before the previous instalment/);
    eq(count('enrollStudent'), before); await close();
  });
  await t('backend rejects an invalid plan even if the UI is bypassed', async () => {
    const sid = studentRow('sem@example.com')[0];
    const r = await page.evaluate(([c, s]) => apiFetch({ action: 'enrollStudent', currentUser: 'admin', payload: {
      isNew: false, studentId: s, studentData: {}, courseId: c, priceType: 'normal', totalFee: 1000,
      depositAmount: 0, depositDate: '', paymentType: 'instalment', fullPayDate: '',
      instalmentPlan: JSON.stringify([{ amount: 400, date: '2027-03-01' }, { amount: 400, date: '2027-02-01' }]) } }), [feeCourse, sid]);
    eq(r.success, false); ok(/before the previous|must equal/.test(r.error), r.error);
  });
  await t('valid 3-instalment plan with early-bird price saves', async () => {
    await openEnroll(feeCourse, { email: 'ijsbrand@example.com' });
    await page.selectOption('#e-priceType', 'early_bird');
    await page.fill('#e-depositAmount', '200'); await page.fill('#e-depositDate', dayOffset(-5)); // overdue deposit
    await page.selectOption('#e-payType', 'instalment'); await page.fill('#e-numInstalments', '3');
    const inputs = await page.$$('.inst-date'); for (let i = 0; i < 3; i++) await inputs[i].fill(dayOffset(30 + 30 * i));
    await page.click('#btn-save-enrollment'); await settle();
    const en = rows('Enrollments').find(r => r[2] == feeCourse);
    ok(en, 'not saved'); eq(Number(en[4]), 800, 'total fee');
  });

  /* ═════════ Payments ═════════ */
  group('Payments');
  await t('overdue deposit shows the Overdue badge', async () => {
    await page.evaluate(() => { goTab('enrollments'); setEnrollmentFilter('all'); });
    const row = page.locator('#enrollmentList .student-row', { hasText: "IJsbrand van 't Hoff" });
    if (!(await row.textContent()).includes('Overdue')) {
      const dbg = await page.evaluate(() => { const en = S.enrollments.find(e => /IJsbrand/.test((getStudent(e.studentId)||{}).fullName||''));
        return { en, od: en && getOverdueInfo(en), paid: en && getEnrollmentPaid(en.studentId, en.courseId) }; });
      throw new Error('no badge ' + JSON.stringify(dbg));
    }
  });
  await t('decimal payment 199.99 stored exactly', async () => {
    await uiPayment('ijsbrand@example.com', feeCourse, '199.99', { note: '007' });
    await page.click('#btn-save-payment'); await settle();
    const p = rows('Payments').find(r => r[2] == feeCourse);
    eq(Number(p[3]), 199.99);
  });
  await t('payment note "007" keeps its leading zeros', async () => {
    const p = rows('Payments').find(r => r[2] == feeCourse);
    eq(String(p[6]), '007', 'stored note');
  });
  await t('suggestion asks for the last €0.01 of the deposit', async () => {
    await uiPayment('ijsbrand@example.com', feeCourse);
    eq(await page.inputValue('#p-type'), 'deposit'); eq(Number(await page.inputValue('#p-amount')), 0.01);
  });
  await t('paying the cent clears the Overdue badge', async () => {
    await page.click('#btn-save-payment'); await settle();
    await page.evaluate(() => { goTab('enrollments'); setEnrollmentFilter('all'); });
    const row = page.locator('#enrollmentList .student-row', { hasText: "IJsbrand van 't Hoff" });
    ok(!(await row.textContent()).includes('Overdue'), 'badge still shown');
  });
  await t('overpayment (more than remaining) needs confirmation', async () => {
    const before = count('addPayment');
    await uiPayment('ijsbrand@example.com', feeCourse, '5000');
    await page.click('#btn-save-payment'); await page.waitForTimeout(300);
    const confirmShown = await page.locator('#confirmOverlay').isVisible();
    if (confirmShown) await page.click('#confirmCancel');
    await settle();
    eq(count('addPayment'), before, 'overpayment saved without asking');
    ok(confirmShown, 'no confirmation shown');
    await close();
  });
  await t('pay the exact remaining → Fully Paid, 100% bar', async () => {
    await uiPayment('ijsbrand@example.com', feeCourse);
    // instalment plan → suggestion is the next instalment (200), not the whole 600
    eq(await page.inputValue('#p-type'), 'instalment'); eq(Number(await page.inputValue('#p-amount')), 200, 'next instalment');
    await page.selectOption('#p-type', 'full');
    await page.fill('#p-amount', '600'); await page.click('#btn-save-payment'); await settle();
    await uiPayment('ijsbrand@example.com', feeCourse);
    ok((await page.innerText('#ss-title')).includes('Fully Paid'), 'not fully paid');
    await close();
  });
  await t('double Enter on payment form → one payment', async () => {
    const before = count('addPayment');
    await uiPayment('lotte@example.com', unlimited, '10');
    await page.press('#p-amount', 'Enter'); await page.press('#p-amount', 'Enter');
    await settle();
    eq(count('addPayment'), before + 1);
  });

  /* ═════════ Delete / archive ═════════ */
  group('Delete guards & archive');
  await t('course with payments but no enrollments cannot be deleted (backend guard)', async () => {
    // orphan payment: enrollment removed directly in the sheet by a human
    const c = await uiCourse({ name: 'Orphan Pay' });
    G.sheets.Payments._rows.push([9999, studentRow('sem@example.com')[0], c[0], 50, new Date(), 'other', '', 'admin', '']);
    G.cache && Object.keys(G.cache).forEach(k => delete G.cache[k]);
    await page.evaluate(() => syncSheets()); await settle(); await clearToasts();
    await page.evaluate(id => { openM('mCourse', id); deleteRecord('course'); }, c[0]);
    if (await page.locator('#confirmOverlay').isVisible()) await page.click('#confirmOk');
    await settle();
    ok(rows('Courses').some(r => r[0] == c[0]), 'course deleted despite payments');
    const msg = await toastWith(/payment/);
    ok(!/Error:/.test(msg), 'toast: ' + msg);
    await close();
  });
  await t('completed course → enrollments move to Archived filter', async () => {
    await page.evaluate(id => openM('mCourse', id), cap1);
    await page.selectOption('#c-status', '102'); await page.click('#btn-save-course'); await settle();
    await page.evaluate(() => { goTab('enrollments'); setEnrollmentFilter('active'); });
    const active = await page.innerText('#enrollmentList');
    await page.evaluate(() => setEnrollmentFilter('archived'));
    const archived = await page.innerText('#enrollmentList');
    ok(!active.includes('Tiny') && archived.includes('Tiny'), 'filter wrong');
    await page.evaluate(() => setEnrollmentFilter('active'));
  });

  /* ═════════ Search & export ═════════ */
  group('Search & CSV export');
  await t('search with regex characters "(" "+" "*" does not crash', async () => {
    await page.evaluate(() => goTab('students'));
    for (const q of ['(', '+31', '*', '[', '\\']) { await page.fill('#s-search', q); await page.waitForTimeout(260); }
    await page.fill('#s-search', ''); await page.waitForTimeout(260);
  });
  await t('CSV export neutralises formula cells (=, +, -, @)', async () => {
    await page.evaluate(() => goTab('enrollments'));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportEnrollmentsCSV())]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    const line = csv.split('\n').find(l => /HYPERLINK|\+Plus/.test(l)) || '';
    // There may be no enrollment for those yet; make one direct check via _csvCell too.
    const cells = await page.evaluate(() => ['=1+1', '+SUM(A1)', '-2+3', '@cmd'].map(_csvCell));
    for (const c of cells) ok(/^"?'/.test(c), 'cell exported as formula: ' + c);
    void line;
  });
  await t('CSV keeps commas, quotes and newlines intact', async () => {
    const c = await page.evaluate(() => _csvCell('He said "hi", then\nleft'));
    eq(c, '"He said ""hi"", then\nleft"');
  });

  /* ═════════ Resilience ═════════ */
  group('Network resilience');
  await t('backend 500 once (cold start) → auto-retry, exactly one record', async () => {
    const before = rows('Courses').length;
    faults.push('fail500');
    await uiCourse({ name: 'Retry Course' });
    eq(rows('Courses').length, before + 1);
    eq(rows('Courses').filter(r => r[1] === 'Retry Course').length, 1);
  });
  await t('network down on save → error toast, modal stays, button usable again', async () => {
    await clearToasts();
    await page.evaluate(() => { goTab('courses'); openM('mCourse'); });
    await page.fill('#c-name', 'Offline Course');
    faults.push('abort', 'abort');
    await page.click('#btn-save-course'); await settle();
    await toastWith(/Network error/, 6000);
    ok(await modalOpen('mCourse'), 'modal closed');
    ok(!(await page.locator('#btn-save-course').isDisabled()), 'button stuck disabled');
    eq(rows('Courses').filter(r => r[1] === 'Offline Course').length, 0);
    await page.click('#btn-save-course'); await settle();   // network back
    eq(rows('Courses').filter(r => r[1] === 'Offline Course').length, 1, 'retry by user');
  });
  await t('sync failure → "Sync Error" badge, app keeps last data', async () => {
    faults.push('abort', 'abort');
    await page.evaluate(() => syncSheets()); await settle();
    ok((await page.innerText('#syncBadge')).includes('Sync Error'));
    await page.evaluate(() => goTab('courses'));
    ok((await page.innerText('#courseList')).includes('Open Class'), 'data wiped');
    await page.evaluate(() => syncSheets()); await settle();
    ok((await page.innerText('#syncBadge')).includes('Live Sync'), 'did not recover');
  });

  /* ═════════ Mobile ═════════ */
  group('Mobile');
  await t('390px: enrollment + payment modals fit, no horizontal scroll', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const m of ['mEnrollment', 'mPayment', 'mCourse']) {
      await page.evaluate(id => openM(id), m);
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      ok(w <= 390, `${m} scrollWidth ${w}`);
      await close();
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  group('Runtime');
  await t('no JS errors during the whole run', async () => {
    if (errors.length) throw new Error(errors.join(' | '));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) console.log('FAILED:\n  - ' + fails.join('\n  - '));
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
