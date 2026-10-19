// Map mask that darkens everything outside Bataan and outlines its municipalities.
// Boundary comes from data/bataan-boundaries.geojson, falling back to Nominatim (cached 30 days).
// Also used by the scanner to measure how far a point is from the coast.
// Sa madaling salita: pinapadilim nito ang mapa sa labas ng Bataan para kita agad ang mga bayan nito.


const BOUNDARY_URL = 'data/bataan-boundaries.geojson';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const CACHE_KEY = 'ricap_bataan_boundary_v2';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const MASK_COLOR = '#0b0c10';
const OUTLINE_COLOR = '#8c3cf0';
const AREA_LINE_COLOR = '#111318';

const EDGE_TOLERANCE_KM = 1;


// Boundary cached in localStorage, if still fresh.
function readCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const c = JSON.parse(raw);
        if (!c || Date.now() - c.t > CACHE_TTL_MS || !Array.isArray(c.rings)) return null;
        return c.rings;
    } catch (e) { return null; }
}

// Caches the boundary in localStorage.
function writeCache(rings) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), rings })); }
    catch (e) {  }
}

// Converts GeoJSON (Multi)Polygon coordinates to Leaflet [lat, lng] rings.
function toLatLngPolygons(geometry) {
    const polys = geometry.type === 'Polygon' ? [geometry.coordinates]
        : geometry.type === 'MultiPolygon' ? geometry.coordinates
        : [];
    return polys.map(poly => poly.map(ring => ring.map(([lng, lat]) => [lat, lng])));
}

