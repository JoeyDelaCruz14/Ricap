// Scanner steps: access check, choosing a river and segment, and the location (GPS, photo EXIF
// or a pin on the map). Suggests a segment only under the 300 m rule in location-match.js;
// the user can always choose manually.

import { auth } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { getOfficial, hasOfficialClaim, verifyCode } from './Session.js';
import { isLocalLoggedIn } from './account.js';
import { isAdminUser } from './admin-role.js';
import { computeRiverSegments, nearestSegment, SEGMENT_NAMES } from './river-lines.js';
import { loadCoastDistance } from './bataan-mask.js';
import { matchLocation, SUGGEST_MAX_DISTANCE_M } from './location-match.js';

const FAR_KM = 3;

const state = {
    riverId: '',
    segment: 0,
    autoSelected: false,
    loc: null,
    gate: 'checking',
};

let deps = {};
let rivers = [];
let parts = null;
let geoPromise = null;
let map = null, riverLayer = null, locMarker = null;
const gateListeners = [];

const $ = id => document.getElementById(id);
const esc = s => (deps.escapeHtml ? deps.escapeHtml(s) : String(s));
// River name for an id.
const riverName = id => {
    const rv = rivers.find(r => String(r.id) === String(id));
    return rv ? (rv.name || rv.officialName || String(rv.id)) : '';
};

// Loads the river segments once.
function loadGeometry() {
    if (!geoPromise) {
        geoPromise = (async () => {
            const coastKm = await loadCoastDistance().catch(() => null);
            const geo = await computeRiverSegments(rivers, coastKm ? { coastKm } : {});
            parts = geo.parts;
            return parts;
        })();
        geoPromise.catch(err => {
            console.warn('RiCap: river segments could not be loaded', err);
            geoPromise = null;
        });
    }
    return geoPromise;
}

// Distance in km from a point to a river.
function distanceToRiverKm(riverId, lat, lng) {
    const hit = parts && nearestSegment(parts, riverId, lat, lng, Infinity);
    return hit ? hit.km : Infinity;
}

// Middle point of a line, used to centre the map.
function midpoint(coords) {
    return coords[Math.floor(coords.length / 2)];
}


// Fills the river dropdown.
function buildRiverSelect() {
    const sel = $('stepRiver');
    const groups = {};
    rivers.forEach(r => {
        const g = (deps.coastLabels && deps.coastLabels[r.coast]) || 'Rivers';
        (groups[g] = groups[g] || []).push(r);
    });
    sel.innerHTML = '<option value="">Choose a river…</option>' + Object.keys(groups).map(g =>
        `<optgroup label="${esc(g)}">` +
        groups[g].slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))
            .map(r => `<option value="${esc(String(r.id))}">${esc(r.name || r.officialName || r.id)}</option>`).join('') +
        '</optgroup>').join('');
}

// Fills the segment dropdown for the chosen river.
function buildSegmentSelect() {
    const sel = $('stepSegment');
    const hasRiver = !!state.riverId;
    const noLine = hasRiver && parts && !parts[state.riverId];
    sel.innerHTML = '<option value="">' + (hasRiver ? 'Choose a segment…' : 'Choose a river first') + '</option>' +
        SEGMENT_NAMES.map((n, i) => `<option value="${i + 1}">Segment ${i + 1} · ${esc(n)}${i === 0 ? ' (near the source)' : i === 3 ? ' (near the mouth)' : ''}</option>`).join('');
    sel.disabled = !hasRiver || noLine;
    sel.value = state.segment ? String(state.segment) : '';
    $('stepSegmentHint').textContent = noLine
        ? 'This river has no mapped line yet, so it cannot be split into segments. Choose another river or report it to an admin.'
        : 'Segments run from the source (1) to the mouth (4). Click a part of the line on the map to pick it.';
}

// Chooses a river (from the dropdown, the map or a suggestion).
function selectRiver(id, opts = {}) {
    state.autoSelected = false;
    state.riverId = id ? String(id) : '';
    if (!opts.keepSegment) state.segment = 0;
    $('stepRiver').value = state.riverId;
    buildSegmentSelect();
    drawMap(opts.fit !== false);
    renderSummary();
}

