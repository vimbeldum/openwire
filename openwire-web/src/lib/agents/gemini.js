/* ================================================================
   OpenWire — Shared Core: Gemini Service
   Client-side wrapper that calls our /api/gemini proxy.
   The GEMINI_API_KEY lives server-side only.
   ================================================================ */

const PROXY = '/api/gemini';

/**
 * Fetch all Gemini models that support generateContent.
 * Returns sorted array of model objects.
 */
export async function fetchGeminiModels() {
    const resp = await fetch(PROXY);
    if (!resp.ok) throw new Error(`Gemini model fetch failed: ${resp.status}`);
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
export async function generateGeminiMessage(modelId, systemPrompt, contextMessages, maxTokens = 120) {
    const isDebug = typeof localStorage !== 'undefined' && localStorage.getItem('openwire_debug') === 'true';

    // Build Gemini contents from OpenAI-style messages
    const contents = [];

    // System instruction goes as the first user turn
    // Then alternate user/model for context
    const allMsgs = [
        { role: 'user', content: systemPrompt + '\n\nIMPORTANT: Prefer Hinglish — speak Hindi but written in English/Roman script (e.g. "Arey yaar, kya kar raha hai?"). Keep your response to 1-4 short lines maximum. Do not truncate mid-sentence. NEVER use Devanagari script.' },
        { role: 'model', content: 'Samjha! Main Hinglish mein baat karunga, 1-4 lines mein.' },
        ...contextMessages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            content: m.content,
        })),
    ];

    allMsgs.forEach(m => {
        const role = m.role === 'model' ? 'model' : 'user';
        contents.push({ role, parts: [{ text: m.content }] });
    });

    const geminiTokens = 2000;

    const payload = {
        model: modelId,
        contents,
        generationConfig: {
            maxOutputTokens: geminiTokens,
            temperature: 0.92,
        },
    };

    if (isDebug) {
        console.log('[Gemini] Request:', { model: modelId, contextCount: contextMessages.length, maxTokens });
    }

    const resp = await fetch(PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        const msg = err?.error?.message || `HTTP ${resp.status}`;
        if (isDebug) console.error('[Gemini] Error:', resp.status, err);
        const error = new Error(msg);
        error.status = resp.status;
        throw error;
    }

    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (isDebug) {
        console.log('[Gemini] Response:', { model: modelId, text: text || '(empty)' });
        if (!text) console.warn('[Gemini] Empty response! Full data:', data);
    }
    return text || null;
}
