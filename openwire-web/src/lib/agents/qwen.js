/* ================================================================
   OpenWire — Shared Core: Qwen (Alibaba DashScope) Service
   Client-side wrapper that calls our /api/qwen proxy.
   The ALIBABA_API_KEY lives server-side only.
   ================================================================ */

const PROXY = '/api/qwen';

// Thinking models don't benefit from prompt repetition
const THINKING_MODEL_RE = /think|reasoning|deepseek-r1|qwq/i;

/**
 * Fetch available Qwen models (curated list from proxy).
 * Returns sorted array of model objects.
 */
export async function fetchQwenModels() {
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
        throw new Error(`Qwen model fetch failed: ${resp.status}`);
    }
    const data = await resp.json();

    return (data.models || []).map(m => ({
        id: m.id,
        name: m.name || m.id,
        context_length: m.context_length || 0,
        _provider: 'qwen',
    }));
}

/**
 * Format a Qwen model label for dropdowns.
 */
export function formatQwenLabel(model) {
    const name = model.name || model.id;
    const ctx = model.context_length
        ? `${Math.round(model.context_length / 1000)}k`
        : '';
    return [name, ctx].filter(Boolean).join(' | ');
}

/**
 * Generate a character message via Qwen.
 * Uses OpenAI-compatible chat completions format.
 */
const IS_DEBUG_QW = typeof localStorage !== 'undefined' && localStorage.getItem('openwire_debug') === 'true';
const FETCH_TIMEOUT_MS = 30_000;

export async function generateQwenMessage(modelId, systemPrompt, contextMessages, maxTokens = 120) {

    // Build OpenAI-style messages array
    const instruction = systemPrompt + '\n\nReminder: Roman-script Hinglish only. No Devanagari. 1-2 short sentences max. No emoji. You MAY use *asterisks* ONLY for physical actions (e.g., *slaps him*, *runs away*). Always finish your sentence completely — never stop mid-word or mid-sentence.';

    // Triple prompt repetition for non-thinking models (research shows 3x improves accuracy)
    const isThinking = THINKING_MODEL_RE.test(modelId);
    const systemContent = isThinking
        ? instruction
        : instruction + '\n\n[REINFORCEMENT]\n' + instruction + '\n\n[REINFORCEMENT]\n' + instruction;

    const messages = [
        { role: 'system', content: systemContent },
        ...contextMessages.map(m => ({
            role: m.role === 'model' ? 'assistant' : m.role,
            content: m.content,
        })),
    ];

    const payload = {
        model: modelId,
        messages,
        max_tokens: maxTokens || 200,
        temperature: 0.78,
    };

    if (IS_DEBUG_QW) {
        console.log('[Qwen] Request:', { model: modelId, contextCount: contextMessages.length, maxTokens });
    }

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
        if (IS_DEBUG_QW) console.error('[Qwen] Error:', resp.status, err);
        const error = new Error(msg);
        error.status = resp.status;
        throw error;
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (IS_DEBUG_QW) {
        console.log('[Qwen] Response:', { model: modelId, text: text || '(empty)' });
        if (!text) console.warn('[Qwen] Empty response! Full data:', data);
    }
    return text || null;
}