// Chooses a segment of the current river.
function selectSegment(n, opts = {}) {
    state.autoSelected = !!opts.auto;
    state.segment = Number(n) || 0;
    $('stepSegment').value = state.segment ? String(state.segment) : '';
    drawMap(false);
    renderSummary();
}

// One-line summary of the current choice.
function renderSummary() {
    const box = $('stepSummary');
    if (!box) return;
    const ok = state.riverId && state.segment;
    box.hidden = !ok;
    if (ok) {
        box.innerHTML = `<span class="step-check" aria-hidden="true">✓</span>
            <span>Reports will be saved to <strong>${esc(riverName(state.riverId))}</strong>,
            Segment ${state.segment} of 4 (${esc(SEGMENT_NAMES[state.segment - 1])}).</span>`;
    }
    renderLocationWarning();
    document.dispatchEvent(new CustomEvent('ricap:selection-change'));
}


// Creates the small selection map.
function initMap() {
    if (map || typeof L === 'undefined' || !$('segmentMap')) return;
    map = L.map('segmentMap', {
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: false,
        tap: true,
        keyboard: true
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    map.setView([14.66, 120.44], 10);
    riverLayer = L.layerGroup().addTo(map);
    map.on('focus', () => map.scrollWheelZoom.enable());
    map.on('blur', () => map.scrollWheelZoom.disable());
    map.on('click', e => pinLocation(e.latlng.lat, e.latlng.lng));
}

// Draws the river lines, highlighting the chosen segment.
function drawMap(fit) {
    if (!map || !parts) return;
    riverLayer.clearLayers();
    const selected = state.riverId && parts[state.riverId];

    Object.keys(parts).forEach(id => {
        if (id === state.riverId) return;
        parts[id].forEach(coords => {
            L.polyline(coords, { color: '#ffffff', weight: 3, opacity: 0.35, interactive: false }).addTo(riverLayer);
            L.polyline(coords, { color: '#000', weight: 18, opacity: 0, bubblingMouseEvents: false })
                .bindTooltip(esc(riverName(id)), { sticky: true, className: 'step-map-tip' })
                .on('click', () => selectRiver(id))
                .addTo(riverLayer);
        });
    });

    if (selected) {
        selected.forEach((coords, n) => {
            const on = state.segment === n + 1;
            L.polyline(coords, { color: '#0b0c10', weight: on ? 11 : 8, opacity: 0.6, interactive: false }).addTo(riverLayer);
            L.polyline(coords, { color: on ? '#c0a1ee' : '#7c3aed', weight: on ? 6 : 4, opacity: 1, interactive: false }).addTo(riverLayer);
            L.polyline(coords, { color: '#000', weight: 22, opacity: 0, bubblingMouseEvents: false })
                .bindTooltip(`Segment ${n + 1} · ${esc(SEGMENT_NAMES[n])}`, { sticky: true, className: 'step-map-tip' })
                .on('click', () => selectSegment(n + 1))
                .addTo(riverLayer);
            L.marker(midpoint(coords), {
                icon: L.divIcon({
                    className: 'step-seg-icon',
                    html: `<span class="step-seg-num${on ? ' is-on' : ''}">${n + 1}</span>`,
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                }),
                keyboard: false,
                title: `Segment ${n + 1} · ${SEGMENT_NAMES[n]}`
            }).on('click', () => selectSegment(n + 1)).addTo(riverLayer);
        });
        if (fit) {
            const b = L.latLngBounds([]);
            selected.forEach(c => b.extend(c));
            if (state.loc) b.extend([state.loc.lat, state.loc.lng]);
            map.fitBounds(b, { padding: [24, 24], maxZoom: 15 });
        }
    } else if (fit) {
        const b = L.latLngBounds([]);
        Object.values(parts).flat().forEach(c => b.extend(c));
        if (b.isValid()) map.fitBounds(b, { padding: [16, 16] });
    }
}

// Shows the report location as a draggable pin.
function showLocationOnMap() {
    if (!map) return;
    if (locMarker) { map.removeLayer(locMarker); locMarker = null; }
    if (!state.loc) return;
    const tip = state.loc.source === 'photo-exif' ? 'Where the photo was taken'
        : state.loc.source === 'manual' ? 'Your pinned location' : 'Your location';
    locMarker = L.marker([state.loc.lat, state.loc.lng], {
        draggable: true,
        keyboard: false,
        title: tip + ' (drag to adjust)',
        icon: L.divIcon({
            className: '',
            html: '<span style="display:block;width:14px;height:14px;border-radius:50%;background:#7b02ec;border:2px solid #fff;box-sizing:border-box"></span>',
            iconSize: [14, 14],
            iconAnchor: [7, 7]
        })
    }).bindTooltip(tip + ' · drag to adjust', { className: 'step-map-tip' })
        .on('dragend', e => {
            const p = e.target.getLatLng();
            pinLocation(p.lat, p.lng);
        })
        .addTo(map);
}

// Sets the location from a map click or pin drag.
function pinLocation(lat, lng) {
    const status = $('locationStatus');
    if (status) status.textContent = 'Using the spot you pinned on the map.';
    setLocation({ lat, lng, accuracy: null, source: 'manual' });
}


// Saves the location and suggests a segment if one is within 300 m.
async function setLocation(loc) {
    state.loc = loc;
    showLocationOnMap();
    const box = $('stepSuggestion');
    const where = loc.source === 'photo-exif' ? 'where this photo was taken (from the photo’s GPS data)'
        : loc.source === 'manual' ? 'the spot you pinned' : 'your location';
    const segText = s => `${esc(riverName(s.riverId))}, Segment ${s.index} (${esc(SEGMENT_NAMES[s.index - 1])})`;
    const show = (html, warn) => {
        box.className = 'step-suggestion' + (warn ? ' is-warning' : '');
        box.innerHTML = html;
        box.hidden = false;
        renderLocationWarning();
    };

    await loadGeometry().catch(() => null);
    const result = matchLocation(parts, loc, deps.inBataan);
    if (result.kind !== 'match') clearAutoSelection();

    if (result.kind === 'outside') {
        show(`<p><strong>${where.charAt(0).toUpperCase() + where.slice(1)} is outside Bataan.</strong> Nothing was selected. This location will still be saved with the report. Choose the river and segment yourself.</p>`, true);
        return;
    }

    if (result.kind === 'inaccurate') {
        show(`<p><strong>GPS accuracy is about ${Math.round(result.accuracy)} m</strong>, which is not precise enough to match a river line within ${SUGGEST_MAX_DISTANCE_M} m. Move to an open area and try again, or choose manually.</p>
            <div class="step-suggestion-actions"><button type="button" class="btn btn-solid" id="retryLocation">Try again</button></div>`, true);
        $('retryLocation').addEventListener('click', useDeviceLocation);
        return;
    }

    if (result.kind === 'none') {
        const n = result.nearest;
        show(`<p><strong>No river line within ${SUGGEST_MAX_DISTANCE_M} m of ${where}.</strong>
            ${n ? `The nearest is ${esc(riverName(n.riverId))} (${formatMeters(n.m)} away).` : ''}
            Choose the river and segment yourself if needed.</p>`, true);
        return;
    }

    if (result.kind === 'choices') {
        show(`<p><strong>Did you mean…?</strong> More than one river line is within ${SUGGEST_MAX_DISTANCE_M} m of ${where}.</p>
            <div class="step-suggestion-actions">${result.hits.map((s, i) =>
                `<button type="button" class="btn btn-outline" data-choice="${i}">${segText(s)} · ${formatMeters(s.m)}</button>`).join('')}</div>`);
        box.querySelectorAll('[data-choice]').forEach(btn => btn.addEventListener('click', () => {
            const s = result.hits[Number(btn.dataset.choice)];
            selectRiver(s.riverId, { fit: true });
            selectSegment(s.index);
            show(`<p class="step-suggestion-ok">Saved to ${segText(s)}. You can still change it.</p>`);
        }));
        return;
    }

    const hit = result.hit;
    if (hit.riverId !== state.riverId || hit.index !== state.segment) {
        selectRiver(hit.riverId, { fit: true });
        selectSegment(hit.index, { auto: true });
    }
    show(`<p><strong>Selected automatically:</strong> ${segText(hit)}
        <span class="step-suggestion-km">${formatMeters(hit.m)} from ${where}. You can still change it.</span></p>`);
}

// Distance as "15 m" or "1.2 km".
function formatMeters(m) {
    return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km';
}

// Forgets that the current choice was suggested automatically.
function clearAutoSelection() {
    if (state.autoSelected) selectRiver('', { fit: false });
}

// Warning when the location is far from the chosen river.
function renderLocationWarning() {
    const el = $('stepLocationWarning');
    if (!el) return;
    el.hidden = true;
    if (!state.loc || !state.riverId || !parts || !parts[state.riverId]) return;
    const km = distanceToRiverKm(state.riverId, state.loc.lat, state.loc.lng);
    if (km > FAR_KM) {
        el.textContent = `Heads up: the photo location is ${km.toFixed(1)} km from ${riverName(state.riverId)}. Check that you chose the right river.`;
        el.hidden = false;
    }
}

// Gets the location from the device GPS.
async function useDeviceLocation() {
    const btn = $('useLocationBtn');
    const status = $('locationStatus');
    btn.disabled = true;
    status.textContent = 'Getting your location…';
    try {
        const loc = await deps.getUserLocation();
        status.textContent = loc.accuracy ? `Location found (±${Math.round(loc.accuracy)} m).` : 'Location found.';
        await setLocation({ lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy || null, source: 'gps' });
    } catch (err) {
        clearAutoSelection();
        $('stepSuggestion').hidden = true;
        status.textContent = (err && err.message) || 'Could not get your location. Choose the river and segment yourself.';
    } finally {
        btn.disabled = false;
    }
}


// Reads the GPS position stored in a photo, if any.
async function readExifGps(file) {
    if (!file || file.type !== 'image/jpeg') return null;
    const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off + 10 < v.byteLength) {
        const marker = v.getUint16(off);
        if ((marker & 0xFF00) !== 0xFF00) break;
        const size = v.getUint16(off + 2);
        if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) return parseGps(v, off + 10);
        off += 2 + size;
    }
    return null;
}

