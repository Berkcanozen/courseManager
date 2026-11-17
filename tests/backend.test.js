/**
 * MEISNER STUDIO — tests/backend.test.js
 * Runs the real Apps Script backend (*.gs) under Node with in-memory mocks of
 * SpreadsheetApp, LockService, PropertiesService, CacheService, ContentService,
 * Utilities, Session and MailApp. Requests go through doPost() exactly like the
 * live Web App, so routing, auth, validation and sheet writes are all covered.
 *
 * Plain Node + assert — no install needed. Run:  node tests/backend.test.js
 */
process.env.TZ = 'Europe/Amsterdam';
const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');

const ROOT     = path.resolve(__dirname, '..');
const GS_FILES = ['config.gs', 'utils.gs', 'Auth.gs', 'Courses.gs', 'Students.gs',
                  'Enrollments.gs', 'Payments.gs', 'Cron.gs', 'router.gs'];

/* ───────────── Google service mocks ───────────── */
function makeSheet(name) {
  const rows = [];
  return {
    _rows: rows,
    getName: () => name,
    appendRow: r => { rows.push(r.slice()); },
    getLastRow: () => rows.length,
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
    getRange: (row, col, nr, nc) => ({
      getValues: () => rows.slice(row - 1, row - 1 + nr).map(r => r.slice(col - 1, col - 1 + nc)),
      setValues: vals => vals.forEach((v, i) => {
        const r = rows[row - 1 + i];
        v.forEach((cell, j) => { r[col - 1 + j] = cell; });
      }),
    }),
    deleteRow: n => { rows.splice(n - 1, 1); },
    setFrozenRows: () => {},
  };
}

function makeEnv() {
  const sheets = {};
  const props  = {};
  const cache  = {};
  const mails  = [];
  let lockDepth = 0, maxLockDepth = 0;
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = makeSheet(n)),
    getUrl: () => 'https://docs.google.com/spreadsheets/d/TEST',
  };
  const fmtParts = (d, tz) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map(p => [p.type, p.value]));
  const env = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => ({
      waitLock: () => { lockDepth++; maxLockDepth = Math.max(maxLockDepth, lockDepth); },
      releaseLock: () => { lockDepth--; },
    }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: k => { delete props[k]; },
      getProperties: () => ({ ...props }),
    }) },
    CacheService: { getScriptCache: () => ({
      get: k => (k in cache ? cache[k] : null),
      put: (k, v) => { cache[k] = v; },
      remove: k => { delete cache[k]; },
    }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: s => ({ _s: s, setMimeType() { return this; }, getContent() { return this._s; } }),
    },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        const p = fmtParts(d, tz);
        return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day)
                  .replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
      },
      base64Encode: s => Buffer.from(String(s)).toString('base64'),
      getUuid: () => require('crypto').randomUUID(),
    },
    Session: { getScriptTimeZone: () => 'Europe/Amsterdam' },
    MailApp: { sendEmail: m => mails.push(m) },
  };
  const ctx = vm.createContext(env);
  for (const f of GS_FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });

  // seed sheets the app expects to exist
  const admins = ss.insertSheet('Admins');
  admins.appendRow(['email', 'username', 'password']);
  admins.appendRow(['admin@studio.test', 'admin', 'pw']);
  const gs = ss.insertSheet('GeneralStatus');
  gs.appendRow(['id', 'name', 'code', 'entity']);
  gs.appendRow([101, 'Active', 'active', 'course']);

  const call = (action, payload = {}, token) =>
    JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action, payload, token, currentUser: 'admin' }) } }).getContent());
  return { ctx, ss, sheets, props, cache, mails, call, lock: () => ({ lockDepth, maxLockDepth }) };
}

/* ───────────── tiny runner ───────────── */
let passed = 0, failed = 0; const fails = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; fails.push(name); console.log('  ✗ ' + name + '\n      ' + e.message.split('\n')[0]); }
}
const group = n => console.log('\n' + n);
const rows  = (E, sheet) => (E.sheets[sheet] ? E.sheets[sheet]._rows.slice(1) : []);
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(new Date());

