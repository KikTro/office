/* =========================================================
   FIREBASE CONFIG
   Loaded via Firebase v9 "compat" CDN (see HTML <script> tags).
   Uses `firebase` global exposed by the compat SDK so this file
   can be imported as an ES module on GitHub Pages without bundling.
   ========================================================= */

// ---------------------------------------------------------
// 1. REPLACE WITH YOUR FIREBASE CONFIG
// ---------------------------------------------------------
// Go to https://console.firebase.google.com -> Project Settings
// -> General -> Your apps -> SDK setup and configuration.
const firebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_API_KEY",
  authDomain: "REPLACE_WITH_YOUR_PROJECT.firebaseapp.com",
  projectId: "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket: "REPLACE_WITH_YOUR_PROJECT.appspot.com",
  messagingSenderId: "REPLACE_WITH_YOUR_SENDER_ID",
  appId: "REPLACE_WITH_YOUR_APP_ID"
};

// ---------------------------------------------------------
// 2. ADMIN USER UID
// ---------------------------------------------------------
// After you log in once with your Google account, open the
// Firebase Authentication console, copy your UID, and paste it
// here. Only this UID can access /admin.html.
export const ADMIN_UID = "REPLACE_WITH_YOUR_FIREBASE_UID";

// Initialise only once (compat SDK exposes global `firebase`)
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

export const auth = firebase.auth();
export const db = firebase.firestore();
export const googleProvider = new firebase.auth.GoogleAuthProvider();
export const FieldValue = firebase.firestore.FieldValue;
export const Timestamp = firebase.firestore.Timestamp;

// ---------------------------------------------------------
// 3. FIRESTORE DATA MODEL (schema reference)
// ---------------------------------------------------------
// users/{uid}
//   { name, role, email, uid, photoURL, upiId, bankAccount, ifsc,
//     createdAt, lastSeen }
//
// projects/{projectId}
//   { name, description, assignedRoles[], createdAt, status, createdBy }
//
// projects/{projectId}/messages/{messageId}
//   { uid, name, role, text, type, timestamp, reaction }
//
// activity/{uid}/logs/{YYYY-MM-DD}
//   { date, submissions: [{ projectId, projectName, type, text, timestamp }] }
//
// salaries/{uid}/months/{YYYY-MM}
//   { status, paidAt, month, year }

// ---------------------------------------------------------
// 4. SUGGESTED FIREBASE SECURITY RULES
// ---------------------------------------------------------
// Paste the block below into Firestore Rules in the Firebase
// console. Replace ADMIN_UID with the same UID as above.
/*
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function isSignedIn()  { return request.auth != null; }
    function isAdmin()     { return isSignedIn() && request.auth.uid == "ADMIN_UID"; }
    function isSelf(uid)   { return isSignedIn() && request.auth.uid == uid; }

    // User profiles: self can r/w, admin can r/w everyone
    match /users/{uid} {
      allow read:  if isSelf(uid) || isAdmin() || isSignedIn();
      allow write: if isSelf(uid) || isAdmin();
    }

    // Projects: any signed-in user can read; only admin can create/delete
    match /projects/{projectId} {
      allow read:   if isSignedIn();
      allow create: if isAdmin();
      allow update: if isAdmin();
      allow delete: if isAdmin();

      // Messages: signed-in users can read all, and create their own
      match /messages/{messageId} {
        allow read:   if isSignedIn();
        allow create: if isSignedIn() && request.resource.data.uid == request.auth.uid;
        // Only admin can update reactions or delete
        allow update: if isAdmin();
        allow delete: if isAdmin();
      }
    }

    // Activity logs: self or admin
    match /activity/{uid}/logs/{day} {
      allow read:  if isSelf(uid) || isAdmin();
      allow write: if isSelf(uid) || isAdmin();
    }

    // Salary records: self read, admin write
    match /salaries/{uid}/months/{month} {
      allow read:  if isSelf(uid) || isAdmin();
      allow write: if isAdmin();
    }
  }
}
*/
