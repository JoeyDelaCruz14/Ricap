// Home page (Home.html): the community forum of river reports from Firestore, with votes,
// comments, sharing, saved posts, status filter, river search, sort and pagination,
// plus stats, the officials list, notifications and the account box.

import { db, auth, storage } from './firebase-config.js';
import { ref as storageRef, getDownloadURL, getMetadata } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js';
import { isAdminUser } from './admin-role.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {
    collection, query, orderBy, limit, onSnapshot,
    doc, setDoc, deleteDoc, addDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { mountAuthNav, getOfficial, isVerified, logout, ensureAuth } from './Session.js';
import {
    requestNotifications, allNotifEnabled, setAllNotifications, startReportAlerts
} from './Notify.js';
import { getAccount, isLocalLoggedIn } from './account.js';
import { emailAlertsEnabled, setEmailAlerts, resyncIfOptedIn } from './alerts.js';


const STATUS_COLORS = {
    healthy: '#4fae8c',
    moderate: '#d9a441',
    polluted: '#bf5b2e',
    critical: '#c1443c'
};
const COAST_LABELS = { east: 'Manila Bay side', west: 'South China Sea side' };
const SAVED_KEY = 'ricap_saved_posts';
const WEEK_MS = 7 * 864e5;

// The river list from mapping-data.js.
function resolveRivers() {
    try { if (typeof RIVER_DATA !== 'undefined' && Array.isArray(RIVER_DATA)) return RIVER_DATA; } catch (e) {}
    if (Array.isArray(window.RIVER_DATA)) return window.RIVER_DATA;
    return [];
}
const rivers = resolveRivers();
// River from mapping-data.js by id.
const riverById = id => rivers.find(r => String(r.id) === String(id));

// Escapes text before putting it into HTML.
function escapeHtml(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Up to two initials for the avatar circle.
function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
    return parts.map(p => p[0] || '').join('').toUpperCase() || '?';
}

