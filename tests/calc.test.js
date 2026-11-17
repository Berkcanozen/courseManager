/**
 * MEISNER STUDIO — tests/calc.test.js
 * Unit tests for the money-critical pure functions in calc.js.
 * Plain Node + assert — no framework. Run:  node tests/calc.test.js
 *
 * These guard the math that touches real money: amount parsing, overdue
 * detection, next-payment suggestion, and instalment splitting. A silent
 * regression here is the most expensive kind, so it gets the most coverage.
 */
const assert = require('assert');
const {
  parseFee, parseUserNumber, overdueAmount, suggestNextPayment, splitInstalments, _dateToMs
} = require('../calc.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}
function group(name) { console.log('\n' + name); }

// Fixed "today" so date-based tests are deterministic.
const TODAY = new Date('2026-06-05').getTime();
const DAY   = 86400000;
const past  = '2026-06-01';   // before today
const future= '2026-07-01';   // after today

/* ── parseUserNumber (EU vs US decimal formats) ── */
group('parseUserNumber');
test('US thousands + decimal',      () => assert.strictEqual(parseUserNumber('1,234.56'), 1234.56));
test('EU thousands + decimal',      () => assert.strictEqual(parseUserNumber('1.234,56'), 1234.56));
test('plain decimal dot',           () => assert.strictEqual(parseUserNumber('500.50'), 500.5));
test('plain decimal comma (EU)',    () => assert.strictEqual(parseUserNumber('500,50'), 500.5));
test('integer',                     () => assert.strictEqual(parseUserNumber('750'), 750));
test('empty -> 0',                  () => assert.strictEqual(parseUserNumber(''), 0));
test('null -> 0',                   () => assert.strictEqual(parseUserNumber(null), 0));
test('garbage -> 0',                () => assert.strictEqual(parseUserNumber('abc'), 0));
test('whitespace trimmed',          () => assert.strictEqual(parseUserNumber('  42 '), 42));

/* ── parseFee (lenient strip) ── */
group('parseFee');
test('currency symbol stripped',    () => assert.strictEqual(parseFee('€1200'), 1200));
// parseFee consumes fmt() output (en-US: comma thousands, dot decimal).
test('formatted display value (US)',() => assert.strictEqual(parseFee('€1,200.00'), 1200.00));
test('empty -> 0',                  () => assert.strictEqual(parseFee(''), 0));
test('garbage -> 0',                () => assert.strictEqual(parseFee('n/a'), 0));

/* ── _dateToMs (null-safe; the latent-bug fix) ── */
group('_dateToMs');
test('valid ISO -> ms',             () => assert.strictEqual(_dateToMs('2026-06-05'), new Date('2026-06-05').getTime()));
test('invalid -> null (not 0)',     () => assert.strictEqual(_dateToMs('not-a-date'), null));
test('empty -> null',               () => assert.strictEqual(_dateToMs(''), null));

/* ── overdueAmount ── */
group('overdueAmount');
test('deposit past due, unpaid', () => {
  const en = { depositAmount: 200, depositDate: past, paymentType: 'full_remaining', totalFee: 1000 };
  assert.strictEqual(overdueAmount(en, 0, TODAY), 200);
});
test('deposit past due, partially paid', () => {
  const en = { depositAmount: 200, depositDate: past, paymentType: 'full_remaining', totalFee: 1000 };
  assert.strictEqual(overdueAmount(en, 50, TODAY), 150);
});
test('deposit not yet due -> 0', () => {
  const en = { depositAmount: 200, depositDate: future, paymentType: 'full_remaining', totalFee: 1000 };
  assert.strictEqual(overdueAmount(en, 0, TODAY), 0);
});
test('BUGFIX: blank depositDate is NOT overdue', () => {
  // Old inline version treated null<today as true and flagged this as overdue.
  const en = { depositAmount: 200, depositDate: '', paymentType: 'full_remaining', totalFee: 1000 };
  assert.strictEqual(overdueAmount(en, 0, TODAY), 0);
});
test('full payment past due', () => {
  const en = { totalFee: 1000, paymentType: 'full_remaining', fullPayDate: past, depositAmount: 0 };
  assert.strictEqual(overdueAmount(en, 300, TODAY), 700);
});
test('full payment fully paid -> 0', () => {
  const en = { totalFee: 1000, paymentType: 'full_remaining', fullPayDate: past, depositAmount: 0 };
  assert.strictEqual(overdueAmount(en, 1000, TODAY), 0);
});
test('instalments: one past due, none paid', () => {
  const en = {
    totalFee: 900, depositAmount: 0, paymentType: 'instalment',
    instalmentPlan: JSON.stringify([{ amount: 300, date: past }, { amount: 300, date: future }, { amount: 300, date: future }])
  };
  assert.strictEqual(overdueAmount(en, 0, TODAY), 300);
});
test('instalments: deposit + first instalment past due', () => {
  const en = {
    totalFee: 900, depositAmount: 100, depositDate: past, paymentType: 'instalment',
    instalmentPlan: JSON.stringify([{ amount: 300, date: past }, { amount: 300, date: future }])
  };
  // scheduledDue = deposit(100) + first(300) = 400; paid 0 -> overdue 400
  assert.strictEqual(overdueAmount(en, 0, TODAY), 400);
});
test('instalments: malformed plan does not throw', () => {
  const en = { totalFee: 900, depositAmount: 0, paymentType: 'instalment', instalmentPlan: '{bad json' };
  assert.strictEqual(overdueAmount(en, 0, TODAY), 0);
});
test('totalFee garbage does not produce NaN', () => {
  const en = { totalFee: '', paymentType: 'full_remaining', fullPayDate: past, depositAmount: 0 };
  assert.strictEqual(overdueAmount(en, 0, TODAY), 0);
});

/* ── suggestNextPayment ── */
group('suggestNextPayment');
test('fully paid', () => {
  const en = { totalFee: 1000, depositAmount: 200, paymentType: 'full_remaining' };
  const r = suggestNextPayment(en, 1000);
  assert.strictEqual(r.fullyPaid, true);
  assert.strictEqual(r.type, 'other');
});
test('deposit expected first', () => {
  const en = { totalFee: 1000, depositAmount: 200, paymentType: 'full_remaining' };
  const r = suggestNextPayment(en, 0);
  assert.strictEqual(r.type, 'deposit');
  assert.strictEqual(r.amount, 200);
});
test('after deposit, full remaining', () => {
  const en = { totalFee: 1000, depositAmount: 200, paymentType: 'full_remaining' };
  const r = suggestNextPayment(en, 200);
  assert.strictEqual(r.type, 'full');
  assert.strictEqual(r.amount, 800);
});
test('next instalment after deposit', () => {
  const en = {
    totalFee: 900, depositAmount: 300, paymentType: 'instalment',
    instalmentPlan: JSON.stringify([{ amount: 300, date: past }, { amount: 300, date: future }])
  };
  const r = suggestNextPayment(en, 300); // deposit covered, next is instalment 1
  assert.strictEqual(r.type, 'instalment');
  assert.strictEqual(r.instalmentIndex, 0);
  assert.strictEqual(r.amount, 300);
});
test('partial payment into an instalment', () => {
  const en = {
    totalFee: 900, depositAmount: 300, paymentType: 'instalment',
    instalmentPlan: JSON.stringify([{ amount: 300, date: past }, { amount: 300, date: future }])
  };
  const r = suggestNextPayment(en, 450); // 300 deposit + 150 into first instalment
  assert.strictEqual(r.type, 'instalment');
  assert.strictEqual(r.instalmentIndex, 0);
  assert.strictEqual(r.amount, 150); // remaining on instalment 1
});
test('malformed instalment plan falls back to remaining', () => {
  const en = { totalFee: 900, depositAmount: 0, paymentType: 'instalment', instalmentPlan: '{bad' };
  const r = suggestNextPayment(en, 100);
  assert.strictEqual(r.type, 'full');
  assert.strictEqual(r.amount, 800);
});

/* ── splitInstalments ── */
group('splitInstalments');
test('even split', () => {
  assert.deepStrictEqual(splitInstalments(900, 300, 3), [200, 200, 200]);
});
test('rounding to 2 decimals', () => {
  assert.deepStrictEqual(splitInstalments(1000, 0, 3), [333.33, 333.33, 333.33]);
});
test('deposit larger than fee -> no negative', () => {
  assert.deepStrictEqual(splitInstalments(500, 600, 2), [0, 0]);
});
test('zero instalments -> empty', () => {
  assert.deepStrictEqual(splitInstalments(1000, 0, 0), []);
});

/* ── summary ── */
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
