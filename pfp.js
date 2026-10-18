// Profile page (pfp.html): account details, profile picture (crop + upload), official access,
// email alerts, change password and the user's recent reports.

import { auth, db } from './firebase-config.js';
import { collection, query, orderBy, getDocs } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import {
    onAuthStateChanged, EmailAuthProvider, reauthenticateWithCredential, updatePassword, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { getAccount, saveAccount, isLocalLoggedIn, getOfficialSession, isVerifiedUser, displayName, normalizePhone, initials } from './account.js';
import { ensureAuth, signOutOfficial } from './Session.js';
import { performLogout } from './admin-nav.js';
import { setEmailAlerts, emailAlertsEnabled, resyncIfOptedIn } from './alerts.js';
import { getApplicationStatus } from './registry.js';
import {
    getAvatar, syncProfile, knownUids, rememberUid, canHaveAvatar, legacyAvatar,
    checkAvatarFile, renderAvatar, uploadAvatar, removeAvatar, avatarErrorMessage
} from './profile-sync.js';
import { isAdminUser } from './admin-role.js';

const RECORDS_KEY = 'ricap_river_records';
const RECENT_LIMIT = 8;

const $ = id => document.getElementById(id);

// Escapes text before putting it into HTML.
function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Firestore timestamp to Date.
function toDate(ts) {
    const d = ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
    return d && !isNaN(d) ? d : null;
}

// Readable date (and time).
function fmtDate(d, withTime) {
    if (!d) return '—';
    return withTime
        ? d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
        : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

// River name for a report.
function riverName(r) {
    try {
        if (typeof RIVER_DATA !== 'undefined' && r.riverId) {
            const hit = RIVER_DATA.find(x => String(x.id) === String(r.riverId));
            if (hit) return hit.name;
        }
    } catch (e) {  }
    return r.reportName || 'Unnamed spot';
}

// Scans saved in this browser.
function localRecords() {
    try {
        const list = JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]');
        return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
}

let toastTimer = null;
// Small message at the bottom of the page.
function toast(msg) {
    const t = $('pfToast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

// Re-publishes the profile so admins see the change; failures only matter to the admin view.
function publish() {
    syncProfile().catch(err => console.warn('RiCap: could not publish profile', err));
}

let editing = false;
let reportsLoaded = false;

// Everything the page needs to know about who is signed in.
function currentState(user, isAdmin) {
    const account = isLocalLoggedIn() ? getAccount() : null;
    const official = getOfficialSession();
    return { user, isAdmin, account, official, signedIn: isAdmin || !!account || !!official };
}

// Shows the picture, or initials when there is none.
function paintAvatar(el, initialsEl, name) {
    const photo = getAvatar();
    initialsEl.textContent = initials(name);
    el.style.backgroundImage = photo ? 'url("' + photo + '")' : '';
    el.classList.toggle('has-photo', !!photo);
}

// Name, email, badges and stats at the top.
function renderHeader(s) {
    const name = displayName(s.user) || (s.account && s.account.name) || 'RiCap user';
    const email = (s.account && s.account.email) || (s.isAdmin ? s.user.email : '') || '';
    paintAvatar($('pfAvatar'), $('pfInitials'), name);
    paintAvatar($('pfThumb'), $('pfThumbInitials'), name);
    $('pfPhotoRemove').hidden = !getAvatar();
    $('pfAvatar').disabled = !s.account && !s.official && !canHaveAvatar();
    $('pfThumb').setAttribute('aria-label', getAvatar() ? 'Your profile picture' : 'No profile picture yet, showing your initials');
    $('pfName').textContent = name;
    $('pfEmail').textContent = email;
    $('pfEmail').hidden = !email;

    const badges = [];
    if (s.isAdmin) badges.push('<span class="pf-pill is-admin">Admin</span>');
    if (s.official) badges.push('<span class="pf-pill is-official">Verified official</span>');
    else if (isVerifiedUser()) badges.push('<span class="pf-pill is-official">Verified user</span>');
    else if (s.account) badges.push('<span class="pf-pill">Citizen account</span>');
    $('pfBadges').innerHTML = badges.join('');
}

// Switches the details form between view and edit mode.
function setEditing(on) {
    editing = on;
    ['pfFirst', 'pfLast', 'pfPhone'].forEach(id => { $(id).readOnly = !on; });
    $('pfEditActions').hidden = !on;
    $('pfEditBtn').hidden = on;
    $('pfError').hidden = true;
    if (on) $('pfFirst').focus();
}

// Fills the account details form.
function renderForm(s) {
    const a = s.account;
    $('pfForm').hidden = !a;
    $('pfGrid').classList.toggle('is-single', !a);
    if (!a || editing) return;
    const parts = String(a.name || '').trim().split(/\s+/);
    $('pfFirst').value = a.firstName || parts[0] || '';
    $('pfLast').value = a.lastName || parts.slice(1).join(' ') || '';
    $('pfEmailInput').value = a.email || '';
    $('pfPhone').value = a.phone || '';
}

// Official access card.
function renderOfficial(s) {
    const o = s.official;
    const dl = $('pfOfficial');
    const note = $('pfOfficialNote');
    const actions = $('pfOfficialActions');
    actions.innerHTML = '';
    if (o) {
        dl.hidden = false;
        dl.innerHTML =
            '<dt>Name</dt><dd>' + esc(o.name || '—') + '</dd>' +
            '<dt>Role</dt><dd>' + esc(o.role || '—') + '</dd>' +
            '<dt>Organization</dt><dd>' + esc(o.organization || '—') + '</dd>' +
            '<dt>Access code</dt><dd>' + esc(o.code || '—') + '</dd>';
        note.hidden = true;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pf-btn is-danger';
        btn.textContent = 'Remove access code from this device';
        btn.addEventListener('click', async () => {
            if (!confirm('Remove your official access code from this device? You can enter it again later.')) return;
            await signOutOfficial();
            refresh();
        });
        actions.appendChild(btn);
        return;
    }
    dl.hidden = true;
    dl.innerHTML = '';
    note.hidden = false;
    if (isVerifiedUser()) {
        note.textContent = 'Your application was approved, so this account stays verified. Enter the access code you received by email on the Scanner page to submit official reports.';
        actions.innerHTML = '<a href="Image_Processing.html" class="pf-btn is-primary">Go to Scanner</a>';
    } else {
        note.textContent = 'You are not a verified official yet. Apply to submit official river reports.';
        actions.innerHTML = '<a href="Verify.html" class="pf-btn is-primary">Apply for official access</a>';
    }
}

// Email alerts card.
function renderAlerts(s) {
    const a = s.account;
    $('pfAlerts').hidden = !(a && a.email);
    if (a && a.email) $('pfEmailAlerts').checked = emailAlertsEnabled();
}

// Only accounts that sign in with an email and password have a password to change.
function passwordUser() {
    const u = auth.currentUser;
    return u && !u.isAnonymous && u.email && u.providerData.some(p => p.providerId === 'password') ? u : null;
}

// Shows the Change password card for email/password accounts only.
function renderPassword() {
    const u = passwordUser();
    $('pfPasswordForm').hidden = !u;
    if (u) $('pfPwEmail').value = u.email;
}

// Readable message for a password change error.
function passwordError(err) {
    const code = String((err && err.code) || '');
    if (/wrong-password|invalid-credential|invalid-login-credentials/.test(code)) return 'Your current password is incorrect.';
    if (code === 'auth/weak-password') return 'Choose a stronger password (at least 6 characters).';
    if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a few minutes and try again.';
    if (code === 'auth/network-request-failed' || !navigator.onLine) return 'No connection. Check your internet and try again.';
    if (code === 'auth/requires-recent-login') return 'For your security, log out, log in again and retry.';
    console.warn('RiCap: password change failed', code);
    return 'Could not change your password. Try again.';
}

// Error and status lines in the password card.
function setPwMessage(error, status) {
    $('pfPwError').textContent = error || '';
    $('pfPwError').hidden = !error;
    $('pfPwStatus').textContent = status || '';
}

// One report in "My recent reports".
function reportCard(r) {
    const st = String(r.status || 'moderate');
    const a = document.createElement('a');
    a.className = 'pf-report';
    a.href = 'Tracking.html?id=' + encodeURIComponent(r.recordId || r.id);
    a.innerHTML =
        (r.imageUrl ? '<img src="' + esc(r.imageUrl) + '" alt="River photo" loading="lazy">' : '<div class="pf-noimg">No photo</div>') +
        '<div class="pf-report-body">' +
            '<div class="pf-report-top">' +
                '<h3>' + esc(r.reportName || riverName(r)) + '</h3>' +
                '<span class="pf-pill st-' + esc(st) + '">' + esc(st) + '</span>' +
            '</div>' +
            '<p class="pf-meta">' + esc(riverName(r)) + '</p>' +
            '<p class="pf-meta">' + esc(fmtDate(toDate(r.createdAt), true)) +
                (r.score != null ? ' · ' + esc(r.score) + '/100' : '') + '</p>' +
        '</div>';
    return a;
}

// Loads the user's reports from Firestore and this browser.
async function loadMyReports(s) {
    const local = localRecords();
    $('stLocal').textContent = local.length;
    const localIds = new Set(local.map(r => String(r.id)));

    let mine = [];
    try {
        const uid = String(await ensureAuth() || '');
        rememberUid(uid);
        const uids = new Set([uid, ...knownUids()].filter(Boolean));
        const code = s.official && s.official.code ? String(s.official.code) : '';
        const snap = await getDocs(query(collection(db, 'reports'), orderBy('createdAt', 'desc')));
        mine = snap.docs
            .map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))
            .filter(r => uids.has(r.uid) || (code && r.reporterCode === code) || localIds.has(String(r.recordId)));
    } catch (err) {
        console.error('RiCap: could not load your reports', err);
        $('pfReportsEmpty').textContent = 'Could not load your reports right now. Check your connection and refresh.';
        $('pfReportsEmpty').hidden = false;
        return;
    }

    const now = new Date();
    const thisMonth = mine.filter(r => {
        const d = toDate(r.createdAt);
        return d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
    $('stTotal').textContent = mine.length;
    $('stMonth').textContent = thisMonth;
    $('stLast').textContent = mine.length ? fmtDate(toDate(mine[0].createdAt)) : '—';
    $('stLast').classList.toggle('is-text', mine.length > 0);

    const list = $('pfReports');
    list.innerHTML = '';
    $('pfReportsEmpty').textContent = 'You have not submitted any official reports yet.';
    $('pfReportsEmpty').hidden = mine.length > 0;
    mine.slice(0, RECENT_LIMIT).forEach(r => list.appendChild(reportCard(r)));
}

// Re-renders the whole page for the current user.
async function refresh() {
    const user = auth.currentUser;
    const isAdmin = await isAdminUser(user);
    if (user !== auth.currentUser) return;
    const s = currentState(user, isAdmin);
    $('pfGate').hidden = s.signedIn;
    ['pfHero', 'pfGrid', 'pfReportsCard'].forEach(id => { $(id).hidden = !s.signedIn; });
    if (!s.signedIn) return;
    renderHeader(s);
    renderForm(s);
    renderOfficial(s);
    renderAlerts(s);
    renderPassword();
    moveLegacyAvatar();
    if (!reportsLoaded) {
        reportsLoaded = true;
        loadMyReports(s).finally(() => { reportsLoaded = false; });
    }
}

// An approval can land while the user is already logged in; once seen it is remembered for good.
async function checkApproval() {
    const a = isLocalLoggedIn() ? getAccount() : null;
    if (!a || !a.email || a.verified) return;
    try {
        if ((await getApplicationStatus(a.email)) !== 'approved') return;
        saveAccount({ ...a, verified: true });
        window.dispatchEvent(new Event('storage'));
        refresh();
        publish();
    } catch (e) {
        console.warn('RiCap: could not check verification status', e);
    }
}

$('pfEditBtn').addEventListener('click', () => setEditing(true));
$('pfCancelBtn').addEventListener('click', () => { setEditing(false); refresh(); });

$('pfForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!editing) return;
    const err = $('pfError');
    err.hidden = true;
    const a = getAccount();
    if (!a) return;

    const firstName = $('pfFirst').value.trim();
    const lastName = $('pfLast').value.trim();
    const phoneRaw = $('pfPhone').value.trim();
    if (!firstName || !lastName) {
        err.textContent = 'Please enter your first and last name.';
        err.hidden = false;
        return;
    }
    let phone = '';
    if (phoneRaw) {
        phone = normalizePhone(phoneRaw);
        if (!phone) {
            err.textContent = 'Enter a valid Philippine mobile number, e.g. 09171234567, or leave it blank.';
            err.hidden = false;
            return;
        }
    }

    $('pfSaveBtn').disabled = true;
    saveAccount({ ...a, firstName, lastName, name: firstName + ' ' + lastName, phone });
    await resyncIfOptedIn();
    $('pfSaveBtn').disabled = false;
    setEditing(false);
    // Lets the nav greeting pick up the new name.
    window.dispatchEvent(new Event('storage'));
    refresh();
    publish();
    toast('Profile saved.');
});

// The old version kept the picture as base64 on this device; move it to Storage once.
let legacyMoving = false;
// Moves a picture saved by the old version (base64 on this device) to Storage.
async function moveLegacyAvatar() {
    const old = legacyAvatar();
    if (legacyMoving || !old || !canHaveAvatar() || getAvatar()) return;
    legacyMoving = true;
    try {
        await uploadAvatar(await (await fetch(old)).blob());
    } catch (err) {
        console.warn('RiCap: could not move the old profile picture', err && err.code);
    } finally {
        legacyMoving = false;
    }
}

// Disables a button and shows a spinner while busy.
function setBusy(btn, busy, label) {
    btn.disabled = busy;
    btn.setAttribute('aria-busy', String(busy));
    if (label) btn.textContent = label;
}

// Opens the file chooser for a new picture.
function pickPhoto() {
    if (!canHaveAvatar()) {
        toast('Log in with your RiCap account to change your profile picture.');
        return;
    }
    $('pfPhotoInput').click();
}
$('pfAvatar').addEventListener('click', pickPhoto);
$('pfPhotoBtn').addEventListener('click', pickPhoto);

// Crop state, in source-image pixels: the square shown is `side` wide around (cx, cy).
const crop = { img: null, url: '', zoom: 1, cx: 0, cy: 0, busy: false, drag: null };
const cropCanvas = $('pfCropCanvas');

// Side of the crop square in image pixels at the current zoom.
function cropSide() {
    return Math.min(crop.img.naturalWidth, crop.img.naturalHeight) / crop.zoom;
}

// Crop square in image pixels, kept inside the image.
function cropRect() {
    const side = cropSide();
    const half = side / 2;
    crop.cx = Math.min(Math.max(crop.cx, half), crop.img.naturalWidth - half);
    crop.cy = Math.min(Math.max(crop.cy, half), crop.img.naturalHeight - half);
    return { x: crop.cx - half, y: crop.cy - half, side };
}

// Draws the crop preview with a round mask.
function drawCrop() {
    if (!crop.img) return;
    const r = cropRect();
    const ctx = cropCanvas.getContext('2d');
    const n = cropCanvas.width;
    ctx.clearRect(0, 0, n, n);
    ctx.drawImage(crop.img, r.x, r.y, r.side, r.side, 0, 0, n, n);
    // Darkens the corners so the preview matches the round avatar.
    ctx.save();
    ctx.fillStyle = 'rgba(11, 12, 16, 0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, n, n);
    ctx.arc(n / 2, n / 2, n / 2, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.restore();
}

// Status or error line in the crop dialog.
function setCropStatus(msg, isError) {
    const el = $('pfCropStatus');
    el.textContent = msg || '';
    el.classList.toggle('is-error', !!isError);
}

// Closes the crop dialog and frees the image.
function closeCrop() {
    if (crop.url) URL.revokeObjectURL(crop.url);
    crop.img = null;
    crop.url = '';
    if ($('pfCropDialog').open) $('pfCropDialog').close();
}

// Loads the chosen file as an image for cropping.
function loadImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => resolve({ img, url });
        img.onerror = () => { URL.revokeObjectURL(url); reject(Object.assign(new Error('That image could not be read.'), { code: 'avatar/unreadable' })); };
        img.src = url;
    });
}

$('pfPhotoInput').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
        await checkAvatarFile(file);
        const { img, url } = await loadImage(file);
        closeCrop();
        Object.assign(crop, { img, url, zoom: 1, cx: img.naturalWidth / 2, cy: img.naturalHeight / 2 });
        $('pfCropZoom').value = '1';
        setCropStatus('');
        drawCrop();
        $('pfCropDialog').showModal();
        $('pfCropStage').focus();
    } catch (err) {
        toast(avatarErrorMessage(err));
    }
});

