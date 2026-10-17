import { auth } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { resyncIfOptedIn } from './alerts.js';
import { getApplicationStatus } from './registry.js';
import { saveAccount } from './account.js';
import { isAdminUser } from './admin-role.js';

function accountFromUser(user, email) {
    const name = String(user.displayName || email.split('@')[0]).trim();
    const parts = name.split(/\s+/);
    return { name, firstName: parts[0] || '', lastName: parts.slice(1).join(' '), email, phone: '', emailAlerts: false };
}

const LOGIN_REDIRECT = 'Home.html';
const REDIRECT_DELAY_MS = 700;
const loginForm = document.getElementById('loginForm');
function showToast(message) {
    const toast = document.getElementById('toast');
    const msg = document.getElementById('toastMessage');
    if (!toast || !msg) return;
    msg.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function closeModal() {
    const modal = document.getElementById('authModal');
    if (modal) modal.classList.remove('open');
    document.body.style.overflow = '';
}

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
        if (cred) {
            if (!account || String(account.email || '').toLowerCase() !== email.toLowerCase()) account = accountFromUser(cred.user, email);
            delete account.password;
        }
        try {
            // Once approved, an account stays verified even if a later check fails or changes.
            if ((await getApplicationStatus(account.email)) === 'approved') account.verified = true;
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