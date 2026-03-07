/* ================================================================
   OpenWire — Vercel Serverless: Gemini Proxy
   Keeps GEMINI_API_KEY server-side. Frontend calls /api/gemini.
   GET  → fetch available Gemini models
   POST → forward generateContent request to Gemini
   ================================================================ */

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const key = process.env.GEMINI_API_KEY;
    if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });

    try {
        if (req.method === 'GET') {
            const upstream = await fetch(`${BASE}/models?key=${key}`);
            const data = await upstream.json();
            return res.status(upstream.status).json(data);
        }

        if (req.method === 'POST') {
            const { model, contents, generationConfig } = req.body;
            if (!model) return res.status(400).json({ error: 'model is required' });

            const upstream = await fetch(
                `${BASE}/models/${model}:generateContent?key=${key}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents, generationConfig }),
                }
            );

            const data = await upstream.json();
            return res.status(upstream.status).json(data);
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        return res.status(502).json({ error: `Upstream error: ${err.message}` });
    }
}
