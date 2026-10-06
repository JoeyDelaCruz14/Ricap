// Shared verified-official session + logout button for every page.
import { rtdb, auth } from './firebase-config.js';
import { ref, get } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
// Side-effect import: shows the Admin / Maintenance nav links when an admin is signed in.
import { performLogout } from './admin-nav.js';

const KEY = 'ricap_official';

export function getOfficial() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
}
export function isVerified() { return !!getOfficial(); }

// Call this from Submit.html's access-code form, then redirect to Image_Processing.html
export async function verifyCode(code) {
    code = String(code || '').trim().toUpperCase();
    const snap = await get(ref(rtdb, 'accessCodes/' + code));
    if (!snap.exists() || !snap.val().active) throw new Error('Invalid or inactive access code.');
    const v = snap.val();
    const official = { code, name: v.officialName, role: v.role, organization: v.organization };
    localStorage.setItem(KEY, JSON.stringify(official));
    return official;
}

// Re-check that the stored code is still active (admin may have revoked it)
export async function revalidate() {
    const o = getOfficial();
    if (!o) return null;
    try {
        const snap = await get(ref(rtdb, 'accessCodes/' + o.code));
        if (!snap.exists() || !snap.val().active) { localStorage.removeItem(KEY); return null; }
    } catch (e) { /* offline: keep session */ }
    return o;
}

// Logs out everyone: verified official, admin or guest (see admin-nav.js)
export function logout() {
    return performLogout();
}

let authPromise = null;
export function ensureAuth() {
    if (!authPromise) {
        // IMPORTANT: wait for Firebase to restore any saved session (e.g. the admin's)
        // BEFORE deciding whether to sign in anonymously. Otherwise currentUser is
        // still null at page load and the anonymous sign-in replaces the admin login.
        authPromise = auth.authStateReady().then(() => {
            if (auth.currentUser) return auth.currentUser.uid;
            return signInAnonymously(auth).then(c => c.user.uid);
        });
        authPromise.catch(() => { authPromise = null; });
    }
    return authPromise;
}

// Adds "Verify" to the nav for people who are not verified yet.
// (The Logout link for everyone is added by admin-nav.js.)
export function mountAuthNav() {
    const links = document.getElementById('navLinks');
    if (!links || document.getElementById('navAuthItem')) return;
    if (getOfficial()) return;
    const li = document.createElement('li');
    li.id = 'navAuthItem';
    li.innerHTML = '<a href="Submit.html">Verify</a>';
    links.appendChild(li);
}