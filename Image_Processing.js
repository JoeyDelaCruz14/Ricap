import { storage, auth, db } from './firebase-config.js';
import { ref as storageRef, uploadString, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js';
import { signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { getOfficial, verifyCode, signOutOfficial } from './Session.js';
import { initSteps, onImageFile, getSelection, refreshGate, isGateVerified } from './scanner-steps.js';
import { getRecommendation, DISCLAIMER } from './Gemini.js';

let clipModPromise = null;
function getClipGate() {
    if (!clipModPromise) {
        clipModPromise = import('./clip-gate.js').catch(function (err) {
            clipModPromise = null;
            throw err;
        });
    }
    return clipModPromise;
}

getClipGate()
    .then(function (m) { return m.loadClipGate(); })
    .catch(function (e) { console.warn('[CLIP] preload failed', e); });

function initNav() {
    const nav = document.getElementById('siteNav');
    const toggle = document.getElementById('navToggle');
    const links = document.getElementById('navLinks');
    function onScroll() {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        nav.classList.toggle('scrolled', scrollTop > 12);
    }

    function onToggleClick() {
        const isOpen = links.classList.toggle('open');
        toggle.classList.toggle('open', isOpen);
        toggle.setAttribute('aria-expanded', String(isOpen));
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    toggle.addEventListener('click', onToggleClick);
    links.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function () {
            links.classList.remove('open');
            toggle.classList.remove('open');
            toggle.setAttribute('aria-expanded', 'false');
        });
    });
    onScroll();
}

const STORAGE_FOLDER = 'Submitted images';
const UPLOAD_MAX_DIM = 1600;

let firebaseAuthReady = null;

function ensureFirebaseAuth() {
    if (!firebaseAuthReady) {
        firebaseAuthReady = auth.authStateReady().then(function () {
            if (auth.currentUser) return;
            return signInAnonymously(auth).then(function () { });
        });
        firebaseAuthReady.catch(function () { firebaseAuthReady = null; });
    }
    return firebaseAuthReady;
}
async function uploadSubmittedImage(recordId, dataUrl, meta) {
    await ensureFirebaseAuth();
    const fileRef = storageRef(storage, STORAGE_FOLDER + '/' + recordId + '.jpg');
    const snap = await uploadString(fileRef, dataUrl, 'data_url', {
        contentType: 'image/jpeg',
        customMetadata: {
            status: String(meta.status),
            score: String(meta.score),
            submittedAt: meta.timestamp
        }
    });
    const url = await getDownloadURL(snap.ref);
    return { path: snap.ref.fullPath, url: url };
}

const RECORDS_KEY = 'ricap_river_records';
const MAX_RECORDS = 40;
const THUMB_MAX_DIM = 640;