// Loads the bundled boundary file.
async function loadBoundaryFile() {
    const res = await fetch(BOUNDARY_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const fc = await res.json();
    const province = fc.features.find(f => f.properties && f.properties.kind === 'province');
    if (!province) throw new Error('no province feature');
    return {
        province: toLatLngPolygons(province.geometry),
        municipalities: fc.features
            .filter(f => f.properties && f.properties.kind === 'municipality')
            .map(f => ({ name: f.properties.name, polygons: toLatLngPolygons(f.geometry) }))
            .sort((a, b) => a.name.localeCompare(b.name))
    };
}

// Downloads the province boundary from OpenStreetMap Nominatim.
async function loadBoundaryFromNominatim(bounds) {
    let rings = readCache();
    if (!rings) {
        const [[south, west], [north, east]] = bounds;
        const params = new URLSearchParams({
            q: 'Bataan, Philippines', format: 'jsonv2', polygon_geojson: '1',
            polygon_threshold: '0.0004', countrycodes: 'ph', bounded: '1',
            viewbox: `${west},${north},${east},${south}`, limit: '1'
        });
        const res = await fetch(NOMINATIM_URL + '?' + params.toString());
        if (!res.ok) throw new Error('Nominatim HTTP ' + res.status);
        const results = await res.json();
        if (!results.length || !results[0].geojson) throw new Error('Bataan boundary not found');
        rings = toLatLngPolygons(results[0].geojson).flat();
        writeCache(rings);
    }
    return { province: rings.map(r => [r]), municipalities: [] };
}


// Point-in-polygon test for one ring.
function ringContains(ring, lat, lng) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [yi, xi] = ring[i], [yj, xj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

// True if the point is inside any of the polygons.
function polygonsContain(polygons, lat, lng) {
    let inside = false;
    polygons.forEach(poly => poly.forEach(ring => { if (ringContains(ring, lat, lng)) inside = !inside; }));
    return inside;
}

// Distance in km from a point to the nearest boundary edge.
function distanceToEdgesKm(polygons, lat, lng) {
    const kx = 111.32 * Math.cos(lat * Math.PI / 180), ky = 110.57;
    let best = Infinity;
    polygons.forEach(poly => poly.forEach(ring => {
        for (let i = 1; i < ring.length; i++) {
            const ax = (ring[i - 1][1] - lng) * kx, ay = (ring[i - 1][0] - lat) * ky;
            const bx = (ring[i][1] - lng) * kx, by = (ring[i][0] - lat) * ky;
            const dx = bx - ax, dy = by - ay;
            const len = dx * dx + dy * dy;
            const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
            const px = ax + t * dx, py = ay + t * dy;
            best = Math.min(best, Math.sqrt(px * px + py * py));
        }
    }));
    return best;
}

// Returns a function (lat, lng) -> km to the coast, used by the scanner.
export async function loadCoastDistance() {
    const data = await loadBoundaryFile();
    return p => {
        const lat = Array.isArray(p) ? p[0] : p.lat, lng = Array.isArray(p) ? p[1] : p.lng;
        return distanceToEdgesKm(data.province, lat, lng);
    };
}


// Adds the CSS for the mask, outlines and marker animations once.
function injectStyles() {
    if (document.getElementById('ricap-mask-styles')) return;
    const style = document.createElement('style');
    style.id = 'ricap-mask-styles';
    style.textContent = `
        .leaflet-tooltip.ricap-area-label {
            padding: 4px 10px;
            border: 1px solid #252931;
            border-radius: 999px;
            background: rgba(17, 19, 24, 0.92);
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
            color: #e6e8ec;
            font: 600 12px/1.3 var(--font);
            letter-spacing: 0.01em;
            white-space: nowrap;
            pointer-events: none;
        }
        .leaflet-tooltip.ricap-area-label::before { display: none; }

        .ricap-marker {
            transition: transform .18s cubic-bezier(.34, 1.56, .64, 1), box-shadow .18s ease;
            cursor: pointer;
        }
        .ricap-marker:hover,
        .ricap-marker.ricap-active {
            transform: scale(1.18);
            box-shadow: 0 0 0 7px rgba(255,255,255,.16);
        }
        @keyframes ricapMarkerPulse {
            0%   { box-shadow: 0 0 0 0 rgba(255,255,255,.55); }
            70%  { box-shadow: 0 0 0 18px rgba(255,255,255,0); }
            100% { box-shadow: 0 0 0 0 rgba(255,255,255,0); }
        }
        .ricap-marker.ricap-pulse { animation: ricapMarkerPulse .55s ease-out; }

        .leaflet-control-zoom a {
            transition: transform .15s cubic-bezier(.34, 1.56, .64, 1), background .2s ease, color .2s ease;
        }
        .leaflet-control-zoom a:hover { transform: scale(1.1); }
        .leaflet-control-zoom a:active { transform: scale(0.92); transition: transform .08s ease; }

        @media (prefers-reduced-motion: reduce) {
            .ricap-marker, .leaflet-control-zoom a { transition: none; }
            .ricap-marker.ricap-pulse { animation: none; }
        }
    `;
    document.head.appendChild(style);
}


const CLICK_ZOOM_LEVEL = 16;
const CLICK_FLY_SECONDS = 0.7;

// Zooms smoothly to a river marker when it is clicked.
function bindMarkerClickAnimation(map, onOverview) {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // The marker element that was clicked, if any.
    function markerIconEl(e) {
        const marker = e.popup && e.popup._source;
        const icon = marker && (marker.getElement ? marker.getElement() : marker._icon);
        if (!icon) return null;
        return icon.classList.contains('ricap-marker') ? icon : icon.querySelector('.ricap-marker');
    }

    let revertTimer = null;

    map.on('popupopen', e => {
        if (revertTimer) { clearTimeout(revertTimer); revertTimer = null; }

        const el = markerIconEl(e);
        if (el) {
            el.classList.remove('ricap-pulse');
            void el.offsetWidth;
            el.classList.add('ricap-pulse');
            map.getContainer().querySelectorAll('.ricap-marker.ricap-active')
                .forEach(other => other.classList.remove('ricap-active'));
            el.classList.add('ricap-active');
        }

        const marker = e.popup && e.popup._source;
        if (marker && marker.getLatLng && !(marker.options && marker.options.segmentMarker)) {
            const targetZoom = Math.min(map.getMaxZoom(), Math.max(map.getZoom(), CLICK_ZOOM_LEVEL));
            if (reduceMotion) map.setView(marker.getLatLng(), targetZoom);
            else map.flyTo(marker.getLatLng(), targetZoom, { duration: CLICK_FLY_SECONDS });
        }
    });

    map.on('popupclose', e => {
        map.getContainer().querySelectorAll('.ricap-marker.ricap-active')
            .forEach(el => el.classList.remove('ricap-active'));
        const source = e.popup && e.popup._source;
        if (!(source instanceof L.Marker) || source.options.segmentMarker) return;
        revertTimer = setTimeout(() => {
            revertTimer = null;
            if (onOverview) onOverview();
        }, 60);
    });
}


// Adds the mask and municipality outlines to the map; highlights the area under the pointer.
export async function loadBataanMask(map, bounds, options = {}) {
    injectStyles();
    bindMarkerClickAnimation(map, options.onOverview);

    let data;
    try {
        data = await loadBoundaryFile();
        if (map.attributionControl) {
            map.attributionControl.addAttribution('Boundaries &copy; NAMRIA/PSA via <a href="https://www.geoboundaries.org" target="_blank" rel="noopener">geoBoundaries</a>');
        }
    } catch (err) {
        console.warn('[BataanMask] boundary file unavailable, using Nominatim', err);
        data = await loadBoundaryFromNominatim(bounds);
    }
    if (!data.province.length) throw new Error('Bataan boundary had no rings');

    const panes = { areas: 390, mask: 450, outline: 460 };
    Object.keys(panes).forEach(key => {
        const name = 'ricap-' + key;
        if (!map.getPane(name)) {
            const pane = map.createPane(name);
            pane.style.zIndex = panes[key];
            pane.style.pointerEvents = 'none';
        }
    });
    const renderer = key => L.svg({ pane: 'ricap-' + key, padding: 1 });

    const world = [[-89.9, -539.9], [-89.9, 539.9], [89.9, 539.9], [89.9, -539.9]];
    const holes = data.province.flat();
    L.polygon([world, ...holes], {
        renderer: renderer('mask'),
        stroke: false,
        fillColor: MASK_COLOR,
        fillOpacity: 1,
        fillRule: 'evenodd',
        interactive: false
    }).addTo(map);

    const outlineRenderer = renderer('outline');
    data.province.forEach(poly => {
        L.polygon(poly, { renderer: outlineRenderer, color: OUTLINE_COLOR, weight: 7, opacity: 0.22, fill: false, interactive: false }).addTo(map);
        L.polygon(poly, { renderer: outlineRenderer, color: OUTLINE_COLOR, weight: 2, opacity: 0.95, fill: false, interactive: false }).addTo(map);
    });

    const provinceBounds = L.latLngBounds(holes.flat());

    const areaRenderer = renderer('areas');
    const baseStyle = { color: AREA_LINE_COLOR, weight: 1, opacity: 0.45, dashArray: '4 4', fillColor: OUTLINE_COLOR, fillOpacity: 0 };
    const hoverStyle = { color: OUTLINE_COLOR, weight: 2.5, opacity: 0.95, dashArray: null, fillOpacity: 0.12 };

    const municipalities = data.municipalities.map(m => {
        const layer = L.polygon(m.polygons, { ...baseStyle, renderer: areaRenderer, interactive: false }).addTo(map);
        const mBounds = layer.getBounds();
        return { name: m.name, polygons: m.polygons, bounds: mBounds, center: mBounds.getCenter(), layer };
    });

    const label = L.tooltip({ className: 'ricap-area-label', direction: 'center', permanent: false, interactive: false, opacity: 1 });
    let active = null;

    // Highlights one municipality (or none).
    function setActive(area) {
        if (area === active) return;
        if (active) active.layer.setStyle(baseStyle);
        active = area;
        if (area) {
            area.layer.setStyle(hoverStyle);
            label.setLatLng(area.layer.getCenter()).setContent(area.name);
            if (!map.hasLayer(label)) label.addTo(map);
        } else if (map.hasLayer(label)) {
            map.removeLayer(label);
        }
    }

    // The municipality under a map position.
    function areaAt(latlng) {
        if (!latlng) return null;
        for (const area of municipalities) {
            if (area.bounds.contains(latlng) && polygonsContain(area.polygons, latlng.lat, latlng.lng)) return area;
        }
        return null;
    }

    if (municipalities.length) {
        let pending = null, frame = 0;
        map.on('mousemove', e => {
            pending = e.latlng;
            if (frame) return;
            frame = requestAnimationFrame(() => { frame = 0; setActive(areaAt(pending)); });
        });
        map.getContainer().addEventListener('mouseleave', () => setActive(null));
        map.on('click', e => setActive(areaAt(e.latlng)));
        map.on('zoomstart', () => { if (map.hasLayer(label)) map.removeLayer(label); });
        map.on('zoomend', () => { if (active) { const a = active; active = null; setActive(a); } });
    }

    return {
        bounds: provinceBounds,
        municipalities,
        contains(latlng) {
            const ll = L.latLng(latlng);
            if (polygonsContain(data.province, ll.lat, ll.lng)) return true;
            return distanceToEdgesKm(data.province, ll.lat, ll.lng) <= EDGE_TOLERANCE_KM;
        },
        distanceToEdgeKm(latlng) {
            const ll = L.latLng(latlng);
            return distanceToEdgesKm(data.province, ll.lat, ll.lng);
        },
        focusMunicipality(name, fitOptions) {
            const area = municipalities.find(m => m.name.toLowerCase() === String(name).toLowerCase());
            if (!area) return false;
            map.flyToBounds(area.bounds, fitOptions);
            map.once('moveend', () => { active = null; setActive(area); });
            return true;
        }
    };
}
