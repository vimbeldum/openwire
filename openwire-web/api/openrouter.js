/* ═══════════════════════════════════════════════════════════
   OpenWire — Vercel Serverless: OpenRouter Proxy
   Keeps OPENROUTER_KEY server-side. Frontend calls /api/openrouter.
   GET  → fetch available models list from OpenRouter
   POST → forward chat completion request to OpenRouter
   ═══════════════════════════════════════════════════════════ */

const OR_BASE = 'https://openrouter.ai/api/v1';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const key = process.env.OPENROUTER_KEY;
    if (!key) return res.status(500).json({ error: 'OPENROUTER_KEY not configured on server' });

    const baseHeaders = {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://openwire.app',
        'X-Title': 'OpenWire Pop Culture Agents',
    };

    try {
        if (req.method === 'GET') {
            const upstream = await fetch(`${OR_BASE}/models`, { headers: baseHeaders });
            const data = await upstream.json();
            return res.status(upstream.status).json(data);
        }

        if (req.method === 'POST') {
            const upstream = await fetch(`${OR_BASE}/chat/completions`, {
                method: 'POST',
                headers: baseHeaders,
                body: JSON.stringify(req.body),
            });

            // Forward rate limit headers from OpenRouter
            const rlHeaders = ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after'];
            rlHeaders.forEach(h => {
                const val = upstream.headers.get(h);
                if (val) res.setHeader(h, val);
            });

            const data = await upstream.json();
            return res.status(upstream.status).json(data);
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        return res.status(502).json({ error: `Upstream error: ${err.message}` });
    }
}
