/* ================================================================
   OpenWire — Shared Core: Gemini Service
   Client-side wrapper that calls our /api/gemini proxy.
   The GEMINI_API_KEY lives server-side only.
   ================================================================ */

const PROXY = '/api/gemini';

// Thinking models don't benefit from prompt repetition
const THINKING_MODEL_RE = /think|reasoning|deepseek-r1|qwq/i;

/**
 * Fetch all Gemini models that support generateContent.
 * Returns sorted array of model objects.
 */
export async function fetchGeminiModels() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let resp;
    try {
        resp = await fetch(PROXY, { signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
    if (!resp.ok) {
        await resp.text().catch(() => '');
        throw new Error(`Gemini model fetch failed: ${resp.status}`);
    }
    const data = await resp.json();

    const models = (data.models || [])
        .filter(m =>
            m.supportedGenerationMethods?.includes('generateContent') &&
            !m.name?.includes('embedding')
        )
        .map(m => ({
            id: m.name?.replace('models/', '') || m.name,
            name: m.displayName || m.name,
            context_length: m.inputTokenLimit || 0,
            outputTokenLimit: m.outputTokenLimit || 0,
            _provider: 'gemini',
        }))
        .sort((a, b) => (b.context_length || 0) - (a.context_length || 0));

    return models;
}

/**
 * Format a Gemini model label for dropdowns.
 */
export function formatGeminiLabel(model) {
    const name = model.name || model.id;
    const ctx = model.context_length
        ? `${Math.round(model.context_length / 1000)}k`
        : '';
    return [name, ctx].filter(Boolean).join(' | ');
}

/**
 * Generate a character message via Gemini.
 * Converts OpenAI-style messages to Gemini format.
 */
const IS_DEBUG_GM = typeof localStorage !== 'undefined' && localStorage.getItem('openwire_debug') === 'true';
const FETCH_TIMEOUT_MS = 30_000;

export async function generateGeminiMessage(modelId, systemPrompt, contextMessages, maxTokens = 120) {

    // Build Gemini contents from OpenAI-style messages
    const contents = [];

    // System instruction goes as the first user turn
    // Then alternate user/model for context
    const instruction = systemPrompt + '\n\nReminder: Roman-script Hinglish only. No Devanagari. 1-2 short sentences max. No emoji. You MAY use *asterisks* ONLY for physical actions (e.g., *slaps him*, *runs away*). Always finish your sentence completely — never stop mid-word or mid-sentence.';

    // Triple prompt repetition for non-thinking models (research shows 3x improves accuracy)
    const isThinking = THINKING_MODEL_RE.test(modelId);
    const systemContent = isThinking
        ? instruction
        : instruction + '\n\n---\n\n' + instruction + '\n\n---\n\n' + instruction;

    const contextMapped = contextMessages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        content: m.content,
    }));

    const allMsgs = [
        { role: 'user', content: systemContent },
        { role: 'model', content: 'Samjha! Hinglish mein, 1-2 lines, Roman script only, no emoji, *actions* allowed.' },
        ...contextMapped,
    ];

    // Gemini requires strict user/model alternation — merge consecutive same-role turns
    allMsgs.forEach(m => {
        const role = m.role === 'model' ? 'model' : 'user';
        const last = contents[contents.length - 1];
        if (last && last.role === role) {
            last.parts[0].text += '\n' + m.content;
        } else {
            contents.push({ role, parts: [{ text: m.content }] });
        }
    });

    const payload = {
        model: modelId,
        contents,
        generationConfig: {
            maxOutputTokens: maxTokens || 200,
            temperature: 0.78,
        },
    };

    if (IS_DEBUG_GM) {
        console.log('[Gemini] Request:', { model: modelId, contextCount: contextMessages.length, maxTokens });
    }

    // AbortController with 30s timeout — prevents hung fetch from locking the queue
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let resp;
    try {
        resp = await fetch(PROXY, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        const msg = err?.error?.message || `HTTP ${resp.status}`;
        if (IS_DEBUG_GM) console.error('[Gemini] Error:', resp.status, err);
        const error = new Error(msg);
        error.status = resp.status;
        throw error;
    }

    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (IS_DEBUG_GM) {
        console.log('[Gemini] Response:', { model: modelId, text: text || '(empty)' });
        if (!text) console.warn('[Gemini] Empty response! Full data:', data);
    }
    return text || null;
}
