/* =========================================================
   ADMIN PORTAL LOGIC
   ---------------------------------------------------------
   NOTE ON SECURITY:
   This file relies on a client-side UID check against ADMIN_UID
   (see firebase-config.js). For a production deployment, pair it
   with the Firestore security rules block documented there — those
   rules are what actually stop non-admins from writing privileged
   data. On a public GitHub Pages site, the client check alone is
   a defence-in-depth/UX measure, NOT a security boundary.
   ========================================================= */

import { auth, db, FieldValue, ADMIN_UID } from './firebase-config.js';
import {
  ensureProfile, renderNav, toast, signOut,
  roleTagHTML, formatDate, ym, isLink
} from './auth.js';

// ---------- Admin guard ----------
const user = await new Promise((resolve) => {
  auth.onAuthStateChanged((u) => {
    if (!u) { location.href = 'index.html'; return; }
    resolve(u);
  });
});
if (user.uid !== ADMIN_UID) {
  location.href = 'index.html';
  throw new Error('Not admin');
}
const profile = await ensureProfile(user);
renderNav(user, profile);
document.getElementById('adminLogout').addEventListener('click', signOut);

// ---------- Tab switching ----------
const tabs = document.querySelectorAll('.admin-tab');
document.getElementById('adminNav').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-tab]');
  if (!a) return;
  e.preventDefault();
  document.querySelectorAll('#adminNav a').forEach((x)=>x.classList.remove('active'));
  a.classList.add('active');
  const id = a.dataset.tab;
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === id));
});

// =========================================================
// OVERVIEW
// =========================================================
const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);

db.collection('users').onSnapshot((s) => {
  document.getElementById('sTotalEmp').textContent = String(s.size).padStart(2,'0');
});
db.collection('projects').where('status','==','ACTIVE').onSnapshot((s) => {
  document.getElementById('sActiveProj').textContent = String(s.size).padStart(2,'0');
});

// All messages aggregator (listen to every project -> messages)
const allMessages = new Map();
db.collection('projects').onSnapshot((psnap) => {
  psnap.docChanges().forEach((pc) => {
    if (pc.type !== 'added') return;
    const proj = { id: pc.doc.id, ...pc.doc.data() };
    db.collection('projects').doc(proj.id).collection('messages')
      .onSnapshot((msnap) => {
        msnap.docChanges().forEach((mc) => {
          const key = `${proj.id}:${mc.doc.id}`;
          if (mc.type === 'removed') allMessages.delete(key);
          else allMessages.set(key, { id: mc.doc.id, projectId: proj.id, projectName: proj.name, ...mc.doc.data() });
        });
        refreshOverviewFeed();
        refreshReactionFeed();
      });
  });
});

function refreshOverviewFeed() {
  const list = Array.from(allMessages.values());
  const monthCount = list.filter((m)=>{
    const d = m.timestamp?.toDate?.();
    return d && d >= startOfMonth;
  }).length;
  document.getElementById('sMonthSubs').textContent = String(monthCount).padStart(2,'0');
  const pending = list.filter((m)=>m.reaction==='PENDING').length;
  document.getElementById('sPending').textContent = String(pending).padStart(2,'0');

  const recent = list.sort((a,b)=>(b.timestamp?.toMillis?.()||0)-(a.timestamp?.toMillis?.()||0)).slice(0,20);
  document.getElementById('adminFeed').innerHTML = recent.length ? recent.map((m)=>`
    <div class="feed-row">
      <span class="dt">${formatDate(m.timestamp)}</span>
      <div class="stack">
        <span class="name">${escapeHTML(m.name||'USER')} · ${escapeHTML(m.projectName||'')}</span>
        <span class="mono-xs">${escapeHTML((m.text||'').slice(0,80))}</span>
      </div>
      <span class="tag">${m.type||'CHAT'}</span>
      <span class="tag ${reactionClass(m.reaction)}">${m.reaction||'PENDING'}</span>
    </div>
  `).join('') : `<div class="empty"><p>NO_ACTIVITY_YET</p></div>`;
}

