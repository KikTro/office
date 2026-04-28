/* =========================================================
   PROJECTS LOGIC — Discord-style channels, real-time threads
   ========================================================= */

import { db, FieldValue } from './firebase-config.js';
import {
  requireAuth, ensureProfile, renderNav, renderSidebar,
  roleTagHTML, formatDate, isLink, ymd, toast
} from './auth.js';

const user = await requireAuth();
const profile = await ensureProfile(user);

renderNav(user, profile);
renderSidebar(user, profile, 'projects');

// Mark last-visited timestamp for unread-dot logic
localStorage.setItem('lastVisitedProjects', String(Date.now()));

// ----- DOM refs -----
const listEl = document.getElementById('projList');
const searchEl = document.getElementById('search');
const titleEl = document.getElementById('threadTitle');
const statusEl = document.getElementById('threadStatus');
const msgsEl = document.getElementById('messages');
const composerInput = document.getElementById('composer-input');
const composerType = document.getElementById('composer-type');
const composerSend = document.getElementById('composer-send');

const metaName = document.getElementById('metaName');
const metaDate = document.getElementById('metaDate');
const metaDesc = document.getElementById('metaDesc');
const metaMembers = document.getElementById('metaMembers');
const metaBoard = document.getElementById('metaBoard');

// ----- State -----
let projects = [];          // all projects
let selectedId = null;      // currently open project
let msgUnsub = null;        // unsubscribe fn for current project's messages
const msgCountByProject = new Map();

// ----- Project list (real-time) -----
db.collection('projects')
  .orderBy('createdAt', 'desc')
  .onSnapshot((snap) => {
    projects = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.status !== 'DELETED');
    renderProjectList();

    // auto-select first if none selected
    if (!selectedId && projects.length) openProject(projects[0].id);
  });

searchEl.addEventListener('input', renderProjectList);

function renderProjectList() {
  const q = searchEl.value.trim().toLowerCase();
  const filtered = projects.filter((p) =>
    !q || p.name?.toLowerCase().includes(q)
  );
  if (!filtered.length) {
    listEl.innerHTML = `<div class="empty" style="padding:40px 20px;"><p>NO_PROJECTS_YET</p></div>`;
    return;
  }
  listEl.innerHTML = filtered.map((p) => {
    const d = p.createdAt?.toDate?.();
    const dateStr = d ? `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` : '--';
    const count = msgCountByProject.get(p.id) ?? '--';
    return `
      <li data-id="${p.id}" class="${p.id===selectedId?'active':''}">
        <div>
          <div class="pname">${p.name || 'UNNAMED'}</div>
          <div class="pdate">${dateStr}</div>
        </div>
        <span class="count">${count}</span>
      </li>`;
  }).join('');
  listEl.querySelectorAll('li').forEach((li) => {
    li.addEventListener('click', () => openProject(li.dataset.id));
  });

  // listen to message counts for all visible projects
  filtered.forEach((p) => {
    if (msgCountByProject.has(p.id)) return;
    db.collection('projects').doc(p.id).collection('messages')
      .onSnapshot((s) => {
        msgCountByProject.set(p.id, s.size);
        // update just the count text
        const li = listEl.querySelector(`li[data-id="${p.id}"] .count`);
        if (li) li.textContent = s.size;
      });
  });
}

// ----- Open project -----
function openProject(id) {
  selectedId = id;
  const proj = projects.find((p) => p.id === id);
  if (!proj) return;
  renderProjectList();

  titleEl.textContent = proj.name || 'UNNAMED';
  statusEl.textContent = proj.status === 'ACTIVE' ? 'THREAD_ACTIVE' : 'THREAD_CLOSED';
  metaName.textContent = proj.name || '—';
  const d = proj.createdAt?.toDate?.();
  metaDate.textContent = d ? `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` : '—';
  metaDesc.textContent = proj.description || '—';

  if (msgUnsub) msgUnsub();
  msgUnsub = db.collection('projects').doc(id).collection('messages')
    .orderBy('timestamp', 'asc')
    .onSnapshot((snap) => {
      const msgs = snap.docs.map((m) => ({ id: m.id, ...m.data() }));
      renderMessages(msgs);
      renderMeta(msgs);
    });
}