// Relative time such as "5 min ago".
function timeAgo(date) {
    const s = Math.max(1, Math.round((Date.now() - date.getTime()) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + ' hr ago';
    const d = Math.round(h / 24);
    if (d < 30) return d + (d === 1 ? ' day ago' : ' days ago');
    return date.toLocaleDateString();
}

// Firestore timestamp to Date.
function toDate(ts) {
    try { return ts.toDate(); } catch (e) { return ts ? new Date(ts) : new Date(); }
}

const ICON = {
    heart: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s-7-4.6-9.5-9C.9 8.8 2.6 5 6.2 5c2 0 3.3 1 5.8 3.4C14.500 6 15.800 5 17.800 5c3.600 0 5.300 3.800 3.700 7-2.500 4.400-9.500 9-9.500 9z"/></svg>',
    heartFilled: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8"><path d="M12 21s-7-4.6-9.5-9C.9 8.8 2.6 5 6.2 5c2 0 3.3 1 5.8 3.4C14.500 6 15.800 5 17.800 5c3.600 0 5.300 3.800 3.700 7-2.500 4.400-9.500 9-9.500 9z"/></svg>',
    comment: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12a8 8 0 0 1-11.800 7L3 21l2-5.500A8 8 0 1 1 21 12z"/></svg>',
    share: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/></svg>',
    bookmark: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    bookmarkFilled: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    verified: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.400 2.200 3.200-.4 1 3.100 2.800 1.700-1 3.100 1 3.100-2.800 1.700-1 3.100-3.200-.4L12 22l-2.400-2.200-3.200.4-1-3.100L2.600 15.400l1-3.100-1-3.100 2.800-1.700 1-3.100 3.200.4z"/><path d="M8.500 12l2.500 2.500 4.500-5" fill="none" stroke="#0b0c10" stroke-width="2"/></svg>'
};

const state = {
    reports: [],
    votes: new Map(),
    comments: new Map(),
    filter: 'all',
    search: '',
    sort: 'newest',
    uid: null,
    loaded: false,
    error: null,
    page: 1
};
const PAGE_SIZE = 9;
let isAdmin = false;   // set once Firebase confirms an admin login (see onAuthStateChanged below)
const expanded = new Set();
let saved = new Set();
try { saved = new Set(JSON.parse(localStorage.getItem(SAVED_KEY) || '[]')); } catch (e) {}

const $ = id => document.getElementById(id);


initNav();
mountAuthNav();
initSidebarControls();
renderAuthBlock();
initFab();
startListeners();
startReportAlerts();
resyncIfOptedIn();
ensureAuth().then(uid => { state.uid = uid; render(); }).catch(err => console.warn('Anonymous auth failed', err));

// Admins sign in with Firebase only (no local account), so the account box waits for Firebase
// to restore the login and redraws as "Admin" instead of "guest".
onAuthStateChanged(auth, async user => {
    loadMyAvatar();
    const admin = await isAdminUser(user);
    if (user !== auth.currentUser || admin === isAdmin) return;
    isAdmin = admin;
    renderAuthBlock();
});

// Nav shadow on scroll and the mobile menu.
function initNav() {
    const t = $('navToggle'), l = $('navLinks');
    if (!t || !l) return;
    t.addEventListener('click', () => {
        const o = l.classList.toggle('open');
        t.classList.toggle('open', o);
        t.setAttribute('aria-expanded', String(o));
    });
}


// Live Firestore listeners for reports, votes and comments.
function startListeners() {
    onSnapshot(
        query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(100)),
        snap => {
            state.reports = snap.docs.map(d => ({
                id: d.id,
                ...d.data({ serverTimestamps: 'estimate' })
            }));
            state.loaded = true;
            state.error = null;
            renderAll();
        },
        err => {
            console.error('RiCap: reports listener failed', err);
            state.error = 'Could not load reports right now.';
            state.loaded = true;
            renderAll();
        }
    );

    onSnapshot(collection(db, 'forumVotes'), snap => {
        const map = new Map();
        snap.forEach(d => {
            const v = d.data();
            const entry = map.get(v.reportId) || { count: 0, mine: false };
            entry.count++;
            if (state.uid && v.uid === state.uid) entry.mine = true;
            map.set(v.reportId, entry);
        });
        state.votes = map;
        render();
    }, err => console.warn('RiCap: votes listener failed', err));

    onSnapshot(
        query(collection(db, 'forumComments'), orderBy('createdAt', 'asc'), limit(1000)),
        snap => {
            const map = new Map();
            snap.forEach(d => {
                const c = { id: d.id, ...d.data({ serverTimestamps: 'estimate' }) };
                if (!map.has(c.reportId)) map.set(c.reportId, []);
                map.get(c.reportId).push(c);
            });
            state.comments = map;
            render();
        },
        err => console.warn('RiCap: comments listener failed', err)
    );
}


// Lower case, no accents, single spaces, so "río  talisay" finds "Rio Talisay".
function normalizeSearch(v) {
    return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// True if the report matches every word in the river search.
function matchesSearch(r) {
    if (!state.search) return true;
    const river = riverById(r.riverId);
    const text = normalizeSearch([
        river ? river.name : 'Unmapped river',
        river && COAST_LABELS[river.coast] ? COAST_LABELS[river.coast] : '',
        r.reportName || ''
    ].join(' '));
    return state.search.split(' ').every(word => text.includes(word));
}

// River search box: suggestions plus filtering as you type.
function initRiverSearch() {
    const input = $('riverSearch');
    if (!input) return;
    const list = $('riverSearchList');
    const names = [...new Set(rivers.map(r => r.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    names.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        list.appendChild(opt);
    });
    let timer = 0;
    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            state.search = normalizeSearch(input.value);
            state.page = 1;
            render();
        }, 150);
    });
    input.addEventListener('keydown', e => {
        if (e.key === 'Escape' && input.value) { input.value = ''; input.dispatchEvent(new Event('input')); }
    });
}

