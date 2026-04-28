/* =========================================================
   DASHBOARD — bento pillars, health chart, work done graph,
               recent activity, fixed bottom metric row
   ========================================================= */

import { db } from './firebase-config.js';
import {
  requireAuth, ensureProfile, renderNav, renderTabs,
  roleTagHTML, statusPill, formatDate, ym, escape
} from './auth.js';
import { ICONS, ico } from './icons.js';

const user = await requireAuth();
const profile = await ensureProfile(user);

renderNav(user, profile);
renderTabs('dashboard');

/* ---------- Side icons ---------- */
document.getElementById('sideHeadIcon').innerHTML = ico('layers', 16);
document.getElementById('sideImpIcon').innerHTML = ico('target', 16);
document.getElementById('pageHeaderIcon').innerHTML = ico('heart', 18);
document.getElementById('calIc').innerHTML = ico('calendar', 14);
document.getElementById('arrIc').innerHTML = ico('arrow', 14);
document.getElementById('feedIcon').innerHTML = ico('bulb', 16);
document.getElementById('qaIcon').innerHTML = ico('flag', 16);
document.getElementById('kiIcon').innerHTML = ico('bulb', 16);

/* ---------- Sidebar nav links ---------- */
const navLinks = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', href: 'dashboard.html' },
  { id: 'projects',  label: 'Projects',  icon: 'projects',  href: 'projects.html'  },
  { id: 'accounts',  label: 'My Account',icon: 'account',   href: 'accounts.html'  },
];
document.getElementById('sideNav').innerHTML = navLinks.map((l)=>`
  <a class="side-link ${l.id==='dashboard'?'active':''}" href="${l.href}" data-id="${l.id}">
    ${ico(l.icon, 17)}<span>${l.label}</span>
    ${l.id==='projects' ? '<span class="notif-dot hidden" id="projNotif"></span>' : ''}
  </a>`).join('');

/* ---------- Greeting ---------- */
const displayName = (profile.name || user.displayName || 'there').split(' ')[0];
document.getElementById('greetTitle').textContent = `Welcome back, ${displayName}`;
document.getElementById('greetSub').textContent =
  `${profile.role || 'Member'} · ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`;

document.getElementById('goProjects').addEventListener('click', () => location.href = 'projects.html');

/* ---------- Quick actions (right sidebar) ---------- */
const quickActions = [
  { label: 'New project',   action: () => location.href = 'projects.html' },
  { label: 'My calendar',   action: () => location.href = 'accounts.html' },
  { label: 'Salary ledger', action: () => location.href = 'accounts.html' },
  { label: 'Sign out',      action: () => import('./auth.js').then(m => m.signOut()) },
];
document.getElementById('quickActions').innerHTML = quickActions.map((q,i)=>`
  <label data-i="${i}" style="cursor:pointer;">${q.label}</label>
`).join('');
document.querySelectorAll('#quickActions label').forEach((el) => {
  el.addEventListener('click', () => quickActions[+el.dataset.i].action());
});

/* ---------- State for aggregating messages ---------- */
let projects = [];
const allUserMsgs = new Map(); // key -> msg for this user only

/* ---------- Pillars (role distribution of this user's subs) ---------- */
const PILLAR_CONFIG = [
  { id: 'IDEATION', name: 'Ideation',        color: '#22c55e' },
  { id: 'SCRIPT',   name: 'Script',          color: '#3b82f6' },
  { id: 'VIDEO',    name: 'Video',           color: '#ef4444' },
  { id: 'CHAT',     name: 'Discussion',      color: '#f59e0b' },
];
function renderPillars() {
  const grid = document.getElementById('pillarGrid');
  const total = allUserMsgs.size || 1;
  const counts = PILLAR_CONFIG.map((p)=>({
    ...p,
    count: Array.from(allUserMsgs.values()).filter((m)=> (m.type||'CHAT') === p.id).length,
  }));
  const max = Math.max(1, ...counts.map((c)=>c.count));
  grid.innerHTML = counts.map((p, i) => {
    const pct = Math.round((p.count / max) * 100);
    return `
      <div class="pillar-card" style="--c:${p.color};">
        <div class="pname">${p.name}</div>
        <div class="pbar-row">
          <span class="pval">${p.count}</span>
          <div class="pbar">
            <div class="pfill" style="background:${p.color}; width:${pct}%;"></div>
          </div>
        </div>
      </div>`;
  }).join('');
  // style ::after color per card via inline var (inject rule)
  grid.querySelectorAll('.pillar-card').forEach((card, i) => {
    card.querySelector('.pbar-row').style.setProperty('--c', counts[i].color);
    card.style.setProperty('--c', counts[i].color);
  });
}

/* ---------- Chart.js setup (dark theme) ---------- */
Chart.defaults.color = 'rgba(255,255,255,0.6)';
Chart.defaults.borderColor = 'rgba(255,255,255,0.08)';
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";

