/* =========================================================
   AUTH HELPERS — shared across all pages
   Provides: sign-in/out, session guard, profile setup modal,
             toast notifications, lastSeen heartbeat,
             and small UI helpers (role tag, nav render).
   ========================================================= */

import { auth, db, googleProvider, ADMIN_UID, FieldValue } from './firebase-config.js';

// ---------- Toast ----------
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
    setTimeout(() => t.remove(), 300);
  }, 2700);
}

// ---------- Sign-in / sign-out ----------
export async function signInWithGoogle() {
  try {
    const result = await auth.signInWithPopup(googleProvider);
    return result.user;
  } catch (err) {
    console.error(err);
    toast('SIGN_IN_FAILED');
  }
}

export async function signOut() {
  await auth.signOut();
  location.href = 'index.html';
}

// ---------- Guard: redirect unauthenticated users ----------
// Returns a Promise<user> once auth state is determined.
export function requireAuth() {
  return new Promise((resolve) => {
    auth.onAuthStateChanged((user) => {
      if (!user) {
        location.href = 'index.html';
        return;
      }
      resolve(user);
    });
  });
}

// ---------- Ensure profile doc exists; if not, show setup modal ----------
export async function ensureProfile(user) {
  const ref = db.collection('users').doc(user.uid);
  const snap = await ref.get();
  if (snap.exists) {
    // Update lastSeen heartbeat
    ref.update({ lastSeen: FieldValue.serverTimestamp() }).catch(() => {});
    return snap.data();
  }
  return await showProfileSetup(user);
}

function showProfileSetup(user) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <h2>COMPLETE_SETUP</h2>
        <p class="sub">ONE_TIME · AGENCY_ONBOARDING</p>
        <form id="profileForm">
          <div class="form-field">
            <label class="form-label">FULL_NAME</label>
            <input class="input" name="name" required value="${user.displayName || ''}" placeholder="FULL_NAME">
          </div>
          <div class="form-field">
            <label class="form-label">ROLE_TYPE</label>
            <div class="pill-group">
              ${['IDEATION','SCRIPT','VIDEO','MANAGER'].map((r,i)=>`
                <label><input type="radio" name="role" value="${r}" ${i===0?'checked':''}><span>${r}</span></label>
              `).join('')}
            </div>
          </div>
          <div class="form-field">
            <label class="form-label">UPI_ID</label>
            <input class="input" name="upiId" placeholder="UPI_ID_OR_@HANDLE">
          </div>
          <div class="form-field">
            <label class="form-label">BANK_ACCOUNT</label>
            <input class="input" name="bankAccount" placeholder="ACCOUNT_NUMBER">
          </div>
          <div class="form-field">
            <label class="form-label">IFSC_CODE</label>
            <input class="input" name="ifsc" placeholder="IFSC_CODE">
          </div>
          <p class="mono-xs" style="margin-top:8px;">PAYMENT_DETAILS_ARE_ENCRYPTED_AND_VISIBLE_ONLY_TO_ADMIN</p>
          <button type="submit" class="btn btn-accent" style="margin-top:16px;align-self:flex-start;">COMPLETE_SETUP</button>
        </form>
      </div>
    `;
    document.body.appendChild(backdrop);

    const form = backdrop.querySelector('#profileForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const data = {
        uid: user.uid,
        email: user.email,
        photoURL: user.photoURL || '',
        name: fd.get('name').toString().trim(),
        role: fd.get('role').toString(),
        upiId: fd.get('upiId').toString().trim(),
        bankAccount: fd.get('bankAccount').toString().trim(),
        ifsc: fd.get('ifsc').toString().trim(),
        createdAt: FieldValue.serverTimestamp(),
        lastSeen: FieldValue.serverTimestamp()
      };
      await db.collection('users').doc(user.uid).set(data);
      backdrop.remove();
      toast('PROFILE_CREATED');
      resolve(data);
    });
  });
}

// ---------- Shared nav bar rendering ----------
export function renderNav(user, profile) {
  const isAdmin = user.uid === ADMIN_UID;
  const nav = document.querySelector('.nav');
  if (!nav) return;
  nav.innerHTML = `
    <div class="nav-left">
      <span class="brand">OFFICE</span>
      <span class="dot"></span>
      <span class="version">OFFICE_V.01</span>
    </div>
    <div class="nav-right">
      <div class="nav-user">
        <span class="online-dot"></span>
        <div class="stack" style="align-items:flex-end;">
          <span class="name">${profile?.name || user.displayName || 'USER'}</span>
          <span class="role">${profile?.role || ''}${isAdmin ? ' · ADMIN' : ''}</span>
        </div>
      </div>
      <button id="logoutBtn" class="btn btn-ghost">LOGOUT</button>
    </div>
  `;
  nav.querySelector('#logoutBtn').addEventListener('click', signOut);
}

// ---------- Shared sidebar rendering ----------
// `activeId` = one of: dashboard, projects, accounts (or 'admin-*' for admin nav)
export function renderSidebar(user, profile, activeId, opts = {}) {
  const isAdmin = user.uid === ADMIN_UID;
  const sb = document.querySelector('.sidebar');
  if (!sb) return;

  const initial = (profile?.name || user.displayName || '?').trim().charAt(0).toUpperCase();
  const adminBadge = isAdmin ? `<span class="tag tag-invert" style="margin-top:6px;">ADMIN</span>` : '';

  // unread dot for projects link (compare lastVisitedProjects localStorage)
  const lastVisited = Number(localStorage.getItem('lastVisitedProjects') || 0);
  const hasUnread = opts.latestMessageTs && opts.latestMessageTs > lastVisited;

  sb.innerHTML = `
    <div class="sidebar-header">
      <div class="row gap-8"><span class="dot"></span><span class="mono-label">AGENCY_OFFICE</span></div>
    </div>
    <nav class="sidebar-nav">
      <a href="dashboard.html" class="${activeId==='dashboard'?'active':''}">DASHBOARD</a>
      <a href="projects.html" class="${activeId==='projects'?'active':''}">
        PROJECTS ${hasUnread ? '<span class="notif-dot"></span>' : ''}
      </a>
      <a href="accounts.html" class="${activeId==='accounts'?'active':''}">MY_ACCOUNT</a>
    </nav>
    <div class="sidebar-footer">
      <div class="row gap-12">
        <div class="avatar-sq">${initial}</div>
        <div class="stack">
          <span class="mono" style="font-size:11px;">${profile?.name || user.displayName || 'USER'}</span>
          <span class="mono-xs">${profile?.role || ''}</span>
        </div>
      </div>
      ${adminBadge}
      <button id="sbLogout" class="btn btn-ghost">LOGOUT</button>
    </div>
  `;
  sb.querySelector('#sbLogout').addEventListener('click', signOut);
}

// ---------- Misc helpers ----------
export function roleTagHTML(role) {
  if (!role) return '';
  const cls = `tag role-${role}`;
  return `<span class="${cls}">${role}</span>`;
}

export function formatDate(ts) {
  if (!ts) return '--/--/----';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  return `${dd}/${mm}/${d.getFullYear()} · ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function ym(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

export function isLink(text) {
  try { const u = new URL(text.trim()); return !!u.protocol; } catch { return /^https?:\/\//i.test(text); }
}

export { ADMIN_UID };
