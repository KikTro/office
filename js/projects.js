/* =========================================================
   PROJECTS — Discord-style threads with real-time messages
   ========================================================= */

import { db, FieldValue } from './firebase-config.js';
import {
  requireAuth, ensureProfile, renderNav, renderTabs,
  roleTagHTML, rolesLabel, statusPill, formatDate, isLink, ymd, toast, escape
} from './auth.js';
import { ico } from './icons.js';

const user = await requireAuth();
const profile = await ensureProfile(user);

renderNav(user, profile);
renderTabs('projects');

localStorage.setItem('lastVisitedProjects', String(Date.now()));

/* Icons */
document.getElementById('listIcon').innerHTML = ico('projects', 16);
document.getElementById('searchIcon').innerHTML = ico('search', 14);
document.getElementById('metaIcon').innerHTML = ico('target', 16);
document.getElementById('sendIcon').innerHTML = ico('send', 14);

/* DOM refs */
const listEl = document.getElementById('projList');
const searchEl = document.getElementById('search');
const titleEl = document.getElementById('threadTitle');
const statusEl = document.getElementById('threadStatus');
const pillEl = document.getElementById('threadPill');
const msgsEl = document.getElementById('messages');
const composer = document.getElementById('composer');
const composerInput = document.getElementById('composer-input');
const composerType = document.getElementById('composer-type');

const metaName = document.getElementById('metaName');
const metaDate = document.getElementById('metaDate');
const metaDesc = document.getElementById('metaDesc');
const metaMembers = document.getElementById('metaMembers');
const metaBoard = document.getElementById('metaBoard');

/* State */
let projects = [];
let selectedId = null;
let msgUnsub = null;
const msgCount = new Map();

/* Listen to projects */
db.collection('projects')
  .orderBy('createdAt', 'desc')
  .onSnapshot((snap) => {
    projects = snap.docs.map((d)=>({ id: d.id, ...d.data() })).filter((p)=>p.status!=='DELETED');
    renderProjectList();
    if (!selectedId && projects.length) openProject(projects[0].id);
    else if (selectedId && !projects.find((p)=>p.id===selectedId)) {
      selectedId = null; msgsEl.innerHTML = emptyThread();
    }
  });

searchEl.addEventListener('input', renderProjectList);

function renderProjectList() {
  const q = searchEl.value.trim().toLowerCase();
  const filtered = projects.filter((p)=>!q || (p.name||'').toLowerCase().includes(q));
  if (!filtered.length) {
    listEl.innerHTML = `<div class="empty"><h3>No projects</h3><p>Ask an admin to create one.</p></div>`;
    return;
  }
  listEl.innerHTML = filtered.map((p)=>{
    const d = p.createdAt?.toDate?.();
    const ds = d ? d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';
    const c = msgCount.get(p.id);
    return `
      <div class="proj-card ${p.id===selectedId?'active':''}" data-id="${p.id}">
        <h4>${escape(p.name||'Untitled')}</h4>
        <div class="pmeta">${ds}${p.description?(' · '+escape(p.description.slice(0,40))):''}</div>
        <div class="pbottom">
          ${statusPill(p.status || 'ACTIVE')}
          <span class="text-xs text-dim mono">${c ?? '—'} msgs</span>
        </div>
      </div>`;
  }).join('');
  listEl.querySelectorAll('.proj-card').forEach((el)=>{
    el.addEventListener('click', ()=>openProject(el.dataset.id));
  });

  // Subscribe to message counts for visible projects
  filtered.forEach((p)=>{
    if (msgCount.has(p.id)) return;
    db.collection('projects').doc(p.id).collection('messages').onSnapshot((s)=>{
      msgCount.set(p.id, s.size);
      const span = listEl.querySelector(`[data-id="${p.id}"] .pbottom .text-xs`);
      if (span) span.textContent = `${s.size} msgs`;
    });
  });
}

