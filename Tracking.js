/* Shares the "ricap_river_records" localStorage key written by Image_Processing.js */
const RECORDS_KEY = 'ricap_river_records';

// Whatever this file is called, use it (no more hard-coded "Documentation.html")
const PAGE_PATH = window.location.pathname.split('/').pop() || 'Tracking.html';

// Remembers the chosen chronological order between visits
const SORT_KEY = 'ricap_tracking_sort';

function loadSortOrder() {
    try {
        return localStorage.getItem(SORT_KEY) === 'oldest' ? 'oldest' : 'newest';
    } catch (err) {
        return 'newest';
    }
}

function saveSortOrder(order) {
    try { localStorage.setItem(SORT_KEY, order); } catch (err) { /* ignore */ }
}

// Returns a sorted copy by timestamp; the stored array is never reordered.
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

function formatTimestamp(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

const statusLabels = { healthy: 'Healthy', moderate: 'Moderate', polluted: 'Polluted' };


/* ---------- Monthly river map ---------- */

const STATUS_COLORS = { healthy: '#4fae8c', moderate: '#e6b207', polluted: '#d6574a' };

// Anything that is not healthy/moderate is treated as polluted (e.g. "critical")
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

// Uses mapping-data.js (RIVER_DATA) to turn a riverId into a readable river name
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

// One group per river for a given month (scans without a river id are grouped by rounded coordinates)
function groupByRiver(records, year, month) {
    const groups = new Map();
    records.forEach(function (r) {
        if (!inMonth(r, year, month) || !hasPoint(r)) return;
        const key = r.riverId ? String(r.riverId) : 'pt:' + r.lat.toFixed(3) + ',' + r.lng.toFixed(3);
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
        '<p class="pop-row"><b>' + g.count + '</b> ' + (g.count === 1 ? 'scan' : 'scans') + ' this month · avg score <b>' + g.avg + '</b>/100</p>' +
        '<p class="pop-row">Latest: ' + esc(formatTimestamp(g.latest.timestamp)) + ' · <b>' + (Number(g.latest.score) || 0) + '</b>/100</p>';
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
        html += '<p class="pop-row">No scans here last month.</p>';
    }
    return html;
}

function renderMonthMap(records, year, month) {
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
    title.textContent = monthName + ' · ' + (groups.size === 1 ? '1 river scanned' : groups.size + ' rivers scanned');

    const others = records.length - total;
    const noLoc = total - located;
    const bits = [];
    if (others > 0) bits.push(others + (others === 1 ? ' scan is' : ' scans are') + ' from other months (' + records.length + ' total) — use the arrows to view them');
    if (noLoc > 0) bits.push(noLoc + (noLoc === 1 ? ' scan this month has' : ' scans this month have') + ' no saved location, so ' + (noLoc === 1 ? 'it is' : 'they are') + ' not on the map');
    note.textContent = bits.join('. ') + (bits.length ? '.' : '');
    note.hidden = bits.length === 0;

    stats.innerHTML =
        statTile('Rivers scanned', groups.size) +
        statTile('Total scans', total) +
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
          .bindTooltip(g.name + ' · ' + g.count + (g.count === 1 ? ' scan' : ' scans'), { direction: 'top' });
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

function statTile(label, value) {
    return '<div class="trend-stat"><p class="label">' + label + '</p><p class="value">' + value + '</p></div>';
}

function initTracking() {
    const listState = document.getElementById('listState');
    const detailState = document.getElementById('detailState');
    const recordGrid = document.getElementById('recordGrid');
    const recordCount = document.getElementById('recordCount');
    const docsEmpty = document.getElementById('docsEmpty');
    const backToList = document.getElementById('backToList');
    const logReportBtn = document.getElementById('logReportBtn');
    const deleteRecordBtn = document.getElementById('deleteRecordBtn');

    const sortSelect = document.getElementById('sortOrder');
    const clearAllBtn = document.getElementById('clearAllBtn');

    let currentId = null;
    const now = new Date();
    let chartYear = now.getFullYear();
    let chartMonth = now.getMonth();
    const trendPrev = document.getElementById('trendPrev');
    const trendNext = document.getElementById('trendNext');
    let sortOrder = loadSortOrder();
    sortSelect.value = sortOrder;

    sortSelect.addEventListener('change', function () {
        sortOrder = sortSelect.value === 'oldest' ? 'oldest' : 'newest';
        saveSortOrder(sortOrder);
        renderList();
    });

    function renderChart() {
        renderMonthMap(loadRecords(), chartYear, chartMonth);
        // can't go past the current month
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

    function renderList() {
        const records = loadRecords();
        renderChart();
        recordCount.textContent = records.length === 1 ? '1 scan logged' : records.length + ' scans logged';

        clearAllBtn.hidden = records.length === 0;

        if (records.length === 0) {
            docsEmpty.hidden = false;
            recordGrid.hidden = true;
            recordGrid.innerHTML = '';
            return;
        }

        docsEmpty.hidden = true;
        recordGrid.hidden = false;
        recordGrid.innerHTML = '';

        sortRecords(records, sortOrder).forEach(function (record) {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'record-card';
            card.dataset.id = record.id;
            card.innerHTML =
                '<div class="record-thumb"><img src="' + record.image + '" alt="Processed river photo"></div>' +
                '<div class="record-body">' +
                    '<div class="record-status">' +
                        '<span class="status-dot ' + record.status + '"></span>' +
                        '<div>' +
                            '<p class="record-title">' + (statusLabels[record.status] || record.status) + '</p>' +
                            '<p class="record-date">' + formatTimestamp(record.timestamp) + '</p>' +
                        '</div>' +
                    '</div>' +
                    '<div class="record-score">' + record.score + '<span>/100</span></div>' +
                '</div>';
            card.addEventListener('click', function () { showDetail(record.id); });

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'record-delete';
            delBtn.setAttribute('aria-label', 'Delete this scan');
            delBtn.title = 'Delete this scan';
            delBtn.innerHTML = '&times;';
            delBtn.addEventListener('click', function () { if (deleteRecord(record.id)) renderList(); });

            const item = document.createElement('div');
            item.className = 'record-item';
            item.appendChild(card);
            item.appendChild(delBtn);
            recordGrid.appendChild(item);
        });
    }

    // Removes one record from this browser's saved list (used by the card X and the detail view)
    function deleteRecord(id) {
        if (!confirm('Delete this scan record? This cannot be undone.')) return false;
        const remaining = loadRecords().filter(function (r) { return r.id !== id; });
        if (!saveRecords(remaining)) {
            alert('Could not delete the record. Browser storage may be blocked.');
            return false;
        }
        return true;
    }

    clearAllBtn.addEventListener('click', function () {
        const count = loadRecords().length;
        if (!count) return;
        if (!confirm('Delete all ' + count + ' scan records? This cannot be undone.')) return;
        if (!saveRecords([])) {
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

    function showDetail(id) {
        const records = loadRecords();
        const record = records.find(function (r) { return r.id === id; });

        if (!record) {
            showList();
            return;
        }

        currentId = id;
        listState.hidden = true;
        detailState.hidden = false;
        history.replaceState(null, '', PAGE_PATH + '?id=' + encodeURIComponent(id));

        document.getElementById('detailImage').src = record.image;
        document.getElementById('detailTimestamp').textContent = formatTimestamp(record.timestamp);

        document.getElementById('detailStatusDot').className = 'status-dot ' + record.status;
        document.getElementById('detailStatusTitle').textContent = statusLabels[record.status] || record.status;
        document.getElementById('detailScoreValue').textContent = record.score;
        document.getElementById('detailConfidenceValue').textContent = record.confidence + '%';
        document.getElementById('detailConfidenceFill').style.width = record.confidence + '%';
        document.getElementById('detailAssessmentText').textContent = record.assessment;

        const accentColors = { healthy: '#4fae8c', moderate: '#e6b207', polluted: '#d6574a' };
        const accent = accentColors[record.status] || '#e6b207';
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

        logReportBtn.disabled = !!record.reported;
        logReportBtn.textContent = record.reported ? 'Logged as official report ✓' : 'Log this as an official report';

        window.scrollTo(0, 0);
    }

    backToList.addEventListener('click', showList);

    logReportBtn.addEventListener('click', function () {
        if (!currentId) return;
        const records = loadRecords();
        const record = records.find(function (r) { return r.id === currentId; });
        if (!record || record.reported) return;
        alert('This would send this reading to your reports backend. Wire logReportBtn up to your API.');
        record.reported = true;
        saveRecords(records);
        logReportBtn.disabled = true;
        logReportBtn.textContent = 'Logged as official report ✓';
    });

    deleteRecordBtn.addEventListener('click', function () {
        if (!currentId) return;
        if (deleteRecord(currentId)) showList();
    });

    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get('id');
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