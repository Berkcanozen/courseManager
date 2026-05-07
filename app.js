/**
 * MEISNER STUDIO - COURSE MANAGEMENT SYSTEM
 * Frontend Logic - v2.1.1 (Relational + Date Fix)
 */

let S = { courses:[], students:[], enrollments:[], payments:[] };

// DİKKAT: BURAYA KENDİ GOOGLE APPS SCRIPT URL'Nİ YAPIŞTIR!
let cfg = { 
  url: 'https://script.google.com/macros/s/AKfycbzfBHmeTnKjAHbKMvL3crHXTQJJEmNXBK1fTb3eCzQhNFw4-NsumSh4cIAbRCtye7nHtQ/exec', 
  currency: '€' 
};

let editCourseId = null;
let editEnrollmentId = null;

const fmt = n => cfg.currency + Number(n||0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const today = () => new Date().toISOString().split('T')[0];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);

// Tarih Kaymalarını %100 Engelleyen Formatlayıcı
const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const parts = dateStr.split('-');
        return `${parts[2]}/${parts[1]}/${parts[0]}`; 
    }
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${d.getFullYear()}`;
};

// --- BAĞLANTI VE LOGIN ---
async function testConnection() {
    const badge = document.getElementById('loginSyncBadge');
    if(!badge || !cfg.url) return;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const r = await fetch(cfg.url + "?action=ping", { signal: controller.signal });
        clearTimeout(timeoutId);
        if(r.ok) {
            badge.innerHTML = '<i class="ti ti-cloud-check" style="color:var(--color-brand)"></i> Server Connected';
            badge.style.borderColor = 'var(--color-brand)';
        } else { throw new Error(); }
    } catch(e) {
        badge.innerHTML = '<i class="ti ti-cloud-x" style="color:#ef4444"></i> Connection Error';
        badge.style.borderColor = '#ef4444';
    }
}

async function handleLogin() {
  const u = document.getElementById('l-user').value, p = document.getElementById('l-pass').value;
  const b = document.getElementById('l-btn'), e = document.getElementById('login-err');
  if(!u || !p) return;
  b.innerHTML = '<i class="ti ti-loader"></i> Verifying...'; b.disabled = true; e.style.display = "none";
  try {
    const r = await fetch(cfg.url, { method: 'POST', body: JSON.stringify({ action: 'checkLogin', payload: { username: u, password: p } }) });
    const d = await r.json();
    if (d.success) {
      sessionStorage.setItem('isLoggedIn', 'true'); sessionStorage.setItem('username', u);
      initApp();
    } else {
      e.innerText = "Invalid credentials."; e.style.display = "block"; b.innerText = "Sign In"; b.disabled = false;
    }
  } catch (err) { e.style.display = "block"; b.innerText = "Sign In"; b.disabled = false; }
}

function initApp() { document.getElementById('login-screen').style.display = "none"; document.getElementById('main-app').style.display = "block"; syncSheets(); }
window.onload = () => { if (sessionStorage.getItem('isLoggedIn') === 'true') { initApp(); } else { testConnection(); } };

async function syncSheets(){
  document.getElementById('syncBadge').innerHTML = '<i class="ti ti-loader"></i> Syncing...';
  try{
    const r = await fetch(cfg.url+'?action=getAll');
    const d = await r.json();
    S = { courses: d.courses||[], students: d.students||[], enrollments: d.enrollments||[], payments: d.payments||[] };
    document.getElementById('syncBadge').innerHTML = '<i class="ti ti-cloud-check" style="color:var(--color-brand)"></i> Live Sync Active';
    render();
  }catch(e){ document.getElementById('syncBadge').innerHTML = '<i class="ti ti-cloud-x" style="color:#ef4444"></i> Sync Error'; }
}

// --- YARDIMCI HESAPLAMALAR ---
function getEnrollmentPaid(studentId, courseId){ 
    return S.payments.filter(p => p.studentId === studentId && p.courseId === courseId).reduce((a,p)=>a+Number(p.amount),0); 
}
function getCourse(id){ return S.courses.find(c=>c.id===id); }
function getStudent(id){ return S.students.find(s=>s.id===id); }

// --- RENDER FONKSİYONLARI ---
function render(){ renderStats(); renderDash(); renderCourses(); renderEnrollments(); renderPayments(); }

function renderStats(){
  const collected = S.payments.reduce((a,p)=>a+Number(p.amount),0);
  const outstanding = S.enrollments.reduce((a,en)=> a + Math.max(0, Number(en.totalFee||0)-getEnrollmentPaid(en.studentId, en.courseId)), 0);
  document.getElementById('st-courses').textContent = S.courses.length;
  document.getElementById('st-students').textContent = S.students.length;
  document.getElementById('st-collected').textContent = fmt(collected);
  document.getElementById('st-outstanding').textContent = fmt(outstanding);
}

function renderDash(){
  const box = document.getElementById('dashContent');
  if(!S.courses.length){ box.innerHTML='<div class="empty"><i class="ti ti-books"></i>No courses yet.</div>'; return; }
  box.innerHTML = S.courses.map(c=>{
    const enrolls = S.enrollments.filter(e=>e.courseId===c.id);
    const totalDue = enrolls.reduce((a,e)=>a+Number(e.totalFee||0),0);
    const totalPaid = enrolls.reduce((a,e)=>a+getEnrollmentPaid(e.studentId, c.id),0);
    const pct = totalDue>0?Math.round(totalPaid/totalDue*100):0;
    const barCls = pct>=100?'':pct<50?'danger':'warn';
    return `<div class="card"><div class="card-hd"><div><div class="card-title">${c.name}</div><div class="card-sub">${enrolls.length} student(s) enrolled</div></div><span class="chip ${pct>=100?'teal':pct>=50?'amber':'red'}">${pct}% Collected</span></div><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--color-text-secondary);margin-bottom:6px"><span>${fmt(totalPaid)} Paid</span><span>${fmt(totalDue-totalPaid)} Remaining</span></div><div class="bar-bg"><div class="bar-fill ${barCls}" style="width:${Math.min(100,pct)}%"></div></div></div>`;
  }).join('');
}

