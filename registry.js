// Realtime Database lookups keyed by email (see emailKey in account.js).
// Requires rules for accounts/ and applicationEmails/ (see firebase-rules-proposed.md).
// Sa madaling salita: tinitingnan kung may account na ang email at ano ang status ng application nito.

import { rtdb } from './firebase-config.js';
import { ref, get, set, remove, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { ensureAuth } from './Session.js';
import { emailKey } from './account.js';

// accounts/{emailKey}          -> { createdAt }                 one entry per signed-up email
// applicationEmails/{emailKey} -> 'pending' | 'approved' | 'rejected'

// True if this email already signed up.
export async function isEmailRegistered(email) {
    await ensureAuth();
    const snap = await get(ref(rtdb, 'accounts/' + emailKey(email)));
    return snap.exists();
}

// Records that this email signed up.
export async function registerEmail(email) {
    await ensureAuth();
    await set(ref(rtdb, 'accounts/' + emailKey(email)), { createdAt: serverTimestamp() });
}

// Account deletion: frees the email so it can sign up again.
export async function unregisterEmail(email) {
    await ensureAuth();
    await remove(ref(rtdb, 'accounts/' + emailKey(email)));
}

// The official application status for this email: 'pending', 'approved', 'rejected' or null.
export async function getApplicationStatus(email) {
    await ensureAuth();
    const snap = await get(ref(rtdb, 'applicationEmails/' + emailKey(email)));
    return snap.exists() ? snap.val() : null;
}

// Stores the application status for this email.
export async function setApplicationStatus(email, status) {
    await ensureAuth();
    await set(ref(rtdb, 'applicationEmails/' + emailKey(email)), status);
}
