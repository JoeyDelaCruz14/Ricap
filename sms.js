// SMS alert subscription. The browser only records WHO wants alerts (Firestore: smsSubscribers/{uid});
// the actual text messages are sent by the Cloud Function in functions/index.js.
import { db } from './firebase-config.js';
import { doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { ensureAuth } from './Session.js';
import { getAccount, saveAccount, isLocalLoggedIn, normalizePhone } from './account.js';

export function smsEnabled() {
    const a = getAccount();
    return !!(a && a.phone && a.smsOptIn === true);
}

async function writeSubscriber(account, enabled) {
    const phone = normalizePhone(account.phone);
    if (!phone) throw new Error('No valid phone number on this account.');
    const uid = await ensureAuth();
    await setDoc(doc(db, 'smsSubscribers', uid), {
        name: String(account.name || '').slice(0, 80),
        phone,
        enabled: !!enabled,
        updatedAt: serverTimestamp()
    }, { merge: true });
}

// Turn SMS alerts on/off for the logged-in account
export async function setSmsEnabled(on) {
    const a = getAccount();
    if (!a || !a.phone) throw new Error('No phone number saved for this account.');
    await writeSubscriber(a, on);
    a.smsOptIn = !!on;
    saveAccount(a);
}

// Call after sign-up / login / page load so the current (anonymous) uid has a subscriber record.
export async function resyncIfOptedIn() {
    if (!isLocalLoggedIn()) return;
    const a = getAccount();
    if (a && a.phone && a.smsOptIn === true) {
        try { await writeSubscriber(a, true); } catch (e) { console.warn('RiCap: SMS subscriber sync failed', e); }
    }
}