function reactionClass(r) {
  return r==='APPROVED'?'tag-accent':r==='REJECTED'?'tag-invert':'';
}

// =========================================================
// ALL EMPLOYEES
// =========================================================
const empHost = document.getElementById('empTableHost');
let allUsers = [];
let userMsgCounts = {}; // uid -> count
let userLastActive = {}; // uid -> ts
let expandedUid = null;

db.collection('users').onSnapshot((snap) => {
  allUsers = snap.docs.map((d)=>({ id: d.id, ...d.data() }));
  renderEmployees();
  renderSalaryMatrix();
  renderViewAsDropdown();
});

// Refresh aggregate counts as messages change
function recomputeUserStats() {
  userMsgCounts = {};
  userLastActive = {};
  for (const m of allMessages.values()) {
    userMsgCounts[m.uid] = (userMsgCounts[m.uid]||0) + 1;
    const t = m.timestamp?.toMillis?.() || 0;
    if (t > (userLastActive[m.uid]||0)) userLastActive[m.uid] = t;
  }
  renderEmployees();
}
setInterval(recomputeUserStats, 4000);

function renderEmployees() {
  if (!allUsers.length) { empHost.innerHTML = `<div class="empty"><p>NO_EMPLOYEES_YET</p></div>`; return; }
  empHost.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>NAME</th><th>ROLE</th><th>EMAIL</th><th>MEMBER_SINCE</th>
          <th>SUBMISSIONS</th><th>LAST_ACTIVE</th><th>ACTION</th>
        </tr>
      </thead>
      <tbody id="empBody">
        ${allUsers.map((u)=>{
          const last = userLastActive[u.id] ? timeAgo(userLastActive[u.id]) : '—';
          return `
          <tr data-uid="${u.id}">
            <td>${escapeHTML(u.name||'—')}</td>
            <td>${roleTagHTML(u.role)}</td>
            <td>${escapeHTML(u.email||'—')}</td>
            <td>${fmtDate(u.createdAt)}</td>
            <td>${userMsgCounts[u.id]||0}</td>
            <td>${last}</td>
            <td>
              <button class="btn btn-ghost" data-act="profile">VIEW</button>
              <button class="btn btn-ghost" data-act="calendar">CALENDAR</button>
            </td>
          </tr>
          ${expandedUid===u.id ? `
            <tr class="expand"><td colspan="7">
              <div class="row gap-24" style="flex-wrap:wrap;">
                <div class="stack"><span class="mono-xs">UPI</span><span class="mono">${escapeHTML(u.upiId||'—')}</span></div>
                <div class="stack"><span class="mono-xs">BANK</span><span class="mono">${escapeHTML(u.bankAccount||'—')}</span></div>
                <div class="stack"><span class="mono-xs">IFSC</span><span class="mono">${escapeHTML(u.ifsc||'—')}</span></div>
                <div class="stack"><span class="mono-xs">UID</span><span class="mono">${u.id}</span></div>
              </div>
            </td></tr>
          `:''}`;
        }).join('')}
      </tbody>
    </table>
  `;
  empHost.querySelectorAll('tr[data-uid]').forEach((tr)=>{
    tr.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (btn?.dataset.act === 'calendar') {
        openCalendarModal(tr.dataset.uid);
      } else {
        expandedUid = (expandedUid === tr.dataset.uid) ? null : tr.dataset.uid;
        renderEmployees();
      }
    });
  });
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff/60000);
  if (m < 1) return 'NOW';
  if (m < 60) return `${m}M_AGO`;
  const h = Math.floor(m/60);
  if (h < 24) return `${h}H_AGO`;
  return `${Math.floor(h/24)}D_AGO`;
}
function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

// =========================================================
// PROJECTS MANAGER
// =========================================================
const projAdminList = document.getElementById('projAdminList');
const projSearch = document.getElementById('projSearch');
let allProjects = [];

db.collection('projects').orderBy('createdAt','desc').onSnapshot((snap)=>{
  allProjects = snap.docs.map((d)=>({ id: d.id, ...d.data() })).filter((p)=>p.status!=='DELETED');
  renderProjAdmin();
});
projSearch.addEventListener('input', renderProjAdmin);

function renderProjAdmin() {
  const q = projSearch.value.trim().toLowerCase();
  const filtered = allProjects.filter((p)=>!q || p.name?.toLowerCase().includes(q));
  if (!filtered.length) { projAdminList.innerHTML = `<div class="empty"><p>NO_PROJECTS_YET</p></div>`; return; }
  projAdminList.innerHTML = `
    <table class="table">
      <thead><tr><th>NAME</th><th>DESCRIPTION</th><th>ROLES</th><th>CREATED</th><th>STATUS</th><th>ACTION</th></tr></thead>
      <tbody>
      ${filtered.map((p)=>`
        <tr>
          <td>${escapeHTML(p.name||'—')}</td>
          <td>${escapeHTML((p.description||'').slice(0,80))}</td>
          <td>${(p.assignedRoles||[]).map((r)=>roleTagHTML(r)).join(' ')}</td>
          <td>${fmtDate(p.createdAt)}</td>
          <td><span class="tag ${p.status==='ACTIVE'?'tag-accent':''}">${p.status||'ACTIVE'}</span></td>
          <td>
            <button class="btn btn-danger" data-del="${p.id}">DELETE</button>
          </td>
        </tr>
      `).join('')}
      </tbody>
    </table>
  `;
  projAdminList.querySelectorAll('button[data-del]').forEach((b)=>{
    b.addEventListener('click', () => deleteProject(b.dataset.del));
  });
}

async function deleteProject(id) {
  if (!confirm('DELETE this project and all its messages? This cannot be undone.')) return;
  try {
    // Delete subcollection first in batches
    const msgs = await db.collection('projects').doc(id).collection('messages').get();
    const batch = db.batch();
    msgs.forEach((m) => batch.delete(m.ref));
    batch.delete(db.collection('projects').doc(id));
    await batch.commit();
    toast('PROJECT_DELETED');
  } catch (err) {
    console.error(err);
    toast('DELETE_FAILED');
  }
}

// Create project modal
document.getElementById('openCreateProj').addEventListener('click', openCreateProj);
function openCreateProj() {
  const host = document.getElementById('createProjModal');
  host.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <h2>CREATE_PROJECT</h2>
        <p class="sub">NEW_THREAD · ASSIGN_ROLES</p>
        <form id="newProjForm">
          <div class="form-field">
            <label class="form-label">PROJECT_NAME</label>
            <input class="input" name="name" required>
          </div>
          <div class="form-field">
            <label class="form-label">DESCRIPTION</label>
            <input class="input" name="description">
          </div>
          <div class="form-field">
            <label class="form-label">ASSIGNED_ROLES</label>
            <div class="pill-group">
              ${['IDEATION','SCRIPT','VIDEO'].map((r)=>`
                <label><input type="checkbox" name="roles" value="${r}" hidden><span>${r}</span></label>
              `).join('')}
            </div>
          </div>
          <div class="row gap-12" style="margin-top:16px;">
            <button type="submit" class="btn btn-accent">CREATE</button>
            <button type="button" id="cancelProj" class="btn btn-ghost">CANCEL</button>
          </div>
        </form>
      </div>
    </div>
  `;
  // Toggle pill-group labels as chips
  host.querySelectorAll('.pill-group label').forEach((lbl)=>{
    const cb = lbl.querySelector('input');
    lbl.addEventListener('click', (e) => {
      if (e.target === cb) return;
      e.preventDefault();
      cb.checked = !cb.checked;
      lbl.style.background = cb.checked ? 'var(--fg)' : '';
      lbl.style.color = cb.checked ? 'var(--bg)' : '';
    });
  });
  host.querySelector('#cancelProj').addEventListener('click', ()=>{ host.innerHTML=''; });
  host.querySelector('#newProjForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const roles = fd.getAll('roles');
    await db.collection('projects').add({
      name: fd.get('name'),
      description: fd.get('description') || '',
      assignedRoles: roles,
      createdAt: FieldValue.serverTimestamp(),
      status: 'ACTIVE',
      createdBy: user.uid
    });
    host.innerHTML = '';
    toast('PROJECT_CREATED');
  });
}

