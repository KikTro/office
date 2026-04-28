/* =========================================================
   ACCOUNTS — profile, salary ledger, yearly work chart, calendar heatmap
   ========================================================= */

import { db } from './firebase-config.js';
import {
  requireAuth, ensureProfile, renderNav, renderTabs, rolesLabel, ym, escape
} from './auth.js';
import { ico } from './icons.js';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

const user = await requireAuth();
const profile = await ensureProfile(user);
renderNav(user, profile);
renderTabs('accounts');

document.getElementById('pageIcon').innerHTML = ico('account', 18);
document.getElementById('calPrev').innerHTML = ico('chevronL', 14);
document.getElementById('calNext').innerHTML = ico('chevronR', 14);

/* Profile block */
const initial = (profile.name || user.displayName || '?').trim().charAt(0).toUpperCase();
document.getElementById('avatar').textContent = initial;
document.getElementById('profName').textContent = profile.name || 'User';
const roleEl = document.getElementById('profRole');
roleEl.textContent = rolesLabel(profile.roles || profile.role);
roleEl.className = 'role-pill';
document.getElementById('profEmail').textContent = profile.email || '—';
document.getElementById('profUpi').textContent = maskMiddle(profile.upiId);
document.getElementById('profBank').textContent = maskMiddle(profile.bankAccount);
document.getElementById('profIfsc').textContent = profile.ifsc || '—';
document.getElementById('profSince').textContent = fmtDate(profile.createdAt);

function maskMiddle(s) {
  if (!s) return '—';
  if (s.length <= 4) return '****';
  return s.slice(0,2) + '•'.repeat(Math.max(s.length-4, 2)) + s.slice(-2);
}
function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}

/* Salary ledger */
renderSalary();
function renderSalary() {
  const host = document.getElementById('salaryList');
  const months = [];
  const today = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.push({ key: ym(d), label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` });
  }
  host.innerHTML = months.map((m)=>`
    <div class="srow" data-key="${m.key}">
      <span class="mname">${m.label}</span>
      <span class="status-pill pending" id="st-${m.key}"><span class="dot"></span>Pending</span>
    </div>`).join('');
  months.forEach((m)=>{
    db.collection('salaries').doc(user.uid).collection('months').doc(m.key)
      .onSnapshot((snap)=>{
        const el = document.getElementById(`st-${m.key}`);
        if (!el) return;
        if (snap.exists && snap.data().status === 'PAID') {
          el.className = 'status-pill completed';
          el.innerHTML = `<span class="dot"></span>Paid`;
        } else {
          el.className = 'status-pill pending';
          el.innerHTML = `<span class="dot"></span>Pending`;
        }
      });
  });
}

/* Year chart (Chart.js) */
Chart.defaults.color = 'rgba(255,255,255,0.6)';
Chart.defaults.borderColor = 'rgba(255,255,255,0.08)';
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";

const yearCtx = document.getElementById('yearChart').getContext('2d');
const yearChart = new Chart(yearCtx, {
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
        g.addColorStop(1, '#22c55e');
        return g;
      },
      borderRadius: 6,
      maxBarThickness: 28,
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

/* Aggregate activity logs across the last 12 months for the year chart */
const monthCounts = {};
(function loadYear() {
  const today = new Date();
  const monthsKeys = [];
  const labels = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    monthsKeys.push(ym(d));
    labels.push(MONTH_SHORT[d.getMonth()]);
    monthCounts[ym(d)] = 0;
  }
  yearChart.data.labels = labels;
  yearChart.data.datasets[0].data = monthsKeys.map((k)=>0);
  yearChart.update();

  // Listen to activity log subcollection
  db.collection('activity').doc(user.uid).collection('logs')
    .onSnapshot((snap) => {
      // reset
      monthsKeys.forEach((k)=>monthCounts[k] = 0);
      snap.forEach((d)=>{
        const subs = d.data().submissions || [];
        const key = d.id.slice(0, 7); // YYYY-MM
        if (key in monthCounts) monthCounts[key] += subs.length;
      });
      yearChart.data.datasets[0].data = monthsKeys.map((k)=>monthCounts[k]);
      yearChart.update();
    });
})();

/* Calendar */
let cursor = new Date(); cursor.setDate(1);
let activityMap = {};
let activityUnsub = null;

document.getElementById('calPrev').addEventListener('click', () => { cursor.setMonth(cursor.getMonth()-1); loadMonth(); });
document.getElementById('calNext').addEventListener('click', () => { cursor.setMonth(cursor.getMonth()+1); loadMonth(); });

loadMonth();

function loadMonth() {
  document.getElementById('monthSub').textContent = `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`;
  const startKey = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-01`;
  const end = new Date(cursor.getFullYear(), cursor.getMonth()+1, 0);
  const endKey = `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`;

  if (activityUnsub) activityUnsub();
  activityMap = {};
  activityUnsub = db.collection('activity').doc(user.uid).collection('logs')
    .where('date','>=',startKey).where('date','<=',endKey)
    .onSnapshot((snap)=>{
      activityMap = {};
      snap.forEach((d)=>{ activityMap[d.id] = d.data().submissions || []; });
      renderCal();
    });
}

function renderCal() {
  const grid = document.getElementById('calGrid');
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const firstIdx = (new Date(year, month, 1).getDay() + 6) % 7;
  const todayStr = new Date().toDateString();

  let html = DOW.map((d)=>`<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < firstIdx; i++) html += `<div class="day empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const subs = activityMap[key] || [];
    const count = subs.length;
    const lvl = count >= 5 ? 'lvl4' : count >= 3 ? 'lvl3' : count >= 2 ? 'lvl2' : count >= 1 ? 'lvl1' : '';
    const isToday = new Date(year, month, d).toDateString() === todayStr;
    html += `<div class="day ${lvl} ${isToday?'today':''}" data-key="${key}">${d}</div>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll('.day[data-key]').forEach((cell)=>{
    cell.addEventListener('click', (e) => showPopover(e, cell.dataset.key));
  });
}

function showPopover(evt, key) {
  const pop = document.getElementById('calPopover');
  const subs = activityMap[key] || [];
  if (!subs.length) { pop.classList.add('hidden'); return; }
  pop.innerHTML = `
    <div style="font-family: var(--font-mono); font-size: 10px; color: var(--fg-dim); letter-spacing:0.14em; text-transform: uppercase; margin-bottom: 6px;">${key}</div>
    ${subs.map((s)=>`
      <div class="row">
        <div style="font-weight:500;">${escape(s.projectName || 'Project')} · ${s.type || 'CHAT'}</div>
        <div class="text-xs text-dim" style="margin-top:2px;">${escape((s.text||'').slice(0,60))}</div>
      </div>
    `).join('')}
  `;
  pop.classList.remove('hidden');
  const rect = evt.target.getBoundingClientRect();
  const parent = pop.parentElement.getBoundingClientRect();
  pop.style.left = Math.min(rect.left - parent.left, parent.width - 240) + 'px';
  pop.style.top = (rect.bottom - parent.top + 6) + 'px';
  setTimeout(() => {
    document.addEventListener('click', function onDoc(e) {
      if (!pop.contains(e.target) && e.target !== evt.target) {
        pop.classList.add('hidden');
        document.removeEventListener('click', onDoc);
      }
    });
  }, 0);
}