function loadRecords() {
    try {
        const raw = localStorage.getItem(RECORDS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error('Could not read saved records:', err);
        return [];
    }
}

function saveRecords(records) {
    let list = records;
    while (list.length) {
        try {
            localStorage.setItem(RECORDS_KEY, JSON.stringify(list));
            return true;
        } catch (err) {
            console.warn('Storage full, dropping oldest record and retrying');
            list = list.slice(0, -1);
        }
    }
    return false;
}

function makeRecordId() {
    return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function createStoredImage(imageDataUrl, maxDim) {
    const limit = maxDim || THUMB_MAX_DIM;
    return new Promise(function (resolve) {
        const img = new Image();
        img.onload = function () {
            const scale = Math.min(1, limit / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = function () { resolve(imageDataUrl); };
        img.src = imageDataUrl;
    });
}
const BATAAN = { south: 14.33, west: 120.02, north: 14.97, east: 120.66 };

function inBataan(lat, lng) {
    return lat >= BATAAN.south && lat <= BATAAN.north && lng >= BATAAN.west && lng <= BATAAN.east;
}

const GOOD_ACCURACY_M = 25;    
const WARN_ACCURACY_M = 150;    
const LOCATION_WAIT_MS = 15000;  
const MAX_ACCEPT_ACCURACY_M = 1000;  
const DEV_FAKE_LOCATION = null;

function getUserLocation() {
    if (DEV_FAKE_LOCATION) return Promise.resolve(DEV_FAKE_LOCATION);
    return new Promise(function (resolve, reject) {
        if (!navigator.geolocation) {
            return reject(new Error('This browser does not support location.'));
        }

        let best = null;
        let watchId = null;
        let done = false;
        let timer = null;

        function finish() {
            if (done) return;
            done = true;
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
            clearTimeout(timer);
            if (best) resolve(best);
            else reject(new Error('Could not get your location. Try again outdoors.'));
        }

        timer = setTimeout(finish, LOCATION_WAIT_MS);

        watchId = navigator.geolocation.watchPosition(
            function (p) {
                const fix = {
                    lat: p.coords.latitude,
                    lng: p.coords.longitude,
                    accuracy: Math.round(p.coords.accuracy)
                };
                if (!best || fix.accuracy < best.accuracy) best = fix;
                updateScanLabel('Getting exact location… ±' + best.accuracy + ' m');
                if (best.accuracy <= GOOD_ACCURACY_M) finish();
            },
            function (err) {
                if (done) return;
                if (best) return finish();
                done = true;
                clearTimeout(timer);
                if (watchId !== null) navigator.geolocation.clearWatch(watchId);
                reject(new Error(err.code === 1
                    ? 'Location permission was denied. Allow location access to submit an official report.'
                    : 'Could not get your location. Try again outdoors.'));
            },
            { enableHighAccuracy: true, timeout: LOCATION_WAIT_MS, maximumAge: 0 }
        );
    });
}


function getRiverList() {
    try { if (typeof RIVER_DATA !== 'undefined' && Array.isArray(RIVER_DATA)) return RIVER_DATA; } catch (e) { }
    try { if (typeof RICAP_RIVERS !== 'undefined' && Array.isArray(RICAP_RIVERS)) return RICAP_RIVERS; } catch (e) { }
    try { if (typeof rivers !== 'undefined' && Array.isArray(rivers)) return rivers; } catch (e) { }
    if (Array.isArray(window.RIVER_DATA)) return window.RIVER_DATA;
    if (Array.isArray(window.RICAP_RIVERS)) return window.RICAP_RIVERS;
    if (Array.isArray(window.rivers)) return window.rivers;
    console.warn('RiCap: no river data found. Check the variable name in mapping-data.js');
    return [];
}

const COAST_LABELS = {
    east: 'Manila Bay side (east coast)',
    west: 'South China Sea side (west coast)'
};


function buildRecommendation(a) {
    const w = a.waterQuality && a.waterQuality.label;
    if (w === 'oil') {
        return 'Possible oil contamination. Alert the barangay, DENR and the Coast Guard. Avoid contact with the water and do not use it. Re-scan after cleanup.';
    }
    if (w === 'chemical') {
        return 'Possible chemical contamination. Alert the barangay, DENR and the local health office. Avoid contact, do not use the water, and trace the source.';
    }
    if (w === 'polluted') {
        return 'Visibly polluted water. Report to the barangay and DENR, trace the source of discharge, and avoid contact with the water.';
    }
    if (w === 'sewage') {
        return 'Possible sewage discharge. Report to the barangay health office and DENR, trace the source, and avoid contact with the water.';
    }
    if (w === 'algae') {
        return 'Algae growth detected. Check for nutrient runoff upstream, avoid using the water, and monitor weekly.';
    }
    if (w === 'garbage_covered') {
        return 'Water surface is covered with garbage. Schedule an urgent cleanup and report to the barangay and DENR.';
    }
    const t = a.waterTint && a.waterTint.level;
    if ((t === 'murky' || t === 'heavily turbid') && a.status !== 'healthy' && !(a.items && a.items.length)) {
        return 'Brown, turbid water: a high sediment load. Check upstream for erosion, quarrying, construction or farm runoff, avoid using the water, and re-scan once the water settles after rain.';
    }
    if (a.status === 'polluted') {
        return 'Alert the barangay and DENR for cleanup. Avoid contact with the water. Re-scan after cleanup to confirm improvement.';
    }
    if (a.status === 'moderate') {
        return 'Schedule a community cleanup and remove visible litter. Monitor this spot weekly.';
    }
    if (w === 'clean') {
        return 'Water appears clean and healthy. No cleanup action is needed. Keep this spot on the monitoring schedule so any change is caught early, and discourage littering nearby.';
    }
    return 'No action needed. Keep monitoring and discourage littering nearby.';
}


function recommendationFor(a) {
    const sel = getSelection();
    const official = getOfficial() || {};
    return getRecommendation(a, sel.ok ? sel.label.split(' · ')[0] : '', {
        ruleText: buildRecommendation(a),
        role: official.role,
        uid: auth.currentUser ? auth.currentUser.uid : null
    });
}


function askReportDetails(warnings, selection) {
    return new Promise(function (resolve) {
        const overlay = document.createElement('div');
        overlay.className = 'report-dialog-backdrop';

        const allWarnings = (warnings || []).map(function (w) { return w.message; })
            .concat(selection.warnings || []);
        const warnHtml = allWarnings.length
            ? '<p class="report-dialog-warn">Heads up: ' + allWarnings.map(escapeHtml).join(' ') + '</p>'
            : '';

        overlay.innerHTML =
            '<div class="report-dialog" role="dialog" aria-modal="true" aria-labelledby="rpTitle">' +
            '<h3 id="rpTitle">Submit official report</h3>' +
            '<p class="report-dialog-copy">Your photo and result will be saved to Tracking, the Map and the Forum.</p>' +
            '<p class="report-dialog-target"><span>Saving to</span><strong>' + escapeHtml(selection.label) + '</strong></p>' +
            warnHtml +
            '<label class="field-label" for="rpName">Report name</label>' +
            '<input id="rpName" class="field-input" maxlength="80" placeholder="e.g. Lamao River \u2013 near bridge">' +
            '<p id="rpErr" class="file-error" role="alert" hidden></p>' +
            '<div class="report-dialog-actions">' +
            '<button id="rpCancel" class="btn btn-outline" type="button">Cancel</button>' +
            '<button id="rpOk" class="btn btn-solid" type="button">Submit</button>' +
            '</div></div>';

        document.body.appendChild(overlay);
        const nameInput = overlay.querySelector('#rpName');
        const errEl = overlay.querySelector('#rpErr');
        nameInput.focus();

        function close(result) {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            resolve(result);
        }
        function submit() {
            const name = nameInput.value.trim();
            if (name.length < 3) {
                errEl.textContent = 'Please enter a report name (at least 3 characters).';
                errEl.hidden = false;
                nameInput.focus();
                return;
            }
            close({ name: name });
        }
        function onKey(e) {
            if (e.key === 'Escape') close(null);
            if (e.key === 'Enter' && document.activeElement === nameInput) submit();
        }
        document.addEventListener('keydown', onKey);
        overlay.querySelector('#rpCancel').addEventListener('click', function () { close(null); });
        overlay.querySelector('#rpOk').addEventListener('click', submit);
    });
}

function friendlyError(err) {
    const code = String((err && err.code) || '');
    if (!navigator.onLine || /unavailable|network|retry-limit|deadline/.test(code)) {
        return 'No connection to the server, so nothing was saved. Check your internet and press Submit again \u2014 your scan is kept.';
    }
    if (/permission-denied|unauthorized/.test(code)) {
        return 'The server did not accept this report because your official access could not be confirmed. Press \u201cnot you?\u201d, enter your access code again, then submit.';
    }
    if (/unauthenticated/.test(code)) {
        return 'Your session expired. Reload the page, then submit again.';
    }
    if (/quota|resource-exhausted/.test(code)) {
        return 'The service is busy right now. Wait a minute and submit again.';
    }
    return (err && err.message) || 'Something went wrong while saving. Try again.';
}

async function submitOfficialReport(analysis, imageDataUrl, details) {
    const selection = details.selection;
    const loc = selection.loc;
    const riverId = selection.riverId;
    const segmentId = selection.segmentId;
    const official = getOfficial() || {};

    await ensureFirebaseAuth();
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    if (!uid) {
        const e = new Error('Your session expired.');
        e.code = 'unauthenticated';
        throw e;
    }

    const recordId = makeRecordId();
    const timestamp = new Date().toISOString();
    const reco = await recommendationFor(analysis);
    const recommendation = reco.text;

    const uploadImage = await createStoredImage(imageDataUrl, UPLOAD_MAX_DIM);
    const uploaded = await uploadSubmittedImage(recordId, uploadImage, {
        status: analysis.status,
        score: analysis.score,
        timestamp: timestamp
    });

    const reportDoc = {
        recordId: recordId,
        reportName: details.name,
        riverId: riverId,
        segmentId: segmentId,
        lat: loc.lat,
        lng: loc.lng,
        accuracy: loc.accuracy,
        locationSource: loc.source,
        status: analysis.status,
        score: analysis.score,
        assessment: analysis.assessment,
        recommendation: recommendation,
        recommendationRules: reco.rulesText,
        recommendationSource: reco.source,
        waterTint: analysis.waterTint || null,
        imageUrl: uploaded.url,
        reporterName: official.name || '',
        reporterRole: official.role || '',
        reporterCode: official.code || '',
        uid: uid,
        createdAt: serverTimestamp()
    };
    try {
        await addDoc(collection(db, 'reports'), reportDoc);
    } catch (err) {
        if (!/permission-denied/.test(err && err.code)) throw err;
        delete reportDoc.recommendationRules;
        delete reportDoc.recommendationSource;
        await addDoc(collection(db, 'reports'), reportDoc);
    }

    const thumb = await createStoredImage(imageDataUrl, THUMB_MAX_DIM);
    const record = {
        id: recordId,
        timestamp: timestamp,
        name: details.name,
        riverId: riverId,
        segmentId: segmentId,
        image: thumb,
        firebasePath: uploaded.path,
        firebaseUrl: uploaded.url,
        lat: loc.lat,
        lng: loc.lng,
        accuracy: loc.accuracy,
        locationSource: loc.source,
        status: analysis.status,
        score: analysis.score,
        confidence: analysis.confidence,
        assessment: analysis.assessment,
        recommendation: recommendation,
        recommendationRules: reco.rulesText,
        recommendationSource: reco.source,
        colorCast: analysis.colorCast,
        waterTint: analysis.waterTint,
        surfaceClarity: analysis.surfaceClarity,
        lighting: analysis.lighting,
        clutterReading: analysis.clutterReading,
        overallReading: analysis.overallReading,
        warnings: analysis.warnings,
        pollutionObjects: analysis.items,
        contextObjects: analysis.contextItems,
        avgColor: analysis.stats.avgColor,
        sampledPixels: analysis.stats.sampledPixels,
        reported: true
    };

    const records = loadRecords();
    records.unshift(record);
    if (!saveRecords(records.slice(0, MAX_RECORDS))) {
        throw new Error('Could not save the record in this browser (storage full or blocked).');
    }
    return record.id;
}

const scannerState = {
    file: null,
    dataUrl: null,
    isScanning: false,
    isSubmitting: false,
    pending: null,
    submitted: false,
    lastRecordId: null,
    lastDetections: null
};

function ensureSubmitButton() {
    let btn = document.getElementById('submitReportBtn');
    if (btn) return btn;
    const actions = document.getElementById('quickreadActions');
    if (!actions) return null;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'submitReportBtn';
    btn.className = 'btn btn-primary';
    btn.textContent = 'Submit Official Report';
    btn.hidden = true;
    actions.insertBefore(btn, actions.firstChild);
    return btn;
}

function updateSubmitUI() {
    const btn = document.getElementById('submitReportBtn');
    if (!btn) return;
    const canSubmit = !!scannerState.pending && !scannerState.submitted;
    btn.hidden = !canSubmit;
    btn.disabled = scannerState.isScanning || scannerState.isSubmitting;
    btn.textContent = scannerState.isSubmitting ? 'Submitting…' : 'Submit Official Report';
}

function initScanner() {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const placeholder = document.getElementById('scannerPlaceholder');
    const previewImg = document.getElementById('previewImg');
    const detectionCanvas = document.getElementById('detectionCanvas');
    const scanBtn = document.getElementById('scanBtn');
    const resetBtn = document.getElementById('resetBtn');
    const cameraBtn = document.getElementById('cameraBtn');
    const uploadBtn = document.getElementById('uploadBtn');
    const viewDocsBtn = document.getElementById('viewDocsBtn');
    const cameraOverlay = document.getElementById('cameraOverlay');
    const cameraVideo = document.getElementById('cameraVideo');
    const cameraError = document.getElementById('cameraError');
    const captureBtn = document.getElementById('captureBtn');
    const cancelCameraBtn = document.getElementById('cancelCameraBtn');
    const submitBtn = ensureSubmitButton();
    let mediaStream = null;

    function loadImageDataUrl(dataUrl) {
        scannerState.file = true;
        scannerState.dataUrl = dataUrl;
        scannerState.lastDetections = null;
        scannerState.pending = null;
        scannerState.submitted = false;
        scannerState.lastRecordId = null;
        detectionCanvas.hidden = true;
        previewImg.src = dataUrl;
        previewImg.hidden = false;
        placeholder.hidden = true;
        scanBtn.disabled = false;
        renderWarnings([]);
        hideRecommendation();
        showWaitingQuickRead();
    }

    const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    const MAX_FILE_BYTES = 10 * 1024 * 1024;
    const fileMeta = document.getElementById('fileMeta');
    const fileError = document.getElementById('fileError');

    function showFileError(msg) {
        fileError.textContent = msg || '';
        fileError.hidden = !msg;
    }

    function handleFiles(fileList) {
        const file = fileList && fileList[0];
        if (!file) return;

        if (!isGateVerified()) {
            showFileError('Only verified officials can upload photos.');
            return;
        }
        if (!ACCEPTED_TYPES.includes(file.type)) {
            showFileError('\u201c' + file.name + '\u201d is not a JPG, PNG or WEBP image. Please choose a photo in one of those formats.');
            fileInput.value = '';
            return;
        }
        if (file.size > MAX_FILE_BYTES) {
            showFileError('\u201c' + file.name + '\u201d is ' + (file.size / 1048576).toFixed(1) + ' MB. Please choose a photo under 10 MB.');
            fileInput.value = '';
            return;
        }
        showFileError('');

        const reader = new FileReader();
        reader.onload = function (e) {
            loadImageDataUrl(e.target.result);
            fileMeta.textContent = file.name + ' \u00b7 ' + file.type.replace('image/', '').toUpperCase() + ' \u00b7 ' +
                (file.size < 1048576 ? Math.round(file.size / 1024) + ' KB' : (file.size / 1048576).toFixed(1) + ' MB');
            fileMeta.hidden = false;
        };
        reader.onerror = function () { showFileError('That file could not be read. Try another photo.'); };
        reader.readAsDataURL(file);
        onImageFile(file);
    }

    async function openCamera() {
        cameraError.hidden = true;
        cameraError.textContent = '';

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            cameraError.textContent = 'Your browser does not support camera access. Try Chrome, Edge, or Firefox.';
            cameraError.hidden = false;
            cameraOverlay.hidden = false;
            return;
        }

        cameraOverlay.hidden = false;

        try {
            mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' },
                audio: false
            });
            cameraVideo.srcObject = mediaStream;
        } catch (err) {
            console.error('Camera access failed:', err);
            let msg = 'Could not access your camera.';
            if (err.name === 'NotAllowedError') {
                msg = 'Camera permission was denied. Allow camera access for this site in your browser settings and try again.';
            } else if (err.name === 'NotFoundError') {
                msg = 'No camera was found on this device.';
            } else if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
                msg = 'Camera access requires HTTPS. This page must be served over https:// (or localhost) for the camera to work.';
            }
            cameraError.textContent = msg;
            cameraError.hidden = false;
        }
    }

    function closeCamera() {
        if (mediaStream) {
            mediaStream.getTracks().forEach(function (track) { track.stop(); });
            mediaStream = null;
        }
        cameraVideo.srcObject = null;
        cameraOverlay.hidden = true;
    }

    function captureFromCamera() {
        if (!cameraVideo.videoWidth) return;

        const canvas = document.createElement('canvas');
        canvas.width = cameraVideo.videoWidth;
        canvas.height = cameraVideo.videoHeight;
        canvas.getContext('2d').drawImage(cameraVideo, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');

        closeCamera();
        loadImageDataUrl(dataUrl);
        fileMeta.textContent = 'Camera photo \u00b7 use \u201cSuggest from my location\u201d in step 1 to match the segment';
        fileMeta.hidden = false;
        showFileError('');
    }

    cameraBtn.addEventListener('click', openCamera);
    captureBtn.addEventListener('click', captureFromCamera);
    cancelCameraBtn.addEventListener('click', closeCamera);

    uploadBtn.addEventListener('click', function () { fileInput.click(); });
    dropzone.addEventListener('click', function () { fileInput.click(); });
    dropzone.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInput.click();
        }
    });
    fileInput.addEventListener('change', function (e) { handleFiles(e.target.files); });

    ['dragenter', 'dragover'].forEach(function (evt) {
        dropzone.addEventListener(evt, function (e) {
            e.preventDefault();
            dropzone.classList.add('is-dragover');
        });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
        dropzone.addEventListener(evt, function (e) {
            e.preventDefault();
            dropzone.classList.remove('is-dragover');
        });
    });
    dropzone.addEventListener('drop', function (e) { handleFiles(e.dataTransfer.files); });

    scanBtn.addEventListener('click', runScan);
    resetBtn.addEventListener('click', resetScanner);
    document.getElementById('scanAnotherBtn').addEventListener('click', resetScanner);
    if (submitBtn) submitBtn.addEventListener('click', handleSubmitReport);

    viewDocsBtn.addEventListener('click', function () {
        if (scannerState.lastRecordId) {
            window.location.href = 'Tracking.html?id=' + encodeURIComponent(scannerState.lastRecordId);
            return;
        }
        if (scannerState.pending && !confirm('This scan has not been submitted, so it will not appear in Tracking. Open Tracking anyway?')) {
            return;
        }
        window.location.href = 'Tracking.html';
    });

    function resetScanner() {
        scannerState.file = null;
        scannerState.dataUrl = null;
        scannerState.lastRecordId = null;
        scannerState.lastDetections = null;
        scannerState.pending = null;
        scannerState.submitted = false;
        previewImg.src = '';
        previewImg.hidden = true;
        detectionCanvas.hidden = true;
        placeholder.hidden = false;
        scanBtn.disabled = true;
        fileInput.value = '';
        fileMeta.hidden = true;
        showFileError('');
        dropzone.classList.remove('is-scanning');
        renderWarnings([]);
        hideRecommendation();
        showWaitingQuickRead();
    }
}

