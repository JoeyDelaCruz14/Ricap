
const BBOX = '14.33,120.02,14.97,120.66';
const ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
];
const DATA_URL = 'data/bataan-waterways.json';
const CACHE_KEY = 'ricap_waterways_v1';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ANCHOR_MODE = 'snap';
const PROXIMITY_KM = 6;
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


const RAD = Math.PI / 180;

function km(aLat, aLng, bLat, bLng) {
    const dLat = (bLat - aLat) * RAD, dLng = (bLng - aLng) * RAD;
    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
}

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


export const SEGMENT_NAMES = ['Upstream', 'Upper-Mid', 'Lower-Mid', 'Downstream'];

function pointAlong(coords, d) {
    let acc = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        const seg = km(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
        if (acc + seg >= d) {
            const t = seg ? (d - acc) / seg : 0;
            return {
                i,
                pt: [coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
                     coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t]
            };
        }
        acc += seg;
    }
    return { i: coords.length - 2, pt: coords[coords.length - 1] };
}

function splitIntoParts(coords, n) {
    const total = lineLengthKm(coords);
    const cuts = [];
    for (let k = 1; k < n; k++) cuts.push(pointAlong(coords, (total * k) / n));
    const parts = [];
    let start = { i: -1, pt: coords[0] };
    cuts.concat([{ i: coords.length - 1, pt: coords[coords.length - 1], end: true }]).forEach(cut => {
        const part = [start.pt];
        for (let v = start.i + 1; v <= cut.i && v < coords.length; v++) {
            if (!cut.end || v < coords.length - 1) part.push(coords[v]);
        }
        part.push(cut.pt);
        parts.push(part.filter((p, idx) => idx === 0 || p[0] !== part[idx - 1][0] || p[1] !== part[idx - 1][1]));
        start = cut;
    });
    return parts;
}

function buildMainStem(lines, coastKm) {
    const key = p => p[0] + ',' + p[1];
    const lens = lines.map(lineLengthKm);
    const startsAt = {};
    lines.forEach((c, i) => { (startsAt[key(c[0])] = startsAt[key(c[0])] || []).push(i); });

    const best = new Array(lines.length);
    const next = new Array(lines.length).fill(-1);
    const visiting = new Set();
    let cyclic = false;
    function walk(i) {
        if (best[i] !== undefined) return best[i];
        if (visiting.has(i)) { cyclic = true; return 0; }
        visiting.add(i);
        let tail = 0;
        (startsAt[key(lines[i][lines[i].length - 1])] || []).forEach(j => {
            if (j === i) return;
            const v = walk(j);
            if (v > tail) { tail = v; next[i] = j; }
        });
        visiting.delete(i);
        best[i] = lens[i] + tail;
        return best[i];
    }
    let head = 0;
    lines.forEach((_, i) => { if (walk(i) > walk(head)) head = i; });

    const used = [];
    let coords = [];
    for (let i = head; i >= 0 && !used.includes(i); i = next[i]) {
        used.push(i);
        coords = coords.length ? coords.concat(lines[i].slice(1)) : lines[i].slice();
    }

    let uncertain = cyclic ? 'the OSM ways loop back on themselves' : null;
    if (coastKm && coords.length > 1) {
        const src = coastKm(coords[0]), mouth = coastKm(coords[coords.length - 1]);
        if (mouth > src + 0.5) {
            coords.reverse();
            uncertain = 'OSM direction pointed inland, so the line was reversed';
        } else if (Math.abs(mouth - src) <= 0.5 && mouth > 1.5) {
            uncertain = uncertain || 'both ends are inland; kept the OSM direction';
        }
    }
    return { coords, used, uncertain, lengthKm: lineLengthKm(coords), totalKm: lens.reduce((a, b) => a + b, 0) };
}

function lineWeight(zoom) {
    return Math.max(2.5, Math.min(7, 2.5 + (zoom - 10) * 0.9));
}
const HIT_WEIGHT = 22;

function segmentIcon(index, color) {
    return L.divIcon({
        className: 'seg-marker-icon',
        html: '<span class="seg-marker" style="--seg-color:' + color + '">' + index + '</span>',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        popupAnchor: [0, -13]
    });
}
const NO_ASSESSMENT_COLOR = '#7f8792';


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

