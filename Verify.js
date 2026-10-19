// Verify page (Verify.html): application form for official access, with an ID photo from the
// camera or an upload. Saves the application to the Realtime Database and the photo to Storage.
// Sa madaling salita: dito nag-a-apply ang user para maging opisyal, kasama ang litrato ng ID.

import { rtdb, storage } from './firebase-config.js';
import { ref as dbRef, push, serverTimestamp
} from //'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import {
    ref,
    uploadBytes,
    getDownloadURL
} from //'https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js';
import { isVerifiedUser, isLocalLoggedIn, getAccount } from './account.js';
import { getApplicationStatus, setApplicationStatus } from './registry.js';
import { verifyCode } from './Session.js';

const $ = id => document.getElementById(id);
const navToggle = $('navToggle');
const navLinks = $('navLinks');
const form = $('applyForm');
const formSection = $('applyFormSection');
const successSection = $('applySuccess');
const applyError = $('applyError');
const submitBtn = $('applySubmitBtn');
const phoneEl = $('phoneInput');
const captureEmpty = $('captureEmpty');
const captureLive = $('captureLive');
const capturePreview = $('capturePreview');
const startCameraBtn = $('startCameraBtn');
const uploadInsteadBtn = $('uploadInsteadBtn');
const fileInput = $('fileInput');
const video = $('cameraVideo');
const snapBtn = $('snapBtn');
const cameraError = $('cameraError');
const capturedImg = $('capturedImg');
const retakeBtn = $('retakeBtn');
const canvas = $('captureCanvas');

let stream = null;
let photoBlob = null;
let previewUrl = null;

const MAX_FILE_BYTES = 8 * 1024 * 1024;

if (isVerifiedUser()) {
    formSection.hidden = true;
    successSection.hidden = false;
    successSection.querySelector('.success-title').textContent = "You're already verified";
    successSection.querySelector('.success-copy').textContent =
        'Your account already has official access, so there is no need to apply again.';
}

// Logged-in users apply under the name they signed up with: first and last name are filled in
// from the account and locked. (Runs before apply-enhance.js, which then builds the full name.)
(function lockNamesToAccount() {
    const a = isLocalLoggedIn() ? getAccount() : null;
    if (!a) return;
    const parts = String(a.name || '').trim().split(/\s+/);
    const first = String(a.firstName || parts[0] || '').trim();
    const last = String(a.lastName || parts.slice(1).join(' ') || '').trim();
    [['firstName', first], ['lastName', last]].forEach(([id, value]) => {
        const input = $(id);
        if (!input || !value) return;
        input.value = input.defaultValue = value;
        input.readOnly = true;
        input.title = 'From your RiCap account';
    });
    const hint = $('nameFromAccount');
    if (hint && first && last) hint.hidden = false;
})();

// "Already have an access code?": redeems the code here, the same way as on the Scanner page.
const codeForm = $('codeForm');
codeForm?.addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('codeInput');
    const btn = $('codeBtn');
    const err = $('codeError');
    const code = input.value.trim().toUpperCase();
    err.hidden = true;
    if (!code) {
        err.textContent = 'Enter the access code from your approval email.';
        err.hidden = false;
        input.focus();
        return;
    }
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
        const official = await verifyCode(code);
        window.dispatchEvent(new Event('storage'));   // lets the nav show the Scanner link right away
        formSection.hidden = true;
        successSection.hidden = false;
        successSection.querySelector('.success-title').textContent = 'Access code accepted';
        successSection.querySelector('.success-copy').textContent =
            'Welcome' + (official && official.name ? ', ' + official.name : '') +
            '. You can now submit official river reports from the Scanner.';
        successSection.querySelector('.success-actions').innerHTML =
            '<a href="Image_Processing.html" class="submit-btn">Go to Scanner</a>' +
            '<a href="Home.html" class="ghost-btn">Back to Home</a>';
<<<<<<< HEAD
        } catch (ex) {
        console.warn('RiCap: access code check failed', ex && (ex.code || ex.message));
        err.textContent = /Invalid or inactive/i.test(ex && ex.message)
            ? "That code didn't match an active official account. Check it and try again."
            : (!navigator.onLine
                ? 'You are offline. Connect to the internet and try again.'
                : "Couldn't verify that code right now. Please try again.");
=======
    } catch (ex) {
        console.warn('RiCap: access code check failed', ex && (ex.code || ex.message));
        err.textContent = /Invalid or inactive/i.test(ex && ex.message)
            ? 'That code didn’t match an active official account. Check it and try again.'
            : (!navigator.onLine
                ? 'You are offline. Connect to the internet and try again.'
                : 'Couldn’t verify that code right now. Please try again.');
>>>>>>> 69a60d4bd80cec7df8c2b26dc41dfb3cfe2cf4b7
        err.hidden = false;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Verify code';
    }
});