function renderCourses(){
  const box = document.getElementById('courseList');
  if(!S.courses.length){ box.innerHTML='<div class="empty"><i class="ti ti-books"></i>No courses yet.</div>'; return; }
  box.innerHTML = S.courses.map((c,i)=>{
    const enrolls = S.enrollments.filter(e=>e.courseId===c.id).length;
    const clr = ['teal','blue','amber'][i%3];
    return `<div class="card"><div class="card-hd"><div><div class="card-title">${c.name}</div><div class="card-sub">${formatDate(c.startDate)} to ${formatDate(c.endDate)}</div></div><div style="display:flex;gap:6px;align-items:center"><span class="chip ${clr}">${enrolls}${c.capacity?'/'+c.capacity:''} Students</span><button class="btn ghost sm" onclick="openM('mCourse', '${c.id}')"><i class="ti ti-edit" style="font-size:16px"></i></button></div></div><div class="meta-row"><span><i class="ti ti-tag"></i> Normal: ${fmt(c.feeNormal)}</span><span><i class="ti ti-discount-check" style="color:var(--color-brand)"></i> Early Bird: ${fmt(c.feeEarly)}</span></div></div>`;
  }).join('');
}

function renderEnrollments(){
  const box = document.getElementById('studentList');
  if(!S.enrollments.length){ box.innerHTML='<div class="empty"><i class="ti ti-users"></i>No enrollments yet.</div>'; return; }
  box.innerHTML = `<div class="card" style="padding:4px 16px">${S.enrollments.map((en,i)=>{
    const s = getStudent(en.studentId); if(!s) return '';
    const paid = getEnrollmentPaid(en.studentId, en.courseId);
    const total = Number(en.totalFee||0);
    const pct = total>0?Math.round(paid/total*100):100;
    const barCls = pct>=100?'':pct<50?'danger':'warn';
    const nameParts = (s.fullName||'').trim().split(' ');
    const initials = (nameParts[0]?.[0]||'') + (nameParts.length>1 ? nameParts[nameParts.length-1][0] : '');
    const course = getCourse(en.courseId);
    return `<div class="student-row" onclick="showEnrollmentDetail('${en.id}')"><div class="avatar av-t">${initials.toUpperCase()}</div><div class="student-info"><div class="student-name">${s.fullName}</div><div class="student-sub">${course?course.name:'—'}</div></div><div class="pay-summary"><div class="pay-amount ${pct>=100?'g':pct<50?'r':'a'}">${fmt(paid)} / ${fmt(total)}</div><div class="bar-bg"><div class="bar-fill ${barCls}" style="width:${Math.min(100,pct)}%"></div></div></div></div>`;
  }).join('')}</div>`;
}

