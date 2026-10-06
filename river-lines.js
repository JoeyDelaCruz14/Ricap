// river-lines.js
// Loads real river/stream geometry for Bataan from OpenStreetMap (the same data
// waterwaymap.org displays) via the Overpass API, and draws it on the Leaflet map.
//
//  1. Waterways whose NAME matches a river in RIVER_DATA are grouped per river.
//  2. A river with no name match falls back to PROXIMITY: the nearest waterway within
//     PROXIMITY_KM of its marker (plus the connected segments) is adopted.
//  3. Each matched river gets an ANCHOR point ON its line; mapping.js moves the marker there,
//     so locations come from the real river geometry instead of hand-typed coordinates.
//  4. mapping.js colours each river's lines by pollution status (healthy/moderate/polluted/critical).
//
// Optional per-river hint in mapping-data.js:  osmNames: ["Ilog Balanga"]

const BBOX = '14.33,120.02,14.97,120.66'; // south,west,north,east (Bataan)
const ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
];
const CACHE_KEY = 'ricap_waterways_v1';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Where the marker sits on the river line:
//   'snap'  = closest point on the line to the coordinates in mapping-data.js (default)
//   'mid'   = middle of the river's longest segment
//   'mouth' = downstream end of the longest segment (OSM ways run downstream)
const ANCHOR_MODE = 'snap';
const PROXIMITY_KM = 3;
const MAX_FLOOD_WAYS = 150;

const QUERY =
    '[out:json][timeout:90];(' +
    'way["waterway"="river"](' + BBOX + ');' +
    'way["waterway"="stream"]["name"](' + BBOX + ');' +
    ');out geom tags;';

const STRIP_WORDS = /\b(river|ilog|rio|sapa|creek|stream|ng|ang)\b/g;

function norm(name) {
    return String(name || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(STRIP_WORDS, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/* ---------- geometry helpers ---------- */

const RAD = Math.PI / 180;

function km(aLat, aLng, bLat, bLng) {
    const dLat = (bLat - aLat) * RAD, dLng = (bLng - aLng) * RAD;
    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
}

// closest point on segment a-b to p (local planar approximation, fine at this scale)
function nearestOnSegment(p, a, b) {
    const k = Math.cos(p[0] * RAD);
    const ax = a[1] * k, ay = a[0], bx = b[1] * k, by = b[0], px = p[1] * k, py = p[0];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function nearestOnLine(p, coords) {
    let best = null, bestD = Infinity;
    for (let i = 0; i < coords.length - 1; i++) {
        const q = nearestOnSegment(p, coords[i], coords[i + 1]);
        const d = km(p[0], p[1], q[0], q[1]);
        if (d < bestD) { bestD = d; best = q; }
    }
    return { pt: best, d: bestD };
}

function lineLengthKm(coords) {
    let s = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        s += km(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
    }
    return s;
}

function lineMidpoint(coords) {
    const half = lineLengthKm(coords) / 2;
    let acc = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        const seg = km(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
        if (acc + seg >= half) {
            const t = seg ? (half - acc) / seg : 0;
            return [
                coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
                coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t
            ];
        }
        acc += seg;
    }
    return coords[Math.floor(coords.length / 2)];
}

/* ---------- data loading ---------- */

function readCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const c = JSON.parse(raw);
        if (!c || Date.now() - c.t > CACHE_TTL_MS || !Array.isArray(c.ways)) return null;
        return c.ways;
    } catch (e) { return null; }
}

function writeCache(ways) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), ways })); }
    catch (e) { console.warn('[RiverLines] could not cache waterways (storage full?)'); }
}

async function fetchWaterways() {
    let lastErr = null;
    for (const url of ENDPOINTS) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'data=' + encodeURIComponent(QUERY)
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const json = await res.json();
            // Compact: [{ n: names[], w: waterwayType, c: [[lat,lng],...] }]
            return (json.elements || [])
                .filter(el => el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length > 1)
                .map(el => {
                    const t = el.tags || {};
                    return {
                        n: [t.name, t['name:en'], t.alt_name, t.official_name].filter(Boolean),
                        w: t.waterway,
                        c: el.geometry.map(p => [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5])
                    };
                });
        } catch (e) {
            console.warn('[RiverLines] Overpass failed at', url, e);
            lastErr = e;
        }
    }
    throw lastErr || new Error('Overpass unavailable');
}

/* ---------- main ---------- */

