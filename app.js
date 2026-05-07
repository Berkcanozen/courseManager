/**
 * MEISNER STUDIO - COURSE MANAGEMENT SYSTEM
 * Frontend Logic - v2.4.0 (Crash-Proof Modals & ID-Based Status)
 */

let S = { courses:[], students:[], enrollments:[], payments:[], generalStatus:[] };

// DİKKAT: BURAYA KENDİ GOOGLE APPS SCRIPT URL'Nİ YAPIŞTIR!
let cfg = { 
  url: 'https://script.google.com/macros/s/AKfycbxndr1dMS3PJlKPGB9d0KylW9oSkCz61sWjls2DX5yYOULPnIFdguUED-8Jy9662V-1kQ/exec', 
  currency: '€' 
};

let editCourseId = null;
let editEnrollmentId = null;
let editStudentIdentityId = null;

const fmt = n => cfg.currency + Number(n||0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const today = () => new Date().toISOString().split('T')[0];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);

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

// STATUS GETİRİCİ: Artık ID'ye göre isim ve renk bulur
const getStatusBadge = (statusId) => {
    const colors = { active: 'teal', completed: 'blue', draft: 'amber', cancelled: 'red' };
    const st = (S.generalStatus || []).find(s => s.id == statusId);
    const label = st ? st.name : (statusId || 'Unknown');
    const colorCode = st ? st.code : 'blue'; 
    return `<span class="chip ${colors[colorCode] || 'blue'}">${label}</span>`;
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
    S = { courses: d.courses||[], students: d.students||[], enrollments: d.enrollments||[], payments: d.payments||[], generalStatus: d.generalStatus||[] };
    document.getElementById('syncBadge').innerHTML = '<i class="ti ti-cloud-check" style="color:var(--color-brand)"></i> Live Sync Active';
    populateStudentSearch();
    render();
  }catch(e){ document.getElementById('syncBadge').innerHTML = '<i class="ti ti-cloud-x" style="color:#ef4444"></i> Sync Error'; }
}

function populateStudentSearch() {
    const dl = document.getElementById('student-datalist');
    if(dl) dl.innerHTML = S.students.map(s => `<option data-id="${s.id}" value="${s.fullName} (${s.email})">`).join('');
}

function captureSelectedStudent() {
    const val = document.getElementById('e-search-input').value;
    const option = document.querySelector(`#student-datalist option[value="${val}"]`);
    document.getElementById('e-selected-student-id').value = option ? option.getAttribute('data-id') : "";
}

function getEnrollmentPaid(studentId, courseId){ return S.payments.filter(p => p.studentId == studentId && p.courseId == courseId).reduce((a,p)=>a+Number(p.amount),0); }
function getCourse(id){ return S.courses.find(c=>c.id==id); }
function getStudent(id){ return S.students.find(s=>s.id==id); }

// --- RENDER FONKSİYONLARI ---
function render(){ renderStats(); renderDash(); renderCourses(); renderStudents(); renderEnrollments(); renderPayments(); }

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
  if(!S.courses.length){ box.innerHTML='<div class="empty">No courses yet.</div>'; return; }
  box.innerHTML = S.courses.map(c=>{
    const enrolls = S.enrollments.filter(e=>e.courseId==c.id);
    const totalDue = enrolls.reduce((a,e)=>a+Number(e.totalFee||0),0);
    const totalPaid = enrolls.reduce((a,e)=>a+getEnrollmentPaid(e.studentId, c.id),0);
    const pct = totalDue>0?Math.round(totalPaid/totalDue*100):0;
    const barCls = pct>=100?'':pct<50?'danger':'warn';
    return `<div class="card"><div class="card-hd"><div><b>${c.name}</b><br><small>${enrolls.length} student(s) enrolled</small></div>${getStatusBadge(c.status)}</div><div class="bar-bg"><div class="bar-fill ${barCls}" style="width:${Math.min(100,pct)}%"></div></div><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--color-text-secondary);margin-top:6px"><span>${fmt(totalPaid)} Paid</span><span>${fmt(totalDue-totalPaid)} Remaining</span></div></div>`;
  }).join('');
}

