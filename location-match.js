// Strict 20 m rule for suggesting a river segment from a location (GPS or photo EXIF).
// Tested in tests/location-match.test.mjs.
// Sa madaling salita: kapag ang lokasyon mo ay hanggang 20 metro lang mula sa ilog, iyon ang pipiliing segment.

import { segmentDistances } from './river-lines.js';

// Change this one value to widen or tighten the auto-select rule.
export const SUGGEST_MAX_DISTANCE_M = 20;
export const MAX_CHOICES = 3;

// Decides what a location may select. Distance is point-to-line on the stored
// segment geometry, from the reported position itself; GPS accuracy is never added.
export function matchLocation(parts, loc, inBataan) {
    if (inBataan && !inBataan(loc.lat, loc.lng)) return { kind: 'outside' };

    if (loc.accuracy != null && loc.accuracy > SUGGEST_MAX_DISTANCE_M) {
        return { kind: 'inaccurate', accuracy: loc.accuracy };
    }

    const all = segmentDistances(parts, loc.lat, loc.lng)
        .map(s => ({ riverId: s.riverId, index: s.index, m: s.km * 1000 }));
    const within = all.filter(s => s.m <= SUGGEST_MAX_DISTANCE_M);

    if (!within.length) return { kind: 'none', nearest: all[0] || null };
    if (within.length === 1) return { kind: 'match', hit: within[0] };
    return { kind: 'choices', hits: within.slice(0, MAX_CHOICES) };
}
