export const ACCOUNT_KEY = 'ricapAccount';
export const LOGGED_KEY = 'ricapLoggedIn';
export const OFFICIAL_KEY = 'ricap_official';

function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
}

// Emails whose official application was approved. Kept apart from the account so that
// once an account is verified, re-saving or re-creating it never drops the status.
export const VERIFIED_KEY = 'ricapVerifiedEmails';

function verifiedEmails() {
    const list = readJSON(VERIFIED_KEY);
    return Array.isArray(list) ? list : [];
}
export function isEmailVerified(email) {
    const e = String(email || '').trim().toLowerCase();
    return !!e && verifiedEmails().includes(e);
}
export function rememberVerified(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e || isEmailVerified(e)) return;
    try { localStorage.setItem(VERIFIED_KEY, JSON.stringify([...verifiedEmails(), e])); } catch (err) {  }
}

export function getAccount() {
    const a = readJSON(ACCOUNT_KEY);
    if (a && !a.verified && isEmailVerified(a.email)) a.verified = true;
    return a;
}
export function saveAccount(acc) {
    if (acc && acc.verified) rememberVerified(acc.email);
    else if (acc && isEmailVerified(acc.email)) acc = { ...acc, verified: true };
    try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify(acc)); } catch (e) {  }
}
export function getOfficialSession() { return readJSON(OFFICIAL_KEY); }

export function isLocalLoggedIn() {
    try { return localStorage.getItem(LOGGED_KEY) === 'true' && !!getAccount(); } catch (e) { return false; }
}
export function emailKey(email) {
    return String(email || '').trim().toLowerCase().replace(/[.#$\[\]\/]/g, ',');
}

// Verified = redeemed an access code, or logged in with an account whose application was approved.
export function isVerifiedUser() {
    if (getOfficialSession()) return true;
    const a = getAccount();
    return isLocalLoggedIn() && !!(a && a.verified);
}

export function clearLocalLogin() {
    try { localStorage.removeItem(LOGGED_KEY); } catch (e) {  }
}

export function displayName(firebaseUser) {
    const off = getOfficialSession();
    if (off && off.name) return off.name;
    if (isLocalLoggedIn()) { const a = getAccount(); if (a && a.name) return a.name; }
    if (firebaseUser && !firebaseUser.isAnonymous) {
        return firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : 'Admin');
    }
    return '';
}

export function normalizePhone(raw) {
    const d = String(raw || '').replace(/[\s\-().]/g, '').replace(/^\+/, '');
    if (/^09\d{9}$/.test(d)) return '+63' + d.slice(1);
    if (/^639\d{9}$/.test(d)) return '+' + d;
    if (/^9\d{9}$/.test(d)) return '+63' + d;
    return null;
}

export function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || '?';
}