function setScanningUI(isScanning, label) {
    scannerState.isScanning = isScanning;
    document.getElementById('dropzone').classList.toggle('is-scanning', isScanning);
    document.getElementById('scanBtn').disabled = isScanning || !scannerState.file;
    document.getElementById('scanBtn').textContent = isScanning ? 'Scanning…' : 'Scan Image';
    document.getElementById('cameraBtn').disabled = isScanning;
    document.getElementById('uploadBtn').disabled = isScanning;
    document.getElementById('resetBtn').disabled = isScanning;
    updateSubmitUI();

    const progress = document.getElementById('scanProgress');
    if (progress) {
        progress.hidden = !isScanning;
        document.getElementById('scanProgressText').textContent = label || 'Running the model\u2026';
    }

    if (isScanning) {
        document.getElementById('quickStatusTitle').textContent = 'Scanning…';
        document.getElementById('quickStatusSub').textContent = label || 'Reading tint, surface texture, and lighting.';
    }
}

async function runScan() {
    if (!scannerState.file || scannerState.isScanning) return;

    scannerState.pending = null;
    scannerState.submitted = false;
    scannerState.lastRecordId = null;
    hideRecommendation();
    showWaitingQuickRead();
    renderWarnings([]);
    setScanningUI(true, 'Checking that this is a river photo…');

    try {
        const analysis = await analyzeRiverImage(scannerState.dataUrl);
        scannerState.lastDetections = analysis.detections;
        await drawDetections(scannerState.dataUrl, analysis.detections);

        scannerState.pending = { analysis: analysis, dataUrl: scannerState.dataUrl };
        renderQuickRead(analysis);
    } catch (err) {
        if (err && err.code === 'NOT_RIVER') {
            renderWarnings([{
                type: 'scene',
                message: "This doesn't look like a river photo. Please upload a clear photo of a river, stream, or shoreline."
            }]);
            document.getElementById('quickStatusTitle').textContent = 'Not a river photo';
            document.getElementById('quickStatusSub').textContent = 'Nothing was scanned or submitted.';
            return;
        }
        console.error('River scan failed:', err);
        document.getElementById('quickStatusTitle').textContent = 'Scan failed — try again';
        document.getElementById('quickStatusSub').textContent =
            'The detection model may have failed to load (check your connection). Nothing was submitted.';
    } finally {
        setScanningUI(false);
    }
}

async function handleSubmitReport() {
    const pending = scannerState.pending;
    if (!pending || scannerState.submitted || scannerState.isSubmitting || scannerState.isScanning) return;

    if (!isGateVerified()) {
        showSubmitStatus('error', 'Only verified officials can submit official reports. Enter your access code at the top of the page first.');
        return;
    }

    const selection = getSelection();
    if (!selection.ok) {
        showSubmitStatus('error', selection.error);
        const step1 = document.getElementById('stepRiver');
        if (step1) { step1.scrollIntoView({ behavior: 'smooth', block: 'center' }); step1.focus({ preventScroll: true }); }
        return;
    }

    if (!pending.analysis.modelAvailable) {
        alert('Object detection did not run for this scan, so it can\u2019t be submitted as an official report. Please scan again.');
        return;
    }


    scannerState.isSubmitting = true;
    updateSubmitUI();

    if (!pending.analysis.gateRan) {
        const sub = document.getElementById('quickStatusSub');
        sub.textContent = 'Running the river-photo check before submitting\u2026';
        let gate = null;
        try {
            gate = await runRiverCheck(pending.dataUrl, CLIP_SUBMIT_WAIT_MS);
        } catch (err) {
            console.warn('[CLIP] River check unavailable at submit time:', err);
        }
        sub.textContent = pending.analysis.assessment;

        if (!gate) {
            scannerState.isSubmitting = false;
            updateSubmitUI();
            alert('The river-photo check is still downloading (it is about 90 MB the first time). Wait a minute and press Submit again \u2014 your scan result is kept.');
            return;
        }
        if (!gate.ok) {
            scannerState.isSubmitting = false;
            updateSubmitUI();
            alert('This photo did not pass the river-photo check, so it can\u2019t be submitted as an official report. Try a clearer photo that shows the river itself.');
            return;
        }
        pending.analysis.gateRan = true;
        pending.analysis.warnings = (pending.analysis.warnings || []).filter(function (w) { return w.type !== 'gate'; });
        renderWarnings(pending.analysis.warnings);
    }

    const details = await askReportDetails(pending.analysis.warnings, selection);
    if (!details) {
        scannerState.isSubmitting = false;
        updateSubmitUI();
        return;
    }
    details.selection = selection;
    showSubmitStatus('busy', 'Uploading the photo and saving the report to ' + selection.label + '\u2026');

    try {
        const recordId = await submitOfficialReport(pending.analysis, pending.dataUrl, details);
        scannerState.lastRecordId = recordId;
        scannerState.submitted = true;
        scannerState.pending = null;
        showSubmitStatus('success', 'Report \u201c' + details.name + '\u201d saved to ' + selection.label +
            '. It now shows on that segment of the map, in Tracking and in the Forum.');
    } catch (err) {
        console.error('Report submission failed:', err);
        showSubmitStatus('error', 'Not saved. ' + friendlyError(err));
    } finally {
        scannerState.isSubmitting = false;
        updateSubmitUI();
    }
}

const LITTER_MODEL_URL = 'models/best_litter_merged_v1.onnx';
const LITTER_MODEL_CLASSES = ['trash'];
const SCENE_MODEL_URL = 'models/river_pollution.onnx';
const USE_SCENE_MODEL = true;
const SCENE_MODEL_SKIP_LABELS = ['trash', 'plastic_pollution'];
const YOLO_INPUT_SIZE = 640;
const YOLO_CONF_THRESHOLD = 0.10;
const YOLO_IOU_THRESHOLD = 0.45;

const CURRENT_MODEL_CLASSES = [
    'eutrophication_pollution',
    'ignore_1',
    'ignore_2',
    'chemical-water',
    'dry-water',
    'normal-water',
    'oil-contaminated-water',
    'polluted-water',
    'ignore_8',
    'ignore_9',
    'clear',
    'trash',
    'ignore_12',
    'plastic_pollution',
    'merah'
];

const SCENE_CLASS_INFO = {
    'eutrophication_pollution': { points: 22, kind: 'algae',    text: 'eutrophication (algae-rich, nutrient-polluted water)' },
    'merah':                    { points: 20, kind: 'algae',    text: 'red-colored water (possible algal bloom)' },
    'chemical-water':           { points: 25, kind: 'chemical', text: 'chemical-looking contaminated water' },
    'oil-contaminated-water':   { points: 25, kind: 'oil',      text: 'oil-contaminated water' },
    'polluted-water':           { points: 20, kind: 'polluted', text: 'visibly polluted water' }
};
const SCENE_MIN_SCORE = 0.30;

const LITTER_MIN_SCORE = 0.25;
const CONTEXT_MIN_SCORE = 0.25;
const LITTER_BIG_BOX_AREA = 0.30;
const LITTER_BIG_BOX_MIN_SCORE = 0.75;

function filterDetections(detections, imgW, imgH) {
    const imgArea = imgW && imgH ? imgW * imgH : 0;
    return detections.filter(function (d) {
        if (SCENE_CLASS_INFO[d.label]) return d.score >= SCENE_MIN_SCORE;
        const isLitter = !!POLLUTION_CLASS_INFO[d.label];
        if (d.score < (isLitter ? LITTER_MIN_SCORE : CONTEXT_MIN_SCORE)) return false;
        if (isLitter && imgArea) {
            const area = ((d.x2 - d.x1) * (d.y2 - d.y1)) / imgArea;
            if (area > LITTER_BIG_BOX_AREA && d.score < LITTER_BIG_BOX_MIN_SCORE) return false;
        }
        return true;
    });
}
const IGNORED_LABEL_PREFIX = 'ignore_';

