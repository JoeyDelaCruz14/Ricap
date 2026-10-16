import { rtdb } from './firebase-config.js';
import { ref, get, set, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { ensureAuth } from './Session.js';
import { emailKey } from './account.js';

// accounts/{emailKey}          -> { createdAt }                 one entry per signed-up email
// applicationEmails/{emailKey} -> 'pending' | 'approved' | 'rejected'

export async function isEmailRegistered(email) {
    await ensureAuth();
    const snap = await get(ref(rtdb, 'accounts/' + emailKey(email)));
    return snap.exists();
}

export async function registerEmail(email) {
    await ensureAuth();
    await set(ref(rtdb, 'accounts/' + emailKey(email)), { createdAt: serverTimestamp() });
}

export async function getApplicationStatus(email) {
    await ensureAuth();
    const snap = await get(ref(rtdb, 'applicationEmails/' + emailKey(email)));
    return snap.exists() ? snap.val() : null;
}

export async function setApplicationStatus(email, status) {
    await ensureAuth();
    await set(ref(rtdb, 'applicationEmails/' + emailKey(email)), status);
}
