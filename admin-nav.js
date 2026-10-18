// Shared nav behaviour on every page: shows Admin/Maintenance links to admins, adds Log out,
// the greeting with the profile picture, the mobile menu toggle, and keeps the verified state
// and the published profile up to date. Also exports performLogout() for other scripts.

import { auth } from './firebase-config.js';
import { startReportAlerts } from './Notify.js';
import { displayName, isLocalLoggedIn, clearLocalLogin, getOfficialSession, isVerifiedUser, getAccount, saveAccount } from './account.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { isAdminUser } from './admin-role.js';

const LOGOUT_REDIRECT = 'main.html';
const OFFICIAL_KEY = 'ricap_official';  
// Logs out everything (official session, local account, Firebase) and goes to the landing page.
export async function performLogout() {
    try { localStorage.removeItem(OFFICIAL_KEY); } catch (e) {  }
    clearLocalLogin();
    try { await signOut(auth); } catch (err) { console.warn('Sign-out failed', err); }
    window.location.href = LOGOUT_REDIRECT;
}

// Adds hidden Admin and Maintenance links to pages that do not declare them.
function ensureAdminLinks() {
    const links = document.getElementById('navLinks');
    if (!links) return;
    [['Admin.html', 'Admin'], ['maintenance.html', 'Maintenance']].forEach(([href, text]) => {
        if (links.querySelector(`a[href="${href}"]`)) return;
        const li = document.createElement('li');
        li.setAttribute('data-admin-only', '');
        li.hidden = true;
        const a = document.createElement('a');
        a.href = href;
        a.textContent = text;
        li.appendChild(a);
        links.appendChild(li);
    });
}

// Adds a Log out link to the nav (shown only when someone is logged in).
function ensureLogoutLink() {
    const links = document.getElementById('navLinks');
    if (!links || links.querySelector('[data-logout]')) return;
    const li = document.createElement('li');
    li.setAttribute('data-logout', '');
    li.hidden = true;
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = 'Logout';
    a.addEventListener('click', async e => {
        e.preventDefault();
        await performLogout();
    });
    li.appendChild(a);
    links.appendChild(li);
}

// Adds the "Hi, name" greeting with a small avatar, linking to the profile page.
function ensureGreeting() {
    const links = document.getElementById('navLinks');
    if (!links) return null;
    let li = links.querySelector('[data-greeting]');
    if (!li) {
        li = document.createElement('li');
        li.setAttribute('data-greeting', '');
        li.hidden = true;
        const span = document.createElement('a');
        span.href = 'pfp.html';
        span.style.cssText = 'display:inline-block;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
            'vertical-align:bottom;color:#d9c2ff;font-size:0.9rem;font-weight:600;letter-spacing:0.08em;text-decoration:none;';
        li.appendChild(span);
        const img = document.createElement('img');
        img.setAttribute('data-nav-avatar', '');
        img.alt = '';
        img.width = img.height = 24;
        img.hidden = true;
        img.style.cssText = 'width:24px;height:24px;margin-right:8px;border-radius:50%;object-fit:cover;vertical-align:middle;';
        span.prepend(img);
        span.append(document.createElement('span'));
        const logout = links.querySelector('[data-logout]');
        links.insertBefore(li, logout || null);
    }
    return li;
}


// Nav items labelled Login (hidden while someone is logged in).
function loginItems() {
    return [...document.querySelectorAll('#navLinks li')].filter(li =>
        !li.hasAttribute('data-logout') &&
        li.textContent.trim().toLowerCase() === 'login');
}

// The Scanner is only for verified officials and admins. Officials who still need to enter their
// access code reach it from "Enter access code" (Home) or "Go to Scanner" (profile), which stay visible.
const SCANNER_LINKS = '#navLinks a[href="Image_Processing.html"], a.docs-new-scan-btn, .docs-empty a[href="Image_Processing.html"]';
function paintScannerLinks(show) {
    document.querySelectorAll(SCANNER_LINKS).forEach(a => {
        const el = a.closest('#navLinks li') || a;
        el.hidden = !show;
        el.style.display = show ? '' : 'none';
    });
}

