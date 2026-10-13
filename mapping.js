import { watchRiverStatuses } from './river-status.js';
import {
    requestNotifications,
    riverNotifEnabled,
    setRiverNotification,
    startReportAlerts
} from './Notify.js';
import { loadRiverLines, SEGMENT_NAMES } from './river-lines.js';
import { loadBataanMask } from './bataan-mask.js';
import { db } from './firebase-config.js';
import { ensureAuth } from './Session.js';
import {
    collection, query, where, onSnapshot, getDocs, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

function resolveRivers() {
    try { if (typeof RIVER_DATA !== 'undefined' && Array.isArray(RIVER_DATA)) return RIVER_DATA; } catch (e) {}
    try { if (typeof RICAP_RIVERS !== 'undefined' && Array.isArray(RICAP_RIVERS)) return RICAP_RIVERS; } catch (e) {}
    if (Array.isArray(window.RIVER_DATA)) return window.RIVER_DATA;
    if (Array.isArray(window.RICAP_RIVERS)) return window.RICAP_RIVERS;
    if (Array.isArray(window.rivers)) return window.rivers;
    console.warn('RiCap: no river data found. Check the variable name in mapping-data.js');
    return [];
}
const rivers = resolveRivers();

const DEFAULT_CENTER = (typeof BATAAN_CENTER !== 'undefined') ? BATAAN_CENTER : [14.65, 120.48];
const DEFAULT_ZOOM = 10;

const COAST_LABELS = {
    east: 'Manila Bay side (east coast)',
    west: 'South China Sea side (west coast)'
};

let map = null;
let bataan = null;            // boundary helpers from bataan-mask.js, once loaded
const outsideBataan = new Set(); // river ids whose pin falls outside the province
const hiddenRivers = new Set();  // river ids switched off in the sidebar
let statuses = {};
let segments = {};            // river id -> 4 segment objects from river-lines.js
let segmentStatuses = {};     // segment id (riverId-segN) -> status, same shape as statuses
let dividerGroups = {};       // river id -> dots at the joints between segments
let segmentMarkerGroups = {}; // river id -> one numbered marker per segment
let lastReports = null;       // this month's + earlier reports, kept to place them on segments
let selectedRiver = null;     // river picked in the search (its dividers stay visible)
let suppressOverviewUntil = 0;
let markers = {};
let riverLayers = {};
let currentSearch = '';

// month being shown on the map (defaults to the current month)
const NOW = new Date();
let viewYear = NOW.getFullYear();
let viewMonth = NOW.getMonth();
let monthUnsub = null;       // Firestore listener for the current month
let monthLoadId = 0;         // ignores late answers after the user changed month
let fallbackStarted = false; // river-status.js is used only if monthly loading fails

const statusColors = {
    healthy: '#45ad91',
    moderate: '#e3b52f',
    polluted: '#db624c',
    critical: '#b93442',
    none: '#7f8792'
};

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initSidebar();
    initSearch();
    initReset();
    initMonthBar();
    loadMonth();
    startReportAlerts();
});

/* ---------------- Map ---------------- */

// Bataan bounds come from mapping-data.js (BATAAN_BOUNDS = [[south, west], [north, east]]);
// once bataan-mask.js has loaded the real boundary, its exact bounds are used instead.
const BOUNDS = (typeof BATAAN_BOUNDS !== 'undefined')
    ? L.latLngBounds(BATAAN_BOUNDS).pad(0.05)
    : null;

const FIT_OPTIONS = { padding: [24, 24] };
const MAX_ZOOM = 18;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function provinceBounds() {
    return (bataan && bataan.bounds) || BOUNDS;
}

// The whole province always fits; you can zoom out a little past that and pan a short
// way beyond the border (the mask covers the rest), but never wander off.
function lockToBataan() {
    const b = provinceBounds();
    if (!b) return;
    map.invalidateSize(true);
    const fitZoom = map.getBoundsZoom(b, false, L.point(48, 48));
    map.setMinZoom(Math.max(7, fitZoom - 0.6));
    map.setMaxBounds(b.pad(0.35));
    map.options.maxBoundsViscosity = 0.85;
}

// Full-province view. animate = smooth fly (load, Reset view, after closing a popup).
function showBataan(animate) {
    const b = provinceBounds();
    if (!b) {
        map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: !!animate });
        return;
    }
    lockToBataan();
    if (animate && !reduceMotion) map.flyToBounds(b, { ...FIT_OPTIONS, duration: 1.1 });
    else map.fitBounds(b, { ...FIT_OPTIONS, animate: false });
}

// Pins that fall outside the province are taken off the map (they would sit under the mask)
function hidePinsOutsideBataan() {
    if (!bataan) return;
    rivers.forEach(rv => {
        const marker = markers[rv.id];
        if (!marker) return;
        if (bataan.contains(marker.getLatLng())) {
            outsideBataan.delete(rv.id);
        } else {
            outsideBataan.add(rv.id);
            map.removeLayer(marker);
        }
    });
}