const LITTER_CLASSES = [
    'plastic_bottle',
    'plastic_bag',
    'styrofoam',
    'can',
    'glass_bottle',
    'food_wrapper',
    'cup',
    'tire',
    'fabric',
    'rope_netting',
    'other_trash',
    'plastic_container',
    'plastic_straw',
    'plastic_cutlery',
    'sachet',
    'cigarette_butt',
    'sandal_shoe',
    'paper_cardboard',
    'metal_scrap',
    'battery',
    'medical_waste',
    'diaper',
    'sack',
    'furniture_appliance',
    'oil_slick',
    'water_hyacinth',
    'bottle_cap',
    'plastic_film',
    'plastic_bucket',
    'water_jug',
    'carton',
    'aluminum_foil',
    'lighter',
    'toy',
    'umbrella',
    'mattress_foam',
    'wood_plank',
    'construction_debris',
    'pipe',
    'wire_cable',
    'vehicle_part',
    'shopping_cart',
    'sanitary_pad',
    'tarpaulin',
    'balloon',
    'paint_drum',
    'aerosol_can',
    'dead_animal',
    'livestock',
    'fish_cage',
    'buoy_float',
    'twigs_branches',
];

const POLLUTION_CLASS_INFO = {
    'trash':               { weight: 4, tag: 'trash' },
    'plastic_pollution':   { weight: 5, tag: 'plastic' },
    'plastic_bottle':      { weight: 5, tag: 'bottle' },
    'plastic_bag':         { weight: 4, tag: 'bag' },
    'styrofoam':           { weight: 6, tag: 'styrofoam' },
    'can':                 { weight: 3, tag: 'can' },
    'glass_bottle':        { weight: 4, tag: 'glass' },
    'food_wrapper':        { weight: 3, tag: 'wrapper' },
    'cup':                 { weight: 3, tag: 'cup' },
    'tire':                { weight: 8, tag: 'tire' },
    'fabric':              { weight: 4, tag: 'fabric' },
    'rope_netting':        { weight: 5, tag: 'netting' },
    'other_trash':         { weight: 3, tag: 'trash' },
    'plastic_container':   { weight: 4, tag: 'container' },
    'plastic_straw':       { weight: 2, tag: 'straw' },
    'plastic_cutlery':     { weight: 2, tag: 'cutlery' },
    'sachet':              { weight: 2, tag: 'sachet' },
    'cigarette_butt':      { weight: 1, tag: 'butt' },
    'sandal_shoe':         { weight: 4, tag: 'footwear' },
    'paper_cardboard':     { weight: 2, tag: 'paper' },
    'metal_scrap':         { weight: 5, tag: 'metal' },
    'battery':             { weight: 8, tag: 'battery' },
    'medical_waste':       { weight: 7, tag: 'medical' },
    'diaper':              { weight: 5, tag: 'diaper' },
    'sack':                { weight: 4, tag: 'sack' },
    'furniture_appliance': { weight: 9, tag: 'bulky' },
    'oil_slick':           { weight: 9, tag: 'oil' },
    'bottle_cap':          { weight: 1, tag: 'cap' },
    'plastic_film':        { weight: 3, tag: 'film' },
    'plastic_bucket':      { weight: 4, tag: 'bucket' },
    'water_jug':           { weight: 4, tag: 'jug' },
    'carton':              { weight: 3, tag: 'carton' },
    'aluminum_foil':       { weight: 2, tag: 'foil' },
    'lighter':             { weight: 2, tag: 'lighter' },
    'toy':                 { weight: 3, tag: 'toy' },
    'umbrella':            { weight: 4, tag: 'umbrella' },
    'mattress_foam':       { weight: 7, tag: 'mattress' },
    'wood_plank':          { weight: 3, tag: 'wood' },
    'construction_debris': { weight: 7, tag: 'rubble' },
    'pipe':                { weight: 5, tag: 'pipe' },
    'wire_cable':          { weight: 5, tag: 'cable' },
    'vehicle_part':        { weight: 8, tag: 'vehicle' },
    'shopping_cart':       { weight: 8, tag: 'cart' },
    'sanitary_pad':        { weight: 4, tag: 'sanitary' },
    'tarpaulin':           { weight: 5, tag: 'tarp' },
    'balloon':             { weight: 2, tag: 'balloon' },
    'paint_drum':          { weight: 8, tag: 'drum' },
    'aerosol_can':         { weight: 5, tag: 'aerosol' },
    'dead_animal':         { weight: 6, tag: 'carcass' }
};

const NATURAL_LABELS = ['twigs_branches', 'leaf_litter', 'driftwood', 'water_hyacinth'];

const yoloSessionPromises = {};
const YOLO_DOWNLOAD_TIMEOUT_MS = 60000;

function updateScanLabel(text) {
    const sub = document.getElementById('quickStatusSub');
    if (sub) sub.textContent = text;
    const prog = document.getElementById('scanProgressText');
    if (prog) prog.textContent = text;
    console.log('[YOLO]', text);
}

async function fetchModelBuffer(url, timeoutMs, onProgress) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal, mode: 'cors' });
        if (!res.ok) throw new Error('Model download failed: HTTP ' + res.status);

        const total = Number(res.headers.get('content-length')) || 0;
        if (!res.body || !total) {
            return await res.arrayBuffer();
        }

        const reader = res.body.getReader();
        const chunks = [];
        let received = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (onProgress) onProgress(received / total);
        }
        const merged = new Uint8Array(received);
        let offset = 0;
        chunks.forEach(function (chunk) { merged.set(chunk, offset); offset += chunk.length; });
        return merged.buffer;
    } catch (err) {
        if (err.name === 'AbortError') {
            throw new Error('Model download timed out after ' + (timeoutMs / 1000) + 's — the CDN may be blocked or too slow on this connection.');
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

function getYoloSession(modelUrl) {
    if (!yoloSessionPromises[modelUrl]) {
        if (typeof ort === 'undefined') {
            return Promise.reject(new Error('onnxruntime-web (ort) did not load — check the <script> tag and your connection.'));
        }
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.simd = true;
        ort.env.wasm.proxy = false;
        ort.env.wasm.wasmPaths = 'vendor/onnxruntime-web/';

        updateScanLabel('Downloading detection model… 0%');
        yoloSessionPromises[modelUrl] = fetchModelBuffer(modelUrl, YOLO_DOWNLOAD_TIMEOUT_MS, function (fraction) {
            updateScanLabel('Downloading detection model… ' + Math.round(fraction * 100) + '%');
        })
            .then(function (buffer) {
                updateScanLabel('Model downloaded — starting inference session…');
                return ort.InferenceSession.create(buffer, { executionProviders: ['wasm'] });
            })
            .then(function (session) {
                console.log('[YOLO] Session ready (' + modelUrl + '). Inputs:', session.inputNames, 'Outputs:', session.outputNames);
                return session;
            })
            .catch(function (err) {
                delete yoloSessionPromises[modelUrl];
                throw err;
            });
    }
    return yoloSessionPromises[modelUrl];
}

function loadImage(src) {
    return new Promise(function (resolve, reject) {
        const img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('Could not load image for detection.')); };
        img.src = src;
    });
}

function letterboxToTensor(img, size) {
    const scale = Math.min(size / img.width, size / img.height);
    const drawW = Math.round(img.width * scale);
    const drawH = Math.round(img.height * scale);
    const padX = Math.floor((size - drawW) / 2);
    const padY = Math.floor((size - drawH) / 2);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#727272';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, img.width, img.height, padX, padY, drawW, drawH);

    const pixels = ctx.getImageData(0, 0, size, size).data;
    const area = size * size;
    const chw = new Float32Array(3 * area);
    for (let i = 0; i < area; i++) {
        chw[i] = pixels[i * 4] / 255;
        chw[area + i] = pixels[i * 4 + 1] / 255;
        chw[2 * area + i] = pixels[i * 4 + 2] / 255;
    }
    return { chw, scale, padX, padY };
}

function iou(a, b) {
    const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1);
    const x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
    const interArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
    const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
    return interArea / (areaA + areaB - interArea + 1e-6);
}

function nonMaxSuppression(boxes, iouThreshold) {
    const byClass = {};
    boxes.forEach(function (b) {
        (byClass[b.classId] = byClass[b.classId] || []).push(b);
    });
    const kept = [];
    Object.keys(byClass).forEach(function (classId) {
        const list = byClass[classId].sort(function (a, b) { return b.score - a.score; });
        while (list.length) {
            const current = list.shift();
            kept.push(current);
            for (let i = list.length - 1; i >= 0; i--) {
                if (iou(current, list[i]) > iouThreshold) list.splice(i, 1);
            }
        }
    });
    return kept;
}

function decodeYoloOutput(outputTensor, scale, padX, padY, origW, origH, classNamesOverride) {
    const dims = outputTensor.dims;
    const numAttrs = dims[1];
    const numAnchors = dims[2];
    const numClasses = numAttrs - 4;
    const data = outputTensor.data;

    let classNames;
    if (classNamesOverride && classNamesOverride.length === numClasses) {
        classNames = classNamesOverride;
    } else if (numClasses === LITTER_CLASSES.length) {
        classNames = LITTER_CLASSES;
    } else if (numClasses === CURRENT_MODEL_CLASSES.length) {
        classNames = CURRENT_MODEL_CLASSES;
    } else {
        console.warn('[YOLO] Model has ' + numClasses + ' classes; LITTER_CLASSES has ' +
            LITTER_CLASSES.length + '. Labels will be generic.');
        classNames = [];
    }

    const candidates = [];
    for (let a = 0; a < numAnchors; a++) {
        let bestScore = 0;
        let bestClass = -1;
        for (let c = 0; c < numClasses; c++) {
            if (classNames[c] && classNames[c].indexOf(IGNORED_LABEL_PREFIX) === 0) continue;
            const score = data[(4 + c) * numAnchors + a];
            if (score > bestScore) {
                bestScore = score;
                bestClass = c;
            }
        }
        if (bestScore < YOLO_CONF_THRESHOLD) continue;

        const cx = data[0 * numAnchors + a];
        const cy = data[1 * numAnchors + a];
        const w = data[2 * numAnchors + a];
        const h = data[3 * numAnchors + a];

        const x1 = Math.max(0, Math.min(origW, (cx - w / 2 - padX) / scale));
        const y1 = Math.max(0, Math.min(origH, (cy - h / 2 - padY) / scale));
        const x2 = Math.max(0, Math.min(origW, (cx + w / 2 - padX) / scale));
        const y2 = Math.max(0, Math.min(origH, (cy + h / 2 - padY) / scale));
        if (x2 <= x1 || y2 <= y1) continue;

        candidates.push({
            x1: x1, y1: y1, x2: x2, y2: y2,
            score: bestScore,
            classId: bestClass,
            label: classNames[bestClass] || ('class_' + bestClass)
        });
    }
    return nonMaxSuppression(candidates, YOLO_IOU_THRESHOLD);
}

