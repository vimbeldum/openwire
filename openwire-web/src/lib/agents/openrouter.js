/* ═══════════════════════════════════════════════════════════
   OpenWire — Shared Core: OpenRouter Service
   Client-side wrapper that calls our /api/openrouter proxy.
   The OPENROUTER_KEY lives server-side only.
   ═══════════════════════════════════════════════════════════ */

const PROXY = '/api/openrouter';

/**
 * Fetch all models available on OpenRouter, then filter to free-only.
 * Free models have pricing.prompt === '0' and pricing.completion === '0'.
 *
 * @returns {Promise<Array>} Sorted array of free model objects
 */
export async function fetchFreeModels() {
    const resp = await fetch(PROXY);
    if (!resp.ok) throw new Error(`Model fetch failed: ${resp.status}`);
    const data = await resp.json();

    const models = (data.data || []).filter(
        m => m.pricing?.prompt === '0' && m.pricing?.completion === '0'
    );

    // Sort by context length descending so largest-context models come first
    models.sort((a, b) => (b.context_length || 0) - (a.context_length || 0));
    return models;
}

/**
 * Format a model's display label for dropdowns.
 * Shows name, context window, and parameter count if available.
 *
 * @param {object} model  OpenRouter model object
 * @returns {string}
 */
export function formatModelLabel(model) {
    const name = model.name || model.id;
    const params = extractParamCount(model);
    const ctx = model.context_length
        ? `${Math.round(model.context_length / 1000)}k`
        : '';
    return [name, params, ctx].filter(Boolean).join(' | ');
}

function extractParamCount(model) {
    // Try architecture.instruct_type or top_provider fields
    const arch = model.architecture;
    if (arch?.instruct_type) {
        const m = arch.instruct_type.match(/(\d+\.?\d*)\s*[bB]/);
        if (m) return `${m[1]}B`;
    }
    // Try extracting from model id (e.g. "llama-3.2-70b-instruct")
    const idMatch = model.id?.match(/(\d+\.?\d*)[bB](?:\b|-)/i);
    if (idMatch) return `${idMatch[1]}B`;
    // Try extracting from model name
    const nameMatch = model.name?.match(/(\d+\.?\d*)\s*[bB](?:\b|-)/i);
    if (nameMatch) return `${nameMatch[1]}B`;
    return '';
}

/**
 * Generate a character message via the OpenRouter proxy.
 *
 * @param {string} modelId          OpenRouter model id
 * @param {string} systemPrompt     Character's personality system prompt
 * @param {Array}  contextMessages  Recent chat as [{role, content}]
 * @param {number} [maxTokens=120]
 * @returns {Promise<string|null>}  Generated text, or null on failure
 */
export async function generateMessage(modelId, systemPrompt, contextMessages, maxTokens = 120) {
    const messages = [
        { role: 'system', content: systemPrompt },
        ...contextMessages,
    ];

    const resp = await fetch(PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: modelId,
            messages,
            max_tokens: maxTokens,
            temperature: 0.92,
        }),
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${resp.status}`);
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    return text || null;
}
