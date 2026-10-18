// Local account state kept in localStorage: the signed-up account, the "logged in" flag,
// the official access-code session and which emails are verified. No Firebase calls here,
// so any page can read who is logged in without waiting for the network.

export const ACCOUNT_KEY = 'ricapAccount';
export const LOGGED_KEY = 'ricapLoggedIn';
export const OFFICIAL_KEY = 'ricap_official';

// Reads and parses a localStorage value; returns null if missing or broken.
function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
}

// Emails whose official application was approved. Kept apart from the account so that
// once an account is verified, re-saving or re-creating it never drops the status.
export const VERIFIED_KEY = 'ricapVerifiedEmails';

// All emails ever verified on this browser (lower case).
function verifiedEmails() {
    const list = readJSON(VERIFIED_KEY);
    return Array.isArray(list) ? list : [];
}
// True if this email was verified on this browser before.
export function isEmailVerified(email) {
    const e = String(email || '').trim().toLowerCase();
    return !!e && verifiedEmails().includes(e);
}
// Adds an email to the verified list. Nothing ever removes it.
export function rememberVerified(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e || isEmailVerified(e)) return;
    try { localStorage.setItem(VERIFIED_KEY, JSON.stringify([...verifiedEmails(), e])); } catch (err) {  }
}

// The saved account, with verified forced on if its email is in the verified list.
export function getAccount() {
    const a = readJSON(ACCOUNT_KEY);
    if (a && !a.verified && isEmailVerified(a.email)) a.verified = true;
    return a;
}
// Saves the account; a verified account also records its email as verified.
export function saveAccount(acc) {
    if (acc && acc.verified) rememberVerified(acc.email);
    else if (acc && isEmailVerified(acc.email)) acc = { ...acc, verified: true };
    try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify(acc)); } catch (e) {  }
}
// The official session saved after redeeming an access code, or null.
export function getOfficialSession() { return readJSON(OFFICIAL_KEY); }

// True when an account exists and the user has not logged out.
export function isLocalLoggedIn() {
    try { return localStorage.getItem(LOGGED_KEY) === 'true' && !!getAccount(); } catch (e) { return false; }
}
// Turns an email into a Realtime Database key (no . # $ [ ] /).
export function emailKey(email) {
    return String(email || '').trim().toLowerCase().replace(/[.#$\[\]\/]/g, ',');
}

// Verified = redeemed an access code, or logged in with an account whose application was approved.
export function isVerifiedUser() {
    if (getOfficialSession()) return true;
    const a = getAccount();
    return isLocalLoggedIn() && !!(a && a.verified);
}

// Logs the account out on this browser but keeps the saved account.
export function clearLocalLogin() {
    try { localStorage.removeItem(LOGGED_KEY); } catch (e) {  }
}

// Best name to greet the user with: official name, account name, then Firebase user.
export function displayName(firebaseUser) {
    const off = getOfficialSession();
    if (off && off.name) return off.name;
    if (isLocalLoggedIn()) { const a = getAccount(); if (a && a.name) return a.name; }
    if (firebaseUser && !firebaseUser.isAnonymous) {
        return firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : 'Admin');
    }
    return '';
}

// Normalizes a PH mobile number to +639XXXXXXXXX, or null if it is not valid.
export function normalizePhone(raw) {
    const d = String(raw || '').replace(/[\s\-().]/g, '').replace(/^\+/, '');
    if (/^09\d{9}$/.test(d)) return '+63' + d.slice(1);
    if (/^639\d{9}$/.test(d)) return '+' + d;
    if (/^9\d{9}$/.test(d)) return '+63' + d;
    return null;
}

// Up to two initials for avatar placeholders.
export function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || '?';
}