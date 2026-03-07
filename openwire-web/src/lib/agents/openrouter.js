/* ═══════════════════════════════════════════════════════════
   OpenWire — Shared Core: OpenRouter Service
   Client-side wrapper that calls our /api/openrouter proxy.
   The OPENROUTER_KEY lives server-side only.
   Supports model whitelist/blacklist filtering.
   ═══════════════════════════════════════════════════════════ */

const PROXY = '/api/openrouter';

/**
 * Fetch all models available on OpenRouter, then filter to free-only.
 * Applies whitelist/blacklist from modelFilters if provided.
 *
 * @param {object} [modelFilters] { whitelist: string[], blacklist: string[] }
 * @returns {Promise<Array>} Sorted array of free model objects
 */
export async function fetchFreeModels(modelFilters) {
    const resp = await fetch(PROXY);
    if (!resp.ok) throw new Error(`Model fetch failed: ${resp.status}`);
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
    const resp = await fetch(PROXY);
    if (!resp.ok) throw new Error(`Model fetch failed: ${resp.status}`);
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
        const msg = err?.error?.message || `HTTP ${resp.status}`;
        const error = new Error(msg);
        error.status = resp.status;
        throw error;
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    return text || null;
}
