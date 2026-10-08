/* ==========================================================================
   RiCap Tracking
   Shows OFFICIAL REPORTS from ALL accounts (not just the logged-in one),
   plus a "My scans" view for the current user's own scans.
   ========================================================================== */

/* ---------- Configuration ---------- */

// Local cache written by Image_Processing.js (this browser only)
const RECORDS_KEY = 'ricap_river_records';

// Shared reports endpoint. Leave '' until the backend exists.
//   GET    REPORTS_API            -> JSON array of ALL official reports (every account)
//   POST   REPORTS_API            -> body: one record, saves it as an official report
//   DELETE REPORTS_API/<id>       -> delete a report (server must check ownership/admin)
// Example: const REPORTS_API = 'api/reports.php';
const REPORTS_API = '';

// Where your login code stores the signed-in user (JSON with id/email/username, or a plain string).
// Change this key to match your login system.
const USER_KEY = 'ricap_current_user';

const PAGE_PATH = window.location.pathname.split('/').pop() || 'Tracking.html';
const SORT_KEY = 'ricap_tracking_sort';
const SCOPE_KEY = 'ricap_tracking_scope';
const VIEW_KEY = 'ricap_tracking_view'; // 'cards' | 'table' — which layout the Records section uses

/* ---------- Current user ---------- */

function getCurrentUser() {
    try {
        const raw = localStorage.getItem(USER_KEY);
        if (!raw) return { id: '', name: '' };
        try {
            const u = JSON.parse(raw);
            if (u && typeof u === 'object') {
                const id = String(u.id || u.email || u.username || '');
                return { id: id, name: String(u.name || u.username || u.email || id) };
            }
        } catch (e) { /* plain string */ }
        return { id: String(raw), name: String(raw) };
    } catch (err) {
        return { id: '', name: '' };
    }
}

// A record is "mine" if it carries my user id. Old records with no owner were made in this browser, so they count as mine.
function isMine(record) {
    const me = getCurrentUser().id;
    if (!record.userId) return true;
    return !!me && String(record.userId) === me;
}

function reporterLabel(record) {
    if (record.reporter) return record.reporter;
    if (record.userId) return String(record.userId);
    return 'Anonymous';
}

/* ---------- Storage / data layer ---------- */

function loadSortOrder() {
    try { return localStorage.getItem(SORT_KEY) === 'oldest' ? 'oldest' : 'newest'; }
    catch (err) { return 'newest'; }
}
function saveSortOrder(order) {
    try { localStorage.setItem(SORT_KEY, order); } catch (err) { /* ignore */ }
}
function loadScope() {
    try { return localStorage.getItem(SCOPE_KEY) === 'mine' ? 'mine' : 'all'; }
    catch (err) { return 'all'; }
}
function saveScope(scope) {
    try { localStorage.setItem(SCOPE_KEY, scope); } catch (err) { /* ignore */ }
}
function loadViewMode() {
    try { return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'cards'; }
    catch (err) { return 'cards'; }
}
function saveViewMode(mode) {
    try { localStorage.setItem(VIEW_KEY, mode); } catch (err) { /* ignore */ }
}