// Search, status chips, sort and the notifications button.
function initSidebarControls() {
    initRiverSearch();
    $('statusChips').addEventListener('click', e => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        state.filter = chip.dataset.status;
        state.page = 1;
        document.querySelectorAll('#statusChips .chip')
            .forEach(c => c.classList.toggle('is-active', c === chip));
        render();
    });

    $('sortSelect').addEventListener('change', e => {
        state.sort = e.target.value;
        state.page = 1;
        render();
    });

    const btn = $('notifBtn');
    const paint = () => {
        const on = allNotifEnabled();
        btn.textContent = on ? 'Alerts on for all rivers' : 'Alert me on new reports';
        btn.classList.toggle('is-active', on);
    };
    btn.addEventListener('click', async () => {
        const turnOn = !allNotifEnabled();
        if (!turnOn) {
            setAllNotifications(false);
        } else if (await requestNotifications()) {
            setAllNotifications(true);
        }
        if (isLocalLoggedIn() && getAccount()) {
            try { await setEmailAlerts(turnOn); } catch (err) { console.warn('Email alert toggle failed', err); }
            renderAuthBlock();
        }
        paint();
    });
    paint();
}

// Account box: official, logged-in account or guest.
function renderAuthBlock() {
    const box = $('authBlock');
    const o = getOfficial();
    if (isAdmin) {
        box.innerHTML = `
            <div class="official-row">
                <span class="official-avatar">A</span>
                <div>
                    <p class="official-name">Admin</p>
                    <p class="official-role">Logged in · comments show as Admin</p>
                </div>
            </div>
            <button type="button" class="preview-btn" id="authLogout" style="width:100%;margin-top:12px">Log out</button>`;
        $('authLogout').addEventListener('click', logout);
    } else if (o) {
        box.innerHTML = `
            <div class="official-row">
                <span class="official-avatar">${escapeHtml(initials(o.name))}</span>
                <div>
                    <p class="official-name">${escapeHtml(o.name || 'Verified Official')}</p>
                    <p class="official-role">${escapeHtml([o.role, o.organization].filter(Boolean).join(' · '))}</p>
                </div>
            </div>
            <button type="button" class="preview-btn" id="authLogout" style="width:100%;margin-top:12px">Log out</button>`;
        $('authLogout').addEventListener('click', logout);
    } else if (isLocalLoggedIn() && getAccount()) {
        const acc = getAccount();
        const alertLine = `<p class="preview-note" style="margin-top:10px">Email alerts to ${escapeHtml(acc.email || '')}: <strong>${emailAlertsEnabled() ? 'ON' : 'OFF'}</strong></p>
               <button type="button" class="preview-btn" id="alertToggle" style="width:100%;margin-top:8px">${emailAlertsEnabled() ? 'Turn email alerts off' : 'Turn email alerts on'}</button>`;
        box.innerHTML = `
            <div class="official-row">
                <span class="official-avatar">${escapeHtml(initials(acc.name))}</span>
                <div>
                    <p class="official-name">Hi, ${escapeHtml(acc.name || 'there')}</p>
                    <p class="official-role">Logged in</p>
                </div>
            </div>
            ${alertLine}
            <button type="button" class="preview-btn" id="authLogout" style="width:100%;margin-top:12px">Log out</button>`;
        $('authLogout').addEventListener('click', logout);
        const t = $('alertToggle');
        if (t) t.addEventListener('click', async () => {
            t.disabled = true;
            try { await setEmailAlerts(!emailAlertsEnabled()); } catch (err) { alert('Could not update email alerts. Please try again.'); }
            renderAuthBlock();
        });
    } else {
        box.innerHTML = `
            <p class="preview-note">You're browsing as a guest. You can vote and comment. Verified officials can submit reports from the Scanner.</p>
            <a class="preview-btn" href="Image_Processing.html" style="display:block;text-align:center;text-decoration:none;margin-top:10px;padding:9px 0">Enter access code</a>`;
    }
}

