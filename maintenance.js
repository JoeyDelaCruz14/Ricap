// Maintenance page (maintenance.html), admins only: reports (flag, override status, delete),
// official applications (from applications.js), river records, access codes, verified users
// and data integrity checks.

import { db, rtdb, storage, auth } from './firebase-config.js';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
    collection, query, orderBy, onSnapshot, doc, addDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { ref as storageRef, deleteObject } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import { ref as rtRef, onValue, update as rtUpdate } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { isAdminUser } from './admin-role.js';
import { watchApplications } from './applications.js';

const STORAGE_FOLDER = 'Submitted images';
const BATAAN = { south: 14.33, west: 120.02, north: 14.97, east: 120.66 };
const STATUSES = ['healthy', 'moderate', 'polluted', 'critical'];
const COAST_LABELS = { east: 'Manila Bay (east)', west: 'South China Sea (west)' };

// Escapes text before putting it into HTML.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => document.getElementById(id);

let reports = [];
let riverRecords = [];
let codes = [];
let pendingApps = 0;
let approvedApps = [];
let profiles = [];
let unsubs = [];

// Rivers from mapping-data.js.
function staticRivers() {
    try { if (typeof RIVER_DATA !== 'undefined' && Array.isArray(RIVER_DATA)) return RIVER_DATA; } catch (e) { }
    try { if (typeof RICAP_RIVERS !== 'undefined' && Array.isArray(RICAP_RIVERS)) return RICAP_RIVERS; } catch (e) { }
    try { if (typeof rivers !== 'undefined' && Array.isArray(rivers)) return rivers; } catch (e) { }
    return [];
}

// River name for an id.
function riverName(id) {
    if (id == null || id === '') return 'Unassigned';
    const hit = riverRecords.find(r => r.id === String(id)) ||
        staticRivers().find(r => String(r.id) === String(id));
    return hit ? (hit.name || hit.officialName || String(id)) : String(id);
}

// Readable date.
function fmtDate(ts) {
    const d = ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
    return d && !isNaN(d) ? d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

let toastTimer = null;
// Small message at the bottom of the page.
function toast(msg) {
    const t = $('mToast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

$('mLoginForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('mLoginError').hidden = true;
    try {
        await signInWithEmailAndPassword(auth, $('mEmail').value.trim(), $('mPassword').value);
    } catch (err) {
        $('mLoginError').textContent = 'Sign-in failed — check the email and password.';
        $('mLoginError').hidden = false;
    }
});
$('mSignOut').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async user => {
    const isAdmin = await isAdminUser(user);
    if (user !== auth.currentUser) return;
    if (user && !user.isAnonymous && !isAdmin) {
        $('mLoginError').textContent = 'This account does not have admin access.';
        $('mLoginError').hidden = false;
    }
    if (isAdmin) {
        $('mGate').hidden = true;
        $('mPanel').hidden = false;
        $('mEmailLabel').textContent = user.email;
        if (!unsubs.length) startListeners(user);
    } else {
        $('mGate').hidden = false;
        $('mPanel').hidden = true;
        unsubs.forEach(u => u());
        unsubs = [];
    }
});

// Live listeners for reports, river records, access codes, applications and profiles.
function startListeners(user) {
    currentAdmin = user.email;

    // Applications tab: the same review as Admin.html, with the pending count on the tab.
    unsubs.push(watchApplications($('appList'), $('appsEmpty'), count => {
        $('appBadge').textContent = count;
        $('appBadge').hidden = !count;
    }));

    unsubs.push(onSnapshot(query(collection(db, 'reports'), orderBy('createdAt', 'desc')), snap => {
        reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAll();
    }, err => onLoadError('reports', err)));

    unsubs.push(onSnapshot(collection(db, 'riverLocations'), snap => {
        riverRecords = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));
        renderAll();
    }, err => onLoadError('river locations', err)));

    const offCodes = onValue(rtRef(rtdb, 'accessCodes'), snap => {
        const val = snap.val() || {};
        codes = Object.entries(val).map(([code, d]) => ({ code, ...d }))
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        renderAll();
    }, err => onLoadError('access codes', err));
    unsubs.push(offCodes);

    const offApps = onValue(rtRef(rtdb, 'officialApplications'), snap => {
        const val = snap.val() || {};
        pendingApps = Object.values(val).filter(a => a && a.status === 'pending').length;
        approvedApps = Object.entries(val).filter(([, a]) => a && a.status === 'approved').map(([id, a]) => ({ id, ...a }));
        renderIntegrity();
        renderUsers();
    }, () => { });
    unsubs.push(offApps);

    unsubs.push(onSnapshot(collection(db, 'profiles'), snap => {
        profiles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderUsers();
    }, err => onLoadError('verified user profiles', err)));
}
let currentAdmin = '';