// =========================================================
// REACTIONS CENTER
// =========================================================
const reactionFeed = document.getElementById('reactionFeed');
function refreshReactionFeed() {
  const pending = Array.from(allMessages.values())
    .filter((m)=>m.reaction==='PENDING')
    .sort((a,b)=>(b.timestamp?.toMillis?.()||0)-(a.timestamp?.toMillis?.()||0));
  if (!pending.length) {
    reactionFeed.innerHTML = `<div class="empty"><h1>ALL_CLEAR</h1><p>NO_PENDING_REACTIONS</p></div>`;
    return;
  }
  reactionFeed.innerHTML = `
    <table class="table">
      <thead><tr><th>PROJECT</th><th>AUTHOR</th><th>TYPE</th><th>MESSAGE</th><th>TIMESTAMP</th><th>ACTION</th></tr></thead>
      <tbody>
      ${pending.map((m)=>`
        <tr>
          <td>${escapeHTML(m.projectName||'—')}</td>
          <td>${escapeHTML(m.name||'USER')} ${roleTagHTML(m.role)}</td>
          <td>${isLink(m.text||'')?'LINK':(m.type||'CHAT')}</td>
          <td style="max-width:320px;text-overflow:ellipsis;overflow:hidden;">${escapeHTML((m.text||'').slice(0,120))}</td>
          <td>${formatDate(m.timestamp)}</td>
          <td>
            <button class="btn btn-accent" data-approve="${m.projectId}:${m.id}">APPROVE</button>
            <button class="btn btn-invert" data-reject="${m.projectId}:${m.id}">REJECT</button>
          </td>
        </tr>
      `).join('')}
      </tbody>
    </table>
  `;
  reactionFeed.querySelectorAll('button[data-approve]').forEach((b)=>b.addEventListener('click', ()=>setReaction(b.dataset.approve,'APPROVED')));
  reactionFeed.querySelectorAll('button[data-reject]').forEach((b)=>b.addEventListener('click', ()=>setReaction(b.dataset.reject,'REJECTED')));
}
async function setReaction(composite, reaction) {
  const [projectId, msgId] = composite.split(':');
  try {
    await db.collection('projects').doc(projectId).collection('messages').doc(msgId)
      .update({ reaction });
    toast(`MARKED_${reaction}`);
  } catch (err) { console.error(err); toast('UPDATE_FAILED'); }
}

