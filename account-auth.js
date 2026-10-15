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

        const name = `${firstName} ${lastName}`;
        saveAccount({ name, firstName, lastName, email, password, phone, emailAlerts: false });

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
        showToast('Account created successfully.' + alertMsg);
    }, true);
}