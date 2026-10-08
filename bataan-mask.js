// bataan-mask.js
// Visually sets Bataan apart from everywhere else on the map — everywhere outside the
// province is blurred/dimmed, Bataan itself stays sharp, like a soft spotlight instead of
// a hard black cutout. Also adds a small hover/click "pop" animation to the river markers.
//
// Nothing else in the project needs to change: this is still called the same way —
//   loadBataanMask(map, BATAAN_BOUNDS)
// — from mapping.js. Everything below is self-contained in this one file.
//
// The province boundary comes from Nominatim (the same OSM-backed geocoder waterwaymap.org's
// data ultimately traces back to), cached in localStorage so it's fetched once, not on every visit.

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const CACHE_KEY = 'ricap_bataan_boundary_v2'; // bumped: v2 caches the point-simplified rings
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — province borders don't change

const BLUR_PX = 18;                     // how blurry the "outside Bataan" area looks
const DIM_COLOR = 'rgba(8,10,14,0.25)'; // light dark tint on top of the blur — low enough that the blur itself is still visible, not just a dark fill

function readCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const c = JSON.parse(raw);
        if (!c || Date.now() - c.t > CACHE_TTL_MS || !Array.isArray(c.rings)) return null;
        return c.rings;
    } catch (e) { return null; }
}

function writeCache(rings) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), rings })); }
    catch (e) { console.warn('[BataanMask] could not cache boundary (storage full?)'); }
}

const MAX_RING_POINTS = 250; // a real coastline can have thousands of points — way more detail
                              // than a blur cut-out needs, and every extra point makes the SVG
                              // mask bigger to build/parse/repaint. Thinned once, then cached.

function simplifyRing(ring) {
    if (ring.length <= MAX_RING_POINTS) return ring;
    const stride = Math.ceil(ring.length / MAX_RING_POINTS);
    const out = ring.filter((_, i) => i % stride === 0);
    if (out[out.length - 1] !== ring[ring.length - 1]) out.push(ring[ring.length - 1]);
    return out;
}

// GeoJSON rings are [lng, lat]; Leaflet wants [lat, lng]. Flattens Polygon/MultiPolygon into
// one list of rings (outer boundary + any inner holes/enclaves) — fine for our purposes since
// we only use these as an evenodd cut-out, same parity logic either way.
function geojsonRingsToLatLng(geometry) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
        : geometry.type === 'MultiPolygon' ? geometry.coordinates
        : [];
    const rings = [];
    polygons.forEach(poly => {
        poly.forEach(ring => {
            rings.push(simplifyRing(ring.map(([lng, lat]) => [lat, lng])));
        });
    });
    return rings;
}

async function fetchBataanBoundary(bounds) {
    const [[south, west], [north, east]] = bounds;
    const params = new URLSearchParams({
        q: 'Bataan, Philippines',
        format: 'jsonv2',
        polygon_geojson: '1',
        countrycodes: 'ph',
        bounded: '1',
        // restrict results to roughly Bataan's own bounding box, so this can't accidentally
        // match "New Bataan" (an unrelated municipality in Davao de Oro, far from here)
        viewbox: `${west},${north},${east},${south}`,
        limit: '1'
    });

    const res = await fetch(NOMINATIM_URL + '?' + params.toString());
    if (!res.ok) throw new Error('Nominatim HTTP ' + res.status);
    const results = await res.json();
    if (!results.length || !results[0].geojson) throw new Error('Bataan boundary not found');

    return geojsonRingsToLatLng(results[0].geojson);
}