// =========================================================
// SALARY MANAGER
// =========================================================
const salaryHost = document.getElementById('salaryMatrix');
const salaryFilter = document.getElementById('salaryFilter');
const MONTH_NAMES_SHORT = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
let salaryMap = {}; // `${uid}:${ym}` -> status
const salaryUnsubs = [];

salaryFilter.addEventListener('change', renderSalaryMatrix);

function renderSalaryMatrix() {
  // Clear listeners
  while (salaryUnsubs.length) salaryUnsubs.pop()();
  salaryMap = {};

  const roleFilter = salaryFilter.value;
  const employees = allUsers.filter((u)=>!roleFilter || u.role === roleFilter);

  // Build last-12 month keys
  const today = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth()-i, 1);
    months.push({ key: ym(d), label: `${MONTH_NAMES_SHORT[d.getMonth()]}_${String(d.getFullYear()).slice(2)}` });
  }

  salaryHost.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>EMPLOYEE</th><th>ROLE</th>
          ${months.map((m)=>`<th>${m.label}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
      ${employees.map((u)=>`
        <tr data-uid="${u.id}">
          <td>${escapeHTML(u.name||'—')}</td>
          <td>${roleTagHTML(u.role)}</td>
          ${months.map((m)=>`<td class="salary-cell pending" data-uid="${u.id}" data-m="${m.key}">—</td>`).join('')}
        </tr>
      `).join('')}
      </tbody>
    </table>
  `;

  salaryHost.querySelectorAll('.salary-cell').forEach((cell)=>{
    cell.addEventListener('click', ()=>toggleSalary(cell.dataset.uid, cell.dataset.m, cell));
  });

  // Listen to each employee's salary months
  employees.forEach((u)=>{
    months.forEach((m)=>{
      const unsub = db.collection('salaries').doc(u.id).collection('months').doc(m.key)
        .onSnapshot((snap)=>{
          const cell = salaryHost.querySelector(`.salary-cell[data-uid="${u.id}"][data-m="${m.key}"]`);
          if (!cell) return;
          const paid = snap.exists && snap.data().status === 'PAID';
          salaryMap[`${u.id}:${m.key}`] = paid ? 'PAID' : 'PENDING';
          cell.classList.toggle('paid', paid);
          cell.classList.toggle('pending', !paid);
          cell.textContent = paid ? '✓' : '—';
        });
      salaryUnsubs.push(unsub);
    });
  });
}

async function toggleSalary(uid, monthKey, cell) {
  const current = salaryMap[`${uid}:${monthKey}`] || 'PENDING';
  const next = current === 'PAID' ? 'PENDING' : 'PAID';
  if (next === 'PENDING' && !confirm('Revert this PAID record to PENDING?')) return;
  const [year, month] = monthKey.split('-');
  await db.collection('salaries').doc(uid).collection('months').doc(monthKey).set({
    status: next,
    paidAt: next === 'PAID' ? FieldValue.serverTimestamp() : null,
    month: Number(month), year: Number(year)
  }, { merge: true });
  toast(`SALARY_${next}`);
}

// =========================================================
// VIEW AS EMPLOYEE
// =========================================================
const viewAsSelect = document.getElementById('viewAsSelect');
const viewAsLabel = document.getElementById('viewAsLabel');
const viewAsHost = document.getElementById('viewAsHost');

function renderViewAsDropdown() {
  const current = viewAsSelect.value;
  viewAsSelect.innerHTML = `<option value="">SELECT_EMPLOYEE...</option>` +
    allUsers.map((u)=>`<option value="${u.id}" ${u.id===current?'selected':''}>${escapeHTML(u.name||'—')} · ${u.role||''}</option>`).join('');
}
viewAsSelect.addEventListener('change', () => renderViewAs(viewAsSelect.value));

function renderViewAs(uid) {
  if (!uid) { viewAsHost.innerHTML = ''; viewAsLabel.textContent = ''; return; }
  const u = allUsers.find((x)=>x.id===uid);
  viewAsLabel.textContent = `VIEWING_AS: ${u?.name||'—'} · ${u?.role||''}`;

  viewAsHost.innerHTML = `
    <div class="stat-grid">
      <div class="cell"><div id="va-proj" class="big">--</div><span class="mono-label">ACTIVE_PROJECTS</span></div>
      <div class="cell"><div id="va-subs" class="big">--</div><span class="mono-label">MY_SUBMISSIONS</span></div>
      <div class="cell"><div id="va-salary" class="big">--</div><span class="mono-label">THIS_MONTH_SALARY</span></div>
      <div class="cell"><div class="big" style="font-size:1.4rem;">READ_ONLY</div><span class="mono-label">ADMIN_VIEW</span></div>
    </div>

    <div class="accounts-layout" style="margin-top:24px;">
      <div class="col">
        <h2 class="page-title" style="font-size:1.5rem;margin-bottom:16px;">SALARY_LEDGER</h2>
        <div id="va-salaryList" class="salary-list"></div>
      </div>
      <div class="col" style="position:relative;">
        <h2 class="page-title" style="font-size:1.5rem;margin-bottom:16px;">ACTIVITY_CALENDAR</h2>
        <div class="cal-header">
          <button id="va-prev" class="btn-sq">◀</button>
          <span id="va-label" class="center">— —</span>
          <button id="va-next" class="btn-sq">▶</button>
        </div>
        <div id="va-cal" class="cal-grid"></div>
      </div>
    </div>

    <div class="feed">
      <h2>THEIR_SUBMISSIONS</h2>
      <div id="va-feed" class="stack"></div>
    </div>
  `;

  // subs + projects counts
  db.collection('projects').where('status','==','ACTIVE').get().then((s)=>{
    document.getElementById('va-proj').textContent = String(s.size).padStart(2,'0');
  });

  const theirMsgs = Array.from(allMessages.values()).filter((m)=>m.uid===uid);
  const monthCount = theirMsgs.filter((m)=>{
    const d = m.timestamp?.toDate?.(); return d && d >= startOfMonth;
  }).length;
  document.getElementById('va-subs').textContent = String(monthCount).padStart(2,'0');

  // Salary
  const monthKey = ym(new Date());
  db.collection('salaries').doc(uid).collection('months').doc(monthKey)
    .get().then((snap)=>{
      document.getElementById('va-salary').textContent =
        (snap.exists && snap.data().status==='PAID') ? 'PAID' : 'PENDING';
    });

  // Salary ledger (last 12 months)
  const vaSalary = document.getElementById('va-salaryList');
  const monthsArr = [];
  const today = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(today.getFullYear(), today.getMonth()-i, 1);
    monthsArr.push({
      key: ym(d),
      label: `${['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'][d.getMonth()]} ${d.getFullYear()}`
    });
  }
  vaSalary.innerHTML = monthsArr.map((m)=>`
    <div class="salary-row" data-key="${m.key}"><span>${m.label}</span><span class="mono-xs">—</span></div>
  `).join('');
  monthsArr.forEach((m)=>{
    db.collection('salaries').doc(uid).collection('months').doc(m.key)
      .onSnapshot((snap)=>{
        const row = vaSalary.querySelector(`[data-key="${m.key}"] .mono-xs`);
        if (!row) return;
        if (snap.exists && snap.data().status==='PAID') {
          row.textContent = 'PAID ✓'; row.style.color = 'var(--accent)';
        } else { row.textContent = 'PENDING —'; row.style.color = 'var(--dim)'; }
      });
  });

  // Their feed
  const vaFeed = document.getElementById('va-feed');
  const sorted = theirMsgs.sort((a,b)=>(b.timestamp?.toMillis?.()||0)-(a.timestamp?.toMillis?.()||0)).slice(0,15);
  vaFeed.innerHTML = sorted.length ? sorted.map((m)=>`
    <div class="feed-row">
      <span class="dt">${formatDate(m.timestamp)}</span>
      <div class="stack">
        <span class="name">${escapeHTML(m.projectName||'—')}</span>
        <span class="mono-xs">${escapeHTML((m.text||'').slice(0,80))}</span>
      </div>
      <span class="tag">${m.type||'CHAT'}</span>
      <span class="tag ${reactionClass(m.reaction)}">${m.reaction||'PENDING'}</span>
    </div>
  `).join('') : `<div class="empty"><p>NO_ACTIVITY</p></div>`;

  // Mini calendar reuse
  viewAsCalendar(uid, new Date());
  document.getElementById('va-prev').addEventListener('click', ()=>{
    vaCursor.setMonth(vaCursor.getMonth()-1);
    viewAsCalendar(uid, vaCursor);
  });
  document.getElementById('va-next').addEventListener('click', ()=>{
    vaCursor.setMonth(vaCursor.getMonth()+1);
    viewAsCalendar(uid, vaCursor);
  });
}

