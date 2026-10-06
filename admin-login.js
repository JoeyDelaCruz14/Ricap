// Admin-aware login for the landing page modal.
// 1) Try Firebase Authentication (admin accounts).
// 2) If that fails, fall back to the original localStorage account check.
import { auth } from './firebase-config.js';
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { resyncIfOptedIn } from './alerts.js';

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
            closeModal();
            showToast('Welcome back, ' + (cred.user.displayName || cred.user.email || 'admin') + '.');
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
        resyncIfOptedIn();
        closeModal();
        showToast('Welcome back, ' + account.name + '.');
    }, true);
}