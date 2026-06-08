/**
 * MEISNER STUDIO — COURSE MANAGEMENT SYSTEM
 * Frontend Logic — v3.2.0
 *  - sync race-condition guard (_syncSeq), one auto-retry on cold start,
 *    single-flight write guard (_saving), token moved to POST body,
 *    NaN guards, error logging, background re-sync on tab focus.
 *  - money math extracted to calc.js (unit-tested in tests/calc.test.js).
 *
 * ════════════════════════════════════════════════════════════
 *  TABLE OF CONTENTS  (search for "§NN" to jump to a section)
 * ════════════════════════════════════════════════════════════
 *   §01  STATE                      Global data + edit-mode ids
 *   §02  XSS PROTECTION             esc()
 *   §03  TOAST / NOTIFICATIONS      toast()
 *   §04  CONFIRM DIALOG             confirmDialog()
 *   §05  FORMAT & VALIDATION        fmt, dates, getOverdueInfo, badges
 *   §06  API LAYER                  apiFetch, tokens, _forceLogout
 *   §07  AUTH & SESSION             login, verify, initApp, onload
 *   §08  DATA SYNC                  syncSheets, student search
 *   §09  STATE INDEXES & GETTERS    buildIndexes, getCourse/Student/Paid
 *   §10  MODAL SYSTEM               openM/closeM + setup functions
 *   §11  NAVIGATION                 goTab
 *   §12  RENDER — LISTS             stats, dash, courses, students, …
 *   §13  RENDER — STUDENT DETAIL    showStudentDetail
 *   §14  RENDER — ENROLLMENT DETAIL showEnrollmentDetail
 *   §15  FORM HELPERS               toggles, instalments, suggestion
 *   §16  CSV EXPORT                 exportEnrollmentsCSV / PaymentsCSV
 *   §17  CRUD — DELETE              deleteRecord, …
 *   §18  CRUD — SAVE                saveCourse, saveStudent, …
 *   §19  DATE-BASED REPORTING       period summary, chart, upcoming due
 * ════════════════════════════════════════════════════════════
 *
 *  ARCHITECTURE NOTE
 *  Single-file by design (no bundler — runs directly on GitHub Pages).
 *  Sections are ordered by dependency: helpers first, then state,
 *  API, rendering, and finally the CRUD handlers that tie it together.
 *  All config/magic-numbers live in config.js (window.APP_CONFIG).
 */

// Config loaded from config.js (single source of truth)
if (!window.APP_CONFIG) {
  alert('Configuration failed to load (config.js missing). Please refresh or contact the administrator.');
  throw new Error('config.js not loaded');
}
const cfg       = window.APP_CONFIG;
const CONSTANTS = window.APP_CONSTANTS || {};

// calc.js (pure money/date math) must load before this file — see index.html.
if (typeof parseUserNumber !== 'function' || typeof overdueAmount !== 'function') {
  alert('Calculation library failed to load (calc.js missing). Please refresh or contact the administrator.');
  throw new Error('calc.js not loaded');
}

/* ─────────────────────────────────────────────
   §01 · STATE
   Global app data (S) and edit-mode tracking ids.
───────────────────────────────────────────── */
let S = { courses: [], students: [], enrollments: [], payments: [], generalStatus: [] };
let editCourseId          = null;
let editEnrollmentId      = null;
let editStudentIdentityId = null;

/* ─────────────────────────────────────────────
   §02 · XSS PROTECTION
   esc() sanitizes user data before innerHTML injection.
───────────────────────────────────────────── */
const _escDiv = document.createElement('div');
function esc(str) {
  if (str === null || str === undefined) return '';
  _escDiv.textContent = String(str);
  return _escDiv.innerHTML;
}

/* ─────────────────────────────────────────────
   §03 · TOAST / NOTIFICATIONS
   toast() — replaces alert(). Types: info/success/error/warn.
───────────────────────────────────────────── */
function toast(message, type = 'info', duration = (window.APP_CONSTANTS && window.APP_CONSTANTS.TOAST_DURATION_MS) || 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'false');
    document.body.appendChild(container);
  }

  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const icons = { info: 'ti-info-circle', success: 'ti-circle-check', error: 'ti-alert-circle', warn: 'ti-alert-triangle' };
  t.innerHTML = `<i class="ti ${icons[type] || icons.info}"></i><span>${esc(message)}</span><button class="toast-close" onclick="this.parentElement.remove()"><i class="ti ti-x"></i></button>`;
  container.appendChild(t);

  // Animate in
  requestAnimationFrame(() => t.classList.add('toast-visible'));

  // Auto remove
  setTimeout(() => {
    t.classList.remove('toast-visible');
    setTimeout(() => t.remove(), 300);
  }, duration);
}

