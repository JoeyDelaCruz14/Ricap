import { auth } from './firebase-config.js';
import { startReportAlerts } from './Notify.js';
import { displayName, isLocalLoggedIn, clearLocalLogin, getOfficialSession } from './account.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const LOGOUT_REDIRECT = 'main.html';
const OFFICIAL_KEY = 'ricap_official';  
export async function performLogout() {
    try { localStorage.removeItem(OFFICIAL_KEY); } catch (e) { /* ignore */ }
    clearLocalLogin();
    try { await signOut(auth); } catch (err) { console.warn('Sign-out failed', err); }
    window.location.href = LOGOUT_REDIRECT;
}

function ensureAdminLinks() {
    const links = document.getElementById('navLinks');
    if (!links || links.querySelector('[data-admin-only]')) return;
    [['Admin.html', 'Admin'], ['maintenance.html', 'Maintenance']].forEach(([href, text]) => {
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
        const span = document.createElement('span');
        span.style.cssText = 'display:inline-block;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
            'vertical-align:bottom;color:#d9c2ff;font-size:0.9rem;font-weight:600;letter-spacing:0.08em;';
        li.appendChild(span);
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

function apply(user) {
    const isAdmin = !!user && !user.isAnonymous;
    const loggedIn = isAdmin || isLocalLoggedIn() || !!getOfficialSession();
    ensureAdminLinks();
    ensureLogoutLink();
    const greet = ensureGreeting();
    document.querySelectorAll('[data-admin-only]').forEach(el => { el.hidden = !isAdmin; });
    loginItems().forEach(li => { li.hidden = loggedIn; });   
    if (greet) {
        const name = displayName(user);
        greet.hidden = !name;
        greet.firstChild.textContent = name ? 'Hi, ' + name : '';
        greet.firstChild.title = name || '';
    }
}

function start() {
    onAuthStateChanged(auth, apply);
    startReportAlerts();    
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
} else {
    start();
}