// Browser pop-up notifications for new river reports.
// Users can turn on all alerts or alerts per river; startReportAlerts() watches Firestore and
// shows a notification for each new report that matches.

import { db } from './firebase-config.js';
import {collection,query,orderBy,limit,onSnapshot} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
const KEY = 'ricap_notif';
const ALL_KEY = 'ricap_notif_all';

let started = false;

// True if the browser allows notifications and the user turned them on.
export function notifEnabled() {
    return ('Notification' in window && Notification.permission === 'granted' && localStorage.getItem(KEY) === '1');
}

// Asks the browser for permission; resolves true if granted.
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

// Flips the general notification setting.
export function toggleNotifications() {
    if (notifEnabled()) {
        localStorage.setItem(KEY, '0');
        return false;
    }
    return requestNotifications();
}

// True if notifications are on for every river.
export function allNotifEnabled() {
    return (
        'Notification' in window &&
        Notification.permission === 'granted' &&
        localStorage.getItem(ALL_KEY) === '1'
    );
}

// Turns notifications for every river on or off.
export function setAllNotifications(enabled) {
    if (enabled) localStorage.setItem(ALL_KEY, '1');
    else localStorage.removeItem(ALL_KEY);
}

// True if notifications are on for this river.
export function riverNotifEnabled(riverId) {
    return localStorage.getItem(`ricap_river_notif_${riverId}`) === '1';
}

// Turns notifications for one river on or off.
export function setRiverNotification(riverId, enabled) {
    const key = `ricap_river_notif_${riverId}`;
    if (enabled) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
}

// Wires a button to toggle notifications and keeps its label in sync.
export function bindNotifButton(btn) {
    if (!btn) return;

    // Updates the button label and state.
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

// Starts watching new reports (once per page) and notifies about ones that arrive after page load.
export function startReportAlerts() {
    if (started) return;
    started = true;

    const startedAt = Date.now();
    const known = new Set();
    let primed = false;

    const q = query(
        collection(db, 'reports'),
        orderBy('createdAt', 'desc'),
        limit(20)
    );

    onSnapshot(
        q,
        snap => {
            if (!primed) {
                snap.docs.forEach(d => known.add(d.id));
                primed = true;
                return;
            }

            snap.docChanges().forEach(change => {
                if (change.type !== 'added') return;
                if (known.has(change.doc.id)) return;
                known.add(change.doc.id);

                if (change.doc.metadata.hasPendingWrites) return;

                const report = change.doc.data();
                if (!report.createdAt) return;

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