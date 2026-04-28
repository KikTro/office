/* =========================================================
   ADMIN PORTAL
   Client-side ADMIN_UID check + Firestore rules = real security.
   ========================================================= */

import { auth, db, FieldValue, ADMIN_UID } from './firebase-config.js';
import {
  ensureProfile, renderNav, toast, signOut,
  roleTagHTML, statusPill, formatDate, ym, isLink, escape
} from './auth.js';
import { ico } from './icons.js';

/* Admin guard */
const user = await new Promise((resolve) => {
  auth.onAuthStateChanged((u) => {
    if (!u) { location.href = 'index.html'; return; }
    resolve(u);
  });
});
if (user.uid !== ADMIN_UID) { location.href = 'index.html'; throw new Error('Not admin'); }

const profile = await ensureProfile(user);
renderNav(user, profile);

/* Icons */
document.getElementById('adminShield').innerHTML = ico('shield', 16);
document.getElementById('overviewIcon').innerHTML = ico('heart', 18);
document.getElementById('empIcon').innerHTML = ico('users', 18);
document.getElementById('projIcon').innerHTML = ico('projects', 18);
document.getElementById('salIcon').innerHTML = ico('target', 18);
document.getElementById('rxIcon').innerHTML = ico('check', 18);
document.getElementById('vaIcon').innerHTML = ico('account', 18);
document.getElementById('feedIc').innerHTML = ico('bulb', 16);
document.getElementById('plusIc').innerHTML = ico('plus', 14);

/* Tabs */
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

/* =========================================================
   SHARED STATE
   ========================================================= */
const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);
let allUsers = [];
let allProjects = [];
const allMessages = new Map();
let userMsgCounts = {};
let userLastActive = {};

/* =========================================================
   USERS + PROJECTS + MESSAGES (listeners)
   ========================================================= */
db.collection('users').onSnapshot((s) => {
  document.getElementById('sTotalEmp').textContent = String(s.size).padStart(2,'0');
  allUsers = s.docs.map((d)=>({ id: d.id, ...d.data() }));
  renderEmployees();
  renderSalaryMatrix();
  renderViewAsDropdown();
});

db.collection('projects').where('status','==','ACTIVE').onSnapshot((s) => {
  document.getElementById('sActiveProj').textContent = String(s.size).padStart(2,'0');
});

db.collection('projects').orderBy('createdAt','desc').onSnapshot((snap) => {
  allProjects = snap.docs.map((d)=>({ id: d.id, ...d.data() })).filter((p)=>p.status!=='DELETED');
  renderProjAdmin();

  snap.docChanges().forEach((pc) => {
    if (pc.type !== 'added') return;
    const proj = { id: pc.doc.id, ...pc.doc.data() };
    db.collection('projects').doc(proj.id).collection('messages')
      .onSnapshot((msnap) => {
        msnap.docChanges().forEach((mc) => {
          const key = `${proj.id}:${mc.doc.id}`;
          if (mc.type === 'removed') allMessages.delete(key);
          else allMessages.set(key, { id: mc.doc.id, projectId: proj.id, projectName: proj.name, ...mc.doc.data() });
        });
        refreshOverview();
        refreshReactions();
        recomputeUserStats();
      });
  });
});

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

/* =========================================================
   OVERVIEW
   ========================================================= */