// Floating "New report" button for verified officials.
function initFab() {
    const fab = $('fabSubmit');
    if (!fab) return;
    fab.hidden = !isVerified();
    fab.addEventListener('click', () => { location.href = 'Image_Processing.html'; });
}

// Totals at the top and the list of active officials.
function renderStatsAndOfficials() {
    const all = state.reports;
    const officialKey = r => r.reporterCode || r.reporterName;

    $('statReports').textContent = all.length;
    $('statRivers').textContent = new Set(all.map(r => r.riverId).filter(Boolean)).size;
    $('statOfficials').textContent = new Set(all.map(officialKey).filter(Boolean)).size;

    const weekAgo = Date.now() - WEEK_MS;
    const active = new Map();
    all.forEach(r => {
        if (!r.createdAt || toDate(r.createdAt).getTime() < weekAgo) return;
        const key = officialKey(r);
        if (!key) return;
        const e = active.get(key) || { name: r.reporterName, role: r.reporterRole, count: 0 };
        e.count++;
        active.set(key, e);
    });

    const list = $('officialList');
    if (!active.size) {
        list.innerHTML = '<li class="preview-note">No official reports this week.</li>';
        return;
    }
    list.innerHTML = [...active.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 6)
        .map(o => `
            <li class="official-row">
                <span class="official-avatar">${escapeHtml(initials(o.name))}</span>
                <div>
                    <p class="official-name">${escapeHtml(o.name || 'Official')}</p>
                    <p class="official-role">${escapeHtml(o.role || 'Verified official')} · ${o.count} report${o.count === 1 ? '' : 's'}</p>
                </div>
            </li>`)
        .join('');
}


// Re-renders the stats and the feed.
function renderAll() {
    renderStatsAndOfficials();
    render();
}

// Reports after the status filter and search, sorted.
function visibleReports() {
    let list = state.reports.filter(r => (state.filter === 'all' || r.status === state.filter) && matchesSearch(r));
    const votes = r => (state.votes.get(r.id) || { count: 0 }).count;
    const comms = r => (state.comments.get(r.id) || []).length;
    const time = r => (r.createdAt ? toDate(r.createdAt).getTime() : Date.now());

    list = list.slice().sort((a, b) => {
        if (state.sort === 'liked') return votes(b) - votes(a) || time(b) - time(a);
        if (state.sort === 'discussed') return comms(b) - comms(a) || time(b) - time(a);
        return time(b) - time(a);
    });
    return list;
}

// Renders the current page of posts, keeping comment drafts and focus.
// Reporter profile pictures for the post bubbles. Each picture lives at profile-pictures/<uid> in
// Storage (only accounts that uploaded one have it); looked up once per reporter and cached.
// Until it arrives, or when there is none, the bubble shows the initials.
const avatars = new Map();
let avatarRepaint = 0;
function avatarFor(uid) {
    if (!uid) return '';
    if (!avatars.has(uid)) {
        avatars.set(uid, '');
        const fileRef = storageRef(storage, 'profile-pictures/' + uid);
        // The file is cached for a year and keeps its URL when replaced, so the update time
        // is added to the URL to always show the current picture.
        Promise.all([getDownloadURL(fileRef), getMetadata(fileRef)])
            .then(([url, meta]) => {
                avatars.set(uid, url + '&v=' + (Date.parse(meta.updated) || 0));
                clearTimeout(avatarRepaint);
                avatarRepaint = setTimeout(render, 120);   // one redraw for a batch of pictures
            })
            .catch(() => { /* no picture (or not readable): keep the initials */ });
    }
    return avatars.get(uid);
}

// The viewer's own picture and every Firebase uid they have used on this device, so all of their
// posts show their current picture even if some were made under an older session.
let mine = { uids: new Set(), photo: '' };
function loadMyAvatar() {
    import('./profile-sync.js').then(m => {
        const uids = new Set(m.knownUids());
        const u = auth.currentUser;
        if (u && !u.isAnonymous) uids.add(u.uid);
        mine = { uids, photo: m.getAvatar() };
        render();
    }).catch(e => console.warn('RiCap: could not load your profile picture', e));
}

