import { db, storage } from './firebase-config.js';
import {collection, addDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import {
    ref,
    uploadBytes,
    getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js';

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

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB

navToggle?.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(open));
});

function showError(msg) {
    applyError.textContent = msg;
    applyError.hidden = false;
}

function clearError() {
    applyError.hidden = true;
    applyError.textContent = '';
}

function normalizePhone(raw) {
    const p = raw.replace(/[\s-]/g, '');
    if (/^09\d{9}$/.test(p)) return '+63' + p.slice(1);
    if (/^\+639\d{9}$/.test(p)) return p;
    return null;
}

phoneEl.addEventListener('input', () => {
    phoneEl.value = phoneEl.value.replace(/[\s-]/g, '');
});

function showState(state) {
    captureEmpty.hidden = state !== 'empty';
    captureLive.hidden = state !== 'live';
    capturePreview.hidden = state !== 'preview';
}

function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
    }
    video.srcObject = null;
}

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

    const phone = normalizePhone(phoneEl.value);
    if (!phone) {
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

    try {
        const ext = photoBlob.type === 'image/png' ? 'png' : 'jpg';
        const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const photoRef = ref(storage, `applications/${name}`);
        await uploadBytes(photoRef, photoBlob, { contentType: photoBlob.type || 'image/jpeg' });
        const photoUrl = await getDownloadURL(photoRef);
        await addDoc(collection(db, 'applications'), {
            fullName: $('fullName').value.trim(),
            role: $('roleInput').value,
            organization: $('orgInput').value.trim(),
            email: $('emailInput').value.trim().toLowerCase(),
            phone,                    
            photoUrl,
            photoPath: photoRef.fullPath,
            status: 'pending',
            createdAt: serverTimestamp()
        });
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