// Shows which data failed to load.
function onLoadError(what, err) {
    console.error(err);
    toast('Could not load ' + what + ' — check your Firebase rules.');
}

// Re-renders every section.
function renderAll() {
    renderStats();
    renderFlagged();
    renderReports();
    renderRivers();
    renderCodes();
    renderIntegrity();
    renderUsers();
}

// Totals at the top.
function renderStats() {
    const flagged = reports.filter(r => r.flagged).length;
    $('stReports').textContent = reports.length;
    $('stFlagged').textContent = flagged;
    $('stRivers').textContent = riverRecords.length;
    $('stCodes').textContent = codes.filter(c => c.active).length;
    $('flagBadge').textContent = flagged;
    $('flagBadge').hidden = !flagged;
}

// One report with its admin actions.
function reportCard(r) {
    const status = STATUSES.includes(r.status) ? r.status : 'healthy';
    const card = document.createElement('article');
    card.className = 'm-card' + (r.flagged ? ' is-flagged' : '');
    card.innerHTML = `
        ${r.imageUrl ? `<a href="${esc(r.imageUrl)}" target="_blank" rel="noopener"><img src="${esc(r.imageUrl)}" alt="Report photo" loading="lazy"></a>` : '<div class="m-noimg">No photo</div>'}
        <div class="m-card-body">
            <div class="m-card-top">
                <h3>${esc(r.reportName || 'Untitled report')}</h3>
                <span class="m-pill st-${status}">${esc(status)} · ${esc(r.score != null ? r.score : '—')}</span>
            </div>
            <p class="m-meta">${esc(riverName(r.riverId))} · ${esc(r.reporterName || 'Unknown reporter')}${r.reporterRole ? ' (' + esc(r.reporterRole) + ')' : ''} · ${esc(fmtDate(r.createdAt))}</p>
            <p class="m-text">${esc(r.assessment || '')}</p>
            ${r.flagged ? `<p class="m-flagnote">Flagged${r.flagReason ? ': ' + esc(r.flagReason) : ''}${r.flaggedBy ? ' — by ' + esc(r.flaggedBy) : ''}</p>` : ''}
            <div class="m-actions">
                ${r.flagged
                    ? `<button type="button" class="submit-btn" data-act="clear">Keep (clear flag)</button>`
                    : `<button type="button" class="ghost-btn" data-act="flag">Flag</button>`}
                <select data-act="status" aria-label="Override status">
                    ${STATUSES.map(s => `<option value="${s}"${s === status ? ' selected' : ''}>${s}</option>`).join('')}
                </select>
                <button type="button" class="ghost-btn danger" data-act="delete">Delete</button>
            </div>
        </div>`;

    card.querySelector('[data-act="flag"]')?.addEventListener('click', () => flagReport(r));
    card.querySelector('[data-act="clear"]')?.addEventListener('click', () => clearFlag(r));
    card.querySelector('[data-act="status"]').addEventListener('change', e => overrideStatus(r, e.target.value));
    card.querySelector('[data-act="delete"]').addEventListener('click', () => deleteReport(r));
    return card;
}

// Reports flagged for review.
function renderFlagged() {
    const list = $('flaggedList');
    const flagged = reports.filter(r => r.flagged);
    list.innerHTML = '';
    $('flaggedEmpty').hidden = flagged.length > 0;
    flagged.forEach(r => list.appendChild(reportCard(r)));
}

