// Email alert subscription. The browser only records WHO wants alerts (Firestore: alertSubscribers/{uid});
// the emails are sent by the Cloud Function in functions/index.js.
// (Pop-up notifications are handled by Notify.js while the site is open.)
import { db } from './firebase-config.js';
import { doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { ensureAuth } from './Session.js';
import { getAccount, saveAccount, isLocalLoggedIn, normalizePhone } from './account.js';

export function emailAlertsEnabled() {
    const a = getAccount();
    return !!(a && a.email && a.emailAlerts === true);
}

async function writeSubscriber(account, enabled) {
    if (!account.email) throw new Error('No email on this account.');
    const uid = await ensureAuth();
    await setDoc(doc(db, 'alertSubscribers', uid), {
        name: String(account.name || '').slice(0, 80),
        email: String(account.email).slice(0, 120),
        phone: normalizePhone(account.phone) || '',      // optional
        emailEnabled: !!enabled,
        updatedAt: serverTimestamp()
    }, { merge: true });
}

// Turn email alerts on/off for the logged-in account
export async function setEmailAlerts(on) {
    const a = getAccount();
    if (!a) throw new Error('No account found.');
    await writeSubscriber(a, on);
    a.emailAlerts = !!on;
    saveAccount(a);
}

// Call after sign-up / login / page load so the current (anonymous) uid has a subscriber record.
export async function resyncIfOptedIn() {
    if (!isLocalLoggedIn()) return;
    const a = getAccount();
    if (a && a.emailAlerts === true) {
        try { await writeSubscriber(a, true); } catch (e) { console.warn('RiCap: alert subscriber sync failed', e); }
    }
}