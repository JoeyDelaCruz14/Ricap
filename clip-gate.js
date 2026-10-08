// clip-gate.js - zero-shot "is this a river photo?" check using CLIP
// The transformers library is loaded with a dynamic import() and several CDN
// fallbacks, so if a CDN is down this file still loads and only the gate fails.
//
// How it works: CLIP must pick the best-matching caption from a fixed list. If the list has no caption
// that fits (e.g. a glass of water or a matcha drink), it grabs the "closest" water caption by default.
// So the list below includes many look-alike things that are NOT rivers, and the river captions are
// specific (outdoors, natural water, riverbank) so an indoor drink can't win.

const LIB_URLS = [
    'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js',
    'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1/dist/transformers.min.js',
    'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2'
];

const WATER_LABELS = [
    'a photo of a river flowing outdoors',
    'a photo of a stream or creek in nature',
    'a photo of a canal or drainage channel with water outdoors',
    'a photo of a riverbank or shoreline with water',
    'a photo of polluted river water with trash floating outdoors',
    'a photo of a muddy or brown river',
    'an aerial photo of a river'
];

const NON_WATER_LABELS = [
    // people
    'a photo of people',
    'a selfie or portrait of a person',
    // indoors / objects / drinks (the usual false positives)
    'a photo of a glass of drinking water',
    'a photo of a drink in a glass or cup',
    'a photo of a cup of coffee, tea or matcha',
    'a photo of a bottle of water',
    'a photo of food on a table',
    'a close-up photo of an object on a table',
    'a product photo on a white background',
    'a photo of a kitchen or a sink with a faucet',
    'a photo of a bathtub, shower or swimming pool',
    'a photo of a fish tank or aquarium',
    'a close-up photo of water droplets or bubbles',
    'a photo of a room indoors',
    'a photo of a screen, poster or document',
    // outdoors, but not a river
    'a photo of a street or buildings',
    'a photo of a park, garden or trees on land',
    'a photo of a field or mountain',
    'a photo of the sky or clouds',
    'a photo of a pile of trash on land',
    'a photo of a car or a road',
    'a photo of an animal or a pet'
];

const ALL_LABELS = [...WATER_LABELS, ...NON_WATER_LABELS];
const MIN_WATER_SCORE = 0.6;   // total probability on river captions (was 0.5)
const MIN_TOP_SCORE = 0.25;    // best single caption must also be reasonably confident

let libPromise = null;
let classifierPromise = null;

function loadLib() {
    if (!libPromise) {
        libPromise = (async function () {
            let lastErr = null;
            for (const url of LIB_URLS) {
                try {
                    const lib = await import(url);
                    lib.env.allowLocalModels = false;
                    console.log('[CLIP] library loaded from', url);
                    return lib;
                } catch (e) {
                    console.warn('[CLIP] could not load', url, e);
                    lastErr = e;
                }
            }
            libPromise = null;
            throw lastErr || new Error('Could not load the CLIP library from any CDN.');
        })();
    }
    return libPromise;
}

export function loadClipGate(onProgress) {
    if (!classifierPromise) {
        classifierPromise = loadLib()
            .then(function (lib) {
                return lib.pipeline(
                    'zero-shot-image-classification',
                    'Xenova/clip-vit-base-patch32',
                    { progress_callback: onProgress }
                );
            })
            .catch(function (err) {
                classifierPromise = null;
                throw err;
            });
    }
    return classifierPromise;
}

// imageSrc: an object URL, data URL, or image URL
export async function checkRiverPhoto(imageSrc) {
    const classifier = await loadClipGate();
    const results = await classifier(imageSrc, ALL_LABELS);   // sorted, scores sum to 1

    const waterScore = results
        .filter(function (r) { return WATER_LABELS.includes(r.label); })
        .reduce(function (sum, r) { return sum + r.score; }, 0);

    const top = results[0];
    const ok = waterScore >= MIN_WATER_SCORE &&
               WATER_LABELS.includes(top.label) &&
               top.score >= MIN_TOP_SCORE;

    // handy when tuning: shows the 3 best captions in the browser console
    console.log('[CLIP] top 3:', results.slice(0, 3).map(function (r) {
        return r.label + ' ' + r.score.toFixed(2);
    }).join(' | '));

    return { ok: ok, waterScore: waterScore, topLabel: top.label, topScore: top.score, results: results };
}