function renderCourses(){
  const box = document.getElementById('courseList');
  if(!S.courses.length){ box.innerHTML='<div class="empty">No courses yet.</div>'; return; }
  box.innerHTML = S.courses.map(c=>{
    const enrolls = S.enrollments.filter(e=>e.courseId==c.id).length;
    return `<div class="card"><div class="card-hd"><div><b>${c.name}</b><br><small>${formatDate(c.startDate)} to ${formatDate(c.endDate)}</small></div><div style="display:flex;gap:6px;align-items:center">${getStatusBadge(c.status)} <span class="chip blue">${enrolls}${c.capacity?'/'+c.capacity:''} Students</span><button class="btn ghost sm" onclick="openM('mCourse', '${c.id}')"><i class="ti ti-edit"></i></button></div></div><div class="meta-row"><span><i class="ti ti-tag"></i> Normal: ${fmt(c.feeNormal)}</span><span><i class="ti ti-discount-check" style="color:var(--color-brand)"></i> Early Bird: ${fmt(c.feeEarly)}</span></div></div>`;
  }).join('');
}

function renderStudents() {
  const box = document.getElementById('studentDBList');
  const sInput = document.getElementById('s-search');
  const term = sInput ? sInput.value.toLowerCase() : '';
  const filtered = S.students.filter(s => s.fullName.toLowerCase().includes(term) || s.email.toLowerCase().includes(term));
  if(!filtered.length){ box.innerHTML='<div class="empty">No students found.</div>'; return; }
  const avCls = ['av-t','av-b','av-a'];
  box.innerHTML = `<div class="card" style="padding:4px 16px">${filtered.map((s,i)=>{
    const enrolls = S.enrollments.filter(e=>e.studentId==s.id).length;
    const initials = s.fullName.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
    return `<div class="student-row"><div class="avatar ${avCls[i%3]}">${initials}</div><div class="student-info"><div class="student-name">${s.fullName}</div><div class="student-sub">${s.email} ${s.phone?'· '+s.phone:''}</div></div><div style="display:flex; align-items:center; gap:16px;"><span style="font-size:12px; color:var(--color-text-secondary);">${enrolls} course(s)</span><button class="btn ghost sm" onclick="openM('mStudentEdit', '${s.id}')"><i class="ti ti-edit"></i></button></div></div>`;
  }).join('')}</div>`;
}

function renderEnrollments(){
  const box = document.getElementById('enrollmentList');
  if(!S.enrollments.length){ box.innerHTML='<div class="empty">No enrollments yet.</div>'; return; }
  const avCls = ['av-t','av-b','av-a'];
  box.innerHTML = `<div class="card" style="padding:4px 16px">${S.enrollments.map((en,i)=>{
    const s = getStudent(en.studentId); if(!s) return '';
    const paid = getEnrollmentPaid(en.studentId, en.courseId);
    const total = Number(en.totalFee||0); const pct = total>0?Math.round(paid/total*100):100;
    const barCls = pct>=100?'':pct<50?'danger':'warn';
    const initials = s.fullName.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
    const course = getCourse(en.courseId);
    return `<div class="student-row" onclick="showEnrollmentDetail('${en.id}')"><div class="avatar ${avCls[i%3]}">${initials}</div><div class="student-info"><div class="student-name">${s.fullName}</div><div class="student-sub">${course?course.name:'—'} · <span style="color:${en.priceType==='early_bird'?'var(--color-brand)':'inherit'}">${en.priceType==='early_bird'?'Early Bird':'Normal'}</span></div></div><div class="pay-summary"><div class="pay-amount ${pct>=100?'g':pct<50?'r':'a'}">${fmt(paid)} / ${fmt(total)}</div><div class="pay-label">Total Fee</div><div class="bar-bg"><div class="bar-fill ${barCls}" style="width:${Math.min(100,pct)}%"></div></div></div></div>`;
  }).join('')}</div>`;
}