export async function loadRiverLines(map, rivers) {
    let ways = readCache();
    if (!ways) {
        ways = await fetchWaterways();
        writeCache(ways);
    }

    const assigned = new Array(ways.length).fill(undefined); // way index -> river id
    const how = {};                                           // river id -> 'name' | 'proximity'

    // ---- 1) match by name ----
    const lookup = {};
    rivers.forEach(rv => {
        [rv.name, rv.officialName].concat(rv.osmNames || []).filter(Boolean).forEach(n => {
            const k = norm(n);
            if (k) lookup[k] = rv.id;
        });
    });
    ways.forEach((way, i) => {
        const id = (way.n || []).map(n => lookup[norm(n)]).find(v => v !== undefined);
        if (id !== undefined) { assigned[i] = id; how[id] = 'name'; }
    });

    // ---- 2) proximity fallback for rivers with no name match ----
    const endpointIndex = {};
    const key = p => p[0] + ',' + p[1];
    ways.forEach((way, i) => {
        [way.c[0], way.c[way.c.length - 1]].forEach(p => {
            (endpointIndex[key(p)] = endpointIndex[key(p)] || []).push(i);
        });
    });

    rivers.filter(rv => how[rv.id] === undefined && typeof rv.lat === 'number').forEach(rv => {
        let seed = -1, seedD = Infinity;
        ways.forEach((way, i) => {
            if (assigned[i] !== undefined) return;
            const d = nearestOnLine([rv.lat, rv.lng], way.c).d;
            if (d < seedD) { seedD = d; seed = i; }
        });
        if (seed < 0 || seedD > PROXIMITY_KM) return;

        const seedName = norm((ways[seed].n || [])[0]);
        const queue = [seed];
        const taken = new Set([seed]);
        while (queue.length && taken.size < MAX_FLOOD_WAYS) {
            const cur = queue.shift();
            [ways[cur].c[0], ways[cur].c[ways[cur].c.length - 1]].forEach(p => {
                (endpointIndex[key(p)] || []).forEach(j => {
                    if (taken.has(j) || assigned[j] !== undefined) return;
                    const nm = norm((ways[j].n || [])[0]);
                    if (seedName ? nm === seedName : !nm) { taken.add(j); queue.push(j); }
                });
            });
        }
        taken.forEach(i => { assigned[i] = rv.id; });
        how[rv.id] = 'proximity';
    });

    // ---- 3) draw ----
    const byRiver = {};
    const other = L.featureGroup();
    const unmatchedNames = new Set();

    ways.forEach((way, i) => {
        const label = (way.n && way.n[0]) || 'Unnamed waterway';
        const riverId = assigned[i];
        if (riverId !== undefined) {
            if (!byRiver[riverId]) byRiver[riverId] = L.featureGroup().addTo(map);
            L.polyline(way.c, { color: '#4d9ab8', weight: 4.5, opacity: 0.95 })
                .bindTooltip(label, { sticky: true })
                .addTo(byRiver[riverId]);
        } else {
            if (way.n && way.n[0]) unmatchedNames.add(way.n[0]);
            L.polyline(way.c, {
                color: '#4d9ab8',
                weight: way.w === 'river' ? 2 : 1.2,
                opacity: 0.45
            }).bindTooltip(label, { sticky: true }).addTo(other);
        }
    });
    other.addTo(map);
    Object.values(byRiver).forEach(g => g.bringToFront());

    // ---- 4) anchor points on the real lines ----
    const anchors = {};
    const table = [];
    rivers.forEach(rv => {
        const idxs = assigned.map((id, i) => (id === rv.id ? i : -1)).filter(i => i >= 0);
        if (!idxs.length) return;

        let pt;
        if (ANCHOR_MODE === 'snap' && typeof rv.lat === 'number') {
            let bestD = Infinity;
            idxs.forEach(i => {
                const r = nearestOnLine([rv.lat, rv.lng], ways[i].c);
                if (r.d < bestD) { bestD = r.d; pt = r.pt; }
            });
        } else {
            const longest = idxs.reduce((a, b) => (lineLengthKm(ways[b].c) > lineLengthKm(ways[a].c) ? b : a));
            pt = ANCHOR_MODE === 'mouth'
                ? ways[longest].c[ways[longest].c.length - 1]
                : lineMidpoint(ways[longest].c);
        }
        if (!pt) return;

        anchors[rv.id] = [Math.round(pt[0] * 1e5) / 1e5, Math.round(pt[1] * 1e5) / 1e5];
        table.push({
            river: rv.name,
            matched: how[rv.id],
            oldLat: rv.lat, oldLng: rv.lng,
            newLat: anchors[rv.id][0], newLng: anchors[rv.id][1],
            movedKm: typeof rv.lat === 'number' ? +km(rv.lat, rv.lng, pt[0], pt[1]).toFixed(2) : null
        });
    });
    if (table.length) {
        console.info('[RiverLines] Marker locations taken from the river lines (copy into mapping-data.js if you want them permanent):');
        console.table(table);
    }

    const missing = rivers.filter(rv => !byRiver[rv.id]).map(rv => rv.name);
    if (missing.length) {
        console.info('[RiverLines] No line found for:', missing.join(', '),
            '\nAdd an "osmNames" array to those rivers in mapping-data.js. OSM names seen:',
            Array.from(unmatchedNames).sort());
    }

    return { byRiver, other, anchors, total: ways.length };
}