function loadRecords() {
    try {
        const raw = localStorage.getItem(RECORDS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error('Could not read saved records:', err);
        return [];
    }
}

function saveRecords(records) {
    try {
        localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
        return true;
    } catch (err) {
        console.error('Could not save records:', err);
        return false;
    }
}

// Pulls every account's official reports from the shared backend.
// Returns { records, shared } — shared=false means no backend answered.
async function fetchSharedReports() {
    if (!REPORTS_API) return { records: [], shared: false };
    try {
        const res = await fetch(REPORTS_API, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const list = Array.isArray(data) ? data : (Array.isArray(data.reports) ? data.reports : []);
        return { records: list, shared: true };
    } catch (err) {
        console.error('Could not load shared reports:', err);
        return { records: [], shared: false, failed: true };
    }
}

// Builds the list to display for the chosen scope.
//   all  -> every official report from every account (+ official reports saved in this browser)
//   mine -> all of the current user's scans, reported or not
async function getDataset(scope) {
    const local = loadRecords();

    if (scope === 'mine') {
        return { records: local.filter(isMine), shared: false };
    }

    const remote = await fetchSharedReports();
    const byId = new Map();
    remote.records.forEach(function (r) { if (r && r.id != null) byId.set(String(r.id), r); });
    local.forEach(function (r) {
        if (r.reported && !byId.has(String(r.id))) byId.set(String(r.id), r);
    });
    return { records: Array.from(byId.values()), shared: remote.shared, failed: !!remote.failed };
}

async function sendReportToServer(record) {
    if (!REPORTS_API) return true;
    try {
        const res = await fetch(REPORTS_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(record)
        });
        return res.ok;
    } catch (err) {
        console.error('Could not send report:', err);
        return false;
    }
}

async function deleteReportOnServer(id) {
    if (!REPORTS_API) return true;
    try {
        const res = await fetch(REPORTS_API + '/' + encodeURIComponent(id), { method: 'DELETE' });
        return res.ok;
    } catch (err) {
        console.error('Could not delete report:', err);
        return false;
    }
}

/* ---------- Helpers ---------- */

function sortRecords(records, order) {
    const time = function (r) {
        const t = new Date(r.timestamp).getTime();
        return isNaN(t) ? 0 : t;
    };
    return records.slice().sort(function (a, b) {
        return order === 'oldest' ? time(a) - time(b) : time(b) - time(a);
    });
}

function initNav() {
    const nav = document.getElementById('siteNav');
    const toggle = document.getElementById('navToggle');
    const links = document.getElementById('navLinks');

    function onScroll() {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        nav.classList.toggle('scrolled', scrollTop > 12);
    }
    function onToggleClick() {
        const isOpen = links.classList.toggle('open');
        toggle.classList.toggle('open', isOpen);
        toggle.setAttribute('aria-expanded', String(isOpen));
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    toggle.addEventListener('click', onToggleClick);
    links.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function () {
            links.classList.remove('open');
            toggle.classList.remove('open');
            toggle.setAttribute('aria-expanded', 'false');
        });
    });
    onScroll();
}

function formatTimestamp(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

const statusLabels = { healthy: 'Healthy', moderate: 'Moderate', polluted: 'Polluted' };

/* ---------- Monthly river map ---------- */

const STATUS_COLORS = { healthy: '#4fae8c', moderate: '#e6b207', polluted: '#d6574a' };

function bucketOf(status) {
    return status === 'healthy' || status === 'moderate' ? status : 'polluted';
}

function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
}

function hasPoint(r) {
    return typeof r.lat === 'number' && typeof r.lng === 'number' && isFinite(r.lat) && isFinite(r.lng);
}

function riverNameFor(record) {
    try {
        if (typeof RIVER_DATA !== 'undefined' && record.riverId) {
            const found = RIVER_DATA.find(function (x) { return String(x.id) === String(record.riverId); });
            if (found) return found.name;
        }
    } catch (e) { /* ignore */ }
    return record.name || 'Unnamed spot';
}

function inMonth(record, year, month) {
    const t = new Date(record.timestamp);
    return !isNaN(t.getTime()) && t.getFullYear() === year && t.getMonth() === month;
}

// Same grouping key used for the monthly map's circle markers (by river id when known,
// otherwise by rounded coordinates) — reused by the timeline sidebar so a click there can find
// the exact marker on the map to open.
function groupKeyFor(r) {
    return r.riverId ? String(r.riverId) : 'pt:' + r.lat.toFixed(3) + ',' + r.lng.toFixed(3);
}