function refreshOverview() {
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
    <div class="row" style="display:grid; grid-template-columns:140px 1fr auto auto; gap:12px; align-items:center; padding:12px 0; border-bottom:1px solid var(--border); font-size:13px;">
      <span class="mono text-xs text-dim">${formatDate(m.timestamp)}</span>
      <div style="min-width:0;">
        <div style="font-weight:500;">${escape(m.name||'User')} · ${escape(m.projectName||'')}</div>
        <div class="text-xs text-dim" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escape((m.text||'').slice(0,90))}</div>
      </div>
      <span class="role-pill">${m.type || 'CHAT'}</span>
      ${statusPill(m.reaction || 'PENDING')}
    </div>
  `).join('') : `<div class="empty"><h3>No activity yet</h3></div>`;
}

/* =========================================================
   EMPLOYEES
   ========================================================= */
let expandedUid = null;
function renderEmployees() {
  const host = document.getElementById('empTableHost');
  if (!allUsers.length) { host.innerHTML = `<div class="empty"><h3>No employees yet</h3></div>`; return; }
  host.innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Name</th><th>Role</th><th>Email</th>
            <th>Member since</th><th>Submissions</th><th>Last active</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${allUsers.map((u)=>{
            const last = userLastActive[u.id] ? timeAgo(userLastActive[u.id]) : '—';
            return `
            <tr data-uid="${u.id}">
              <td style="font-weight:500;">${escape(u.name||'—')}</td>
              <td>${roleTagHTML(u.role)}</td>
              <td class="text-dim">${escape(u.email||'—')}</td>
              <td>${fmtShortDate(u.createdAt)}</td>
              <td style="color:var(--accent); font-weight:600;">${userMsgCounts[u.id]||0}</td>
              <td class="mono text-xs text-dim">${last}</td>
              <td>
                <button class="ctrl" data-act="profile">View</button>
                <button class="ctrl" data-act="calendar">Calendar</button>
              </td>
            </tr>
            ${expandedUid===u.id ? `
              <tr class="expand"><td colspan="7">
                <div class="row gap-24" style="flex-wrap:wrap; padding: 8px 0;">
                  <div class="stack"><span class="text-xs text-dim mono">UPI</span><span class="mono">${escape(u.upiId||'—')}</span></div>
                  <div class="stack"><span class="text-xs text-dim mono">BANK</span><span class="mono">${escape(u.bankAccount||'—')}</span></div>
                  <div class="stack"><span class="text-xs text-dim mono">IFSC</span><span class="mono">${escape(u.ifsc||'—')}</span></div>
                  <div class="stack"><span class="text-xs text-dim mono">UID</span><span class="mono text-xs">${u.id}</span></div>
                </div>
              </td></tr>
            `:''}`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
  host.querySelectorAll('tr[data-uid]').forEach((tr)=>{
    tr.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (btn?.dataset.act === 'calendar') {
        openCalendarModal(tr.dataset.uid);
      } else {
        expandedUid = expandedUid === tr.dataset.uid ? null : tr.dataset.uid;
        renderEmployees();
      }
    });
  });
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff/60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m/60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}
function fmtShortDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}

/* =========================================================
   PROJECTS MANAGER
   ========================================================= */
const projSearch = document.getElementById('projSearch');
projSearch.addEventListener('input', renderProjAdmin);

function renderProjAdmin() {
  const host = document.getElementById('projAdminList');
  const q = projSearch.value.trim().toLowerCase();
  const filtered = allProjects.filter((p)=>!q || (p.name||'').toLowerCase().includes(q));
  if (!filtered.length) { host.innerHTML = `<div class="empty"><h3>No projects yet</h3><p>Use "Create project" to start one.</p></div>`; return; }
  host.innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr><th>Name</th><th>Description</th><th>Roles</th><th>Created</th><th>Status</th><th>Action</th></tr>
        </thead>
        <tbody>
          ${filtered.map((p)=>`
            <tr>
              <td style="font-weight:500;">${escape(p.name||'—')}</td>
              <td class="text-dim">${escape((p.description||'').slice(0,70))}</td>
              <td>${(p.assignedRoles||[]).map((r)=>roleTagHTML(r)).join(' ')}</td>
              <td>${fmtShortDate(p.createdAt)}</td>
              <td>${statusPill(p.status||'ACTIVE')}</td>
              <td><button class="ctrl danger" data-del="${p.id}">${ico('trash',12)} Delete</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  host.querySelectorAll('button[data-del]').forEach((b)=>{
    b.addEventListener('click', () => deleteProject(b.dataset.del));
  });
}

async function deleteProject(id) {
  if (!confirm('Delete this project and all its messages? This cannot be undone.')) return;
  try {
    const msgs = await db.collection('projects').doc(id).collection('messages').get();
    const batch = db.batch();
    msgs.forEach((m) => batch.delete(m.ref));
    batch.delete(db.collection('projects').doc(id));
    await batch.commit();
    toast('PROJECT_DELETED');
  } catch (err) {
    console.error(err); toast('DELETE_FAILED');
  }
}

