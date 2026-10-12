import { auth } from './firebase-config.js';
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { resyncIfOptedIn } from './alerts.js';

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

        try {
            const cred = await signInWithEmailAndPassword(auth, email, password);
            closeModal();
            showToast('Welcome back, ' + (cred.user.displayName || cred.user.email || 'admin') + '.');
            goHome(); 
            return;
        } catch (err) {

        }

        let account = null;
        try { account = JSON.parse(localStorage.getItem('ricapAccount') || 'null'); } catch (e) { }
        if (!account || email !== account.email || password !== account.password) {
            if (btn) btn.disabled = false;
            showToast('Incorrect email or password.');
            return;
        }
        localStorage.setItem('ricapLoggedIn', 'true');
        resyncIfOptedIn();
        closeModal();
        showToast('Welcome back, ' + account.name + '.');
        goHome();
    }, true);
}