function groupByRiver(records, year, month) {
    const groups = new Map();
    records.forEach(function (r) {
        if (!inMonth(r, year, month) || !hasPoint(r)) return;
        const key = groupKeyFor(r);
        let g = groups.get(key);
        if (!g) {
            g = { key: key, name: riverNameFor(r), count: 0, scoreSum: 0, latest: r, counts: { healthy: 0, moderate: 0, polluted: 0 } };
            groups.set(key, g);
        }
        g.count++;
        g.scoreSum += Number(r.score) || 0;
        g.counts[bucketOf(r.status)]++;
        if (new Date(r.timestamp) > new Date(g.latest.timestamp)) g.latest = r;
    });
    groups.forEach(function (g) { g.avg = Math.round(g.scoreSum / g.count); });
    return groups;
}

let trendMap = null;
let trendLayer = null;
let trendMarkers = {};

function ensureMap() {
    if (trendMap) return trendMap;
    const el = document.getElementById('trendMap');
    if (typeof L === 'undefined') {
        el.innerHTML = '<p class="trend-empty" style="padding:24px">The map library could not load. Check your internet connection and refresh.</p>';
        return null;
    }
    const bounds = (typeof BATAAN_BOUNDS !== 'undefined') ? BATAAN_BOUNDS : [[14.33, 120.02], [14.97, 120.66]];
    trendMap = L.map(el, { zoomControl: true, scrollWheelZoom: false, maxBounds: L.latLngBounds(bounds).pad(0.4) });
    trendMap.fitBounds(bounds);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(trendMap);
    trendLayer = L.layerGroup().addTo(trendMap);
    return trendMap;
}

function popupHtml(g, prev) {
    const st = bucketOf(g.latest.status);
    let html = '<p class="pop-title">' + esc(g.name) + '</p>' +
        '<span class="pop-pill" style="background:' + STATUS_COLORS[st] + '">' + esc(statusLabels[st] || st) + '</span>' +
        '<p class="pop-row"><b>' + g.count + '</b> ' + (g.count === 1 ? 'report' : 'reports') + ' this month · avg score <b>' + g.avg + '</b>/100</p>' +
        '<p class="pop-row">Latest: ' + esc(formatTimestamp(g.latest.timestamp)) + ' · <b>' + (Number(g.latest.score) || 0) + '</b>/100</p>' +
        '<p class="pop-row">By: ' + esc(reporterLabel(g.latest)) + '</p>';
    if (g.count > 1) {
        html += '<p class="pop-row">' + g.counts.healthy + ' healthy · ' + g.counts.moderate + ' moderate · ' + g.counts.polluted + ' polluted</p>';
    }
    if (prev) {
        const diff = g.avg - prev.avg;
        const arrow = diff > 0 ? '<span class="pop-up">&#9650; ' + diff + ' worse</span>'
            : diff < 0 ? '<span class="pop-down">&#9660; ' + Math.abs(diff) + ' better</span>'
            : 'no change';
        html += '<p class="pop-row">Last month avg <b>' + prev.avg + '</b> → ' + arrow + '</p>';
    } else {
        html += '<p class="pop-row">No reports here last month.</p>';
    }
    return html;
}

function statTile(label, value) {
    return '<div class="trend-stat"><p class="label">' + label + '</p><p class="value">' + value + '</p></div>';
}