function initMap() {
    map = L.map('map', {
        zoomControl: true,
        attributionControl: true,
        preferCanvas: true,
        zoomSnap: 0.1,
        zoomDelta: 0.5,
        wheelPxPerZoomLevel: 90,
        maxZoom: MAX_ZOOM,
        keyboard: true,           // arrow keys pan, +/- zoom when the map has focus
        keyboardPanDelta: 120
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: MAX_ZOOM,
        keepBuffer: 4,            // keeps nearby tiles around so panning never shows blanks
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // start a little zoomed out, then fly in to the province once its outline is ready
    if (BOUNDS) {
        map.fitBounds(BOUNDS, { animate: false });
        if (!reduceMotion) map.setZoom(map.getZoom() - 1.5, { animate: false });
    } else {
        map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    }

    initPopupEvents();
    addMapLegend();

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(lockToBataan, 120);
    });

    createRiverMarkers();

    // Only Bataan is shown: solid mask outside the province, outline, municipality
    // hover labels (see bataan-mask.js)
    const maskReady = BOUNDS
        ? loadBataanMask(map, BATAAN_BOUNDS, {
            onOverview: () => { if (Date.now() >= suppressOverviewUntil) showBataan(true); }
        })
            .then(result => {
                bataan = result;
                hidePinsOutsideBataan();
                refreshJumpResults();
            })
            .catch(err => console.warn('RiCap: could not load Bataan mask', err))
        : Promise.resolve();
    maskReady.then(() => showBataan(!!BOUNDS));

    map.on('zoomend', updateDividers);

    // Real river lines from OpenStreetMap (see river-lines.js), each main channel split
    // into 4 segments that carry their own status
    maskReady
        .then(() => loadRiverLines(map, rivers, bataan ? {
            contains: p => bataan.contains(p),
            coastKm: p => bataan.distanceToEdgeKm(p)
        } : {}))
        .then(res => {
            Object.assign(riverLayers, res.byRiver);   // sidebar checkboxes now hide the real river lines too
            segments = res.segments || {};
            dividerGroups = res.dividers || {};
            segmentMarkerGroups = res.segmentMarkers || {};
            wireSegments();
            computeSegmentStatuses();
            // move each marker onto its river line (location comes from the real river geometry)
            Object.keys(res.anchors).forEach(id => {
                if (markers[id]) markers[id].setLatLng(res.anchors[id]);
            });
            hidePinsOutsideBataan();                    // re-check pins at their final spots
            // "Other waterways" on/off: a switch in the sidebar (falls back to a map control)
            const otherToggle = document.getElementById('otherWaterways');
            if (otherToggle) {
                const applyOther = () => {
                    if (otherToggle.checked) res.other.addTo(map);
                    else map.removeLayer(res.other);
                    Object.values(res.byRiver).forEach(g => { if (map.hasLayer(g)) g.bringToFront(); });
                };
                otherToggle.addEventListener('change', applyOther);
                applyOther();
            } else {
                L.control.layers(null, { 'Other waterways': res.other },
                    { position: 'bottomright', collapsed: false }).addTo(map);
            }
            updateMarkerStatuses();                     // colour the lines by status
            updateDividers();
            showFallbackPins();
        })
        .catch(err => {
            console.warn('RiCap: could not load river lines', err);
            showFallbackPins();                         // no lines at all: fall back to the river pins
        });
}

function createRiverMarkers() {
    rivers.forEach(rv => {
        if (typeof rv.lat !== 'number' || typeof rv.lng !== 'number') return;

        const marker = L.marker([rv.lat, rv.lng], {
            icon: createMarkerIcon('none'),
            title: rv.name || rv.officialName || 'River'
        });

        // bindPopup is what makes the marker clickable
        marker.bindPopup(buildRiverPopup(rv), {
            minWidth: 220,
            maxWidth: 250,
            maxHeight: 340,
            autoPan: true,
            autoPanPaddingTopLeft: [20, 80],
            autoPanPaddingBottomRight: [20, 20]
        });

        // not added to the map here: each river is shown by its 4 segment markers, and a
        // pin only appears for a river without a mapped line (see showFallbackPins)
        markers[rv.id] = marker;

        if (Array.isArray(rv.path)) {
            const points = rv.path
                .filter(p => Array.isArray(p) && p.length >= 2)
                .map(p => [p[0], p[1]]);

            if (points.length > 1) {
                const line = L.polyline(points, {
                    color: '#4d9ab8',
                    weight: 4,
                    opacity: 0.9
                });
                line.addTo(map);
                riverLayers[rv.id] = line;
            }
        }
    });

    updateMarkerStatuses();
}