// All reports, filtered.
function renderReports() {
    const q = $('reportSearch').value.trim().toLowerCase();
    const st = $('reportStatus').value;
    const list = $('reportList');
    list.innerHTML = '';
    const rows = reports.filter(r => {
        if (st !== 'all' && r.status !== st) return false;
        if (!q) return true;
        return [r.reportName, riverName(r.riverId), r.reporterName, r.reporterRole]
            .some(v => String(v || '').toLowerCase().includes(q));
    });
    $('reportsEmpty').hidden = rows.length > 0;
    rows.forEach(r => list.appendChild(reportCard(r)));
}

// River records list.
function renderRivers() {
    const body = $('riverRows');
    body.innerHTML = '';
    $('riversEmpty').hidden = riverRecords.length > 0;
    $('riverTable').hidden = riverRecords.length === 0;
    riverRecords.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${esc(r.name)}${r.notes ? `<br><small>${esc(r.notes)}</small>` : ''}</td>
            <td>${esc(COAST_LABELS[r.coast] || r.coast || '—')}</td>
            <td>${esc(Number(r.lat).toFixed(5))}, ${esc(Number(r.lng).toFixed(5))}</td>
            <td><span class="m-pill ${r.active === false ? 'st-off' : 'st-healthy'}">${r.active === false ? 'inactive' : 'active'}</span></td>
            <td class="m-row-actions">
                <button type="button" class="ghost-btn" data-act="edit">Edit</button>
                <button type="button" class="ghost-btn danger" data-act="del">Delete</button>
            </td>`;
        tr.querySelector('[data-act="edit"]').addEventListener('click', () => editRiver(r));
        tr.querySelector('[data-act="del"]').addEventListener('click', () => deleteRiver(r));
        body.appendChild(tr);
    });
}

// Access codes list.
function renderCodes() {
    const body = $('codeRows');
    body.innerHTML = '';
    $('codesEmpty').hidden = codes.length > 0;
    $('codeTable').hidden = codes.length === 0;
    codes.forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><code>${esc(c.code)}</code></td>
            <td>${esc(c.officialName || '—')}</td>
            <td>${esc(c.role || '—')}<br><small>${esc(c.organization || '')}</small></td>
            <td><span class="m-pill ${c.active ? 'st-healthy' : 'st-off'}">${c.active ? 'active' : 'revoked'}</span></td>
            <td class="m-row-actions"><button type="button" class="ghost-btn${c.active ? ' danger' : ''}">${c.active ? 'Revoke' : 'Reactivate'}</button></td>`;
        tr.querySelector('button').addEventListener('click', () => toggleCode(c));
        body.appendChild(tr);
    });
}

// Up to two initials for user avatars.
const initialsOf = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || '?';
const lower = v => String(v || '').trim().toLowerCase();