function renderMonthMap(records, year, month, noun) {
    const title = document.getElementById('trendTitle');
    const stats = document.getElementById('trendStats');
    const empty = document.getElementById('trendEmpty');
    const chips = document.getElementById('riverChips');
    const note = document.getElementById('trendNote');

    const monthRecords = records.filter(function (r) { return inMonth(r, year, month); });
    const total = monthRecords.length;
    const located = monthRecords.filter(hasPoint).length;
    const scoreSum = monthRecords.reduce(function (a, r) { return a + (Number(r.score) || 0); }, 0);
    const buckets = { healthy: 0, moderate: 0, polluted: 0 };
    monthRecords.forEach(function (r) { buckets[bucketOf(r.status)]++; });

    const groups = groupByRiver(records, year, month);
    const prevDate = new Date(year, month - 1, 1);
    const prevGroups = groupByRiver(records, prevDate.getFullYear(), prevDate.getMonth());

    const monthName = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    title.textContent = monthName + ' · ' + (groups.size === 1 ? '1 river reported' : groups.size + ' rivers reported');

    const others = records.length - total;
    const noLoc = total - located;
    const bits = [];
    if (others > 0) bits.push(others + (others === 1 ? ' ' + noun + ' is' : ' ' + noun + 's are') + ' from other months (' + records.length + ' total) — use the arrows to view them');
    if (noLoc > 0) bits.push(noLoc + (noLoc === 1 ? ' ' + noun + ' this month has' : ' ' + noun + 's this month have') + ' no saved location, so ' + (noLoc === 1 ? 'it is' : 'they are') + ' not on the map');
    note.textContent = bits.join('. ') + (bits.length ? '.' : '');
    note.hidden = bits.length === 0;

    stats.innerHTML =
        statTile('Rivers reported', groups.size) +
        statTile('Total ' + noun + 's', total) +
        statTile('Healthy', buckets.healthy) +
        statTile('Moderate', buckets.moderate) +
        statTile('Polluted', buckets.polluted) +
        statTile('Avg score', total ? Math.round(scoreSum / total) : '—');

    empty.hidden = groups.size !== 0;
    chips.innerHTML = '';

    const map = ensureMap();
    if (!map) return;
    map.invalidateSize();
    trendLayer.clearLayers();
    trendMarkers = {};

    const latlngs = [];
    groups.forEach(function (g) {
        const st = bucketOf(g.latest.status);
        const ll = [g.latest.lat, g.latest.lng];
        latlngs.push(ll);

        const marker = L.circleMarker(ll, {
            radius: Math.min(26, 9 + Math.sqrt(g.count) * 4),
            color: '#ffffff',
            weight: 2,
            fillColor: STATUS_COLORS[st],
            fillOpacity: 0.9
        }).bindPopup(popupHtml(g, prevGroups.get(g.key)), { maxWidth: 280 })
          .bindTooltip(g.name + ' · ' + g.count + (g.count === 1 ? ' ' + noun : ' ' + noun + 's'), { direction: 'top' });
        marker.addTo(trendLayer);
        trendMarkers[g.key] = marker;

        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'river-chip';
        chip.innerHTML = '<i style="background:' + STATUS_COLORS[st] + '"></i>' + esc(g.name) + ' <span>' + g.count + '</span>';
        chip.addEventListener('click', function () {
            map.flyTo(ll, Math.max(map.getZoom(), 13), { duration: 0.6 });
            marker.openPopup();
        });
        chips.appendChild(chip);
    });

    if (latlngs.length === 1) {
        map.setView(latlngs[0], 13);
    } else if (latlngs.length > 1) {
        map.fitBounds(L.latLngBounds(latlngs).pad(0.35), { maxZoom: 14 });
    } else {
        const bounds = (typeof BATAAN_BOUNDS !== 'undefined') ? BATAAN_BOUNDS : [[14.33, 120.02], [14.97, 120.66]];
        map.fitBounds(bounds);
    }
}

/* ---------- Timeline sidebar (Google-Maps-Timeline style) ---------- */

function dayKey(d) {
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

function dayLabel(d) {
    const now = new Date();
    const startOfDay = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric'
    });
}

