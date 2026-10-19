<<<<<<< HEAD
let GEMINI_KEY = 'AIzaSyC548DV0jDyr0j6EM8idOBfpybz0aYSBXw';  // Gemini API key (starts with AIza) goes in gemini-config.js, never here: this file is public.
=======
let GEMINI_KEY = 'AQ.Ab8RN6LzjKNBpnPec2JsN7iyEN8FNTCOkRsIA1dkfEQyC4SS4Q';
>>>>>>> 69a60d4bd80cec7df8c2b26dc41dfb3cfe2cf4b7
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';
const GEMINI_TIMEOUT_MS = 20000;
const GEMINI_DAILY_LIMIT = 20;  
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

export const DISCLAIMER = 'Based on photos only, with no chemical sampling. DENR-EMB water testing is authoritative.';

const FALLBACK = {
    healthy: 'Water looks in good shape. Keep monitoring monthly, discourage littering near the banks, and log a new scan after heavy rain.',
    moderate: '1) Organize a volunteer cleanup of visible litter within the week.\n2) Place waste bins and signage near the access point.\n3) Re-scan in 7 days and report to the barangay if the score rises.',
    polluted: '1) Notify the barangay and DENR/LGU for urgent cleanup.\n2) Trace and stop nearby dumping or drainage discharge.\n3) Avoid contact with the water; warn residents downstream.\n4) Re-scan after cleanup to confirm recovery.'
};

const cache = new Map();  

// The Gemini key: the built-in one, or gemini-config.js when running on localhost.
async function loadKey() {
    if (GEMINI_KEY) return GEMINI_KEY;
    if (!LOCAL_HOSTS.includes(location.hostname)) return '';
    try {
        const cfg = await import('./gemini-config.js');
        GEMINI_KEY = cfg.GEMINI_KEY || '';
    } catch (e) {  }
    if (GEMINI_KEY.startsWith('YOUR_') || GEMINI_KEY.startsWith('PASTE')) GEMINI_KEY = '';
    return GEMINI_KEY;
}

// Appends the photo-only disclaimer if missing.
function withDisclaimer(text) {
    return text.includes(DISCLAIMER) ? text : text + ' ' + DISCLAIMER;
}

// Counts calls per user per day; false once GEMINI_DAILY_LIMIT is reached.
function takeQuota(uid) {
    try {
        const k = 'ricap-gemini-' + (uid || 'anon') + '-' + new Date().toISOString().slice(0, 10);
        const n = Number(localStorage.getItem(k)) || 0;
        if (n >= GEMINI_DAILY_LIMIT) return false;
        localStorage.setItem(k, String(n + 1));
        return true;
    } catch (e) { return false; }
}

// Returns { text, source } from Gemini, or the rules text if Gemini is unavailable.
export async function getRecommendation(a, riverName, opts = {}) {
    const fallback = opts.ruleText || FALLBACK[a.status] || FALLBACK.moderate;
    const rules = { text: withDisclaimer(fallback), source: 'rules', rulesText: fallback };
    const items = (a.items || []).map(i => (i.count > 1 ? i.count + ' ' : '') + i.label).join(', ') || 'none';
    const role = String(opts.role || 'barangay official').slice(0, 40);
    const key = [a.status, items, role, riverName || '', fallback].join('|');
    if (cache.has(key)) return cache.get(key);

    // The Gemini request; shared by identical requests through the cache.
    const job = (async () => {
        if (!(await loadKey()) || !takeQuota(opts.uid)) return rules;
        const prompt =
            'Rewrite this river recommendation for a ' + role + ' in the Philippines so it reads naturally and briefly ' +
            '(max 200 words, plain text, no markdown). Keep every action and the urgency exactly as given. ' +
            'Do not remove or change any action or status. You may say who to contact for each action ' +
            '(barangay officials, MDRRMO, LGU environment office, DENR-EMB), but do not invent phone numbers, ' +
            'and do not add a disclaimer.\n' +
            'River: ' + (riverName || 'a Bataan river') + '\n' +
            'Status: ' + a.status + '\n' +
            'Detected items: ' + items + '\n' +
            'Recommendation: ' + fallback;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);
        try {
            const res = await fetch(GEMINI_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
                signal: ctrl.signal
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim().replace(/\*+/g, '');
            if (!text || text.length > 1600) throw new Error('unusable response');
            return { text: withDisclaimer(text), source: 'rules+gemini', rulesText: fallback };
        } catch (err) {
            console.warn('Gemini skipped, using rule-based text:', err.name === 'AbortError' ? 'timeout' : err.message);
            return rules;
        } finally {
            clearTimeout(timer);
        }
    })();
    cache.set(key, job);
    return job;
}
