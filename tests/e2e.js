/**
 * MEISNER STUDIO — tests/e2e.js
 * End-to-end test: the real app (index.html) runs in headless Chromium while
 * the Google Apps Script backend is replaced by an in-memory fake. Every flow
 * is driven through the UI like a real user: login, create course / student /
 * enrollment / payment, validation, duplicate + capacity guards, delete
 * guards, session expiry, mobile layout, and "no JS errors".
 *
 * Nothing touches the live spreadsheet — all requests to script.google.com
 * are intercepted.
 *
 * Setup (once):  npm install && npx playwright install chromium
 * Run:           npm run test:e2e
 */
const { chromium } = require('playwright');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const APP  = 'file://' + path.join(ROOT, 'index.html');
const OUT  = os.tmpdir(); // screenshots land here, not in the repo
const APP_VERSION = (fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8')
  .match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];

/* ── Fake Apps Script backend ── */
const db = {
  courses: [], students: [], enrollments: [], payments: [],
  generalStatus: [
    { id: 101, name: 'Active', code: 'active', entity: 'course' },
    { id: 102, name: 'Completed', code: 'completed', entity: 'course' },
    { id: 103, name: 'Draft', code: 'draft', entity: 'course' },
    { id: 104, name: 'Cancelled', code: 'cancelled', entity: 'course' },
  ],
};
let seq = 1000;
const calls = [];
const TOKEN = 'tok-123';
function handle(body) {
  const { action, payload = {}, token } = body;
  calls.push(action);
  if (action === 'checkLogin')
    return payload.username === 'admin' && payload.password === 'pw' ? { success: true, token: TOKEN } : { success: false };
  if (action === 'verifyToken') return { success: payload.token === TOKEN };
  if (token !== TOKEN) return { success: false, error: 'Unauthorized' };
  const id = () => String(++seq);
  switch (action) {
    case 'getAll': return { success: true, ...JSON.parse(JSON.stringify(db)) };
    case 'addCourse': db.courses.push({ ...payload, id: id() }); return { success: true };
    case 'updateCourse': Object.assign(db.courses.find(c => c.id == payload.id), payload); return { success: true };
    case 'deleteCourse': db.courses = db.courses.filter(c => c.id != payload.id); return { success: true };
    case 'addStudent':
      if (db.students.some(s => s.email.toLowerCase() === payload.email.toLowerCase()))
        return { success: false, error: 'A student with this email already exists.' };
      db.students.push({ ...payload, id: id() }); return { success: true };
    case 'updateStudent': Object.assign(db.students.find(s => s.id == payload.id), payload); return { success: true };
    case 'deleteStudent': db.students = db.students.filter(s => s.id != payload.id); return { success: true };
    case 'enrollStudent': {
      let sid = payload.studentId;
      if (payload.isNew) { sid = id(); db.students.push({ ...payload.studentData, id: sid }); }
      const { studentData, isNew, enrollmentId, ...rest } = payload;
      db.enrollments.push({ ...rest, studentId: sid, id: id() }); return { success: true };
    }
    case 'updateEnrollment': {
      const { enrollmentId, studentData, isNew, studentId, courseId, ...rest } = payload;
      Object.assign(db.enrollments.find(e => e.id == enrollmentId), rest); return { success: true };
    }
    case 'deleteEnrollment': db.enrollments = db.enrollments.filter(e => e.id != payload.id); return { success: true };
    case 'addPayment': db.payments.push({ ...payload, id: id() }); return { success: true };
    case 'deletePayment': db.payments = db.payments.filter(p => p.id != payload.id); return { success: true };
  }
  return { success: false, error: 'Unknown action ' + action };
}

