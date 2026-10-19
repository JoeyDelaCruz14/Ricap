// Email alert subscription for logged-in accounts. The subscriber list lives in Firestore
// (alertSubscribers); the sendReportAlerts Cloud Function emails them when a report is posted.
// Sa madaling salita: ini-on o ini-off nito ang email alerts kapag may bagong report sa ilog.

import { db } from './firebase-config.js';
import { doc, setDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { ensureAuth } from './Session.js';
import { getAccount, saveAccount, isLocalLoggedIn, normalizePhone } from './account.js';

// True if the logged-in account opted in to email alerts.
export function emailAlertsEnabled() {
    const a = getAccount();
    return !!(a && a.email && a.emailAlerts === true);
}

// Adds or removes this account in the Firestore subscriber list.
async function writeSubscriber(account, enabled) {
    if (!account.email) throw new Error('No email on this account.');
    const uid = await ensureAuth();
    await setDoc(doc(db, 'alertSubscribers', uid), {
        name: String(account.name || '').slice(0, 80),
        email: String(account.email).slice(0, 120),
        phone: normalizePhone(account.phone) || '',
        emailEnabled: !!enabled,
        updatedAt: serverTimestamp()
    }, { merge: true });
}

// Turns email alerts on or off for the logged-in account.
export async function setEmailAlerts(on) {
    const a = getAccount();
    if (!a) throw new Error('No account found.');
    await writeSubscriber(a, on);
    a.emailAlerts = !!on;
    saveAccount(a);
}

// Account deletion: removes this user from the subscriber list.
export async function removeSubscriber() {
    const uid = await ensureAuth();
    await deleteDoc(doc(db, 'alertSubscribers', uid));
}

// Re-saves the subscription on page load, in case it was lost on the server.
export async function resyncIfOptedIn() {
    if (!isLocalLoggedIn()) return;
    const a = getAccount();
    if (a && a.emailAlerts === true) {
        try { await writeSubscriber(a, true); } catch (e) { console.warn('RiCap: alert subscriber sync failed', e); }
    }
}