// Verified users = approved applications, plus anyone who published a verified profile
// (e.g. an official whose code was issued by hand). Profiles add the picture and uids.
// Verified users from profiles, access codes and approved applications, merged.
function verifiedUsers() {
    const users = [];
    const byEmail = new Map();
    const byCode = new Map();
    const add = u => {
        users.push(u);
        if (u.email) byEmail.set(lower(u.email), u);
        if (u.code) byCode.set(String(u.code).toUpperCase(), u);
    };
    approvedApps.forEach(a => add({
        key: 'app:' + a.id,
        name: a.fullName || '', email: a.email || '', phone: a.phone || '',
        role: a.role || '', organization: a.organization || '',
        code: a.accessCode || '', idPhoto: a.photoURL || '',
        avatar: '', uids: [], approvedAt: a.submittedAt || 0
    }));
    profiles.forEach(p => {
        const code = String(p.officialCode || '').toUpperCase();
        const u = (p.email && byEmail.get(lower(p.email))) || (code && byCode.get(code));
        const uids = [p.uid, ...(Array.isArray(p.uids) ? p.uids : [])].filter(Boolean);
        if (u) {
            u.avatar = u.avatar || p.avatar || '';
            u.uids = [...new Set([...u.uids, ...uids])];
            u.name = u.name || p.name || '';
            u.phone = u.phone || p.phone || '';
            u.code = u.code || code;
            u.updatedAt = p.updatedAt;
            if (u.code) byCode.set(u.code, u);
        } else {
            add({
                key: 'profile:' + p.id,
                name: p.name || '', email: p.email || '', phone: p.phone || '',
                role: p.role || '', organization: p.organization || '',
                code, idPhoto: '', avatar: p.avatar || '', uids, updatedAt: p.updatedAt
            });
        }
    });
    users.forEach(u => {
        const uids = new Set(u.uids);
        const code = String(u.code || '').toUpperCase();
        const codeInfo = code ? codes.find(c => String(c.code).toUpperCase() === code) : null;
        u.codeActive = codeInfo ? !!codeInfo.active : null;
        u.reports = reports.filter(r => (r.uid && uids.has(r.uid)) || (code && String(r.reporterCode || '').toUpperCase() === code));
    });
    return users.sort((a, b) => b.reports.length - a.reports.length || String(a.name).localeCompare(String(b.name)));
}

const openUsers = new Set();

// One verified user.
function userCard(u) {
    const card = document.createElement('article');
    card.className = 'm-user';
    const open = openUsers.has(u.key);
    const last = u.reports[0];
    card.innerHTML = `
        <div class="m-user-head">
            <div class="m-avatar"${u.avatar ? ` style="background-image:url('${esc(u.avatar)}')"` : ''}>${u.avatar ? '' : esc(initialsOf(u.name))}</div>
            <div class="m-user-info">
                <div class="m-card-top">
                    <h3>${esc(u.name || 'Unnamed user')}</h3>
                    ${u.codeActive === false
                        ? '<span class="m-pill st-off">code revoked</span>'
                        : '<span class="m-pill st-healthy">verified</span>'}
                </div>
                <p class="m-meta">${esc([u.role, u.organization].filter(Boolean).join(' · ') || 'Verified user')}</p>
                <p class="m-meta">${esc(u.email || 'No email')}${u.phone ? ' · ' + esc(u.phone) : ''}${u.code ? ' · code <code>' + esc(u.code) + '</code>' : ''}</p>
            </div>
            <div class="m-user-count"><span>${u.reports.length}</span><small>${u.reports.length === 1 ? 'report' : 'reports'}</small></div>
        </div>
        <div class="m-actions">
            <button type="button" class="ghost-btn" data-act="toggle" aria-expanded="${open}">${open ? 'Hide reports' : 'View reports'}</button>
            ${u.idPhoto ? `<a class="ghost-btn" href="${esc(u.idPhoto)}" target="_blank" rel="noopener">Verification photo</a>` : ''}
            <span class="m-meta m-user-last">${last ? 'Last report ' + esc(fmtDate(last.createdAt)) : 'No reports yet'}${u.avatar ? '' : ' · no profile picture yet'}</span>
        </div>
        <div class="m-user-reports" ${open ? '' : 'hidden'}></div>`;

    const box = card.querySelector('.m-user-reports');
    const fill = () => {
        box.innerHTML = '';
        if (!u.reports.length) {
            box.innerHTML = '<p class="m-empty">This user has not posted any reports.</p>';
            return;
        }
        const list = document.createElement('div');
        list.className = 'm-list';
        u.reports.forEach(r => list.appendChild(reportCard(r)));
        box.appendChild(list);
    };
    if (open) fill();
    card.querySelector('[data-act="toggle"]').addEventListener('click', e => {
        const nowOpen = box.hidden;
        box.hidden = !nowOpen;
        e.currentTarget.textContent = nowOpen ? 'Hide reports' : 'View reports';
        e.currentTarget.setAttribute('aria-expanded', String(nowOpen));
        if (nowOpen) { openUsers.add(u.key); fill(); } else openUsers.delete(u.key);
    });
    return card;
}