/* ───────────── scenario helpers ───────────── */
function loggedIn() {
  const E = makeEnv();
  const r = E.call('checkLogin', { username: 'admin', password: 'pw' });
  assert.ok(r.success && r.token, 'login failed');
  E.token = r.token;
  E.do = (action, payload) => E.call(action, payload, E.token);
  return E;
}
function seedCourse(E, extra = {}) {
  const r = E.do('addCourse', { name: 'Meisner L1', startDate: '2026-12-01', endDate: '2027-03-01',
    feeNormal: '1500', feeEarly: '1200', capacity: '2', status: '101', ...extra });
  assert.ok(r.success, r.error); return r.id;
}
function seedStudent(E, email = 'anna@example.com', fullName = 'Anna de Vries') {
  const r = E.do('addStudent', { fullName, email, phone: '' });
  assert.ok(r.success, r.error); return r.id;
}
const enrollPayload = (courseId, studentId, extra = {}) => ({
  enrollmentId: null, isNew: false, studentId, studentData: {}, courseId,
  priceType: 'normal', totalFee: '1500', depositAmount: '300', depositDate: '2026-12-01',
  paymentType: 'full_remaining', fullPayDate: '2027-01-15', instalmentPlan: '[]', ...extra,
});

/* ───────────── tests ───────────── */
group('Auth');
test('ping via GET', () => {
  const E = makeEnv();
  assert.strictEqual(JSON.parse(E.ctx.doGet({ parameter: { action: 'ping' } }).getContent()).success, true);
});
test('correct login returns a token', () => { loggedIn(); });
test('wrong password → success:false, no token', () => {
  const r = makeEnv().call('checkLogin', { username: 'admin', password: 'x' });
  assert.strictEqual(r.success, false); assert.ok(!r.token);
});
test('lockout after 5 failed attempts, even with the right password', () => {
  const E = makeEnv();
  for (let i = 0; i < 5; i++) E.call('checkLogin', { username: 'admin', password: 'x' });
  const r = E.call('checkLogin', { username: 'admin', password: 'pw' });
  assert.strictEqual(r.success, false); assert.ok(/Too many failed attempts/.test(r.error), r.error);
});
test('verifyToken: valid / garbage', () => {
  const E = loggedIn();
  assert.strictEqual(E.call('verifyToken', { token: E.token }).success, true);
  assert.strictEqual(E.call('verifyToken', { token: 'nope' }).success, false);
});
test('expired token (8h+) rejected', () => {
  const E = loggedIn();
  const k = 'TOKEN_' + E.token;
  E.props[k] = 'admin|' + (Date.now() - 8 * 3600 * 1000 - 1);
  assert.strictEqual(E.do('getAll').error, 'Unauthorized');
});
test('write without token → Unauthorized, nothing written', () => {
  const E = makeEnv();
  assert.strictEqual(E.call('addCourse', { name: 'x' }).error, 'Unauthorized');
  assert.strictEqual(E.sheets.Courses, undefined);
});
test('getAll via POST (token in body) returns all collections', () => {
  const E = loggedIn();
  const d = E.do('getAll');
  assert.ok(d.success);
  for (const k of ['courses', 'students', 'enrollments', 'payments', 'generalStatus']) assert.ok(Array.isArray(d[k]), k);
  assert.strictEqual(d.generalStatus.length, 1);
});
test('token of user is not readable from a different token', () => {
  const E = loggedIn();
  assert.strictEqual(E.call('getAll', {}, E.token + 'x').error, 'Unauthorized');
});

