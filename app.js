/**
 * MEISNER STUDIO - COURSE MANAGEMENT SYSTEM
 * Frontend Logic - v2.8.0
 *
 * Changes from v2.7.0:
 *  - [FIX]  formatDate timezone fix — never uses new Date() for YYYY-MM-DD strings
 *  - [FIX]  Instalment plan parse error shows user-friendly message instead of silent fail
 *  - [FIX]  loadStudentCourses now triggers calculatePaymentSuggestion after loading
 *  - [FIX]  Payment Save button disabled until both student and course are selected
 *  - [FIX]  deleteRecord null-guards editId from global state before proceeding
 *  - [NEW]  Search input debounced (200ms) — no longer re-renders on every keystroke
 *  - [NEW]  "Remember me" checkbox on login — persists token in localStorage vs sessionStorage
 */

const cfg = {
  url:      'https://script.google.com/macros/s/AKfycbzuyzMDbczriYBKioq1snrdxqVOx_xhMkSQzHOm3vVPHk4CyO_anr15pXUM47Blyu8BbQ/exec',
  currency: '€'
};

/* ─────────────────────────────────────────────
   STATE
───────────────────────────────────────────── */
let S = { courses: [], students: [], enrollments: [], payments: [], generalStatus: [] };
let editCourseId          = null;
let editEnrollmentId      = null;
let editStudentIdentityId = null;

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */
const fmt = n =>
  cfg.currency + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const today = () => new Date().toISOString().split('T')[0];

const parseFee = val => {
  if (val === null || val === undefined || val === '') return 0;
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
};

/**
 * Timezone-safe date formatter.
 * YYYY-MM-DD strings are split directly — never fed to new Date() which
 * parses them as UTC midnight and can show the previous day in UTC+ timezones.
 */
const formatDate = dateStr => {
  if (!dateStr) return '—';
  // ISO date string — safe path, no Date object needed
  if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }
  // Fallback for other formats (e.g. Google Sheets date strings)
  const dt = new Date(dateStr);
  if (isNaN(dt)) return String(dateStr);
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
};

const getStatusBadge = statusId => {
  const colors = { active: 'teal', completed: 'blue', draft: 'amber', cancelled: 'red' };
  const st = (S.generalStatus || []).find(s => s.id == statusId);
  const label     = st ? st.name : (statusId || 'Unknown');
  const colorCode = st ? st.code : 'blue';
  return `<span class="chip ${colors[colorCode] || 'blue'}">${label}</span>`;
};

/* ─────────────────────────────────────────────
   SESSION / TOKEN
   "Remember me" stores token in localStorage so it
   survives tab close. Default uses sessionStorage.
───────────────────────────────────────────── */
const getToken = () =>
  localStorage.getItem('sessionToken') || sessionStorage.getItem('sessionToken') || '';

const setToken = (token, remember) => {
  if (remember) {
    localStorage.setItem('sessionToken', token);
    sessionStorage.removeItem('sessionToken');
  } else {
    sessionStorage.setItem('sessionToken', token);
    localStorage.removeItem('sessionToken');
  }
};

const clearToken = () => {
  localStorage.removeItem('sessionToken');
  localStorage.removeItem('username');
  sessionStorage.removeItem('sessionToken');
  sessionStorage.removeItem('username');
};

const getUsername = () =>
  localStorage.getItem('username') || sessionStorage.getItem('username') || '';

const setUsername = (username, remember) => {
  if (remember) localStorage.setItem('username', username);
  else          sessionStorage.setItem('username', username);
};

