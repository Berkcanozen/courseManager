// YENİ YAPI: Öğrenciler (Students) ve Kayıtlar (Enrollments) ayrıldı
let S = { courses:[], students:[], enrollments:[], payments:[] };

// DİKKAT: BURAYA YENİ ALDIĞIN GOOGLE APPS SCRIPT URL'Nİ YAPIŞTIR!
let cfg = { 
  url: 'https://script.google.com/macros/s/AKfycbzfS8vHk9JU-9scOMWF9ewdo_oswZQCG56OI_ba2q5Cc9cAm4F2FY0H74vz360JN0FVSA/exec', 
  currency: '€' 
};

let editCourseId = null;
let editEnrollmentId = null;

const fmt = n => cfg.currency + Number(n||0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const today = () => new Date().toISOString().split('T')[0];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);

const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${d.getFullYear()}`;
};

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
        } else { throw new Error("Bad Response"); }
    } catch(e) {
        badge.innerHTML = '<i class="ti ti-cloud-x" style="color:#ef4444"></i> Connection Error (Check CORS/URL)';
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
      e.innerText = "Invalid credentials. Please try again."; e.style.display = "block"; b.innerText = "Sign In"; b.disabled = false;
    }
  } catch (err) {
    e.innerText = "Connection Error! Ensure Apps Script is deployed to 'Anyone'."; e.style.display = "block"; b.innerText = "Sign In"; b.disabled = false;
  }
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
  }catch(e){ document.getElementById('syncBadge').innerHTML = '<i class="ti ti-cloud-x" style="color:#ef4444"></i> Sync Error'; }
  render();
}

// YENİ: Artık ödemeler öğrenci+kurs bazında hesaplanıyor. (Enrollment bazında)
function getEnrollmentPaid(studentId, courseId){ 
    return S.payments.filter(p => p.studentId === studentId && p.courseId === courseId).reduce((a,p)=>a+Number(p.amount),0); 
}
function getCourse(id){ return S.courses.find(c=>c.id===id); }
function getStudent(id){ return S.students.find(s=>s.id===id); }

function render(){ renderStats(); renderDash(); renderCourses(); renderEnrollments(); renderPayments(); }

function renderStats(){
  const collected = S.payments.reduce((a,p)=>a+Number(p.amount),0);
  const outstanding = S.enrollments.reduce((a,en)=> a + Math.max(0, Number(en.totalFee||0)-getEnrollmentPaid(en.studentId, en.courseId)), 0);
  document.getElementById('st-courses').textContent = S.courses.length;
  document.getElementById('st-students').textContent = S.students.length; // Unique students
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
  const avCls = ['av-t','av-b','av-a'];
  box.innerHTML = `<div class="card" style="padding:4px 16px">${S.enrollments.map((en,i)=>{
    const s = getStudent(en.studentId);
    if(!s) return '';
    const paid = getEnrollmentPaid(en.studentId, en.courseId);
    const total = Number(en.totalFee||0);
    const pct = total>0?Math.round(paid/total*100):100;
    const barCls = pct>=100?'':pct<50?'danger':'warn';
    const nameParts = (s.fullName||'').trim().split(' ');
    const initials = (nameParts[0]?.[0]||'') + (nameParts.length>1 ? nameParts[nameParts.length-1][0] : '');
    const course = getCourse(en.courseId);
    return `<div class="student-row" onclick="showEnrollmentDetail('${en.id}')"><div class="avatar ${avCls[i%3]}">${initials.toUpperCase()}</div><div class="student-info"><div class="student-name">${s.fullName}</div><div class="student-sub">${course?course.name:'—'} · <span style="color:${en.priceType==='early_bird'?'var(--color-brand)':'inherit'}">${en.priceType==='early_bird'?'Early Bird':'Normal'}</span></div></div><div class="pay-summary"><div class="pay-amount ${pct>=100?'g':pct<50?'r':'a'}">${fmt(paid)} / ${fmt(total)}</div><div class="pay-label">Total Fee</div><div class="bar-bg"><div class="bar-fill ${barCls}" style="width:${Math.min(100,pct)}%"></div></div></div></div>`;
  }).join('')}</div>`;
}

function renderPayments(){
  const box = document.getElementById('paymentList');
  if(!S.payments.length){ box.innerHTML='<div class="empty"><i class="ti ti-coin"></i>No payments recorded yet.</div>'; return; }
  const sorted = [...S.payments].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  box.innerHTML = `<div class="card" style="padding:4px 16px">${sorted.map(p=>{
    const s = getStudent(p.studentId);
    const c = getCourse(p.courseId);
    const clr = p.type==='deposit'?'amber':p.type==='full'?'teal':'blue';
    return `<div class="payment-entry"><div><span style="font-weight:600">${s?s.fullName:'—'}</span><span class="chip ${clr}" style="margin-left:8px;font-size:10px">${p.type}</span><div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px">${c?c.name:'Unknown Course'}</div>${p.note?`<div style="font-size:12px;color:var(--color-text-secondary);margin-top:2px">${p.note}</div>`:''}</div><div style="display:flex;align-items:center;gap:12px"><span style="font-weight:600;color:var(--color-brand);font-size:14px">+${fmt(p.amount)}</span><span style="font-size:12px;color:var(--color-text-secondary)">${formatDate(p.date)}</span></div></div>`;
  }).join('')}</div>`;
}

function goTab(name){
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',['dashboard','courses','students','payments'][i]===name));
  document.querySelectorAll('.sec').forEach(s=>s.classList.remove('active'));
  document.getElementById('sec-'+name).classList.add('active');
  render();
}

function closeM(id){ document.getElementById(id).classList.remove('open'); }

function openM(id, editId = null, extraParam = null){
  if(id==='mCourse'){
    if(editId) {
      editCourseId = editId;
      document.getElementById('modal-title-course').innerHTML = '<i class="ti ti-edit"></i> Edit Course';
      document.getElementById('btn-save-course').textContent = 'Update Course';
      const c = getCourse(editId);
      document.getElementById('c-name').value = c.name; document.getElementById('c-start').value = c.startDate || ''; document.getElementById('c-end').value = c.endDate || '';     
      document.getElementById('c-feeNormal').value = c.feeNormal; document.getElementById('c-feeEarly').value = c.feeEarly; document.getElementById('c-deposit').value = c.deposit || ''; document.getElementById('c-capacity').value = c.capacity || '';
    } else {
      editCourseId = null;
      document.getElementById('modal-title-course').innerHTML = '<i class="ti ti-books"></i> New Course';
      document.getElementById('btn-save-course').textContent = 'Create Course';
      ['c-name','c-start','c-end','c-feeNormal','c-feeEarly','c-deposit','c-capacity'].forEach(x=>document.getElementById(x).value='');
    }
  }
  
  if(id==='mStudent'){
    document.getElementById('s-course').innerHTML='<option value="">Select a course...</option>' + S.courses.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
    document.getElementById('s-existingId').innerHTML='<option value="">Select student...</option>' + S.students.map(s=>`<option value="${s.id}">${s.fullName} (${s.email})</option>`).join('');
    
    // Reset Form
    document.getElementById('s-course').value=''; document.getElementById('s-priceType').value='normal'; document.getElementById('s-payType').value='full_remaining';
    ['s-fullname','s-email','s-phone','s-depositAmount','s-depositDate','s-numInstalments'].forEach(x=>document.getElementById(x).value='');
    toggleInstalmentFields(); document.getElementById('s-displayTotal').value = '';
    
    document.querySelector('input[name="sType"][value="existing"]').checked = true;
    toggleStudentMode();
  }
  
  if(id==='mPayment'){ 
    document.getElementById('p-student').innerHTML='<option value="">Select student...</option>' + S.students.map(s=>`<option value="${s.id}">${s.fullName}</option>`).join('');
    document.getElementById('p-date').value = today(); 
    document.getElementById('smart-suggestion').style.display = 'none';
    document.getElementById('p-course-box').style.display = 'none';
    document.getElementById('p-amount').value = ''; document.getElementById('p-note').value = '';
    
    if(extraParam) { // extraParam is enrollmentId now
      const en = S.enrollments.find(e=>e.id===extraParam);
      if(en) {
         document.getElementById('p-student').value = en.studentId;
         loadStudentCourses();
         document.getElementById('p-course').value = en.courseId;
         calculatePaymentSuggestion();
      }
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
   if(studentEnrollments.length === 0) {
       cBox.style.display = 'none';
       document.getElementById('smart-suggestion').style.display = 'none';
       return;
   }
   
   cSelect.innerHTML = '<option value="">Select course to pay for...</option>' + studentEnrollments.map(en => {
       const c = getCourse(en.courseId);
       return `<option value="${c.id}">${c.name}</option>`;
   }).join('');
   
   cBox.style.display = 'flex';
   document.getElementById('smart-suggestion').style.display = 'none'; // reset suggestion until course selected
}

function showEnrollmentDetail(enId) {
  const en = S.enrollments.find(x=>x.id===enId);
  if(!en) return;
  const s = getStudent(en.studentId);
  const course = getCourse(en.courseId);
  const paid = getEnrollmentPaid(en.studentId, en.courseId);
  const rem = Number(en.totalFee) - paid;
  const payments = S.payments.filter(p=>p.studentId===en.studentId && p.courseId===en.courseId).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  
  let planHtml = '';
  if (en.paymentType === 'instalment' && en.instalmentPlan) {
    try {
      const plan = JSON.parse(en.instalmentPlan);
      planHtml = `<div style="margin-top:12px; padding:10px; background:#fff; border:1px solid var(--color-border-secondary); border-radius:6px;">
        <strong style="display:block; margin-bottom:6px; color:var(--color-text-primary);">Instalment Schedule</strong>` +
        plan.map((inst, i) => `<div style="display:flex; justify-content:space-between; font-size:12px; border-bottom:1px solid var(--color-border-tertiary); padding:4px 0;"><span>Instalment ${i+1}</span><span>${fmt(inst.amount)} (Due: ${formatDate(inst.date)})</span></div>`).join('') +
        `</div>`;
    } catch(e) {}
  }
  
  document.getElementById('sd-title').innerHTML = `<i class="ti ti-user"></i> ${s.fullName}`;
  document.getElementById('sd-body').innerHTML = `
    <div class="detail-panel">
      <div class="detail-grid">
        <span class="dk">Course</span><span class="dv">${course?course.name:'—'}</span>
        <span class="dk">Email / Phone</span><span class="dv">${s.email} / ${s.phone||'—'}</span>
        <span class="dk">Price Tier</span><span class="dv" style="color:${en.priceType==='early_bird'?'var(--color-brand)':'inherit'}">${en.priceType==='early_bird'?'Early Bird Price':'Normal Price'}</span>
        <span class="dk">Deposit Due</span><span class="dv">${formatDate(en.depositDate)} (${fmt(en.depositAmount)})</span>
        <span class="dk">Payment Plan</span><span class="dv">${en.paymentType==='instalment'?'Instalments':'Full Remaining'}</span>
      </div>
      ${planHtml}
    </div>
    <div class="stats-grid" style="margin-bottom:16px">
      <div class="stat"><div class="lbl">Total Fee</div><div class="val b">${fmt(en.totalFee)}</div></div>
      <div class="stat"><div class="lbl">Paid</div><div class="val g">${fmt(paid)}</div></div>
      <div class="stat"><div class="lbl">Remaining</div><div class="val ${rem>0?'r':'g'}">${fmt(rem)}</div></div>
    </div>
    <div style="font-size:14px;font-weight:600;margin-bottom:12px;color:#111827">Payment History (This Course)</div>
    ${payments.length?`<div class="card" style="padding:4px 16px">${payments.map(p=>`
      <div class="payment-entry"><div><span style="font-weight:600; font-size:14px">${fmt(p.amount)}</span><span class="chip ${p.type==='deposit'?'amber':p.type==='full'?'teal':'blue'}" style="margin-left:8px;font-size:10px">${p.type}</span></div><div style="text-align:right;color:var(--color-text-secondary)">${formatDate(p.date)}${p.note?' · '+p.note:''}</div></div>`).join('')}</div>`:'<div style="font-size:13px;color:var(--color-text-secondary);padding:10px 0;text-align:center;background:#f9fafb;border-radius:8px">No payments recorded yet.</div>'}
  `;
  
  document.getElementById('sd-footer').innerHTML = `
    <button class="btn ghost" onclick="closeM('mStudentDetail')">Close</button>
    <button class="btn primary" onclick="closeM('mStudentDetail'); openM('mPayment', null, '${en.id}')"><i class="ti ti-plus"></i> Record Payment</button>
  `;
  openM('mStudentDetail');
}

function toggleInstalmentFields() {
  document.getElementById('instalment-container').style.display = (document.getElementById('s-payType').value === 'instalment') ? 'block' : 'none';
  updateInstalments();
}

function updateInstalments() {
  const courseId = document.getElementById('s-course').value;
  const priceType = document.getElementById('s-priceType').value;
  const course = S.courses.find(c => c.id === courseId);
  
  let totalFee = course ? (priceType === 'early_bird' ? course.feeEarly : course.feeNormal) : 0;
  document.getElementById('s-displayTotal').value = totalFee ? fmt(totalFee) : '';

  const container = document.getElementById('dynamic-instalments');
  container.innerHTML = '';

  if (document.getElementById('s-payType').value !== 'instalment') return;

  const num = parseInt(document.getElementById('s-numInstalments').value) || 0;
  const deposit = parseFloat(document.getElementById('s-depositAmount').value) || 0;
  const remaining = Math.max(0, totalFee - deposit);

  if (num > 0) {
    const amountPerInst = (remaining / num).toFixed(2);
    for (let i = 1; i <= num; i++) {
      container.innerHTML += `<div class="form-2col dynamic-row"><div class="fg"><label>Instalment ${i} Amount (€)</label><input type="number" class="inst-amount" value="${amountPerInst}"></div><div class="fg"><label>Instalment ${i} Date</label><input type="date" class="inst-date" onclick="try{this.showPicker()}catch(e){}"></div></div>`;
    }
  }
}

function calculatePaymentSuggestion() {
  const sId = document.getElementById('p-student').value;
  const cId = document.getElementById('p-course').value;
  const suggBox = document.getElementById('smart-suggestion');
  const suggTitle = document.getElementById('ss-title');
  const suggDesc = document.getElementById('ss-desc');
  const amtInput = document.getElementById('p-amount');
  const typeInput = document.getElementById('p-type');
  const noteInput = document.getElementById('p-note');
  suggBox.classList.remove('success');

  if(!sId || !cId) { suggBox.style.display = 'none'; amtInput.value = ''; noteInput.value = ''; return; }
  
  const en = S.enrollments.find(x => x.studentId === sId && x.courseId === cId);
  if(!en) return;

  const paid = getEnrollmentPaid(sId, cId);
  const total = Number(en.totalFee || 0);
  const remaining = Math.max(0, total - paid);
  
  if(remaining === 0) {
    suggBox.style.display = 'block'; suggBox.classList.add('success');
    suggTitle.innerHTML = '<i class="ti ti-circle-check"></i> Fully Paid!';
    suggDesc.innerHTML = 'This course is fully paid.';
    amtInput.value = 0; typeInput.value = 'other'; noteInput.value = '';
    return;
  }

  let nextAmount = remaining, nextType = 'full', note = '', descText = '';
  const depAmt = Number(en.depositAmount || 0);
  
  if(depAmt > 0 && paid < depAmt) {
     nextAmount = depAmt - paid; nextType = 'deposit'; note = 'Deposit Payment';
     descText = `Expected Deposit: <b>${fmt(nextAmount)}</b>`;
  } 
  else if (en.paymentType === 'instalment' && en.instalmentPlan) {
     try {
        const plan = JSON.parse(en.instalmentPlan);
        let accountedFor = depAmt; 
        let targetInstalmentIndex = -1;

        for(let i=0; i<plan.length; i++) {
           const instAmount = Number(plan[i].amount);
           accountedFor += instAmount;
           if (paid < accountedFor) {
              nextAmount = instAmount - Math.max(0, paid - (accountedFor - instAmount));
              nextType = 'instalment'; targetInstalmentIndex = i; note = `Instalment ${i + 1}`;
              descText = `Next due: <b>Instalment ${i + 1}</b> (${fmt(nextAmount)})${plan[i].date ? ' by ' + formatDate(plan[i].date) : ''}`;
              break;
           }
        }
        if(targetInstalmentIndex === -1) { nextAmount = remaining; nextType = 'instalment'; descText = `Remaining Balance: ${fmt(remaining)}`; }
     } catch(e) { nextAmount = remaining; nextType = 'instalment'; descText = `Remaining Balance: ${fmt(remaining)}`; }
  } 
  else { nextAmount = remaining; nextType = 'full'; note = 'Full Payment'; descText = `Remaining Balance: <b>${fmt(remaining)}</b>`; }

  suggBox.style.display = 'block';
  suggTitle.innerHTML = '<i class="ti ti-bulb"></i> Suggested Payment';
  suggDesc.innerHTML = descText;
  amtInput.value = parseFloat(nextAmount).toFixed(2); typeInput.value = nextType; noteInput.value = note;
}

// --- VERİTABANINA KAYIT (AUDIT LOG İLE) ---
async function saveCourse(){
  const currentUser = sessionStorage.getItem('username') || 'system';
  const name = document.getElementById('c-name').value.trim();
  if(!name) return alert('Course name is required.');
  
  const p = { id: editCourseId||uid(), name, startDate: document.getElementById('c-start').value, endDate: document.getElementById('c-end').value, feeNormal: document.getElementById('c-feeNormal').value, feeEarly: document.getElementById('c-feeEarly').value, deposit: document.getElementById('c-deposit').value, capacity: document.getElementById('c-capacity').value };
  
  await fetch(cfg.url, { method:'POST', body: JSON.stringify({ action: editCourseId?'updateCourse':'addCourse', payload: p, currentUser }) });
  closeM('mCourse'); syncSheets();
}

async function enrollStudent(){
  const currentUser = sessionStorage.getItem('username') || 'system';
  const courseId = document.getElementById('s-course').value;
  if(!courseId) return alert('Course is required.');

  const isExisting = document.querySelector('input[name="sType"]:checked').value === 'existing';
  let studentId = '';
  let studentData = {};

  if(isExisting) {
      studentId = document.getElementById('s-existingId').value;
      if(!studentId) return alert("Please select an existing student.");
  } else {
      studentId = uid();
      const fullName = document.getElementById('s-fullname').value.trim();
      const email = document.getElementById('s-email').value.trim();
      if(!fullName || !email) return alert("Full name and email are required for new students.");
      studentData = { id: studentId, fullName, email, phone: document.getElementById('s-phone').value };
  }

  // Check if already enrolled
  if(S.enrollments.find(e => e.studentId === studentId && e.courseId === courseId)) {
      return alert("This student is already enrolled in this course!");
  }
  
  let instalmentPlan = [];
  if (document.getElementById('s-payType').value === 'instalment') {
    const amounts = document.querySelectorAll('.inst-amount');
    const dates = document.querySelectorAll('.inst-date');
    for (let i = 0; i < amounts.length; i++) {
      instalmentPlan.push({ amount: parseFloat(amounts[i].value) || 0, date: dates[i].value });
    }
  }

  const p = { 
      enrollmentId: uid(),
      isNew: !isExisting,
      studentId: studentId,
      studentData: studentData,
      courseId: courseId,
      priceType: document.getElementById('s-priceType').value, 
      totalFee: document.getElementById('s-displayTotal').value.replace(/[^0-9.]/g,''), 
      depositAmount: document.getElementById('s-depositAmount').value, 
      depositDate: document.getElementById('s-depositDate').value, 
      paymentType: document.getElementById('s-payType').value, 
      instalmentPlan: JSON.stringify(instalmentPlan) 
  };
  
  await fetch(cfg.url, { method:'POST', body: JSON.stringify({ action: 'enrollStudent', payload: p, currentUser }) });
  closeM('mStudent'); syncSheets();
}

async function savePayment(){
  const currentUser = sessionStorage.getItem('username') || 'system';
  const studentId = document.getElementById('p-student').value;
  const courseId = document.getElementById('p-course').value;
  const amount = parseFloat(document.getElementById('p-amount').value);
  if(!studentId || !courseId || !amount) return alert('Student, Course, and Amount are required.');
  
  const p = { id:uid(), studentId, courseId, amount, date:document.getElementById('p-date').value, type:document.getElementById('p-type').value, note:document.getElementById('p-note').value };
  
  await fetch(cfg.url, { method:'POST', body: JSON.stringify({ action: 'addPayment', payload: p, currentUser }) });
  closeM('mPayment'); syncSheets();
}
