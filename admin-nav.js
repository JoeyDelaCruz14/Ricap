import { auth } from './firebase-config.js';
import { startReportAlerts } from './Notify.js';
import { displayName, isLocalLoggedIn, clearLocalLogin, getOfficialSession, isVerifiedUser, getAccount, saveAccount } from './account.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { isAdminUser } from './admin-role.js';

const LOGOUT_REDIRECT = 'main.html';
const OFFICIAL_KEY = 'ricap_official';  
export async function performLogout() {
    try { localStorage.removeItem(OFFICIAL_KEY); } catch (e) {  }
    clearLocalLogin();
    try { await signOut(auth); } catch (err) { console.warn('Sign-out failed', err); }
    window.location.href = LOGOUT_REDIRECT;
}

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


function loginItems() {
    return [...document.querySelectorAll('#navLinks li')].filter(li =>
        !li.hasAttribute('data-logout') &&
        li.textContent.trim().toLowerCase() === 'login');
}

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

function paintNavAvatar(url) {
    const img = document.querySelector('#navLinks [data-nav-avatar]');
    if (!img) return;
    img.hidden = !url;
    if (url) img.src = url;
    else img.removeAttribute('src');
}

// Pages without their own menu script mark the toggle with data-nav-toggle.
function initToggle() {
    const toggle = document.getElementById('navToggle');
    const links = document.getElementById('navLinks');
    if (!toggle || !links || !toggle.hasAttribute('data-nav-toggle')) return;
    const setOpen = open => {
        links.classList.toggle('open', open);
        toggle.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', String(open));
    };
    toggle.addEventListener('click', () => setOpen(!links.classList.contains('open')));
    links.addEventListener('click', e => { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
}

function start() {
    initToggle();
    apply(auth.currentUser);
    onAuthStateChanged(auth, apply);
    window.addEventListener('storage', () => apply(auth.currentUser));
    window.addEventListener('ricap:avatar-change', e => paintNavAvatar(e.detail && e.detail.url));
    refreshVerified().then(publishProfile);
    startReportAlerts();
}

// Keeps the admin's list of verified users (Maintenance → Verified users) up to date.
let profilePublished = false;
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
async function refreshVerified() {
    const a = getAccount();
    if (!isLocalLoggedIn() || !a || !a.email || a.verified) return;
    try {
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