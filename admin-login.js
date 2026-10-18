// Login form on main.html (runs before the older handler in home-interactive.js and stops it).
// Signs in with Firebase email/password; admins go straight in, citizens get their local account
// restored, and old local-only accounts are moved to Firebase on their first login.
// Also handles "Forgot password?" with a Firebase reset email.

import { auth } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, sendPasswordResetEmail, sendEmailVerification, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { resyncIfOptedIn } from './alerts.js';
import { getApplicationStatus } from './registry.js';
import { saveAccount } from './account.js';
import { isAdminUser } from './admin-role.js';

// Builds a local account from a Firebase user when this browser has none.
function accountFromUser(user, email) {
    const name = String(user.displayName || email.split('@')[0]).trim();
    const parts = name.split(/\s+/);
    return { name, firstName: parts[0] || '', lastName: parts.slice(1).join(' '), email, phone: '', emailAlerts: false };
}

const LOGIN_REDIRECT = 'Home.html';
const REDIRECT_DELAY_MS = 700;
const loginForm = document.getElementById('loginForm');
// Small message at the bottom of the page.
function showToast(message) {
    const toast = document.getElementById('toast');
    const msg = document.getElementById('toastMessage');
    if (!toast || !msg) return;
    msg.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 5000);
}

// Closes the login/sign-up modal.
function closeModal() {
    const modal = document.getElementById('authModal');
    if (modal) modal.classList.remove('open');
    document.body.style.overflow = '';
}

// Goes to Home after the welcome toast has had time to show.
function goHome() {
    setTimeout(() => { window.location.href = LOGIN_REDIRECT; }, REDIRECT_DELAY_MS);
}

if (loginForm) {

    loginForm.addEventListener('submit', async event => {
        event.preventDefault();
        event.stopImmediatePropagation();

        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;
        const btn = loginForm.querySelector('.auth-submit');
        if (btn) btn.disabled = true;

        let cred = null;
        try {
            cred = await signInWithEmailAndPassword(auth, email, password);
        } catch (err) {
            if (String(err && err.code) === 'auth/network-request-failed') {
                if (btn) btn.disabled = false;
                showToast('No connection. Check your internet and try again.');
                return;
            }
        }
        if (cred && await isAdminUser(cred.user)) {
            closeModal();
            showToast('Welcome back, ' + (cred.user.displayName || cred.user.email || 'admin') + '.');
            goHome();
            return;
        }

        let account = null;
        try { account = JSON.parse(localStorage.getItem('ricapAccount') || 'null'); } catch (e) { }
        if (!cred) {
            if (!account || email !== account.email || !account.password || password !== account.password) {
                if (btn) btn.disabled = false;
                showToast('Incorrect email or password.');
                return;
            }
            // Accounts made before Firebase sign-in kept the password in this browser; move them over once.
            try {
                cred = await createUserWithEmailAndPassword(auth, email, password);
                await updateProfile(cred.user, { displayName: account.name || '' }).catch(() => {});
            } catch (err) {
                if (String(err && err.code) === 'auth/email-already-in-use') {
                    if (btn) btn.disabled = false;
                    showToast('Incorrect email or password.');
                    return;
                }
                console.warn('RiCap: could not move this account to Firebase sign-in', err && err.code);
            }
        }
        // Citizens must confirm their email first. Send a fresh link and keep them logged out until they do.
        if (cred && !cred.user.emailVerified) {
            let msg = 'Confirm your email first. We sent a new link to ' + email + '; open it, then log in again.';
            try {
                await sendEmailVerification(cred.user);
            } catch (err) {
                msg = String(err && err.code) === 'auth/too-many-requests'
                    ? 'Confirm your email first. A link was sent to ' + email + ' recently; check your inbox and spam.'
                    : 'Confirm your email first. We could not send a new link right now; try again in a minute.';
            }
            try { await signOut(auth); } catch (e) {  }
            if (btn) btn.disabled = false;
            showToast(msg);
            return;
        }
        if (cred) {
            if (!account || String(account.email || '').toLowerCase() !== email.toLowerCase()) account = accountFromUser(cred.user, email);
            delete account.password;
        }
        try {
            // A redeemed access code is kept on the Firebase user (claim set by redeemAccessCode), so it works on any browser.
            const user = auth.currentUser;
            if (user && !user.isAnonymous && (await user.getIdTokenResult()).claims.official === true) account.verified = true;
        } catch (e) {
            console.warn('RiCap: could not read the official claim', e && e.code);
        }
        try {
            // Once approved, an account stays verified even if a later check fails or changes.
            if (!account.verified && (await getApplicationStatus(account.email)) === 'approved') account.verified = true;
        } catch (e) {
            console.warn('RiCap: could not check verification status', e);
        }
        saveAccount(account);
        localStorage.setItem('ricapLoggedIn', 'true');
        resyncIfOptedIn();
        closeModal();
        showToast('Welcome back, ' + account.name + '.');
        goHome();
    }, true);
}

// Forgot password: Firebase emails a reset link. The message is the same whether or not the
// email has an account, so the form can't be used to find out who is registered.
const forgotBtn = loginForm && loginForm.querySelector('.forgot-password');
if (forgotBtn) {
    forgotBtn.addEventListener('click', async () => {
        const input = document.getElementById('loginEmail');
        const email = input.value.trim();
        if (!email || !input.checkValidity()) {
            showToast('Enter your email above, then press Forgot password.');
            input.focus();
            return;
        }
        forgotBtn.disabled = true;
        forgotBtn.textContent = 'Sending…';
        try {
            await sendPasswordResetEmail(auth, email);
            showToast('If ' + email + ' has a RiCap account, a reset link is on its way. Check your inbox and spam.');
        } catch (err) {
            const code = String(err && err.code || '');
            if (code === 'auth/user-not-found') {
                showToast('If ' + email + ' has a RiCap account, a reset link is on its way. Check your inbox and spam.');
            } else if (code === 'auth/invalid-email') {
                showToast('That email address doesn’t look right.');
            } else if (code === 'auth/too-many-requests') {
                showToast('Too many requests. Wait a few minutes and try again.');
            } else if (code === 'auth/network-request-failed') {
                showToast('No connection. Check your internet and try again.');
            } else {
                console.warn('RiCap: password reset failed', code);
                showToast('Could not send the reset email. Try again.');
            }
        } finally {
            forgotBtn.disabled = false;
            forgotBtn.textContent = 'Forgot password?';
        }
    });
}