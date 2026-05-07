let S = { courses:[], students:[], payments:[] };

// DİKKAT: BURAYA KENDİ GOOGLE APPS SCRIPT URL'Nİ YAPIŞTIR!
let cfg = { url: 'https://script.google.com/macros/s/AKfycbwwwRca7rb2D62LuaNUS5p8UjlcNJ9oWiSrLaE4fY2GPEVQQIOm4g3H33epeQuXT802/exec', currency: '€' };
let editCID = null, editSID = null;

// Tarih Formatlayıcı (dd/mm/yyyy)
const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${d.getFullYear()}`;
};

const fmt = n => cfg.currency + Number(n||0).toLocaleString('en-US', {minimumFractionDigits: 2});
const today = () => new Date().toISOString().split('T')[0];

// --- LOGIN LOGIC ---
async function handleLogin() {
    const u = document.getElementById('l-user').value, p = document.getElementById('l-pass').value;
    const b = document.getElementById('l-btn'), e = document.getElementById('login-err');
    b.innerHTML = '<i class="ti ti-loader"></i> Verifying...'; b.disabled = true;
    try {
        const r = await fetch(cfg.url, { method: 'POST', body: JSON.stringify({ action: 'checkLogin', payload: { username: u, password: p } }) });
        const d = await r.json();
        if (d.success) { 
            sessionStorage.setItem('isLoggedIn', 'true');
            initApp();
        } else { e.style.display = "block"; b.innerText = "Sign In"; b.disabled = false; }
    } catch { alert("Connection error"); b.disabled = false; }
}

function initApp() {
    document.getElementById('login-screen').style.display = "none";
    document.getElementById('main-app').style.display = "block";
    syncSheets();
}

window.onload = () => { if(sessionStorage.getItem('isLoggedIn')==='true') initApp(); };

// --- DATA LOGIC ---
async function syncSheets() {
    document.getElementById('syncBadge').innerHTML = '<i class="ti ti-loader"></i> Syncing...';
    try {
        const r = await fetch(cfg.url + "?action=getAll");
        const d = await r.json();
        S = d; document.getElementById('syncBadge').innerHTML = '<i class="ti ti-cloud-check"></i> Live Sync Active';
        render();
    } catch { document.getElementById('syncBadge').innerHTML = '<i class="ti ti-cloud-x"></i> Sync Error'; }
}

function getPaid(sid) { return S.payments.filter(p=>p.studentId===sid).reduce((a,p)=>a+Number(p.amount),0); }
function getCourse(id) { return S.courses.find(c=>c.id===id); }

// --- RENDER LOGIC ---
function render() {
    const coll = S.payments.reduce((a,p)=>a+Number(p.amount),0);
    const out = S.students.reduce((a,s)=>a+(Number(s.totalFee)-getPaid(s.id)),0);
    document.getElementById('st-courses').innerText = S.courses.length;
    document.getElementById('st-students').innerText = S.students.length;
    document.getElementById('st-collected').innerText = fmt(coll);
    document.getElementById('st-outstanding').innerText = fmt(out);
    
    renderDash(); renderCourses(); renderStudents(); renderPayments();
}

function renderDash() {
    const box = document.getElementById('dashContent');
    if(!S.courses.length) { box.innerHTML = '<div style="text-align:center; padding:40px; color:#9ca3af;">No courses created yet.</div>'; return; }
    box.innerHTML = S.courses.map(c => {
        const studs = S.students.filter(s=>s.courseId===c.id);
        const tDue = studs.reduce((a,s)=>a+Number(s.totalFee),0);
        const tPaid = studs.reduce((a,s)=>a+getPaid(s.id),0);
        const pct = tDue > 0 ? Math.round(tPaid/tDue*100) : 0;
        return `<div class="card"><div class="card-hd"><div><b>${c.name}</b><br><small>${studs.length} enrolled</small></div><span class="chip teal">${pct}% Collected</span></div><div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div></div>`;
    }).join('');
}

function renderCourses() {
    document.getElementById('courseList').innerHTML = S.courses.map(c => `<div class="card" style="display:flex; justify-content:space-between; align-items:center;"><div><b>${c.name}</b><br><small>${formatDate(c.startDate)} to ${formatDate(c.endDate)}</small></div><button class="btn ghost" onclick="openM('mCourse','${c.id}')"><i class="ti ti-edit" style="font-size:16px;"></i></button></div>`).join('');
}

function renderStudents() {
    document.getElementById('studentList').innerHTML = `<div class="card" style="padding:4px 16px">${S.students.map(s => {
        const paid = getPaid(s.id), total = Number(s.totalFee), pct = total > 0 ? Math.round(paid/total*100) : 0;
        const parts = s.fullName.split(' '), initials = (parts[0]?.[0]||'') + (parts[parts.length-1]?.[0]||'');
        return `<div class="student-row" onclick="showStudentDetail('${s.id}')"><div class="avatar">${initials.toUpperCase()}</div><div style="flex:1"><b>${s.fullName}</b><br><small>${getCourse(s.courseId)?.name||'-'}</small></div><div style="text-align:right"><b>${fmt(paid)} / ${fmt(total)}</b><div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div></div></div>`;
    }).join('')}</div>`;
}

function renderPayments() {
    document.getElementById('paymentList').innerHTML = `<div class="card" style="padding:4px 16px">${S.payments.sort((a,b)=>b.date.localeCompare(a.date)).map(p => {
        const s = S.students.find(x=>x.id===p.studentId);
        return `<div class="student-row" style="cursor:default;"><div style="flex:1"><b>${s?.fullName||'Unknown'}</b><br><small>${p.type} · ${formatDate(p.date)}</small></div><div style="color:var(--color-brand); font-weight:600;">+${fmt(p.amount)}</div></div>`;
    }).join('')}</div>`;
}

// --- MODALS & INTERACTIONS ---
function goTab(t) { document.querySelectorAll('.tab').forEach((el,i)=>el.classList.toggle('active',['dashboard','courses','students','payments'][i]===t)); document.querySelectorAll('.sec').forEach(el=>el.classList.toggle('active', el.id==='sec-'+t)); }
function closeM(id) { document.getElementById(id).classList.remove('open'); }
function toggleInst() { document.getElementById('inst-box').style.display = document.getElementById('s-plan').value==='instalment'?'block':'none'; }

function openM(id, eId = null, sId = null) {
    if(id==='mCourse') { editCID = eId; const c = S.courses.find(x=>x.id===eId); document.getElementById('c-name').value = c?.name||''; document.getElementById('c-start').value = c?.startDate||''; document.getElementById('c-end').value = c?.endDate||''; document.getElementById('c-feeN').value = c?.feeNormal||''; document.getElementById('c-feeE').value = c?.feeEarly||''; }
    if(id==='mStudent') { editSID = eId; document.getElementById('s-course').innerHTML = S.courses.map(c=>`<option value="${c.id}">${c.name}</option>`).join(''); const s = S.students.find(x=>x.id===eId); document.getElementById('s-fullname').value = s?.fullName||''; document.getElementById('s-mail').value = s?.email||''; toggleInst(); updateSForm(); }
    if(id==='mPayment') { document.getElementById('p-student').innerHTML = '<option value="">Select...</option>' + S.students.map(s=>`<option value="${s.id}">${s.fullName}</option>`).join(''); document.getElementById('p-date').value = today(); if(sId) { document.getElementById('p-student').value = sId; suggestPay(); } }
    document.getElementById(id).classList.add('open');
}

function showStudentDetail(sid) {
    const s = S.students.find(x=>x.id===sid), paid = getPaid(sid), rem = Number(s.totalFee) - paid;
    document.getElementById('sd-title').innerText = s.fullName;
    document.getElementById('sd-body').innerHTML = `<div style="background:#f9fafb; padding:15px; border-radius:10px; font-size:13px;"><b>Email:</b> ${s.email}<br><b>Phone:</b> ${s.phone||'-'}<br><b>Plan:</b> ${s.paymentType}<br><b>Outstanding:</b> ${fmt(rem)}</div>`;
    document.getElementById('sd-footer').innerHTML = `<button class="btn" onclick="closeM('mStudentDetail')">Close</button><button class="btn" onclick="closeM('mStudentDetail'); openM('mStudent','${sid}')">Edit</button><button class="btn primary" onclick="closeM('mStudentDetail'); openM('mPayment',null,'${sid}')">Pay</button>`;
    openM('mStudentDetail');
}

function suggestPay() {
    const sid = document.getElementById('p-student').value, box = document.getElementById('p-sugg');
    if(!sid) { box.style.display='none'; return; }
    const s = S.students.find(x=>x.id===sid), rem = Number(s.totalFee) - getPaid(sid);
    box.style.display='block';
    box.innerHTML = rem <= 0 ? "✨ Fully Paid!" : `💡 Suggestion: <b>${fmt(rem)}</b>`;
    document.getElementById('p-amt').value = rem > 0 ? rem.toFixed(2) : 0;
}

function updateSForm() {
    const c = getCourse(document.getElementById('s-course').value);
    if(c) document.getElementById('s-total').value = fmt(document.getElementById('s-tier').value==='early_bird'?c.feeEarly:c.feeNormal);
}

async function saveCourse() {
    const p = { id: editCID||Date.now().toString(), name: document.getElementById('c-name').value, startDate: document.getElementById('c-start').value, endDate: document.getElementById('c-end').value, feeNormal: document.getElementById('c-feeN').value, feeEarly: document.getElementById('c-feeE').value };
    await fetch(cfg.url, { method:'POST', body: JSON.stringify({ action: editCID?'updateCourse':'addCourse', payload: p }) });
    closeM('mCourse'); syncSheets();
}

async function saveStudent() {
    const p = { id: editSID||Date.now().toString(), fullName: document.getElementById('s-fullname').value, email: document.getElementById('s-mail').value, phone: document.getElementById('s-phone').value, courseId: document.getElementById('s-course').value, priceType: document.getElementById('s-tier').value, totalFee: document.getElementById('s-total').value.replace(/[^0-9.]/g,''), paymentType: document.getElementById('s-plan').value, depositAmount: document.getElementById('s-depA').value, depositDate: document.getElementById('s-depD').value };
    await fetch(cfg.url, { method:'POST', body: JSON.stringify({ action: editSID?'updateStudent':'addStudent', payload: p }) });
    closeM('mStudent'); syncSheets();
}

async function savePayment() {
    const p = { id: Date.now().toString(), studentId: document.getElementById('p-student').value, amount: document.getElementById('p-amt').value, date: document.getElementById('p-date').value, type: document.getElementById('p-type').value };
    await fetch(cfg.url, { method:'POST', body: JSON.stringify({ action: 'addPayment', payload: p }) });
    closeM('mPayment'); syncSheets();
}