// Who a post belongs to, beyond its uid: posts with the same access code are the same official,
// and admin posts are the admin. Used to share a picture across that person's posts.
function reporterGroup(r) {
    if (r.reporterCode) return 'code:' + String(r.reporterCode).toUpperCase();
    if (r.reporterRole === 'Admin') return 'admin';
    return '';
}

// Picture for a post bubble: the viewer's own picture on their posts, else the picture of the
// account that posted it, else a picture found on another post by the same official / admin.
function avatarForReport(r) {
    if (mine.photo && r.uid && mine.uids.has(r.uid)) return mine.photo;
    const direct = avatarFor(r.uid);
    if (direct) return direct;
    const group = reporterGroup(r);
    if (!group) return '';
    for (const other of state.reports) {
        if (other.uid && other.uid !== r.uid && reporterGroup(other) === group) {
            const url = avatarFor(other.uid);
            if (url) return url;
        }
    }
    return '';
}

function render() {
    const feed = $('forumFeed');
    if (!feed) return;

    const drafts = {};
    feed.querySelectorAll('.post-add-comment input').forEach(i => {
        if (i.value) drafts[i.dataset.id] = i.value;
    });
    const active = document.activeElement;
    const focusId = active && active.matches && active.matches('.post-add-comment input') ? active.dataset.id : null;
    const caret = focusId ? active.selectionStart : 0;

    if (!state.loaded) {
        feed.innerHTML = '<div class="feed-empty">Loading reports…</div>';
        return;
    }
    if (state.error) {
        feed.innerHTML = `<div class="feed-empty">${escapeHtml(state.error)}</div>`;
        return;
    }

    const list = visibleReports();
    const count = $('riverSearchCount');
    if (count) {
        const q = $('riverSearch').value.trim();
        count.textContent = state.search
            ? list.length + (list.length === 1 ? ' report' : ' reports') + ' for “' + q + '”'
            : '';
    }
    if (!list.length) {
        feed.innerHTML = state.search
            ? '<div class="feed-empty">No reports found for “' + escapeHtml($('riverSearch').value.trim()) + '”. Try another river name.</div>'
            : '<div class="feed-empty">No reports match this filter yet.</div>';
        return;
    }

    const pages = Math.ceil(list.length / PAGE_SIZE);
    state.page = Math.min(Math.max(state.page, 1), pages);
    const start = (state.page - 1) * PAGE_SIZE;
    feed.innerHTML = list.slice(start, start + PAGE_SIZE).map(postHtml).join('') + pagerHtml(pages);

    feed.querySelectorAll('.post-add-comment input').forEach(i => {
        if (drafts[i.dataset.id]) i.value = drafts[i.dataset.id];
    });
    if (focusId) {
        const el = feed.querySelector(`.post-add-comment input[data-id="${CSS.escape(focusId)}"]`);
        if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch (e) {} }
    }
}

// Page buttons under the feed.
function pagerHtml(pages) {
    if (pages <= 1) return '';
    const p = state.page;
    const nums = Array.from({ length: pages }, (_, i) => i + 1).map(n =>
        `<button type="button" class="pager-btn${n === p ? ' is-active' : ''}" data-act="page" data-page="${n}"${n === p ? ' aria-current="page"' : ''}>${n}</button>`
    ).join('');
    return `
    <nav class="feed-pager" aria-label="Report pages">
        <button type="button" class="pager-btn" data-act="page" data-page="${p - 1}"${p === 1 ? ' disabled' : ''}>Prev</button>
        ${nums}
        <button type="button" class="pager-btn" data-act="page" data-page="${p + 1}"${p === pages ? ' disabled' : ''}>Next</button>
    </nav>`;
}

