// Sign-up handler for the landing page that also collects the (optional) phone number + alert consent.
// Runs in the capture phase and stops the original handler, like admin-login.js does for login.
import { saveAccount, normalizePhone } from './account.js';
import { setEmailAlerts } from './alerts.js';
import { requestNotifications, setAllNotifications } from './Notify.js';

const form = document.getElementById('signupForm');

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

        const name = document.getElementById('signupName').value.trim();
        const email = document.getElementById('signupEmail').value.trim();
        const password = document.getElementById('signupPassword').value;
        const phoneRaw = document.getElementById('signupPhone').value.trim();
        const alertsOptIn = document.getElementById('signupAlerts').checked;

        if (!name || !email || !password) { showToast('Please complete all fields.'); return; }
        let phone = '';
        if (phoneRaw) {                       // phone is optional, but must be valid if given
            phone = normalizePhone(phoneRaw);
            if (!phone) { showToast('Enter a valid Philippine mobile number, e.g. 09171234567, or leave it blank.'); return; }
        }

        saveAccount({ name, email, password, phone, emailAlerts: false });

        let alertMsg = '';
        if (alertsOptIn) {
            try { if (await requestNotifications()) setAllNotifications(true); } catch (e) { /* pop-ups denied */ }
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
        showToast('Account created successfully.' + alertMsg);
    }, true);
}