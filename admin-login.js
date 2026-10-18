// Login form on main.html: signs in with Firebase (or the older browser-only account), marks the
// account as logged in, then goes to Home. Also shows the "logged out" and "account deleted" messages.
// Sa madaling salita: dito nangyayari ang pag-login; pagkatapos mag-login, dadalhin ka sa Home.

import { auth } from './firebase-config.js';
import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { rememberLogin, clearLocalLogin } from './account.js';
import { isAdminUser } from './admin-role.js';

const loginForm = document.getElementById('loginForm');

// Shows a short message at the bottom of the page.
function showToast(message) {
    const toast = document.getElementById('toast');
    const msg = document.getElementById('toastMessage');
    if (!toast || !msg) return;
    msg.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// Closes the login/sign-up box.
function closeModal() {
    const modal = document.getElementById('authModal');
    if (modal) modal.classList.remove('open');
    document.body.style.overflow = '';
}

// Coming from Logout: confirm it, then drop the flag from the address.
if (new URLSearchParams(location.search).has('loggedout')) {
    showToast('You have been logged out.');
    // Safety net in case the sign-out on the previous page did not finish.
    auth.authStateReady().then(() => {
        if (auth.currentUser && !auth.currentUser.isAnonymous) signOut(auth).then(clearLocalLogin);
    });
    history.replaceState(null, '', location.pathname + location.hash);
}

// Coming from Delete account on Profile.
if (new URLSearchParams(location.search).has('deleted')) {
    showToast('Your account was deleted.');
    history.replaceState(null, '', location.pathname + location.hash);
}

// After a successful login, go to Home (short pause so the welcome message is seen).
function goHome() {
    setTimeout(() => { location.href = 'Home.html'; }, 700);
}

if (loginForm) {
    // Capture phase + stopImmediatePropagation so the original handler doesn't also run.
    loginForm.addEventListener('submit', async event => {
        event.preventDefault();
        event.stopImmediatePropagation();

        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;
        const btn = loginForm.querySelector('.auth-submit');
        if (btn) btn.disabled = true;

        try {
            const cred = await signInWithEmailAndPassword(auth, email, password);
            if (!(await isAdminUser(cred.user))) rememberLogin(cred.user);
            closeModal();
            showToast('Welcome back, ' + (cred.user.email || 'admin') + '.');
            goHome();
            return;
        } catch (err) {
            // Not a Firebase account (or wrong password) — try the local account below.
        } finally {
            if (btn) btn.disabled = false;
        }

        let account = null;
        try { account = JSON.parse(localStorage.getItem('ricapAccount') || 'null'); } catch (e) { }
        if (!account) {
            showToast('Incorrect email or password.');
            return;
        }
        if (email !== account.email || password !== account.password) {
            showToast('Incorrect email or password.');
            return;
        }
        localStorage.setItem('ricapLoggedIn', 'true');
        closeModal();
        showToast('Welcome back, ' + account.name + '.');
        goHome();
    }, true);
}