// Markup for one post.
function postHtml(r) {
    const river = riverById(r.riverId);
    const riverName = river ? river.name : 'Unmapped river';
    const coast = river && COAST_LABELS[river.coast] ? ' · ' + COAST_LABELS[river.coast] : '';
    const color = STATUS_COLORS[r.status] || '#7c0ae7';
    const photo = avatarForReport(r);
    const date = r.createdAt ? toDate(r.createdAt) : new Date();
    const v = state.votes.get(r.id) || { count: 0, mine: false };
    const cs = state.comments.get(r.id) || [];
    const open = expanded.has(r.id);
    const shown = open ? cs : cs.slice(-2);
    const id = escapeHtml(r.id);
    const title = r.reportName || 'Untitled report';

    const media = r.imageUrl
        ? `<img src="${escapeHtml(r.imageUrl)}" alt="${escapeHtml(title)}" loading="lazy">`
        : '<div class="post-media-empty">No photo</div>';

    const ai = (r.assessment || r.recommendation) ? `
        <details class="post-ai">
            <summary>Scan analysis &amp; AI recommendation</summary>
            ${r.assessment ? `<p><strong>Assessment.</strong> ${escapeHtml(r.assessment)}</p>` : ''}
            ${r.recommendation ? `<p><strong>Recommended action.</strong> ${escapeHtml(r.recommendation)}</p>` : ''}
        </details>` : '';

    const commentsLink = cs.length > 2
        ? `<button type="button" class="post-comments-link" data-act="expand" data-id="${id}">
               ${open ? 'Hide comments' : `View all ${cs.length} comments`}
           </button>`
        : '';

    return `
    <article class="post" data-id="${id}">
        <header class="post-head">
            <a class="post-avatar${photo ? ' has-photo' : ''}" style="--ring-color:${color}" href="pfp.html?report=${encodeURIComponent(r.id)}"
               aria-label="View ${escapeHtml(r.reporterName || 'reporter')}’s profile" title="View profile">${photo
                ? `<img src="${escapeHtml(photo)}" alt="" loading="lazy">`
                : escapeHtml(initials(r.reporterName))}</a>
            <div class="post-who">
                <p class="post-name">
                    ${escapeHtml(r.reporterName || 'Verified official')}
                    <span class="badge-official" title="Verified official">${ICON.verified}</span>
                </p>
                <p class="post-loc">${escapeHtml(riverName)}${escapeHtml(coast)}</p>
            </div>
            <button type="button" class="post-more" data-act="share" data-id="${id}" aria-label="Copy report summary">⋯</button>
        </header>

        <div class="post-media">
            ${media}
            <span class="status-pill" style="--pill-color:${color}">${escapeHtml(r.status || 'n/a')} · ${escapeHtml(r.score ?? '—')}/100</span>
        </div>

        <div class="post-actions">
            <button type="button" class="action-like ${v.mine ? 'is-liked' : ''}" data-act="like" data-id="${id}" aria-label="Like">
                ${v.mine ? ICON.heartFilled : ICON.heart}
            </button>
            <button type="button" data-act="comment" data-id="${id}" aria-label="Comment">${ICON.comment}</button>
            <button type="button" data-act="share" data-id="${id}" aria-label="Share">${ICON.share}</button>
            <button type="button" class="action-save ${saved.has(r.id) ? 'is-saved' : ''}" data-act="save" data-id="${id}" aria-label="Save">
                ${saved.has(r.id) ? ICON.bookmarkFilled : ICON.bookmark}
            </button>
        </div>

        <p class="post-likes"><strong>${v.count}</strong> ${v.count === 1 ? 'like' : 'likes'}</p>
        <p class="post-caption"><strong>${escapeHtml(title)}</strong></p>
        ${ai}
        ${commentsLink}
        ${shown.length ? `<ul class="post-comment-list">${shown.map(c => `
            <li><strong>${escapeHtml(c.author || 'Guest')}</strong>${c.isOfficial ? ' ✓' : ''}: ${escapeHtml(c.text)}</li>`).join('')}</ul>` : ''}
        <p class="post-time" title="${escapeHtml(date.toLocaleString())}">${escapeHtml(timeAgo(date))}</p>

        <div class="post-add-comment">
            <input type="text" maxlength="300" placeholder="Add a comment…" data-id="${id}" aria-label="Add a comment">
            <button type="button" data-act="post-comment" data-id="${id}">Post</button>
        </div>
    </article>`;
}