async function loadWaterwaysFile() {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (!Array.isArray(json.ways)) throw new Error('no ways in ' + DATA_URL);
    return json.ways;
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


export async function computeRiverSegments(rivers, options = {}) {
    let ways;
    try {
        ways = await loadWaterwaysFile();
    } catch (err) {
        console.warn('[RiverLines] ' + DATA_URL + ' unavailable, using Overpass', err);
        ways = readCache();
        if (!ways) {
            ways = await fetchWaterways();
            writeCache(ways);
        }
        if (options.contains) ways = ways.filter(w => w.c.some(p => options.contains(p)));
    }

    const assigned = new Array(ways.length).fill(undefined);
    const how = {};

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

    const waysOf = {};
    ways.forEach((way, i) => {
        if (assigned[i] !== undefined) (waysOf[assigned[i]] = waysOf[assigned[i]] || []).push(i);
    });
    const stems = {};
    const parts = {};
    Object.keys(waysOf).forEach(riverId => {
        stems[riverId] = buildMainStem(waysOf[riverId].map(i => ways[i].c), options.coastKm);
        if (stems[riverId].coords.length > 1) parts[riverId] = splitIntoParts(stems[riverId].coords, 4);
    });
    return { ways, assigned, how, waysOf, stems, parts };
}

export function nearestSegment(parts, riverId, lat, lng, maxKm) {
    const list = parts && parts[riverId];
    if (!list) return null;
    let best = null;
    list.forEach((coords, n) => {
        const d = nearestOnLine([lat, lng], coords).d;
        if (!best || d < best.km) best = { index: n + 1, km: d };
    });
    return best && best.km <= maxKm ? best : null;
}

export async function loadRiverLines(map, rivers, options = {}) {
    const { ways, assigned, how, waysOf, stems, parts } = await computeRiverSegments(rivers, options);

    const byRiver = {};
    const segments = {};
    const dividers = {};
    const segmentMarkers = {};
    const uncertain = [];
    const other = L.featureGroup();
    const unmatchedNames = new Set();

    ways.forEach((way, i) => {
        const riverId = assigned[i];
        if (riverId === undefined) {
            const label = (way.n && way.n[0]) || 'Unnamed waterway';
            if (way.n && way.n[0]) unmatchedNames.add(way.n[0]);
            L.polyline(way.c, {
                color: '#4d9ab8',
                weight: way.w === 'river' ? 2 : 1.2,
                opacity: 0.45
            }).bindTooltip(label, { sticky: true }).addTo(other);
        }
    });
    other.addTo(map);

    let weight = lineWeight(map.getZoom());

    Object.keys(waysOf).forEach(riverId => {
        const rv = rivers.find(x => String(x.id) === String(riverId)) || {};
        const group = byRiver[riverId] = L.featureGroup().addTo(map);
        const stem = stems[riverId];
        if (stem.uncertain) uncertain.push({ river: rv.name || riverId, why: stem.uncertain });

        waysOf[riverId].forEach((wi, k) => {
            if (stem.used.includes(k)) return;
            L.polyline(ways[wi].c, { color: '#4d9ab8', weight: 2, opacity: 0.6 })
                .bindTooltip((ways[wi].n && ways[wi].n[0]) || (rv.name || 'River') + ' (side channel)', { sticky: true })
                .addTo(group);
        });

        if (stem.coords.length < 2) return;
        segments[riverId] = parts[riverId].map((coords, n) => {
            const halo = L.polyline(coords, { color: '#0a1620', weight: weight + 4, opacity: 0.55, interactive: false }).addTo(group);
            const line = L.polyline(coords, { color: NO_ASSESSMENT_COLOR, weight, opacity: 0.95, interactive: false }).addTo(group);
            const hit = L.polyline(coords, { color: '#000', weight: HIT_WEIGHT, opacity: 0, interactive: true }).addTo(group);
            const seg = {
                id: riverId + '-seg' + (n + 1),
                riverId,
                index: n + 1,
                name: SEGMENT_NAMES[n],
                riverName: rv.name || rv.officialName || 'River',
                coords,
                lengthKm: lineLengthKm(coords),
                bounds: L.latLngBounds(coords),
                halo, line, hit,
                color: NO_ASSESSMENT_COLOR,
                highlighted: false,
                marker: L.marker(pointAlong(coords, lineLengthKm(coords) / 2).pt, {
                    icon: segmentIcon(n + 1, NO_ASSESSMENT_COLOR),
                    title: (rv.name || 'River') + ', segment ' + (n + 1) + ' of 4 (' + SEGMENT_NAMES[n] + ')',
                    keyboard: true,
                    riseOnHover: true,
                    segmentMarker: true
                }),
                setColor(c) {
                    if (c === this.color) return;
                    this.color = c;
                    this.line.setStyle({ color: c });
                    this.marker.setIcon(segmentIcon(this.index, c));
                },
                highlight(on) {
                    this.highlighted = on;
                    const w = lineWeight(map.getZoom());
                    this.line.setStyle({ weight: on ? w + 3 : w, opacity: on ? 1 : 0.95 });
                    this.halo.setStyle({ weight: (on ? w + 3 : w) + 4, opacity: on ? 0.8 : 0.55 });
                }
            };
            return seg;
        });

        segmentMarkers[riverId] = L.layerGroup(segments[riverId].map(seg => seg.marker));

        dividers[riverId] = L.layerGroup(segments[riverId].slice(1).map(seg => L.marker(seg.coords[0], {
            icon: L.divIcon({
                className: 'seg-divider-icon',
                html: '<span class="seg-joint"></span>',
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            }),
            pane: 'shadowPane',
            interactive: false,
            keyboard: false
        })));
    });
    Object.values(byRiver).forEach(g => g.bringToFront());

    map.on('zoomend', () => {
        weight = lineWeight(map.getZoom());
        Object.values(segments).flat().forEach(seg => seg.highlight(seg.highlighted));
    });

    if (uncertain.length) {
        console.info('[RiverLines] Flow direction could not be confirmed from the data for:');
        console.table(uncertain);
    }

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

    return { byRiver, other, anchors, total: ways.length, segments, dividers, segmentMarkers, uncertain };
}