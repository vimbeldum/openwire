/* ═══════════════════════════════════════════════════════════
   OpenWire — Shared Core: OpenRouter Service
   Client-side wrapper that calls our /api/openrouter proxy.
   The OPENROUTER_KEY lives server-side only.
   Supports model whitelist/blacklist filtering.
   ═══════════════════════════════════════════════════════════ */

const PROXY = '/api/openrouter';

// Thinking models don't benefit from prompt repetition
const THINKING_MODEL_RE = /think|reasoning|deepseek-r1|qwq/i;

/**
 * Fetch all models available on OpenRouter, then filter to free-only.
 * Applies whitelist/blacklist from modelFilters if provided.
 *
 * @param {object} [modelFilters] { whitelist: string[], blacklist: string[] }
 * @returns {Promise<Array>} Sorted array of free model objects
 */
export async function fetchFreeModels(modelFilters) {
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
        throw new Error(`Model fetch failed: ${resp.status}`);
    }
    const data = await resp.json();

    let models = (data.data || []).filter(
        m => m.pricing?.prompt === '0' && m.pricing?.completion === '0'
    );

    // Apply whitelist/blacklist filters
    if (modelFilters) {
        const wl = modelFilters.whitelist || [];
        const bl = modelFilters.blacklist || [];

        if (wl.length > 0) {
            // Whitelist mode: only include models in the whitelist
            models = models.filter(m => wl.includes(m.id));
        } else if (bl.length > 0) {
            // Blacklist mode: exclude models in the blacklist
            models = models.filter(m => !bl.includes(m.id));
        }
    }

    // Sort by context length descending so largest-context models come first
    models.sort((a, b) => (b.context_length || 0) - (a.context_length || 0));
    return models;
}

/**
 * Fetch ALL free models without any filtering (for Model Tester UI).
 * @returns {Promise<Array>}
 */
export async function fetchAllFreeModels() {
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
        throw new Error(`Model fetch failed: ${resp.status}`);
    }
    const data = await resp.json();

    const models = (data.data || []).filter(
        m => m.pricing?.prompt === '0' && m.pricing?.completion === '0'
    );
    models.sort((a, b) => (b.context_length || 0) - (a.context_length || 0));
    return models;
}

/**
 * Format a model's display label for dropdowns.
 * Shows name, context window, and parameter count if available.
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
    const arch = model.architecture;
    if (arch?.instruct_type) {
        const m = arch.instruct_type.match(/(\d+\.?\d*)\s*[bB]/);
        if (m) return `${m[1]}B`;
    }
    const idMatch = model.id?.match(/(\d+\.?\d*)[bB](?:\b|-)/i);
    if (idMatch) return `${idMatch[1]}B`;
    const nameMatch = model.name?.match(/(\d+\.?\d*)\s*[bB](?:\b|-)/i);
    if (nameMatch) return `${nameMatch[1]}B`;
    return '';
}

/**
 * Generate a character message via the OpenRouter proxy.
 */
const IS_DEBUG_OR = typeof localStorage !== 'undefined' && localStorage.getItem('openwire_debug') === 'true';
const FETCH_TIMEOUT_MS = 30_000;

export async function generateMessage(modelId, systemPrompt, contextMessages, maxTokens = 120) {
    // Triple prompt repetition for non-thinking models (research shows 3x improves accuracy)
    const isThinking = THINKING_MODEL_RE.test(modelId);
    const systemContent = isThinking
        ? systemPrompt
        : systemPrompt + '\n\n[REINFORCEMENT]\n' + systemPrompt + '\n\n[REINFORCEMENT]\n' + systemPrompt;

    const messages = [
        { role: 'system', content: systemContent },
        ...contextMessages,
    ];

    const payload = {
        model: modelId,
        messages,
        max_tokens: maxTokens,
        temperature: 0.78,
    };

    if (IS_DEBUG_OR) {
        console.log('[OpenRouter] Request:', { model: modelId, contextCount: contextMessages.length, maxTokens });
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
        if (IS_DEBUG_OR) console.error('[OpenRouter] Error:', resp.status, err);
        const error = new Error(msg);
        error.status = resp.status;
        throw error;
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (IS_DEBUG_OR) {
        console.log('[OpenRouter] Response:', { model: data.model, text: text || '(empty)', id: data.id });
        if (!text) console.warn('[OpenRouter] Empty response! choices:', JSON.stringify(data.choices), 'finish_reason:', data.choices?.[0]?.finish_reason);
    }
    return text || null;
}