const feedEl = $('forumFeed');

feedEl.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;

    switch (btn.dataset.act) {
        case 'like': return toggleLike(id);
        case 'comment': {
            const input = feedEl.querySelector(`.post-add-comment input[data-id="${CSS.escape(id)}"]`);
            if (input) input.focus();
            return;
        }
        case 'expand':
            expanded.has(id) ? expanded.delete(id) : expanded.add(id);
            return render();
        case 'save':
            saved.has(id) ? saved.delete(id) : saved.add(id);
            try { localStorage.setItem(SAVED_KEY, JSON.stringify([...saved])); } catch (err) {}
            return render();
        case 'share': return sharePost(id, btn);
        case 'page':
            state.page = Number(btn.dataset.page);
            render();
            feedEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        case 'post-comment': {
            const input = feedEl.querySelector(`.post-add-comment input[data-id="${CSS.escape(id)}"]`);
            return submitComment(id, input);
        }
    }
});

feedEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('.post-add-comment input')) {
        e.preventDefault();
        submitComment(e.target.dataset.id, e.target);
    }
});

// Adds or removes the user's vote.
async function toggleLike(reportId) {
    try {
        const uid = state.uid || await ensureAuth();
        state.uid = uid;
        const ref = doc(db, 'forumVotes', reportId + '_' + uid);
        const mine = (state.votes.get(reportId) || {}).mine;
        if (mine) {
            await deleteDoc(ref);
            const v = state.votes.get(reportId);
            if (v) { v.mine = false; v.count = Math.max(0, v.count - 1); }
        } else {
            await setDoc(ref, { reportId, uid, createdAt: serverTimestamp() });
        }
    } catch (err) {
        console.error('Like failed', err);
        alert('Could not save your vote. Please try again.');
    }
}

// Posts a comment.
async function submitComment(reportId, input) {
    if (!input) return;
    const text = input.value.trim().slice(0, 300);
    if (!text) return;

    input.disabled = true;
    try {
        const uid = state.uid || await ensureAuth();
        state.uid = uid;
        const o = getOfficial();
        // Admins always comment as "Admin" (with the badge); officials use their name; logged-in
        // citizens use their account name; only people who are not logged in are "Guest".
        const admin = await isAdminUser(auth.currentUser);
        const acc = isLocalLoggedIn() ? getAccount() : null;
        const author = admin ? 'Admin' : (o ? o.name : (acc && acc.name ? String(acc.name).slice(0, 80) : 'Guest'));
        await addDoc(collection(db, 'forumComments'), { reportId,  text, uid,  author, isOfficial: admin || !!o, createdAt: serverTimestamp()});
        input.value = '';
        expanded.add(reportId);
    } catch (err) {
        console.error('Comment failed', err);
        alert('Could not post your comment. Please try again.');
    } finally {
        input.disabled = false;
        render();
    }
}

// Shares a post (system share sheet, or copies the link).
async function sharePost(reportId, btn) {
    const r = state.reports.find(x => x.id === reportId);
    if (!r) return;
    const river = riverById(r.riverId);
    const text = `${r.reportName || 'River report'} — ${river ? river.name : 'Bataan'}: ` +
        `${String(r.status || '').toUpperCase()} (${r.score ?? '—'}/100) · RiCap`;
    try {
        if (navigator.share) {
            await navigator.share({ title: 'RiCap river report', text, url: location.href });
        } else {
            await navigator.clipboard.writeText(text + ' ' + location.href);
            const old = btn.innerHTML;
            btn.textContent = 'Copied';
            setTimeout(() => { btn.innerHTML = old; }, 1200);
        }
    } catch (err) {  }
}