const YOLO_INPUT_SIZES = [YOLO_INPUT_SIZE, 640];

const YOLO_TILING = true;
const YOLO_TILE_MIN_SIDE = 700;
const YOLO_TILE_FRACTION = 0.6;

async function detectTiles(session, inputName, outputName, img, size, classNames, skipLabels) {
    const tw = Math.round(img.width * YOLO_TILE_FRACTION);
    const th = Math.round(img.height * YOLO_TILE_FRACTION);
    const xs = [0, img.width - tw];
    const ys = [0, img.height - th];
    const found = [];
    let n = 0;
    for (const ty of ys) {
        for (const tx of xs) {
            n++;
            updateScanLabel('Looking closer for small litter (' + n + '/4)…');
            const crop = document.createElement('canvas');
            crop.width = tw;
            crop.height = th;
            crop.getContext('2d').drawImage(img, tx, ty, tw, th, 0, 0, tw, th);
            const { chw, scale, padX, padY } = letterboxToTensor(crop, size);
            const tensor = new ort.Tensor('float32', chw, [1, 3, size, size]);
            const results = await session.run({ [inputName]: tensor });
            const boxes = decodeYoloOutput(results[outputName], scale, padX, padY, tw, th, classNames);
            boxes.forEach(function (b) {
                if (!POLLUTION_CLASS_INFO[b.label]) return;
                if (skipLabels && skipLabels.indexOf(b.label) !== -1) return;
                found.push({
                    x1: b.x1 + tx, y1: b.y1 + ty, x2: b.x2 + tx, y2: b.y2 + ty,
                    score: b.score, classId: b.classId, label: b.label
                });
            });
        }
    }
    return found;
}

async function runOneModel(modelUrl, classNames, skipLabels, img, size) {
    const session = await getYoloSession(modelUrl);
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];

    const { chw, scale, padX, padY } = letterboxToTensor(img, size);
    const tensor = new ort.Tensor('float32', chw, [1, 3, size, size]);
    updateScanLabel('Running object detection (' + size + 'px)…');
    const results = await session.run({ [inputName]: tensor });
    let detections = decodeYoloOutput(results[outputName], scale, padX, padY, img.width, img.height, classNames);
    if (skipLabels) {
        detections = detections.filter(function (d) { return skipLabels.indexOf(d.label) === -1; });
    }
    console.log('[YOLO] ' + modelUrl + ' @' + size + 'px found ' + detections.length);

    if (YOLO_TILING && Math.max(img.width, img.height) >= YOLO_TILE_MIN_SIDE) {
        try {
            const extra = await detectTiles(session, inputName, outputName, img, size, classNames, skipLabels);
            console.log('[YOLO] ' + modelUrl + ' tiles found ' + extra.length + ' extra box(es)');
            detections = nonMaxSuppression(detections.concat(extra), YOLO_IOU_THRESHOLD);
        } catch (tileErr) {
            console.warn('[YOLO] Tile pass failed, using full-image result only:', tileErr);
        }
    }
    return detections;
}

async function runYoloDetection(imageDataUrl) {
    try {
        const img = await loadImage(imageDataUrl);
        let all = [];
        let litterOk = false;
        let sceneOk = false;
        let lastError = null;

        for (const size of YOLO_INPUT_SIZES) {
            try {
                const litter = await runOneModel(LITTER_MODEL_URL, LITTER_MODEL_CLASSES, null, img, size);
                all = all.concat(litter);
                litterOk = true;
                break;
            } catch (err) {
                console.error('[YOLO] Litter model failed at ' + size + 'px:', err);
                lastError = err;
            }
        }

        if (USE_SCENE_MODEL) {
            try {
                const scene = await runOneModel(SCENE_MODEL_URL, null, SCENE_MODEL_SKIP_LABELS, img, YOLO_INPUT_SIZE);
                all = all.concat(scene);
                sceneOk = true;
            } catch (err) {
                console.error('[YOLO] Scene model failed (continuing without it):', err);
                lastError = lastError || err;
            }
        }

        if (!litterOk && !sceneOk) throw lastError || new Error('No detection model could be run.');
        return { detections: nonMaxSuppression(all, YOLO_IOU_THRESHOLD), modelAvailable: true,
                 width: img.width, height: img.height };
    } catch (err) {
        console.error('[YOLO] Object detection unavailable, falling back to color/texture reading:', err);
        return { detections: [], modelAvailable: false, error: String(err && err.message || err) };
    }
}

function scoreDetections(detections) {
    const counts = {};
    detections.forEach(function (d) { counts[d.label] = (counts[d.label] || 0) + 1; });

    let litterScore = 0;
    const items = [];
    const contextItems = [];
    const sceneItems = [];
    let sceneScore = 0;
    let topScene = null;

    detections.forEach(function (d) {
        const sc = SCENE_CLASS_INFO[d.label];
        if (sc && d.score >= SCENE_MIN_SCORE) {
            if (sc.points > sceneScore) sceneScore = sc.points;
            if (!topScene || d.score > topScene.score) topScene = { label: d.label, kind: sc.kind, text: sc.text, score: d.score };
            if (!sceneItems.some(function (x) { return x.label === d.label; })) {
                sceneItems.push({ label: d.label, kind: sc.kind, text: sc.text });
            }
        }
    });

    Object.keys(counts).forEach(function (label) {
        const count = counts[label];
        if (SCENE_CLASS_INFO[label]) return;
        const info = POLLUTION_CLASS_INFO[label];
        if (info) {
            litterScore += info.weight * Math.min(count, 9);
            items.push({ label: label, count: count, tag: info.tag });
        } else {
            contextItems.push({ label: label, count: count });
        }
    });

    return { litterScore: Math.min(45, Math.round(litterScore)), items: items, contextItems: contextItems,
             sceneItems: sceneItems, sceneScore: sceneScore, topScene: topScene };
}

const SURFACE_CAST_FLOOR = 25;

function scoreSurface(stats) {
    const { r, g, b } = stats.avgColor;
    const brightness = (r + g + b) / 3;
    const greenBrownBias = (g + r) - (b * 2);

    const castPoints = Math.max(0, greenBrownBias - SURFACE_CAST_FLOOR) / 4;
    const darkPoints = castPoints > 0 ? Math.max(0, (90 - brightness) / 10) : 0;

    const surfaceScore = Math.max(0, Math.min(25, Math.round(castPoints + darkPoints)));
    const colorCast = greenBrownBias > 55
        ? 'Green-brown tint (possible algae)'
        : (brightness < 70 && greenBrownBias > SURFACE_CAST_FLOOR
            ? 'Darkened and tinted (possible turbidity)'
            : 'Minimal discoloration');
    const lighting = brightness > 150
        ? 'Bright — some overexposure'
        : (brightness < 60 ? 'Low light — retake in daylight if possible' : 'Even, natural light');

    const tinted = colorCast !== 'Minimal discoloration';
    return { surfaceScore: surfaceScore, colorCast: colorCast, lighting: lighting, tinted: tinted };
}

function computeClutterStats(imageDataUrl) {
    return new Promise(function (resolve) {
        const img = new Image();
        img.onload = function () {
            const size = 96;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, size, size);
            const pixels = ctx.getImageData(0, 0, size, size).data;

            const gray = new Float32Array(size * size);
            for (let i = 0; i < size * size; i++) {
                const o = i * 4;
                gray[i] = (pixels[o] * 0.299 + pixels[o + 1] * 0.587 + pixels[o + 2] * 0.114);
            }

            const gxKernel = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
            const gyKernel = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

            let sumMag = 0;
            let hardEdgeCount = 0;
            let sampled = 0;
            const HARD_EDGE_THRESHOLD = 60;

            for (let y = 1; y < size - 1; y++) {
                for (let x = 1; x < size - 1; x++) {
                    let gx = 0, gy = 0, k = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const v = gray[(y + dy) * size + (x + dx)];
                            gx += v * gxKernel[k];
                            gy += v * gyKernel[k];
                            k++;
                        }
                    }
                    const mag = Math.sqrt(gx * gx + gy * gy);
                    sumMag += mag;
                    if (mag > HARD_EDGE_THRESHOLD) hardEdgeCount++;
                    sampled++;
                }
            }

            resolve({
                avgEdgeMagnitude: sumMag / sampled,
                hardEdgeRatio: hardEdgeCount / sampled
            });
        };
        img.onerror = function () {
            resolve({ avgEdgeMagnitude: 0, hardEdgeRatio: 0 });
        };
        img.src = imageDataUrl;
    });
}

function scoreClutter(clutterStats) {
    const ratio = clutterStats.hardEdgeRatio;

    const normalized = Math.max(0, Math.min(1, (ratio - 0.12) / (0.28 - 0.12)));
    const clutterScore = Math.round(normalized * 22);

    let clutterReading;
    if (ratio > 0.28) clutterReading = 'Dense, fragmented debris texture (likely cluttered with litter)';
    else if (ratio > 0.18) clutterReading = 'Moderate surface clutter';
    else clutterReading = 'Smooth, low-clutter surface';

    return { clutterScore: clutterScore, clutterReading: clutterReading };
}

const BLUR_VARIANCE_THRESHOLD = 80;

