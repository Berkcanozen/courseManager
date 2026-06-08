/**
 * MEISNER STUDIO — calc.js
 * Pure, side-effect-free money/date helpers extracted from app.js.
 *
 * WHY THIS FILE EXISTS
 * These functions do the financial math (parse amounts, compute overdue,
 * suggest the next payment, split instalments). They are the most expensive
 * place for a silent regression, so they live here — DOM-free and testable
 * under Node (see tests/calc.test.js). app.js consumes them as globals.
 *
 * Loaded in the browser BEFORE app.js (see index.html). In Node it is required
 * by the test runner. Same source, no copy-paste drift.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node
  if (typeof window !== 'undefined') Object.assign(window, api);              // browser
  else if (typeof globalThis !== 'undefined') Object.assign(globalThis, api);
})(this, function () {

  /* ── date helpers ── */
  const _isISODate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  // Returns epoch ms for a valid YYYY-MM-DD string, otherwise null (never NaN/0).
  const _dateToMs  = s => (_isISODate(s) ? new Date(s).getTime() : null);

  /* ── amount parsers ── */

  // Lenient: strips any non-numeric chars. Used for pre-filled/display fields.
  const parseFee = val => {
    if (val === null || val === undefined || val === '') return 0;
    const n = parseFloat(String(val).replace(/[^0-9.]/g, ''));
    return isNaN(n) ? 0 : n;
  };

  // Locale-aware: accepts both European "1.234,56" and US "1,234.56".
  const parseUserNumber = val => {
    if (val === null || val === undefined || val === '') return 0;
    let s = String(val).trim();
    const lastComma = s.lastIndexOf(',');
    const lastDot   = s.lastIndexOf('.');
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.'); // EU
    else                     s = s.replace(/,/g, '');                    // US
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };

  /**
   * Total currently-overdue amount for an enrollment.
   * @param {object} en      enrollment record
   * @param {number} paid    amount already paid for this student+course
   * @param {number} todayMs midnight today, in epoch ms
   * @returns {number} overdue amount (0 if nothing past due)
   *
   * NOTE: every date is null-guarded via _dateToMs, so a blank/garbage
   * depositDate no longer counts as "overdue" (this was a latent bug in the
   * original inline version where `null < todayMs` evaluated truthy).
   */
  function overdueAmount(en, paid, todayMs) {
    let overdue = 0;
    const dep   = Number(en.depositAmount || 0);

    const depMs = _dateToMs(en.depositDate);
    if (dep > 0 && depMs !== null && depMs < todayMs && paid < dep) {
      overdue += (dep - paid);
    }

    if (en.paymentType === 'instalment' && en.instalmentPlan) {
      try {
        const plan = JSON.parse(en.instalmentPlan);
        let scheduledDue = dep; // deposit counts toward the running total
        for (const inst of plan) {
          const ms = _dateToMs(inst.date);
          if (ms !== null && ms < todayMs) scheduledDue += Number(inst.amount || 0);
        }
        if (paid < scheduledDue) overdue = Math.max(overdue, scheduledDue - paid);
      } catch (e) { /* malformed plan — ignore for overdue */ }
    }

    if (en.paymentType === 'full_remaining' && en.fullPayDate) {
      const ms = _dateToMs(en.fullPayDate);
      if (ms !== null && ms < todayMs) {
        const rem = Number(en.totalFee || 0) - paid;
        if (rem > 0) overdue = Math.max(overdue, rem);
      }
    }

    return overdue;
  }

  /**
   * Computes the next expected payment for an enrollment.
   * @returns {{amount:number, type:string, remaining:number,
   *            fullyPaid:boolean, instalmentIndex?:number}}
   */
  function suggestNextPayment(en, paid) {
    const total = Number(en.totalFee || 0);
    const rem   = Math.max(0, total - paid);
    if (rem === 0) return { amount: 0, type: 'other', remaining: 0, fullyPaid: true };

    const dep = Number(en.depositAmount || 0);
    if (dep > 0 && paid < dep) {
      return { amount: dep - paid, type: 'deposit', remaining: rem, fullyPaid: false };
    }

    if (en.paymentType === 'instalment' && en.instalmentPlan) {
      try {
        const plan = JSON.parse(en.instalmentPlan);
        let acc = dep;
        for (let i = 0; i < plan.length; i++) {
          const instAmt = Number(plan[i].amount || 0);
          acc += instAmt;
          if (paid < acc) {
            const amount = instAmt - Math.max(0, paid - (acc - instAmt));
            return { amount, type: 'instalment', remaining: rem, instalmentIndex: i, fullyPaid: false };
          }
        }
      } catch (e) { /* malformed plan — fall back to remaining balance */ }
    }

    return { amount: rem, type: 'full', remaining: rem, fullyPaid: false };
  }

  /**
   * Splits the remaining fee (after deposit) into `num` equal instalments,
   * each rounded to 2 decimals. Returns an array of numbers.
   */
  function splitInstalments(totalFee, deposit, num) {
    const rem = Math.max(0, Number(totalFee || 0) - Number(deposit || 0));
    if (!(num > 0)) return [];
    const amt = rem / num;
    return Array.from({ length: num }, () => Number(amt.toFixed(2)));
  }

  return { _isISODate, _dateToMs, parseFee, parseUserNumber, overdueAmount, suggestNextPayment, splitInstalments };
});