document.getElementById('openCreateProj').addEventListener('click', openCreateProj);
function openCreateProj() {
  const host = document.getElementById('modalHost');
  host.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <h2>New project</h2>
        <p class="sub">Create a new thread and assign roles.</p>
        <form id="newProjForm">
          <div class="field">
            <label>Project name</label>
            <input class="input" name="name" required>
          </div>
          <div class="field">
            <label>Description</label>
            <input class="input" name="description">
          </div>
          <div class="field">
            <label>Assigned roles</label>
            <div class="pill-group">
              ${['IDEATION','SCRIPT','VIDEO'].map((r)=>`
                <label><input type="checkbox" name="roles" value="${r}">${r}</label>
              `).join('')}
            </div>
          </div>
          <div class="row">
            <button type="submit" class="ctrl primary">Create</button>
            <button type="button" class="ctrl" id="cancelProj">Cancel</button>
          </div>
        </form>
      </div>
    </div>`;
  host.querySelector('#cancelProj').addEventListener('click', () => host.innerHTML = '');
  host.querySelector('#newProjForm').addEventListener('submit', async (e) => {
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

/* =========================================================
   REACTIONS CENTER
   ========================================================= */
function refreshReactions() {
  const host = document.getElementById('reactionFeed');
  const pending = Array.from(allMessages.values())
    .filter((m)=>m.reaction==='PENDING')
    .sort((a,b)=>(b.timestamp?.toMillis?.()||0)-(a.timestamp?.toMillis?.()||0));
  if (!pending.length) {
    host.innerHTML = `<div class="empty"><h3>All clear</h3><p>No pending reactions. Nice work!</p></div>`;
    return;
  }
  host.innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr><th>Project</th><th>Author</th><th>Type</th><th>Message</th><th>Time</th><th>Action</th></tr>
        </thead>
        <tbody>
          ${pending.map((m)=>`
            <tr>
              <td style="font-weight:500;">${escape(m.projectName||'—')}</td>
              <td>${escape(m.name||'User')} ${roleTagHTML(m.role)}</td>
              <td><span class="role-pill">${isLink(m.text||'')?'LINK':(m.type||'CHAT')}</span></td>
              <td class="text-dim" style="max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escape((m.text||'').slice(0,80))}</td>
              <td class="mono text-xs text-dim">${formatDate(m.timestamp)}</td>
              <td>
                <button class="ctrl ok" data-approve="${m.projectId}:${m.id}">Approve</button>
                <button class="ctrl" data-reject="${m.projectId}:${m.id}">Reject</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  host.querySelectorAll('button[data-approve]').forEach((b)=>b.addEventListener('click', ()=>setReaction(b.dataset.approve,'APPROVED')));
  host.querySelectorAll('button[data-reject]').forEach((b)=>b.addEventListener('click', ()=>setReaction(b.dataset.reject,'REJECTED')));
}
async function setReaction(composite, reaction) {
  const [projectId, msgId] = composite.split(':');
  try {
    await db.collection('projects').doc(projectId).collection('messages').doc(msgId)
      .update({ reaction });
    toast(`MARKED_${reaction}`);
  } catch (err) { console.error(err); toast('UPDATE_FAILED'); }
}

/* =========================================================
   SALARY MANAGER
   ========================================================= */
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let salaryMap = {};
const salaryUnsubs = [];
const salaryFilter = document.getElementById('salaryFilter');
salaryFilter.addEventListener('change', renderSalaryMatrix);