function injectStyles() {
    if (document.getElementById('ricap-mask-styles')) return;
    const style = document.createElement('style');
    style.id = 'ricap-mask-styles';
    style.textContent = `
        .ricap-bataan-blur {
            position: absolute;
            inset: 0;
            pointer-events: none;
            background: ${DIM_COLOR};
            backdrop-filter: blur(${BLUR_PX}px);
            -webkit-backdrop-filter: blur(${BLUR_PX}px);
            opacity: 1;
            transition: opacity .2s ease;
            will-change: opacity;
        }
        /* While actively dragging/zooming: no blur at all (cheap), so panning stays smooth.
           Recomputing a backdrop-filter blur every single frame is what caused the lag. */
        .ricap-bataan-blur--interacting {
            opacity: 0;
        }
        /* marker hover + click animations (markers already carry the .ricap-marker class) */
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
        .ricap-marker.ricap-pulse {
            animation: ricapMarkerPulse .55s ease-out;
        }
        /* zoom +/- buttons: a bit more "pop" on hover/press, same feel as the markers */
        .leaflet-control-zoom a {
            transition: transform .15s cubic-bezier(.34, 1.56, .64, 1), background .2s ease, color .2s ease;
        }
        .leaflet-control-zoom a:hover {
            transform: scale(1.1);
        }
        .leaflet-control-zoom a:active {
            transform: scale(0.92);
            transition: transform .08s ease;
        }
    `;
    document.head.appendChild(style);
}

// Clicking a report marker now actually zooms the MAP in on it — not just a CSS "pop" on the
// icon, a real flyTo() that pans/zooms the view in close on that river, then flies back out
// to the full Bataan overview once the popup closes. The icon still gets the pulse + the
// scaled-up "active" look too, for the instant the click registers, while the map is flying in.
//
// This listens for Leaflet's own 'popupopen'/'popupclose' map events instead of a raw click.
// Every marker here is set up with bindPopup(), and Marker's built-in popup handler calls
// DomEvent.stop() on the click the instant it opens the popup — that's what a marker click
// actually does in Leaflet, specifically so the click can't also bubble out and, say, close
// the popup again via some ancestor's click handler. That stop happens BEFORE the click would
// ever reach a delegated listener on the map or its container, which is why neither a
// container-level addEventListener nor map.on('click', ...) ever saw marker clicks — both
// were waiting for an event Leaflet had already swallowed. popupopen/popupclose, by contrast,
// are fired directly on the map by Leaflet's own popup code every time, with no such
// short-circuit — mapping.js already relies on this same event for its own popup wiring.
const CLICK_ZOOM_LEVEL = 16;     // roughly street level — close enough to read road names
const CLICK_FLY_SECONDS = 0.7;

function bindMarkerClickAnimation(map, overviewBounds) {
    function markerIconEl(e) {
        const marker = e.popup && e.popup._source;
        const icon = marker && (marker.getElement ? marker.getElement() : marker._icon);
        if (!icon) return null;
        return icon.classList.contains('ricap-marker') ? icon : icon.querySelector('.ricap-marker');
    }

    // Clicking a different marker fires popupclose (for the old one) then popupopen (for the
    // new one) back-to-back, in the same tick. Without this, that pair would make the map fly
    // all the way back out to the Bataan overview and then immediately back in on the new
    // marker — a jarring double-zoom. So the "fly back out" on close is delayed one tick, and
    // cancelled if a new popup opens in that window.
    let revertTimer = null;

    map.on('popupopen', e => {
        if (revertTimer) { clearTimeout(revertTimer); revertTimer = null; }

        const el = markerIconEl(e);
        if (el) {
            el.classList.remove('ricap-pulse');
            void el.offsetWidth; // force reflow so it restarts even on a fast reopen
            el.classList.add('ricap-pulse');

            map.getContainer().querySelectorAll('.ricap-marker.ricap-active')
                .forEach(other => other.classList.remove('ricap-active'));
            el.classList.add('ricap-active');
        }

        const marker = e.popup && e.popup._source;
        if (marker && marker.getLatLng) {
            // never zoom OUT to show a report — only ever in, or stay as-is if already closer
            const targetZoom = Math.max(map.getZoom(), CLICK_ZOOM_LEVEL);
            map.flyTo(marker.getLatLng(), targetZoom, { duration: CLICK_FLY_SECONDS });
        }
    });

    // closing the popup (Escape, the × button, clicking elsewhere) clears the "zoomed" marker
    // and flies back out to the full Bataan view
    map.on('popupclose', () => {
        map.getContainer().querySelectorAll('.ricap-marker.ricap-active')
            .forEach(el => el.classList.remove('ricap-active'));

        revertTimer = setTimeout(() => {
            revertTimer = null;
            if (!overviewBounds) return;
            const fitZoom = map.getBoundsZoom(overviewBounds, true);
            map.flyTo(overviewBounds.getCenter(), fitZoom, { duration: CLICK_FLY_SECONDS });
        }, 60);
    });
}