// ----- Render messages -----
function renderMessages(msgs) {
  if (!msgs.length) {
    msgsEl.innerHTML = `<div class="empty"><h1>NO_MESSAGES_YET</h1><p>BE_THE_FIRST_TO_POST</p></div>`;
    return;
  }
  msgsEl.innerHTML = msgs.map((m) => {
    const reactionClass =
      m.reaction === 'APPROVED' ? 'tag-accent' :
      m.reaction === 'REJECTED' ? 'tag-invert' : '';
    const bodyIsLink = isLink(m.text || '');
    const bodyHTML = bodyIsLink
      ? `<a class="linkblock" href="${escapeAttr(m.text)}" target="_blank" rel="noreferrer">${escapeHTML(m.text)} ↗</a>`
      : escapeHTML(m.text || '');
    const typeTag = bodyIsLink ? 'LINK' : (m.type || 'CHAT');
    return `
      <article class="msg">
        <header class="msg-top">
          <div class="who">
            <strong>${escapeHTML(m.name || 'USER')}</strong>
            ${roleTagHTML(m.role)}
          </div>
          <span class="ts">${formatDate(m.timestamp)}</span>
        </header>
        <div class="msg-body">${bodyHTML}</div>
        <footer class="msg-bottom">
          <span class="tag">${typeTag}</span>
          <span class="tag ${reactionClass}">${m.reaction || 'PENDING'}</span>
        </footer>
      </article>`;
  }).join('');
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

// ----- Right metadata panel -----
function renderMeta(msgs) {
  const byUser = new Map();
  msgs.forEach((m) => {
    byUser.set(m.uid, { name: m.name, count: (byUser.get(m.uid)?.count || 0) + 1, role: m.role });
  });
  metaMembers.textContent = String(byUser.size).padStart(2,'0');

  const top3 = Array.from(byUser.values()).sort((a,b)=>b.count-a.count).slice(0,3);
  metaBoard.innerHTML = top3.length ? top3.map((u, i) => `
    <div class="lb-row">
      <span>0${i+1} · ${escapeHTML(u.name || 'USER')}</span>
      <span>${u.count}</span>
    </div>
  `).join('') : `<span class="mono-xs">NO_CONTRIBUTORS_YET</span>`;
}

// ----- Composer -----
async function sendMessage() {
  const text = composerInput.value.trim();
  if (!text || !selectedId) return;
  const type = composerType.value;
  const projectName = projects.find((p)=>p.id===selectedId)?.name || 'UNNAMED';

  try {
    await db.collection('projects').doc(selectedId).collection('messages').add({
      uid: user.uid,
      name: profile.name || user.displayName || 'USER',
      role: profile.role || '',
      text,
      type,
      timestamp: FieldValue.serverTimestamp(),
      reaction: 'PENDING'
    });

    // Activity log: merge into today's doc for the calendar
    const key = ymd(new Date());
    await db.collection('activity').doc(user.uid)
      .collection('logs').doc(key)
      .set({
        date: key,
        submissions: FieldValue.arrayUnion({
          projectId: selectedId,
          projectName,
          type,
          text: text.slice(0, 200),
          timestamp: Date.now()
        })
      }, { merge: true });

    composerInput.value = '';
    toast('SUBMISSION_POSTED');
  } catch (err) {
    console.error(err);
    toast('POST_FAILED');
  }
}

composerSend.addEventListener('click', sendMessage);
composerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// ----- utils -----
function escapeHTML(str='') {
  return String(str).replace(/[&<>"']/g, (c)=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function escapeAttr(str='') { return escapeHTML(str); }