function computeBlurStats(imageDataUrl) {
    return new Promise(function (resolve) {
        const img = new Image();
        img.onload = function () {
            const size = 300;
            const scale = Math.min(1, size / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            const pixels = ctx.getImageData(0, 0, w, h).data;

            const gray = new Float32Array(w * h);
            for (let i = 0; i < w * h; i++) {
                const o = i * 4;
                gray[i] = pixels[o] * 0.299 + pixels[o + 1] * 0.587 + pixels[o + 2] * 0.114;
            }

            const responses = [];
            for (let y = 1; y < h - 1; y++) {
                for (let x = 1; x < w - 1; x++) {
                    const i = y * w + x;
                    const lap = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
                    responses.push(lap);
                }
            }

            let mean = 0;
            for (let i = 0; i < responses.length; i++) mean += responses[i];
            mean /= responses.length || 1;

            let variance = 0;
            for (let i = 0; i < responses.length; i++) {
                const d = responses[i] - mean;
                variance += d * d;
            }
            variance /= responses.length || 1;

            resolve({ laplacianVariance: variance });
        };
        img.onerror = function () { resolve({ laplacianVariance: BLUR_VARIANCE_THRESHOLD }); };
        img.src = imageDataUrl;
    });
}

function assessScenePlausibility(stats, detections, water) {
    const { r, g, b } = stats.avgColor;
    const coolBias = (g + b) - r;
    const saturationSpread = Math.max(r, g, b) - Math.min(r, g, b);
    const hasWaterHint = detections.some(function (d) { return d.score >= 0.2; }) ||
        !!(water && water.available && water.topProb >= 0.6);
    const looksOutdoorish = coolBias > -15 && saturationSpread > 12;
    if (!looksOutdoorish && !hasWaterHint) {
        return {
            flagged: true,
            message: 'This doesn\u2019t look like a typical outdoor water photo \u2014 double-check it\u2019s a river/stream/shoreline shot. (Automated check, not certain.)'
        };
    }
    return { flagged: false, message: null };
}

function buildWarnings(blurStats, sceneCheck) {
    const warnings = [];
    if (blurStats.laplacianVariance < BLUR_VARIANCE_THRESHOLD) {
        warnings.push({
            type: 'blur',
            message: 'This photo looks blurry \u2014 detection and the pollution read may be less reliable. Try retaking it in focus.'
        });
    }
    if (sceneCheck.flagged) {
        warnings.push({ type: 'scene', message: sceneCheck.message });
    }
    return warnings;
}

const WATER_MODEL_URL = 'models/water_quality.onnx';
const WATER_INPUT_SIZE = 224;
const WATER_CLASSES = ['algae', 'clean', 'discolored', 'oil'];

const WATER_CLASS_POINTS = {
    clean: 0,
    foam: 14,
    discolored: 15,
    algae: 22,
    garbage_covered: 23,
    sewage: 24,
    oil: 25
};

const WATER_CLASS_TEXT = {
    clean: 'clean-looking water',
    foam: 'foam on the surface (possible detergent or sewage)',
    discolored: 'discolored or murky water',
    algae: 'algae growth',
    garbage_covered: 'water surface covered with garbage',
    sewage: 'sewage-like dirty water',
    oil: 'oil sheen or oil contamination'
};
const WATER_MIN_CONFIDENCE = 0.4;
const WATER_POLLUTED_MIN_CONFIDENCE = 0.6;

const WATER_USE_IMAGENET_NORM = true;
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

let waterSessionPromise = null;

function getWaterSession() {
    if (!waterSessionPromise) {
        if (typeof ort === 'undefined') {
            return Promise.reject(new Error('onnxruntime-web (ort) did not load.'));
        }
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.proxy = false;
        ort.env.wasm.wasmPaths = 'vendor/onnxruntime-web/';

        updateScanLabel('Downloading water model…');
        waterSessionPromise = fetchModelBuffer(WATER_MODEL_URL, YOLO_DOWNLOAD_TIMEOUT_MS, function (fraction) {
            updateScanLabel('Downloading water model… ' + Math.round(fraction * 100) + '%');
        })
            .then(function (buffer) {
                return ort.InferenceSession.create(buffer, { executionProviders: ['wasm'] });
            })
            .then(function (session) {
                console.log('[Water] Session ready. Inputs:', session.inputNames, 'Outputs:', session.outputNames);
                return session;
            })
            .catch(function (err) {
                waterSessionPromise = null;
                throw err;
            });
    }
    return waterSessionPromise;
}

function softmax(arr) {
    let max = -Infinity;
    for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
    const exps = Array.prototype.map.call(arr, function (v) { return Math.exp(v - max); });
    const sum = exps.reduce(function (a, b) { return a + b; }, 0);
    return exps.map(function (v) { return v / sum; });
}

async function runWaterClassification(imageDataUrl) {
    try {
        const img = await loadImage(imageDataUrl);
        const size = WATER_INPUT_SIZE;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        const pixels = ctx.getImageData(0, 0, size, size).data;

        const area = size * size;
        const chw = new Float32Array(3 * area);
        for (let i = 0; i < area; i++) {
            for (let c = 0; c < 3; c++) {
                let v = pixels[i * 4 + c] / 255;
                if (WATER_USE_IMAGENET_NORM) v = (v - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
                chw[c * area + i] = v;
            }
        }

        const session = await getWaterSession();
        const tensor = new ort.Tensor('float32', chw, [1, 3, size, size]);
        updateScanLabel('Reading water appearance…');
        const results = await session.run({ [session.inputNames[0]]: tensor });
        const raw = results[session.outputNames[0]].data;

        if (raw.length !== WATER_CLASSES.length) {
            console.warn('[Water] Model outputs ' + raw.length + ' classes but WATER_CLASSES lists ' +
                WATER_CLASSES.length + '. Update WATER_CLASSES to match your training folders. ' +
                'Water labels are ignored until they match.');
            return { available: false, probs: [], topIndex: -1, topClass: null, topProb: 0,
                     error: 'Class count mismatch (' + raw.length + ' vs ' + WATER_CLASSES.length + ')' };
        }

        const rawSum = Array.prototype.reduce.call(raw, function (a, b) { return a + b; }, 0);
        const probs = (Math.abs(rawSum - 1) < 0.01 && Array.prototype.every.call(raw, function (v) { return v >= 0; }))
            ? Array.prototype.slice.call(raw)
            : softmax(raw);

        let topIdx = 0;
        for (let i = 1; i < probs.length; i++) if (probs[i] > probs[topIdx]) topIdx = i;

        return {
            available: true,
            probs: probs,
            topIndex: topIdx,
            topClass: WATER_CLASSES[topIdx] || ('class_' + topIdx),
            topProb: probs[topIdx]
        };
    } catch (err) {
        console.error('[Water] Water classification unavailable, using color heuristic:', err);
        return { available: false, probs: [], topIndex: -1, topClass: null, topProb: 0, error: err.message };
    }
}

function scoreWater(water) {
    if (!water || !water.available || water.topProb < WATER_MIN_CONFIDENCE) {
        return { label: 'uncertain', points: 0, usable: false };
    }
    if (water.topClass !== 'clean' && water.topProb < WATER_POLLUTED_MIN_CONFIDENCE) {
        return { label: 'uncertain', points: 0, usable: false };
    }
    const base = WATER_CLASS_POINTS[water.topClass];
    const points = Math.max(0, Math.min(25, Math.round((base === undefined ? 10 : base) * (0.5 + 0.5 * water.topProb))));
    return { label: water.topClass, points: points, usable: true };
}

function buildAssessment(items, contextItems, surface, clutter, modelAvailable, waterInfo, sceneItems, cleanEvidence) {
    const parts = [];
    if (!modelAvailable) {
        parts.push('Object detection is unavailable right now (the model failed to load), so this reading is based on color and texture only.');
    }
    if (cleanEvidence) {
        parts.push('This river looks healthy: no litter, no surface contamination and no discoloration were found.');
    }
    if (items.length) {
        const total = items.reduce(function (sum, i) { return sum + i.count; }, 0);
        parts.push('Detected ' + total + ' litter ' + (total === 1 ? 'item' : 'items') + ' in the frame.');
    } else {
        parts.push('No individually recognizable litter or dumped items were detected by the object scanner.');
    }
    if (sceneItems && sceneItems.length) {
        parts.push('Water pollution detected: ' + sceneItems.map(function (x) { return x.text; }).join(', ') + '.');
    }
    if (waterInfo && waterInfo.available) {
        parts.push('Water appearance: ' + (WATER_CLASS_TEXT[waterInfo.label] || waterInfo.label.replace(/_/g, ' ')) +
            ' (' + Math.round(waterInfo.topProb * 100) + '% confident).');
    }
    parts.push(/^Water tint:/.test(surface.colorCast)
        ? surface.colorCast + '.'
        : 'Surface reading: ' + surface.colorCast.toLowerCase() + '.');
    parts.push('Texture reading: ' + clutter.clutterReading.toLowerCase() + '.');
    if (contextItems.length) {
        const ctx = contextItems.map(function (c) { return c.count + ' ' + pluralize(c.label.replace(/_/g, ' '), c.count); }).join(', ');
        parts.push('Also visible: ' + ctx + ' (not counted toward the score).');
    }
    return parts.join(' ');
}

const CLIP_SCAN_WAIT_MS = 25000;     
const CLIP_SUBMIT_WAIT_MS = 60000;  

function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise(function (_, reject) {
        timer = setTimeout(function () {
            reject(new Error(label + ' did not finish within ' + Math.round(ms / 1000) + 's'));
        }, ms);
    });
    return Promise.race([promise, timeout]).finally(function () { clearTimeout(timer); });
}

async function runRiverCheck(imageDataUrl, waitMs) {
    const clip = await getClipGate();
    return withTimeout(clip.checkRiverPhoto(imageDataUrl), waitMs, 'River-photo check');
}

const TINT_SAMPLE_W = 160;
const TINT_TOP = 0.40;
const TINT_MIN_WATER_SHARE = 0.15;
const TINT_CLEAR_MAX = 0.25;
const TINT_HEAVY_MIN = 0.60;
const TINT_MAX_POINTS = 35;

function rgbToHsv(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
        if (max === r) h = 60 * (((g - b) / d) % 6);
        else if (max === g) h = 60 * ((b - r) / d + 2);
        else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return { h: h, s: max ? d / max : 0, v: max / 255 };
}

function measureWaterTint(pixels, w, h) {
    let brown = 0, clear = 0, neutral = 0, other = 0, brownSat = 0;
    for (let y = Math.floor(h * TINT_TOP); y < h; y++) {
        for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4;
            const c = rgbToHsv(pixels[o], pixels[o + 1], pixels[o + 2]);
            const wt = (x > w * 0.2 && x < w * 0.8) ? 1 : 0.5;
            if (c.v < 0.10) continue;
            if (c.v > 0.88 && c.s < 0.12) { other += wt; continue; }
            if (c.h >= 70 && c.h <= 165 && c.s >= 0.20) { other += wt; continue; }
            if (c.h >= 15 && c.h <= 60 && c.s >= 0.16) { brown += wt; brownSat += c.s * wt; continue; }
            if (c.h >= 165 && c.h <= 260 && c.s >= 0.10) { clear += wt; continue; }
            neutral += wt;
        }
    }
    const water = brown + clear + neutral;
    const total = water + other;
    if (!total || water / total < TINT_MIN_WATER_SHARE) {
        return { available: false, murkyShare: 0, points: 0, level: 'unknown', text: 'Water tint: not enough visible water to judge' };
    }
    const murkyShare = brown / water;
    const meanBrownSat = brown ? brownSat / brown : 0;
    const strength = Math.max(0.5, Math.min(1, (meanBrownSat - 0.12) / (0.30 - 0.12)));
    const ramp = Math.max(0, Math.min(1, (murkyShare - TINT_CLEAR_MAX) / (TINT_HEAVY_MIN - TINT_CLEAR_MAX)));
    const points = Math.round(ramp * strength * TINT_MAX_POINTS);
    const level = murkyShare <= TINT_CLEAR_MAX ? 'clear'
        : murkyShare < 0.40 ? 'slightly murky'
        : murkyShare < TINT_HEAVY_MIN ? 'murky' : 'heavily turbid';
    return { available: true, murkyShare: murkyShare, strength: strength, points: points, level: level, waterShare: water / total };
}

