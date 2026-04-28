/* =========================================================
   DASHBOARD LOGIC
   ========================================================= */

import { db } from './firebase-config.js';
import {
  requireAuth, ensureProfile, renderNav, renderSidebar,
  roleTagHTML, formatDate, ym
} from './auth.js';

const user = await requireAuth();
const profile = await ensureProfile(user);

renderNav(user, profile);
renderSidebar(user, profile, 'dashboard');

// Greeting
const greetingEl = document.getElementById('greeting');
greetingEl.textContent = `WELCOME_BACK, ${(profile.name || user.displayName || 'USER').toUpperCase()}`;

// ---------- Active projects count ----------
db.collection('projects')
  .where('status', '==', 'ACTIVE')
  .onSnapshot((snap) => {
    document.getElementById('stat-projects').textContent =
      String(snap.size).padStart(2, '0');
  });

// ---------- My submissions this month + recent activity ----------
const monthKey = ym(new Date());
const startOfMonth = new Date();
startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);

// Listen to all projects, then per project listen to messages for this user.
const feedEl = document.getElementById('feed');
const userMessages = new Map(); // key = msgId -> msg

db.collection('projects').onSnapshot((projSnap) => {
  projSnap.docChanges().forEach((pc) => {
    if (pc.type !== 'added') return;
    const project = { id: pc.doc.id, ...pc.doc.data() };
    db.collection('projects').doc(project.id)
      .collection('messages')
      .where('uid', '==', user.uid)
      .onSnapshot((msgSnap) => {
        msgSnap.docChanges().forEach((mc) => {
          const key = `${project.id}:${mc.doc.id}`;
          if (mc.type === 'removed') userMessages.delete(key);
          else userMessages.set(key, { id: mc.doc.id, projectId: project.id, projectName: project.name, ...mc.doc.data() });
        });
        renderFeed();
      });
  });
});

function renderFeed() {
  const list = Array.from(userMessages.values()).sort((a, b) => {
    const ta = a.timestamp?.toMillis?.() || 0;
    const tb = b.timestamp?.toMillis?.() || 0;
    return tb - ta;
  });

  // Count this month
  const thisMonth = list.filter((m) => {
    const d = m.timestamp?.toDate?.();
    return d && d >= startOfMonth;
  });
  document.getElementById('stat-submissions').textContent =
    String(thisMonth.length).padStart(2, '0');

  // Last 5 rows
  const top = list.slice(0, 5);
  if (!top.length) {
    feedEl.innerHTML = `
      <div class="empty">
        <h1>NO_ACTIVITY_YET</h1>
        <p>POST_YOUR_FIRST_SUBMISSION_IN_PROJECTS</p>
      </div>`;
    return;
  }
  feedEl.innerHTML = top.map((m) => `
    <div class="feed-row">
      <span class="dt">${formatDate(m.timestamp)}</span>
      <div class="stack">
        <span class="name">${m.projectName || 'UNNAMED'}</span>
        <span class="mono-xs">${(m.text || '').slice(0,80)}</span>
      </div>
      <span class="tag">${m.type || 'CHAT'}</span>
      <span class="tag ${m.reaction==='APPROVED'?'tag-accent':m.reaction==='REJECTED'?'tag-invert':''}">${m.reaction || 'PENDING'}</span>
    </div>
  `).join('');
}

// ---------- Salary status for current month ----------
db.collection('salaries').doc(user.uid).collection('months').doc(monthKey)
  .onSnapshot((snap) => {
    const data = snap.exists ? snap.data() : null;
    const el = document.getElementById('stat-salary');
    const label = document.getElementById('stat-salary-label');
    if (data?.status === 'PAID') {
      el.textContent = 'PAID';
      el.style.color = 'var(--accent)';
      label.textContent = 'STATUS_CONFIRMED';
    } else {
      el.textContent = 'PENDING';
      el.style.color = 'var(--fg)';
      label.textContent = 'AWAITING_PROCESSING';
    }
  });