function renderPayments(){
  const box = document.getElementById('paymentList');
  if(!S.payments.length){ box.innerHTML='<div class="empty"><i class="ti ti-coin"></i>No payments recorded yet.</div>'; return; }
  const sorted = [...S.payments].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  box.innerHTML = `<div class="card" style="padding:4px 16px">${sorted.map(p=>{
    const s = getStudent(p.studentId); const c = getCourse(p.courseId);
    return `<div class="payment-entry"><div><span style="font-weight:600">${s?s.fullName:'—'}</span><span class="chip blue" style="margin-left:8px;font-size:10px">${p.type}</span><div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px">${c?c.name:'Unknown'}</div></div><div style="display:flex;align-items:center;gap:12px"><span style="font-weight:600;color:var(--color-brand);font-size:14px">+${fmt(p.amount)}</span><span style="font-size:12px;color:var(--color-text-secondary)">${formatDate(p.date)}</span></div></div>`;
  }).join('')}</div>`;
}

// --- MODALLAR VE FORM MANTIĞI ---
function goTab(name){
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',['dashboard','courses','students','payments'][i]===name));
  document.querySelectorAll('.sec').forEach(s=>s.classList.remove('active'));
  document.getElementById('sec-'+name).classList.add('active');
}

function closeM(id){ document.getElementById(id).classList.remove('open'); }

function openM(id, editId = null, extraParam = null){
  if(id==='mCourse'){
    if(editId) {
      editCourseId = editId; const c = getCourse(editId);
      document.getElementById('c-name').value = c.name; document.getElementById('c-start').value = c.startDate || ''; document.getElementById('c-end').value = c.endDate || '';     
      document.getElementById('c-feeNormal').value = c.feeNormal; document.getElementById('c-feeEarly').value = c.feeEarly; document.getElementById('c-deposit').value = c.deposit || ''; document.getElementById('c-capacity').value = c.capacity || '';
    } else {
      editCourseId = null; ['c-name','c-start','c-end','c-feeNormal','c-feeEarly','c-deposit','c-capacity'].forEach(x=>document.getElementById(x).value='');
    }
  }
  if(id==='mStudent'){
    document.getElementById('s-course').innerHTML='<option value="">Select a course...</option>' + S.courses.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
    document.getElementById('s-existingId').innerHTML='<option value="">Select student...</option>' + S.students.map(s=>`<option value="${s.id}">${s.fullName} (${s.email})</option>`).join('');
    toggleStudentMode();
  }
  if(id==='mPayment'){ 
    document.getElementById('p-student').innerHTML='<option value="">Select student...</option>' + S.students.map(s=>`<option value="${s.id}">${s.fullName}</option>`).join('');
    document.getElementById('p-date').value = today(); 
    if(extraParam) {
      const en = S.enrollments.find(e=>e.id===extraParam);
      if(en) { document.getElementById('p-student').value = en.studentId; loadStudentCourses(); document.getElementById('p-course').value = en.courseId; calculatePaymentSuggestion(); }
    }
  }
  document.getElementById(id).classList.add('open');
}

function toggleStudentMode() {
  const isExisting = document.querySelector('input[name="sType"]:checked').value === 'existing';
  document.getElementById('existing-student-box').style.display = isExisting ? 'flex' : 'none';
  document.getElementById('new-student-box').style.display = isExisting ? 'none' : 'block';
}

function loadStudentCourses() {
   const sId = document.getElementById('p-student').value;
   const cBox = document.getElementById('p-course-box');
   const cSelect = document.getElementById('p-course');
   if(!sId) { cBox.style.display = 'none'; return; }
   const studentEnrollments = S.enrollments.filter(e => e.studentId === sId);
   cSelect.innerHTML = '<option value="">Select course...</option>' + studentEnrollments.map(en => `<option value="${en.courseId}">${getCourse(en.courseId)?.name}</option>`).join('');
   cBox.style.display = 'flex';
}

function showEnrollmentDetail(enId) {
  const en = S.enrollments.find(x=>x.id===enId); if(!en) return;
  const s = getStudent(en.studentId); const course = getCourse(en.courseId);
  const paid = getEnrollmentPaid(en.studentId, en.courseId); const rem = Number(en.totalFee) - paid;
  const payments = S.payments.filter(p=>p.studentId===en.studentId && p.courseId===en.courseId).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  
  document.getElementById('sd-title').innerHTML = `<i class="ti ti-user"></i> ${s.fullName}`;
  document.getElementById('sd-body').innerHTML = `
    <div class="detail-panel"><div class="detail-grid">
        <span class="dk">Course</span><span class="dv">${course?.name}</span>
        <span class="dk">Email</span><span class="dv">${s.email}</span>
        <span class="dk">Outstanding</span><span class="dv" style="color:red">${fmt(rem)}</span>
    </div></div>
    <div style="font-size:14px;font-weight:600;margin-bottom:12px">Payment History</div>
    ${payments.map(p=>`<div class="payment-entry"><span>${fmt(p.amount)} (${p.type})</span><span>${formatDate(p.date)}</span></div>`).join('')}
  `;
  document.getElementById('sd-footer').innerHTML = `<button class="btn" onclick="closeM('mStudentDetail')">Close</button><button class="btn primary" onclick="closeM('mStudentDetail'); openM('mPayment', null, '${en.id}')">Add Payment</button>`;
  openM('mStudentDetail');
}

function toggleInstalmentFields() { document.getElementById('instalment-container').style.display = (document.getElementById('s-payType').value === 'instalment') ? 'block' : 'none'; updateInstalments(); }

function updateInstalments() {
  const courseId = document.getElementById('s-course').value;
  const course = S.courses.find(c => c.id === courseId);
  let totalFee = course ? (document.getElementById('s-priceType').value === 'early_bird' ? course.feeEarly : course.feeNormal) : 0;
  document.getElementById('s-displayTotal').value = totalFee ? fmt(totalFee) : '';
  const container = document.getElementById('dynamic-instalments'); container.innerHTML = '';
  if (document.getElementById('s-payType').value !== 'instalment') return;
  const num = parseInt(document.getElementById('s-numInstalments').value) || 0;
  const deposit = parseFloat(document.getElementById('s-depositAmount').value) || 0;
  const remaining = Math.max(0, totalFee - deposit);
  if (num > 0) {
    const amountPerInst = (remaining / num).toFixed(2);
    for (let i = 1; i <= num; i++) {
      container.innerHTML += `<div class="form-2col dynamic-row"><div class="fg"><label>Instalment ${i}</label><input type="number" class="inst-amount" value="${amountPerInst}"></div><div class="fg"><label>Date</label><input type="date" class="inst-date"></div></div>`;
    }
  }
}

function calculatePaymentSuggestion() {
  const sId = document.getElementById('p-student').value, cId = document.getElementById('p-course').value;
  const suggBox = document.getElementById('smart-suggestion');
  if(!sId || !cId) { suggBox.style.display = 'none'; return; }
  const en = S.enrollments.find(x => x.studentId === sId && x.courseId === cId);
  const paid = getEnrollmentPaid(sId, cId); const remaining = Math.max(0, Number(en.totalFee) - paid);
  suggBox.style.display = 'block';
  document.getElementById('ss-title').innerHTML = '<i class="ti ti-bulb"></i> Suggested';
  document.getElementById('ss-desc').innerHTML = `Remaining: <b>${fmt(remaining)}</b>`;
  document.getElementById('p-amount').value = remaining.toFixed(2);
}

// --- KAYIT İŞLEMLERİ (ÇİFT KAYIT ENGELİ VE BUTON KİLİDİ) ---
async function saveCourse(){
  const btn = document.getElementById('btn-save-course'); btn.disabled = true;
  const p = { id: editCourseId||uid(), name: document.getElementById('c-name').value, startDate: document.getElementById('c-start').value, endDate: document.getElementById('c-end').value, feeNormal: document.getElementById('c-feeNormal').value, feeEarly: document.getElementById('c-feeEarly').value, deposit: document.getElementById('c-deposit').value, capacity: document.getElementById('c-capacity').value };
  await fetch(cfg.url, { method:'POST', body: JSON.stringify({ action: editCourseId?'updateCourse':'addCourse', payload: p, currentUser: sessionStorage.getItem('username') }) });
  closeM('mCourse'); syncSheets(); btn.disabled = false;
}

async function enrollStudent(){
  const btn = document.getElementById('btn-save-student'); btn.disabled = true;
  const isExisting = document.querySelector('input[name="sType"]:checked').value === 'existing';
  const studentId = isExisting ? document.getElementById('s-existingId').value : uid();
  const studentData = isExisting ? {} : { id: studentId, fullName: document.getElementById('s-fullname').value, email: document.getElementById('s-email').value, phone: document.getElementById('s-phone').value };
  
  let instPlan = [];
  document.querySelectorAll('.dynamic-row').forEach(row => {
    instPlan.push({ amount: row.querySelector('.inst-amount').value, date: row.querySelector('.inst-date').value });
  });

  const p = { enrollmentId: uid(), isNew: !isExisting, studentId, studentData, courseId: document.getElementById('s-course').value, priceType: document.getElementById('s-priceType').value, totalFee: document.getElementById('s-displayTotal').value.replace(/[^0-9.]/g,''), depositAmount: document.getElementById('s-depositAmount').value, depositDate: document.getElementById('s-depositDate').value, paymentType: document.getElementById('s-payType').value, instalmentPlan: JSON.stringify(instPlan) };
  
  const res = await fetch(cfg.url, { method:'POST', body: JSON.stringify({ action: 'enrollStudent', payload: p, currentUser: sessionStorage.getItem('username') }) });
  const data = await res.json();
  if(!data.success) alert(data.error); else { closeM('mStudent'); syncSheets(); }
  btn.disabled = false;
}

async function savePayment(){
  const p = { id:uid(), studentId: document.getElementById('p-student').value, courseId: document.getElementById('p-course').value, amount: document.getElementById('p-amount').value, date: document.getElementById('p-date').value, type: document.getElementById('p-type').value, note: document.getElementById('p-note').value };
  await fetch(cfg.url, { method:'POST', body: JSON.stringify({ action: 'addPayment', payload: p, currentUser: sessionStorage.getItem('username') }) });
  closeM('mPayment'); syncSheets();
}