const TINT_TEXT = {
    'clear': 'clear, with no brown or muddy tint',
    'slightly murky': 'slightly murky, with a light brown tint',
    'murky': 'murky brown (suspended sediment)',
    'heavily turbid': 'heavily turbid, muddy brown water'
};

function computeWaterTint(imageDataUrl) {
    return new Promise(function (resolve) {
        const img = new Image();
        img.onload = function () {
            const w = TINT_SAMPLE_W;
            const h = Math.max(1, Math.round(img.height * w / img.width));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            const t = measureWaterTint(ctx.getImageData(0, 0, w, h).data, w, h);
            if (t.available) {
                t.text = 'Water tint: ' + TINT_TEXT[t.level] + ' (' + Math.round(t.murkyShare * 100) + '% of the visible water is brown)';
            }
            resolve(t);
        };
        img.onerror = function () {
            resolve({ available: false, murkyShare: 0, points: 0, level: 'unknown', text: '' });
        };
        img.src = imageDataUrl;
    });
}

const CLIP_VERIFY_WAIT_MS = 8000;
const CLIP_VERIFY_MAX_BOXES = 6;
const CLIP_VERIFY_MIN_OBJECT = 0.5;

const CLIP_LITTER_CAPTIONS = [
    'a photo of trash or garbage',
    'a photo of a plastic bag or plastic bottle',
    'a photo of floating litter in water',
    'a photo of a pile of rubbish'
];
const CLIP_OBJECT_CAPTIONS = {
    boat: ['a photo of a boat', 'a photo of a small wooden boat or canoe', 'a photo of a fishing boat'],
    person: ['a photo of a person'],
    rock: ['a photo of rocks or stones'],
    vegetation: ['a photo of plants, grass or a tree'],
    house: ['a photo of a house or building'],
    water_reflection: ['a photo of water ripples or reflections']
};

function cropDetection(img, d, pad) {
    const bw = d.x2 - d.x1, bh = d.y2 - d.y1;
    const x1 = Math.max(0, d.x1 - bw * pad), y1 = Math.max(0, d.y1 - bh * pad);
    const x2 = Math.min(img.width, d.x2 + bw * pad), y2 = Math.min(img.height, d.y2 + bh * pad);
    const cw = Math.round(x2 - x1), ch = Math.round(y2 - y1);
    if (cw < 8 || ch < 8) return null;
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    canvas.getContext('2d').drawImage(img, x1, y1, cw, ch, 0, 0, cw, ch);
    return canvas.toDataURL('image/jpeg', 0.9);
}

async function verifyLitterWithClip(imageDataUrl, detections) {
    const litter = detections
        .filter(function (d) { return !!POLLUTION_CLASS_INFO[d.label]; })
        .sort(function (a, b) { return b.score - a.score; })
        .slice(0, CLIP_VERIFY_MAX_BOXES);
    if (!litter.length) return { needed: false, ran: false, relabelled: 0 };

    let classifier = null;
    try {
        const clip = await getClipGate();
        if (typeof clip.loadClipGate === 'function') {
            classifier = await withTimeout(clip.loadClipGate(), CLIP_VERIFY_WAIT_MS, 'Litter double-check');
        }
    } catch (err) {
        console.warn('[CLIP] Litter double-check unavailable:', err);
    }
    if (typeof classifier !== 'function') return { needed: true, ran: false, relabelled: 0 };

    const captionToObject = {};
    const objectCaptions = [];
    Object.keys(CLIP_OBJECT_CAPTIONS).forEach(function (k) {
        CLIP_OBJECT_CAPTIONS[k].forEach(function (c) { objectCaptions.push(c); captionToObject[c] = k; });
    });
    const captions = CLIP_LITTER_CAPTIONS.concat(objectCaptions);

    const img = await loadImage(imageDataUrl);
    let relabelled = 0;
    for (const d of litter) {
        const crop = cropDetection(img, d, 0.15);
        if (!crop) continue;
        let results;
        try {
            results = await withTimeout(classifier(crop, captions), 10000, 'Litter double-check');
        } catch (err) {
            console.warn('[CLIP] Double-check stopped:', err);
            break;
        }
        const litterProb = results
            .filter(function (r) { return CLIP_LITTER_CAPTIONS.indexOf(r.label) !== -1; })
            .reduce(function (sum, r) { return sum + r.score; }, 0);
        const totals = {};
        results.forEach(function (r) {
            const k = captionToObject[r.label];
            if (k) totals[k] = (totals[k] || 0) + r.score;
        });
        const best = Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; })[0];
        console.log('[CLIP] "' + d.label + '" box ' + Math.round(d.score * 100) + '%: litter ' +
            litterProb.toFixed(2) + (best ? ', ' + best + ' ' + totals[best].toFixed(2) : ''));
        if (best && totals[best] > litterProb && totals[best] >= CLIP_VERIFY_MIN_OBJECT) {
            d.originalLabel = d.label;
            d.label = best;
            d.verifiedBy = 'clip';
            relabelled++;
        }
    }
    return { needed: true, ran: true, relabelled: relabelled };
}

function combineScores(p) {
    const items = p.items, surface = p.surface, clutter = p.clutter;
    const water = p.water, waterScoring = p.waterScoring;

    const waterUsable = !!(water && water.available && waterScoring.usable);
    const classifierPoints = waterUsable ? waterScoring.points : surface.surfaceScore;
    const tintPoints = p.tint && p.tint.available ? p.tint.points : 0;
    const waterPoints = Math.max(classifierPoints, p.sceneScore, tintPoints);

    const noLitter = items.length === 0;
    const noSceneFlag = p.sceneScore === 0;
    const tintClear = !(p.tint && p.tint.available && p.tint.level !== 'clear');
    const tintStronglyClear = !!(p.tint && p.tint.available && p.tint.level === 'clear' && p.tint.waterShare >= 0.3);
    const waterLooksClean = tintClear && (waterUsable ? (waterScoring.label === 'clean' || (tintStronglyClear && waterScoring.label === 'discolored')) : !surface.tinted);
    const cleanEvidence = !!p.modelAvailable && noLitter && noSceneFlag && waterLooksClean;

    let clutterPoints = clutter.clutterScore;
    if (cleanEvidence) clutterPoints = Math.min(clutterPoints, 8);
    else if (noLitter && noSceneFlag) clutterPoints = Math.min(clutterPoints, 8);

    let score = Math.max(0, Math.min(100, p.litterScore + waterPoints + clutterPoints));
    if (cleanEvidence) score = Math.min(score, 20);

    const litterCount = items.reduce(function (sum, i) { return sum + (i.count || 0); }, 0);
    if (!cleanEvidence && score <= 30 && (litterCount >= 2 || p.litterScore >= 8)) {
        score = 31;
    }

    let status = 'healthy';
    if (score > 65) status = 'polluted';
    else if (score > 30) status = 'moderate';

    return { score: score, status: status, cleanEvidence: cleanEvidence,
             waterUsable: waterUsable, clutterPoints: clutterPoints, waterPoints: waterPoints,
             classifierPoints: classifierPoints, tintPoints: tintPoints };
}