// Converts an EXIF GPS value to decimal degrees.
function parseGps(v, t) {
    try {
        const le = v.getUint16(t) === 0x4949;
        const u16 = o => v.getUint16(t + o, le);
        const u32 = o => v.getUint32(t + o, le);
        const ifd0 = u32(4);
        let gps = 0;
        for (let i = 0, n = u16(ifd0); i < n; i++) {
            const e = ifd0 + 2 + i * 12;
            if (u16(e) === 0x8825) gps = u32(e + 8);
        }
        if (!gps) return null;
        const tags = {};
        for (let i = 0, n = u16(gps); i < n; i++) {
            const e = gps + 2 + i * 12, tag = u16(e), type = u16(e + 2), count = u32(e + 4);
            if (type === 2) tags[tag] = String.fromCharCode(v.getUint8(t + e + 8));
            else if (type === 5 && count === 3) {
                const p = u32(e + 8);
                tags[tag] = [0, 1, 2].map(k => u32(p + k * 8) / (u32(p + k * 8 + 4) || 1));
            }
        }
        const dms = a => a && a[0] + a[1] / 60 + a[2] / 3600;
        const lat = dms(tags[2]), lng = dms(tags[4]);
        if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return null;
        return { lat: tags[1] === 'S' ? -lat : lat, lng: tags[3] === 'W' ? -lng : lng };
    } catch (e) {
        return null;
    }
}