function renderPayments(){
  const box = document.getElementById('paymentList');
  if(!S.payments.length){ box.innerHTML='<div class="empty">No payments recorded yet.</div>'; return; }
  const sorted = [...S.payments].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  box.innerHTML = `<div class="card" style="padding:4px 16px">${sorted.map(p=>{
    const s = getStudent(p.studentId); const c = getCourse(p.courseId);
    const clr = p.type==='deposit'?'amber':p.type==='full'?'teal':'blue';
    return `<div class="payment-entry"><div><span style="font-weight:600">${s?s.fullName:'—'}</span><span class="chip ${clr}" style="margin-left:8px;font-size:10px">${p.type}</span><div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px">${c?c.name:'Unknown'}</div></div><div style="display:flex;align-items:center;gap:12px"><span style="font-weight:600;color:var(--color-brand);font-size:14px">+${fmt(p.amount)}</span><span style="font-size:12px;color:var(--color-text-secondary)">${formatDate(p.date)}</span></div></div>`;
  }).join('')}</div>`;
}

// --- MODALLAR VE FORM MANTIĞI ---
function goTab(name){
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',['dashboard','courses','students','enrollments','payments'][i]===name));
  document.querySelectorAll('.sec').forEach(s=>s.classList.remove('active'));
  document.getElementById('sec-'+name).classList.add('active');
}

function closeM(id){ 
    const el = document.getElementById(id);
    if(el) el.classList.remove('open'); 
}

// Güvenli (Try-Catch) Modal Açıcı
function openM(id, editId = null, extraParam = null){
  try {
      if(id==='mCourse'){
        const stSelect = document.getElementById('c-status');
        // Statusleri ID'ye göre listele:
        if(stSelect) stSelect.innerHTML = (S.generalStatus||[]).filter(s => s.entity === 'course').map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        
        if(editId) {
          editCourseId = editId; const c = getCourse(editId) || {};
          document.getElementById('modal-title-course').innerHTML = 'Edit Course'; 
          document.getElementById('btn-save-course').textContent = 'Update';
          document.getElementById('c-name').value = c.name || ''; 
          document.getElementById('c-start').value = c.startDate || ''; 
          document.getElementById('c-end').value = c.endDate || '';     
          document.getElementById('c-feeNormal').value = c.feeNormal || ''; 
          document.getElementById('c-feeEarly').value = c.feeEarly || ''; 
          document.getElementById('c-deposit').value = c.deposit || ''; 
          document.getElementById('c-capacity').value = c.capacity || '';
          document.getElementById('c-status').value = c.status || '';
        } else {
          editCourseId = null; 
          document.getElementById('modal-title-course').innerHTML = 'New Course'; 
          document.getElementById('btn-save-course').textContent = 'Create';
          ['c-name','c-start','c-end','c-feeNormal','c-feeEarly','c-deposit','c-capacity'].forEach(x=>{if(document.getElementById(x)) document.getElementById(x).value=''});
          // İlk statü id'sini default olarak ata
          if(S.generalStatus && S.generalStatus.length > 0) document.getElementById('c-status').value = S.generalStatus[0].id;
        }
      }
      
      if(id==='mStudentEdit') {
          editStudentIdentityId = editId; const s = getStudent(editId) || {};
          document.getElementById('se-fullname').value = s.fullName || ''; 
          document.getElementById('se-email').value = s.email || ''; 
          document.getElementById('se-phone').value = s.phone || '';
      }

      if(id==='mEnrollment'){
        document.getElementById('e-course').innerHTML='<option value="">Select course...</option>' + S.courses.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
        document.getElementById('e-search-input').value = ""; document.getElementById('e-selected-student-id').value = "";
        
        if(editId) {
            editEnrollmentId = editId; const en = S.enrollments.find(e=>e.id==editId) || {};
            document.getElementById('modal-title-enrollment').innerHTML = 'Edit Enrollment';
            document.getElementById('btn-save-enrollment').textContent = 'Update Enrollment';
            document.getElementById('e-type-box').style.display='none'; document.getElementById('e-existing-box').style.display='none'; document.getElementById('e-new-box').style.display='none';
            
            document.getElementById('e-course').value = en.courseId || ''; document.getElementById('e-course').disabled = true;
            document.getElementById('e-priceType').value = en.priceType || 'normal'; 
            document.getElementById('e-depositAmount').value = en.depositAmount||''; 
            document.getElementById('e-depositDate').value = en.depositDate||''; 
            document.getElementById('e-payType').value = en.paymentType || 'full_remaining';
            
            toggleInstalmentFields();
            if(en.paymentType === 'instalment') {
                try {
                  const plan = JSON.parse(en.instalmentPlan); document.getElementById('e-numInstalments').value = plan.length; updateInstalments();
                  const amounts = document.querySelectorAll('.inst-amount'); const dates = document.querySelectorAll('.inst-date');
                  plan.forEach((inst, i) => { if(amounts[i]) amounts[i].value = inst.amount; if(dates[i]) dates[i].value = inst.date; });
                } catch(e){}
            } else { document.getElementById('e-numInstalments').value = ''; }
            document.getElementById('e-displayTotal').value = fmt(en.totalFee);
        } else {
            editEnrollmentId = null; 
            document.getElementById('modal-title-enrollment').innerHTML = 'Enroll Student';
            document.getElementById('btn-save-enrollment').textContent = 'Save Enrollment';
            document.getElementById('e-type-box').style.display='block'; document.getElementById('e-course').disabled = false;
            ['e-course','e-fullname','e-email','e-phone','e-depositAmount','e-depositDate','e-numInstalments'].forEach(x=>{if(document.getElementById(x)) document.getElementById(x).value=''});
            document.getElementById('e-priceType').value='normal'; document.getElementById('e-payType').value='full_remaining';
            const radio = document.querySelector('input[name="eType"][value="existing"]');
            if(radio) radio.checked = true; 
            toggleStudentMode(); toggleInstalmentFields(); document.getElementById('e-displayTotal').value = '';
        }
      }
      
      if(id==='mPayment'){ 
        document.getElementById('p-student').innerHTML='<option value="">Select student...</option>' + S.students.map(s=>`<option value="${s.id}">${s.fullName}</option>`).join('');
        document.getElementById('p-date').value = today(); document.getElementById('p-amount').value=''; document.getElementById('p-note').value='';
        document.getElementById('smart-suggestion').style.display='none'; document.getElementById('p-course-box').style.display='none';
        if(extraParam) { 
          const en = S.enrollments.find(e=>e.id==extraParam);
          if(en) { document.getElementById('p-student').value = en.studentId; loadStudentCourses(); document.getElementById('p-course').value = en.courseId; calculatePaymentSuggestion(); }
        }
      }

  } catch (err) {
      console.error("Modal preparation failed:", err);
  }

  const modalElement = document.getElementById(id);
  if(modalElement) {
      modalElement.classList.add('open');
  } else {
      console.error("Modal ID not found in HTML:", id);
  }
}

function toggleStudentMode() {
  const isExisting = document.querySelector('input[name="eType"]:checked').value === 'existing';
  document.getElementById('e-existing-box').style.display = isExisting ? 'block' : 'none';
  document.getElementById('e-new-box').style.display = isExisting ? 'none' : 'block';
}

function loadStudentCourses() {
   const sId = document.getElementById('p-student').value, cBox = document.getElementById('p-course-box'), cSelect = document.getElementById('p-course');
   if(!sId) { cBox.style.display = 'none'; return; }
   const enrolls = S.enrollments.filter(e => e.studentId == sId);
   cSelect.innerHTML = '<option value="">Select course...</option>' + enrolls.map(en => `<option value="${en.courseId}">${getCourse(en.courseId)?.name}</option>`).join('');
   cBox.style.display = 'block';
}

function showEnrollmentDetail(enId) {
  const en = S.enrollments.find(x=>x.id==enId); if(!en) return;
  const s = getStudent(en.studentId); const course = getCourse(en.courseId);
  const paid = getEnrollmentPaid(en.studentId, en.courseId); const rem = Number(en.totalFee) - paid;
  const payments = S.payments.filter(p=>p.studentId==en.studentId && p.courseId==en.courseId).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  
  let planHtml = '';
  if (en.paymentType === 'instalment' && en.instalmentPlan) {
    try {
      const plan = JSON.parse(en.instalmentPlan);
      planHtml = `<div style="margin-top:12px; padding:10px; background:#fff; border:1px solid var(--color-border-secondary); border-radius:6px;">
        <strong style="display:block; margin-bottom:6px; color:var(--color-text-primary);">Instalment Schedule</strong>` +
        plan.map((inst, i) => `<div style="display:flex; justify-content:space-between; font-size:12px; border-bottom:1px solid var(--color-border-tertiary); padding:4px 0;"><span>Instalment ${i+1}</span><span>${fmt(inst.amount)} (Due: ${formatDate(inst.date)})</span></div>`).join('') + `</div>`;
    } catch(e) {}
  }
  
  document.getElementById('sd-title').innerHTML = `Enrollment Detail`;
  document.getElementById('sd-body').innerHTML = `
    <div class="detail-panel"><div class="detail-grid">
        <span class="dk">Student</span><span class="dv">${s.fullName}</span>
        <span class="dk">Course</span><span class="dv">${course?.name}</span>
        <span class="dk">Price Tier</span><span class="dv" style="color:${en.priceType==='early_bird'?'var(--color-brand)':'inherit'}">${en.priceType==='early_bird'?'Early Bird':'Normal'}</span>
        <span class="dk">Deposit Due</span><span class="dv">${formatDate(en.depositDate)} (${fmt(en.depositAmount)})</span>
    </div>${planHtml}</div>
    <div class="stats-grid" style="margin-bottom:16px"><div class="stat"><div class="lbl">Total Fee</div><div class="val b">${fmt(en.totalFee)}</div></div><div class="stat"><div class="lbl">Paid</div><div class="val g">${fmt(paid)}</div></div><div class="stat"><div class="lbl">Remaining</div><div class="val ${rem>0?'r':'g'}">${fmt(rem)}</div></div></div>
    <div style="font-size:14px;font-weight:600;margin-bottom:12px">Payment History (This Course)</div>
    ${payments.length?`<div class="card" style="padding:4px 16px">${payments.map(p=>`<div class="payment-entry"><div><span style="font-weight:600; font-size:14px">${fmt(p.amount)}</span><span class="chip ${p.type==='deposit'?'amber':p.type==='full'?'teal':'blue'}" style="margin-left:8px;font-size:10px">${p.type}</span></div><div style="text-align:right;color:var(--color-text-secondary)">${formatDate(p.date)}${p.note?' · '+p.note:''}</div></div>`).join('')}</div>`:'<div style="font-size:13px;color:var(--color-text-secondary);padding:10px 0;text-align:center;background:#f9fafb;border-radius:8px">No payments recorded.</div>'}
  `;
  document.getElementById('sd-footer').innerHTML = `<button class="btn ghost" onclick="closeM('mStudentDetail')">Close</button><button class="btn" onclick="closeM('mStudentDetail'); openM('mEnrollment', '${en.id}')"><i class="ti ti-edit"></i> Edit Plan</button><button class="btn primary" onclick="closeM('mStudentDetail'); openM('mPayment', null, '${en.id}')">Add Payment</button>`;
  openM('mStudentDetail');
}

function toggleInstalmentFields() { document.getElementById('instalment-container').style.display = (document.getElementById('e-payType').value === 'instalment') ? 'block' : 'none'; updateInstalments(); }

function updateInstalments() {
  const cId = document.getElementById('e-course').value; const course = S.courses.find(c => c.id == cId);
  let totalFee = course ? (document.getElementById('e-priceType').value === 'early_bird' ? course.feeEarly : course.feeNormal) : 0;
  document.getElementById('e-displayTotal').value = totalFee ? fmt(totalFee) : '';
  const container = document.getElementById('dynamic-instalments'); container.innerHTML = '';
  if (document.getElementById('e-payType').value !== 'instalment') return;
  const num = parseInt(document.getElementById('e-numInstalments').value) || 0, deposit = parseFloat(document.getElementById('e-depositAmount').value) || 0;
  const rem = Math.max(0, totalFee - deposit);
  if (num > 0) {
    const amt = (rem / num).toFixed(2);
    for (let i = 1; i <= num; i++) container.innerHTML += `<div class="form-2col dynamic-row"><div class="fg"><label>Instalment ${i} (€)</label><input type="number" class="inst-amount" value="${amt}"></div><div class="fg"><label>Date</label><input type="date" class="inst-date"></div></div>`;
  }
}

function calculatePaymentSuggestion() {
  const sId = document.getElementById('p-student').value, cId = document.getElementById('p-course').value;
  const suggBox = document.getElementById('smart-suggestion'); suggBox.classList.remove('success');
  if(!sId || !cId) { suggBox.style.display = 'none'; return; }
  const en = S.enrollments.find(x => x.studentId == sId && x.courseId == cId);
  const paid = getEnrollmentPaid(sId, cId); const rem = Math.max(0, Number(en.totalFee) - paid);
  if(rem === 0) {
    suggBox.style.display = 'block'; suggBox.classList.add('success');
    document.getElementById('ss-title').innerHTML = '<i class="ti ti-circle-check"></i> Fully Paid!'; document.getElementById('ss-desc').innerHTML = 'No outstanding balance.';
    document.getElementById('p-amount').value = 0; document.getElementById('p-type').value = 'other'; return;
  }
  let nAmt = rem, nType = 'full', nText = `Remaining Balance: <b>${fmt(rem)}</b>`;
  const dep = Number(en.depositAmount || 0);
  if(dep > 0 && paid < dep) { nAmt = dep - paid; nType = 'deposit'; nText = `Expected Deposit: <b>${fmt(nAmt)}</b>`; } 
  else if (en.paymentType === 'instalment' && en.instalmentPlan) {
     try {
        const plan = JSON.parse(en.instalmentPlan); let acc = dep, found = false;
        for(let i=0; i<plan.length; i++) {
           acc += Number(plan[i].amount);
           if (paid < acc) { nAmt = Number(plan[i].amount) - Math.max(0, paid - (acc - Number(plan[i].amount))); nType = 'instalment'; nText = `Next due: <b>Instalment ${i+1}</b> (${fmt(nAmt)})`; found = true; break; }
        }
        if(!found) { nAmt = rem; nType = 'instalment'; }
     } catch(e) {}
  }
  suggBox.style.display = 'block'; document.getElementById('ss-title').innerHTML = '<i class="ti ti-bulb"></i> Suggested'; document.getElementById('ss-desc').innerHTML = nText;
  document.getElementById('p-amount').value = parseFloat(nAmt).toFixed(2); document.getElementById('p-type').value = nType;
}

// --- VERİTABANINA KAYIT (BUTON KİLİTLİ) ---
async function saveCourse(){
  const name = document.getElementById('c-name').value.trim(); if(!name) return alert('Name is required.');
  const btn = document.getElementById('btn-save-course'), oldTxt = btn.innerHTML; btn.innerHTML = '<i class="ti ti-loader"></i> Saving...'; btn.disabled = true;
  const p = { id: editCourseId, name, status: document.getElementById('c-status').value, startDate: document.getElementById('c-start').value, endDate: document.getElementById('c-end').value, feeNormal: document.getElementById('c-feeNormal').value, feeEarly: document.getElementById('c-feeEarly').value, deposit: document.getElementById('c-deposit').value, capacity: document.getElementById('c-capacity').value };
  try { await fetch(cfg.url, { method:'POST', body: JSON.stringify({ action: editCourseId?'updateCourse':'addCourse', payload: p, currentUser: sessionStorage.getItem('username') }) }); closeM('mCourse'); syncSheets(); } catch(e) { alert("Error saving"); } finally { btn.innerHTML = oldTxt; btn.disabled = false; }
}

async function saveStudentIdentity(){
  const fullName = document.getElementById('se-fullname').value.trim(); if(!fullName) return alert('Name required');
  const btn = document.getElementById('btn-save-st'), oldTxt = btn.innerHTML; btn.innerHTML = '<i class="ti ti-loader"></i> Saving...'; btn.disabled = true;
  const p = { id: editStudentIdentityId, fullName, email: document.getElementById('se-email').value, phone: document.getElementById('se-phone').value };
  try { await fetch(cfg.url, { method:'POST', body: JSON.stringify({ action: 'updateStudent', payload: p, currentUser: sessionStorage.getItem('username') }) }); closeM('mStudentEdit'); syncSheets(); } catch(e) { alert("Error saving"); } finally { btn.innerHTML = oldTxt; btn.disabled = false; }
}

async function saveEnrollment(){
  const courseId = document.getElementById('e-course').value; if(!courseId) return alert('Course is required.');
  let studentId = '', studentData = {};
  
  if(!editEnrollmentId) {
      const isExisting = document.querySelector('input[name="eType"]:checked').value === 'existing';
      if(isExisting) { 
          studentId = document.getElementById('e-selected-student-id').value; 
          if(!studentId) return alert("Select a student from the list."); 
      } else {
          const fn = document.getElementById('e-fullname').value.trim(), em = document.getElementById('e-email').value.trim();
          if(!fn || !em) return alert("Name and email required.");
          studentData = { fullName: fn, email: em, phone: document.getElementById('e-phone').value };
      }
      if(studentId && S.enrollments.find(e => e.studentId == studentId && e.courseId == courseId)) return alert("Already enrolled in this course!");
  }

  let instPlan = [];
  document.querySelectorAll('.dynamic-row').forEach(row => { instPlan.push({ amount: row.querySelector('.inst-amount').value, date: row.querySelector('.inst-date').value }); });

  const btn = document.getElementById('btn-save-enrollment'), oldTxt = btn.innerHTML; btn.innerHTML = '<i class="ti ti-loader"></i> Saving...'; btn.disabled = true;
  const p = { enrollmentId: editEnrollmentId, isNew: (!editEnrollmentId && document.querySelector('input[name="eType"]:checked').value === 'new'), studentId, studentData, courseId, priceType: document.getElementById('e-priceType').value, totalFee: document.getElementById('e-displayTotal').value.replace(/[^0-9.]/g,''), depositAmount: document.getElementById('e-depositAmount').value, depositDate: document.getElementById('e-depositDate').value, paymentType: document.getElementById('e-payType').value, instalmentPlan: JSON.stringify(instPlan) };
  
  try {
    const res = await fetch(cfg.url, { method:'POST', body: JSON.stringify({ action: editEnrollmentId?'updateEnrollment':'enrollStudent', payload: p, currentUser: sessionStorage.getItem('username') }) });
    const data = await res.json();
    if(!data.success) alert(data.error); else { closeM('mEnrollment'); syncSheets(); }
  } catch(e) { alert("Connection Error"); } finally { btn.innerHTML = oldTxt; btn.disabled = false; }
}

async function savePayment(){
  const sId = document.getElementById('p-student').value, cId = document.getElementById('p-course').value, amt = parseFloat(document.getElementById('p-amount').value);
  if(!sId || !cId || !amt) return alert('Student, Course, and Amount required.');
  const btn = document.getElementById('btn-save-payment'), oldTxt = btn.innerHTML; btn.innerHTML = '<i class="ti ti-loader"></i> Saving...'; btn.disabled = true;
  const p = { studentId: sId, courseId: cId, amount: amt, date: document.getElementById('p-date').value, type: document.getElementById('p-type').value, note: document.getElementById('p-note').value };
  try { await fetch(cfg.url, { method:'POST', body: JSON.stringify({ action: 'addPayment', payload: p, currentUser: sessionStorage.getItem('username') }) }); closeM('mPayment'); syncSheets(); } catch(e) { alert("Connection Error"); } finally { btn.innerHTML = oldTxt; btn.disabled = false; }
}
