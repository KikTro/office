/* =========================================================
   ACCOUNTS LOGIC — profile, salary ledger, activity calendar
   Exports helpers so admin.js can reuse the calendar rendering
   for the VIEW_AS_EMPLOYEE tab.
   ========================================================= */

import { db } from './firebase-config.js';
import {
  requireAuth, ensureProfile, renderNav, renderSidebar,
  ym
} from './auth.js';

const MONTH_NAMES = [
  'JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE',
  'JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'
];
const DOW = ['MON','TUE','WED','THU','FRI','SAT','SUN'];

const user = await requireAuth();
const profile = await ensureProfile(user);

renderNav(user, profile);
renderSidebar(user, profile, 'accounts');

// ----- Profile block -----
document.getElementById('profName').textContent = (profile.name || 'USER').toUpperCase();
const roleEl = document.getElementById('profRole');
roleEl.textContent = profile.role || '—';
roleEl.className = `tag role-${profile.role || ''}`;
document.getElementById('profEmail').textContent = profile.email || '—';
document.getElementById('profUpi').textContent = maskMiddle(profile.upiId || '—');
document.getElementById('profBank').textContent = maskMiddle(profile.bankAccount || '—');
document.getElementById('profIfsc').textContent = profile.ifsc || '—';
document.getElementById('profSince').textContent = fmtDate(profile.createdAt);

function maskMiddle(s) {
  if (!s || s === '—') return s;
  if (s.length <= 4) return '****';
  return s.slice(0, 2) + '*'.repeat(Math.max(s.length - 4, 2)) + s.slice(-2);
}
function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

// ----- Salary ledger (last 12 months) -----
renderSalary(user.uid);

function renderSalary(uid) {
  const salaryEl = document.getElementById('salaryList');
  const months = [];
  const today = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.push({ key: ym(d), label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` });
  }

  // Initial render
  salaryEl.innerHTML = months.map((m) => `
    <div class="salary-row" data-key="${m.key}">
      <span>${m.label}</span>
      <span class="mono-xs">—</span>
    </div>
  `).join('');

  // Listen per month
  months.forEach((m) => {
    db.collection('salaries').doc(uid).collection('months').doc(m.key)
      .onSnapshot((snap) => {
        const row = salaryEl.querySelector(`[data-key="${m.key}"] .mono-xs`);
        if (!row) return;
        if (snap.exists && snap.data().status === 'PAID') {
          row.textContent = 'PAID ✓';
          row.style.color = 'var(--accent)';
        } else {
          row.textContent = 'PENDING —';
          row.style.color = 'var(--dim)';
        }
      });
  });
}

// ----- Calendar -----
let cursor = new Date();
cursor.setDate(1);
let activityMap = {}; // key YYYY-MM-DD -> submissions[]
let activityUnsub = null;

document.getElementById('calPrev').addEventListener('click', () => {
  cursor.setMonth(cursor.getMonth() - 1);
  loadMonth(user.uid);
});
document.getElementById('calNext').addEventListener('click', () => {
  cursor.setMonth(cursor.getMonth() + 1);
  loadMonth(user.uid);
});

loadMonth(user.uid);

function loadMonth(uid) {
  document.getElementById('calLabel').textContent =
    `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`;

  const startKey = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-01`;
  const endDate = new Date(cursor.getFullYear(), cursor.getMonth()+1, 0);
  const endKey = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')}`;

  if (activityUnsub) activityUnsub();
  activityMap = {};

  activityUnsub = db.collection('activity').doc(uid).collection('logs')
    .where('date', '>=', startKey)
    .where('date', '<=', endKey)
    .onSnapshot((snap) => {
      activityMap = {};
      snap.forEach((d) => { activityMap[d.id] = d.data().submissions || []; });
      renderCalendar();
    });
}

function renderCalendar() {
  const grid = document.getElementById('calGrid');
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const first = new Date(year, month, 1);
  // Convert Sun(0)-Sat(6) to Mon-first index (0=Mon .. 6=Sun)
  const firstIdx = (first.getDay() + 6) % 7;
  const todayStr = new Date().toDateString();

  let html = DOW.map((d)=>`<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < firstIdx; i++) html += `<div class="day empty"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const dayDate = new Date(year, month, day);
    const active = activityMap[key] && activityMap[key].length > 0;
    const isToday = dayDate.toDateString() === todayStr;
    const cls = ['day'];
    if (active) cls.push('active');
    if (isToday) cls.push('today');
    html += `<div class="${cls.join(' ')}" data-key="${key}">${String(day).padStart(2,'0')}</div>`;
  }
  grid.innerHTML = html;

  grid.querySelectorAll('.day').forEach((cell) => {
    cell.addEventListener('click', (e) => showPopover(e, cell.dataset.key));
  });
}

function showPopover(evt, key) {
  const pop = document.getElementById('calPopover');
  const subs = activityMap[key] || [];
  if (!subs.length) { pop.classList.add('hidden'); return; }
  pop.innerHTML = `
    <div class="mono-label" style="margin-bottom:8px;">${key}</div>
    ${subs.map((s)=>`
      <div style="padding:6px 0;border-bottom:0.5px solid var(--hair);">
        <div>${(s.projectName||'PROJECT')} · ${s.type||'CHAT'}</div>
        <div class="mono-xs" style="margin-top:4px;">${(s.text||'').slice(0,60)}</div>
      </div>
    `).join('')}
  `;
  pop.classList.remove('hidden');
  const rect = evt.target.getBoundingClientRect();
  const parent = pop.parentElement.getBoundingClientRect();
  pop.style.left = (rect.left - parent.left) + 'px';
  pop.style.top = (rect.bottom - parent.top + 4) + 'px';
  // Click-outside closes
  setTimeout(() => {
    document.addEventListener('click', function onDoc(e) {
      if (!pop.contains(e.target) && e.target !== evt.target) {
        pop.classList.add('hidden');
        document.removeEventListener('click', onDoc);
      }
    });
  }, 0);
}
