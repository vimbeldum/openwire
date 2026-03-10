/* ================================================================
   OpenWire — Vercel Serverless: Haimaker Proxy
   Keeps MINMAX_API_KEY server-side. Frontend calls /api/haimaker.
   GET  → list available models (curated)
   POST → forward chat completion request via OpenAI-compatible API
   ================================================================ */

const BASE = 'https://api.haimaker.ai/v1';

// Models we expose in the dropdown (curated for chat/generation use)
const CURATED_MODELS = [
    { id: 'minimax/minimax-m2.5', name: 'MiniMax M2.5', context_length: 131072 },
];

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const key = process.env.MINMAX_API_KEY;
    if (!key) return res.status(500).json({ error: 'MINMAX_API_KEY not configured on server' });

    try {
        if (req.method === 'GET') {
            return res.status(200).json({ models: CURATED_MODELS });
        }

        if (req.method === 'POST') {
            const { model, messages, max_tokens, temperature } = req.body;
            if (!model) return res.status(400).json({ error: 'model is required' });

            const upstream = await fetch(`${BASE}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`,
                },
                body: JSON.stringify({
                    model,
                    messages,
                    max_tokens: max_tokens || 200,
                    temperature: temperature ?? 0.78,
                }),
            });

            const data = await upstream.json();
            return res.status(upstream.status).json(data);
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        return res.status(502).json({ error: `Upstream error: ${err.message}` });
    }
}