async function analyzeRiverImage(imageDataUrl) {
    updateScanLabel('Checking that this is a river photo…');
    const slowNote = setTimeout(function () {
        updateScanLabel('Checking that this is a river photo… the first scan downloads the checker, which can take a minute.');
    }, 6000);
    let gate = null;
    try {
        gate = await runRiverCheck(imageDataUrl, CLIP_SCAN_WAIT_MS);
        console.log('[CLIP]', gate.topLabel, gate.topScore.toFixed(2), 'water:', gate.waterScore.toFixed(2));
    } catch (err) {
        console.warn('[CLIP] River check unavailable or still loading, continuing without it:', err);
    } finally {
        clearTimeout(slowNote);
    }
    if (gate && !gate.ok) {
        const e = new Error('Not a river photo');
        e.code = 'NOT_RIVER';
        throw e;
    }

    const [yoloResult, stats, clutterStats, blurStats, tint] = await Promise.all([
        runYoloDetection(imageDataUrl),
        computeImageStats(imageDataUrl),
        computeClutterStats(imageDataUrl),
        computeBlurStats(imageDataUrl),
        computeWaterTint(imageDataUrl)
    ]);
    const water = await runWaterClassification(imageDataUrl);
    const detections = filterDetections(yoloResult.detections, yoloResult.width, yoloResult.height);
    if (detections.some(function (d) { return !!POLLUTION_CLASS_INFO[d.label]; })) {
        updateScanLabel('Double-checking detected items\u2026');
    }
    const litterCheck = await verifyLitterWithClip(imageDataUrl, detections);

    const { litterScore, items, contextItems, sceneItems, sceneScore, topScene } = scoreDetections(detections);
    const surface = scoreSurface(stats);
    if (tint.available) {
        surface.colorCast = tint.text;
        surface.tinted = tint.level !== 'clear';
    }
    const clutter = scoreClutter(clutterStats);

    const naturalCount = detections.filter(function (d) {
        return NATURAL_LABELS.indexOf(d.label) !== -1;
    }).length;
    if (naturalCount) {
        const discount = Math.min(0.6, naturalCount * 0.15);
        clutter.clutterScore = Math.round(clutter.clutterScore * (1 - discount));
    }

    const waterScoring = scoreWater(water);
    const sceneCheck = assessScenePlausibility(stats, detections, water);
    const warnings = buildWarnings(blurStats, sceneCheck);
    if (litterCheck.needed && !litterCheck.ran) {
        warnings.push({
            type: 'verify',
            message: 'Detected items could not be double-checked yet (the checker is still loading), so a boat or rock may be counted as trash. Scan again in a minute for a checked result.'
        });
    }
    if (!gate) {
        warnings.push({
            type: 'gate',
            message: 'The river-photo check was still loading, so this scan skipped it. The result below is still valid; the check will run when you submit.'
        });
    }

    const combined = combineScores({
        litterScore: litterScore, items: items, sceneScore: sceneScore,
        surface: surface, clutter: clutter, water: water, waterScoring: waterScoring,
        modelAvailable: yoloResult.modelAvailable, tint: tint
    });
    const waterUsable = combined.waterUsable;
    const cleanEvidence = combined.cleanEvidence;
    const score = combined.score;
    const status = combined.status;

    if (cleanEvidence && clutter.clutterReading !== 'Smooth, low-clutter surface') {
        clutter.clutterReading = 'Detailed natural texture (vegetation, ripples or rocks), not debris';
    }

    const detScores = detections.map(function (d) { return d.score; });
    const avgDetScore = detScores.length ? detScores.reduce(function (a, b) { return a + b; }, 0) / detScores.length : 0;
    let confidence = Math.round(detScores.length ? (avgDetScore * 70 + 30) : (yoloResult.modelAvailable ? 45 : 30));
    if (!detScores.length && waterUsable) {
        confidence = Math.round(Math.min(95, water.topProb * 60 + 40));
    }

    const waterInfo = { available: waterUsable, label: waterScoring.label, topProb: water.topProb };

    return {
        status: status,
        score: score,
        confidence: confidence,
        assessment: buildAssessment(items, contextItems, surface, clutter, yoloResult.modelAvailable, waterInfo, sceneItems, cleanEvidence),
        colorCast: surface.colorCast,
        waterTint: tint.available
            ? { level: tint.level, brownShare: Math.round(tint.murkyShare * 100), points: tint.points }
            : null,
        surfaceClarity: items.length
            ? items.reduce(function (sum, i) { return sum + i.count; }, 0) + ' litter item(s) detected'
            : 'No litter detected',
        lighting: surface.lighting,
        clutterReading: clutter.clutterReading,
        waterQuality: (topScene && sceneScore >= combined.classifierPoints)
            ? { label: topScene.kind, confidence: Math.round(topScene.score * 100) }
            : (waterUsable ? { label: waterScoring.label, confidence: Math.round(water.topProb * 100) } : null),
        overallReading: status.charAt(0).toUpperCase() + status.slice(1),
        detections: detections,
        modelAvailable: yoloResult.modelAvailable,
        gateRan: !!gate,
        items: items,
        contextItems: contextItems,
        warnings: warnings,
        stats: stats
    };
}

function pluralize(label, count) {
    if (count === 1) return label;
    if (/(ch|sh|s|x|z)$/.test(label)) return label + 'es';
    return label + 's';
}

async function drawDetections(imageDataUrl, detections) {
    const img = await loadImage(imageDataUrl);
    const previewImg = document.getElementById('previewImg');
    const canvas = document.getElementById('detectionCanvas');
    const container = document.getElementById('dropzone');

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');

    const scale = Math.min(cw / img.width, ch / img.height);
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const offX = (cw - drawW) / 2;
    const offY = (ch - drawH) / 2;

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0b0c10';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, img.width, img.height, offX, offY, drawW, drawH);

    detections.forEach(function (d) {
        const x = offX + d.x1 * scale;
        const y = offY + d.y1 * scale;
        const w = (d.x2 - d.x1) * scale;
        const h = (d.y2 - d.y1) * scale;
        const flagged = !!POLLUTION_CLASS_INFO[d.label] || !!SCENE_CLASS_INFO[d.label];
        const color = flagged ? '#d6574a' : '#4fae8c';

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        const label = d.label.replace(/_/g, ' ') + ' ' + Math.round(d.score * 100) + '%';
        ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
        const textW = ctx.measureText(label).width + 8;
        const labelY = Math.max(0, y - 16);
        ctx.fillStyle = color;
        ctx.fillRect(x, labelY, textW, 16);
        ctx.fillStyle = '#0b0c10';
        ctx.fillText(label, x + 4, labelY + 12);
    });

    previewImg.hidden = true;
    canvas.hidden = false;
}

function computeImageStats(imageDataUrl) {
    return new Promise(function (resolve) {
        const img = new Image();
        img.onload = function () {
            const sampleSize = 64;
            const canvas = document.createElement('canvas');
            canvas.width = sampleSize;
            canvas.height = sampleSize;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, sampleSize, sampleSize);

            const pixels = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
            let r = 0, g = 0, b = 0, count = 0;
            for (let i = 0; i < pixels.length; i += 4) {
                r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2];
                count++;
            }
            resolve({
                avgColor: { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) },
                sampledPixels: count
            });
        };
        img.onerror = function () {
            resolve({ avgColor: { r: 0, g: 0, b: 0 }, sampledPixels: 0 });
        };
        img.src = imageDataUrl;
    });
}

function showWaitingQuickRead() {
    document.getElementById('quickStatusDot').className = 'status-dot';
    document.getElementById('quickStatusTitle').textContent = 'Waiting for scan';
    document.getElementById('quickStatusSub').textContent = 'Upload or capture a photo, then run the scan.';
    document.getElementById('quickScoreValue').textContent = '—';
    document.getElementById('quickreadActions').hidden = true;
    updateSubmitUI();
}

function showSubmitStatus(kind, text) {
    const box = document.getElementById('submitStatus');
    if (!box) return;
    box.className = 'submit-status is-' + kind;
    box.textContent = text;
    box.hidden = !text;
}

function renderResultSegment() {
    const el = document.getElementById('resultSegment');
    if (!el) return;
    const sel = getSelection();
    el.textContent = sel.ok ? sel.label : 'No segment chosen yet. Choose one in step 1.';
    el.classList.toggle('is-missing', !sel.ok);
}

function hideRecommendation() {
    const box = document.getElementById('recoBox');
    if (box) box.hidden = true;
    const conf = document.getElementById('resultConfidence');
    if (conf) conf.hidden = true;
    showSubmitStatus('', '');
}

function renderQuickRead(result) {
    const statusLabels = { healthy: 'Healthy', moderate: 'Moderate', polluted: 'Polluted', critical: 'Critical' };

    document.getElementById('quickStatusDot').className = 'status-dot ' + result.status;
    document.getElementById('quickStatusTitle').textContent = statusLabels[result.status] || result.status;
    document.getElementById('quickStatusSub').textContent = result.assessment;
    document.getElementById('quickScoreValue').textContent = result.score;
    document.getElementById('quickreadActions').hidden = false;
    renderResultSegment();
    const conf = document.getElementById('resultConfidence');
    if (conf && result.confidence != null) {
        conf.textContent = 'Model confidence: ' + Math.round(result.confidence) + '%';
        conf.hidden = false;
    }

    const recoText = document.getElementById('recoText');
    const recoSource = document.getElementById('recoSource');
    const recoBox = document.getElementById('recoBox');
    if (recoText && recoBox) {
        const token = String(Date.now());
        recoBox.dataset.token = token;
        recoText.textContent = buildRecommendation(result) + ' ' + DISCLAIMER;
        if (recoSource) recoSource.textContent = 'Rule-based suggestion from the scan result.';
        recoBox.hidden = false;
        recommendationFor(result).then(function (reco) {
            if (reco.source !== 'rules+gemini' || recoBox.dataset.token !== token) return;
            recoText.textContent = reco.text;
            if (recoSource) recoSource.textContent = 'Rule-based suggestion, reworded by Gemini.';
        });
    }

    renderWarnings(result.warnings);
    updateSubmitUI();
}

function renderWarnings(warnings) {
    const box = document.getElementById('scanWarnings');
    if (!box) return;
    box.innerHTML = '';
    if (!warnings || !warnings.length) {
        box.hidden = true;
        return;
    }
    warnings.forEach(function (w) {
        const row = document.createElement('div');
        row.className = 'scan-warning scan-warning-' + w.type;
        row.innerHTML = '<span class="icon">!</span><span>' + escapeHtml(w.message) + '</span>';
        box.appendChild(row);
    });
    box.hidden = false;
}


function refreshVerifyUI() {
    return refreshGate();
}

function initAccessGate() {
    const form = document.getElementById('accessForm');
    const input = document.getElementById('accessCode');
    const btn = document.getElementById('accessBtn');
    const err = document.getElementById('accessError');
    const signOutBtn = document.getElementById('signOutBtn');
    const INVALID_MSG = 'That code didn\u2019t match an active official account.';

    if (form) {
        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            err.hidden = true;
            const code = input.value.trim().toUpperCase();
            if (!code) return;

            btn.disabled = true;
            btn.textContent = 'Checking\u2026';
            try {
                await verifyCode(code);
                input.value = '';
                refreshVerifyUI();
            } catch (ex) {
                console.error(ex);
                err.textContent = /Invalid or inactive/i.test(ex.message)
                    ? INVALID_MSG
                    : (!navigator.onLine
                        ? 'You are offline. Connect to the internet and try again.'
                        : 'Couldn\u2019t verify that code right now \u2014 please try again.');
                err.hidden = false;
            } finally {
                btn.disabled = false;
                btn.textContent = 'Verify';
            }
        });
    }

    if (signOutBtn) {
        signOutBtn.addEventListener('click', async function () {
            await signOutOfficial();
            refreshVerifyUI();
        });
    }

    refreshVerifyUI();
}

function boot() {
    initNav();
    initScanner();
    showWaitingQuickRead();
    initSteps({
        rivers: getRiverList(),
        coastLabels: COAST_LABELS,
        getUserLocation: getUserLocation,
        inBataan: inBataan,
        escapeHtml: escapeHtml
    });
    document.addEventListener('ricap:selection-change', renderResultSegment);
    renderResultSegment();
    initAccessGate();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}