$('pfCropZoom').addEventListener('input', e => {
    crop.zoom = Number(e.target.value) || 1;
    drawCrop();
});

// Changes the crop zoom (buttons, wheel and keys).
function nudgeZoom(delta) {
    const z = Math.min(4, Math.max(1, crop.zoom + delta));
    crop.zoom = z;
    $('pfCropZoom').value = String(z);
    drawCrop();
}

const stage = $('pfCropStage');
stage.addEventListener('pointerdown', e => {
    if (!crop.img) return;
    stage.setPointerCapture(e.pointerId);
    crop.drag = { x: e.clientX, y: e.clientY };
});
stage.addEventListener('pointermove', e => {
    if (!crop.drag) return;
    const scale = cropSide() / stage.clientWidth;
    crop.cx -= (e.clientX - crop.drag.x) * scale;
    crop.cy -= (e.clientY - crop.drag.y) * scale;
    crop.drag = { x: e.clientX, y: e.clientY };
    drawCrop();
});
['pointerup', 'pointercancel'].forEach(t => stage.addEventListener(t, () => { crop.drag = null; }));
stage.addEventListener('wheel', e => {
    if (!crop.img) return;
    e.preventDefault();
    nudgeZoom(e.deltaY < 0 ? 0.1 : -0.1);
}, { passive: false });
stage.addEventListener('keydown', e => {
    if (!crop.img) return;
    const step = cropSide() * 0.05;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
        crop.cx += moves[e.key][0];
        crop.cy += moves[e.key][1];
        drawCrop();
    } else if (e.key === '+' || e.key === '=') nudgeZoom(0.1);
    else if (e.key === '-') nudgeZoom(-0.1);
    else return;
    e.preventDefault();
});

