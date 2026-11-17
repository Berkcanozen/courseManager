/**
 * MEISNER STUDIO — tests/gas-mock.js
 * In-memory mocks of the Google Apps Script services the backend uses, plus a
 * loader that runs the real *.gs files in a sandbox. Shared by
 * tests/backend.test.js and tests/e2e-edge.js.
 *
 * makeGasEnv({ sheetsTyping: true }) also emulates how Google Sheets converts
 * values written with appendRow/setValues:
 *   "0612345678" → 612345678 (number, leading zero lost)
 *   "+3161234"   → 3161234   (number, plus lost)
 *   "2026-12-01" → Date      (read back by sheetToObjects as yyyy-MM-dd)
 *   "=..."       → formula   (read back as "FORMULA:=..." so tests can spot it)
 *   "'text"      → "text"    (leading apostrophe forces plain text, as in Sheets)
 */
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');
const crypto = require('crypto');

const ROOT     = path.resolve(__dirname, '..');
const GS_FILES = ['config.gs', 'utils.gs', 'Auth.gs', 'Courses.gs', 'Students.gs',
                  'Enrollments.gs', 'Payments.gs', 'Cron.gs', 'router.gs'];

function sheetsCoerce(v) {
  if (typeof v !== 'string') return v;
  if (v.startsWith("'")) return v.slice(1);
  if (v.startsWith('=')) return 'FORMULA:' + v;
  if (/^[+-]?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return v;
}

function makeSheet(name, coerce) {
  const rows = [];
  const c = r => r.map(coerce);
  return {
    _rows: rows,
    getName: () => name,
    appendRow: r => { rows.push(c(r)); },
    getLastRow: () => rows.length,
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
    getRange: (row, col, nr, nc) => ({
      getValues: () => rows.slice(row - 1, row - 1 + nr).map(r => r.slice(col - 1, col - 1 + nc)),
      setValues: vals => vals.forEach((v, i) => {
        const r = rows[row - 1 + i];
        c(v).forEach((cell, j) => { r[col - 1 + j] = cell; });
      }),
    }),
    deleteRow: n => { rows.splice(n - 1, 1); },
    setFrozenRows: () => {},
  };
}

function makeGasEnv({ sheetsTyping = false } = {}) {
  const coerce = sheetsTyping ? sheetsCoerce : (v => v);
  const sheets = {};
  const props  = {};
  const cache  = {};
  const mails  = [];
  let lockDepth = 0, maxLockDepth = 0;
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = makeSheet(n, coerce)),
    getUrl: () => 'https://docs.google.com/spreadsheets/d/TEST',
  };
  const fmtParts = (d, tz) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map(p => [p.type, p.value]));
  const sandbox = {
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
      getUuid: () => crypto.randomUUID(),
    },
    Session: { getScriptTimeZone: () => 'Europe/Amsterdam' },
    MailApp: { sendEmail: m => mails.push(m) },
  };
  const ctx = vm.createContext(sandbox);
  for (const f of GS_FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });

  // Seed the sheets the app expects to exist (written raw, like a human would).
  const seed = (name, rows) => { const s = ss.insertSheet(name); rows.forEach(r => s._rows.push(r)); };
  seed('Admins', [['email', 'username', 'password'], ['admin@studio.test', 'admin', 'pw']]);
  seed('GeneralStatus', [['id', 'name', 'code', 'entity'],
    [101, 'Active', 'active', 'course'], [102, 'Completed', 'completed', 'course'],
    [103, 'Draft', 'draft', 'course'], [104, 'Cancelled', 'cancelled', 'course'],
    // live sheet uses this naming scheme — keep both covered
    [105, 'Open', 'open', 'course'], [106, 'Closed', 'closed', 'course']]);

  const post = body => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent());
  const call = (action, payload = {}, token) => post({ action, payload, token, currentUser: 'admin' });
  const get  = params => JSON.parse(ctx.doGet({ parameter: params }).getContent());
  return { ctx, ss, sheets, props, cache, mails, post, call, get, lock: () => ({ lockDepth, maxLockDepth }) };
}

module.exports = { makeGasEnv, sheetsCoerce };