// Circle colour = status; circle size and number = how many scans this month
function createMarkerIcon(status, count) {
    const safeStatus = statusColors[status] ? status : 'none';
    const color = statusColors[safeStatus];
    const n = Number(count) || 0;
    const size = Math.round(Math.min(42, 24 + Math.min(n, 8) * 2));

    return L.divIcon({
        className: '',
        html: `<div class="ricap-marker ${safeStatus}" style="background:${color};width:${size}px;height:${size}px">${n > 1 ? n : ''}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, -size / 2]
    });
}

/* ---------------- Popup ---------------- */

function initPopupEvents() {
    map.on('popupopen', event => {
        const el = event.popup.getElement();
        if (!el) return;

        const btn = el.querySelector('.river-popup-action');
        if (btn) paintRiverNotificationButton(btn, btn.dataset.riverId);

        // popup height changes once the photo finishes loading
        const img = el.querySelector('.river-popup-img');
        if (img && !img.complete) {
            img.addEventListener('load', () => event.popup.update(), { once: true });
        }

        // one delegated listener per popup container (survives content refreshes)
        if (el.dataset.bound) return;
        el.dataset.bound = '1';

        el.addEventListener('click', async e => {
            const notifBtn = e.target.closest('.river-popup-action');
            if (notifBtn) {
                const id = notifBtn.dataset.riverId;
                if (riverNotifEnabled(id)) {
                    setRiverNotification(id, false);
                } else if (await requestNotifications()) {
                    setRiverNotification(id, true);
                }
                paintRiverNotificationButton(notifBtn, id);
                return;
            }

            const fullBtn = e.target.closest('.river-popup-full');
            if (fullBtn) openFullAnalysis(fullBtn.dataset.riverId, fullBtn.dataset.segmentId);
        });
    });
}

function paintRiverNotificationButton(button, riverId) {
    const enabled = riverNotifEnabled(String(riverId));
    button.textContent = enabled ? '🔔 Notifications on' : '🔕 Enable notifications';
    button.classList.toggle('is-on', enabled);
}

function monthLabel() {
    return new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// "Last month avg 54 -> 12 worse" compared with the previous calendar month
function comparisonLine(status) {
    if (typeof status.prevAvg !== 'number' || typeof status.score !== 'number') {
        return '<p class="river-popup-trend">No reports here last month.</p>';
    }
    const diff = Math.round(status.score - status.prevAvg);
    const text = diff > 0 ? `<span class="trend-worse">&#9650; ${diff} worse</span>`
        : diff < 0 ? `<span class="trend-better">&#9660; ${Math.abs(diff)} better</span>`
        : 'no change';
    return `<p class="river-popup-trend">Last month avg <b>${Math.round(status.prevAvg)}</b> → ${text}</p>`;
}

function buildRiverPopup(rv) {
    const status = statuses[rv.id];
    const riverName = rv.name || rv.officialName || 'Unknown River';
    const id = escapeHtml(String(rv.id));

    const notifBtn = `
        <button type="button" class="river-popup-action" data-river-id="${id}">
            🔕 Enable notifications
        </button>`;

    if (!status) {
        return `
            <div class="river-popup">
                <h3 class="river-popup-title">${escapeHtml(riverName)}</h3>
                <p class="river-popup-score">No recent scan is available for this river.</p>
                ${notifBtn}
            </div>`;
    }

    const label = String(status.status || '');
    const updated = status.lastUpdated ? status.lastUpdated.toLocaleString() : '';

    return `
        <div class="river-popup">
            ${status.imageUrl
                ? `<img class="river-popup-img" src="${escapeHtml(status.imageUrl)}" alt="Latest scan of ${escapeHtml(riverName)}">`
                : ''}
            <h3 class="river-popup-title">${escapeHtml(riverName)}</h3>
            <p class="river-popup-location">
                <span class="popup-badge ${escapeHtml(label)}">${escapeHtml(label.toUpperCase())}</span>
                · ${status.score ?? '—'}/100
            </p>
            ${updated
                ? `<p class="river-popup-updated">Updated ${escapeHtml(updated)} · ${status.count} report(s) in ${escapeHtml(monthLabel())}</p>`
                : ''}
            ${comparisonLine(status)}
            <button type="button" class="river-popup-full" data-river-id="${id}">
                📋 View full analysis
            </button>
            ${notifBtn}
        </div>`;
}

function updateMarkerStatuses() {
    rivers.forEach(rv => {
        const marker = markers[rv.id];
        if (!marker) return;

        const status = statuses[rv.id];
        const currentStatus = status && status.status ? status.status : 'none';

        marker.setIcon(createMarkerIcon(currentStatus, status ? status.count : 0));
        marker.setPopupContent(buildRiverPopup(rv));

        // colour the river line by its pollution status.
        // Rivers with no report yet still show in default blue at the same prominence,
        // so everyone (not just reports with a status) can see every mapped river.
        const line = riverLayers[rv.id];
        const hasStatus = currentStatus !== 'none';
        const lineStyle = {
            color: hasStatus ? statusColors[currentStatus] : '#4d9ab8',
            weight: hasStatus ? 6 : 4,
            opacity: hasStatus ? 1 : 0.9
        };
        if (segments[rv.id]) {
            // the river line is 4 segments, each coloured by its own assessment
            segments[rv.id].forEach(seg => {
                const st = segmentStatuses[seg.id];
                seg.setColor(st && statusColors[st.status] ? statusColors[st.status] : statusColors.none);
            });
        } else if (line) {
            if (typeof line.eachLayer === 'function') {
                // real OSM river line: a featureGroup of [dark halo, status line].
                // Only recolour the layer marked statusLine so the halo stays dark.
                line.eachLayer(sub => {
                    if (sub.options && sub.options.statusLine && sub.setStyle) sub.setStyle(lineStyle);
                });
                if (hasStatus && line.bringToFront) line.bringToFront();
            } else if (line.setStyle) {
                // fallback hand-typed polyline (rv.path in mapping-data.js)
                line.setStyle(lineStyle);
            }
        }

        if (marker.isPopupOpen()) {
            const el = marker.getPopup().getElement();
            const btn = el && el.querySelector('.river-popup-action');
            if (btn) paintRiverNotificationButton(btn, btn.dataset.riverId);
        }
    });
}

/* ---------------- River segments (4 per river) ---------------- */

const SEGMENT_MATCH_KM = 1.5;   // a report counts for a segment if it was taken this close to it

function distanceToLineKm(p, coords) {
    const kx = 111.32 * Math.cos(p[0] * Math.PI / 180), ky = 110.57;
    let best = Infinity;
    for (let i = 1; i < coords.length; i++) {
        const ax = (coords[i - 1][1] - p[1]) * kx, ay = (coords[i - 1][0] - p[0]) * ky;
        const bx = (coords[i][1] - p[1]) * kx, by = (coords[i][0] - p[0]) * ky;
        const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
        const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
        best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
    return best;
}

// Which of its river's 4 segments a report belongs to, from the GPS position the scanner
// already saves with every report (lat/lng). Reports without a position, or taken far
// from the river line, still count for the river as a whole but not for a segment.
function placeReport(report) {
    const segs = segments[report.riverId];
    if (!segs) return { seg: null, why: 'river has no line' };
    // the segment the official picked in the Scanner (saved as segmentId) wins over GPS
    if (report.segmentId) {
        const chosen = segs.find(seg => seg.id === report.segmentId);
        if (chosen) return { seg: chosen.id, km: 0 };
    }
    if (typeof report.lat !== 'number' || typeof report.lng !== 'number') return { seg: null, why: 'no GPS position saved' };
    let best = null, bestD = Infinity;
    segs.forEach(seg => {
        const d = distanceToLineKm([report.lat, report.lng], seg.coords);
        if (d < bestD) { bestD = d; best = seg; }
    });
    return bestD <= SEGMENT_MATCH_KM
        ? { seg: best.id, km: bestD }
        : { seg: null, km: bestD, why: 'taken ' + bestD.toFixed(1) + ' km from the river line' };
}

function segmentIdForReport(report) {
    return placeReport(report).seg;
}

// Same averaging as the river status (aggregateReports), just grouped per segment
function computeSegmentStatuses() {
    segmentStatuses = {};
    if (!lastReports || !Object.keys(segments).length) return;
    const bySegment = list => list
        .map(rep => ({ rep, seg: segmentIdForReport(rep) }))
        .filter(x => x.seg)
        .map(x => ({ ...x.rep, riverId: x.seg }));
    const current = aggregateReports(bySegment(lastReports.sel));
    const before = aggregateReports(bySegment(lastReports.prev));
    Object.keys(current).forEach(id => {
        if (before[id]) current[id].prevAvg = before[id].score;
    });
    segmentStatuses = current;

    // one-line summary in the console, so it is easy to see why a report is not on a segment
    const unplaced = lastReports.sel.filter(rep => rep.riverId)
        .map(rep => ({ river: rep.riverId, report: rep.reportName || '', ...placeReport(rep) }))
        .filter(x => !x.seg);
    if (unplaced.length) {
        console.info('[RiCap] ' + unplaced.length + ' report(s) this month count for their river but not for a segment:');
        console.table(unplaced.map(({ river, report, why }) => ({ river, report, why })));
    }
}

function statusWord(st) {
    return st && st.status ? st.status.charAt(0).toUpperCase() + st.status.slice(1) : 'No assessment';
}

function segmentTooltip(seg) {
    const st = segmentStatuses[seg.id];
    const color = st && statusColors[st.status] ? statusColors[st.status] : statusColors.none;
    return `<strong>${escapeHtml(seg.riverName)}</strong>
        <span class="seg-tip-part">Segment ${seg.index} of 4 · ${escapeHtml(seg.name)}</span>
        <span class="seg-tip-status"><i style="background:${color}"></i>${statusWord(st)}${st && st.score != null ? ' · ' + st.score + '/100' : ''}</span>`;
}

function buildSegmentPopup(seg) {
    const st = segmentStatuses[seg.id];
    const label = st ? String(st.status || '') : '';
    const id = escapeHtml(String(seg.riverId));
    const updated = st && st.lastUpdated ? st.lastUpdated.toLocaleString() : '';
    return `
        <div class="river-popup seg-popup">
            ${st && st.imageUrl
                ? `<img class="river-popup-img" src="${escapeHtml(st.imageUrl)}" alt="Latest scan of ${escapeHtml(seg.riverName)}, segment ${seg.index}">`
                : ''}
            <h3 class="river-popup-title">${escapeHtml(seg.riverName)}</h3>
            <p class="seg-popup-part"><b class="seg-divider">${seg.index}</b> Segment ${seg.index} of 4 · ${escapeHtml(seg.name)} · ${seg.lengthKm.toFixed(1)} km</p>
            ${st
                ? `<p class="river-popup-location"><span class="popup-badge ${escapeHtml(label)}">${escapeHtml(label.toUpperCase())}</span> · ${st.score ?? '—'}/100</p>
                   <p class="river-popup-updated">Last assessed ${escapeHtml(updated)} · ${st.count} report(s) in ${escapeHtml(monthLabel())}</p>
                   ${comparisonLine(st)}
                   ${st.assessment || st.recommendation
                       ? `<button type="button" class="river-popup-full" data-river-id="${id}" data-segment-id="${escapeHtml(seg.id)}">📋 View report &amp; recommendation</button>`
                       : ''}`
                : `<p class="river-popup-score"><span class="popup-badge none">NO ASSESSMENT</span></p>
                   <p class="river-popup-updated">No scan has been reported along this part of the river in ${escapeHtml(monthLabel())}.</p>`}
            ${riverSummary(seg.riverId)}
        </div>`;
}

// The river as a whole (what the river pin's popup used to show): overall status for the
// month, the river analysis, and the river's notification switch.
function riverSummary(riverId) {
    const st = statuses[riverId];
    const id = escapeHtml(String(riverId));
    return `
        <div class="seg-popup-river">
            <p class="seg-popup-river-title">Whole river in ${escapeHtml(monthLabel())}</p>
            ${st
                ? `<p class="river-popup-location"><span class="popup-badge ${escapeHtml(st.status)}">${escapeHtml(String(st.status).toUpperCase())}</span> · ${st.score ?? '—'}/100 · ${st.count} report(s)</p>
                   <button type="button" class="river-popup-full" data-river-id="${id}">📋 River analysis</button>`
                : '<p class="river-popup-updated">No reports for this river yet.</p>'}
            <button type="button" class="river-popup-action" data-river-id="${id}">🔕 Enable notifications</button>
        </div>`;
}

function wireSegments() {
    Object.values(segments).flat().forEach(seg => {
        seg.hit.bindTooltip(() => segmentTooltip(seg), { sticky: true, className: 'seg-tooltip', direction: 'top', offset: [0, -10] });
        seg.hit.bindPopup(() => buildSegmentPopup(seg), {
            minWidth: 220,
            maxWidth: 260,
            maxHeight: 340,
            autoPanPaddingTopLeft: [20, 80],
            autoPanPaddingBottomRight: [20, 20]
        });
        seg.hit.on('mouseover', () => seg.highlight(true));
        seg.hit.on('mouseout', () => { if (!seg.hit.isPopupOpen()) seg.highlight(false); });
        seg.hit.on('popupopen', () => { seg.hit.closeTooltip(); seg.highlight(true); });
        seg.hit.on('popupclose', () => seg.highlight(false));

        seg.marker.bindTooltip(() => segmentTooltip(seg), { className: 'seg-tooltip', direction: 'top', offset: [0, -14] });
        seg.marker.bindPopup(() => buildSegmentPopup(seg), {
            minWidth: 220,
            maxWidth: 260,
            maxHeight: 340,
            autoPanPaddingTopLeft: [20, 80],
            autoPanPaddingBottomRight: [20, 20]
        });
        seg.marker.on('mouseover', () => seg.highlight(true));
        seg.marker.on('mouseout', () => { if (!seg.marker.isPopupOpen()) seg.highlight(false); });
        seg.marker.on('popupopen', () => { seg.marker.closeTooltip(); seg.highlight(true); });
        seg.marker.on('popupclose', () => seg.highlight(false));
    });
}

// numbered boundary dots: shown when zoomed in, and always for the river picked in the search
const SEGMENT_MARKER_ZOOM = 11.5;
const JOINT_DOT_ZOOM = 12.5;

function updateDividers() {
    const z = map.getZoom();
    const toggle = (group, show) => {
        if (!group) return;
        if (show && !map.hasLayer(group)) group.addTo(map);
        if (!show && map.hasLayer(group)) map.removeLayer(group);
    };
    map.getContainer().classList.toggle('seg-compact', z < SEGMENT_MARKER_ZOOM);
    Object.keys(segments).forEach(id => {
        const lineShown = riverLayers[id] && map.hasLayer(riverLayers[id]);
        const picked = String(selectedRiver) === String(id);
        toggle(segmentMarkerGroups[id], lineShown);
        toggle(dividerGroups[id], lineShown && (z >= JOINT_DOT_ZOOM || picked));
    });
}

// zoom to one river and show its 4 segments
function selectRiver(riverId) {
    const segs = segments[riverId];
    if (!segs) return;
    selectedRiver = riverId;
    suppressOverviewUntil = Date.now() + 800;   // closing an open marker popup must not fly back out
    map.closePopup();
    const bounds = L.latLngBounds([]);
    segs.forEach(seg => bounds.extend(seg.bounds));
    if (reduceMotion) map.fitBounds(bounds, { padding: [56, 56], maxZoom: 15 });
    else map.flyToBounds(bounds, { padding: [56, 56], maxZoom: 15, duration: 0.9 });
    updateDividers();
    segs.forEach(seg => seg.highlight(true));
    setTimeout(() => segs.forEach(seg => { if (!seg.hit.isPopupOpen()) seg.highlight(false); }), 1600);
}

/* ---------------- Full analysis modal ---------------- */

function openFullAnalysis(riverId, segmentId) {
    const rv = rivers.find(r => String(r.id) === String(riverId));
    const s = segmentId ? segmentStatuses[segmentId] : statuses[riverId];
    if (!rv || !s) return;
    const seg = segmentId ? (segments[riverId] || []).find(x => x.id === segmentId) : null;

    const row = (k, v) =>
        v ? `<p><strong>${k}:</strong> ${escapeHtml(String(v))}</p>` : '';

    const overlay = document.createElement('div');
    overlay.className = 'analysis-overlay';
    overlay.innerHTML = `
        <div class="analysis-modal" role="dialog" aria-modal="true">
            <button class="analysis-close" aria-label="Close">×</button>
            <h2>${escapeHtml(rv.name || rv.officialName || 'River')}${seg ? ` · Segment ${seg.index} of 4 (${escapeHtml(seg.name)})` : ''}</h2>
            ${s.imageUrl ? `<img src="${escapeHtml(s.imageUrl)}" alt="">` : ''}
            ${row('Status', s.status)}
            ${row('Score', (s.score ?? '—') + '/100')}
            ${row('Latest single scan', s.latestScore != null ? s.latestScore + '/100' : '')}
            ${row('Reports (last 30 days)', s.count)}
            ${row('Report name', s.reportName)}
            ${row('Submitted by', [s.reporterName, s.reporterRole].filter(Boolean).join(' – '))}
            ${row('Water appearance', s.waterQuality)}
            ${row('Surface', s.colorCast)}
            ${row('Texture', s.clutterReading)}
            ${row('Detection confidence', s.confidence != null ? s.confidence + '%' : '')}
            ${row('Assessment', s.assessment)}
            ${row('Recommendation', s.recommendation)}
            ${row('Last updated', s.lastUpdated && s.lastUpdated.toLocaleString())}
        </div>`;

    const close = () => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
    };
    const onKey = e => { if (e.key === 'Escape') close(); };

    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('.analysis-close').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
}

/* ---------------- Monthly data (Firestore reports) ---------------- */

function statusFromScore(score) {
    if (score > 65) return 'polluted';
    if (score > 30) return 'moderate';
    return 'healthy';
}

function docDate(d) {
    const t = d.createdAt;
    if (t && typeof t.toDate === 'function') return t.toDate();
    return t ? new Date(t) : null;
}

// Turns a list of report documents into one entry per river (same shape the popup already uses)
function aggregateReports(reports) {
    const byRiver = {};
    reports.forEach(r => {
        if (!r.riverId) return;
        (byRiver[r.riverId] = byRiver[r.riverId] || []).push(r);
    });

    const out = {};
    Object.keys(byRiver).forEach(id => {
        const list = byRiver[id].slice().sort((a, b) => docDate(b) - docDate(a));
        const latest = list[0];
        const avg = Math.round(list.reduce((sum, r) => sum + (Number(r.score) || 0), 0) / list.length);
        out[id] = {
            status: statusFromScore(avg),
            score: avg,
            latestScore: Number(latest.score),
            count: list.length,
            lastUpdated: docDate(latest),
            imageUrl: latest.imageUrl || '',
            reportName: latest.reportName || '',
            reporterName: latest.reporterName || '',
            reporterRole: latest.reporterRole || '',
            assessment: latest.assessment || '',
            recommendation: latest.recommendation || ''
        };
    });
    return out;
}

function applyReports(allReports, year, month) {
    const startSel = new Date(year, month, 1);
    const endSel = new Date(year, month + 1, 1);
    const sel = [];
    const prev = [];
    allReports.forEach(r => {
        const d = docDate(r);
        if (!d || isNaN(d.getTime())) return;
        if (d >= startSel && d < endSel) sel.push(r);
        else if (d < startSel) prev.push(r);
    });

    const current = aggregateReports(sel);
    const before = aggregateReports(prev);
    Object.keys(current).forEach(id => {
        if (before[id]) current[id].prevAvg = before[id].score;
    });

    statuses = current;
    lastReports = { sel, prev };
    computeSegmentStatuses();
    updateMarkerStatuses();
    updateSidebar();
    updateSidebarStat();
    updateMonthBar();
}

async function loadMonth() {
    const loadId = ++monthLoadId;
    if (monthUnsub) { monthUnsub(); monthUnsub = null; }

    // clear the old month straight away so stale colours never linger
    statuses = {};
    segmentStatuses = {};
    lastReports = null;
    updateMarkerStatuses();
    updateSidebar();
    updateSidebarStat();
    updateMonthBar();

    const year = viewYear;
    const month = viewMonth;
    const isCurrent = year === NOW.getFullYear() && month === NOW.getMonth();
    const windowStart = new Date(year, month - 1, 1);          // previous month is loaded too, for the comparison
    const windowEnd = new Date(year, month + 1, 1);

    try {
        await ensureAuth();
        if (loadId !== monthLoadId) return;

        const col = collection(db, 'reports');
        const constraints = [where('createdAt', '>=', Timestamp.fromDate(windowStart))];
        if (!isCurrent) constraints.push(where('createdAt', '<', Timestamp.fromDate(windowEnd)));
        const q = query(col, ...constraints);

        const handle = snap => {
            if (loadId !== monthLoadId) return;
            applyReports(snap.docs.map(d => d.data()), year, month);
        };

        if (isCurrent) {
            // live: new official reports appear on the map without a refresh
            monthUnsub = onSnapshot(q, handle, err => monthLoadFailed(err, isCurrent));
        } else {
            handle(await getDocs(q));
        }
    } catch (err) {
        monthLoadFailed(err, isCurrent);
    }
}

function monthLoadFailed(err, isCurrent) {
    console.warn('RiCap: could not load monthly reports', err);
    const sub = document.getElementById('monthSub');
    if (sub) sub.textContent = 'Could not load reports for this month';

    // safety net: the current month falls back to the original 30-day watcher
    if (isCurrent && !fallbackStarted && rivers.length) {
        fallbackStarted = true;
        watchRiverStatuses(rivers, newStatuses => {
            if (viewYear !== NOW.getFullYear() || viewMonth !== NOW.getMonth()) return;
            statuses = newStatuses || {};
            updateMarkerStatuses();
            updateSidebar();
            updateSidebarStat();
            updateMonthBar();
        });
    }
}

/* ---------------- Month bar ---------------- */

function initMonthBar() {
    const prev = document.getElementById('monthPrev');
    const next = document.getElementById('monthNext');
    if (!prev || !next) return;

    prev.addEventListener('click', () => shiftMonth(-1));
    next.addEventListener('click', () => shiftMonth(1));
    updateMonthBar();
}

function shiftMonth(delta) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    if (d > new Date(NOW.getFullYear(), NOW.getMonth(), 1)) return;   // no future months
    viewYear = d.getFullYear();
    viewMonth = d.getMonth();
    loadMonth();
}

function updateMonthBar() {
    const title = document.getElementById('monthTitle');
    const sub = document.getElementById('monthSub');
    const next = document.getElementById('monthNext');
    if (!title || !sub || !next) return;

    title.textContent = monthLabel();
    next.disabled = viewYear === NOW.getFullYear() && viewMonth === NOW.getMonth();

    const ids = Object.keys(statuses);
    if (!ids.length) {
        sub.textContent = 'No scans this month';
        return;
    }

    const counts = { healthy: 0, moderate: 0, polluted: 0 };
    let scans = 0;
    ids.forEach(id => {
        const st = statuses[id].status;
        counts[st === 'healthy' || st === 'moderate' ? st : 'polluted']++;
        scans += statuses[id].count || 0;
    });

    sub.innerHTML =
        `${ids.length} ${ids.length === 1 ? 'river' : 'rivers'} · ${scans} ${scans === 1 ? 'scan' : 'scans'} ` +
        `<span class="month-dot" style="background:${statusColors.healthy}"></span>${counts.healthy} ` +
        `<span class="month-dot" style="background:${statusColors.moderate}"></span>${counts.moderate} ` +
        `<span class="month-dot" style="background:${statusColors.polluted}"></span>${counts.polluted}`;
}

/* ---------------- Sidebar ---------------- */

function initSidebar() {
    const sidebar = document.getElementById('mapSidebar');
    const toggle = document.getElementById('sidebarToggle');

    if (toggle && sidebar) {
        toggle.addEventListener('click', () => {
            const open = sidebar.classList.toggle('open');
            toggle.setAttribute('aria-expanded', String(open));
            toggle.setAttribute('aria-label', open ? 'Hide river list' : 'Show river list');
        });
    }

    updateSidebar();
    updateSidebarStat();
}

function updateSidebar() {
    const container = document.getElementById('sidebarGroups');
    if (!container) return;

    // remember which riversare hidden so re-rendering keeps checkboxes in sync
    const groups = groupRivers(rivers);
    container.innerHTML = '';

    Object.keys(groups).forEach(groupName => {
        const group = groups[groupName];
        const visibleRivers = group.filter(rv => matchesSearch(rv));

        if (currentSearch && visibleRivers.length === 0) return;

        const section = document.createElement('section');
        section.className = 'sidebar-group';

        const header = document.createElement('div');
        header.className = 'sidebar-group-header';

        const color = document.createElement('span');
        color.className = 'sidebar-group-color';
        color.style.background = groupName.toLowerCase().includes('south china')
            ? '#7d1df2'
            : '#d4af6a';

        const title = document.createElement('span');
        title.className = 'sidebar-group-title';
        title.textContent = groupName;

        const count = document.createElement('span');
        count.className = 'sidebar-group-count';
        count.textContent = group.length;

        const arrow = document.createElement('span');
        arrow.className = 'sidebar-group-toggle';
        arrow.textContent = '▾';

        header.append(color, title, count, arrow);

        const list = document.createElement('div');
        list.className = 'sidebar-river-list';

        visibleRivers.forEach(rv => {
            const row = document.createElement('label');
            row.className = 'sidebar-river-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = !hiddenRivers.has(rv.id);
            checkbox.dataset.riverId = rv.id;
            checkbox.addEventListener('change', () => {
                setRiverVisibility(rv.id, checkbox.checked);
            });

            const name = document.createElement('span');
            name.className = 'sidebar-river-name';
            name.textContent = rv.name || rv.officialName || 'Unknown River';

            // Status written out with a small swatch, so the list can be read
            // without cross-checking a legend. No report this month -> a dash.
            const statusDot = document.createElement('span');
            statusDot.className = 'sidebar-river-status';
            const status = statuses[rv.id];
            if (status && status.status && statusColors[status.status]) {
                const word = String(status.status);
                statusDot.classList.add('has-status');
                statusDot.style.setProperty('--status-color', statusColors[word]);
                statusDot.textContent = word.charAt(0).toUpperCase() + word.slice(1);
            } else {
                statusDot.textContent = '—';
                statusDot.title = 'No reports in ' + monthLabel();
            }

            row.append(checkbox, name, statusDot);
            list.appendChild(row);
        });

        header.addEventListener('click', () => {
            const hidden = list.style.display === 'none';
            list.style.display = hidden ? '' : 'none';
            arrow.textContent = hidden ? '▾' : '▸';
        });

        section.append(header, list);
        container.appendChild(section);
    });

    buildLegend();
}

function groupRivers(list) {
    const groups = {};
    list.forEach(rv => {
        const group = rv.group || rv.side || rv.category || COAST_LABELS[rv.coast] || 'Rivers';
        (groups[group] = groups[group] || []).push(rv);
    });
    return groups;
}

function matchesSearch(rv) {
    if (!currentSearch) return true;

    const text = [rv.name, rv.officialName, rv.group, rv.side, rv.category, COAST_LABELS[rv.coast]]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    return text.includes(currentSearch.toLowerCase());
}

function setRiverVisibility(riverId, visible) {
    const line = riverLayers[riverId];
    if (visible) hiddenRivers.delete(riverId);
    else hiddenRivers.add(riverId);
    if (line) {
        if (visible) line.addTo(map);
        else map.removeLayer(line);
    }
    showFallbackPins();
    updateDividers();
}

// River pins only for rivers that have no segmented line (none today, but keeps a river
// visible if its line ever fails to load), never outside Bataan or when switched off.
function showFallbackPins() {
    rivers.forEach(rv => {
        const marker = markers[rv.id];
        if (!marker) return;
        const show = !segments[rv.id] && !outsideBataan.has(rv.id) && !hiddenRivers.has(rv.id);
        if (show && !map.hasLayer(marker)) marker.addTo(map);
        if (!show && map.hasLayer(marker)) map.removeLayer(marker);
    });
}

function initSearch() {
    const search = document.getElementById('riverSearch');
    if (!search) return;

    search.addEventListener('input', () => {
        currentSearch = search.value.trim();
        updateSidebar();
    });

    initJumpSearch(search);
}

/* ---------------- Jump-to search (rivers + municipalities) ---------------- */
// The search box still filters the sidebar list as before; it also offers a short list of
// matches to jump to with the mouse, or with Up/Down + Enter from the keyboard.

let jumpState = null;

function jumpCandidates(text) {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    const riverHits = rivers
        .filter(rv => markers[rv.id] && !outsideBataan.has(rv.id))
        .filter(rv => [rv.name, rv.officialName].filter(Boolean).join(' ').toLowerCase().includes(q))
        .map(rv => ({ kind: 'river', id: rv.id, label: rv.name || rv.officialName || 'River', status: (statuses[rv.id] || {}).status || 'none' }));
    const areaHits = (bataan ? bataan.municipalities : [])
        .filter(m => m.name.toLowerCase().includes(q))
        .map(m => ({ kind: 'municipality', id: m.name, label: m.name }));
    return [...riverHits, ...areaHits].slice(0, 8);
}

function initJumpSearch(input) {
    const list = document.getElementById('searchResults');
    if (!list) return;

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', 'searchResults');
    input.setAttribute('aria-expanded', 'false');

    jumpState = { input, list, items: [], index: -1 };

    input.addEventListener('input', refreshJumpResults);
    input.addEventListener('focus', refreshJumpResults);
    input.addEventListener('keydown', e => {
        const { items } = jumpState;
        if (e.key === 'ArrowDown' && items.length) {
            e.preventDefault();
            setJumpIndex((jumpState.index + 1) % items.length);
        } else if (e.key === 'ArrowUp' && items.length) {
            e.preventDefault();
            setJumpIndex((jumpState.index - 1 + items.length) % items.length);
        } else if (e.key === 'Enter' && items.length) {
            e.preventDefault();
            jumpTo(items[Math.max(0, jumpState.index)]);
        } else if (e.key === 'Escape') {
            closeJumpResults();
        }
    });
    input.addEventListener('blur', () => setTimeout(closeJumpResults, 150));

    // mousedown (not click) so the choice lands before the input blurs
    list.addEventListener('mousedown', e => {
        const li = e.target.closest('[data-index]');
        if (!li) return;
        e.preventDefault();
        jumpTo(jumpState.items[Number(li.dataset.index)]);
    });
}

function refreshJumpResults() {
    if (!jumpState) return;
    const { input, list } = jumpState;
    const items = document.activeElement === input ? jumpCandidates(input.value) : [];
    jumpState.items = items;
    jumpState.index = -1;

    list.innerHTML = items.map((it, i) => `
        <li id="jump-${i}" role="option" aria-selected="false" data-index="${i}" class="search-result">
            ${it.kind === 'river'
                ? `<span class="search-result-dot" style="background:${statusColors[it.status] || statusColors.none}"></span>`
                : '<span class="search-result-dot is-area"></span>'}
            <span class="search-result-name">${escapeHtml(it.label)}</span>
            <span class="search-result-kind">${it.kind === 'river' ? 'River' : 'Municipality'}</span>
        </li>`).join('');

    list.hidden = !items.length;
    input.setAttribute('aria-expanded', String(!!items.length));
    input.removeAttribute('aria-activedescendant');
}

function setJumpIndex(i) {
    const { input, list } = jumpState;
    jumpState.index = i;
    list.querySelectorAll('.search-result').forEach((li, n) => {
        li.classList.toggle('is-active', n === i);
        li.setAttribute('aria-selected', String(n === i));
    });
    input.setAttribute('aria-activedescendant', 'jump-' + i);
}

function closeJumpResults() {
    if (!jumpState) return;
    jumpState.items = [];
    jumpState.list.hidden = true;
    jumpState.input.setAttribute('aria-expanded', 'false');
    jumpState.input.removeAttribute('aria-activedescendant');
}

function jumpTo(item) {
    if (!item) return;
    closeJumpResults();

    // on phones the river panel covers the map: close it first
    const sidebar = document.getElementById('mapSidebar');
    const toggle = document.getElementById('sidebarToggle');
    if (sidebar && sidebar.classList.contains('open') && toggle && getComputedStyle(toggle).display !== 'none') {
        sidebar.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Show river list');
    }

    if (item.kind === 'river') {
        const marker = markers[item.id];
        if (!marker && !segments[item.id]) return;
        setRiverVisibility(item.id, true);
        const box = document.querySelector(`#sidebarGroups input[data-river-id="${CSS.escape(String(item.id))}"]`);
        if (box) box.checked = true;
        if (segments[item.id]) {
            selectRiver(item.id);
        } else {
            marker.openPopup();   // no river line: bataan-mask.js flies in to the marker instead
        }
    } else if (bataan) {
        map.closePopup();
        bataan.focusMunicipality(item.id, { ...FIT_OPTIONS, duration: reduceMotion ? 0.01 : 0.9 });
    }
}

/* ---------------- Map legend (phones, where the sidebar legend is tucked away) ---------------- */

function addMapLegend() {
    const control = L.control({ position: 'bottomleft' });
    control.onAdd = () => {
        const el = L.DomUtil.create('div', 'map-legend-mini');
        el.setAttribute('aria-hidden', 'true');   // the sidebar legend is the accessible one
        el.innerHTML = [['healthy', 'Healthy'], ['moderate', 'Moderate'], ['polluted', 'Polluted'], ['critical', 'Critical'], ['none', 'No assessment']]
            .map(([k, t]) => `<span><i style="background:${statusColors[k]}"></i>${t}</span>`).join('') +
            `<span class="legend-mini-segs"><b class="seg-divider">1</b>→<b class="seg-divider">4</b> Upstream to Downstream</span>`;
        L.DomEvent.disableClickPropagation(el);
        return el;
    };
    control.addTo(map);
}

function initReset() {
    const button = document.getElementById('resetView');
    if (!button) return;

    button.addEventListener('click', () => {
        selectedRiver = null;
        map.closePopup();
        showBataan(true);
        updateDividers();
    });
}

function updateSidebarStat() {
    const element = document.getElementById('sidebarStat');
    if (!element) return;

    const reportCount = Object.keys(statuses).length;
    element.textContent = `${rivers.length} rivers · ${reportCount} reported in ${monthLabel()}`;
}

function buildLegend() {
    const legend = document.getElementById('mapLegend');
    if (!legend) return;

    const items = [
        ['#45ad91', 'Healthy'],
        ['#e3b52f', 'Moderate'],
        ['#db624c', 'Polluted'],
        ['#b93442', 'Critical'],
        ['#7f8792', 'No reports / no assessment']
    ];

    legend.innerHTML = items
        .map(([c, t]) => `<div class="legend-item"><span class="legend-dot" style="background:${c}"></span> ${t}</div>`)
        .join('') +
        `<div class="legend-segments">
            <p class="legend-seg-title">Each river line has 4 parts, source to mouth</p>
            ${SEGMENT_NAMES.map((n, i) => `<span class="legend-seg"><b class="seg-divider">${i + 1}</b>${n}</span>`).join('')}
        </div>`;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}