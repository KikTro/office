/* =========================================================
   AUTH HELPERS — shared across pages
   ========================================================= */

import { auth, db, googleProvider, ADMIN_UID, FieldValue } from './firebase-config.js';
import { ICONS, ico } from './icons.js';

/* ---------- Toast ---------- */
export function toast(msg) {
  let host = document.querySelector('.toast-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 260);
  }, 2600);
}

/* ---------- Auth actions ---------- */
export async function signInWithGoogle() {
  if (location.protocol === 'file:') {
    toast('Use HTTPS or a local web server, not file://');
    return null;
  }

  try {
    const result = await auth.signInWithPopup(googleProvider);
    return result.user;
  } catch (err) {
    console.error(err);
    const msg = err.code === 'auth/operation-not-supported-in-this-environment'
      ? 'Use HTTPS or GitHub Pages to sign in'
      : 'SIGN_IN_FAILED';
    toast(msg);
  }
}

export async function signOut() {
  await auth.signOut();
  location.href = 'index.html';
}

export function requireAuth() {
  return new Promise((resolve) => {
    auth.onAuthStateChanged((user) => {
      if (!user) { location.href = 'index.html'; return; }
      resolve(user);
    });
  });
}

/* ---------- Profile doc bootstrap ---------- */
export async function ensureProfile(user) {
  const ref = db.collection('users').doc(user.uid);
  const snap = await ref.get();
  if (snap.exists) {
    ref.update({ lastSeen: FieldValue.serverTimestamp() }).catch(() => {});
    return snap.data();
  }
  return await showProfileSetup(user);
}

export function normalizeRoles(roleOrRoles) {
  if (!roleOrRoles) return [];
  return Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
}

export function rolesLabel(roleOrRoles) {
  const roles = normalizeRoles(roleOrRoles);
  return roles.length ? roles.join(', ') : 'Member';
}

export function roleTagHTML(roleOrRoles) {
  const roles = normalizeRoles(roleOrRoles);
  if (!roles.length) return '';
  return roles.map((role) => `<span class="role-pill role-${role}">${role}</span>`).join(' ');
}

function showProfileSetup(user) {
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `
      <div class="modal">
        <h2>Complete your profile</h2>
        <p class="sub">One-time onboarding · Agency access</p>
        <form id="profileForm">
          <div class="field">
            <label>Full name</label>
            <input class="input" name="name" required value="${escape(user.displayName || '')}">
          </div>
          <div class="field">
            <label>Roles</label>
            <div class="pill-group">
              ${['IDEATION','SCRIPT','VIDEO','MANAGER'].map((r)=>`
                <label><input type="checkbox" name="roles" value="${r}">${r}</label>
              `).join('')}
            </div>
          </div>
          <div class="field">
            <label>UPI ID</label>
            <input class="input" name="upiId" placeholder="yourname@okaxis">
          </div>
          <div class="field">
            <label>Bank account</label>
            <input class="input" name="bankAccount" placeholder="Account number">
          </div>
          <div class="field">
            <label>IFSC code</label>
            <input class="input" name="ifsc" placeholder="IFSC code">
          </div>
          <p class="text-xs text-dim" style="font-family: var(--font-mono); letter-spacing: 0.1em;">
            PAYMENT_DETAILS_ENCRYPTED · VISIBLE_ONLY_TO_ADMIN
          </p>
          <div class="row">
            <button type="submit" class="ctrl primary">Complete setup</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(bd);

    bd.querySelector('#profileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const roles = fd.getAll('roles').map((r) => r.toString()).filter(Boolean);
      if (!roles.length) {
        toast('Select at least one role');
        return;
      }
      const data = {
        uid: user.uid,
        email: user.email,
        photoURL: user.photoURL || '',
        name: fd.get('name').toString().trim(),
        role: roles[0],
        roles,
        upiId: fd.get('upiId').toString().trim(),
        bankAccount: fd.get('bankAccount').toString().trim(),
        ifsc: fd.get('ifsc').toString().trim(),
        createdAt: FieldValue.serverTimestamp(),
        lastSeen: FieldValue.serverTimestamp()
      };
      await db.collection('users').doc(user.uid).set(data);
      bd.remove();
      toast('PROFILE_CREATED');
      resolve(data);
    });
  });
}

/* ---------- Shared nav (top bar) ---------- */
export function renderNav(user, profile) {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  const isAdmin = user.uid === ADMIN_UID;
  const initial = (profile?.name || user.displayName || '?').trim().charAt(0).toUpperCase();

  nav.innerHTML = `
    <div class="nav-left">
      <div class="brand">
        <img src="TEXT%20LOGO.png" alt="KikTro Labs" class="brand-logo">
        <div class="brand-text">
          <span>KikTro Labs</span>
          <span class="brand-sub">Digital Office & Workspace</span>
        </div>
      </div>
    </div>
    <div class="nav-right">
      ${isAdmin ? `<a href="admin.html" class="ctrl" style="color: var(--warn); border-color: rgba(245,158,11,0.4);">${ico('shield', 14)} ADMIN</a>` : ''}
      <div class="profile-pill" id="profilePill">
        <div class="avatar">${initial}</div>
        <div class="pmeta">
          <span class="pname">${escape(profile?.name || user.displayName || 'User')}</span>
          <span class="prole">${rolesLabel(profile?.roles || profile?.role)}</span>
        </div>
        <span class="online-dot" title="Online"></span>
      </div>
      <button id="logoutBtn" class="ctrl" title="Logout">${ico('logout', 14)}</button>
    </div>`;
  nav.querySelector('#logoutBtn').addEventListener('click', signOut);
}

/* ---------- Horizontal tab strip (below nav) ---------- */
export function renderTabs(activeId) {
  const host = document.querySelector('.tabs');
  if (!host) return;
  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', href: 'dashboard.html' },
    { id: 'projects',  label: 'Projects',  icon: 'projects',  href: 'projects.html'  },
    { id: 'accounts',  label: 'My Account',icon: 'account',   href: 'accounts.html'  },
  ];
  host.innerHTML = tabs.map((t)=>`
    <a class="tab ${t.id===activeId?'active':''}" href="${t.href}">
      ${ico(t.icon, 16)}<span>${t.label}</span>
    </a>
  `).join('');
}

/* ---------- Helpers ---------- */
export function statusPill(status) {
  const cls = {
    'Completed':'completed', 'In Progress':'in-progress', 'Blocked':'blocked',
    'ACTIVE':'completed', 'APPROVED':'completed', 'PENDING':'pending', 'REJECTED':'blocked',
    'PAID':'completed'
  }[status] || 'pending';
  return `<span class="status-pill ${cls}"><span class="dot"></span>${status}</span>`;
}

export function formatDate(ts) {
  if (!ts) return '--';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const hh = String(d.getHours()).padStart(2,'0');
  const mi = String(d.getMinutes()).padStart(2,'0');
  return `${dd}/${mm}/${d.getFullYear()} · ${hh}:${mi}`;
}

export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function ym(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

export function isLink(text='') {
  try { const u = new URL(text.trim()); return !!u.protocol; } catch { return /^https?:\/\//i.test(text); }
}

export function escape(str='') {
  return String(str).replace(/[&<>"']/g, (c)=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

export { ADMIN_UID, ICONS, ico };