group('Course creation');
test('addCourse creates header + row with id 1001 and default status 101', () => {
  const E = loggedIn();
  const id = E.do('addCourse', { name: 'Meisner L1', feeNormal: '1500', feeEarly: '1200' }).id;
  assert.strictEqual(id, 1001);
  assert.strictEqual(E.sheets.Courses._rows[0][0], 'id');
  const row = rows(E, 'Courses')[0];
  assert.strictEqual(row[1], 'Meisner L1'); assert.strictEqual(row[8], '101'); assert.strictEqual(row[9], 'admin');
});
test('second course gets id 1002', () => {
  const E = loggedIn(); seedCourse(E);
  assert.strictEqual(seedCourse(E, { name: 'Scene Study' }), 1002);
});
test('negative fee rejected', () => {
  const E = loggedIn();
  const r = E.do('addCourse', { name: 'Bad', feeNormal: '-1' });
  assert.strictEqual(r.success, false); assert.ok(/negative/.test(r.error));
});
test('updateCourse keeps create audit fields, sets update fields', () => {
  const E = loggedIn(); const id = seedCourse(E);
  const r = E.do('updateCourse', { id, name: 'Meisner Level 1', startDate: '', endDate: '',
    feeNormal: '1600', feeEarly: '1300', capacity: '3', status: '101' });
  assert.ok(r.success, r.error);
  const row = rows(E, 'Courses')[0];
  assert.strictEqual(row[1], 'Meisner Level 1'); assert.strictEqual(row[9], 'admin'); assert.strictEqual(row[11], 'admin');
});
test('updateCourse with unknown id → error', () => {
  const E = loggedIn();
  assert.strictEqual(E.do('updateCourse', { id: 999, name: 'x', feeNormal: 1, feeEarly: 1 }).success, false);
});
test('write invalidates cache — getAll sees the new course immediately', () => {
  const E = loggedIn();
  E.do('getAll');                 // primes the cache
  seedCourse(E);
  assert.strictEqual(E.do('getAll').courses.length, 1);
});
test('every write lands in AuditLog', () => {
  const E = loggedIn(); seedCourse(E);
  const log = rows(E, 'AuditLog');
  assert.strictEqual(log.length, 1); assert.strictEqual(log[0][2], 'addCourse');
});

group('Student creation');
test('addStudent creates row', () => {
  const E = loggedIn();
  assert.strictEqual(seedStudent(E), 1001);
  assert.strictEqual(rows(E, 'Students')[0][2], 'anna@example.com');
});
test('duplicate email (exact) rejected', () => {
  const E = loggedIn(); seedStudent(E);
  const r = E.do('addStudent', { fullName: 'X', email: 'anna@example.com' });
  assert.strictEqual(r.success, false); assert.ok(/already exists/.test(r.error));
});
test('duplicate email with different case / spaces rejected', () => {
  const E = loggedIn(); seedStudent(E);
  const r = E.do('addStudent', { fullName: 'X', email: ' Anna@Example.com ' });
  assert.strictEqual(r.success, false, 'case/space variant of an existing email was accepted');
  assert.strictEqual(rows(E, 'Students').length, 1);
});
test('updateStudent to another student\'s email (case variant) rejected', () => {
  const E = loggedIn(); seedStudent(E); const b = seedStudent(E, 'bram@example.com', 'Bram');
  const r = E.do('updateStudent', { id: b, fullName: 'Bram', email: 'ANNA@example.com' });
  assert.strictEqual(r.success, false, 'update to a case variant of another email was accepted');
});
test('updateStudent keeping own email is allowed', () => {
  const E = loggedIn(); const a = seedStudent(E);
  assert.ok(E.do('updateStudent', { id: a, fullName: 'Anna V', email: 'anna@example.com' }).success);
});

