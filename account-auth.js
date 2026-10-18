// Sign-up form on main.html (runs before the older handler in home-interactive.js and stops it).
// Creates a Firebase email/password account, records the email in the registry, saves the local
// account without the password, and optionally turns on email alerts.
// Sa madaling salita: ito ang gumagawa ng bagong account kapag nag-sign up, at nagpapadala ng email para i-confirm ito.

import { auth } from './firebase-config.js';
import { createUserWithEmailAndPassword, updateProfile, signOut, sendEmailVerification } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { saveAccount, getAccount, normalizePhone } from './account.js';
import { isEmailRegistered, registerEmail } from './registry.js';
import { setEmailAlerts } from './alerts.js';
import { requestNotifications, setAllNotifications } from './Notify.js';

const form = document.getElementById('signupForm');

// Small confirmation message at the bottom of the page.
function showToast(message) {
    const toast = document.getElementById('toast');
    const msg = document.getElementById('toastMessage');
    if (!toast || !msg) return;
    msg.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3500);
}

if (form) {
    form.addEventListener('submit', async event => {
        event.preventDefault();
        event.stopImmediatePropagation();

        const firstName = document.getElementById('signupFirstName').value.trim();
        const lastName = document.getElementById('signupLastName').value.trim();
        const email = document.getElementById('signupEmail').value.trim();
        const password = document.getElementById('signupPassword').value;
        const phoneInput = document.getElementById('signupPhone');
        const phoneRaw = phoneInput ? phoneInput.value.trim() : '';
        const alertsOptIn = document.getElementById('signupAlerts').checked;

        if (!firstName || !lastName || !email || !password) { showToast('Please complete all fields, including first and last name.'); return; }
        let phone = '';
        if (phoneRaw) {
            phone = normalizePhone(phoneRaw);
            if (!phone) { showToast('Enter a valid Philippine mobile number, e.g. 09171234567, or leave it blank.'); return; }
        }

        const existing = getAccount();
        if (existing && String(existing.email || '').toLowerCase() === email.toLowerCase()) {
            showToast('An account with this email already exists. Please log in instead.');
            return;
        }

        const submitBtn = form.querySelector('.auth-submit');
        if (submitBtn) submitBtn.disabled = true;
        const name = `${firstName} ${lastName}`;
        let verificationSent = false;
        try {
            try {
                if (await isEmailRegistered(email)) {
                    showToast('An account with this email already exists. Please log in instead.');
                    return;
                }
            } catch (e) {
                console.warn('RiCap: could not check the account registry', e);
            }
            // The Firebase account gives the user one uid on every browser; the password is never kept locally.
            try {
                const cred = await createUserWithEmailAndPassword(auth, email, password);
                await updateProfile(cred.user, { displayName: name }).catch(() => {});
                // The user must open this link before they can log in (checked in admin-login.js).
                try { await sendEmailVerification(cred.user); verificationSent = true; }
                catch (e) { console.warn('RiCap: could not send the verification email', e && e.code); }
            } catch (e) {
                const c = String(e && e.code || '');
                showToast(c === 'auth/email-already-in-use' ? 'An account with this email already exists. Please log in instead.'
                    : c === 'auth/weak-password' ? 'Use a password with at least 6 characters.'
                    : c === 'auth/invalid-email' ? 'Enter a valid email address.'
                    : c === 'auth/network-request-failed' ? 'No connection. Check your internet and try again.'
                    : 'Could not create the account. Try again.');
                return;
            }
            try { await registerEmail(email); } catch (e) { console.warn('RiCap: could not update the account registry', e); }
            // Sign-up leaves the user on the login tab, as before.
            try { await signOut(auth); } catch (e) {  }
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }

        saveAccount({ name, firstName, lastName, email, phone, emailAlerts: false });

        let alertMsg = '';
        if (alertsOptIn) {
            try { if (await requestNotifications()) setAllNotifications(true); } catch (e) {  }
            try { await setEmailAlerts(true); alertMsg = ' Alerts are on.'; }
            catch (e) { console.warn('RiCap: could not save alert subscription', e); alertMsg = ' (Email alerts could not be saved yet — turn them on from Home after logging in.)'; }
        }

        form.reset();
        const bar = document.getElementById('strengthProgress');
        const txt = document.getElementById('strengthText');
        if (bar) bar.style.width = '0%';
        if (txt) txt.textContent = 'Enter a password';
        const loginTab = document.querySelector('.auth-tab[data-tab="login"]');
        if (loginTab) loginTab.click();
        const le = document.getElementById('loginEmail');
        if (le) le.value = email;
        showToast(verificationSent
            ? 'Account created. We sent a confirmation link to ' + email + '. Open it, then log in.' + alertMsg
            : 'Account created. Log in to get a new confirmation link for ' + email + '.' + alertMsg);
    }, true);
}