/* ================================================================
   OpenWire — Shared Core: Haimaker Service
   Client-side wrapper that calls our /api/haimaker proxy.
   The MINMAX_API_KEY lives server-side only.
   ================================================================ */

const PROXY = '/api/haimaker';

// Haimaker models (e.g. minimax) are thinking models — skip prompt repetition
// and strip <think> tags from output
const THINKING_MODEL_RE = /think|reasoning|deepseek-r1|qwq|minimax/i;
const THINK_TAG_RE = /<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>\s*/gi;
const UNCLOSED_THINK_RE = /<think(?:ing)?>[\s\S]*$/gi; // handles truncated responses

/**
 * Fetch available Haimaker models (curated list from proxy).
 * Returns sorted array of model objects.
 */
export async function fetchHaimakerModels() {
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
        throw new Error(`Haimaker model fetch failed: ${resp.status}`);
    }
    const data = await resp.json();

    return (data.models || []).map(m => ({
        id: m.id,
        name: m.name || m.id,
        context_length: m.context_length || 0,
        _provider: 'haimaker',
    }));
}

/**
 * Format a Haimaker model label for dropdowns.
 */
export function formatHaimakerLabel(model) {
    const name = model.name || model.id;
    const ctx = model.context_length
        ? `${Math.round(model.context_length / 1000)}k`
        : '';
    return [name, ctx].filter(Boolean).join(' | ');
}

/**
 * Generate a character message via Haimaker.
 * Uses OpenAI-compatible chat completions format.
 */
const IS_DEBUG_HM = typeof localStorage !== 'undefined' && localStorage.getItem('openwire_debug') === 'true';
const FETCH_TIMEOUT_MS = 120_000; // Thinking models need up to 2 mins

export async function generateHaimakerMessage(modelId, systemPrompt, contextMessages, maxTokens = 4096) {

    // Build OpenAI-style messages array — higher token budget because thinking models
    // use internal reasoning tokens before producing the visible reply
    const instruction = systemPrompt + '\n\nReminder: Roman-script Hinglish only. No Devanagari. 1-2 short sentences max. No emoji. No asterisks. Output ONLY your in-character dialogue — no thinking, reasoning, meta-commentary, or preamble. Always finish your sentence completely — never stop mid-word or mid-sentence.';

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
        max_tokens: maxTokens || 4096,
        temperature: 0.78,
    };

    if (IS_DEBUG_HM) {
        console.log('[Haimaker] Request:', { model: modelId, contextCount: contextMessages.length, maxTokens });
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
        if (IS_DEBUG_HM) console.error('[Haimaker] Error:', resp.status, err);
        const error = new Error(msg);
        error.status = resp.status;
        throw error;
    }

    const data = await resp.json();
    let text = data.choices?.[0]?.message?.content?.trim() || null;

    // Strip <think>...</think> reasoning blocks that thinking models emit
    // Also handle unclosed <think> tags (response cut off mid-reasoning)
    if (text) {
        text = text.replace(THINK_TAG_RE, '').replace(UNCLOSED_THINK_RE, '').trim() || null;
    }

    if (IS_DEBUG_HM) {
        console.log('[Haimaker] Response:', { model: modelId, text: text || '(empty)' });
        if (!text) console.warn('[Haimaker] Empty response! Full data:', data);
    }
    return text;
}