function renderSalaryMatrix() {
  const host = document.getElementById('salaryMatrix');
  while (salaryUnsubs.length) salaryUnsubs.pop()();
  salaryMap = {};

  const roleFilter = salaryFilter.value;
  const employees = allUsers.filter((u)=>!roleFilter || u.role === roleFilter);

  const today = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth()-i, 1);
    months.push({ key: ym(d), label: `${MONTH_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` });
  }

  host.innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Employee</th><th>Role</th>
            ${months.map((m)=>`<th>${m.label}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${employees.map((u)=>`
            <tr>
              <td style="font-weight:500;">${escape(u.name||'—')}</td>
              <td>${roleTagHTML(u.role)}</td>
              ${months.map((m)=>`<td class="salary-cell pending" data-uid="${u.id}" data-m="${m.key}">—</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  host.querySelectorAll('.salary-cell').forEach((cell)=>{
    cell.addEventListener('click', ()=>toggleSalary(cell.dataset.uid, cell.dataset.m, cell));
  });

  employees.forEach((u)=>{
    months.forEach((m)=>{
      const unsub = db.collection('salaries').doc(u.id).collection('months').doc(m.key)
        .onSnapshot((snap)=>{
          const cell = host.querySelector(`.salary-cell[data-uid="${u.id}"][data-m="${m.key}"]`);
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

/* =========================================================
   VIEW AS EMPLOYEE
   ========================================================= */
const viewAsSelect = document.getElementById('viewAsSelect');
const viewAsHost = document.getElementById('viewAsHost');
function renderViewAsDropdown() {
  const current = viewAsSelect.value;
  viewAsSelect.innerHTML = `<option value="">Select an employee…</option>` +
    allUsers.map((u)=>`<option value="${u.id}" ${u.id===current?'selected':''}>${escape(u.name||'—')} · ${u.role||''}</option>`).join('');
}
viewAsSelect.addEventListener('change', () => renderViewAs(viewAsSelect.value));

function renderViewAs(uid) {
  if (!uid) { viewAsHost.innerHTML = ''; return; }
  const u = allUsers.find((x)=>x.id===uid);
  const theirMsgs = Array.from(allMessages.values()).filter((m)=>m.uid===uid);
  const monthCount = theirMsgs.filter((m)=>{ const d = m.timestamp?.toDate?.(); return d && d >= startOfMonth; }).length;
  const approved = theirMsgs.filter((m)=>m.reaction==='APPROVED').length;
  const pending  = theirMsgs.filter((m)=>m.reaction==='PENDING').length;

  viewAsHost.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card ok"><div class="big">${theirMsgs.length}</div><div class="lbl">Total submissions</div></div>
      <div class="stat-card blue"><div class="big">${monthCount}</div><div class="lbl">This month</div></div>
      <div class="stat-card warn"><div class="big">${approved}</div><div class="lbl">Approved</div></div>
      <div class="stat-card purple"><div class="big">${pending}</div><div class="lbl">Pending</div></div>
    </div>

    <div class="card">
      <div class="feed-title"><span>${ico('bulb',16)}</span><span>Their submissions</span></div>
      <div id="va-feed"></div>
    </div>
  `;

  const sorted = theirMsgs.sort((a,b)=>(b.timestamp?.toMillis?.()||0)-(a.timestamp?.toMillis?.()||0)).slice(0,20);
  document.getElementById('va-feed').innerHTML = sorted.length ? sorted.map((m)=>`
    <div class="row" style="display:grid; grid-template-columns:140px 1fr auto auto; gap:12px; align-items:center; padding:12px 0; border-bottom:1px solid var(--border); font-size:13px;">
      <span class="mono text-xs text-dim">${formatDate(m.timestamp)}</span>
      <div style="min-width:0;">
        <div style="font-weight:500;">${escape(m.projectName||'—')}</div>
        <div class="text-xs text-dim" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escape((m.text||'').slice(0,100))}</div>
      </div>
      <span class="role-pill">${m.type || 'CHAT'}</span>
      ${statusPill(m.reaction || 'PENDING')}
    </div>
  `).join('') : `<div class="empty"><h3>No activity</h3></div>`;
}

/* =========================================================
   CALENDAR MODAL (employees tab)
   ========================================================= */
function openCalendarModal(uid) {
  const u = allUsers.find((x)=>x.id===uid);
  const host = document.getElementById('modalHost');
  host.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal large">
        <div class="row" style="justify-content:space-between; margin-bottom:16px;">
          <div>
            <h2>${escape(u?.name||'User')}</h2>
            <p class="sub">${u?.role||''} · Activity calendar</p>
          </div>
          <button class="ctrl" id="cm-close">${ico('x',12)} Close</button>
        </div>
        <div class="cal-header">
          <div class="mtitle" id="cm-label">—</div>
          <div class="nav-btns">
            <button class="cal-nav-btn" id="cm-prev">${ico('chevronL',14)}</button>
            <button class="cal-nav-btn" id="cm-next">${ico('chevronR',14)}</button>
          </div>
        </div>
        <div id="cm-grid" class="cal-grid"></div>
      </div>
    </div>`;
  let cursor = new Date(); cursor.setDate(1);
  let unsub = null;
  const MN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

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
        let html = DOW.map((x)=>`<div class="dow">${x}</div>`).join('');
        for (let i=0;i<firstIdx;i++) html += `<div class="day empty"></div>`;
        for (let d=1; d<=daysInMonth; d++) {
          const key = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          const count = map[key] || 0;
          const lvl = count >= 5 ? 'lvl4' : count >= 3 ? 'lvl3' : count >= 2 ? 'lvl2' : count >= 1 ? 'lvl1' : '';
          html += `<div class="day ${lvl}">${d}</div>`;
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
