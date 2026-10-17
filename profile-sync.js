import { db } from './firebase-config.js';
import { doc, setDoc, serverTimestamp, arrayUnion } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { ensureAuth } from './Session.js';
import { getAccount, isLocalLoggedIn, getOfficialSession, isVerifiedUser } from './account.js';

// profiles/{email or code} -> what admins see for each verified user in the Maintenance module.
// Logging out signs the browser out of Firebase, so one person can collect several uids over time;
// all of them are kept in `uids` so every report they posted (reports.uid) still matches.
export const PROFILES = 'profiles';
const AVATAR_PREFIX = 'ricapAvatar:';
const UIDS_PREFIX = 'ricapUids:';
export const AVATAR_SIZE = 256;

// Who the avatar belongs to on this device: the logged-in account, else the official code.
export function profileKey() {
    const a = isLocalLoggedIn() ? getAccount() : null;
    if (a && a.email) return 'email:' + String(a.email).trim().toLowerCase();
    const o = getOfficialSession();
    if (o && o.code) return 'code:' + String(o.code).toUpperCase();
    return '';
}

// Every Firebase uid this profile has used on this device.
export function knownUids() {
    const key = profileKey();
    if (!key) return [];
    try {
        const list = JSON.parse(localStorage.getItem(UIDS_PREFIX + key) || '[]');
        return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
}

export function rememberUid(uid) {
    const key = profileKey();
    if (!key || !uid) return;
    const list = knownUids();
    if (list.includes(uid)) return;
    try { localStorage.setItem(UIDS_PREFIX + key, JSON.stringify([...list, uid])); } catch (e) {  }
}

export function getAvatar() {
    const key = profileKey();
    if (!key) return '';
    try { return localStorage.getItem(AVATAR_PREFIX + key) || ''; } catch (e) { return ''; }
}

export function setAvatar(dataUrl) {
    const key = profileKey();
    if (!key) return false;
    try {
        if (dataUrl) localStorage.setItem(AVATAR_PREFIX + key, dataUrl);
        else localStorage.removeItem(AVATAR_PREFIX + key);
        return true;
    } catch (e) { return false; }
}

// Center-crops the picked image to a square JPEG small enough to keep in a Firestore document.
export function resizeAvatar(file) {
    return new Promise((resolve, reject) => {
        if (!file || !/^image\//.test(file.type)) { reject(new Error('Choose an image file.')); return; }
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const side = Math.min(img.width, img.height);
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = AVATAR_SIZE;
            canvas.getContext('2d').drawImage(img,
                (img.width - side) / 2, (img.height - side) / 2, side, side,
                0, 0, AVATAR_SIZE, AVATAR_SIZE);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image could not be read.')); };
        img.src = url;
    });
}

// Publishes this browser's verified user to profiles/{key}. Unverified users are skipped.
export async function syncProfile() {
    const key = profileKey();
    if (!isVerifiedUser() || !key) return false;
    const a = isLocalLoggedIn() ? getAccount() : null;
    const o = getOfficialSession();
    const uid = await ensureAuth();
    if (!uid) return false;
    rememberUid(uid);
    await setDoc(doc(db, PROFILES, encodeURIComponent(key)), {
        key,
        uid,
        uids: arrayUnion(...knownUids()),
        name: String((a && a.name) || (o && o.name) || '').slice(0, 80),
        email: String((a && a.email) || '').slice(0, 120),
        phone: String((a && a.phone) || '').slice(0, 20),
        role: String((o && o.role) || '').slice(0, 80),
        organization: String((o && o.organization) || '').slice(0, 120),
        officialCode: String((o && o.code) || ''),
        verified: true,
        avatar: getAvatar(),
        updatedAt: serverTimestamp()
    }, { merge: true });
    return true;
}
