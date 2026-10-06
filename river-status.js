import { db } from './firebase-config.js';
import {
    collection,
    query,
    where,
    orderBy,
    limit,
    onSnapshot,
    Timestamp
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const MAX_MATCH_KM = 4;
const MAX_AGE_DAYS = 30;
const MAX_ACCURACY_M = 2000;
const HALF_LIFE_DAYS = 7;

function distKm(aLat, aLng, bLat, bLng) {
    const R = 6371;
    const rad = Math.PI / 180;
    const dLat = (bLat - aLat) * rad;
    const dLng = (bLng - aLng) * rad;
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

export function statusFromScore(score) {
    return score > 85 ? 'critical'
        : score > 65 ? 'polluted'
        : score > 30 ? 'moderate'
        : 'healthy';
}

export function nearestRiver(lat, lng, rivers) {
    let best = null;
    let bestD = Infinity;

    rivers.forEach(rv => {
        const points = [[rv.lat, rv.lng]].concat(rv.path || []);
        points.forEach(p => {
            if (!Array.isArray(p) || p.length < 2) return;
            const d = distKm(lat, lng, p[0], p[1]);
            if (d < bestD) {
                bestD = d;
                best = rv;
            }
        });
    });

    return best && bestD <= MAX_MATCH_KM ? best : null;
}

function compute(docs, rivers) {
    const buckets = {};

    docs.forEach(r => {
        if (!r.createdAt) return;
        if (r.accuracy && r.accuracy > MAX_ACCURACY_M) return;

        const rv = r.riverId
            ? rivers.find(x => String(x.id) === String(r.riverId))
            : nearestRiver(r.lat, r.lng, rivers);

        if (!rv) return;
        if (!buckets[rv.id]) buckets[rv.id] = [];

        let date;
        try {
            date = r.createdAt.toDate();
        } catch (e) {
            date = new Date(r.createdAt);
        }

        buckets[rv.id].push({ ...r, date });
    });

    const out = {};

    Object.keys(buckets).forEach(id => {
        const list = buckets[id].sort((a, b) => b.date.getTime() - a.date.getTime());

        let wSum = 0;
        let sSum = 0;

        list.forEach(x => {
            const ageDays = (Date.now() - x.date.getTime()) / 864e5;
            const w = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
            const score = Number(x.score);
            if (!Number.isFinite(score)) return;
            wSum += w;
            sSum += w * score;
        });

        if (!wSum) return;

        const score = Math.round(sSum / wSum);
        const latest = list[0];

        out[id] = {
            status: statusFromScore(score),
            score,
            count: list.length,
            lastUpdated: latest.date,
            imageUrl: latest.imageUrl || '',
            assessment: latest.assessment || '',
            recommendation: latest.recommendation || '',
            officialName: latest.officialName || '',
            latestScore: latest.score,

            // extra fields for the full-analysis modal
            reportName: latest.reportName || '',
            reporterName: latest.reporterName || '',
            reporterRole: latest.reporterRole || '',
            colorCast: latest.colorCast || '',
            clutterReading: latest.clutterReading || '',
            waterQuality: latest.waterQuality || '',
            confidence: latest.confidence ?? null
        };
    });

    return out;
}

export function watchRiverStatuses(rivers, cb) {
    const since = Timestamp.fromDate(new Date(Date.now() - MAX_AGE_DAYS * 864e5));

    const q = query(
        collection(db, 'reports'),
        where('createdAt', '>=', since),
        orderBy('createdAt', 'desc'),
        limit(500)
    );

    return onSnapshot(
        q,
        snap => cb(compute(snap.docs.map(d => d.data()), rivers)),
        err => {
            console.error('RiCap: reports listener failed', err);
            cb({});
        }
    );
}