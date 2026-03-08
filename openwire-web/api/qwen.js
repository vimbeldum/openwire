/* ================================================================
   OpenWire — Vercel Serverless: Qwen (Alibaba DashScope) Proxy
   Keeps ALIBABA_API_KEY server-side. Frontend calls /api/qwen.
   GET  → list available Qwen models
   POST → forward chat completion request via OpenAI-compatible API
   ================================================================ */

// International (Singapore) OpenAI-compatible endpoint
const BASE = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

// Models we expose in the dropdown (curated for chat/generation use)
const CURATED_MODELS = [
    { id: 'qwen3.5-flash', name: 'Qwen3.5 Flash', context_length: 131072 },
    { id: 'qwen-flash', name: 'Qwen Flash', context_length: 131072 },
    { id: 'qwen3.5-plus', name: 'Qwen3.5 Plus', context_length: 131072 },
    { id: 'qwen-turbo', name: 'Qwen Turbo', context_length: 131072 },
];

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const key = process.env.ALIBABA_API_KEY;
    if (!key) return res.status(500).json({ error: 'ALIBABA_API_KEY not configured on server' });

    try {
        if (req.method === 'GET') {
            // Return curated model list (DashScope doesn't have a public /models endpoint)
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
