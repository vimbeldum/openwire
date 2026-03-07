/* ═══════════════════════════════════════════════════════════
   OpenWire — Shared Core: Pop-Culture Agent Swarm Orchestrator
   Manages per-character timers, model assignment, shared chat
   context, and message generation via the OpenRouter service.

   Design mirrors GameEngine.js:
     - Class-based engine with a clear public API
     - Stateless from the caller's perspective (all state internal)
     - Registry pattern for extensibility
   ═══════════════════════════════════════════════════════════ */

import { CHARACTERS, SHOWS } from './characters.js';
import { fetchFreeModels, generateMessage } from './openrouter.js';

/** How many recent messages to keep in the shared context buffer */
const CONTEXT_BUFFER_SIZE = 12;

/** Default fallback free model if none are fetched */
const FALLBACK_MODEL = 'meta-llama/llama-3.2-3b-instruct:free';

/**
 * AgentSwarm — orchestrates multiple character agents.
 *
 * Usage:
 *   const swarm = new AgentSwarm({ onMessage, onError, onModelLoad });
 *   await swarm.start();
 *   swarm.addContext('UserNick', 'some message text');
 *   swarm.stop();
 */
export class AgentSwarm {
    /**
     * @param {object} opts
     * @param {Function} opts.onMessage  Called with (characterId, nick, text)
     * @param {Function} [opts.onError]  Called with (errorString)
     * @param {Function} [opts.onModelLoad] Called with (modelsArray) after init
     */
    constructor({ onMessage, onError, onModelLoad }) {
        this._onMessage   = onMessage;
        this._onError     = onError   || (() => {});
        this._onModelLoad = onModelLoad || (() => {});

        this._running = false;
        this._timers  = {};            // { characterId: timeoutId }

        this._freeModels     = [];     // cached from OpenRouter
        this._modelOverrides = {};     // { characterId: modelId }
        this._charEnabled    = {};     // { characterId: bool }
        this._showEnabled    = {};     // { showId: bool }

        // Shared context: last N messages for agents to react to
        this._context = [];            // [{ role:'user', content:'Nick: text' }]

        // Per-character assigned model (randomised on init, sticks until override)
        this._assignedModels = {};

        // Seed enabled state from character defaults
        Object.values(CHARACTERS).forEach(c => { this._charEnabled[c.id] = true; });
        Object.values(SHOWS).forEach(s    => { this._showEnabled[s.id]   = true; });
    }

    // ── Public lifecycle ─────────────────────────────────────

    /** Load models, assign them to characters, and start all timers. */
    async start() {
        if (this._running) return;
        this._running = true;

        try {
            this._freeModels = await fetchFreeModels();
        } catch (e) {
            this._onError(`[Swarm] Model fetch failed: ${e.message}. Using fallback.`);
            this._freeModels = [];
        }

        this._onModelLoad(this._freeModels);
        this._assignModels();

        // Stagger initial timers so characters don't all fire simultaneously
        Object.keys(CHARACTERS).forEach((id, idx) => {
            setTimeout(() => this._scheduleNext(id), idx * 7_000);
        });
    }

    /** Stop all character timers. */
    stop() {
        this._running = false;
        Object.values(this._timers).forEach(t => clearTimeout(t));
        this._timers = {};
    }

    // ── Context management ───────────────────────────────────

    /**
     * Feed a new chat message into the shared context buffer.
     * Call this from ChatRoom whenever a user or peer sends a message.
     *
     * @param {string} nick
     * @param {string} text
     */
    addContext(nick, text) {
        if (!text || typeof text !== 'string') return;
        this._context.push({ role: 'user', content: `${nick}: ${text}` });
        if (this._context.length > CONTEXT_BUFFER_SIZE) this._context.shift();
    }

    // ── Configuration ────────────────────────────────────────

    setCharacterEnabled(characterId, enabled) {
        this._charEnabled[characterId] = enabled;
    }

    setShowEnabled(showId, enabled) {
        this._showEnabled[showId] = enabled;
    }

    /**
     * Override the model for a specific character.
     * Pass null/undefined to revert to random assignment.
     */
    setModelOverride(characterId, modelId) {
        this._modelOverrides[characterId] = modelId || null;
    }

    // ── Read-only state ──────────────────────────────────────

    get running()       { return this._running; }
    get freeModels()    { return this._freeModels; }

    getAssignedModel(characterId) {
        return this._modelOverrides[characterId] || this._assignedModels[characterId] || FALLBACK_MODEL;
    }

    isCharacterEnabled(characterId) {
        return !!this._charEnabled[characterId];
    }

    isShowEnabled(showId) {
        return !!this._showEnabled[showId];
    }

    // ── Private helpers ──────────────────────────────────────

    /** Randomly assign a free model to each character on start */
    _assignModels() {
        const pool = this._freeModels.length ? this._freeModels : [{ id: FALLBACK_MODEL }];
        Object.keys(CHARACTERS).forEach(id => {
            const model = pool[Math.floor(Math.random() * pool.length)];
            this._assignedModels[id] = model.id;
        });
    }

    _isActive(characterId) {
        const c = CHARACTERS[characterId];
        return c
            && this._charEnabled[characterId]
            && this._showEnabled[c.show];
    }

    /** Schedule the next message for a character within their configured window */
    _scheduleNext(characterId) {
        if (!this._running) return;
        const c = CHARACTERS[characterId];
        if (!c) return;

        const delay = c.minInterval + Math.random() * (c.maxInterval - c.minInterval);

        this._timers[characterId] = setTimeout(async () => {
            if (!this._running) return;

            if (this._isActive(characterId)) {
                await this._generate(characterId);
            }

            this._scheduleNext(characterId);
        }, delay);
    }

    /** Generate and emit a message for the given character */
    async _generate(characterId) {
        const c = CHARACTERS[characterId];
        const modelId = this.getAssignedModel(characterId);

        // Build context: last 5 messages plus a trigger prompt
        const recent = this._context.slice(-5);
        const trigger = recent.length
            ? [{ role: 'user', content: `Recent conversation:\n${recent.map(m => m.content).join('\n')}\n\nNow respond in character with ONE short message.` }]
            : [{ role: 'user', content: 'Say something fun and in-character for this chat room.' }];

        try {
            const text = await generateMessage(modelId, c.systemPrompt, trigger, 120);
            if (text) {
                this._onMessage(characterId, c.name, c.avatar, text);
            }
        } catch (e) {
            this._onError(`[${c.name}] ${e.message}`);
        }
    }
}