let vaCursor = new Date(); vaCursor.setDate(1);
let vaUnsub = null;
function viewAsCalendar(uid, cursor) {
  vaCursor = cursor;
  const grid = document.getElementById('va-cal');
  const label = document.getElementById('va-label');
  const MN = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  label.textContent = `${MN[cursor.getMonth()]} ${cursor.getFullYear()}`;
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const firstIdx = (new Date(year, month, 1).getDay() + 6) % 7;

  const startKey = `${year}-${String(month+1).padStart(2,'0')}-01`;
  const endKey = `${year}-${String(month+1).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`;

  if (vaUnsub) vaUnsub();
  vaUnsub = db.collection('activity').doc(uid).collection('logs')
    .where('date','>=',startKey).where('date','<=',endKey)
    .onSnapshot((snap)=>{
      const map = {};
      snap.forEach((d)=>map[d.id] = (d.data().submissions||[]).length);
      let html = ['MON','TUE','WED','THU','FRI','SAT','SUN'].map((x)=>`<div class="dow">${x}</div>`).join('');
      for (let i=0;i<firstIdx;i++) html += `<div class="day empty"></div>`;
      for (let d=1; d<=daysInMonth; d++) {
        const key = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const active = map[key] > 0;
        html += `<div class="day ${active?'active':''}">${String(d).padStart(2,'0')}</div>`;
      }
      grid.innerHTML = html;
    });
}