group('Enrollment creation');
test('enroll existing student', () => {
  const E = loggedIn(); const c = seedCourse(E); const s = seedStudent(E);
  const r = E.do('enrollStudent', enrollPayload(c, s));
  assert.ok(r.success, r.error);
  const row = rows(E, 'Enrollments')[0];
  assert.strictEqual(row[1], s); assert.strictEqual(row[2], c); assert.strictEqual(row[4], '1500');
});
test('enroll NEW student creates student + enrollment', () => {
  const E = loggedIn(); const c = seedCourse(E);
  const r = E.do('enrollStudent', enrollPayload(c, '', {
    isNew: true, studentData: { fullName: 'Bram Jansen', email: 'bram@example.com', phone: '' },
    paymentType: 'instalment', instalmentPlan: JSON.stringify([{ amount: '600', date: '2027-01-01' }, { amount: '600', date: '2027-02-01' }]),
  }));
  assert.ok(r.success, r.error);
  assert.strictEqual(rows(E, 'Students').length, 1);
  assert.strictEqual(rows(E, 'Enrollments')[0][1], rows(E, 'Students')[0][0]);
});
test('duplicate enrollment rejected', () => {
  const E = loggedIn(); const c = seedCourse(E); const s = seedStudent(E);
  E.do('enrollStudent', enrollPayload(c, s));
  const r = E.do('enrollStudent', enrollPayload(c, s));
  assert.strictEqual(r.success, false); assert.ok(/already enrolled/.test(r.error));
});
test('capacity enforced (cap 2 → third rejected)', () => {
  const E = loggedIn(); const c = seedCourse(E);
  E.do('enrollStudent', enrollPayload(c, seedStudent(E, 'a@x.test')));
  E.do('enrollStudent', enrollPayload(c, seedStudent(E, 'b@x.test')));
  const r = E.do('enrollStudent', enrollPayload(c, seedStudent(E, 'c@x.test')));
  assert.strictEqual(r.success, false); assert.ok(/full/.test(r.error), r.error);
  assert.strictEqual(rows(E, 'Enrollments').length, 2);
});
test('full course + NEW student → no orphan student created', () => {
  const E = loggedIn(); const c = seedCourse(E, { capacity: '1' });
  E.do('enrollStudent', enrollPayload(c, seedStudent(E)));
  E.do('enrollStudent', enrollPayload(c, '', { isNew: true, studentData: { fullName: 'O', email: 'o@x.test' } }));
  assert.strictEqual(rows(E, 'Students').length, 1);
});
test('NEW student with existing email (case variant) rejected', () => {
  const E = loggedIn(); const c = seedCourse(E); seedStudent(E);
  const r = E.do('enrollStudent', enrollPayload(c, '', { isNew: true, studentData: { fullName: 'A2', email: 'ANNA@example.com' } }));
  assert.strictEqual(r.success, false, 'duplicate student created via enrollment');
});
test('error messages have no "Error: " prefix', () => {
  const E = loggedIn(); const c = seedCourse(E); const s = seedStudent(E);
  E.do('enrollStudent', enrollPayload(c, s));
  const r = E.do('enrollStudent', enrollPayload(c, s));
  assert.ok(!/^Error: /.test(r.error), 'message shown to the user: "' + r.error + '"');
});
test('enrollStudent releases the lock on failure', () => {
  const E = loggedIn(); const c = seedCourse(E); const s = seedStudent(E);
  E.do('enrollStudent', enrollPayload(c, s)); E.do('enrollStudent', enrollPayload(c, s));
  assert.strictEqual(E.lock().lockDepth, 0);
});
test('updateEnrollment changes plan, keeps student/course', () => {
  const E = loggedIn(); const c = seedCourse(E); const s = seedStudent(E);
  E.do('enrollStudent', enrollPayload(c, s));
  const id = rows(E, 'Enrollments')[0][0];
  const r = E.do('updateEnrollment', { enrollmentId: id, priceType: 'early_bird', totalFee: '1200', depositAmount: '200',
    depositDate: '2026-12-01', paymentType: 'full_remaining', fullPayDate: '2027-01-20', instalmentPlan: '[]' });
  assert.ok(r.success, r.error);
  const row = rows(E, 'Enrollments')[0];
  assert.strictEqual(row[1], s); assert.strictEqual(row[3], 'early_bird'); assert.strictEqual(row[4], '1200');
});

group('Payment creation');
test('addPayment stores numeric amount', () => {
  const E = loggedIn(); const c = seedCourse(E); const s = seedStudent(E);
  const r = E.do('addPayment', { studentId: s, courseId: c, amount: '300', date: '2026-12-01', type: 'deposit' });
  assert.ok(r.success, r.error); assert.strictEqual(rows(E, 'Payments')[0][3], 300);
});
test('zero / negative / garbage amount rejected', () => {
  const E = loggedIn();
  for (const amount of [0, -5, 'abc']) assert.strictEqual(E.do('addPayment', { amount }).success, false, String(amount));
  assert.strictEqual(rows(E, 'Payments').length, 0);
});