/* ── tiny test runner ── */
let passed = 0, failed = 0; const fails = [];
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; fails.push(name); console.log('  ✗ ' + name + '\n      ' + e.message.split('\n')[0]); }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, m) => { if (!v) throw new Error(m || 'assertion failed'); };
const count = a => calls.filter(c => c === a).length;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ timezoneId: 'Europe/Amsterdam', locale: 'en-US' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => { errors.push('native dialog: ' + d.message()); d.dismiss(); });

  let pending = 0;
  page.setDefaultTimeout(5000);
  await page.route(/script\.google\.com/, async route => {
    const req = route.request();
    pending++; try {
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
    await new Promise(r => setTimeout(r, 120)); // network latency, exposes double-submit races
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(handle(JSON.parse(req.postData()))) });
    } finally { pending--; }
  });
  await page.route(/jsdelivr|googleapis|gstatic/, r => r.abort());

  // wait until the network has been idle for 250ms (save + follow-up sync both done)
  const settle = async () => {
    await page.waitForTimeout(50);
    for (let idle = 0, i = 0; idle < 5 && i < 200; i++) { await page.waitForTimeout(50); idle = pending === 0 ? idle + 1 : 0; }
  };
  const modalOpen = id => page.locator(`#${id}.active`).isVisible();
  const lastToast = () => page.locator('.toast').last().innerText().catch(() => '');

  await page.goto(APP);

  console.log('\nAuth');
  await t('wrong password rejected', async () => {
    await page.fill('#l-user', 'admin'); await page.fill('#l-pass', 'nope'); await page.click('#l-btn');
    await page.waitForSelector('#login-err', { state: 'visible' });
  });
  await t('login succeeds, main app shown, initial sync', async () => {
    await page.fill('#l-pass', 'pw'); await page.click('#l-btn');
    await page.waitForSelector('#main-app', { state: 'visible' }); await settle();
    ok(count('getAll') >= 1, 'no getAll');
  });
  await t('version label matches config.js', async () => {
    eq(await page.evaluate(() => window.APP_VERSION), APP_VERSION);
  });

  console.log('\nCourse creation');
  async function newCourse(name, normal, early, cap, start = '2026-12-01', end = '2027-03-01') {
    await page.evaluate(() => goTab('courses'));
    await page.evaluate(() => openM('mCourse'));
    await page.fill('#c-name', name); await page.fill('#c-start', start); await page.fill('#c-end', end);
    await page.fill('#c-feeNormal', String(normal)); await page.fill('#c-feeEarly', String(early));
    await page.fill('#c-capacity', String(cap));
    await page.click('#btn-save-course'); await settle();
  }
  await t('empty name blocked client-side (no request)', async () => {
    const before = count('addCourse');
    await page.evaluate(() => openM('mCourse')); await page.click('#btn-save-course');
    eq(count('addCourse'), before); await page.evaluate(() => closeM());
  });
  await t('end before start blocked', async () => {
    const before = count('addCourse');
    await page.evaluate(() => openM('mCourse'));
    await page.fill('#c-name', 'Bad'); await page.fill('#c-start', '2027-01-10'); await page.fill('#c-end', '2027-01-01');
    await page.click('#btn-save-course'); eq(count('addCourse'), before);
    await page.evaluate(() => closeM());
  });
  await t('create "Meisner L1" (cap 2)', async () => {
    await newCourse('Meisner L1', 1500, 1200, 2);
    eq(db.courses.length, 1); eq(db.courses[0].status, '101', 'default status');
    ok((await page.locator('#courseList').innerText()).includes('Meisner L1'));
  });
  await t('double-click Save creates ONE course', async () => {
    await page.evaluate(() => { goTab('courses'); openM('mCourse'); });
    await page.fill('#c-name', 'Scene Study'); await page.fill('#c-feeNormal', '800'); await page.fill('#c-feeEarly', '650'); await page.fill('#c-capacity', '1');
    await page.evaluate(() => { const b = document.getElementById('btn-save-course'); b.click(); saveCourse(); });
    await settle(); await page.waitForTimeout(300);
    eq(db.courses.filter(c => c.name === 'Scene Study').length, 1);
  });
  await t('edit course name', async () => {
    const id = db.courses[0].id;
    await page.evaluate(id => openM('mCourse', id), id);
    eq(await page.inputValue('#c-name'), 'Meisner L1');
    await page.fill('#c-name', 'Meisner Level 1'); await page.click('#btn-save-course'); await settle();
    eq(db.courses[0].name, 'Meisner Level 1');
  });

  console.log('\nStudent creation');
  await t('create student via Students tab', async () => {
    await page.evaluate(() => { goTab('students'); openM('mStudentEdit'); });
    await page.fill('#se-fullname', 'Anna de Vries'); await page.fill('#se-email', 'anna@example.com'); await page.fill('#se-phone', '+31 6 1');
    await page.click('#btn-save-st'); await settle();
    eq(db.students.length, 1);
    ok((await page.locator('#studentDBList').innerText()).includes('Anna de Vries'));
  });
  await t('missing email blocked client-side', async () => {
    const before = count('addStudent');
    await page.evaluate(() => openM('mStudentEdit'));
    await page.fill('#se-fullname', 'No Mail'); await page.click('#btn-save-st');
    eq(count('addStudent'), before); await page.evaluate(() => closeM());
  });
  await t('duplicate email: backend error shown as toast, modal stays', async () => {
    await page.evaluate(() => openM('mStudentEdit'));
    await page.fill('#se-fullname', 'Anna 2'); await page.fill('#se-email', 'ANNA@example.com');
    await page.click('#btn-save-st');
    await page.locator('.toast', { hasText: 'already exists' }).first().waitFor({ timeout: 10000 });
    ok(await modalOpen('mStudentEdit'), 'modal closed');
    eq(db.students.length, 1); await page.evaluate(() => closeM());
  });
  await t('student search filters list', async () => {
    await page.fill('#s-search', 'zzz'); await page.waitForTimeout(350);
    ok((await page.locator('#studentDBList').innerText()).includes('No students'));
    await page.fill('#s-search', ''); await page.waitForTimeout(350);
  });

  console.log('\nEnrollment creation');
  const L1 = () => db.courses.find(c => c.name === 'Meisner Level 1');
  await t('enroll EXISTING student, full payment, early bird', async () => {
    await page.evaluate(() => { goTab('enrollments'); openM('mEnrollment'); });
    await page.selectOption('#e-course', L1().id);
    await page.selectOption('#e-priceType', 'early_bird');
    eq(await page.inputValue('#e-displayTotal'), '€1,200.00');
    await page.fill('#e-search-input', 'Anna de Vries (anna@example.com)');
    await page.dispatchEvent('#e-search-input', 'change');
    ok(await page.inputValue('#e-selected-student-id'), 'student not captured');
    await page.fill('#e-depositAmount', '300'); await page.fill('#e-depositDate', '2026-11-01');
    await page.fill('#e-fullPayDate', '2026-12-31');
    await page.click('#btn-save-enrollment'); await settle();
    eq(db.enrollments.length, 1); eq(Number(db.enrollments[0].totalFee), 1200); eq(db.enrollments[0].paymentType, 'full_remaining');
  });
  await t('duplicate enrollment blocked', async () => {
    const before = count('enrollStudent');
    await page.evaluate(() => openM('mEnrollment'));
    await page.selectOption('#e-course', L1().id);
    await page.fill('#e-search-input', 'Anna de Vries (anna@example.com)'); await page.dispatchEvent('#e-search-input', 'change');
    await page.click('#btn-save-enrollment'); await page.waitForTimeout(200);
    eq(count('enrollStudent'), before);
    ok((await lastToast()).includes('Already enrolled'));
    await page.evaluate(() => closeM());
  });
  await t('enroll NEW student with 3x instalment plan', async () => {
    await page.evaluate(() => openM('mEnrollment'));
    await page.selectOption('#e-course', L1().id);
    await page.evaluate(() => setStudentMode('new'));
    await page.fill('#e-fullname', 'Bram Jansen'); await page.fill('#e-email', 'bram@example.com');
    await page.fill('#e-depositAmount', '300'); await page.fill('#e-depositDate', '2026-12-01');
    await page.selectOption('#e-payType', 'instalment');
    await page.fill('#e-numInstalments', '3');
    const amts = await page.$$eval('.inst-amount', els => els.map(e => Number(e.value)));
    eq(amts.length, 3); eq(amts.reduce((a, b) => a + b, 0), 1200, 'instalments sum');
    const dates = ['2027-01-01', '2027-02-01', '2027-03-01'];
    const inputs = await page.$$('.inst-date'); for (let i = 0; i < 3; i++) await inputs[i].fill(dates[i]);
    await page.click('#btn-save-enrollment'); await settle();
    eq(db.students.length, 2, 'new student created');
    const en = db.enrollments.find(e => e.paymentType === 'instalment');
    ok(en, 'no instalment enrollment'); eq(JSON.parse(en.instalmentPlan).length, 3);
    eq(JSON.parse(en.instalmentPlan)[2].date, '2027-03-01');
  });
  await t('full course: warning + save disabled', async () => {
    await page.evaluate(() => openM('mEnrollment'));
    await page.selectOption('#e-course', L1().id);
    ok(await page.locator('#e-capacity-warn').isVisible(), 'no capacity warning');
    ok(await page.locator('#btn-save-enrollment').isDisabled(), 'save not disabled');
  });
  await t('full course: Enter key does NOT bypass disabled save (v3.2.1 fix)', async () => {
    await page.evaluate(() => setStudentMode('new'));
    await page.fill('#e-fullname', 'Overflow Person'); await page.fill('#e-email', 'over@example.com');
    const before = count('enrollStudent');
    await page.press('#e-email', 'Enter'); await page.waitForTimeout(400);
    eq(count('enrollStudent'), before, 'Enter enrolled into full course!');
    await page.evaluate(() => closeM());
  });

  console.log('\nPayment creation');
  const anna = () => db.students.find(s => s.email === 'anna@example.com');
  await t('payment modal suggests deposit €300', async () => {
    await page.evaluate(() => { goTab('payments'); openM('mPayment'); });
    await page.selectOption('#p-student', anna().id);
    await page.waitForSelector('#p-course-box', { state: 'visible' });
    // single enrollment → auto-selected
    eq(Number(await page.inputValue('#p-amount')), 300);
    eq(await page.inputValue('#p-type'), 'deposit');
  });
  await t('payment date defaults to local today', async () => {
    const expected = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; });
    eq(await page.inputValue('#p-date'), expected);
  });
  await t('save payment → recorded once', async () => {
    await page.click('#btn-save-payment'); await settle();
    eq(db.payments.length, 1); eq(Number(db.payments[0].amount), 300);
  });
  await t('next suggestion = remaining €900 (full)', async () => {
    await page.evaluate(() => openM('mPayment'));
    await page.selectOption('#p-student', anna().id); await page.waitForTimeout(100);
    eq(Number(await page.inputValue('#p-amount')), 900); eq(await page.inputValue('#p-type'), 'full');
    await page.evaluate(() => closeM());
  });
  await t('zero amount blocked', async () => {
    const before = count('addPayment');
    await page.evaluate(() => openM('mPayment'));
    await page.selectOption('#p-student', anna().id); await page.waitForTimeout(100);
    await page.fill('#p-amount', '0'); await page.click('#btn-save-payment');
    eq(count('addPayment'), before); await page.evaluate(() => closeM());
  });
  await t('instalment student: suggestion walks deposit → instalment 1', async () => {
    const bram = db.students.find(s => s.email === 'bram@example.com');
    db.payments.push({ id: 'px', studentId: bram.id, courseId: L1().id, amount: 300, date: '2026-12-01', type: 'deposit' });
    await page.evaluate(() => syncSheets()); await settle();
    await page.evaluate(() => openM('mPayment'));
    await page.selectOption('#p-student', bram.id); await page.waitForTimeout(100);
    eq(await page.inputValue('#p-type'), 'instalment'); eq(Number(await page.inputValue('#p-amount')), 400);
    await page.evaluate(() => closeM());
  });

  console.log('\nRendering');
  await t('stats: collected €600', async () => {
    await page.evaluate(() => goTab('dashboard'));
    eq(await page.innerText('#st-collected'), '€600.00');
  });
  await t('dashboard card: "paid / total" sits right above the bar', async () => {
    const r = await page.evaluate(() => {
      const card = document.querySelector('#dashContent .card');
      const bar = card.querySelector('.bar-bg');
      const above = bar.previousElementSibling;
      return { text: above.innerText, gap: bar.getBoundingClientRect().top - above.getBoundingClientRect().bottom };
    });
    ok(/€600\.00 \/ €2,700\.00/.test(r.text), 'text: ' + r.text);
    ok(r.gap >= 0 && r.gap <= 8, 'gap ' + r.gap);
  });
  await t('enrollment row: amount colored (amber at 25%)', async () => {
    await page.evaluate(() => goTab('enrollments'));
    const c = await page.$eval('#enrollmentList .pay-amount', el => getComputedStyle(el).color);
    ok(c === 'rgb(239, 68, 68)' || c === 'rgb(245, 158, 11)', 'color ' + c);
  });
  await t('student detail opens with bar amount', async () => {
    await page.evaluate(id => showStudentDetail(id), anna().id);
    ok((await page.innerText('#sd-body')).includes('€300.00 / €1,200.00'));
    await page.evaluate(() => closeM());
  });
  await t('course detail opens', async () => {
    await page.evaluate(id => showCourseDetail(id), L1().id); await page.waitForTimeout(150);
    ok(await page.locator('.modal.active').isVisible(), 'no modal');
    await page.evaluate(() => closeM());
  });
  await t('enrollment detail opens', async () => {
    await page.evaluate(id => showEnrollmentDetail(id), db.enrollments[0].id);
    ok((await page.innerText('#ed-body')).includes('Payment History'));
    await page.evaluate(() => closeM());
  });
  await t('report: this-month range starts on the 1st (local)', async () => {
    const r = await page.evaluate(() => getReportRange());
    ok(r.from.endsWith('-01'), 'from ' + r.from);
  });

  console.log('\nDelete guards');
  await t('cannot delete enrollment with payments', async () => {
    const before = count('deleteEnrollment');
    await page.evaluate(id => deleteEnrollmentFromDetail(id), db.enrollments[0].id);
    await page.waitForTimeout(150); eq(count('deleteEnrollment'), before);
  });
  await t('cannot delete course with enrollments', async () => {
    const before = count('deleteCourse');
    await page.evaluate(id => { openM('mCourse', id); deleteRecord('course'); }, L1().id);
    await page.waitForTimeout(150); eq(count('deleteCourse'), before); await page.evaluate(() => closeM());
  });
  await t('delete payment via confirm dialog', async () => {
    const pid = db.payments[0].id;
    await page.evaluate(id => { confirmDeletePayment(id); }, pid);
    await page.click('#confirmOk'); await settle();
    ok(!db.payments.find(p => p.id === pid));
  });
  await t('delete empty course "Scene Study"', async () => {
    const id = db.courses.find(c => c.name === 'Scene Study').id;
    await page.evaluate(id => { openM('mCourse', id); deleteRecord('course'); }, id);
    await page.click('#confirmOk'); await settle();
    ok(!db.courses.find(c => c.id === id));
  });

  console.log('\nSession');
  await t('expired token → forced back to login', async () => {
    await page.evaluate(() => { localStorage.setItem('sessionToken', 'bad'); sessionStorage.setItem('sessionToken', 'bad'); });
    await page.evaluate(() => syncSheets()); await page.waitForTimeout(400);
    ok(await page.locator('#login-screen').isVisible(), 'not logged out');
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.fill('#l-user', 'admin'); await page.fill('#l-pass', 'pw'); await page.click('#l-btn');
  await page.waitForSelector('#main-app', { state: 'visible' }); await settle();
  await page.screenshot({ path: path.join(OUT, 'meisner-e2e-mobile.png'), fullPage: true });
  await t('mobile: no horizontal overflow', async () => {
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(w <= 390, 'scrollWidth ' + w);
  });

  console.log('\nConsole / runtime errors');
  await t('no JS errors during the whole run', async () => {
    const real = errors.filter(e => !/ERR_FAILED|net::|Failed to load resource/.test(e));
    if (real.length) throw new Error(real.join(' | '));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) console.log('FAILED: ' + fails.join('; '));
  console.log('API calls:', JSON.stringify(calls.reduce((m, a) => (m[a] = (m[a] || 0) + 1, m), {})));
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
