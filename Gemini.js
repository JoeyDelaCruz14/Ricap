const GEMINI_KEY = 'PASTE_YOUR_GEMINI_API_KEY';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=';

const FALLBACK = {
    healthy: 'Water looks in good shape. Keep monitoring monthly, discourage littering near the banks, and log a new scan after heavy rain.',
    moderate: '1) Organize a volunteer cleanup of visible litter within the week.\n2) Place waste bins and signage near the access point.\n3) Re-scan in 7 days and report to the barangay if the score rises.',
    polluted: '1) Notify the barangay and DENR/LGU for urgent cleanup.\n2) Trace and stop nearby dumping or drainage discharge.\n3) Avoid contact with the water; warn residents downstream.\n4) Re-scan after cleanup to confirm recovery.'
};

export async function getRecommendation(a, riverName) {
    const fallback = FALLBACK[a.status] || FALLBACK.moderate;
    if (!GEMINI_KEY || GEMINI_KEY.startsWith('PASTE')) return { text: fallback, source: 'rules' };
    const prompt =
        'You advise Philippine barangay officials on river pollution. Based on this automated photo scan, give 3-5 short, ' +
        'practical action steps (numbered, plain text, max 90 words total, no markdown symbols).\n' +
        'River: ' + (riverName || 'unknown Bataan river') + '\n' +
        'Status: ' + a.status + ' (score ' + a.score + '/100)\n' +
        'Assessment: ' + a.assessment + '\n' +
        'Litter items: ' + JSON.stringify(a.items) + '\n' +
        'Water appearance: ' + (a.waterQuality ? a.waterQuality.label : 'n/a');
    try {
        const res = await fetch(GEMINI_URL + encodeURIComponent(GEMINI_KEY), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim();
        if (!text) throw new Error('empty response');
        return { text: text.replace(/\*+/g, ''), source: 'gemini' };
    } catch (err) {
        console.warn('Gemini failed, using fallback:', err);
        return { text: fallback, source: 'rules' };
    }
}