/* Health line chart */
const healthCtx = document.getElementById('healthChart').getContext('2d');
const healthChart = new Chart(healthCtx, {
  type: 'line',
  data: {
    labels: [],
    datasets: PILLAR_CONFIG.map((p)=>({
      label: p.name,
      data: [],
      borderColor: p.color,
      backgroundColor: p.color + '22',
      tension: 0.35,
      borderWidth: 2.5,
      pointRadius: 3,
      pointHoverRadius: 6,
      fill: false,
    })),
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#2f2f2f',
        borderColor: '#3b82f6',
        borderWidth: 1,
        padding: 12,
        titleColor: '#fff',
        bodyColor: 'rgba(255,255,255,0.8)',
      },
    },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,0.05)' } },
      y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { precision: 0 } },
    },
    animation: { duration: 900, easing: 'easeOutCubic' },
  },
});

document.getElementById('chartLegend').innerHTML = PILLAR_CONFIG.map((p)=>`
  <div class="legend-item"><span class="swatch" style="background:${p.color};"></span><span>${p.name}</span></div>
`).join('');

/* Work-done bar chart */
const workCtx = document.getElementById('workChart').getContext('2d');
const workChart = new Chart(workCtx, {
  type: 'bar',
  data: {
    labels: [],
    datasets: [{
      label: 'Submissions',
      data: [],
      backgroundColor: (ctx) => {
        const { chart } = ctx;
        const { ctx: c, chartArea } = chart;
        if (!chartArea) return '#3b82f6';
        const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        g.addColorStop(0, '#60a5fa');
        g.addColorStop(1, '#3b82f6');
        return g;
      },
      borderRadius: 6,
      maxBarThickness: 36,
    }],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: '#2f2f2f', borderColor: '#3b82f6', borderWidth: 1 },
    },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { precision: 0 } },
    },
    animation: { duration: 900, easing: 'easeOutCubic' },
  },
});

/* ---------- Metric cards (bottom) ---------- */
const metricDefs = [
  { id: 'projects',    title: 'Active projects',  icon: 'check',  color: '#22c55e', desc: 'Live project threads' },
  { id: 'submissions', title: 'My submissions',   icon: 'layers', color: '#3b82f6', desc: 'Your posts this month' },
  { id: 'approved',    title: 'Approved',         icon: 'git',    color: '#f59e0b', desc: 'Green-lit submissions' },
  { id: 'pending',     title: 'Pending review',   icon: 'clock',  color: '#8b5cf6', desc: 'Awaiting admin reaction' },
];
function renderMetrics(values) {
  document.getElementById('metricRow').innerHTML = metricDefs.map((m)=>{
    const v = values[m.id] ?? 0;
    return `
      <div class="metric-card" style="--c:${m.color};">
        <div class="mc-icons">
          <div class="mc-ic" style="background:${m.color}33; color:${m.color};">${ico(m.icon, 15)}</div>
          <div class="mc-ic secondary">${ico('layers', 14)}</div>
          <div class="mc-ic tertiary">${ico('git', 12)}</div>
        </div>
        <div class="mc-body">
          <div class="mc-top">
            <div class="mc-title">${m.title}</div>
            <button class="mc-expand" title="Open">${ico('arrow', 14)}</button>
          </div>
          <div class="mc-value">${v}</div>
          <div class="mc-change" style="background:${m.color};">+${Math.min(99, v)}</div>
          <div class="mc-desc">${m.desc}</div>
        </div>
      </div>`;
  }).join('');
  // Bottom accent color
  document.querySelectorAll('.metric-card').forEach((c, i)=> c.style.setProperty('--c', metricDefs[i].color));
}

/* ---------- Firestore listeners ---------- */
let projectCount = 0;

db.collection('projects').onSnapshot((psnap) => {
  projects = psnap.docs
    .map((d)=>({ id: d.id, ...d.data() }))
    .filter((p)=>p.status !== 'DELETED');
  projectCount = projects.filter((p)=>p.status === 'ACTIVE').length;
  renderSideProjects();
  renderKeyInsights();

  // Attach a messages listener for each project (filtered to this user)
  psnap.docChanges().forEach((pc) => {
    if (pc.type !== 'added') return;
    const proj = { id: pc.doc.id, ...pc.doc.data() };
    db.collection('projects').doc(proj.id).collection('messages')
      .where('uid', '==', user.uid)
      .onSnapshot((msnap) => {
        msnap.docChanges().forEach((mc) => {
          const key = `${proj.id}:${mc.doc.id}`;
          if (mc.type === 'removed') allUserMsgs.delete(key);
          else allUserMsgs.set(key, { id: mc.doc.id, projectId: proj.id, projectName: proj.name, ...mc.doc.data() });
        });
        refreshAllPanels();
      });
  });
});

/* ---------- Aggregate + render ---------- */
const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);