// Calendar modal reused for ALL_EMPLOYEES
function openCalendarModal(uid) {
  const u = allUsers.find((x)=>x.id===uid);
  const host = document.getElementById('createProjModal');
  host.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" style="max-width:720px;">
        <h2>${escapeHTML((u?.name||'USER').toUpperCase())}</h2>
        <p class="sub">${u?.role||''} · ACTIVITY_CALENDAR</p>
        <div class="cal-header">
          <button id="cm-prev" class="btn-sq">◀</button>
          <span id="cm-label" class="center">— —</span>
          <button id="cm-next" class="btn-sq">▶</button>
        </div>
        <div id="cm-grid" class="cal-grid"></div>
        <div class="row gap-12" style="margin-top:16px;">
          <button id="cm-close" class="btn btn-ghost">CLOSE</button>
        </div>
      </div>
    </div>
  `;
  let cursor = new Date(); cursor.setDate(1);
  let unsub = null;
  const MN = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const draw = () => {
    document.getElementById('cm-label').textContent = `${MN[cursor.getMonth()]} ${cursor.getFullYear()}`;
    const year = cursor.getFullYear(), month = cursor.getMonth();
    const daysInMonth = new Date(year, month+1, 0).getDate();
    const firstIdx = (new Date(year, month, 1).getDay() + 6) % 7;
    const startKey = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const endKey = `${year}-${String(month+1).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`;
    if (unsub) unsub();
    unsub = db.collection('activity').doc(uid).collection('logs')
      .where('date','>=',startKey).where('date','<=',endKey)
      .onSnapshot((snap)=>{
        const map = {};
        snap.forEach((d)=>map[d.id] = (d.data().submissions||[]).length);
        let html = ['MON','TUE','WED','THU','FRI','SAT','SUN'].map((x)=>`<div class="dow">${x}</div>`).join('');
        for (let i=0;i<firstIdx;i++) html += `<div class="day empty"></div>`;
        for (let d=1; d<=daysInMonth; d++) {
          const key = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          html += `<div class="day ${map[key]>0?'active':''}">${String(d).padStart(2,'0')}</div>`;
        }
        document.getElementById('cm-grid').innerHTML = html;
      });
  };
  draw();
  document.getElementById('cm-prev').addEventListener('click', ()=>{ cursor.setMonth(cursor.getMonth()-1); draw(); });
  document.getElementById('cm-next').addEventListener('click', ()=>{ cursor.setMonth(cursor.getMonth()+1); draw(); });
  document.getElementById('cm-close').addEventListener('click', ()=>{
    if (unsub) unsub();
    host.innerHTML = '';
  });
}

// =========================================================
// Utils
// =========================================================
function escapeHTML(str='') {
  return String(str).replace(/[&<>"']/g, (c)=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