$('pfCropCancel').addEventListener('click', () => { if (!crop.busy) closeCrop(); });
// Esc closes the dialog, except while an upload is running.
$('pfCropDialog').addEventListener('cancel', e => { if (crop.busy) e.preventDefault(); });
$('pfCropDialog').addEventListener('close', () => { if (!crop.busy) closeCrop(); });

$('pfCropSave').addEventListener('click', async () => {
    if (!crop.img || crop.busy) return;
    const save = $('pfCropSave');
    crop.busy = true;
    setBusy(save, true, 'Uploading…');
    $('pfCropCancel').disabled = true;
    setCropStatus('Uploading your photo…');
    try {
        await uploadAvatar(await renderAvatar(crop.img, cropRect()));
        crop.busy = false;
        closeCrop();
        refresh();
        toast('Profile picture updated.');
    } catch (err) {
        console.warn('RiCap: profile picture upload failed', err && err.code);
        setCropStatus(avatarErrorMessage(err), true);
    } finally {
        crop.busy = false;
        setBusy(save, false, 'Save photo');
        $('pfCropCancel').disabled = false;
    }
});

$('pfPhotoRemove').addEventListener('click', async () => {
    if (!confirm('Remove your profile picture?')) return;
    const btn = $('pfPhotoRemove');
    setBusy(btn, true, 'Removing…');
    try {
        await removeAvatar();
        refresh();
        toast('Profile picture removed.');
    } catch (err) {
        console.warn('RiCap: could not remove profile picture', err && err.code);
        toast(avatarErrorMessage(err));
    } finally {
        setBusy(btn, false, 'Remove photo');
    }
});