// Renders the scrollable, day-grouped list beside the monthly map. Most recent day first;
// within a day, entries run chronologically (earliest first), the way Google's own Timeline
// lists a day's visited places. Clicking an entry flies the map to that scan's exact location
// and opens the report popup for its river; the small chevron instead opens the full record.
function renderTimelineSidebar(records, year, month, noun, onViewDetails) {
    const sidebar = document.getElementById('timelineSidebar');
    if (!sidebar) return;

    const monthRecords = records.filter(function (r) { return inMonth(r, year, month); });
    sidebar.innerHTML = '';

    if (!monthRecords.length) {
        sidebar.innerHTML = '<p class="timeline-empty">No ' + noun + 's this month.</p>';
        return;
    }

    const days = new Map();
    monthRecords.forEach(function (r) {
        const d = new Date(r.timestamp);
        if (isNaN(d.getTime())) return;
        const key = dayKey(d);
        if (!days.has(key)) days.set(key, { date: d, items: [] });
        days.get(key).items.push(r);
    });
    days.forEach(function (group) {
        group.items.sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
    });

    Array.from(days.values())
        .sort(function (a, b) { return b.date - a.date; })
        .forEach(function (group) {
            const section = document.createElement('div');
            section.className = 'timeline-day-group';

            const header = document.createElement('div');
            header.className = 'timeline-day-header';
            header.textContent = dayLabel(group.date);
            section.appendChild(header);

            group.items.forEach(function (record) {
                const st = bucketOf(record.status);
                const time = new Date(record.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

                const item = document.createElement('div');
                item.className = 'timeline-item';
                item.dataset.id = record.id;
                item.setAttribute('role', 'button');
                item.setAttribute('tabindex', '0');

                item.innerHTML =
                    '<span class="timeline-item-time">' + esc(time) + '</span>' +
                    '<span class="timeline-item-dot" style="background:' + STATUS_COLORS[st] + '"></span>' +
                    '<span class="timeline-item-body">' +
                        '<p class="timeline-item-title">' + esc(riverNameFor(record)) + '</p>' +
                        '<p class="timeline-item-sub">' + esc(statusLabels[st] || st) + ' · ' + (Number(record.score) || 0) + '/100' +
                            (noun === 'report' ? ' · ' + esc(reporterLabel(record)) : '') +
                        '</p>' +
                    '</span>' +
                    '<button type="button" class="timeline-item-view" aria-label="View full report">&rsaquo;</button>';

                function activate() {
                    sidebar.querySelectorAll('.timeline-item.active').forEach(function (el) { el.classList.remove('active'); });
                    item.classList.add('active');

                    if (trendMap && hasPoint(record)) {
                        trendMap.flyTo([record.lat, record.lng], Math.max(trendMap.getZoom(), 14), { duration: 0.6 });
                        const marker = trendMarkers[groupKeyFor(record)];
                        if (marker) marker.openPopup();
                    }
                }

                item.addEventListener('click', activate);
                item.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
                });

                const viewBtn = item.querySelector('.timeline-item-view');
                viewBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (onViewDetails) onViewDetails(record.id);
                });

                section.appendChild(item);
            });

            sidebar.appendChild(section);
        });
}

/* ---------- Page logic ---------- */