// Updates the nav for the current user: admin links, login/logout items, greeting.
async function apply(user) {
    const isAdmin = await isAdminUser(user);
    if (user !== auth.currentUser) return;
    const loggedIn = isAdmin || isLocalLoggedIn() || !!getOfficialSession();
    ensureAdminLinks();
    ensureLogoutLink();
    const greet = ensureGreeting();
    document.querySelectorAll('[data-admin-only]').forEach(el => { el.hidden = !isAdmin; });
    loginItems().forEach(li => { li.hidden = loggedIn; });
    const verified = isVerifiedUser();
    document.querySelectorAll('#navLinks a[href="Verify.html"]').forEach(a => { a.closest('li').hidden = verified; });
    paintScannerLinks(verified || isAdmin);
    const logout = document.querySelector('#navLinks [data-logout]');
    if (logout) logout.hidden = !loggedIn;
    if (greet) {
        const name = displayName(user);
        greet.hidden = !name;
        greet.firstChild.lastChild.textContent = name ? 'Hi, ' + name : '';
        greet.firstChild.title = name || '';
        paintNavAvatar(user && !user.isAnonymous ? user.photoURL : '');
    }
}

// Shows the profile picture in the greeting, or hides it when there is none.
function paintNavAvatar(url) {
    const img = document.querySelector('#navLinks [data-nav-avatar]');
    if (!img) return;
    img.hidden = !url;
    if (url) img.src = url;
    else img.removeAttribute('src');
}

// Pages without their own menu script mark the toggle with data-nav-toggle.
// Mobile menu open/close for pages whose toggle button has data-nav-toggle.
function initToggle() {
    const toggle = document.getElementById('navToggle');
    const links = document.getElementById('navLinks');
    if (!toggle || !links || !toggle.hasAttribute('data-nav-toggle')) return;
    // Opens or closes the mobile menu.
    const setOpen = open => {
        links.classList.toggle('open', open);
        toggle.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', String(open));
    };
    toggle.addEventListener('click', () => setOpen(!links.classList.contains('open')));
    links.addEventListener('click', e => { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
}

// Entry point: builds the nav extras and listens for auth and storage changes.
function start() {
    initToggle();
    // Hide right away for normal users; apply() shows it again once an admin is confirmed.
    paintScannerLinks(isVerifiedUser());
    apply(auth.currentUser);
    onAuthStateChanged(auth, apply);
    window.addEventListener('storage', () => apply(auth.currentUser));
    window.addEventListener('ricap:avatar-change', e => paintNavAvatar(e.detail && e.detail.url));
    refreshVerified().then(publishProfile);
    startReportAlerts();
}

// Keeps the admin's list of verified users (Maintenance → Verified users) up to date.
let profilePublished = false;
// Publishes a verified user to profiles/ once per page so Maintenance can list them.
async function publishProfile() {
    if (profilePublished || !isVerifiedUser()) return;
    profilePublished = true;
    try {
        const { syncProfile } = await import('./profile-sync.js');
        await syncProfile();
    } catch (e) {
        profilePublished = false;
        console.warn('RiCap: could not publish profile', e);
    }
}

// Picks up an approval that happened after the user logged in.
// Picks up an approval or redeemed code that happened after the user logged in.
async function refreshVerified() {
    const a = getAccount();
    if (!isLocalLoggedIn() || !a || !a.email || a.verified) return;
    try {
        const user = auth.currentUser;
        if (user && !user.isAnonymous && user.email && user.email.toLowerCase() === String(a.email).toLowerCase() &&
            (await user.getIdTokenResult()).claims.official === true) {
            saveAccount({ ...a, verified: true });
            apply(auth.currentUser);
            return;
        }
        const { getApplicationStatus } = await import('./registry.js');
        if ((await getApplicationStatus(a.email)) !== 'approved') return;
        saveAccount({ ...a, verified: true });
        apply(auth.currentUser);
    } catch (e) {
        console.warn('RiCap: could not check verification status', e);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
} else {
    start();
}