# OFFICE — Digital Office System

A Swiss-brutalist, monochrome, editorial web-app for a creative agency.
Built as a **pure static site** (HTML + CSS + vanilla JS) with **Firebase**
(loaded via CDN) for Google Auth + Firestore. Deploys to GitHub Pages with
zero build step.

---

## 1. Firebase setup

1. Go to <https://console.firebase.google.com> and create a new project.
2. **Authentication → Sign-in method → Google → Enable.**
   Add your GitHub Pages domain (e.g. `kiktro.github.io`) and `localhost`
   to the authorised domains list.
3. **Firestore Database → Create database** (start in *production mode*).
4. **Project settings → General → Your apps → Web app** → copy the
   `firebaseConfig` object.
5. Open `js/firebase-config.js` and:
   - Replace all `REPLACE_WITH_...` values with your config.
   - Sign in once (via the deployed site or `index.html`), then open
     **Authentication → Users** in the Firebase console, copy your UID, and
     paste it into `ADMIN_UID` in the same file.
6. Copy the **security rules** block from the comment at the bottom of
   `js/firebase-config.js` into **Firestore → Rules**, replacing
   `ADMIN_UID` with your UID.

---

## 2. Deploy to GitHub Pages

```bash
git add .
git commit -m "Deploy OFFICE"
git push origin main
```

In the GitHub repo:

- **Settings → Pages → Build and deployment → Source: Deploy from a branch**
- Select `main` branch, root (`/`) folder, Save.
- Your site will be live at `https://<username>.github.io/<repo>/`.

> ⚠️ If deploying to a sub-path (e.g. `/office/`), all links in the HTML
> files use relative paths so it works out of the box.

---

## 3. File structure

```
index.html          Landing / Google sign-in
dashboard.html      Employee dashboard
projects.html       Discord-style project threads
accounts.html       Profile, salary ledger, activity calendar
admin.html          Hidden admin portal (URL-only access)
404.html            Redirects back to index.html
css/style.css       Design system — "Architectural Type System"
js/firebase-config.js   Firebase init + schema + security-rules docs
js/auth.js          Auth guard, profile setup modal, shared UI
js/dashboard.js     Dashboard logic
js/projects.js      Real-time projects + messaging
js/accounts.js      Salary + calendar
js/admin.js         Full admin portal (tabs, CRUD, view-as-employee)
```

---

## 4. Firestore data model

- `users/{uid}` — profile, role, payment details, `lastSeen`
- `projects/{projectId}` — name, description, roles, status
- `projects/{projectId}/messages/{messageId}` — thread messages, reactions
- `activity/{uid}/logs/{YYYY-MM-DD}` — daily submission summaries (calendar)
- `salaries/{uid}/months/{YYYY-MM}` — monthly pay status (ledger)

Full schema is documented at the top of `js/firebase-config.js`.

---

## 5. Security notes

- The admin check is enforced in **two** places:
  - Client-side UID check in `js/admin.js` (UX / defence-in-depth).
  - **Firestore Security Rules** are the real boundary — make sure you
    paste the rules block into the Firebase console and that
    `ADMIN_UID` there matches the one in `firebase-config.js`.
- No file uploads exist. Employees submit **text / links only**, which
  eliminates storage-bucket exposure concerns.
- Payment details (`upiId`, `bankAccount`, `ifsc`) are only ever rendered
  in full on `admin.html`. On `accounts.html` they are masked.

---

## 6. Design system — Architectural Type System

- Black `#000` / White `#FFF` / Accent `#6366f1` (used sparingly).
- Hairline borders: `0.5px solid rgba(255,255,255,0.15)`.
- Fonts: **Inter Tight 900** (display), **JetBrains Mono 500** (labels),
  **Inter 300/400** (body).
- Zero border-radius except pill buttons.
- Fractal-noise overlay at 5% opacity on every page.
- All hover transitions: `300ms ease`; geometric rotates: `700ms cubic-bezier`.

Design tokens live in CSS custom properties at the top of `css/style.css`.

---

## 7. Included bonus features

- ✅ Notification dot for unread project messages (localStorage).
- ✅ Role-based color tags (IDEATION / SCRIPT / VIDEO / MANAGER).
- ✅ Project search bar.
- ✅ Message-count badges per project.
- ✅ Online indicator via `lastSeen` heartbeat.
- ✅ `Enter` keyboard shortcut in composer.
- ✅ Typographic empty states.
- ✅ Toast notifications (bottom-right, auto-dismiss).
- ✅ Responsive: sidebar collapses to bottom nav on mobile.
- ✅ `ADMIN` pill for admin user.
- ✅ `404.html` SPA fallback for GitHub Pages.

---

Built with ♦ for editorial minds.
