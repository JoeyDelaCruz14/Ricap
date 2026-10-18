// Cloud Functions (region asia-southeast1):
// - sendReportAlerts: when a report with status moderate or worse is created, emails the
//   subscribers in alertSubscribers through EmailJS.
// - redeemAccessCode: checks an access code and sets the official claim on the caller.

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();

const EMAILJS_PRIVATE_KEY = defineSecret('EMAILJS_PRIVATE_KEY');

const EMAILJS_SERVICE_ID = 'service_vlbn60c';
const EMAILJS_PUBLIC_KEY = '5AaO3u5yFe98nJxv6';
const EMAILJS_ALERT_TEMPLATE_ID = 'template_ne59us1';
const SITE_URL = 'http://127.0.0.1:5500/Home.html';
const ALERT_STATUSES = ['moderate', 'polluted', 'critical'];

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

        // New report for this river segment, or an update to one that already has reports?
        let isUpdate = false;
        if (r.riverId) {
            try {
                const prev = await admin.firestore().collection('reports')
                    .where('riverId', '==', r.riverId)
                    .where('segmentId', '==', r.segmentId ?? '')
                    .limit(2).get();
                isUpdate = prev.docs.some(d => d.id !== event.params.reportId);
            } catch (err) {
                logger.warn('Could not check for earlier reports', { error: String(err) });
            }
        }
        const reportType = isUpdate ? 'Update to an existing river report' : 'New river report';
        const sentAt = new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' });

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
                            name: r.reporterName || 'A RiCap official',
                            time: sentAt,
                            river,
                            status: status.toUpperCase(),
                            score: r.score != null ? String(r.score) : '',
                            recommendation: r.recommendation || 'Avoid contact with the water.',
                            image_url: r.imageUrl || '',
                            report_type: reportType,
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

exports.redeemAccessCode = onCall({ region: 'asia-southeast1' }, async request => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Your session has expired. Reload the page and try again.');
    }
    const code = String((request.data && request.data.code) || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,40}$/.test(code)) {
        throw new HttpsError('invalid-argument', 'Enter the access code exactly as it was emailed to you.');
    }

    const snap = await admin.database().ref('accessCodes/' + code).get();
    if (!snap.exists() || !snap.val().active) {
        throw new HttpsError('permission-denied', 'Invalid or inactive access code.');
    }

    const v = snap.val();
    await admin.auth().setCustomUserClaims(request.auth.uid, { official: true, officialCode: code });
    logger.info('Official verified', { uid: request.auth.uid, code });
    return { name: v.officialName || '', role: v.role || '', organization: v.organization || '' };
});