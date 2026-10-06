import { rtdb as db, auth } from './firebase-config.js';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { ref, query, orderByChild, equalTo, onValue, set, update, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
const EMAILJS_SERVICE_ID = 'service_qcgez2j';
const EMAILJS_TEMPLATE_ID = 'template_3fet77r';
const EMAILJS_PUBLIC_KEY = 'D1LTqshDzk5V-D4ug';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function emailjsConfigured() {
    return !!(EMAILJS_SERVICE_ID && EMAILJS_TEMPLATE_ID && EMAILJS_PUBLIC_KEY) &&
        !EMAILJS_SERVICE_ID.startsWith('YOUR_') &&
        !EMAILJS_TEMPLATE_ID.startsWith('YOUR_') &&
        !EMAILJS_PUBLIC_KEY.startsWith('YOUR_');
}

async function sendAccessCodeEmail(data, code) {
    if (!emailjsConfigured()) throw new Error('EmailJS is not configured in admin.js.');

    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            service_id: EMAILJS_SERVICE_ID,
            template_id: EMAILJS_TEMPLATE_ID,
            user_id: EMAILJS_PUBLIC_KEY,
            template_params: {
                to_email: data.email,
                to_name: data.fullName,
                role: data.role,
                organization: data.organization,
                access_code: code,
                submit_url: new URL('Submit.html', window.location.href).href
            }
        })
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error('Email service responded ' + res.status + (text ? ': ' + text : ''));
    }
}

function buildMailtoLink(data, code) {
    const submitUrl = new URL('Submit.html', window.location.href).href;
    const body = 'Hi ' + data.fullName + ',\n\nYour RiCap application was approved. Your access code is: ' +
        code + '\n\nEnter it on the Submit page: ' + submitUrl + '\n\n- RiCap';
    return 'mailto:' + encodeURIComponent(data.email) +
        '?subject=' + encodeURIComponent('Your RiCap access code') +
        '&body=' + encodeURIComponent(body);
}

document.addEventListener('DOMContentLoaded', () => {
    const adminGate = document.getElementById('adminGate');
    const adminPanel = document.getElementById('adminPanel');
    const adminLoginForm = document.getElementById('adminLoginForm');
    const adminLoginError = document.getElementById('adminLoginError');
    const adminEmailLabel = document.getElementById('adminEmailLabel');
    const appList = document.getElementById('appList');
    const adminEmptyState = document.getElementById('adminEmptyState');
    let unsubscribeList = null;

    adminLoginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        adminLoginError.hidden = true;
        try {
            await signInWithEmailAndPassword(auth,
                document.getElementById('adminEmail').value.trim(),
                document.getElementById('adminPassword').value);
        } catch (err) {
            adminLoginError.textContent = 'Sign-in failed — check the email and password.';
            adminLoginError.hidden = false;
        }
    });

    document.getElementById('adminSignOutBtn').addEventListener('click', () => signOut(auth));

    onAuthStateChanged(auth, (user) => {
        if (user && !user.isAnonymous) {
            adminGate.hidden = true;
            adminPanel.hidden = false;
            adminEmailLabel.textContent = user.email;
            if (!unsubscribeList) listenForApplications();
        } else {
            adminGate.hidden = false;
            adminPanel.hidden = true;
            if (unsubscribeList) { unsubscribeList(); unsubscribeList = null; }
        }
    });

    function listenForApplications() {
        const q = query(ref(db, 'officialApplications'), orderByChild('status'), equalTo('pending'));
        unsubscribeList = onValue(q, (snapshot) => {
            appList.innerHTML = '';
            const val = snapshot.val();
            const entries = val ? Object.entries(val) : [];
            adminEmptyState.hidden = entries.length > 0;
            entries.sort((a, b) => (b[1].submittedAt || 0) - (a[1].submittedAt || 0));
            entries.forEach(([id, data]) => renderCard(id, data));
        }, (err) => {
            console.error(err);
            adminEmptyState.textContent = 'Could not load applications (check Realtime Database rules).';
            adminEmptyState.hidden = false;
        });
    }

    function generateAccessCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const buf = new Uint32Array(6);
        crypto.getRandomValues(buf);
        let code = 'RICAP-';
        for (let i = 0; i < 6; i++) code += chars[buf[i] % chars.length];
        return code;
    }

    function renderCard(id, data) {
        const card = document.createElement('div');
        card.className = 'app-card';
        card.innerHTML = `
            <img src="${esc(data.photoURL)}" alt="Verification photo for ${esc(data.fullName)}">
            <div class="app-card-body">
                <p class="app-card-name">${esc(data.fullName)}</p>
                <p class="app-card-meta">
                    ${esc(data.role)} · ${esc(data.organization)}<br>
                    ${esc(data.email)}${data.phone ? ' · ' + esc(data.phone) : ''}
                </p>
                <div class="app-card-actions">
                    <button type="button" class="submit-btn approve-btn">Approve &amp; email code</button>
                    <button type="button" class="ghost-btn reject-btn">Reject</button>
                </div>
                <p class="app-card-code" hidden></p>
            </div>`;

        card.querySelector('.approve-btn').addEventListener('click', async (e) => {
            const btn = e.target;
            btn.disabled = true;
            btn.textContent = 'Approving…';
            const code = generateAccessCode();
            const label = card.querySelector('.app-card-code');

            try {
                await set(ref(db, 'accessCodes/' + code), {
                    active: true, officialName: data.fullName, role: data.role,
                    organization: data.organization, applicationId: id, createdAt: serverTimestamp()
                });
                await update(ref(db, 'officialApplications/' + id), { status: 'approved', accessCode: code });
            } catch (err) {
                console.error(err);
                btn.disabled = false;
                btn.textContent = 'Approve & email code';
                alert('Approval failed: ' + err.message);
                return;
            }

            // Approved and saved. Now try to email the code.
            btn.textContent = 'Emailing…';
            try {
                await sendAccessCodeEmail(data, code);
                await update(ref(db, 'officialApplications/' + id), { emailSent: true, emailedAt: serverTimestamp() });
                label.textContent = 'Approved — access code ' + code + ' was emailed to ' + data.email + '.';
            } catch (err) {
                console.error('Email failed:', err);
                label.innerHTML = 'Approved — code <strong>' + esc(code) + '</strong>, but the email could not be sent (' +
                    esc(err.message) + '). <a href="' + esc(buildMailtoLink(data, code)) + '">Send it manually</a>';
            }
            label.hidden = false;
            btn.textContent = 'Approved';
        });

        card.querySelector('.reject-btn').addEventListener('click', async (e) => {
            e.target.disabled = true;
            try { await update(ref(db, 'officialApplications/' + id), { status: 'rejected' }); }
            catch (err) { e.target.disabled = false; alert('Reject failed: ' + err.message); }
        });

        appList.appendChild(card);
    }
});