function refreshAllPanels() {
  const list = Array.from(allUserMsgs.values())
    .sort((a,b)=>(b.timestamp?.toMillis?.()||0)-(a.timestamp?.toMillis?.()||0));

  const thisMonth = list.filter((m)=>{
    const d = m.timestamp?.toDate?.();
    return d && d >= startOfMonth;
  });
  const approved = list.filter((m)=>m.reaction === 'APPROVED').length;
  const pending  = list.filter((m)=>m.reaction === 'PENDING').length;

  renderMetrics({
    projects:    projectCount,
    submissions: thisMonth.length,
    approved,
    pending,
  });

  renderPillars();
  renderHealthChart(list);
  renderWorkChart(list);
  renderFeed(list);
}

/* Populate 6-month health chart by role type */
function renderHealthChart(list) {
  const months = [];
  const labels = [];
  const today = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.push(ym(d));
    labels.push(d.toLocaleString('en-US', { month: 'short' }));
  }
  healthChart.data.labels = labels;
  PILLAR_CONFIG.forEach((p, idx) => {
    healthChart.data.datasets[idx].data = months.map((m) =>
      list.filter((x) =>
        (x.type || 'CHAT') === p.id &&
        x.timestamp?.toDate && ym(x.timestamp.toDate()) === m
      ).length
    );
  });
  healthChart.update();
}

/* Populate 8-week work-done bar chart */
function renderWorkChart(list) {
  const weeks = [];
  const labels = [];
  const now = new Date();
  now.setHours(0,0,0,0);
  // Align to Monday of current week
  const day = (now.getDay() + 6) % 7;
  now.setDate(now.getDate() - day);
  for (let i = 7; i >= 0; i--) {
    const start = new Date(now); start.setDate(now.getDate() - i * 7);
    const end = new Date(start); end.setDate(start.getDate() + 7);
    weeks.push({ start: start.getTime(), end: end.getTime() });
    labels.push(start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  }
  workChart.data.labels = labels;
  workChart.data.datasets[0].data = weeks.map((w) =>
    list.filter((m) => {
      const t = m.timestamp?.toMillis?.() || 0;
      return t >= w.start && t < w.end;
    }).length
  );
  workChart.update();
}

/* Recent activity feed */
function renderFeed(list) {
  const feed = document.getElementById('feed');
  const top = list.slice(0, 6);
  if (!top.length) {
    feed.innerHTML = `<div class="empty"><h3>No activity yet</h3><p>Post your first submission in Projects.</p></div>`;
    return;
  }
  feed.innerHTML = top.map((m)=>`
    <div class="row" style="display:grid; grid-template-columns:140px 1fr auto auto; gap:12px; align-items:center; padding:12px 0; border-bottom:1px solid var(--border); font-size:13px;">
      <span class="ts mono text-xs text-dim">${formatDate(m.timestamp)}</span>
      <div style="min-width:0;">
        <div style="font-weight:500;">${escape(m.projectName || 'Project')}</div>
        <div class="text-xs text-dim" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escape((m.text||'').slice(0,80))}</div>
      </div>
      <span class="role-pill">${m.type || 'CHAT'}</span>
      ${statusPill(m.reaction || 'PENDING')}
    </div>
  `).join('');
}

/* Left sidebar: top 5 projects by recency */
function renderSideProjects() {
  const host = document.getElementById('sideProjects');
  const list = projects.slice(0, 5);
  if (!list.length) {
    host.innerHTML = `<p class="text-xs text-dim" style="padding:8px 4px;">No projects yet.</p>`;
    return;
  }
  host.innerHTML = list.map((p)=>{
    const d = p.createdAt?.toDate?.();
    const ds = d ? d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';
    return `
      <a class="proj-card" href="projects.html">
        <h4>${escape(p.name || 'Untitled')}</h4>
        <div class="pmeta">${ds}${p.description ? ' · ' + escape(p.description.slice(0,40)) : ''}</div>
        <div class="pbottom">
          ${statusPill(p.status || 'ACTIVE')}
        </div>
      </a>`;
  }).join('');
}

/* Key insights (right sidebar) — simple rotation based on data */
function renderKeyInsights() {
  const host = document.getElementById('keyInsights');
  const insights = [
    { title: 'Stay consistent', desc: 'Posting at least once per day keeps your calendar hot.', tag: 'Habit' },
    { title: 'Tag your submissions', desc: 'Use IDEATION / SCRIPT / VIDEO for richer analytics.', tag: 'Workflow' },
    { title: 'Open reactions', desc: 'Admin reviews pending submissions daily.', tag: 'Pipeline' },
  ];
  host.innerHTML = insights.map((i)=>`
    <div class="card" style="margin-bottom:10px; padding:14px;">
      <div style="font-size:13px; font-weight:500; margin-bottom:4px;">${i.title}</div>
      <div class="text-xs text-dim" style="margin-bottom:10px;">${i.desc}</div>
      <span class="role-pill">${i.tag}</span>
    </div>
  `).join('');
}