// Called when a photo is chosen: uses its GPS position if it has one.
export async function onImageFile(file) {
    const gps = await readExifGps(file).catch(() => null);
    if (gps) await setLocation({ lat: gps.lat, lng: gps.lng, accuracy: null, source: 'photo-exif' });
}


// The chosen river, segment and location, or an error message.
export function getSelection() {
    if (!state.riverId) return { ok: false, error: 'Choose the river in step 1.' };
    if (!state.segment) return { ok: false, error: 'Choose which segment of the river (1 to 4) in step 1.' };
    if (!parts || !parts[state.riverId]) return { ok: false, error: 'This river has no mapped segments yet. Choose another river.' };

    const coords = parts[state.riverId][state.segment - 1];
    const warnings = [];
    let loc = null;
    if (state.loc) {
        const outside = deps.inBataan && !deps.inBataan(state.loc.lat, state.loc.lng);
        const hit = nearestSegment(parts, state.riverId, state.loc.lat, state.loc.lng, Infinity);
        if (outside) warnings.push('The report location is outside Bataan.');
        else if (hit && hit.km > FAR_KM) warnings.push(`The report location is ${hit.km.toFixed(1)} km from ${riverName(state.riverId)}.`);
        loc = { ...state.loc };
    }
    if (!loc) {
        const mid = midpoint(coords);
        loc = { lat: mid[0], lng: mid[1], accuracy: null, source: 'segment-selected' };
    }
    return {
        ok: true,
        riverId: state.riverId,
        segmentIndex: state.segment,
        segmentId: state.riverId + '-seg' + state.segment,
        segmentName: SEGMENT_NAMES[state.segment - 1],
        label: `${riverName(state.riverId)} · Segment ${state.segment} of 4 (${SEGMENT_NAMES[state.segment - 1]})`,
        loc,
        warnings
    };
}


