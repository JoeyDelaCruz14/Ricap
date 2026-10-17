import { auth, db } from './firebase-config.js';
import { collection, query, orderBy, getDocs } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { getAccount, saveAccount, isLocalLoggedIn, getOfficialSession, isVerifiedUser, displayName, normalizePhone, initials } from './account.js';
import { ensureAuth, signOutOfficial } from './Session.js';
import { performLogout } from './admin-nav.js';
import { setEmailAlerts, emailAlertsEnabled, resyncIfOptedIn } from './alerts.js';
import { getApplicationStatus } from './registry.js';
import { getAvatar, setAvatar, resizeAvatar, syncProfile, knownUids, rememberUid } from './profile-sync.js';

const RECORDS_KEY = 'ricap_river_records';
const RECENT_LIMIT = 8;

const $ = id => document.getElementById(id);

function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function toDate(ts) {
    const d = ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
    return d && !isNaN(d) ? d : null;
}

function fmtDate(d, withTime) {
    if (!d) return '—';
    return withTime
        ? d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
        : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function riverName(r) {
    try {
        if (typeof RIVER_DATA !== 'undefined' && r.riverId) {
            const hit = RIVER_DATA.find(x => String(x.id) === String(r.riverId));
            if (hit) return hit.name;
        }
    } catch (e) {  }
    return r.reportName || 'Unnamed spot';
}

function localRecords() {
    try {
        const list = JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]');
        return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
}

let toastTimer = null;
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

function currentState(user) {
    const isAdmin = !!user && !user.isAnonymous;
    const account = isLocalLoggedIn() ? getAccount() : null;
    const official = getOfficialSession();
    return { user, isAdmin, account, official, signedIn: isAdmin || !!account || !!official };
}

function paintAvatar(el, initialsEl, name) {
    const photo = getAvatar();
    initialsEl.textContent = initials(name);
    el.style.backgroundImage = photo ? 'url("' + photo + '")' : '';
    el.classList.toggle('has-photo', !!photo);
}

function renderHeader(s) {
    const name = displayName(s.user) || (s.account && s.account.name) || 'RiCap user';
    const email = (s.account && s.account.email) || (s.isAdmin ? s.user.email : '') || '';
    paintAvatar($('pfAvatar'), $('pfInitials'), name);
    paintAvatar($('pfThumb'), $('pfThumbInitials'), name);
    $('pfPhotoRemove').hidden = !getAvatar();
    $('pfAvatar').disabled = !s.account && !s.official;
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

function setEditing(on) {
    editing = on;
    ['pfFirst', 'pfLast', 'pfPhone'].forEach(id => { $(id).readOnly = !on; });
    $('pfEditActions').hidden = !on;
    $('pfEditBtn').hidden = on;
    $('pfError').hidden = true;
    if (on) $('pfFirst').focus();
}

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

function renderAlerts(s) {
    const a = s.account;
    $('pfAlerts').hidden = !(a && a.email);
    if (a && a.email) $('pfEmailAlerts').checked = emailAlertsEnabled();
}

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

function refresh() {
    const s = currentState(auth.currentUser);
    $('pfGate').hidden = s.signedIn;
    ['pfHero', 'pfGrid', 'pfReportsCard'].forEach(id => { $(id).hidden = !s.signedIn; });
    if (!s.signedIn) return;
    renderHeader(s);
    renderForm(s);
    renderOfficial(s);
    renderAlerts(s);
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

function pickPhoto() { $('pfPhotoInput').click(); }
$('pfAvatar').addEventListener('click', pickPhoto);
$('pfPhotoBtn').addEventListener('click', pickPhoto);

$('pfPhotoInput').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
        const dataUrl = await resizeAvatar(file);
        if (!setAvatar(dataUrl)) throw new Error('Your browser storage is full or blocked.');
        refresh();
        publish();
        toast('Profile picture updated.');
    } catch (err) {
        toast(err.message || 'Could not update the profile picture.');
    }
});

$('pfPhotoRemove').addEventListener('click', () => {
    if (!confirm('Remove your profile picture?')) return;
    setAvatar('');
    refresh();
    publish();
    toast('Profile picture removed.');
});

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

onAuthStateChanged(auth, refresh);
window.addEventListener('storage', e => { if (e.key) refresh(); });
checkApproval();
