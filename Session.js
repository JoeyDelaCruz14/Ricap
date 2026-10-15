import { rtdb, auth, app } from './firebase-config.js';
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { signInAnonymously, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { performLogout } from './admin-nav.js';

const KEY = 'ricap_official';

export function getOfficial() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
}
export function isVerified() { return !!getOfficial(); }


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
    return official;
}

export async function hasOfficialClaim() {
    try {
        await ensureAuth();
        const token = await auth.currentUser.getIdTokenResult();
        return token.claims.official === true;
    } catch (e) {
        return false;
    }
}

export async function signOutOfficial() {
    try { localStorage.removeItem(KEY); } catch (e) {  }
    authPromise = null;
    try { if (auth.currentUser && auth.currentUser.isAnonymous) await signOut(auth); } catch (e) {  }
}

export async function revalidate() {
    const o = getOfficial();
    if (!o) return null;
    try {
        const snap = await get(ref(rtdb, 'accessCodes/' + o.code));
        if (!snap.exists() || !snap.val().active) { localStorage.removeItem(KEY); return null; }
    } catch (e) {  }
    return o;
}

export function logout() {
    return performLogout();
}

let authPromise = null;
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

export function mountAuthNav() {
    const links = document.getElementById('navLinks');
    if (!links || document.getElementById('navAuthItem')) return;
    if (links.querySelector('a[href="Apply.html"]')) return;   
    const li = document.createElement('li');
    li.id = 'navAuthItem';
    li.innerHTML = '<a href="Apply.html">Verify</a>';
    links.appendChild(li);
}