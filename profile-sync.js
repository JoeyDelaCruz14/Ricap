// Profile data shared between pages: the profile key (email or official code), Firebase uids the
// user has had, the profile picture (Firebase Storage + Auth photoURL) and the profiles/ document
// that Maintenance reads. Pictures are checked, cropped to 256x256 and re-encoded (EXIF removed).
// Sa madaling salita: dito ina-upload at kinukuha ang profile picture para pareho ito sa lahat ng pahina.

import { db, storage, auth } from './firebase-config.js';
import { doc, setDoc, deleteDoc, serverTimestamp, arrayUnion } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js';
import { updateProfile } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { ensureAuth } from './Session.js';
import { getAccount, isLocalLoggedIn, getOfficialSession, isVerifiedUser } from './account.js';
export const PROFILES = 'profiles';
const AVATAR_PREFIX = 'ricapAvatar:';
const UIDS_PREFIX = 'ricapUids:';
export const AVATAR_SIZE = 256;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

const AVATAR_FOLDER = 'profile-pictures';

// Who the profile belongs to on this device: email:<email> or code:<CODE>.
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

// Adds a uid to that list.
export function rememberUid(uid) {
    const key = profileKey();
    if (!key || !uid) return;
    const list = knownUids();
    if (list.includes(uid)) return;
    try { localStorage.setItem(UIDS_PREFIX + key, JSON.stringify([...list, uid])); } catch (e) {  }
}

// The signed-in email/password user, or null (anonymous users have no picture).
function photoUser() {
    const u = auth.currentUser;
    return u && !u.isAnonymous ? u : null;
}

// Only users with a Firebase email/password login have a uid that stays the same everywhere.
export function canHaveAvatar() {
    return !!photoUser();
}

// The picture's Storage URL. Old versions kept a base64 copy here; those are ignored.
export function getAvatar() {
    const u = photoUser();
    if (u && u.photoURL) return u.photoURL;
    const key = profileKey();
    if (!key) return '';
    try {
        const v = localStorage.getItem(AVATAR_PREFIX + key) || '';
        return /^https:\/\//.test(v) ? v : '';
    } catch (e) { return ''; }
}

// Remembers the picture URL on this device (an empty URL removes it).
export function setAvatar(url) {
    const key = profileKey();
    if (!key) return false;
    try {
        if (url) localStorage.setItem(AVATAR_PREFIX + key, url);
        else localStorage.removeItem(AVATAR_PREFIX + key);
        return true;
    } catch (e) { return false; }
}

// A base64 picture saved by the old version on this device, waiting to be moved to Storage.
export function legacyAvatar() {
    const key = profileKey();
    if (!key) return '';
    try {
        const v = localStorage.getItem(AVATAR_PREFIX + key) || '';
        return /^data:image\//.test(v) ? v : '';
    } catch (e) { return ''; }
}

// Error with a code, so the UI can show its message as-is.
function avatarError(message, code) {
    const e = new Error(message);
    e.code = code;
    return e;
}

// Checks the file's first bytes, not its name or the type the browser guessed.
export async function checkAvatarFile(file) {
    if (!file) throw avatarError('Choose an image file.', 'avatar/no-file');
    if (file.size > AVATAR_MAX_BYTES) throw avatarError('That image is larger than 2 MB. Choose a smaller one.', 'avatar/too-large');
    const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const text = (from, to) => String.fromCharCode(...b.slice(from, to));
    const jpeg = b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
    const png = b[0] === 0x89 && text(1, 4) === 'PNG';
    const webp = text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP';
    if (!jpeg && !png && !webp) throw avatarError('Only JPEG, PNG or WebP images can be used.', 'avatar/wrong-type');
}

// Draws the chosen square of the image onto a fresh canvas. Re-encoding drops all EXIF data, GPS included.
export function renderAvatar(img, crop) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, crop.x, crop.y, crop.side, crop.side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    const encode = type => new Promise(resolve => canvas.toBlob(resolve, type, 0.85));
    return encode('image/webp').then(blob => (blob && blob.type === 'image/webp') ? blob : encode('image/jpeg'))
        .then(blob => {
            if (!blob) throw avatarError('That image could not be read.', 'avatar/unreadable');
            return blob;
        });
}

// Tells other scripts on the page (nav, profile) that the picture changed.
function announceAvatar(url) {
    window.dispatchEvent(new CustomEvent('ricap:avatar-change', { detail: { url } }));
}

// The signed-in user; throws if logged out or offline.
function requireOnlineUser() {
    const user = photoUser();
    if (!user) throw avatarError('Log in with your RiCap account to change your profile picture.', 'avatar/not-signed-in');
    if (!navigator.onLine) throw avatarError('No connection. Check your internet and try again.', 'avatar/offline');
    return user;
}

// Uploads the picture to profile-pictures/<uid> and saves its URL on the account.
export async function uploadAvatar(blob) {
    const user = requireOnlineUser();
    const fileRef = storageRef(storage, AVATAR_FOLDER + '/' + user.uid);
    await uploadBytes(fileRef, blob, { contentType: blob.type, cacheControl: 'public, max-age=31536000' });
    // The path never changes, so the version keeps browsers from showing the old picture.
    const url = (await getDownloadURL(fileRef)) + '&v=' + Date.now();
    await updateProfile(user, { photoURL: url });
    setAvatar(url);
    announceAvatar(url);
    syncProfile({ avatarUpdatedAt: serverTimestamp() }).catch(err => console.warn('RiCap: could not publish profile', err && err.code));
    return url;
}

// Deletes the picture and clears it from the account.
export async function removeAvatar() {
    const user = requireOnlineUser();
    try {
        await deleteObject(storageRef(storage, AVATAR_FOLDER + '/' + user.uid));
    } catch (err) {
        if (!err || err.code !== 'storage/object-not-found') throw err;
    }
    await updateProfile(user, { photoURL: null });
    setAvatar('');
    announceAvatar('');
    syncProfile({ avatarUpdatedAt: serverTimestamp() }).catch(err => console.warn('RiCap: could not publish profile', err && err.code));
}

// Readable message for an upload or remove error.
export function avatarErrorMessage(err) {
    const code = String((err && err.code) || '');
    if (code.indexOf('avatar/') === 0) return err.message;
    if (!navigator.onLine || /retry-limit|network|unavailable/.test(code)) return 'No connection. Check your internet and try again.';
    if (/unauthorized|unauthenticated|requires-recent-login/.test(code)) return 'You can only change your own picture. Log out, log in again and retry.';
    if (/quota/.test(code)) return 'The service is busy right now. Try again in a minute.';
    return 'Could not update the profile picture. Try again.';
}

// Account deletion: removes profiles/{key} and the picture and uid lists kept on this device.
export async function forgetProfile() {
    const key = profileKey();
    if (!key) return;
    try { await deleteDoc(doc(db, PROFILES, encodeURIComponent(key))); }
    catch (err) { console.warn('RiCap: could not delete the profile record', err && err.code); }
    try {
        localStorage.removeItem(AVATAR_PREFIX + key);
        localStorage.removeItem(UIDS_PREFIX + key);
    } catch (e) {  }
}

// Publishes this browser's verified user to profiles/{key} for Maintenance.
export async function syncProfile(extra = {}) {
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
        ...extra,
        updatedAt: serverTimestamp()
    }, { merge: true });
    return true;
}