/* ─────────────────────────────────────────────
   API FETCH WRAPPER
───────────────────────────────────────────── */
async function apiFetch(body, btnEl = null) {
  const original = btnEl ? btnEl.innerHTML : null;
  if (btnEl) { btnEl.innerHTML = '<i class="ti ti-loader"></i> Saving…'; btnEl.disabled = true; }
  const enriched = { ...body, token: getToken() };
  try {
    const res = await fetch(cfg.url, { method: 'POST', body: JSON.stringify(enriched) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    if (btnEl) { btnEl.innerHTML = original; btnEl.disabled = false; }
  }
}

/* ─────────────────────────────────────────────
   AUTH
───────────────────────────────────────────── */
async function testConnection() {
  const badge = document.getElementById('loginSyncBadge');
  if (!badge) return;
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5000);
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
      err.innerText = 'Invalid credentials.'; err.style.display = 'block';
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
  const valid = await verifySession();
  if (valid) { initApp(); } else { clearToken(); testConnection(); }
};

/* ─────────────────────────────────────────────
   DATA SYNC
───────────────────────────────────────────── */
async function syncSheets() {
  document.getElementById('syncBadge').innerHTML = '<i class="ti ti-loader"></i> Syncing…';
  try {
    const r = await fetch(`${cfg.url}?action=getAll&token=${encodeURIComponent(getToken())}`);
    const d = await r.json();
    if (d.success === false) throw new Error(d.error || 'Unauthorized');
    S = {
      courses:       d.courses       || [],
      students:      d.students      || [],
      enrollments:   d.enrollments   || [],
      payments:      d.payments      || [],
      generalStatus: d.generalStatus || []
    };
    document.getElementById('syncBadge').innerHTML =
      '<i class="ti ti-cloud-check" style="color:var(--color-brand)"></i> Live Sync Active';
    populateStudentSearch();
    render();
  } catch {
    document.getElementById('syncBadge').innerHTML =
      '<i class="ti ti-cloud-x" style="color:#ef4444"></i> Sync Error';
  }
}

function populateStudentSearch() {
  const dl = document.getElementById('student-datalist');
  if (dl) dl.innerHTML = S.students
    .map(s => `<option data-id="${s.id}" value="${s.fullName} (${s.email})">`)
    .join('');
}

function captureSelectedStudent() {
  const val = document.getElementById('e-search-input').value;
  const opt = document.querySelector(`#student-datalist option[value="${val}"]`);
  document.getElementById('e-selected-student-id').value = opt ? opt.getAttribute('data-id') : '';
}

/* ─────────────────────────────────────────────
   DATA GETTERS
───────────────────────────────────────────── */
const getCourse  = id => S.courses.find(c => c.id == id);
const getStudent = id => S.students.find(s => s.id == id);
const getEnrollmentPaid = (studentId, courseId) =>
  S.payments
    .filter(p => p.studentId == studentId && p.courseId == courseId)
    .reduce((a, p) => a + Number(p.amount), 0);

/* ─────────────────────────────────────────────
   MODAL SYSTEM
───────────────────────────────────────────── */
function openM(id, editId = null, extraParam = null) {
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
  const target = document.getElementById(id);
  if (!target) return;
  target.classList.add('active');
  document.getElementById('modalOverlay').classList.add('open');
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
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById('modalOverlay')) closeM();
}

/* ── Modal setup helpers ── */

function _setupCourseModal(editId) {
  const stSelect = document.getElementById('c-status');
  if (stSelect) stSelect.innerHTML = (S.generalStatus || [])
    .filter(s => s.entity === 'course')
    .map(s => `<option value="${s.id}">${s.name}</option>`)
    .join('');

  if (editId) {
    editCourseId = editId;
    const c = getCourse(editId) || {};
    document.getElementById('modal-title-course').innerHTML = '<i class="ti ti-books"></i> Edit Course';
    document.getElementById('btn-save-course').textContent  = 'Update';
    document.getElementById('btn-delete-course').style.display = 'inline-flex';
    document.getElementById('c-name').value      = c.name      || '';
    document.getElementById('c-start').value     = c.startDate || '';
    document.getElementById('c-end').value       = c.endDate   || '';
    document.getElementById('c-feeNormal').value = c.feeNormal || '';
    document.getElementById('c-feeEarly').value  = c.feeEarly  || '';
    document.getElementById('c-capacity').value  = c.capacity  || '';
    if (stSelect) stSelect.value = c.status || '';
  } else {
    editCourseId = null;
    document.getElementById('modal-title-course').innerHTML = '<i class="ti ti-books"></i> New Course';
    document.getElementById('btn-save-course').textContent  = 'Create';
    document.getElementById('btn-delete-course').style.display = 'none';
    ['c-name','c-start','c-end','c-feeNormal','c-feeEarly','c-capacity']
      .forEach(x => { const el = document.getElementById(x); if (el) el.value = ''; });
    if (stSelect && S.generalStatus.length > 0) stSelect.value = S.generalStatus[0].id;
  }
}

function _setupStudentEditModal(editId) {
  if (editId) {
    editStudentIdentityId = editId;
    const s = getStudent(editId) || {};
    document.getElementById('modal-title-student').innerHTML = '<i class="ti ti-user"></i> Edit Student Profile';
    document.getElementById('btn-delete-st').style.display   = 'inline-flex';
    document.getElementById('se-fullname').value = s.fullName || '';
    document.getElementById('se-email').value    = s.email    || '';
    document.getElementById('se-phone').value    = s.phone    || '';
  } else {
    editStudentIdentityId = null;
    document.getElementById('modal-title-student').innerHTML = '<i class="ti ti-user"></i> Add New Student';
    document.getElementById('btn-delete-st').style.display   = 'none';
    ['se-fullname','se-email','se-phone'].forEach(x => { const el = document.getElementById(x); if (el) el.value = ''; });
  }
}

