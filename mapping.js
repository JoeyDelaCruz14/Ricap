import { watchRiverStatuses } from './river-status.js';
import {
    requestNotifications,
    riverNotifEnabled,
    setRiverNotification,
    startReportAlerts
} from './Notify.js';
import { loadRiverLines } from './river-lines.js';

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
let statuses = {};
let markers = {};
let riverLayers = {};
let currentSearch = '';

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
    startRiverStatusWatcher();
    startReportAlerts();
});

/* ---------------- Map ---------------- */

// Bataan bounds come from mapping-data.js (BATAAN_BOUNDS = [[south, west], [north, east]])
const BOUNDS = (typeof BATAAN_BOUNDS !== 'undefined')
    ? L.latLngBounds(BATAAN_BOUNDS).pad(0.05)
    : null;

// Zoom level at which Bataan completely fills the screen, so the view can never show anything outside it
function bataanMinZoom() {
    return map.getBoundsZoom(BOUNDS, true);
}

function lockToBataan() {
    if (!BOUNDS) return;
    map.invalidateSize(true);
    const minZoom = bataanMinZoom();
    map.setMinZoom(minZoom);
    if (map.getZoom() < minZoom) map.setZoom(minZoom, { animate: false });
    map.panInsideBounds(BOUNDS, { animate: false });
}

function showBataan(animate) {
    if (!BOUNDS) {
        map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: !!animate });
        return;
    }
    map.invalidateSize(true);
    const minZoom = bataanMinZoom();
    map.setMinZoom(minZoom);
    map.setView(BOUNDS.getCenter(), minZoom, { animate: !!animate });
}

function initMap() {
    map = L.map('map', {
        zoomControl: true,
        attributionControl: true,
        preferCanvas: true,
        zoomSnap: 0.1,
        maxBounds: BOUNDS || undefined,
        maxBoundsViscosity: 1.0   // hard wall: dragging past the edge is not possible
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    showBataan(false);

    initPopupEvents();

    setTimeout(() => showBataan(false), 150);
    window.addEventListener('resize', lockToBataan);

    createRiverMarkers();

    // Real river lines from OpenStreetMap (see river-lines.js)
    loadRiverLines(map, rivers)
        .then(res => {
            Object.assign(riverLayers, res.byRiver);   // sidebar checkboxes now hide the real river lines too
            // move each marker onto its river line (location comes from the real river geometry)
            Object.keys(res.anchors).forEach(id => {
                if (markers[id]) markers[id].setLatLng(res.anchors[id]);
            });
            L.control.layers(null, { 'Other waterways': res.other },
                { position: 'bottomright', collapsed: false }).addTo(map);
            updateMarkerStatuses();                     // colour the lines by status
        })
        .catch(err => console.warn('RiCap: could not load river lines', err));
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

        marker.addTo(map);
        markers[rv.id] = marker;

        if (Array.isArray(rv.path)) {
            const points = rv.path
                .filter(p => Array.isArray(p) && p.length >= 2)
                .map(p => [p[0], p[1]]);

            if (points.length > 1) {
                const line = L.polyline(points, {
                    color: '#4d9ab8',
                    weight: 3,
                    opacity: 0.65
                });
                line.addTo(map);
                riverLayers[rv.id] = line;
            }
        }
    });

    updateMarkerStatuses();
}