// True once the user may submit official reports.
export function isGateVerified() { return state.gate === 'verified'; }
// Registers a callback for access changes.
export function onGateChange(fn) { gateListeners.push(fn); }

let gateRun = null;
// Re-checks whether the user may submit official reports.
export function refreshGate() {
    if (!gateRun) gateRun = runGate().finally(() => { gateRun = null; });
    return gateRun;
}

// Checks the access state: official session, claim or logged-in account.
async function runGate() {
    const official = getOfficial();
    const user = auth.currentUser;
    const loggedIn = isLocalLoggedIn() || !!(user && !user.isAnonymous) || !!official;

    let gate = 'guest';
    if (loggedIn) gate = 'unverified';
    // Admins can use the scanner straight away, without an access code.
    const isAdmin = await isAdminUser(user);
    if (isAdmin) {
        gate = 'verified';
    } else if (official) {
        let ok = await hasOfficialClaim();
        if (!ok && official.code) {
            try { const o = await verifyCode(official.code); ok = (await hasOfficialClaim()) || !!o.legacy; }
            catch (e) { ok = false; }
        }
        gate = ok ? 'verified' : 'unverified';
        if (!ok) try { localStorage.removeItem('ricap_official'); } catch (e) {  }
    }

    state.gate = gate;
    document.body.dataset.gate = gate;
    $('gateChecking').hidden = true;
    $('gateGuest').hidden = gate !== 'guest';
    $('verifyBanner').hidden = gate !== 'unverified';
    $('verifiedBar').hidden = gate !== 'verified';
    const name = $('verifiedName');
    if (name && gate === 'verified') {
        name.textContent = isAdmin && !getOfficial()
            ? ((user && user.displayName) || 'RiCap Admin') + ' (admin)'
            : (getOfficial() || {}).name || 'Verified Official';
    }
    // "not you?" only ends an access-code session, so it is hidden for admins without one.
    const notYou = $('signOutBtn');
    if (notYou) notYou.hidden = isAdmin && !getOfficial();

    const steps = $('scanSteps');
    steps.hidden = gate === 'guest';
    steps.inert = gate !== 'verified';
    steps.classList.toggle('is-locked', gate !== 'verified');
    if (!steps.hidden && map) requestAnimationFrame(() => { map.invalidateSize(); drawMap(true); });
    $('gateCard').classList.toggle('is-verified', gate === 'verified');

    gateListeners.forEach(fn => fn(gate));
    return gate;
}


// Entry point, called by Image_Processing.js with shared helpers.
export function initSteps(options) {
    deps = options || {};
    rivers = deps.rivers || [];

    buildRiverSelect();
    buildSegmentSelect();
    $('stepRiver').addEventListener('change', e => selectRiver(e.target.value));
    $('stepSegment').addEventListener('change', e => selectSegment(e.target.value));
    $('useLocationBtn').addEventListener('click', useDeviceLocation);

    initMap();
    loadGeometry()
        .then(() => { buildSegmentSelect(); drawMap(true); showLocationOnMap(); })
        .catch(() => {
            $('stepSegmentHint').textContent = 'The river map could not load. Check your connection and reload the page.';
        });

    onAuthStateChanged(auth, () => { refreshGate(); });
    refreshGate();
}