/* ─────────────────────────────────────────────
   §04 · CONFIRM DIALOG
   confirmDialog() — Promise-based, replaces native confirm().
───────────────────────────────────────────── */
function confirmDialog(message, confirmLabel = 'Confirm', danger = true) {
  return new Promise(resolve => {
    let overlay = document.getElementById('confirmOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'confirmOverlay';
      overlay.innerHTML = `
        <div class="confirm-box" role="alertdialog" aria-modal="true">
          <p class="confirm-msg" id="confirmMsg"></p>
          <div class="confirm-actions">
            <button class="btn" id="confirmCancel">Cancel</button>
            <button class="btn" id="confirmOk"></button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
    }

    document.getElementById('confirmMsg').textContent = message;
    const okBtn = document.getElementById('confirmOk');
    okBtn.textContent = confirmLabel;
    okBtn.className = danger ? 'danger-btn' : 'btn primary';

    overlay.style.display = 'flex';
    okBtn.focus();

    const cleanup = result => {
      overlay.style.display = 'none';
      okBtn.replaceWith(okBtn.cloneNode(true)); // remove old listeners
      document.getElementById('confirmCancel').replaceWith(document.getElementById('confirmCancel').cloneNode(true));
      resolve(result);
    };

    document.getElementById('confirmOk').addEventListener('click', () => cleanup(true));
    document.getElementById('confirmCancel').addEventListener('click', () => cleanup(false));
  });
}

/* ─────────────────────────────────────────────
   §05 · FORMAT & VALIDATION HELPERS
   fmt, parseUserNumber, date helpers, getOverdueInfo, getStatusBadge.
───────────────────────────────────────────── */
const fmt = n =>
  cfg.currency + Number(n || 0).toLocaleString(cfg.locale || 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const today = () => new Date().toISOString().split('T')[0];

// parseFee, parseUserNumber, overdueAmount, suggestNextPayment, splitInstalments
// live in calc.js (loaded before this file) — pure, unit-tested money math.

/**
 * Date validation helpers
 */
const isValidDate = str => str && /^\d{4}-\d{2}-\d{2}$/.test(str);
const dateToMs    = str => isValidDate(str) ? new Date(str).getTime() : null;

function validateCourseDates(startDate, endDate, depositDeadline) {
  if (startDate && endDate && dateToMs(startDate) > dateToMs(endDate))
    return 'End date must be after start date.';
  return null;
}

function validateEnrollmentDates(depositDate, fullPayDate, paymentType) {
  if (depositDate && fullPayDate && paymentType !== 'instalment') {
    if (dateToMs(depositDate) > dateToMs(fullPayDate))
      return 'Full payment due date must be after deposit due date.';
  }
  return null;
}

/**
 * Determines if an enrollment has any overdue (past-due & unpaid) milestone.
 * Returns { overdue: bool, amount: number }. Math lives in calc.js.
 */
function getOverdueInfo(en) {
  const todayMs = new Date().setHours(0, 0, 0, 0);
  const paid    = getEnrollmentPaid(en.studentId, en.courseId);
  const amount  = overdueAmount(en, paid, todayMs);
  return { overdue: amount > 0, amount };
}

const formatDate = dateStr => {
  if (!dateStr) return '—';
  if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }
  const dt = new Date(dateStr);
  if (isNaN(dt)) return String(dateStr);
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
};

const getToken = () =>
  localStorage.getItem('sessionToken') || sessionStorage.getItem('sessionToken') || '';

const setToken = (token, remember) => {
  if (remember) { localStorage.setItem('sessionToken', token); sessionStorage.removeItem('sessionToken'); }
  else          { sessionStorage.setItem('sessionToken', token); localStorage.removeItem('sessionToken'); }
};

const clearToken = () => {
  localStorage.removeItem('sessionToken'); localStorage.removeItem('username');
  sessionStorage.removeItem('sessionToken'); sessionStorage.removeItem('username');
};

const getUsername = () =>
  localStorage.getItem('username') || sessionStorage.getItem('username') || '';

const setUsername = (username, remember) => {
  if (remember) localStorage.setItem('username', username);
  else          sessionStorage.setItem('username', username);
};

const getStatusBadge = statusId => {
  const colors = { active: 'teal', completed: 'blue', draft: 'amber', cancelled: 'red' };
  const st = (S.generalStatus || []).find(s => s.id == statusId);
  const label     = st ? st.name : (statusId || 'Unknown');
  const colorCode = st ? st.code : 'blue';
  return `<span class="chip ${colors[colorCode] || 'blue'}">${esc(label)}</span>`;
};

/* ─────────────────────────────────────────────
   §06 · API LAYER
   _postWithRetry + apiFetch + token helpers + _forceLogout.
   - _postWithRetry: one automatic retry on network failure / 5xx (Apps Script
     cold-start can take 5-15s or 500). Client errors (4xx) are NOT retried.
   - _saving: global single-flight guard so the Enter key and a button click
     (or two fast clicks) can't fire the same write twice.
───────────────────────────────────────────── */
const _sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * POSTs to the backend with a single automatic retry.
 * Resolves to parsed JSON, or { __authFailed: true } on HTTP 401.
 * Rejects only after the retry is also exhausted.
 */
async function _postWithRetry(body, { retries = 1, delayMs = 1500 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await _sleep(delayMs);
    try {
      const res = await fetch(cfg.url, { method: 'POST', body: JSON.stringify(body) });
      if (res.status === 401) return { __authFailed: true };
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        if (res.status < 500) throw lastErr; // client error — retrying won't help
        continue;                            // 5xx — likely cold start, retry once
      }
      return await res.json();
    } catch (err) {
      lastErr = err; // network/parse error — fall through to the retry
    }
  }
  throw lastErr;
}

let _saving = false; // single-flight guard for write operations

async function apiFetch(body, btnEl = null) {
  if (_saving) return null;          // a write is already in flight — ignore the duplicate
  _saving = true;
  const original = btnEl ? btnEl.innerHTML : null;
  if (btnEl) { btnEl.innerHTML = '<i class="ti ti-loader"></i> Saving…'; btnEl.disabled = true; }

  try {
    const data = await _postWithRetry({ ...body, token: getToken() });
    if (data && data.__authFailed) { _forceLogout(); return null; }
    // Backend may also return { success: false, error: 'Unauthorized' }
    if (data && data.success === false && data.error === 'Unauthorized') {
      _forceLogout(); return null;
    }
    return data;
  } catch (err) {
    console.error('[apiFetch]', err);
    toast('Network error. Please check your connection and try again.', 'error');
    return null; // callers already treat null as "handled, stop"
  } finally {
    _saving = false;
    if (btnEl) { btnEl.innerHTML = original; btnEl.disabled = false; }
  }
}

function _forceLogout() {
  clearToken();
  closeM();
  document.getElementById('main-app').style.display   = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  toast('Your session has expired. Please sign in again.', 'warn', 5000);
}

/* ─────────────────────────────────────────────
   §07 · AUTH & SESSION
   login, verifySession, testConnection, initApp, window.onload.
───────────────────────────────────────────── */
async function testConnection() {
  const badge = document.getElementById('loginSyncBadge');
  if (!badge) return;
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), CONSTANTS.PING_TIMEOUT_MS || 5000);
    const r = await fetch(cfg.url + '?action=ping', { signal: controller.signal });
    clearTimeout(tid);
    if (r.ok) {
      badge.innerHTML = '<i class="ti ti-cloud-check" style="color:var(--color-brand)"></i> Server Connected';
      badge.style.borderColor = 'var(--color-brand)';
    } else throw new Error();
  } catch {
    badge.innerHTML = '<i class="ti ti-cloud-x" style="color:#ef4444"></i> Connection Error';
    badge.style.borderColor = '#ef4444';
  }
}

async function verifySession() {
  const token = getToken();
  if (!token) return false;
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      body: JSON.stringify({ action: 'verifyToken', payload: { token } })
    });
    const d = await res.json();
    return d.success === true;
  } catch { return false; }
}

async function handleLogin() {
  const u        = document.getElementById('l-user').value.trim();
  const p        = document.getElementById('l-pass').value;
  const remember = document.getElementById('l-remember').checked;
  const btn      = document.getElementById('l-btn');
  const err      = document.getElementById('login-err');
  if (!u || !p) return;

  btn.innerHTML = '<i class="ti ti-loader"></i> Verifying…'; btn.disabled = true;
  err.style.display = 'none';

  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      body: JSON.stringify({ action: 'checkLogin', payload: { username: u, password: p } })
    });
    const d = await res.json();
    if (d.success && d.token) {
      setToken(d.token, remember);
      setUsername(u, remember);
      initApp();
    } else {
      err.innerText = d.error || 'Invalid credentials.'; err.style.display = 'block';
    }
  } catch {
    err.innerText = 'Connection error. Please try again.'; err.style.display = 'block';
  } finally {
    btn.innerHTML = 'Sign In'; btn.disabled = false;
  }
}

function initApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('main-app').style.display     = 'block';
  syncSheets();
}

window.onload = async () => {
  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeM(); return; }
    // Enter submits the active modal form (only if not in textarea)
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
      const active = document.querySelector('.modal.active');
      if (!active) return;
      const id = active.id;
      if (id === 'mCourse')      { e.preventDefault(); saveCourse(); }
      else if (id === 'mStudentEdit') { e.preventDefault(); saveStudentIdentity(); }
      else if (id === 'mEnrollment')  { e.preventDefault(); saveEnrollment(); }
      else if (id === 'mPayment')     { e.preventDefault(); savePayment(); }
    }
  });
  // Re-sync when the tab regains focus, plus a gentle background poll, so data
  // doesn't go stale when the app is open on multiple tabs/devices.
  const _canBackgroundSync = () =>
    document.visibilityState === 'visible' &&
    !!getToken() &&
    document.getElementById('main-app').style.display !== 'none';

  document.addEventListener('visibilitychange', () => { if (_canBackgroundSync()) syncSheets(); });
  setInterval(() => { if (_canBackgroundSync()) syncSheets(); }, 5 * 60 * 1000); // every 5 min

  const valid = await verifySession();
  if (valid) { initApp(); } else { clearToken(); testConnection(); }
};

/* ─────────────────────────────────────────────
   §08 · DATA SYNC
   syncSheets() pulls all data; populateStudentSearch.
───────────────────────────────────────────── */
let _syncSeq = 0; // monotonic id — only the newest sync is allowed to write S

async function syncSheets() {
  const mySeq = ++_syncSeq;
  document.getElementById('syncBadge').innerHTML = '<i class="ti ti-loader"></i> Syncing…';
  try {
    // Token now travels in the POST body (not the query string), so it never
    // lands in server access logs or browser history.
    const d = await _postWithRetry({ action: 'getAll', token: getToken() });
    if (mySeq !== _syncSeq) return;           // a newer sync started — discard this result
    if (d && d.__authFailed) { _forceLogout(); return; }
    if (d && d.success === false) {
      if (d.error === 'Unauthorized') { _forceLogout(); return; }
      throw new Error(d.error || 'Sync failed');
    }
    S = {
      courses:       d.courses       || [],
      students:      d.students      || [],
      enrollments:   d.enrollments   || [],
      payments:      d.payments      || [],
      generalStatus: d.generalStatus || []
    };
    document.getElementById('syncBadge').innerHTML =
      '<i class="ti ti-cloud-check" style="color:var(--color-brand)"></i> Live Sync Active';
    buildIndexes();
    populateStudentSearch();
    render();
  } catch (err) {
    if (mySeq !== _syncSeq) return;           // a newer sync owns the UI now — stay quiet
    console.error('[syncSheets]', err);
    document.getElementById('syncBadge').innerHTML =
      '<i class="ti ti-cloud-x" style="color:#ef4444"></i> Sync Error';
    toast('Could not sync data. Please refresh the page.', 'error');
  }
}

function populateStudentSearch() {
  const dl = document.getElementById('student-datalist');
  if (dl) dl.innerHTML = S.students
    .map(s => `<option data-id="${esc(s.id)}" value="${esc(s.fullName)} (${esc(s.email)})">`)
    .join('');
}

function captureSelectedStudent() {
  const val = document.getElementById('e-search-input').value;
  // Match by iterating instead of querySelector — avoids CSS-selector
  // injection / syntax errors when names contain quotes or special chars.
  const options = document.querySelectorAll('#student-datalist option');
  let matchedId = '';
  for (const opt of options) {
    if (opt.value === val) { matchedId = opt.getAttribute('data-id'); break; }
  }
  document.getElementById('e-selected-student-id').value = matchedId;
}

/* ─────────────────────────────────────────────
   §09 · STATE INDEXES & GETTERS
   buildIndexes() + O(1) getCourse/getStudent/getEnrollmentPaid.
───────────────────────────────────────────── */
let _coursesById  = new Map();
let _studentsById = new Map();
let _paidByEnKey  = new Map(); // key: `${studentId}|${courseId}` → total paid

function buildIndexes() {
  _coursesById  = new Map(S.courses.map(c => [String(c.id), c]));
  _studentsById = new Map(S.students.map(s => [String(s.id), s]));
  _paidByEnKey  = new Map();
  for (const p of S.payments) {
    const key = `${p.studentId}|${p.courseId}`;
    _paidByEnKey.set(key, (_paidByEnKey.get(key) || 0) + Number(p.amount || 0));
  }
}

const getCourse  = id => _coursesById.get(String(id))  || S.courses.find(c => c.id == id);
const getStudent = id => _studentsById.get(String(id)) || S.students.find(s => s.id == id);
const getEnrollmentPaid = (studentId, courseId) =>
  _paidByEnKey.get(`${studentId}|${courseId}`) || 0;

/* ─────────────────────────────────────────────
   §10 · MODAL SYSTEM
   openM/closeM + per-modal setup functions + focus management.
───────────────────────────────────────────── */
// Track which element triggered the modal, so we can return focus on close
let _modalTrigger = null;

function openM(id, editId = null, extraParam = null) {
  _modalTrigger = document.activeElement;
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
  const target = document.getElementById(id);
  if (!target) return;
  target.classList.add('active');
  document.getElementById('modalOverlay').classList.add('open');

  // Focus first input
  setTimeout(() => {
    const first = target.querySelector('input:not([type=hidden]), select');
    if (first) first.focus();
  }, 100);

  try {
    if (id === 'mCourse')      _setupCourseModal(editId);
    if (id === 'mStudentEdit') _setupStudentEditModal(editId);
    if (id === 'mEnrollment')  _setupEnrollmentModal(editId);
    if (id === 'mPayment')     _setupPaymentModal(extraParam);
  } catch (err) { console.error('[openM]', err); }
}

function closeM() {
  document.getElementById('modalOverlay').classList.remove('open');
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
  // Return focus to the element that opened the modal
  if (_modalTrigger && typeof _modalTrigger.focus === 'function') {
    setTimeout(() => { _modalTrigger.focus(); _modalTrigger = null; }, 50);
  }
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById('modalOverlay')) closeM();
}

/* ── §10.1 Modal setup helpers (one per modal) ── */
function _setupCourseModal(editId) {
  const stSelect = document.getElementById('c-status');
  if (stSelect) stSelect.innerHTML = (S.generalStatus || [])
    .filter(s => s.entity === 'course')
    .map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`)
    .join('');

  if (editId) {
    editCourseId = editId;
    const c = getCourse(editId) || {};
    document.getElementById('modal-title-course-text').textContent = 'Edit Course';
    document.getElementById('modal-subtitle-course').textContent   = 'Update the course details below.';
    document.getElementById('btn-save-course').textContent         = 'Update';
    document.getElementById('btn-delete-course').style.display     = 'inline-flex';
    document.getElementById('c-name').value      = c.name      || '';
    document.getElementById('c-start').value     = c.startDate || '';
    document.getElementById('c-end').value       = c.endDate   || '';
    document.getElementById('c-feeNormal').value = c.feeNormal || '';
    document.getElementById('c-feeEarly').value  = c.feeEarly  || '';
    document.getElementById('c-capacity').value  = c.capacity  || '';
    if (stSelect) stSelect.value = c.status || '';
  } else {
    editCourseId = null;
    document.getElementById('modal-title-course-text').textContent = 'New Course';
    document.getElementById('modal-subtitle-course').textContent   = 'Fill in the course details below.';
    document.getElementById('btn-save-course').textContent         = 'Create';
    document.getElementById('btn-delete-course').style.display     = 'none';
    ['c-name','c-start','c-end','c-feeNormal','c-feeEarly','c-capacity']
      .forEach(x => { const el = document.getElementById(x); if (el) el.value = ''; });
    if (stSelect && S.generalStatus.length > 0) stSelect.value = S.generalStatus[0].id;
  }
}

function _setupStudentEditModal(editId) {
  if (editId) {
    editStudentIdentityId = editId;
    const s = getStudent(editId) || {};
    document.getElementById('modal-title-student-text').textContent = 'Edit Student Profile';
    document.getElementById('btn-delete-st').style.display          = 'inline-flex';
    document.getElementById('se-fullname').value = s.fullName || '';
    document.getElementById('se-email').value    = s.email    || '';
    document.getElementById('se-phone').value    = s.phone    || '';
  } else {
    editStudentIdentityId = null;
    document.getElementById('modal-title-student-text').textContent = 'Add New Student';
    document.getElementById('btn-delete-st').style.display          = 'none';
    ['se-fullname','se-email','se-phone'].forEach(x => { const el = document.getElementById(x); if (el) el.value = ''; });
  }
}

function _setupEnrollmentModal(editId) {
  document.getElementById('e-course').innerHTML =
    '<option value="">Select course…</option>' +
    S.courses.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  document.getElementById('e-search-input').value        = '';
  document.getElementById('e-selected-student-id').value = '';

  if (editId) {
    editEnrollmentId = editId;
    const en = S.enrollments.find(e => e.id == editId) || {};
    document.getElementById('modal-title-enrollment-text').textContent    = 'Edit Enrollment';
    document.getElementById('modal-subtitle-enrollment').textContent      = 'Update the enrollment and payment plan.';
    document.getElementById('btn-save-enrollment').textContent            = 'Update';
    document.getElementById('btn-save-enrollment').disabled               = false;
    document.getElementById('btn-delete-enrollment').style.display        = 'inline-flex';
    document.getElementById('e-type-box').style.display     = 'none';
    document.getElementById('e-existing-box').style.display = 'none';
    document.getElementById('e-new-box').style.display      = 'none';
    document.getElementById('e-course').value               = en.courseId      || '';
    document.getElementById('e-course').disabled            = true;
    document.getElementById('e-priceType').value            = en.priceType     || 'normal';
    document.getElementById('e-depositAmount').value        = en.depositAmount || '';
    document.getElementById('e-depositDate').value          = en.depositDate   || '';
    document.getElementById('e-payType').value              = en.paymentType   || 'full_remaining';
    document.getElementById('e-fullPayDate').value          = en.fullPayDate   || '';
    document.getElementById('e-displayTotal').value         = en.totalFee ? fmt(en.totalFee) : '';
    toggleInstalmentFields();
    if (en.paymentType === 'instalment') {
      try {
        const plan = JSON.parse(en.instalmentPlan);
        document.getElementById('e-numInstalments').value = plan.length;
        updateInstalments();
        const amounts = document.querySelectorAll('.inst-amount');
        const dates   = document.querySelectorAll('.inst-date');
        plan.forEach((inst, i) => {
          if (amounts[i]) amounts[i].value = inst.amount;
          if (dates[i])   dates[i].value   = inst.date;
        });
      } catch { console.warn('Could not parse instalment plan'); }
    }
  } else {
    editEnrollmentId = null;
    document.getElementById('modal-title-enrollment-text').textContent = 'Enroll Student';
    document.getElementById('modal-subtitle-enrollment').textContent   = 'Select a course and configure the payment plan.';
    document.getElementById('btn-save-enrollment').textContent         = 'Save';
    document.getElementById('btn-save-enrollment').disabled            = false;
    document.getElementById('btn-delete-enrollment').style.display     = 'none';
    document.getElementById('e-type-box').style.display  = 'block';
    document.getElementById('e-course').disabled         = false;
    ['e-course','e-fullname','e-email','e-phone','e-depositAmount','e-depositDate','e-numInstalments','e-fullPayDate']
      .forEach(x => { const el = document.getElementById(x); if (el) el.value = ''; });
    document.getElementById('e-priceType').value    = 'normal';
    document.getElementById('e-payType').value      = 'full_remaining';
    document.getElementById('e-displayTotal').value = '';
    document.getElementById('eTypeValue').value     = 'existing';
    setStudentMode('existing');
    toggleInstalmentFields();
  }
}

function _setupPaymentModal(extraParam) {
  document.getElementById('p-student').innerHTML =
    '<option value="">Select student…</option>' +
    S.students.map(s => `<option value="${esc(s.id)}">${esc(s.fullName)}</option>`).join('');
  document.getElementById('p-date').value    = today();
  document.getElementById('p-amount').value  = '';
  document.getElementById('p-note').value    = '';
  document.getElementById('smart-suggestion').style.display = 'none';
  document.getElementById('p-course-box').style.display     = 'none';
  document.getElementById('btn-save-payment').disabled      = true;

  if (extraParam) {
    const en = S.enrollments.find(e => e.id == extraParam);
    if (en) {
      document.getElementById('p-student').value = en.studentId;
      loadStudentCourses();
      const courseSelect = document.getElementById('p-course');
      if (courseSelect) { courseSelect.value = en.courseId; _onPaymentCourseReady(); }
    }
  }
}

/* ─────────────────────────────────────────────
   §11 · NAVIGATION
   goTab() — tab switching + scroll reset.
───────────────────────────────────────────── */
function goTab(name) {
  const names = ['dashboard', 'courses', 'students', 'enrollments', 'payments'];
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', names[i] === name));
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
  document.getElementById('sec-' + name).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ─────────────────────────────────────────────
   §12 · RENDER — LISTS
   renderStats/Dash/Courses/Students/Enrollments/Payments.
───────────────────────────────────────────── */
function render() { renderStats(); renderReport(); renderDash(); renderCourses(); renderStudents(); renderEnrollments(); renderPayments(); }

function renderStats() {
  const collected   = S.payments.reduce((a, p) => a + Number(p.amount || 0), 0);
  const outstanding = S.enrollments.reduce(
    (a, en) => a + Math.max(0, Number(en.totalFee || 0) - getEnrollmentPaid(en.studentId, en.courseId)), 0
  );
  const overdue = S.enrollments.reduce((a, en) => a + getOverdueInfo(en).amount, 0);
  document.getElementById('st-courses').textContent     = S.courses.length;
  document.getElementById('st-students').textContent    = S.students.length;
  document.getElementById('st-collected').textContent   = fmt(collected);
  document.getElementById('st-outstanding').textContent = fmt(outstanding);
  const odEl = document.getElementById('st-overdue');
  if (odEl) odEl.textContent = fmt(overdue);
}

function renderDash() {
  const box = document.getElementById('dashContent');
  if (!S.courses.length) { box.innerHTML = '<div class="empty"><i class="ti ti-books"></i>No courses yet.</div>'; return; }
  box.innerHTML = S.courses.map(c => {
    const enrolls   = S.enrollments.filter(e => e.courseId == c.id);
    const totalDue  = enrolls.reduce((a, e) => a + Number(e.totalFee || 0), 0);
    const totalPaid = enrolls.reduce((a, e) => a + getEnrollmentPaid(e.studentId, c.id), 0);
    const pct       = totalDue > 0 ? Math.round(totalPaid / totalDue * 100) : 0;
    const barCls    = pct >= 100 ? '' : pct < 50 ? 'danger' : 'warn';
    return `<div class="card">
      <div class="card-hd"><div><b>${esc(c.name)}</b><br><small>${enrolls.length} student(s) enrolled</small></div>${getStatusBadge(c.status)}</div>
      <div class="bar-bg"><div class="bar-fill ${barCls}" style="width:${Math.min(100,pct)}%"></div></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--color-text-secondary);margin-top:6px">
        <span>${fmt(totalPaid)} Paid</span><span>${fmt(totalDue - totalPaid)} Remaining</span>
      </div>
    </div>`;
  }).join('');
}

function renderCourses() {
  const box = document.getElementById('courseList');
  if (!S.courses.length) { box.innerHTML = '<div class="empty"><i class="ti ti-books"></i>No courses yet.</div>'; return; }
  box.innerHTML = S.courses.map(c => {
    const count = S.enrollments.filter(e => e.courseId == c.id).length;
    const isFull  = c.capacity > 0 && count >= Number(c.capacity);
    return `<div class="card">
      <div class="card-hd">
        <div><b>${esc(c.name)}</b><br><small>${esc(formatDate(c.startDate))} to ${esc(formatDate(c.endDate))}</small></div>
        <div style="display:flex;gap:6px;align-items:center">
          ${getStatusBadge(c.status)}
          <span class="chip ${isFull ? 'red' : 'blue'}">${count}${c.capacity ? '/' + esc(c.capacity) : ''} Students${isFull ? ' · Full' : ''}</span>
          <button class="btn ghost sm" onclick="openM('mCourse','${esc(c.id)}')"><i class="ti ti-edit"></i></button>
        </div>
      </div>
      <div class="meta-row">
        <span><i class="ti ti-tag"></i> Normal: ${fmt(c.feeNormal)}</span>
        <span><i class="ti ti-discount-check" style="color:var(--color-brand)"></i> Early Bird: ${fmt(c.feeEarly)}</span>
      </div>
    </div>`;
  }).join('');
}

let _searchTimer = null;
function onStudentSearchInput() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(renderStudents, CONSTANTS.SEARCH_DEBOUNCE_MS || 200);
}

function renderStudents() {
  const box     = document.getElementById('studentDBList');
  const input   = document.getElementById('s-search');
  const term    = input ? input.value.toLowerCase() : '';
  const avCls   = ['av-t', 'av-b', 'av-a'];
  const filtered = S.students
    .filter(s => s && s.fullName && s.email)
    .filter(s => s.fullName.toLowerCase().includes(term) || s.email.toLowerCase().includes(term));

  if (!filtered.length) { box.innerHTML = '<div class="empty"><i class="ti ti-users"></i>No students found.</div>'; return; }
  box.innerHTML = `<div class="card" style="padding:4px 16px">${filtered.map((s, i) => {
    const count    = S.enrollments.filter(e => e.studentId == s.id).length;
    const initials = s.fullName.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase();
    return `<div class="student-row clickable" onclick="showStudentDetail('${esc(s.id)}')">
      <div class="avatar ${avCls[i % 3]}">${esc(initials)}</div>
      <div class="student-info">
        <div class="student-name">${esc(s.fullName)}</div>
        <div class="student-sub">${esc(s.email)}${s.phone ? ' · ' + esc(s.phone) : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:12px;color:var(--color-text-secondary)">${count} course(s)</span>
        <button class="btn ghost sm" onclick="event.stopPropagation();openM('mStudentEdit','${esc(s.id)}')"><i class="ti ti-edit"></i></button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

let _enrollmentFilter = 'active'; // 'active' | 'archived' | 'all'

function setEnrollmentFilter(filter) {
  _enrollmentFilter = filter;
  document.querySelectorAll('.enroll-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
  renderEnrollments();
}

function renderEnrollments() {
  const box   = document.getElementById('enrollmentList');
  const avCls = ['av-t', 'av-b', 'av-a'];
  if (!S.enrollments.length) { box.innerHTML = '<div class="empty"><i class="ti ti-list"></i>No enrollments yet.</div>'; return; }

  // Filter by course status
  const filtered = S.enrollments.filter(en => {
    const course = getCourse(en.courseId);
    const status = (S.generalStatus || []).find(s => s.id == (course && course.status));
    const code   = status ? status.code : '';
    if (_enrollmentFilter === 'active')   return code !== 'completed' && code !== 'cancelled';
    if (_enrollmentFilter === 'archived') return code === 'completed' || code === 'cancelled';
    return true; // 'all'
  });
  if (!filtered.length) { box.innerHTML = '<div class="empty"><i class="ti ti-list"></i>No enrollments match this filter.</div>'; return; }
  box.innerHTML = `<div class="card" style="padding:4px 16px">${filtered.map((en, i) => {
    const s = getStudent(en.studentId);
    if (!s) return '';
    const paid    = getEnrollmentPaid(en.studentId, en.courseId);
    const total   = Number(en.totalFee || 0);
    const pct     = total > 0 ? Math.round(paid / total * 100) : 100;
    const barCls  = pct >= 100 ? '' : pct < 50 ? 'danger' : 'warn';
    const initials = s.fullName.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const course  = getCourse(en.courseId);
    const od      = getOverdueInfo(en);
    const odBadge = od.overdue
      ? `<span class="chip red" style="font-size:9px;margin-left:6px" title="Overdue ${esc(fmt(od.amount))}"><i class="ti ti-alert-triangle"></i> Overdue</span>`
      : '';
    return `<div class="student-row clickable ${od.overdue ? 'row-overdue' : ''}" onclick="showEnrollmentDetail('${esc(en.id)}')">
      <div class="avatar ${avCls[i % 3]}">${esc(initials)}</div>
      <div class="student-info">
        <div class="student-name">${esc(s.fullName)}${odBadge}</div>
        <div class="student-sub">${course ? esc(course.name) : '—'} · <span style="color:${en.priceType === 'early_bird' ? 'var(--color-brand)' : 'inherit'}">${en.priceType === 'early_bird' ? 'Early Bird' : 'Normal'}</span></div>
      </div>
      <div class="pay-summary">
        <div class="pay-amount ${pct >= 100 ? 'g' : pct < 50 ? 'r' : 'a'}">${fmt(paid)} / ${fmt(total)}</div>
        <div class="pay-label">Total Fee</div>
        <div class="bar-bg"><div class="bar-fill ${barCls}" style="width:${Math.min(100,pct)}%"></div></div>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function renderPayments() {
  const box = document.getElementById('paymentList');
  if (!S.payments.length) { box.innerHTML = '<div class="empty"><i class="ti ti-coin"></i>No payments recorded yet.</div>'; return; }
  const sorted = [...S.payments].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  box.innerHTML = `<div class="card" style="padding:4px 16px">${sorted.map(p => {
    const s   = getStudent(p.studentId);
    const c   = getCourse(p.courseId);
    const clr = p.type === 'deposit' ? 'amber' : p.type === 'full' ? 'teal' : 'blue';
    return `<div class="payment-entry">
      <div>
        <span style="font-weight:600">${s ? esc(s.fullName) : '—'}</span>
        <span class="chip ${clr}" style="margin-left:8px;font-size:10px">${esc(p.type)}</span>
        <div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px">${c ? esc(c.name) : 'Unknown'}${p.note ? ' · ' + esc(p.note) : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-weight:600;color:var(--color-brand);font-size:14px">+${fmt(p.amount)}</span>
        <span style="font-size:12px;color:var(--color-text-secondary)">${esc(formatDate(p.date))}</span>
        <button class="btn ghost sm" style="color:#ef4444" onclick="confirmDeletePayment('${esc(p.id)}')" title="Delete payment"><i class="ti ti-trash"></i></button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

/* ─────────────────────────────────────────────
   §13 · RENDER — STUDENT DETAIL
   showStudentDetail() modal with all enrollments.
───────────────────────────────────────────── */
function showStudentDetail(sId) {
  const s = getStudent(sId);
  if (!s) return;
  const enrollments = S.enrollments.filter(e => e.studentId == sId);
  const totalPaid   = S.payments.filter(p => p.studentId == sId).reduce((a, p) => a + Number(p.amount || 0), 0);
  const totalDue    = enrollments.reduce((a, en) => a + Number(en.totalFee || 0), 0);
  const initials    = s.fullName.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase();

  const enrollHtml = enrollments.length
    ? enrollments.map(en => {
        const course = getCourse(en.courseId);
        const paid   = getEnrollmentPaid(sId, en.courseId);
        const total  = Number(en.totalFee || 0);
        const pct    = total > 0 ? Math.round(paid / total * 100) : 100;
        const barCls = pct >= 100 ? '' : pct < 50 ? 'danger' : 'warn';
        let planSummary = en.paymentType === 'instalment' ? 'Instalment' : 'Full payment';
        if (en.paymentType === 'instalment' && en.instalmentPlan) {
          try { planSummary = JSON.parse(en.instalmentPlan).length + 'x instalment'; }
          catch { planSummary = 'Instalment (plan unavailable)'; }
        }
        return `<div style="padding:10px 0;border-bottom:1px solid var(--color-border-tertiary)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <span style="font-weight:600;font-size:13px">${course ? esc(course.name) : '—'}</span>
            <span class="chip ${pct>=100?'teal':pct<50?'red':'amber'}" style="font-size:10px">${pct}%</span>
          </div>
          <div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px">
            ${en.priceType === 'early_bird' ? 'Early Bird' : 'Normal'} · ${esc(planSummary)}
          </div>
          <div class="bar-bg"><div class="bar-fill ${barCls}" style="width:${Math.min(100,pct)}%"></div></div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--color-text-secondary);margin-top:4px">
            <span>${fmt(paid)} paid</span><span>${fmt(Math.max(0, total - paid))} remaining</span>
          </div>
          <div style="margin-top:8px;display:flex;gap:6px">
            <button class="btn sm" onclick="showEnrollmentDetail('${esc(en.id)}')"><i class="ti ti-eye"></i> Detail</button>
            <button class="btn sm primary" onclick="openM('mPayment',null,'${esc(en.id)}')"><i class="ti ti-plus"></i> Payment</button>
          </div>
        </div>`;
      }).join('')
    : '<div style="font-size:13px;color:var(--color-text-secondary);padding:10px 0">Not enrolled in any course.</div>';

  document.getElementById('sd-title').innerHTML = `
    <div style="display:flex;align-items:center;gap:12px">
      <div class="avatar av-t" style="width:40px;height:40px;font-size:15px">${esc(initials)}</div>
      <div><div>${esc(s.fullName)}</div></div>
    </div>`;

  let sdSub = document.getElementById('sd-subtitle');
  if (!sdSub) {
    sdSub = document.createElement('p');
    sdSub.id = 'sd-subtitle'; sdSub.className = 'modal-subtitle';
    document.getElementById('sd-title').insertAdjacentElement('afterend', sdSub);
  }
  sdSub.textContent = s.email + (s.phone ? ' · ' + s.phone : '');

  document.getElementById('sd-body').innerHTML = `
    <div class="stats-grid" style="margin-bottom:16px">
      <div class="stat"><div class="lbl">Courses</div><div class="val b">${enrollments.length}</div></div>
      <div class="stat"><div class="lbl">Total paid</div><div class="val g">${fmt(totalPaid)}</div></div>
      <div class="stat"><div class="lbl">Outstanding</div><div class="val ${totalDue - totalPaid > 0 ? 'a' : 'g'}">${fmt(Math.max(0, totalDue - totalPaid))}</div></div>
    </div>
    <div style="font-size:14px;font-weight:600;margin-bottom:8px">Enrollments</div>
    ${enrollHtml}`;

  document.getElementById('sd-footer').innerHTML = `
    <button class="btn" onclick="closeM()">Close</button>
    <button class="btn" onclick="openM('mStudentEdit','${esc(s.id)}')"><i class="ti ti-edit"></i> Edit Profile</button>`;

  document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
  document.getElementById('mStudentDetail').classList.add('active');
  document.getElementById('modalOverlay').classList.add('open');
}

/* ─────────────────────────────────────────────
   §14 · RENDER — ENROLLMENT DETAIL
   showEnrollmentDetail() modal with payment history.
───────────────────────────────────────────── */
function showEnrollmentDetail(enId) {
  const en = S.enrollments.find(x => x.id == enId);
  if (!en) return;
  const s      = getStudent(en.studentId);
  const course = getCourse(en.courseId);
  const paid   = getEnrollmentPaid(en.studentId, en.courseId);
  const rem    = Number(en.totalFee || 0) - paid;
  const payments = S.payments
    .filter(p => p.studentId == en.studentId && p.courseId == en.courseId)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  let planHtml = '';
  if (en.paymentType === 'instalment' && en.instalmentPlan) {
    try {
      const plan = JSON.parse(en.instalmentPlan);
      planHtml = `<div style="margin-top:12px;padding:10px;background:#fff;border:1px solid var(--color-border-secondary);border-radius:6px">
        <strong style="display:block;margin-bottom:6px">Instalment Schedule</strong>` +
        plan.map((inst, i) =>
          `<div style="display:flex;justify-content:space-between;font-size:12px;border-bottom:1px solid var(--color-border-tertiary);padding:4px 0">
            <span>Instalment ${i + 1}</span><span>${fmt(inst.amount)} — Due: ${esc(formatDate(inst.date))}</span>
          </div>`
        ).join('') + '</div>';
    } catch {
      planHtml = '<div style="font-size:12px;color:#ef4444;margin-top:8px;padding:8px;background:#fef2f2;border-radius:6px"><i class="ti ti-alert-circle"></i> Instalment plan could not be loaded.</div>';
    }
  }

  document.getElementById('ed-title').innerHTML = s ? esc(s.fullName) : 'Enrollment Detail';

  let edSub = document.getElementById('ed-subtitle');
  if (!edSub) {
    edSub = document.createElement('p');
    edSub.id = 'ed-subtitle'; edSub.className = 'modal-subtitle';
    document.getElementById('ed-title').insertAdjacentElement('afterend', edSub);
  }
  edSub.textContent = (course ? course.name : '') + ' · ' + (en.priceType === 'early_bird' ? 'Early Bird' : 'Normal');

  document.getElementById('ed-body').innerHTML = `
    <div class="detail-panel">
      <div class="detail-grid">
        <span class="dk">Student</span><span class="dv">${s ? esc(s.fullName) : '—'}</span>
        <span class="dk">Course</span><span class="dv">${course ? esc(course.name) : '—'}</span>
        <span class="dk">Course price type</span>
        <span class="dv" style="color:${en.priceType==='early_bird'?'var(--color-brand)':'inherit'}">
          ${en.priceType === 'early_bird' ? 'Early Bird' : 'Normal'}
        </span>
        <span class="dk">Deposit due</span><span class="dv">${esc(formatDate(en.depositDate))} (${fmt(en.depositAmount)})</span>
        ${en.paymentType !== 'instalment' && en.fullPayDate
          ? `<span class="dk">Payment due</span><span class="dv">${esc(formatDate(en.fullPayDate))}</span>`
          : ''}
      </div>
      ${planHtml}
    </div>
    <div class="stats-grid" style="margin-bottom:16px">
      <div class="stat"><div class="lbl">Total Fee</div><div class="val b">${fmt(en.totalFee)}</div></div>
      <div class="stat"><div class="lbl">Paid</div><div class="val g">${fmt(paid)}</div></div>
      <div class="stat"><div class="lbl">Remaining</div><div class="val ${rem > 0 ? 'r' : 'g'}">${fmt(rem)}</div></div>
    </div>
    <div style="font-size:14px;font-weight:600;margin-bottom:12px">Payment History</div>
    ${payments.length
      ? `<div class="card" style="padding:4px 16px">${payments.map(p => `
          <div class="payment-entry">
            <div>
              <span style="font-weight:600;font-size:14px">${fmt(p.amount)}</span>
              <span class="chip ${p.type==='deposit'?'amber':p.type==='full'?'teal':'blue'}" style="margin-left:8px;font-size:10px">${esc(p.type)}</span>
              ${p.note ? `<span style="font-size:11px;color:var(--color-text-secondary);margin-left:6px">${esc(p.note)}</span>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:12px;color:var(--color-text-secondary)">${esc(formatDate(p.date))}</span>
              <button class="btn ghost sm" style="color:#ef4444" onclick="confirmDeletePayment('${esc(p.id)}','${esc(enId)}')" title="Delete"><i class="ti ti-trash"></i></button>
            </div>
          </div>`).join('')}</div>`
      : '<div style="font-size:13px;color:var(--color-text-secondary);padding:10px;text-align:center;background:#f9fafb;border-radius:8px">No payments recorded.</div>'
    }`;

  document.getElementById('ed-footer').innerHTML = `
    <button class="danger-btn" onclick="deleteEnrollmentFromDetail('${esc(en.id)}')"><i class="ti ti-trash"></i> Delete</button>
    <div style="display:flex;gap:8px">
      <button class="btn" onclick="closeM()">Close</button>
      <button class="btn" onclick="openM('mEnrollment','${esc(en.id)}')"><i class="ti ti-edit"></i> Edit</button>
      <button class="btn primary" onclick="openM('mPayment',null,'${esc(en.id)}')"><i class="ti ti-plus"></i> Add Payment</button>
    </div>`;
  document.getElementById('ed-footer').style.justifyContent = 'space-between';

  document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
  document.getElementById('mEnrollmentDetail').classList.add('active');
  document.getElementById('modalOverlay').classList.add('open');
}

/* ─────────────────────────────────────────────
   §15 · FORM HELPERS
   student mode toggle, instalment builder, payment suggestion.
───────────────────────────────────────────── */
function setStudentMode(mode) {
  document.getElementById('eTypeValue').value = mode;
  document.getElementById('toggle-existing').classList.toggle('active', mode === 'existing');
  document.getElementById('toggle-new').classList.toggle('active', mode === 'new');
  document.getElementById('e-existing-box').style.display = mode === 'existing' ? 'block' : 'none';
  document.getElementById('e-new-box').style.display      = mode === 'new'      ? 'block' : 'none';
}

function toggleStudentMode() {
  setStudentMode(document.getElementById('eTypeValue').value || 'existing');
}

function loadStudentCourses() {
  const sId     = document.getElementById('p-student').value;
  const cBox    = document.getElementById('p-course-box');
  const cSelect = document.getElementById('p-course');
  document.getElementById('btn-save-payment').disabled = true;
  if (!sId) { cBox.style.display = 'none'; return; }
  const enrolls = S.enrollments.filter(e => e.studentId == sId);
  cSelect.innerHTML = '<option value="">Select course…</option>' +
    enrolls.map(en => `<option value="${esc(en.courseId)}">${esc(getCourse(en.courseId)?.name || en.courseId)}</option>`).join('');
  cBox.style.display = 'block';
  if (enrolls.length === 1) { cSelect.value = enrolls[0].courseId; _onPaymentCourseReady(); }
}

function _onPaymentCourseReady() {
  calculatePaymentSuggestion();
  const cId = document.getElementById('p-course').value;
  const sId = document.getElementById('p-student').value;
  document.getElementById('btn-save-payment').disabled = !(sId && cId);
}

function toggleInstalmentFields() {
  const isInstalment = document.getElementById('e-payType').value === 'instalment';
  document.getElementById('instalment-container').style.display  = isInstalment ? 'block' : 'none';
  document.getElementById('full-payment-date-box').style.display = isInstalment ? 'none'  : 'block';
  updateInstalments();
}

function updateInstalments() {
  const cId      = document.getElementById('e-course').value;
  const course   = S.courses.find(c => c.id == cId);
  const totalFee = course
    ? (document.getElementById('e-priceType').value === 'early_bird' ? course.feeEarly : course.feeNormal)
    : 0;
  document.getElementById('e-displayTotal').value = totalFee ? fmt(totalFee) : '';
  // Capacity warning
  const capWarn = document.getElementById('e-capacity-warn');
  if (capWarn) {
    const enrolled = S.enrollments.filter(e => e.courseId == cId).length;
    const cap      = Number(course && course.capacity);
    // Only block for NEW enrollments (editEnrollmentId is null);
    // editing an existing enrollment in a full course is fine.
    const isFull   = cap > 0 && enrolled >= cap && !editEnrollmentId;
    if (isFull) {
      capWarn.style.display = 'block';
      capWarn.textContent   = 'This course is full (' + enrolled + '/' + cap + ' students enrolled).';
    } else {
      capWarn.style.display = 'none';
    }
    const saveBtn = document.getElementById('btn-save-enrollment');
    if (saveBtn) saveBtn.disabled = isFull;
  }

  const container = document.getElementById('dynamic-instalments');
  container.innerHTML = '';
  if (document.getElementById('e-payType').value !== 'instalment') return;
  const num     = parseInt(document.getElementById('e-numInstalments').value) || 0;
  const deposit = parseFee(document.getElementById('e-depositAmount').value);
  const amounts = splitInstalments(totalFee, deposit, num);
  for (let i = 0; i < amounts.length; i++) {
    container.innerHTML += `<div class="form-2col dynamic-row">
        <div class="fg"><label>Instalment ${i + 1} (€)</label><input type="number" class="inst-amount" value="${amounts[i].toFixed(2)}"></div>
        <div class="fg"><label>Date</label><input type="date" class="inst-date"></div>
      </div>`;
  }
}

function calculatePaymentSuggestion() {
  const sId     = document.getElementById('p-student').value;
  const cId     = document.getElementById('p-course').value;
  const suggBox = document.getElementById('smart-suggestion');
  suggBox.classList.remove('success');
  document.getElementById('btn-save-payment').disabled = !(sId && cId);
  if (!sId || !cId) { suggBox.style.display = 'none'; return; }
  const en = S.enrollments.find(x => x.studentId == sId && x.courseId == cId);
  if (!en) { suggBox.style.display = 'none'; return; }
  const paid = getEnrollmentPaid(sId, cId);
  const sug  = suggestNextPayment(en, paid);
  if (sug.fullyPaid) {
    suggBox.style.display = 'block'; suggBox.classList.add('success');
    document.getElementById('ss-title').innerHTML = '<i class="ti ti-circle-check"></i> Fully Paid!';
    document.getElementById('ss-desc').innerHTML  = 'No outstanding balance.';
    document.getElementById('p-amount').value     = 0;
    document.getElementById('p-type').value       = 'other'; return;
  }
  let nText;
  if (sug.type === 'deposit')         nText = `Expected Deposit: <b>${fmt(sug.amount)}</b>`;
  else if (sug.type === 'instalment') nText = `Next due: <b>Instalment ${sug.instalmentIndex + 1}</b> (${fmt(sug.amount)})`;
  else                                nText = `Remaining Balance: <b>${fmt(sug.remaining)}</b>`;
  suggBox.style.display = 'block';
  document.getElementById('ss-title').innerHTML = '<i class="ti ti-bulb"></i> Suggested';
  document.getElementById('ss-desc').innerHTML  = nText;
  document.getElementById('p-amount').value     = Number(sug.amount || 0).toFixed(2);
  document.getElementById('p-type').value       = sug.type;
}

/* ─────────────────────────────────────────────
   §16 · CSV EXPORT
   Client-side CSV download for enrollments and payments.
───────────────────────────────────────────── */
function _csvCell(val) {
  const s = String(val === null || val === undefined ? '' : val);
  // Escape quotes, wrap if contains comma/quote/newline
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function _downloadCSV(filename, rows) {
  const csv  = rows.map(r => r.map(_csvCell).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportEnrollmentsCSV() {
  if (!S.enrollments.length) return toast('No enrollments to export.', 'warn');
  const rows = [['Student', 'Email', 'Course', 'Price Type', 'Total Fee', 'Paid', 'Remaining', 'Payment Type', 'Deposit Due', 'Overdue']];
  S.enrollments.forEach(en => {
    const s = getStudent(en.studentId);
    const c = getCourse(en.courseId);
    const paid = getEnrollmentPaid(en.studentId, en.courseId);
    const total = Number(en.totalFee || 0);
    const od = getOverdueInfo(en);
    rows.push([
      s ? s.fullName : '—', s ? s.email : '',
      c ? c.name : '—',
      en.priceType === 'early_bird' ? 'Early Bird' : 'Normal',
      total.toFixed(2), paid.toFixed(2), Math.max(0, total - paid).toFixed(2),
      en.paymentType === 'instalment' ? 'Instalment' : 'Full',
      en.depositDate || '', od.overdue ? od.amount.toFixed(2) : '0.00'
    ]);
  });
  _downloadCSV(`enrollments_${today()}.csv`, rows);
  toast('Enrollments exported.', 'success');
}

function exportPaymentsCSV() {
  if (!S.payments.length) return toast('No payments to export.', 'warn');
  const rows = [['Date', 'Student', 'Course', 'Amount', 'Type', 'Note']];
  [...S.payments]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .forEach(p => {
      const s = getStudent(p.studentId);
      const c = getCourse(p.courseId);
      rows.push([
        p.date || '', s ? s.fullName : '—', c ? c.name : '—',
        Number(p.amount || 0).toFixed(2), p.type || '', p.note || ''
      ]);
    });
  _downloadCSV(`payments_${today()}.csv`, rows);
  toast('Payments exported.', 'success');
}

/* ─────────────────────────────────────────────
   §17 · CRUD — DELETE
   deleteRecord, deleteEnrollmentFromDetail, confirmDeletePayment.
───────────────────────────────────────────── */
async function deleteRecord(type) {
  let id, modalId, warningMsg, confirmMsg, backendAction;

  if (type === 'course') {
    id = editCourseId; if (!id) return toast('No course selected.', 'warn');
    if (S.enrollments.some(e => e.courseId == id))
      return toast('Cannot delete: This course has active enrollments.', 'error');
    modalId = 'mCourse'; backendAction = 'deleteCourse';
    confirmMsg = 'Are you sure you want to permanently delete this course?';
  } else if (type === 'student') {
    id = editStudentIdentityId; if (!id) return toast('No student selected.', 'warn');
    if (S.enrollments.some(e => e.studentId == id))
      return toast('Cannot delete: This student has active enrollments. Delete enrollments first.', 'error');
    modalId = 'mStudentEdit'; backendAction = 'deleteStudent';
    confirmMsg = 'Are you sure you want to permanently delete this student?';
  } else if (type === 'enrollment') {
    id = editEnrollmentId; if (!id) return toast('No enrollment selected.', 'warn');
    const en = S.enrollments.find(e => e.id == id);
    if (en && S.payments.some(p => p.studentId == en.studentId && p.courseId == en.courseId))
      return toast('Cannot delete: There are payments recorded for this enrollment.', 'error');
    modalId = 'mEnrollment'; backendAction = 'deleteEnrollment';
    confirmMsg = 'Are you sure you want to delete this enrollment?';
  } else return;

  const confirmed = await confirmDialog(confirmMsg, 'Delete', true);
  if (!confirmed) return;

  const data = await apiFetch({ action: backendAction, payload: { id }, currentUser: getUsername() });
  if (data === null) return; // unauthorized, already handled
  if (data && !data.success) return toast(data.error || 'Delete failed.', 'error');
  closeM();
  toast('Deleted successfully.', 'success');
  await syncSheets();
}

async function deleteEnrollmentFromDetail(enrollmentId) {
  const en = S.enrollments.find(e => e.id == enrollmentId);
  if (!en) return toast('Enrollment not found.', 'error');
  if (S.payments.some(p => p.studentId == en.studentId && p.courseId == en.courseId))
    return toast('Cannot delete: There are payments recorded for this enrollment.', 'error');
  const confirmed = await confirmDialog('Are you sure you want to delete this enrollment?', 'Delete', true);
  if (!confirmed) return;
  const data = await apiFetch({ action: 'deleteEnrollment', payload: { id: enrollmentId }, currentUser: getUsername() });
  if (data === null) return;
  if (data && !data.success) return toast(data.error || 'Delete failed.', 'error');
  toast('Enrollment deleted.', 'success');
  closeM();
  await syncSheets();
}

async function confirmDeletePayment(paymentId, returnToEnrollmentId = null) {
  const confirmed = await confirmDialog('Are you sure you want to delete this payment? This cannot be undone.', 'Delete', true);
  if (!confirmed) return;
  const data = await apiFetch({ action: 'deletePayment', payload: { id: paymentId }, currentUser: getUsername() });
  if (data === null) return;
  if (data && !data.success) return toast(data.error || 'Delete failed.', 'error');
  toast('Payment deleted.', 'success');
  await syncSheets();
  if (returnToEnrollmentId) showEnrollmentDetail(returnToEnrollmentId);
}

/* ─────────────────────────────────────────────
   §18 · CRUD — SAVE
   saveCourse, saveStudentIdentity, saveEnrollment, savePayment.
───────────────────────────────────────────── */
async function saveCourse() {
  const name = document.getElementById('c-name').value.trim();
  if (!name) return toast('Course name is required.', 'warn');
  const _csDateErr = validateCourseDates(
    document.getElementById('c-start').value,
    document.getElementById('c-end').value
  );
  if (_csDateErr) return toast(_csDateErr, 'warn');
  const btn     = document.getElementById('btn-save-course');
  const payload = {
    id: editCourseId, name,
    status:    document.getElementById('c-status').value,
    startDate: document.getElementById('c-start').value,
    endDate:   document.getElementById('c-end').value,
    feeNormal: document.getElementById('c-feeNormal').value,
    feeEarly:  document.getElementById('c-feeEarly').value,
    capacity:  document.getElementById('c-capacity').value
  };
  const data = await apiFetch({ action: editCourseId ? 'updateCourse' : 'addCourse', payload, currentUser: getUsername() }, btn);
  if (data === null) return;
  if (data && !data.success) return toast(data.error || 'Error saving course.', 'error');
  toast(editCourseId ? 'Course updated.' : 'Course created.', 'success');
  closeM(); await syncSheets();
}

async function saveStudentIdentity() {
  const fullName = document.getElementById('se-fullname').value.trim();
  const email    = document.getElementById('se-email').value.trim();
  if (!fullName) return toast('Full name is required.', 'warn');
  if (!email)    return toast('Email is required.', 'warn');
  const btn     = document.getElementById('btn-save-st');
  const payload = { id: editStudentIdentityId, fullName, email, phone: document.getElementById('se-phone').value };
  const data = await apiFetch(
    { action: editStudentIdentityId ? 'updateStudent' : 'addStudent', payload, currentUser: getUsername() }, btn
  );
  if (data === null) return;
  if (data && !data.success) return toast(data.error || 'Error saving student.', 'error');
  toast(editStudentIdentityId ? 'Student updated.' : 'Student added.', 'success');
  closeM(); await syncSheets();
}

async function saveEnrollment() {
  const courseId = document.getElementById('e-course').value;
  if (!courseId) return toast('Course is required.', 'warn');

  let studentId = '', studentData = {};
  if (!editEnrollmentId) {
    const isExisting = document.getElementById('eTypeValue').value === 'existing';
    if (isExisting) {
      studentId = document.getElementById('e-selected-student-id').value;
      if (!studentId) return toast('Please select a student from the list.', 'warn');
    } else {
      const fn = document.getElementById('e-fullname').value.trim();
      const em = document.getElementById('e-email').value.trim();
      if (!fn || !em) return toast('Name and email are required.', 'warn');
      studentData = { fullName: fn, email: em, phone: document.getElementById('e-phone').value };
    }
    if (studentId && S.enrollments.find(e => e.studentId == studentId && e.courseId == courseId))
      return toast('Already enrolled in this course.', 'warn');
  }

  const instPlan = [];
  document.querySelectorAll('.dynamic-row').forEach(row => {
    instPlan.push({ amount: row.querySelector('.inst-amount').value, date: row.querySelector('.inst-date').value });
  });

  const btn      = document.getElementById('btn-save-enrollment');
  // Date validation
  const _enDateErr = validateEnrollmentDates(
    document.getElementById('e-depositDate').value,
    document.getElementById('e-fullPayDate').value,
    document.getElementById('e-payType').value
  );
  if (_enDateErr) return toast(_enDateErr, 'warn');
  const course   = getCourse(courseId);
  const rawTotal = course
    ? (document.getElementById('e-priceType').value === 'early_bird' ? course.feeEarly : course.feeNormal)
    : parseFee(document.getElementById('e-displayTotal').value);

  const payload = {
    enrollmentId: editEnrollmentId,
    isNew: !editEnrollmentId && document.getElementById('eTypeValue').value === 'new',
    studentId, studentData, courseId,
    priceType:      document.getElementById('e-priceType').value,
    totalFee:       rawTotal,
    depositAmount:  document.getElementById('e-depositAmount').value,
    depositDate:    document.getElementById('e-depositDate').value,
    paymentType:    document.getElementById('e-payType').value,
    fullPayDate:    document.getElementById('e-fullPayDate').value,
    instalmentPlan: JSON.stringify(instPlan)
  };

  const data = await apiFetch(
    { action: editEnrollmentId ? 'updateEnrollment' : 'enrollStudent', payload, currentUser: getUsername() }, btn
  );
  if (data === null) return;
  if (data && !data.success) return toast(data.error || 'Error saving enrollment.', 'error');
  toast(editEnrollmentId ? 'Enrollment updated.' : 'Student enrolled.', 'success');
  closeM(); await syncSheets();
}

async function savePayment() {
  const sId = document.getElementById('p-student').value;
  const cId = document.getElementById('p-course').value;
  const amt = parseUserNumber(document.getElementById('p-amount').value);
  if (!sId || !cId || !amt) return toast('Student, course, and amount are required.', 'warn');
  const btn     = document.getElementById('btn-save-payment');
  const payload = {
    studentId: sId, courseId: cId, amount: amt,
    date: document.getElementById('p-date').value,
    type: document.getElementById('p-type').value,
    note: document.getElementById('p-note').value
  };
  const data = await apiFetch({ action: 'addPayment', payload, currentUser: getUsername() }, btn);
  if (data === null) return;
  if (data && !data.success) return toast(data.error || 'Error saving payment.', 'error');
  toast('Payment recorded.', 'success');
  closeM(); await syncSheets();
}

/* ─────────────────────────────────────────────
   §19 · DATE-BASED REPORTING (Dashboard)
   Period summary, monthly bar chart, upcoming due.
   Pure JS + inline SVG — no external chart library.
───────────────────────────────────────────── */

// Returns {from, to} ISO date strings for the selected preset
function getReportRange() {
  const preset = document.getElementById('rep-preset').value;
  const now    = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const iso = d => d.toISOString().split('T')[0];

  if (preset === 'this_month')  return { from: iso(new Date(y, m, 1)),     to: iso(new Date(y, m + 1, 0)) };
  if (preset === 'last_month')  return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
  if (preset === 'last_3')      return { from: iso(new Date(y, m - 2, 1)), to: iso(new Date(y, m + 1, 0)) };
  if (preset === 'this_year')   return { from: iso(new Date(y, 0, 1)),     to: iso(new Date(y, 11, 31)) };
  if (preset === 'custom') {
    return {
      from: document.getElementById('rep-from').value || iso(new Date(y, m, 1)),
      to:   document.getElementById('rep-to').value   || iso(new Date(y, m + 1, 0))
    };
  }
  return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
}

function onReportPresetChange() {
  const custom = document.getElementById('rep-custom');
  custom.style.display = document.getElementById('rep-preset').value === 'custom' ? 'flex' : 'none';
  renderReport();
}

function renderReport() {
  if (!document.getElementById('rep-summary')) return; // dashboard not present
  _renderReportSummary();
  _renderReportChart();
  _renderUpcomingDue();
}

/* ── Period summary cards ── */
function _renderReportSummary() {
  const { from, to } = getReportRange();
  const fromMs = new Date(from).getTime();
  const toMs   = new Date(to).getTime() + 86400000 - 1; // include end day

  let total = 0, count = 0;
  const byType = { deposit: 0, instalment: 0, full: 0, other: 0 };
  for (const p of S.payments) {
    const ms = new Date(p.date).getTime();
    if (isNaN(ms) || ms < fromMs || ms > toMs) continue;
    const amt = Number(p.amount || 0);
    total += amt; count++;
    byType[p.type] = (byType[p.type] || 0) + amt;
  }

  const box = document.getElementById('rep-summary');
  box.innerHTML = `
    <div class="stat"><div class="lbl">Collected (period)</div><div class="val g">${fmt(total)}</div></div>
    <div class="stat"><div class="lbl">Payments</div><div class="val b">${count}</div></div>
    <div class="stat"><div class="lbl">Deposits</div><div class="val a">${fmt(byType.deposit)}</div></div>
    <div class="stat"><div class="lbl">Instalments</div><div class="val b">${fmt(byType.instalment)}</div></div>`;
}

/* ── Monthly bar chart (last 12 months, inline SVG) ── */
function _renderReportChart() {
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
                  label: d.toLocaleString(cfg.locale || 'en-US', { month: 'short' }),
                  year: d.getFullYear(), total: 0 });
  }
  const idx = new Map(months.map((m, i) => [m.key, i]));
  for (const p of S.payments) {
    if (!p.date || typeof p.date !== 'string') continue;
    const key = p.date.slice(0, 7); // YYYY-MM
    if (idx.has(key)) months[idx.get(key)].total += Number(p.amount || 0);
  }

  const max   = Math.max(1, ...months.map(m => m.total));
  const total = months.reduce((a, m) => a + m.total, 0);

  // CSS flexbox bar chart — each column is a flex item with a bar + label.
  const cols = months.map((m, i) => {
    const hPct    = Math.round((m.total / max) * 100);
    const hasVal  = m.total > 0;
    const showYr  = i === 0 || months[i-1].year !== m.year;
    return `<div class="bar-col" title="${esc(m.label)} ${m.year}: ${esc(fmt(m.total))}">
      <div class="bar-val">${hasVal ? esc(fmt(m.total).replace(/\.00$/, '')) : ''}</div>
      <div class="bar-track">
        <div class="bar-fill-v" style="height:${hPct}%"></div>
      </div>
      <div class="bar-lbl">${esc(m.label)}</div>
      <div class="bar-yr">${showYr ? esc(String(m.year).slice(2)) : ''}</div>
    </div>`;
  }).join('');

  document.getElementById('rep-chart').innerHTML = `
    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--color-text-secondary);margin-bottom:10px">
      <span>Peak: ${esc(fmt(max))}</span>
      <span>Total: ${esc(fmt(total))}</span>
    </div>
    <div class="bar-chart">${cols}</div>`;
}

/* ── Upcoming due (next 30 days) ── */
function _renderUpcomingDue() {
  const todayMs = new Date().setHours(0, 0, 0, 0);
  const horizon = todayMs + 30 * 86400000;
  const items = [];

  for (const en of S.enrollments) {
    const s = getStudent(en.studentId);
    if (!s) continue;
    const course = getCourse(en.courseId);
    const paid   = getEnrollmentPaid(en.studentId, en.courseId);

    // Deposit due
    const dep = Number(en.depositAmount || 0);
    if (dep > 0 && en.depositDate) {
      const ms = dateToMs(en.depositDate);
      if (ms >= todayMs && ms <= horizon && paid < dep)
        items.push({ ms, date: en.depositDate, student: s.fullName, course: course?.name || '—', label: 'Deposit', amount: dep - paid });
    }
    // Instalments due
    if (en.paymentType === 'instalment' && en.instalmentPlan) {
      try {
        JSON.parse(en.instalmentPlan).forEach((inst, i) => {
          const ms = dateToMs(inst.date);
          if (ms >= todayMs && ms <= horizon)
            items.push({ ms, date: inst.date, student: s.fullName, course: course?.name || '—', label: `Instalment ${i+1}`, amount: Number(inst.amount || 0) });
        });
      } catch (e) { console.warn('instalmentPlan parse failed:', e); }
    }
    // Full payment due
    if (en.paymentType === 'full_remaining' && en.fullPayDate) {
      const ms = dateToMs(en.fullPayDate);
      const rem = Number(en.totalFee || 0) - paid;
      if (ms >= todayMs && ms <= horizon && rem > 0)
        items.push({ ms, date: en.fullPayDate, student: s.fullName, course: course?.name || '—', label: 'Full payment', amount: rem });
    }
  }

  items.sort((a, b) => a.ms - b.ms);
  const box = document.getElementById('rep-upcoming');

  if (!items.length) {
    box.innerHTML = '<div style="font-size:13px;color:var(--color-text-secondary);padding:12px 0;text-align:center">No payments due in the next 30 days.</div>';
    return;
  }

  box.innerHTML = items.map(it => {
    const days = Math.round((it.ms - todayMs) / 86400000);
    const urgency = days <= 3 ? 'red' : days <= 7 ? 'amber' : 'blue';
    const dayLabel = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `in ${days}d`;
    return `<div class="upcoming-row">
      <div class="upcoming-info">
        <div class="upcoming-name">${esc(it.student)}</div>
        <div class="upcoming-sub">${esc(it.course)} · ${esc(it.label)}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:600;font-size:13px">${fmt(it.amount)}</div>
        <span class="chip ${urgency}" style="font-size:9px">${esc(formatDate(it.date))} · ${dayLabel}</span>
      </div>
    </div>`;
  }).join('');
}