function createMarkerIcon(status) {
    const safeStatus = statusColors[status] ? status : 'none';
    const color = statusColors[safeStatus];

    return L.divIcon({
        className: '',
        html: `<div class="ricap-marker ${safeStatus}" style="background:${color}">●</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
        popupAnchor: [0, -17]
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
            if (fullBtn) openFullAnalysis(fullBtn.dataset.riverId);
        });
    });
}

function paintRiverNotificationButton(button, riverId) {
    const enabled = riverNotifEnabled(String(riverId));
    button.textContent = enabled ? '🔔 Notifications on' : '🔕 Enable notifications';
    button.classList.toggle('is-on', enabled);
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
                ? `<p class="river-popup-updated">Updated ${escapeHtml(updated)} · ${status.count} report(s)</p>`
                : ''}
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

        marker.setIcon(createMarkerIcon(currentStatus));
        marker.setPopupContent(buildRiverPopup(rv));

        // colour the river line by its pollution status
        const line = riverLayers[rv.id];
        if (line && line.setStyle) {
            line.setStyle({ color: currentStatus === 'none' ? '#4d9ab8' : statusColors[currentStatus] });
        }

        if (marker.isPopupOpen()) {
            const el = marker.getPopup().getElement();
            const btn = el && el.querySelector('.river-popup-action');
            if (btn) paintRiverNotificationButton(btn, btn.dataset.riverId);
        }
    });
}

/* ---------------- Full analysis modal ---------------- */

function openFullAnalysis(riverId) {
    const rv = rivers.find(r => String(r.id) === String(riverId));
    const s = statuses[riverId];
    if (!rv || !s) return;

    const row = (k, v) =>
        v ? `<p><strong>${k}:</strong> ${escapeHtml(String(v))}</p>` : '';

    const overlay = document.createElement('div');
    overlay.className = 'analysis-overlay';
    overlay.innerHTML = `
        <div class="analysis-modal" role="dialog" aria-modal="true">
            <button class="analysis-close" aria-label="Close">×</button>
            <h2>${escapeHtml(rv.name || rv.officialName || 'River')}</h2>
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

/* ---------------- Status watcher ---------------- */

function startRiverStatusWatcher() {
    if (!rivers.length) {
        updateSidebarStat();
        return;
    }

    watchRiverStatuses(rivers, newStatuses => {
        statuses = newStatuses || {};
        updateMarkerStatuses();
        updateSidebar();
        updateSidebarStat();
    });
}

/* ---------------- Sidebar ---------------- */

function initSidebar() {
    const sidebar = document.getElementById('mapSidebar');
    const toggle = document.getElementById('sidebarToggle');

    if (toggle && sidebar) {
        toggle.addEventListener('click', () => {
            const open = sidebar.classList.toggle('open');
            toggle.setAttribute('aria-expanded', String(open));
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
            checkbox.checked = markers[rv.id] ? map.hasLayer(markers[rv.id]) : true;
            checkbox.dataset.riverId = rv.id;
            checkbox.addEventListener('change', () => {
                setRiverVisibility(rv.id, checkbox.checked);
            });

            const name = document.createElement('span');
            name.className = 'sidebar-river-name';
            name.textContent = rv.name || rv.officialName || 'Unknown River';

            const statusDot = document.createElement('span');
            statusDot.className = 'sidebar-river-status';
            const status = statuses[rv.id];
            if (status && status.status && statusColors[status.status]) {
                statusDot.style.background = statusColors[status.status];
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
    const marker = markers[riverId];
    const line = riverLayers[riverId];

    [marker, line].forEach(layer => {
        if (!layer) return;
        if (visible) layer.addTo(map);
        else map.removeLayer(layer);
    });
}

function initSearch() {
    const search = document.getElementById('riverSearch');
    if (!search) return;

    search.addEventListener('input', () => {
        currentSearch = search.value.trim();
        updateSidebar();
    });
}

function initReset() {
    const button = document.getElementById('resetView');
    if (!button) return;

    button.addEventListener('click', () => {
        showBataan(true);
    });
}

function updateSidebarStat() {
    const element = document.getElementById('sidebarStat');
    if (!element) return;

    const reportCount = Object.keys(statuses).length;
    element.textContent = `${rivers.length} rivers mapped · ${reportCount} with recent reports (live)`;
}

function buildLegend() {
    const legend = document.getElementById('mapLegend');
    if (!legend) return;

    const items = [
        ['#45ad91', 'Healthy'],
        ['#e3b52f', 'Moderate'],
        ['#db624c', 'Polluted'],
        ['#b93442', 'Critical'],
        ['#7f8792', 'No reports yet']
    ];

    legend.innerHTML = items
        .map(([c, t]) => `<div class="legend-item"><span class="legend-dot" style="background:${c}"></span> ${t}</div>`)
        .join('');
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}