navToggle?.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    navToggle.classList.toggle('open', open);
    navToggle.setAttribute('aria-expanded', String(open));
});

// Shows a form error.
function showError(msg) {
    applyError.textContent = msg;
    applyError.hidden = false;
}

// Hides the form error.
function clearError() {
    applyError.hidden = true;
    applyError.textContent = '';
}

// PH mobile number to +639XXXXXXXXX, or null.
function normalizePhone(raw) {
    const p = raw.replace(/[\s-]/g, '');
    if (/^09\d{9}$/.test(p)) return '+63' + p.slice(1);
    if (/^\+639\d{9}$/.test(p)) return p;
    return null;
}

phoneEl.addEventListener('input', () => {
    phoneEl.value = phoneEl.value.replace(/[\s-]/g, '');
});

// Switches the ID photo box between empty, live camera and preview.
function showState(state) {
    captureEmpty.hidden = state !== 'empty';
    captureLive.hidden = state !== 'live';
    capturePreview.hidden = state !== 'preview';
}

// Stops the camera stream.
function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
    }
    video.srcObject = null;
}

// Clears the captured or uploaded photo.
function resetPhoto() {
    stopCamera();
    photoBlob = null;
    if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
    }
    capturedImg.removeAttribute('src');
    fileInput.value = '';
    cameraError.hidden = true;
    showState('empty');
}

// Uses this image as the ID photo and shows the preview.
function setPhoto(blob) {
    photoBlob = blob;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(blob);
    capturedImg.src = previewUrl;
    stopCamera();
    showState('preview');
}

startCameraBtn.addEventListener('click', async () => {
    clearError();
    cameraError.hidden = true;

    if (!navigator.mediaDevices?.getUserMedia) {
        showError('Camera is not supported on this browser. Please upload a photo instead.');
        return;
    }

    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user' },
            audio: false
        });
        video.srcObject = stream;
        showState('live');
    } catch (err) {
        console.error('RiCap: camera error', err);
        showError('Could not access the camera. Allow camera permission, or upload a photo instead.');
        showState('empty');
    }
});

snapBtn.addEventListener('click', () => {
    if (!video.videoWidth) {
        cameraError.textContent = 'Camera is still starting. Try again in a moment.';
        cameraError.hidden = false;
        return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(blob => {
        if (!blob) {
            cameraError.textContent = 'Could not capture the photo. Please try again.';
            cameraError.hidden = false;
            return;
        }
        setPhoto(blob);
    }, 'image/jpeg', 0.85);
});

uploadInsteadBtn.addEventListener('click', () => {
    clearError();
    fileInput.click();
});

fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showError('Please choose an image file.');
        fileInput.value = '';
        return;
    }
    if (file.size > MAX_FILE_BYTES) {
        showError('That image is too large. Please choose one under 8 MB.');
        fileInput.value = '';
        return;
    }

    clearError();
    setPhoto(file);
});

retakeBtn.addEventListener('click', resetPhoto);

window.addEventListener('beforeunload', stopCamera);

form.addEventListener('submit', async e => {
    e.preventDefault();
    clearError();

    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const phoneRaw = phoneEl.value.trim();
    const phone = phoneRaw ? normalizePhone(phoneRaw) : '';
    if (phoneRaw && !phone) {
        showError('Please enter a valid mobile number (e.g. 09171234567).');
        phoneEl.focus();
        return;
    }

    if (!photoBlob) {
        showError('Please take a photo or upload an ID picture.');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    const email = $('emailInput').value.trim().toLowerCase();
    let status = null;
    try { status = await getApplicationStatus(email); }
    catch (err) { console.warn('RiCap: could not check application status', err); }
    if (status === 'approved' || status === 'pending') {
        showError(status === 'approved'
            ? 'This email is already verified. Log in with it to use official access.'
            : 'An application for this email is already waiting for admin review.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit application';
        return;
    }

    try {
        const ext = photoBlob.type === 'image/png' ? 'png' : 'jpg';
        const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const photoRef = ref(storage, `applications/${name}`);
        await uploadBytes(photoRef, photoBlob, { contentType: photoBlob.type || 'image/jpeg' });
        const photoURL = await getDownloadURL(photoRef);
        await push(dbRef(rtdb, 'officialApplications'), {
            fullName: $('fullName').value.trim(),
            role: $('roleInput').value,
            organization: $('orgInput').value.trim(),
            email,
            phone,
            photoURL,
            photoPath: photoRef.fullPath,
            status: 'pending',
            submittedAt: serverTimestamp()
        });
        try { await setApplicationStatus(email, 'pending'); }
        catch (err) { console.warn('RiCap: could not record application status', err); }
        formSection.hidden = true;
        successSection.hidden = false;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
        console.error('RiCap: application failed', err);
        showError('Something went wrong while submitting. Please try again.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit application';
    }
});