// Verified users list.
function renderUsers() {
    const list = $('userList');
    if (!list) return;
    const q = $('userSearch').value.trim().toLowerCase();
    const users = verifiedUsers().filter(u => !q ||
        [u.name, u.email, u.role, u.organization, u.code].some(v => lower(v).includes(q)));
    list.innerHTML = '';
    $('usersEmpty').textContent = q ? 'No verified users match.' : 'No verified users yet.';
    $('usersEmpty').hidden = users.length > 0;
    users.forEach(u => list.appendChild(userCard(u)));
}

// Data checks: reports without photo or river, bad coordinates, duplicate names.
function renderIntegrity() {
    const noImage = reports.filter(r => !r.imageUrl).length;
    const noRiver = reports.filter(r => !r.riverId).length;
    const badCoords = riverRecords.filter(r => !(r.lat >= BATAAN.south && r.lat <= BATAAN.north && r.lng >= BATAAN.west && r.lng <= BATAAN.east)).length;
    const dupNames = riverRecords.length - new Set(riverRecords.map(r => String(r.name).trim().toLowerCase())).size;
    const items = [
        ['Reports missing a photo', noImage],
        ['Reports not linked to a river', noRiver],
        ['River records outside Bataan bounds', badCoords],
        ['Duplicate river names', dupNames],
        ['Applications awaiting review', pendingApps]
    ];
    $('integrityBox').innerHTML = '<ul>' + items.map(([label, n]) =>
        `<li class="${n ? 'warn' : 'ok'}"><span>${esc(label)}</span><strong>${n}</strong></li>`).join('') + '</ul>';
}

// Flags a report for review.
async function flagReport(r) {
    const reason = prompt('Why is this report being flagged?', '');
    if (reason === null) return;
    try {
        await updateDoc(doc(db, 'reports', r.id), {
            flagged: true, flagReason: reason.trim().slice(0, 200),
            flaggedBy: currentAdmin, flaggedAt: serverTimestamp()
        });
        toast('Report flagged.');
    } catch (err) { fail('Flag failed', err); }
}

// Clears a report's flag.
async function clearFlag(r) {
    try {
        await updateDoc(doc(db, 'reports', r.id), {
            flagged: false, flagReason: '', reviewedBy: currentAdmin, reviewedAt: serverTimestamp()
        });
        toast('Flag cleared — report kept.');
    } catch (err) { fail('Could not clear flag', err); }
}

// Sets a report's status by hand.
async function overrideStatus(r, status) {
    if (status === r.status) return;
    try {
        await updateDoc(doc(db, 'reports', r.id), {
            status, statusOverriddenBy: currentAdmin, statusOverriddenAt: serverTimestamp()
        });
        toast('Status changed to ' + status + '.');
    } catch (err) { fail('Status change failed', err); renderAll(); }
}

// Deletes a report and its photo.
async function deleteReport(r) {
    if (!confirm('Permanently delete "' + (r.reportName || 'this report') + '" and its photo? This cannot be undone.')) return;
    try {
        await deleteDoc(doc(db, 'reports', r.id));
    } catch (err) { return fail('Delete failed', err); }
    if (r.recordId) {
        try { await deleteObject(storageRef(storage, STORAGE_FOLDER + '/' + r.recordId + '.jpg')); }
        catch (err) { console.warn('Photo not removed:', err); toast('Report deleted, but its photo could not be removed.'); return; }
    }
    toast('Report deleted.');
}

// Clears the river form.
function resetRiverForm() {
    $('riverForm').reset();
    $('riverDocId').value = '';
    $('riverFormTitle').textContent = 'Add river location';
    $('riverCancelBtn').hidden = true;
    $('riverError').hidden = true;
}

