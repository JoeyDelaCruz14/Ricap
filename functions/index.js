// RiCap email alerts: when a new report is saved, email everyone who turned alerts on.
// Uses EmailJS's REST API (same EmailJS account as the access codes).
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();

const EMAILJS_PRIVATE_KEY = defineSecret('EMAILJS_PRIVATE_KEY');

const EMAILJS_SERVICE_ID = 'service_vlbn60c';
const EMAILJS_PUBLIC_KEY = '5AaO3u5yFe98nJxv6';
const EMAILJS_ALERT_TEMPLATE_ID = 'template_ne59us1';   // <- the NEW alert template, NOT template_tdqy3qr (Contact Us)
const SITE_URL = 'http://127.0.0.1:5500/Home.html';                   // <- change once your site is hosted
const ALERT_STATUSES = ['moderate', 'polluted', 'critical'];

// riverId -> display name (edit to match your rivers)
const RIVER_NAMES = {
    mamala: 'Mamala River',
    limay: 'Limay River',
    pilar: 'Pilar River',
    balanga: 'Balanga River',
    orani: 'Orani River'
};

exports.sendReportAlerts = onDocumentCreated(
    { document: 'reports/{reportId}', secrets: [EMAILJS_PRIVATE_KEY], region: 'asia-southeast1' },
    async event => {
        const r = event.data && event.data.data();
        if (!r) return;

        const status = String(r.status || '').toLowerCase();
        if (!ALERT_STATUSES.includes(status)) {
            logger.info('Skipped: status not alertable', { status });
            return;
        }

        // one email per address; the most recently updated record decides opt-in / opt-out
        const snap = await admin.firestore().collection('alertSubscribers').get();
        const byEmail = new Map();
        snap.forEach(d => {
            const s = d.data();
            if (!s.email) return;
            const key = String(s.email).toLowerCase();
            const t = s.updatedAt && s.updatedAt.toMillis ? s.updatedAt.toMillis() : 0;
            const cur = byEmail.get(key);
            if (!cur || t >= cur.t) {
                byEmail.set(key, { t, enabled: s.emailEnabled === true, name: s.name, email: s.email });
            }
        });
        const recipients = [...byEmail.values()].filter(v => v.enabled);
        if (!recipients.length) {
            logger.info('No subscribers with email alerts on');
            return;
        }

        const river = RIVER_NAMES[r.riverId] || r.riverName || r.reportName || 'a Bataan river';

        for (const p of recipients) {
            try {
                const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        service_id: EMAILJS_SERVICE_ID,
                        template_id: EMAILJS_ALERT_TEMPLATE_ID,
                        user_id: EMAILJS_PUBLIC_KEY,
                        accessToken: EMAILJS_PRIVATE_KEY.value(),
                        template_params: {
                            to_email: p.email,
                            to_name: p.name || 'there',
                            river,
                            status: status.toUpperCase(),
                            score: r.score != null ? String(r.score) : '',
                            recommendation: r.recommendation || 'Avoid contact with the water.',
                            site_url: SITE_URL
                        }
                    })
                });
                if (res.ok) logger.info('Email sent', { to: p.email });
                else logger.error('EmailJS error', { to: p.email, status: res.status, body: await res.text() });
            } catch (err) {
                logger.error('Send failed', { to: p.email, error: String(err) });
            }
        }
    }
);