function _setupEnrollmentModal(editId) {
  document.getElementById('e-course').innerHTML =
    '<option value="">Select course…</option>' +
    S.courses.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  document.getElementById('e-search-input').value        = '';
  document.getElementById('e-selected-student-id').value = '';

  if (editId) {
    editEnrollmentId = editId;
    const en = S.enrollments.find(e => e.id == editId) || {};
    document.getElementById('modal-title-enrollment').innerHTML    = '<i class="ti ti-user-check"></i> Edit Enrollment';
    document.getElementById('btn-save-enrollment').textContent     = 'Update';
    document.getElementById('btn-delete-enrollment').style.display = 'inline-flex';
    document.getElementById('e-type-box').style.display     = 'none';
    document.getElementById('e-existing-box').style.display = 'none';
    document.getElementById('e-new-box').style.display      = 'none';
    document.getElementById('e-course').value               = en.courseId      || '';
    document.getElementById('e-course').disabled            = true;
    document.getElementById('e-priceType').value            = en.priceType     || 'normal';
    document.getElementById('e-depositAmount').value        = en.depositAmount || '';
    document.getElementById('e-depositDate').value          = en.depositDate   || '';
    document.getElementById('e-payType').value              = en.paymentType   || 'full_remaining';
    document.getElementById('e-displayTotal').value         = en.totalFee ? fmt(en.totalFee) : '';
    document.getElementById('e-fullPayDate').value          = en.fullPayDate    || '';
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
      } catch {
        console.warn('Could not parse instalment plan');
      }
    }
  } else {
    editEnrollmentId = null;
    document.getElementById('modal-title-enrollment').innerHTML    = '<i class="ti ti-user-check"></i> Enroll Student';
    document.getElementById('btn-save-enrollment').textContent     = 'Save';
    document.getElementById('btn-delete-enrollment').style.display = 'none';
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
    S.students.map(s => `<option value="${s.id}">${s.fullName}</option>`).join('');
  document.getElementById('p-date').value    = today();
  document.getElementById('p-amount').value  = '';
  document.getElementById('p-note').value    = '';
  document.getElementById('smart-suggestion').style.display = 'none';
  document.getElementById('p-course-box').style.display     = 'none';
  // Save button starts disabled until student + course both selected
  document.getElementById('btn-save-payment').disabled = true;

  if (extraParam) {
    const en = S.enrollments.find(e => e.id == extraParam);
    if (en) {
      document.getElementById('p-student').value = en.studentId;
      loadStudentCourses();
      // Course dropdown is now populated synchronously by loadStudentCourses,
      // so we can set the value and trigger suggestion immediately
      const courseSelect = document.getElementById('p-course');
      if (courseSelect) {
        courseSelect.value = en.courseId;
        _onPaymentCourseReady();
      }
    }
  }
}

/* ─────────────────────────────────────────────
   NAVIGATION
───────────────────────────────────────────── */
function goTab(name) {
  const names = ['dashboard', 'courses', 'students', 'enrollments', 'payments'];
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', names[i] === name));
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
  document.getElementById('sec-' + name).classList.add('active');
  // Scroll to top on tab switch — prevents mobile staying mid-page
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ─────────────────────────────────────────────
   RENDER
───────────────────────────────────────────── */
function render() { renderStats(); renderDash(); renderCourses(); renderStudents(); renderEnrollments(); renderPayments(); }

function renderStats() {
  const collected   = S.payments.reduce((a, p) => a + Number(p.amount), 0);
  const outstanding = S.enrollments.reduce(
    (a, en) => a + Math.max(0, Number(en.totalFee || 0) - getEnrollmentPaid(en.studentId, en.courseId)), 0
  );
  document.getElementById('st-courses').textContent     = S.courses.length;
  document.getElementById('st-students').textContent    = S.students.length;
  document.getElementById('st-collected').textContent   = fmt(collected);
  document.getElementById('st-outstanding').textContent = fmt(outstanding);
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
      <div class="card-hd"><div><b>${c.name}</b><br><small>${enrolls.length} student(s) enrolled</small></div>${getStatusBadge(c.status)}</div>
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
    return `<div class="card">
      <div class="card-hd">
        <div><b>${c.name}</b><br><small>${formatDate(c.startDate)} to ${formatDate(c.endDate)}</small></div>
        <div style="display:flex;gap:6px;align-items:center">
          ${getStatusBadge(c.status)}
          <span class="chip blue">${count}${c.capacity ? '/' + c.capacity : ''} Students</span>
          <button class="btn ghost sm" onclick="openM('mCourse','${c.id}')"><i class="ti ti-edit"></i></button>
        </div>
      </div>
      <div class="meta-row">
        <span><i class="ti ti-tag"></i> Normal: ${fmt(c.feeNormal)}</span>
        <span><i class="ti ti-discount-check" style="color:var(--color-brand)"></i> Early Bird: ${fmt(c.feeEarly)}</span>
      </div>
    </div>`;
  }).join('');
}

