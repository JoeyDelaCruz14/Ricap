import { rtdb } from './firebase-config.js';
import { ref, get } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

// Citizens also sign in with Firebase email/password, so being signed in no longer means admin.
// An admin is a user with the `admin` custom claim, or listed at admins/{uid} = true in the
// Realtime Database (add the uid there in the Firebase console).
const checks = new Map();

export function isAdminUser(user) {
    if (!user || user.isAnonymous) return Promise.resolve(false);
    if (!checks.has(user.uid)) {
        const check = (async () => {
            const token = await user.getIdTokenResult();
            if (token.claims.admin === true) return true;
            const snap = await get(ref(rtdb, 'admins/' + user.uid));
            return snap.val() === true;
        })();
        check.catch(() => checks.delete(user.uid));
        checks.set(user.uid, check.catch(() => false));
    }
    return checks.get(user.uid);
}
