// One-time cleanup: removes the plain access code (reporterCode) from every report and saves a
// reporterKey in its place, so old reports still group with the official's new ones.
// With --rotate it also replaces every access code that appeared on a report with a new one
// (the old code is deactivated) and prints the new codes for you to send to the officials.
//
// Dry run (changes nothing, just reports what it would do):
//   cd functions
//   set REPORTER_KEY_SECRET=<same value as the Cloud Function secret>
//   node scripts/remove-report-codes.js
// Apply:            node scripts/remove-report-codes.js --apply
// Apply + new codes: node scripts/remove-report-codes.js --apply --rotate
//
// Needs admin credentials: GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key
// for ricap-35aa9, or `gcloud auth application-default login`.
// Sa madaling salita: tinatanggal ang access code sa mga lumang report at gumagawa ng bagong code para sa mga opisyal.

const crypto = require('crypto');
const admin = require('firebase-admin');

const APPLY = process.argv.includes('--apply');
const ROTATE = process.argv.includes('--rotate');
const SECRET = process.env.REPORTER_KEY_SECRET;

if (!SECRET) {
    console.error('Set REPORTER_KEY_SECRET to the same value as the Cloud Function secret first.');
    process.exit(1);
}

admin.initializeApp({
    projectId: 'ricap-35aa9',
    databaseURL: 'https://ricap-35aa9-default-rtdb.asia-southeast1.firebasedatabase.app'
});

// Same as reporterKeyFor in functions/index.js.
function reporterKeyFor(id) {
    return crypto.createHmac('sha256', SECRET).update(String(id)).digest('hex').slice(0, 32);
}

// Random access code such as RICAP-7K2QXM (same format as applications.js).
function generateAccessCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'RICAP-';
    for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
    return code;
}

async function main() {
    console.log(APPLY ? 'APPLYING changes' : 'DRY RUN (add --apply to change data)');
    const rtdb = admin.database();
    const snap = await admin.firestore().collection('reports').get();

    // Look up each code once: accessCodes/<code> gives the applicationId the key is based on.
    const codeInfo = new Map();
    async function infoFor(code) {
        if (!codeInfo.has(code)) {
            const c = await rtdb.ref('accessCodes/' + code).get();
            codeInfo.set(code, c.exists() ? c.val() : null);
        }
        return codeInfo.get(code);
    }

    let changed = 0;
    let batch = admin.firestore().batch();
    let inBatch = 0;
    for (const d of snap.docs) {
        const code = String(d.get('reporterCode') || '').trim().toUpperCase();
        if (d.get('reporterCode') === undefined) continue;
        const info = code ? await infoFor(code) : null;
        const update = { reporterCode: admin.firestore.FieldValue.delete() };
        if (code && !d.get('reporterKey')) update.reporterKey = reporterKeyFor((info && info.applicationId) || code);
        changed++;
        if (APPLY) {
            batch.update(d.ref, update);
            if (++inBatch === 400) { await batch.commit(); batch = admin.firestore().batch(); inBatch = 0; }
        }
    }
    if (APPLY && inBatch) await batch.commit();
    console.log(`${changed} of ${snap.size} reports ${APPLY ? 'cleaned' : 'would be cleaned'}.`);

    if (!ROTATE) return;
    const exposed = [...codeInfo.entries()].filter(([, v]) => v && v.active);
    console.log(`${exposed.length} active access code(s) appeared on reports and ${APPLY ? 'are being' : 'would be'} replaced.`);
    for (const [oldCode, v] of exposed) {
        const newCode = generateAccessCode();
        if (APPLY) {
            await rtdb.ref('accessCodes/' + newCode).set({ ...v, active: true, replaces: oldCode, createdAt: admin.database.ServerValue.TIMESTAMP });
            await rtdb.ref('accessCodes/' + oldCode).update({ active: false, replacedBy: newCode });
            if (v.applicationId) await rtdb.ref('officialApplications/' + v.applicationId).update({ accessCode: newCode, emailSent: false });
            console.log(`  ${v.officialName || '(no name)'} — new code ${newCode}`);
        } else {
            console.log(`  ${v.officialName || '(no name)'} — would get a new code`);
        }
    }
    if (APPLY && exposed.length) {
        console.log('Send each official their new code. The old codes no longer work; officials need to enter the new one on Verify.');
    }
}

main().then(() => process.exit(0), err => { console.error(err); process.exit(1); });