group('Delete guards');
test('course with enrollments cannot be deleted', () => {
  const E = loggedIn(); const c = seedCourse(E); E.do('enrollStudent', enrollPayload(c, seedStudent(E)));
  const r = E.do('deleteCourse', { id: c });
  assert.strictEqual(r.success, false); assert.ok(/enrollment/.test(r.error));
});
test('enrollment with payments cannot be deleted', () => {
  const E = loggedIn(); const c = seedCourse(E); const s = seedStudent(E);
  E.do('enrollStudent', enrollPayload(c, s));
  E.do('addPayment', { studentId: s, courseId: c, amount: 300, date: '2026-12-01', type: 'deposit' });
  assert.strictEqual(E.do('deleteEnrollment', { id: rows(E, 'Enrollments')[0][0] }).success, false);
});
test('student with enrollments cannot be deleted', () => {
  const E = loggedIn(); const c = seedCourse(E); const s = seedStudent(E);
  E.do('enrollStudent', enrollPayload(c, s));
  assert.strictEqual(E.do('deleteStudent', { id: s }).success, false);
});
test('delete payment → enrollment → student → course (clean chain)', () => {
  const E = loggedIn(); const c = seedCourse(E); const s = seedStudent(E);
  E.do('enrollStudent', enrollPayload(c, s));
  E.do('addPayment', { studentId: s, courseId: c, amount: 300, date: '2026-12-01', type: 'deposit' });
  assert.ok(E.do('deletePayment',    { id: rows(E, 'Payments')[0][0] }).success);
  assert.ok(E.do('deleteEnrollment', { id: rows(E, 'Enrollments')[0][0] }).success);
  assert.ok(E.do('deleteStudent',    { id: s }).success);
  assert.ok(E.do('deleteCourse',     { id: c }).success);
  assert.strictEqual(E.lock().lockDepth, 0);
});
test('delete unknown id → error, lock released', () => {
  const E = loggedIn(); seedCourse(E);
  assert.strictEqual(E.do('deletePayment', { id: 999 }).success, false);
  assert.strictEqual(E.lock().lockDepth, 0);
});

group('ID generation');
test('getNextId holds the lock until the row is written', () => {
  // Two adds must never compute the same id: the lock has to cover read-max-id
  // AND appendRow. Detect it by checking the lock is still held during appendRow.
  const E = loggedIn(); seedCourse(E);
  const sheet = E.sheets.Courses; const orig = sheet.appendRow; let heldDuringAppend = null;
  sheet.appendRow = r => { heldDuringAppend = E.lock().lockDepth > 0; orig(r); };
  seedCourse(E, { name: 'B' });
  assert.strictEqual(heldDuringAppend, true, 'lock released before appendRow — concurrent adds can get the same id');
});

group('Daily reminder cron');
function cronEnv(paidDeposit) {
  const E = loggedIn(); const c = seedCourse(E); const s = seedStudent(E);
  E.do('enrollStudent', enrollPayload(c, s, { depositDate: todayStr(), depositAmount: '300' }));
  if (paidDeposit) E.do('addPayment', { studentId: s, courseId: c, amount: 300, date: todayStr(), type: 'deposit' });
  return E;
}
test('deposit due today → one email to admins', () => {
  const E = cronEnv(false); E.ctx.checkPaymentsAndNotify();
  assert.strictEqual(E.mails.length, 1); assert.ok(/Deposit/.test(E.mails[0].body));
  assert.strictEqual(E.mails[0].to, 'admin@studio.test');
});
test('second run the same day → no duplicate email', () => {
  const E = cronEnv(false); E.ctx.checkPaymentsAndNotify(); E.ctx.checkPaymentsAndNotify();
  assert.strictEqual(E.mails.length, 1);
});
test('deposit already PAID → no reminder', () => {
  const E = cronEnv(true); E.ctx.checkPaymentsAndNotify();
  assert.strictEqual(E.mails.length, 0, 'reminder sent for a deposit that was already paid');
});
test('full payment reminder shows the REMAINING amount, not the total', () => {
  const E = loggedIn(); const c = seedCourse(E); const s = seedStudent(E);
  E.do('enrollStudent', enrollPayload(c, s, { depositDate: '2026-01-01', fullPayDate: todayStr() }));
  E.do('addPayment', { studentId: s, courseId: c, amount: 300, date: '2026-01-01', type: 'deposit' });
  E.ctx.checkPaymentsAndNotify();
  assert.strictEqual(E.mails.length, 1);
  assert.ok(/1200/.test(E.mails[0].body), 'body: ' + E.mails[0].body.split('\n').find(l => /Due/.test(l)));
});
test('cron logs to CronLog and never throws', () => {
  const E = makeEnv(); E.ctx.checkPaymentsAndNotify();
  assert.ok(rows(E, 'CronLog').length >= 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('FAILED: ' + fails.join('; ')); process.exit(1); }