// Loads a river into the form for editing.
function editRiver(r) {
    $('riverDocId').value = r.id;
    $('riverName').value = r.name || '';
    $('riverLat').value = r.lat;
    $('riverLng').value = r.lng;
    $('riverCoast').value = r.coast || 'east';
    $('riverActive').value = r.active === false ? 'false' : 'true';
    $('riverNotes').value = r.notes || '';
    $('riverFormTitle').textContent = 'Edit river location';
    $('riverCancelBtn').hidden = false;
    $('riverForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('riverCancelBtn').addEventListener('click', resetRiverForm);

$('riverForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('riverError');
    err.hidden = true;
    const data = {
        name: $('riverName').value.trim(),
        lat: parseFloat($('riverLat').value),
        lng: parseFloat($('riverLng').value),
        coast: $('riverCoast').value,
        active: $('riverActive').value === 'true',
        notes: $('riverNotes').value.trim()
    };
    if (data.name.length < 2) { err.textContent = 'Enter a river name.'; err.hidden = false; return; }
    if (!(data.lat >= BATAAN.south && data.lat <= BATAAN.north && data.lng >= BATAAN.west && data.lng <= BATAAN.east)) {
        err.textContent = 'Coordinates must fall inside Bataan.'; err.hidden = false; return;
    }
    const id = $('riverDocId').value;
    const dup = riverRecords.some(r => r.id !== id && String(r.name).trim().toLowerCase() === data.name.toLowerCase());
    if (dup) { err.textContent = 'A river with that name already exists.'; err.hidden = false; return; }

    $('riverSaveBtn').disabled = true;
    try {
        if (id) {
            await updateDoc(doc(db, 'riverLocations', id), { ...data, updatedBy: currentAdmin, updatedAt: serverTimestamp() });
            toast('River updated.');
        } else {
            await addDoc(collection(db, 'riverLocations'), { ...data, createdBy: currentAdmin, createdAt: serverTimestamp() });
            toast('River added.');
        }
        resetRiverForm();
    } catch (ex) { fail('Could not save river', ex); }
    finally { $('riverSaveBtn').disabled = false; }
});

// Deletes a river record.
async function deleteRiver(r) {
    const used = reports.filter(x => String(x.riverId) === r.id).length;
    const warn = used ? '\n\n' + used + ' report(s) still reference this river and will show as its raw ID.' : '';
    if (!confirm('Delete river record "' + r.name + '"?' + warn)) return;
    try { await deleteDoc(doc(db, 'riverLocations', r.id)); toast('River deleted.'); }
    catch (err) { fail('Delete failed', err); }
}

// Activates or deactivates an access code.
async function toggleCode(c) {
    const next = !c.active;
    if (!next && !confirm('Revoke code ' + c.code + '? ' + (c.officialName || 'This official') + ' will no longer be able to submit reports.')) return;
    try {
        await rtUpdate(rtRef(rtdb, 'accessCodes/' + c.code), { active: next });
        toast(next ? 'Code reactivated.' : 'Code revoked.');
    } catch (err) { fail('Could not update code', err); }
}

$('exportReportsBtn').addEventListener('click', () => {
    if (!reports.length) return toast('No reports to export.');
    const cols = ['recordId', 'reportName', 'riverId', 'status', 'score', 'lat', 'lng', 'reporterName', 'reporterRole', 'flagged', 'assessment', 'recommendation', 'imageUrl'];
    const cell = v => {
        let s = String(v == null ? '' : v);
        if (/^[=+\-@]/.test(s)) s = "'" + s;
        return '"' + s.replace(/"/g, '""') + '"';
    };
    const rows = [cols.concat('createdAt').join(',')].concat(reports.map(r =>
        cols.map(c => cell(r[c])).concat(cell(fmtDate(r.createdAt))).join(',')));
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ricap-reports-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
});

document.querySelectorAll('.m-tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.m-tab').forEach(t => t.classList.toggle('is-active', t === tab));
    document.querySelectorAll('.m-pane').forEach(p => p.classList.toggle('is-active', p.id === 'pane-' + tab.dataset.tab));
}));
$('reportSearch').addEventListener('input', renderReports);
$('userSearch').addEventListener('input', renderUsers);
$('reportStatus').addEventListener('change', renderReports);

// Shows an error toast and logs the cause.
function fail(msg, err) {
    console.error(err);
    toast(msg + (err && err.code === 'permission-denied' ? ' — permission denied (check Firebase rules).' : '.'));
}