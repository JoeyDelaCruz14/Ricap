// Official application review, shared by Admin.html and the Applications tab in Maintenance.
// Lists pending applications live; Approve creates an access code, marks the application approved
// and emails the code through EmailJS (with a mailto: fallback); Reject marks it rejected.
// Sa madaling salita: dito ina-aprubahan o nire-reject ang mga application, at gumagawa ng access code para sa naaprubahan.
/*
import { rtdb as db } from './firebase-config.js';
import { ref, query, orderByChild, equalTo, onValue, set, update, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { emailKey } from './account.js';
const EMAILJS_SERVICE_ID = 'service_qcgez2j';
const EMAILJS_TEMPLATE_ID = 'template_3fet77r';
const EMAILJS_PUBLIC_KEY = 'D1LTqshDzk5V-D4ug';

// Escapes text before putting it into HTML.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// True if the EmailJS ids above are filled in.
function emailjsConfigured() {
    return !!(EMAILJS_SERVICE_ID && EMAILJS_TEMPLATE_ID && EMAILJS_PUBLIC_KEY) &&
        !EMAILJS_SERVICE_ID.startsWith('YOUR_') &&
        !EMAILJS_TEMPLATE_ID.startsWith('YOUR_') &&
        !EMAILJS_PUBLIC_KEY.startsWith('YOUR_');
}

// Emails the access code to the applicant through EmailJS.
/*<<<<<<< HEAD
export async function sendAccessCodeEmail(data, code) {
=======
async function sendAccessCodeEmail(data, code) {
>>>>>>> 69a60d4bd80cec7df8c2b26dc41dfb3cfe2cf4b7
    if (!emailjsConfigured()) throw new Error('EmailJS is not configured in applications.js.');

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
                submit_url: new URL('Image_Processing.html', window.location.href).href
            }
        })
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error('Email service responded ' + res.status + (text ? ': ' + text : ''));
    }
}

// mailto: link with the code, for sending by hand when EmailJS fails.
function buildMailtoLink(data, code) {
    const submitUrl = new URL('Image_Processing.html', window.location.href).href;
    const body = 'Hi ' + data.fullName + ',\n\nYour RiCap application was approved. Your access code is: ' +
        code + '\n\nEnter it on the Scanner page: ' + submitUrl + '\n\n- RiCap';
    return 'mailto:' + encodeURIComponent(data.email) +
        '?subject=' + encodeURIComponent('Your RiCap access code') +
        '&body=' + encodeURIComponent(body);
}

// Not fatal: the approval itself must still go through if this write is refused.
/*<<<<<<< HEAD
export function markEmail(email, status) {
=======
function markEmail(email, status) {
>>>>>>> 69a60d4bd80cec7df8c2b26dc41dfb3cfe2cf4b7
    set(ref(db, 'applicationEmails/' + emailKey(email)), status)
        .catch(err => console.warn('RiCap: could not record application status (check the applicationEmails rule)', err));
}

// Random access code such as RICAP-7K2QXM (no look-alike characters such as 0/O or 1/I).
/*<<<<<<< HEAD
export function generateAccessCode() {
=======
function generateAccessCode() {
>>>>>>> 69a60d4bd80cec7df8c2b26dc41dfb3cfe2cf4b7
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const buf = new Uint32Array(6);
    crypto.getRandomValues(buf);
    let code = 'RICAP-';
    for (let i = 0; i < 6; i++) code += chars[buf[i] % chars.length];
    return code;
}

// One application with Approve and Reject buttons.
function renderCard(appList, id, data) {
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
            markEmail(data.email, 'approved');
        } catch (err) {
            console.error(err);
            btn.disabled = false;
            btn.textContent = 'Approve & email code';
            alert('Approval failed: ' + err.message);
            return;
        }

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
        try {
            await update(ref(db, 'officialApplications/' + id), { status: 'rejected' });
            markEmail(data.email, 'rejected');
        }
        catch (err) { e.target.disabled = false; alert('Reject failed: ' + err.message); }
    });

    appList.appendChild(card);
}

// Live list of pending applications in appList; emptyEl shows when there are none.
// onCount (optional) receives the number of pending applications. Returns the unsubscribe function.
export function watchApplications(appList, emptyEl, onCount) {
    const q = query(ref(db, 'officialApplications'), orderByChild('status'), equalTo('pending'));
    return onValue(q, (snapshot) => {
        appList.innerHTML = '';
        const val = snapshot.val();
        const entries = val ? Object.entries(val) : [];
        emptyEl.hidden = entries.length > 0;
        entries.sort((a, b) => (b[1].submittedAt || 0) - (a[1].submittedAt || 0));
        entries.forEach(([id, data]) => renderCard(appList, id, data));
        if (onCount) onCount(entries.length);
    }, (err) => {
        console.error(err);
        emptyEl.textContent = 'Could not load applications (check Realtime Database rules).';
        emptyEl.hidden = false;
    });
} */
