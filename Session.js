import { rtdb, auth, app } from './firebase-config.js';
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { signInAnonymously, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { performLogout } from './admin-nav.js';
import { isVerifiedUser, isLocalLoggedIn, getAccount, saveAccount } from './account.js';

const KEY = 'ricap_official';

// The saved official session (code, name, role, organization), or null.
export function getOfficial() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
}
// True while an official session exists.
export function isVerified() { return !!getOfficial(); }


// Checks an access code and saves the official session. Throws with a readable message if invalid.
export async function verifyCode(code) {
    code = String(code || '').trim().toUpperCase();
    await ensureAuth();
    let official;
    try {
        if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') throw { code: 'functions/not-found' };
        const redeem = httpsCallable(getFunctions(app, 'asia-southeast1'), 'redeemAccessCode');
        const res = await redeem({ code });
        await auth.currentUser.getIdToken(true);
        const v = res.data || {};
        official = { code, name: v.name, role: v.role, organization: v.organization, uid: auth.currentUser.uid };
    } catch (err) {
        const c = String(err && err.code || '');
        if (c === 'functions/permission-denied' || c === 'functions/invalid-argument') {
            throw new Error('Invalid or inactive access code.');
        }
        if (c !== 'functions/not-found' && c !== 'functions/internal' && c !== 'functions/unavailable') throw err;
        console.warn('RiCap: redeemAccessCode is not deployed yet, using the browser-side check', err);
        const snap = await get(ref(rtdb, 'accessCodes/' + code));
        if (!snap.exists() || !snap.val().active) throw new Error('Invalid or inactive access code.');
        const v = snap.val();
        official = { code, name: v.officialName, role: v.role, organization: v.organization, legacy: true };
    }
    localStorage.setItem(KEY, JSON.stringify(official));
    // A logged-in account that redeems a code stays verified after logging out and back in.
    const a = isLocalLoggedIn() ? getAccount() : null;
    if (a && !a.verified) saveAccount({ ...a, verified: true });
    return official;
}

// True if the Firebase token carries the official claim set by redeemAccessCode.
export async function hasOfficialClaim() {
    try {
        await ensureAuth();
        const token = await auth.currentUser.getIdTokenResult();
        return token.claims.official === true;
    } catch (e) {
        return false;
    }
}

// Ends the official session; signs out only anonymous Firebase users.
export async function signOutOfficial() {
    try { localStorage.removeItem(KEY); } catch (e) {  }
    authPromise = null;
    try { if (auth.currentUser && auth.currentUser.isAnonymous) await signOut(auth); } catch (e) {  }
}

// Drops the official session if its access code was deactivated.
export async function revalidate() {
    const o = getOfficial();
    if (!o) return null;
    try {
        const snap = await get(ref(rtdb, 'accessCodes/' + o.code));
        if (!snap.exists() || !snap.val().active) { localStorage.removeItem(KEY); return null; }
    } catch (e) {  }
    return o;
}

// Full logout (official + account + Firebase), then back to the landing page.
export function logout() {
    return performLogout();
}

let authPromise = null;
// Resolves to the current Firebase uid once auth is ready. Shared promise, so it runs once per page.
export function ensureAuth() {
    if (!authPromise) {
        authPromise = auth.authStateReady().then(() => {
            if (auth.currentUser) return auth.currentUser.uid;
            return signInAnonymously(auth).then(c => c.user.uid);
        });
        authPromise.catch(() => { authPromise = null; });
    }
    return authPromise;
}

// Adds a "Verify" link to the nav for users who are not verified yet.
export function mountAuthNav() {
    const links = document.getElementById('navLinks');
    if (!links || document.getElementById('navAuthItem') || isVerifiedUser()) return;
    if (links.querySelector('a[href="Verify.html"]')) return;   
    const li = document.createElement('li');
    li.id = 'navAuthItem';
    li.innerHTML = '<a href="Verify.html">Verify</a>';
    links.appendChild(li);
}