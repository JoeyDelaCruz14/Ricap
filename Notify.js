import { db } from './firebase-config.js';
import {collection,query,orderBy,limit,onSnapshot} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
const KEY = 'ricap_notif';
const ALL_KEY = 'ricap_notif_all';

let started = false;

export function notifEnabled() {
    return ('Notification' in window && Notification.permission === 'granted' && localStorage.getItem(KEY) === '1');
}

export async function requestNotifications() {
    if (!('Notification' in window)) { alert('This browser does not support notifications.');
        return false;
    }

    if (Notification.permission === 'granted') {
        localStorage.setItem(KEY, '1');
        return true;
    }

    const permission = await Notification.requestPermission();

    if (permission !== 'granted') {
        alert('Notifications are blocked. Allow them in your browser site settings.');
        return false;
    }

    localStorage.setItem(KEY, '1');
    return true;
}

export function toggleNotifications() {
    if (notifEnabled()) {
        localStorage.setItem(KEY, '0');
        return false;
    }
    return requestNotifications();
}

// "Alert me for every river" (used by the forum sidebar button)
export function allNotifEnabled() {
    return (
        'Notification' in window &&
        Notification.permission === 'granted' &&
        localStorage.getItem(ALL_KEY) === '1'
    );
}

export function setAllNotifications(enabled) {
    if (enabled) localStorage.setItem(ALL_KEY, '1');
    else localStorage.removeItem(ALL_KEY);
}

export function riverNotifEnabled(riverId) {
    return localStorage.getItem(`ricap_river_notif_${riverId}`) === '1';
}

export function setRiverNotification(riverId, enabled) {
    const key = `ricap_river_notif_${riverId}`;
    if (enabled) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
}

export function bindNotifButton(btn) {
    if (!btn) return;

    const paint = () => {
        btn.textContent = notifEnabled() ? '\u{1F514} Notifications on' : '\u{1F515} Enable notifications';
        btn.classList.toggle('is-on', notifEnabled());
    };

    btn.addEventListener('click', async () => {
        await toggleNotifications();
        paint();
    });

    paint();
}

// Shows a pop-up when a NEW report is posted (by someone else) while any RiCap page is open.
// Safe to call from several places: it only starts once per page.
export function startReportAlerts() {
    if (started) return;
    started = true;

    const startedAt = Date.now();
    const known = new Set();      // reports that already existed when this page loaded
    let primed = false;

    const q = query(
        collection(db, 'reports'),
        orderBy('createdAt', 'desc'),
        limit(20)
    );

    onSnapshot(
        q,
        snap => {
            // First snapshot (cache or server): just remember what is already there.
            if (!primed) {
                snap.docs.forEach(d => known.add(d.id));
                primed = true;
                return;
            }

            snap.docChanges().forEach(change => {
                if (change.type !== 'added') return;
                if (known.has(change.doc.id)) return;
                known.add(change.doc.id);

                // our own just-submitted report still has a pending server timestamp: skip it
                if (change.doc.metadata.hasPendingWrites) return;

                const report = change.doc.data();
                if (!report.createdAt) return;

                // ignore anything that was created before this page loaded (late cache/server sync)
                let created = 0;
                try { created = report.createdAt.toMillis(); } catch (e) { created = Date.now(); }
                if (created < startedAt - 2 * 60 * 1000) return;

                const wanted = allNotifEnabled() ||
                    (notifEnabled() && report.riverId && riverNotifEnabled(report.riverId));
                if (!wanted) return;

                try {
                    new Notification(
                        'New river report' + (report.reportName ? ' \u2014 ' + report.reportName : ''),
                        {
                            body:
                                (report.status || '').toUpperCase() +
                                ' \u00b7 score ' + (report.score ?? '\u2014') + '/100' +
                                (report.reporterName ? ' \u00b7 by ' + report.reporterName : '')
                        }
                    );
                } catch (err) {
                    console.warn('RiCap: could not show notification', err);
                }
            });
        },
        err => console.error('RiCap: notification listener failed', err)
    );
}