function initTracking() {
    const listState = document.getElementById('listState');
    const detailState = document.getElementById('detailState');
    const recordGrid = document.getElementById('recordGrid');
    const timelineTableWrap = document.getElementById('timelineTableWrap');
    const recordCount = document.getElementById('recordCount');
    const docsEmpty = document.getElementById('docsEmpty');
    const docsEmptyText = document.getElementById('docsEmptyText');
    const sourceNote = document.getElementById('sourceNote');
    const backToList = document.getElementById('backToList');
    const logReportBtn = document.getElementById('logReportBtn');
    const deleteRecordBtn = document.getElementById('deleteRecordBtn');
    const sortSelect = document.getElementById('sortOrder');
    const scopeSelect = document.getElementById('scopeFilter');
    const clearAllBtn = document.getElementById('clearAllBtn');
    const trendPrev = document.getElementById('trendPrev');
    const trendNext = document.getElementById('trendNext');
    const viewCardsBtn = document.getElementById('viewCardsBtn');
    const viewTableBtn = document.getElementById('viewTableBtn');

    const now = new Date();
    let chartYear = now.getFullYear();
    let chartMonth = now.getMonth();
    let currentId = null;
    let sortOrder = loadSortOrder();
    let scope = loadScope();
    let viewMode = loadViewMode();
    let dataset = [];          // what is currently displayed
    let renderToken = 0;       // guards against out-of-order async loads

    sortSelect.value = sortOrder;
    scopeSelect.value = scope;

    function noun() { return scope === 'all' ? 'report' : 'scan'; }

    function applyViewMode() {
        viewCardsBtn.classList.toggle('active', viewMode === 'cards');
        viewTableBtn.classList.toggle('active', viewMode === 'table');
        viewCardsBtn.setAttribute('aria-selected', String(viewMode === 'cards'));
        viewTableBtn.setAttribute('aria-selected', String(viewMode === 'table'));
    }
    applyViewMode();

    viewCardsBtn.addEventListener('click', function () {
        if (viewMode === 'cards') return;
        viewMode = 'cards';
        saveViewMode(viewMode);
        applyViewMode();
        renderRecordsView();
    });
    viewTableBtn.addEventListener('click', function () {
        if (viewMode === 'table') return;
        viewMode = 'table';
        saveViewMode(viewMode);
        applyViewMode();
        renderRecordsView();
    });

    sortSelect.addEventListener('change', function () {
        sortOrder = sortSelect.value === 'oldest' ? 'oldest' : 'newest';
        saveSortOrder(sortOrder);
        renderRecordsView(); // order only — no need to refetch the dataset
    });

    scopeSelect.addEventListener('change', function () {
        scope = scopeSelect.value === 'mine' ? 'mine' : 'all';
        saveScope(scope);
        renderList();
    });

    function renderChart() {
        renderMonthMap(dataset, chartYear, chartMonth, noun());
        renderTimelineSidebar(dataset, chartYear, chartMonth, noun(), showDetail);
        trendNext.disabled = chartYear === now.getFullYear() && chartMonth === now.getMonth();
    }

    function shiftMonth(delta) {
        const d = new Date(chartYear, chartMonth + delta, 1);
        if (d > new Date(now.getFullYear(), now.getMonth(), 1)) return;
        chartYear = d.getFullYear();
        chartMonth = d.getMonth();
        renderChart();
    }

    trendPrev.addEventListener('click', function () { shiftMonth(-1); });
    trendNext.addEventListener('click', function () { shiftMonth(1); });

    function describeSource(result) {
        if (scope === 'mine') return 'Showing only your own scans from this browser.';
        if (result.failed) return 'Could not reach the reports server, so only official reports saved in this browser are shown.';
        if (!result.shared) return 'No shared reports server is connected yet, so only official reports from this browser are shown. Connect REPORTS_API in Tracking.js to see every account’s reports.';
        return '';
    }

    // Builds the card grid for the current dataset/sort/scope.
    function renderCardsGrid() {
        recordGrid.innerHTML = '';
        sortRecords(dataset, sortOrder).forEach(function (record) {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'record-card';
            card.dataset.id = record.id;
            card.innerHTML =
                '<div class="record-thumb"><img src="' + esc(record.image) + '" alt="Processed river photo"></div>' +
                '<div class="record-body">' +
                    '<div class="record-status">' +
                        '<span class="status-dot ' + esc(record.status) + '"></span>' +
                        '<div>' +
                            '<p class="record-title">' + esc(statusLabels[record.status] || record.status) + '</p>' +
                            '<p class="record-date">' + esc(formatTimestamp(record.timestamp)) + '</p>' +
                            (scope === 'all' ? '<p class="record-date">by ' + esc(reporterLabel(record)) + '</p>' : '') +
                        '</div>' +
                    '</div>' +
                    '<div class="record-score">' + esc(record.score) + '<span>/100</span></div>' +
                '</div>';
            card.addEventListener('click', function () { showDetail(record.id); });

            const item = document.createElement('div');
            item.className = 'record-item';
            item.appendChild(card);

            // Only the owner can delete a record
            if (isMine(record)) {
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'record-delete';
                delBtn.setAttribute('aria-label', 'Delete this record');
                delBtn.title = 'Delete this record';
                delBtn.innerHTML = '&times;';
                delBtn.addEventListener('click', async function () {
                    if (await deleteRecord(record.id)) renderList();
                });
                item.appendChild(delBtn);
            }
            recordGrid.appendChild(item);
        });
    }

    // Builds the tabular timeline — one row per record, in the current sort order.
    function renderTableRows() {
        const tbody = document.getElementById('timelineTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        const rows = sortRecords(dataset, sortOrder);
        if (!rows.length) return; // the shared docsEmpty state covers this

        rows.forEach(function (record) {
            const d = new Date(record.timestamp);
            const dateStr = isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = isNaN(d.getTime()) ? '—' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
            const st = bucketOf(record.status);

            const tr = document.createElement('tr');
            tr.dataset.id = record.id;
            tr.tabIndex = 0;
            tr.innerHTML =
                '<td>' + esc(dateStr) + '</td>' +
                '<td>' + esc(timeStr) + '</td>' +
                '<td>' + esc(riverNameFor(record)) + '</td>' +
                '<td><span class="table-status-pill" style="background:' + STATUS_COLORS[st] + '">' + esc(statusLabels[record.status] || record.status) + '</span></td>' +
                '<td>' + esc(record.score) + '/100</td>' +
                '<td>' + esc(reporterLabel(record)) + '</td>';

            tr.addEventListener('click', function () { showDetail(record.id); });
            tr.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(record.id); }
            });
            tbody.appendChild(tr);
        });
    }

    // Switches between Cards and Table without re-fetching the dataset.
    function renderRecordsView() {
        if (viewMode === 'table') {
            recordGrid.hidden = true;
            timelineTableWrap.hidden = false;
            renderTableRows();
        } else {
            timelineTableWrap.hidden = true;
            recordGrid.hidden = false;
            renderCardsGrid();
        }
    }

    async function renderList() {
        const token = ++renderToken;
        const result = await getDataset(scope);
        if (token !== renderToken) return;   // a newer render superseded this one

        dataset = result.records;
        renderChart();

        const n = dataset.length;
        const label = scope === 'all' ? 'official report' : 'scan';
        recordCount.textContent = n === 1 ? '1 ' + label + (scope === 'all' ? '' : ' logged')
            : n + ' ' + label + 's' + (scope === 'all' ? '' : ' logged');

        const msg = describeSource(result);
        sourceNote.textContent = msg;
        sourceNote.hidden = !msg;

        // "Delete all" only ever touches this user's own local scans
        clearAllBtn.hidden = scope !== 'mine' || n === 0;

        docsEmptyText.textContent = scope === 'all'
            ? 'No official reports yet. Run a scan and press "Submit Official Report" to add it here.'
            : 'You have no saved scans yet. Run a scan to add one here.';

        if (n === 0) {
            docsEmpty.hidden = false;
            recordGrid.hidden = true;
            timelineTableWrap.hidden = true;
            recordGrid.innerHTML = '';
            const tbody = document.getElementById('timelineTableBody');
            if (tbody) tbody.innerHTML = '';
            return;
        }

        docsEmpty.hidden = true;
        renderRecordsView();
    }

    async function deleteRecord(id) {
        const target = dataset.find(function (r) { return String(r.id) === String(id); });
        if (target && !isMine(target)) {
            alert('You can only delete your own records.');
            return false;
        }
        if (!confirm('Delete this record? This cannot be undone.')) return false;

        if (target && target.reported && REPORTS_API) {
            if (!(await deleteReportOnServer(id))) {
                alert('Could not delete the report from the server.');
                return false;
            }
        }
        const remaining = loadRecords().filter(function (r) { return String(r.id) !== String(id); });
        if (!saveRecords(remaining)) {
            alert('Could not delete the record. Browser storage may be blocked.');
            return false;
        }
        return true;
    }

    clearAllBtn.addEventListener('click', function () {
        const mine = loadRecords().filter(isMine);
        if (!mine.length) return;
        if (!confirm('Delete all ' + mine.length + ' of your saved scans from this browser? Reports already sent to the server are not removed. This cannot be undone.')) return;
        const keep = loadRecords().filter(function (r) { return !isMine(r); });
        if (!saveRecords(keep)) {
            alert('Could not delete the records. Browser storage may be blocked.');
            return;
        }
        renderList();
    });

    function showList() {
        currentId = null;
        listState.hidden = false;
        detailState.hidden = true;
        history.replaceState(null, '', PAGE_PATH);
        renderList();
    }

    async function showDetail(id) {
        let record = dataset.find(function (r) { return String(r.id) === String(id); });
        if (!record) {
            // Opened via ?id=... before the list loaded: load it now
            const result = await getDataset('all');
            dataset = result.records;
            record = dataset.find(function (r) { return String(r.id) === String(id); }) ||
                     loadRecords().find(function (r) { return String(r.id) === String(id); });
        }
        if (!record) {
            showList();
            return;
        }

        currentId = record.id;
        listState.hidden = true;
        detailState.hidden = false;
        history.replaceState(null, '', PAGE_PATH + '?id=' + encodeURIComponent(record.id));

        document.getElementById('detailImage').src = record.image;
        document.getElementById('detailTimestamp').textContent = formatTimestamp(record.timestamp);
        document.getElementById('detailReporter').textContent = 'Reported by ' + reporterLabel(record);

        document.getElementById('detailStatusDot').className = 'status-dot ' + record.status;
        document.getElementById('detailStatusTitle').textContent = statusLabels[record.status] || record.status;
        document.getElementById('detailScoreValue').textContent = record.score;
        document.getElementById('detailConfidenceValue').textContent = record.confidence + '%';
        document.getElementById('detailConfidenceFill').style.width = record.confidence + '%';
        document.getElementById('detailAssessmentText').textContent = record.assessment;

        const accent = STATUS_COLORS[record.status] || '#e6b207';
        const box = document.getElementById('detailAssessmentBox');
        box.style.borderLeftColor = accent;
        box.style.background = accent + '0f';

        document.getElementById('detailColorCast').textContent = record.colorCast;
        document.getElementById('detailSurfaceClarity').textContent = record.surfaceClarity;
        document.getElementById('detailLighting').textContent = record.lighting;
        document.getElementById('detailOverall').textContent = record.overallReading;

        const avg = record.avgColor || { r: 0, g: 0, b: 0 };
        document.getElementById('detailColorSwatch').style.background =
            'rgb(' + avg.r + ',' + avg.g + ',' + avg.b + ')';
        document.getElementById('detailMetaLine').textContent =
            'Analyzed ' + (record.sampledPixels || 0).toLocaleString() + ' sampled pixels · avg color rgb(' +
            avg.r + ', ' + avg.g + ', ' + avg.b + ') · score ' + record.score + '/100';

        // Log button: only the owner can submit; hidden on other accounts' reports
        const mine = isMine(record);
        logReportBtn.hidden = !mine;
        logReportBtn.disabled = !!record.reported;
        logReportBtn.textContent = record.reported ? 'Logged as official report ✓' : 'Log this as an official report';
        deleteRecordBtn.hidden = !mine;

        window.scrollTo(0, 0);
    }

    backToList.addEventListener('click', showList);

    logReportBtn.addEventListener('click', async function () {
        if (!currentId) return;
        const records = loadRecords();
        const record = records.find(function (r) { return String(r.id) === String(currentId); });
        if (!record || record.reported) return;

        const me = getCurrentUser();
        record.userId = record.userId || me.id;
        record.reporter = record.reporter || me.name || 'Anonymous';
        record.reported = true;
        record.reportedAt = new Date().toISOString();

        logReportBtn.disabled = true;
        logReportBtn.textContent = 'Sending…';
        const ok = await sendReportToServer(record);
        if (!ok) {
            alert('Could not send the report to the server. Please try again.');
            logReportBtn.disabled = false;
            logReportBtn.textContent = 'Log this as an official report';
            return;
        }
        saveRecords(records);
        logReportBtn.textContent = 'Logged as official report ✓';
    });

    deleteRecordBtn.addEventListener('click', async function () {
        if (!currentId) return;
        if (await deleteRecord(currentId)) showList();
    });

    const requestedId = new URLSearchParams(window.location.search).get('id');
    if (requestedId) {
        showDetail(requestedId);
    } else {
        showList();
    }
}

document.addEventListener('DOMContentLoaded', function () {
    initNav();
    initTracking();
});