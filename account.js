// Tiny helpers for the local RiCap account (created in the Sign Up form) and the verified-official session.
// No imports on purpose, so any page/module can use it.
export const ACCOUNT_KEY = 'ricapAccount';
export const LOGGED_KEY = 'ricapLoggedIn';
export const OFFICIAL_KEY = 'ricap_official';

function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
}

export function getAccount() { return readJSON(ACCOUNT_KEY); }
export function saveAccount(acc) {
    try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify(acc)); } catch (e) { /* ignore */ }
}
export function getOfficialSession() { return readJSON(OFFICIAL_KEY); }

export function isLocalLoggedIn() {
    try { return localStorage.getItem(LOGGED_KEY) === 'true' && !!getAccount(); } catch (e) { return false; }
}
export function clearLocalLogin() {
    try { localStorage.removeItem(LOGGED_KEY); } catch (e) { /* ignore */ }
}

// Name to greet the person with: the name they typed at sign-up (or the official's / admin's name)
export function displayName(firebaseUser) {
    const off = getOfficialSession();
    if (off && off.name) return off.name;
    if (isLocalLoggedIn()) { const a = getAccount(); if (a && a.name) return a.name; }
    if (firebaseUser && !firebaseUser.isAnonymous) {
        return firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : 'Admin');
    }
    return '';
}

// Philippine mobile numbers -> +639XXXXXXXXX (accepts 09XXXXXXXXX, 9XXXXXXXXX, 639XXXXXXXXX, +639XXXXXXXXX)
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