window.addEventListener('ricap:avatar-change', () => refresh());

$('pfEmailAlerts').addEventListener('change', async e => {
    const box = e.target;
    const note = $('pfAlertsNote');
    box.disabled = true;
    note.hidden = true;
    try {
        await setEmailAlerts(box.checked);
        toast(box.checked ? 'Email alerts are on.' : 'Email alerts are off.');
    } catch (err) {
        console.warn('RiCap: could not update email alerts', err);
        box.checked = !box.checked;
        note.textContent = 'Could not update email alerts. Check your connection and try again.';
        note.hidden = false;
    } finally {
        box.disabled = false;
    }
});

$('pfLogout').addEventListener('click', () => performLogout());

$('pfPasswordForm').addEventListener('submit', async e => {
    e.preventDefault();
    const user = passwordUser();
    if (!user) return;
    const current = $('pfPwCurrent').value;
    const next = $('pfPwNew').value;
    const confirm = $('pfPwConfirm').value;
    if (!current || !next || !confirm) { setPwMessage('Fill in all three password fields.'); return; }
    if (next.length < 6) { setPwMessage('Your new password needs at least 6 characters.'); $('pfPwNew').focus(); return; }
    if (next !== confirm) { setPwMessage('The new passwords don’t match.'); $('pfPwConfirm').focus(); return; }
    if (next === current) { setPwMessage('Your new password must be different from the current one.'); $('pfPwNew').focus(); return; }

    const save = $('pfPwSave');
    setBusy(save, true, 'Updating…');
    $('pfPwReset').disabled = true;
    setPwMessage('', 'Updating your password…');
    try {
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
        await updatePassword(user, next);
        $('pfPasswordForm').reset();
        $('pfPwEmail').value = user.email;
        setPwMessage('', 'Password updated. Use your new password next time you log in.');
        toast('Password updated.');
    } catch (err) {
        setPwMessage(passwordError(err), '');
    } finally {
        setBusy(save, false, 'Update password');
        $('pfPwReset').disabled = false;
    }
});

$('pfPwReset').addEventListener('click', async () => {
    const user = passwordUser();
    if (!user) return;
    const btn = $('pfPwReset');
    setBusy(btn, true, 'Sending…');
    setPwMessage('', '');
    try {
        await sendPasswordResetEmail(auth, user.email);
        setPwMessage('', 'A reset link was sent to your email. Check your inbox and spam.');
    } catch (err) {
        setPwMessage(passwordError(err), '');
    } finally {
        setBusy(btn, false, 'Email me a reset link');
    }
});

onAuthStateChanged(auth, refresh);
window.addEventListener('storage', e => { if (e.key) refresh(); });
checkApproval();