/* Debounced search */
let _searchTimer = null;
function onStudentSearchInput() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(renderStudents, 200);
}

function renderStudents() {
  const box   = document.getElementById('studentDBList');
  const input = document.getElementById('s-search');
  const term  = input ? input.value.toLowerCase() : '';
  const avCls = ['av-t', 'av-b', 'av-a'];

  const filtered = S.students
    .filter(s => s && s.fullName && s.email)
    .filter(s => s.fullName.toLowerCase().includes(term) || s.email.toLowerCase().includes(term));

  if (!filtered.length) { box.innerHTML = '<div class="empty"><i class="ti ti-users"></i>No students found.</div>'; return; }

  box.innerHTML = `<div class="card" style="padding:4px 16px">${filtered.map((s, i) => {
    const count    = S.enrollments.filter(e => e.studentId == s.id).length;
    const initials = s.fullName.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase();
    return `<div class="student-row clickable" onclick="showStudentDetail('${s.id}')">
      <div class="avatar ${avCls[i % 3]}">${initials}</div>
      <div class="student-info">
        <div class="student-name">${s.fullName}</div>
        <div class="student-sub">${s.email}${s.phone ? ' · ' + s.phone : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:12px;color:var(--color-text-secondary)">${count} course(s)</span>
        <button class="btn ghost sm" onclick="event.stopPropagation();openM('mStudentEdit','${s.id}')"><i class="ti ti-edit"></i></button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function renderEnrollments() {
  const box   = document.getElementById('enrollmentList');
  const avCls = ['av-t', 'av-b', 'av-a'];
  if (!S.enrollments.length) { box.innerHTML = '<div class="empty"><i class="ti ti-list"></i>No enrollments yet.</div>'; return; }
  box.innerHTML = `<div class="card" style="padding:4px 16px">${S.enrollments.map((en, i) => {
    const s = getStudent(en.studentId);
    if (!s) return '';
    const paid    = getEnrollmentPaid(en.studentId, en.courseId);
    const total   = Number(en.totalFee || 0);
    const pct     = total > 0 ? Math.round(paid / total * 100) : 100;
    const barCls  = pct >= 100 ? '' : pct < 50 ? 'danger' : 'warn';
    const initials = s.fullName.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const course  = getCourse(en.courseId);
    return `<div class="student-row clickable" onclick="showEnrollmentDetail('${en.id}')">
      <div class="avatar ${avCls[i % 3]}">${initials}</div>
      <div class="student-info">
        <div class="student-name">${s.fullName}</div>
        <div class="student-sub">${course ? course.name : '—'} · <span style="color:${en.priceType === 'early_bird' ? 'var(--color-brand)' : 'inherit'}">${en.priceType === 'early_bird' ? 'Early Bird' : 'Normal'}</span></div>
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
        <span style="font-weight:600">${s ? s.fullName : '—'}</span>
        <span class="chip ${clr}" style="margin-left:8px;font-size:10px">${p.type}</span>
        <div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px">${c ? c.name : 'Unknown'}${p.note ? ' · ' + p.note : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-weight:600;color:var(--color-brand);font-size:14px">+${fmt(p.amount)}</span>
        <span style="font-size:12px;color:var(--color-text-secondary)">${formatDate(p.date)}</span>
        <button class="btn ghost sm" style="color:#ef4444" onclick="confirmDeletePayment('${p.id}')" title="Delete payment"><i class="ti ti-trash"></i></button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

/* ─────────────────────────────────────────────
   STUDENT DETAIL
───────────────────────────────────────────── */
function showStudentDetail(sId) {
  const s = getStudent(sId);
  if (!s) return;
  const enrollments = S.enrollments.filter(e => e.studentId == sId);
  const totalPaid   = S.payments.filter(p => p.studentId == sId).reduce((a, p) => a + Number(p.amount), 0);
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
          try {
            planSummary = JSON.parse(en.instalmentPlan).length + 'x instalment';
          } catch { planSummary = 'Instalment (plan unavailable)'; }
        }

        return `<div style="padding:10px 0;border-bottom:1px solid var(--color-border-tertiary)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <span style="font-weight:600;font-size:13px">${course ? course.name : '—'}</span>
            <span class="chip ${pct>=100?'teal':pct<50?'red':'amber'}" style="font-size:10px">${pct}%</span>
          </div>
          <div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px">
            ${en.priceType === 'early_bird' ? 'Early Bird' : 'Normal'} · ${planSummary}
          </div>
          <div class="bar-bg"><div class="bar-fill ${barCls}" style="width:${Math.min(100,pct)}%"></div></div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--color-text-secondary);margin-top:4px">
            <span>${fmt(paid)} paid</span><span>${fmt(Math.max(0, total - paid))} remaining</span>
          </div>
          <div style="margin-top:8px;display:flex;gap:6px">
            <button class="btn sm" onclick="showEnrollmentDetail('${en.id}')"><i class="ti ti-eye"></i> Detail</button>
            <button class="btn sm primary" onclick="openM('mPayment',null,'${en.id}')"><i class="ti ti-plus"></i> Payment</button>
          </div>
        </div>`;
      }).join('')
    : '<div style="font-size:13px;color:var(--color-text-secondary);padding:10px 0">Not enrolled in any course.</div>';

  document.getElementById('sd-title').innerHTML = `
    <div style="display:flex;align-items:center;gap:12px">
      <div class="avatar av-t" style="width:40px;height:40px;font-size:15px">${initials}</div>
      <div>
        <div>${s.fullName}</div>
        <div style="font-size:13px;font-weight:400;color:var(--color-text-secondary)">${s.email}${s.phone ? ' · ' + s.phone : ''}</div>
      </div>
    </div>`;

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
    <button class="btn" onclick="openM('mStudentEdit','${s.id}')"><i class="ti ti-edit"></i> Edit Profile</button>`;

  document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
  document.getElementById('mStudentDetail').classList.add('active');
  document.getElementById('modalOverlay').classList.add('open');
}

/* ─────────────────────────────────────────────
   ENROLLMENT DETAIL
───────────────────────────────────────────── */
function showEnrollmentDetail(enId) {
  const en = S.enrollments.find(x => x.id == enId);
  if (!en) return;
  const s      = getStudent(en.studentId);
  const course = getCourse(en.courseId);
  const paid   = getEnrollmentPaid(en.studentId, en.courseId);
  const rem    = Number(en.totalFee) - paid;
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
            <span>Instalment ${i + 1}</span><span>${fmt(inst.amount)} — Due: ${formatDate(inst.date)}</span>
          </div>`
        ).join('') + '</div>';
    } catch {
      planHtml = '<div style="font-size:12px;color:#ef4444;margin-top:8px;padding:8px;background:#fef2f2;border-radius:6px"><i class="ti ti-alert-circle"></i> Instalment plan could not be loaded.</div>';
    }
  }

  document.getElementById('ed-title').innerHTML = 'Enrollment Detail';
  document.getElementById('ed-body').innerHTML = `
    <div class="detail-panel">
      <div class="detail-grid">
        <span class="dk">Student</span><span class="dv">${s ? s.fullName : '—'}</span>
        <span class="dk">Course</span><span class="dv">${course ? course.name : '—'}</span>
        <span class="dk">Course price type</span>
        <span class="dv" style="color:${en.priceType==='early_bird'?'var(--color-brand)':'inherit'}">
          ${en.priceType === 'early_bird' ? 'Early Bird' : 'Normal'}
        </span>
        <span class="dk">Deposit due</span><span class="dv">${formatDate(en.depositDate)} (${fmt(en.depositAmount)})</span>
        ${en.paymentType !== 'instalment' && en.fullPayDate
          ? `<span class="dk">Payment due</span><span class="dv">${formatDate(en.fullPayDate)}</span>`
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
              <span class="chip ${p.type==='deposit'?'amber':p.type==='full'?'teal':'blue'}" style="margin-left:8px;font-size:10px">${p.type}</span>
              ${p.note ? `<span style="font-size:11px;color:var(--color-text-secondary);margin-left:6px">${p.note}</span>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:12px;color:var(--color-text-secondary)">${formatDate(p.date)}</span>
              <button class="btn ghost sm" style="color:#ef4444" onclick="confirmDeletePayment('${p.id}','${enId}')" title="Delete"><i class="ti ti-trash"></i></button>
            </div>
          </div>`).join('')}</div>`
      : '<div style="font-size:13px;color:var(--color-text-secondary);padding:10px;text-align:center;background:#f9fafb;border-radius:8px">No payments recorded.</div>'
    }`;

  document.getElementById('ed-footer').innerHTML = `
    <button class="danger-btn" onclick="deleteEnrollmentFromDetail('${en.id}')"><i class="ti ti-trash"></i> Delete</button>
    <div style="display:flex;gap:8px">
      <button class="btn" onclick="closeM()">Close</button>
      <button class="btn" onclick="openM('mEnrollment','${en.id}')"><i class="ti ti-edit"></i> Edit</button>
      <button class="btn primary" onclick="openM('mPayment',null,'${en.id}')"><i class="ti ti-plus"></i> Add Payment</button>
    </div>`;
  // Fix footer layout
  document.getElementById('ed-footer').style.justifyContent = 'space-between';

  document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
  document.getElementById('mEnrollmentDetail').classList.add('active');
  document.getElementById('modalOverlay').classList.add('open');
}

/* ─────────────────────────────────────────────
   FORM HELPERS
───────────────────────────────────────────── */
function setStudentMode(mode) {
  document.getElementById('eTypeValue').value = mode;
  document.getElementById('toggle-existing').classList.toggle('active', mode === 'existing');
  document.getElementById('toggle-new').classList.toggle('active', mode === 'new');
  document.getElementById('e-existing-box').style.display = mode === 'existing' ? 'block' : 'none';
  document.getElementById('e-new-box').style.display      = mode === 'new'      ? 'block' : 'none';
}

// Legacy alias — called from _setupEnrollmentModal
function toggleStudentMode() {
  const mode = document.getElementById('eTypeValue').value || 'existing';
  setStudentMode(mode);
}

/**
 * After loading courses for the selected student, immediately trigger
 * the payment suggestion if a course is pre-selected.
 */
function loadStudentCourses() {
  const sId     = document.getElementById('p-student').value;
  const cBox    = document.getElementById('p-course-box');
  const cSelect = document.getElementById('p-course');
  // Reset save button until course is also selected
  document.getElementById('btn-save-payment').disabled = true;
  if (!sId) { cBox.style.display = 'none'; return; }
  const enrolls = S.enrollments.filter(e => e.studentId == sId);
  cSelect.innerHTML = '<option value="">Select course…</option>' +
    enrolls.map(en => `<option value="${en.courseId}">${getCourse(en.courseId)?.name || en.courseId}</option>`).join('');
  cBox.style.display = 'block';
  // If only one course, auto-select and trigger suggestion
  if (enrolls.length === 1) {
    cSelect.value = enrolls[0].courseId;
    _onPaymentCourseReady();
  }
}

function _onPaymentCourseReady() {
  calculatePaymentSuggestion();
  const cId = document.getElementById('p-course').value;
  const sId = document.getElementById('p-student').value;
  // Enable Save only when both are selected
  document.getElementById('btn-save-payment').disabled = !(sId && cId);
}

function toggleInstalmentFields() {
  const isInstalment = document.getElementById('e-payType').value === 'instalment';
  document.getElementById('instalment-container').style.display   = isInstalment ? 'block' : 'none';
  document.getElementById('full-payment-date-box').style.display  = isInstalment ? 'none'  : 'block';
  updateInstalments();
}

function updateInstalments() {
  const cId      = document.getElementById('e-course').value;
  const course   = S.courses.find(c => c.id == cId);
  const totalFee = course
    ? (document.getElementById('e-priceType').value === 'early_bird' ? course.feeEarly : course.feeNormal)
    : 0;
  document.getElementById('e-displayTotal').value = totalFee ? fmt(totalFee) : '';
  const container = document.getElementById('dynamic-instalments');
  container.innerHTML = '';
  if (document.getElementById('e-payType').value !== 'instalment') return;
  const num     = parseInt(document.getElementById('e-numInstalments').value) || 0;
  const deposit = parseFee(document.getElementById('e-depositAmount').value);
  const rem     = Math.max(0, Number(totalFee) - deposit);
  if (num > 0) {
    const amt = (rem / num).toFixed(2);
    for (let i = 1; i <= num; i++) {
      container.innerHTML += `<div class="form-2col dynamic-row">
        <div class="fg"><label>Instalment ${i} (€)</label><input type="number" class="inst-amount" value="${amt}"></div>
        <div class="fg"><label>Date</label><input type="date" class="inst-date"></div>
      </div>`;
    }
  }
}

function calculatePaymentSuggestion() {
  const sId     = document.getElementById('p-student').value;
  const cId     = document.getElementById('p-course').value;
  const suggBox = document.getElementById('smart-suggestion');
  suggBox.classList.remove('success');
  // Enable/disable Save button based on selection state
  document.getElementById('btn-save-payment').disabled = !(sId && cId);
  if (!sId || !cId) { suggBox.style.display = 'none'; return; }
  const en = S.enrollments.find(x => x.studentId == sId && x.courseId == cId);
  if (!en) { suggBox.style.display = 'none'; return; }
  const paid = getEnrollmentPaid(sId, cId);
  const rem  = Math.max(0, Number(en.totalFee) - paid);
  if (rem === 0) {
    suggBox.style.display = 'block'; suggBox.classList.add('success');
    document.getElementById('ss-title').innerHTML = '<i class="ti ti-circle-check"></i> Fully Paid!';
    document.getElementById('ss-desc').innerHTML  = 'No outstanding balance.';
    document.getElementById('p-amount').value     = 0;
    document.getElementById('p-type').value       = 'other'; return;
  }
  let nAmt = rem, nType = 'full', nText = `Remaining Balance: <b>${fmt(rem)}</b>`;
  const dep = Number(en.depositAmount || 0);
  if (dep > 0 && paid < dep) {
    nAmt = dep - paid; nType = 'deposit'; nText = `Expected Deposit: <b>${fmt(nAmt)}</b>`;
  } else if (en.paymentType === 'instalment' && en.instalmentPlan) {
    try {
      const plan = JSON.parse(en.instalmentPlan); let acc = dep;
      for (let i = 0; i < plan.length; i++) {
        acc += Number(plan[i].amount);
        if (paid < acc) {
          nAmt  = Number(plan[i].amount) - Math.max(0, paid - (acc - Number(plan[i].amount)));
          nType = 'instalment';
          nText = `Next due: <b>Instalment ${i + 1}</b> (${fmt(nAmt)})`; break;
        }
      }
    } catch {}
  }
  suggBox.style.display = 'block';
  document.getElementById('ss-title').innerHTML = '<i class="ti ti-bulb"></i> Suggested';
  document.getElementById('ss-desc').innerHTML  = nText;
  document.getElementById('p-amount').value     = parseFloat(nAmt).toFixed(2);
  document.getElementById('p-type').value       = nType;
}

/* ─────────────────────────────────────────────
   CRUD — DELETE
───────────────────────────────────────────── */
async function deleteRecord(type) {
  let id, modalId, confirmMsg, backendAction;

  if (type === 'course') {
    // Null-guard: read id at call time, not from stale global
    id = editCourseId;
    if (!id) return alert('No course selected.');
    modalId = 'mCourse'; backendAction = 'deleteCourse';
    if (S.enrollments.some(e => e.courseId == id))
      return alert('Cannot delete: This course has active enrollments.');
    confirmMsg = 'Are you sure you want to permanently delete this course?';
  } else if (type === 'student') {
    id = editStudentIdentityId;
    if (!id) return alert('No student selected.');
    modalId = 'mStudentEdit'; backendAction = 'deleteStudent';
    if (S.enrollments.some(e => e.studentId == id))
      return alert('Cannot delete: This student has active enrollments. Delete enrollments first.');
    confirmMsg = 'Are you sure you want to permanently delete this student?';
  } else if (type === 'enrollment') {
    id = editEnrollmentId;
    if (!id) return alert('No enrollment selected.');
    modalId = 'mEnrollment'; backendAction = 'deleteEnrollment';
    const en = S.enrollments.find(e => e.id == id);
    if (en && S.payments.some(p => p.studentId == en.studentId && p.courseId == en.courseId))
      return alert('Cannot delete: There are payments recorded for this enrollment. Delete the payments first.');
    confirmMsg = 'Are you sure you want to delete this enrollment?';
  } else return;

  if (!confirm(confirmMsg)) return;
  try {
    await apiFetch({ action: backendAction, payload: { id }, currentUser: getUsername() });
    closeM();
    await syncSheets();
  } catch { alert('Delete operation failed. Please try again.'); }
}


/**
 * Delete enrollment directly from the detail modal.
 */
async function deleteEnrollmentFromDetail(enrollmentId) {
  const en = S.enrollments.find(e => e.id == enrollmentId);
  if (!en) return alert("Enrollment not found.");
  if (S.payments.some(p => p.studentId == en.studentId && p.courseId == en.courseId))
    return alert("Cannot delete: There are payments recorded for this enrollment. Delete the payments first.");
  if (!confirm("Are you sure you want to delete this enrollment?")) return;
  try {
    await apiFetch({ action: "deleteEnrollment", payload: { id: enrollmentId }, currentUser: getUsername() });
    closeM();
    await syncSheets();
  } catch { alert("Delete operation failed. Please try again."); }
}
/**
 * @param {string} paymentId
 * @param {string|null} returnToEnrollmentId — if set, re-opens enrollment detail after delete
 */
async function confirmDeletePayment(paymentId, returnToEnrollmentId = null) {
  if (!confirm('Are you sure you want to delete this payment? This cannot be undone.')) return;
  try {
    await apiFetch({ action: 'deletePayment', payload: { id: paymentId }, currentUser: getUsername() });
    await syncSheets();
    if (returnToEnrollmentId) {
      showEnrollmentDetail(returnToEnrollmentId);
    }
  } catch { alert('Delete payment failed. Please try again.'); }
}

/* ─────────────────────────────────────────────
   CRUD — SAVE
───────────────────────────────────────────── */
async function saveCourse() {
  const name = document.getElementById('c-name').value.trim();
  if (!name) return alert('Course name is required.');
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
  try {
    await apiFetch({ action: editCourseId ? 'updateCourse' : 'addCourse', payload, currentUser: getUsername() }, btn);
    closeM(); await syncSheets();
  } catch { alert('Error saving course.'); }
}

async function saveStudentIdentity() {
  const fullName = document.getElementById('se-fullname').value.trim();
  const email    = document.getElementById('se-email').value.trim();
  if (!fullName) return alert('Full name is required.');
  if (!email)    return alert('Email is required.');
  const btn     = document.getElementById('btn-save-st');
  const payload = { id: editStudentIdentityId, fullName, email, phone: document.getElementById('se-phone').value };
  try {
    const data = await apiFetch(
      { action: editStudentIdentityId ? 'updateStudent' : 'addStudent', payload, currentUser: getUsername() }, btn
    );
    if (!data.success) { alert(data.error || 'Error saving student.'); return; }
    closeM(); await syncSheets();
  } catch { alert('Error saving student.'); }
}

async function saveEnrollment() {
  const courseId = document.getElementById('e-course').value;
  if (!courseId) return alert('Course is required.');
  let studentId = '', studentData = {};
  if (!editEnrollmentId) {
    const isExisting = document.getElementById('eTypeValue').value === 'existing';
    if (isExisting) {
      studentId = document.getElementById('e-selected-student-id').value;
      if (!studentId) return alert('Please select a student from the list.');
    } else {
      const fn = document.getElementById('e-fullname').value.trim();
      const em = document.getElementById('e-email').value.trim();
      if (!fn || !em) return alert('Name and email are required.');
      studentData = { fullName: fn, email: em, phone: document.getElementById('e-phone').value };
    }
    if (studentId && S.enrollments.find(e => e.studentId == studentId && e.courseId == courseId))
      return alert('Already enrolled in this course.');
  }
  const instPlan = [];
  document.querySelectorAll('.dynamic-row').forEach(row => {
    instPlan.push({ amount: row.querySelector('.inst-amount').value, date: row.querySelector('.inst-date').value });
  });
  const btn      = document.getElementById('btn-save-enrollment');
  const course   = getCourse(courseId);
  const rawTotal = course
    ? (document.getElementById('e-priceType').value === 'early_bird' ? course.feeEarly : course.feeNormal)
    : parseFee(document.getElementById('e-displayTotal').value);
  const payload  = {
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
  try {
    const data = await apiFetch(
      { action: editEnrollmentId ? 'updateEnrollment' : 'enrollStudent', payload, currentUser: getUsername() }, btn
    );
    if (!data.success) { alert(data.error || 'Error saving enrollment.'); return; }
    closeM(); await syncSheets();
  } catch { alert('Connection error. Please try again.'); }
}

async function savePayment() {
  const sId = document.getElementById('p-student').value;
  const cId = document.getElementById('p-course').value;
  const amt = parseFloat(document.getElementById('p-amount').value);
  if (!sId || !cId || !amt) return alert('Student, course, and amount are required.');
  const btn     = document.getElementById('btn-save-payment');
  const payload = {
    studentId: sId, courseId: cId, amount: amt,
    date: document.getElementById('p-date').value,
    type: document.getElementById('p-type').value,
    note: document.getElementById('p-note').value
  };
  try {
    await apiFetch({ action: 'addPayment', payload, currentUser: getUsername() }, btn);
    closeM(); await syncSheets();
  } catch { alert('Connection error. Please try again.'); }
}