function openProject(id) {
  selectedId = id;
  const proj = projects.find((p)=>p.id===id);
  if (!proj) return;
  renderProjectList();

  titleEl.textContent = proj.name || 'Untitled';
  statusEl.textContent = proj.status === 'ACTIVE' ? 'THREAD_ACTIVE' : 'THREAD_CLOSED';
  pillEl.innerHTML = statusPill(proj.status || 'ACTIVE');
  metaName.textContent = proj.name || '—';
  const d = proj.createdAt?.toDate?.();
  metaDate.textContent = d ? d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
  metaDesc.textContent = proj.description || '—';

  if (msgUnsub) msgUnsub();
  msgUnsub = db.collection('projects').doc(id).collection('messages')
    .orderBy('timestamp', 'asc')
    .onSnapshot((snap) => {
      const msgs = snap.docs.map((m)=>({ id: m.id, ...m.data() }));
      renderMessages(msgs);
      renderMeta(msgs);
    });
}

function emptyThread() {
  return `<div class="empty"><h3>No project selected</h3><p>Pick one from the left to open its thread.</p></div>`;
}

function renderMessages(msgs) {
  if (!msgs.length) {
    msgsEl.innerHTML = `<div class="empty"><h3>No messages yet</h3><p>Be the first to post.</p></div>`;
    return;
  }
  msgsEl.innerHTML = msgs.map((m)=>{
    const bodyIsLink = isLink(m.text || '');
    const body = bodyIsLink
      ? `<a class="link" href="${escape(m.text)}" target="_blank" rel="noreferrer">${ico('link',12)} ${escape(m.text)}</a>`
      : `<span>${escape(m.text || '')}</span>`;
    const typeTag = bodyIsLink ? 'LINK' : (m.type || 'CHAT');
    const initial = (m.name||'?').trim().charAt(0).toUpperCase();
    return `
      <article class="msg">
        <header class="msg-top">
          <div class="msg-who">
            <div class="msg-avatar">${initial}</div>
            <span>${escape(m.name || 'User')}</span>
            ${roleTagHTML(m.role)}
          </div>
          <span class="msg-ts">${formatDate(m.timestamp)}</span>
        </header>
        <div class="msg-body">${body}</div>
        <footer class="msg-footer">
          <span class="role-pill">${typeTag}</span>
          ${statusPill(m.reaction || 'PENDING')}
        </footer>
      </article>`;
  }).join('');
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

function renderMeta(msgs) {
  const byUser = new Map();
  msgs.forEach((m)=>{
    const entry = byUser.get(m.uid) || { name: m.name, count: 0, role: m.role };
    entry.count++;
    byUser.set(m.uid, entry);
  });
  metaMembers.textContent = String(byUser.size).padStart(2,'0');
  const top3 = Array.from(byUser.values()).sort((a,b)=>b.count-a.count).slice(0,3);
  metaBoard.innerHTML = top3.length ? top3.map((u, i)=>`
    <div class="lb-row">
      <span>0${i+1} · ${escape(u.name || 'User')}</span>
      <span class="lb-count">${u.count}</span>
    </div>
  `).join('') : `<div class="text-xs text-dim">No contributors yet.</div>`;
}

/* Composer */
composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  await sendMessage();
});
composerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

async function sendMessage() {
  const text = composerInput.value.trim();
  if (!text || !selectedId) return;
  const type = composerType.value;
  const projectName = projects.find((p)=>p.id===selectedId)?.name || 'Untitled';
  try {
    await db.collection('projects').doc(selectedId).collection('messages').add({
      uid: user.uid,
      name: profile.name || user.displayName || 'User',
      role: rolesLabel(profile.roles || profile.role),
      text,
      type,
      timestamp: FieldValue.serverTimestamp(),
      reaction: 'PENDING'
    });
    const key = ymd(new Date());
    await db.collection('activity').doc(user.uid)
      .collection('logs').doc(key)
      .set({
        date: key,
        submissions: FieldValue.arrayUnion({
          projectId: selectedId, projectName, type, text: text.slice(0, 200), timestamp: Date.now()
        })
      }, { merge: true });
    composerInput.value = '';
    toast('SUBMISSION_POSTED');
  } catch (err) {
    console.error(err); toast('POST_FAILED');
  }
}
