import { rtdb } from './firebase-config.js';
import { ref, get } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

// Citizens also sign in with Firebase email/password, so being signed in no longer means admin.
// An admin is, in order:
//   1. the admin email your Realtime Database rules already trust (auth.token.email === ...),
//      kept here only as a SHA-256 hash so the address isn't readable in the page source;
//   2. a user with the `admin` custom claim;
//   3. a user listed at admins/{uid} = true (optional, needs the rule in firebase-rules-proposed.md).
// To add another admin email: run
//   node -e "console.log(require('crypto').createHash('sha256').update('EMAIL'.toLowerCase()).digest('hex'))"
// and add the result below, and add the same email to your database rules.
const ADMIN_EMAIL_HASHES = [
    'cac54a617fd7b644a80e0b1dcaff4015406d4cbbb20a779bf43c3fdbb3c039f4'
];
const checks = new Map();

// SHA-256 hash of a text, as hex.
async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

// True if the user's email is one of the admin emails.
async function hasAdminEmail(user) {
    if (!user.email || !window.crypto || !crypto.subtle) return false;
    return ADMIN_EMAIL_HASHES.includes(await sha256Hex(user.email.trim().toLowerCase()));
}

// True if admins/{uid} is true in the Realtime Database.
async function isListedAdmin(user) {
    try {
        const snap = await get(ref(rtdb, 'admins/' + user.uid));
        return snap.val() === true;
    } catch (e) {
        return false; // admins/ has no read rule yet, so the read is denied
    }
}

// Resolves true if this Firebase user is an admin. The answer is cached per uid.
export function isAdminUser(user) {
    if (!user || user.isAnonymous) return Promise.resolve(false);
    if (!checks.has(user.uid)) {
        const check = (async () => {
            if (await hasAdminEmail(user)) return true;
            const token = await user.getIdTokenResult();
            if (token.claims.admin === true) return true;
            return isListedAdmin(user);
        })();
        check.catch(() => checks.delete(user.uid));
        checks.set(user.uid, check.catch(() => false));
    }
    return checks.get(user.uid);
}