/**
 * Adds the blur mask + marker animations to the map. Call once, after the map and its
 * bounds exist — same call site as before: loadBataanMask(map, BATAAN_BOUNDS)
 * @param {L.Map} map
 * @param {L.LatLngBounds|Array} bounds - Bataan's bounding box (same as BATAAN_BOUNDS)
 */
export async function loadBataanMask(map, bounds) {
    injectStyles();
    // same 0.05 padding mapping.js itself uses when computing its own BOUNDS, so "zoomed out"
    // after a popup closes matches the normal resting view exactly
    bindMarkerClickAnimation(map, L.latLngBounds(bounds).pad(0.05));

    let holeRings = readCache();
    if (!holeRings) {
        holeRings = await fetchBataanBoundary(bounds);
        writeCache(holeRings);
    }
    if (!holeRings.length) throw new Error('Bataan boundary had no rings');

    // The blur layer itself is a plain HTML div (backdrop-filter isn't something a Leaflet
    // vector layer can do), placed right after Leaflet's own map pane so it sits above the
    // tiles/markers but below the zoom controls — and masked with a cut-out so Bataan itself
    // is never blurred. Since it's outside Leaflet's pane system, its cut-out has to be
    // recomputed by hand whenever the map pans, zooms, or resizes.
    const container = map.getContainer();
    const overlay = document.createElement('div');
    overlay.className = 'ricap-bataan-blur';
    const controlContainer = container.querySelector('.leaflet-control-container');
    if (controlContainer) container.insertBefore(overlay, controlContainer);
    else container.appendChild(overlay);

    function syncMask() {
        const size = map.getSize(); // {x, y} in CSS pixels
        const w = size.x, h = size.y;

        // One path: the whole visible area, MINUS Bataan's outline (projected to this exact
        // view) using the evenodd fill rule — so Bataan's shape becomes a true hole.
        let d = `M0,0 H${w} V${h} H0 Z`;
        holeRings.forEach(ring => {
            const pts = ring.map(([lat, lng]) => {
                const p = map.latLngToContainerPoint([lat, lng]);
                return `${p.x},${p.y}`;
            });
            if (pts.length > 1) d += ` M${pts.join(' L')} Z`;
        });

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`
            + `<path d="${d}" fill="white" fill-rule="evenodd"/></svg>`;
        const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

        overlay.style.maskImage = url;
        overlay.style.webkitMaskImage = url;
        overlay.style.maskRepeat = 'no-repeat';
        overlay.style.webkitMaskRepeat = 'no-repeat';
    }

    // The expensive part isn't the math above, it's the browser re-blurring the whole view
    // every frame while that math is applied continuously during a drag/zoom. So: hide the
    // blur the instant movement starts (cheap — panning behaves like it isn't there at all),
    // then once the map is still again, recompute the cut-out for the new view and fade the
    // blur back in. The one-time recompute at rest is fast since the boundary is pre-thinned.
    map.on('movestart zoomstart', () => {
        overlay.classList.add('ricap-bataan-blur--interacting');
    });
    map.on('moveend zoomend resize', () => {
        syncMask();
        overlay.classList.remove('ricap-bataan-blur--interacting');
    });
    syncMask();

    return overlay;
}