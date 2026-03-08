/* ═══════════════════════════════════════════════════════════
   OpenWire — Shared Core: Pop-Culture Agent Swarm Orchestrator
   Manages per-character timers, model assignment, shared chat
   context, and message generation via the OpenRouter service.

   Now uses dynamic config from agentStore instead of hardcoded
   imports. Supports hot-reload via loadConfig().

   Features: cross-over, moods, god-mode logging, session memory,
   throttle, typing indicators, smart @mention tagging,
   rate-limit-aware retry queue with exponential backoff.
   ═══════════════════════════════════════════════════════════ */

import { fetchFreeModels, generateMessage } from './openrouter.js';
import { fetchGeminiModels, generateGeminiMessage } from './gemini.js';
import { loadStore, getCharactersDict, getGroupsDict } from './agentStore.js';

const CONTEXT_BUFFER_SIZE = 1000;
const TURN2_ANCHOR = { role: 'assistant', content: 'Samjha! Main Hinglish mein aur exactly 1-2 lines mein interact karunga, Roman script only, no emoji, no asterisks, aur apni comedy engine ke rules break nahi karunga.', _isAgent: true };
const FALLBACK_MODEL = 'meta-llama/llama-3.1-8b-instruct:free';
const DEFAULT_ALL_MODEL = 'openrouter/auto';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';
const DEFAULT_MSG_PER_MIN = 60;
const CROSSOVER_PROBABILITY = 0.7;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2000;
const PER_CHAR_COOLDOWN_MS = 10_000;  // 1 message per 10s per character
const GLOBAL_COOLDOWN_MS = 5_000;     // 1 message per 5s across all AI
const MENTION_COOLDOWN_MS = 8_000;    // suppress other characters for 8s after @mention
const MAX_QUEUE_SIZE = 32;            // #9: cap queue to prevent unbounded growth

// Context compaction — auto-summarize via Gemini when context grows large
const COMPACT_THRESHOLD = 50;         // trigger compaction when context reaches this size
const COMPACT_KEEP_RECENT = 15;       // keep last 15 raw messages
const SUMMARY_MAX_CHARS = 2500;       // cap merged summary length
const SUMMARY_STORAGE_KEY = 'openwire_context_summary';

export class AgentSwarm {
    constructor({ onMessage, onError, onModelLoad, onLog, onTyping }) {
        this._onMessage   = onMessage;
        this._onError     = onError   || (() => {});
        this._onModelLoad = onModelLoad || (() => {});
        this._onLog       = onLog     || (() => {});
        this._onTyping    = onTyping  || (() => {});

        this._running = false;
        this._timers  = {};

        this._freeModels     = [];
        this._allFreeModels  = [];     // unfiltered for model tester
        this._modelOverrides = {};
        this._defaultModel   = DEFAULT_ALL_MODEL;
        this._charEnabled    = {};
        this._groupEnabled   = {};

        // Provider: 'openrouter' or 'gemini'
        this._provider = 'openrouter';
        this._geminiModels = [];

        this._context = [TURN2_ANCHOR];
        this._contextDirty = true;     // dirty flag for context cache
        this._cachedConvo = '';         // memoized context string
        this._cachedLastHuman = null;   // memoized last human message
        this._cachedRecent = [];        // memoized recent slice
        this._assignedModels = {};
        this._moods = {};
        this._sessionFacts = [];

        // Generation counter — incremented on loadConfig()/stop() to kill stale _scheduleNext chains
        this._generation = 0;

        // Context compaction — Gemini-powered auto-summarization (triggered by size, not timer)
        this._contextSummary = [];
        this._isCompacting = false;
        this._onSummaryUpdate = null;    // callback to broadcast summary to peers

        // Load persisted summary from previous session
        try {
            const stored = localStorage.getItem(SUMMARY_STORAGE_KEY);
            if (stored) this._contextSummary = JSON.parse(stored);
        } catch {}
        if (!Array.isArray(this._contextSummary)) this._contextSummary = [];

        this._messagesThisMinute = 0;
        this._throttleTimer = null;
        this._maxMsgPerMin = DEFAULT_MSG_PER_MIN;
        this._chatterLevel = 1.0;

        // Rate-limit-aware message queue
        this._messageQueue = [];
        this._isProcessingQueue = false;

        // Cooldown tracking for AI output rate limiting
        this._lastMsgByChar = {};   // characterId → timestamp
        this._lastMsgGlobal = 0;    // timestamp of last AI message
        this._perCharCooldown = PER_CHAR_COOLDOWN_MS;
        this._globalCooldown = GLOBAL_COOLDOWN_MS;

        // Mention ownership — suppresses other characters during directed @mentions
        this._mentionTarget = null;       // characterId of the @mentioned character
        this._mentionActiveUntil = 0;     // timestamp when cooldown expires
        this._lastCrossOverAt = 0;        // global crossover cooldown tracker

        // #1/#2: Track stagger timers so they can be cleared on stop/reload
        this._staggerTimers = [];
        // #3: Track crossover timers for cleanup (Set — callbacks self-remove on fire)
        this._crossoverTimers = new Set();
        // #4: Track mood revert timers for cleanup (Set — callbacks self-remove on fire)
        this._moodTimers = new Set();

        // #7: Cached agent names set (invalidated on config change)
        this._agentNamesCache = null;

        // Dynamic config — loaded from agentStore
        this._characters = {};  // dict { id: charObj }
        this._groups = {};      // dict { id: groupObj }
        this._modelFilters = { whitelist: [], blacklist: [] };
        this._guardrails = true; // SFW guardrails — toggled via admin panel

        // Load initial config from store
        this._loadFromStore();
    }

    // ── Config loading ────────────────────────────────────────

    _loadFromStore() {
        const store = loadStore();
        this._characters = getCharactersDict(store);
        this._groups = getGroupsDict(store);
        this._modelFilters = store.modelFilters || { whitelist: [], blacklist: [] };
        this._guardrails = store.guardrails !== false; // default true

        // #7: Invalidate agent names cache on config change
        this._agentNamesCache = null;

        // Seed enabled state
        Object.keys(this._characters).forEach(id => {
            if (this._charEnabled[id] === undefined) {
                this._charEnabled[id] = true;
                this._moods[id] = 'normal';
            }
        });
        Object.keys(this._groups).forEach(id => {
            if (this._groupEnabled[id] === undefined) this._groupEnabled[id] = true;
        });

        // #6: Prune stale entries for removed characters
        const validIds = new Set(Object.keys(this._characters));
        for (const id of Object.keys(this._lastMsgByChar)) {
            if (!validIds.has(id)) delete this._lastMsgByChar[id];
        }
        for (const id of Object.keys(this._moods)) {
            if (!validIds.has(id)) delete this._moods[id];
        }
        for (const id of Object.keys(this._assignedModels)) {
            if (!validIds.has(id)) delete this._assignedModels[id];
        }
    }

    // #7: Cached agent name lookup — avoids Set allocation on every addContext call
    _getAgentNames() {
        if (!this._agentNamesCache) {
            this._agentNamesCache = new Set(Object.values(this._characters).map(c => c.name));
        }
        return this._agentNamesCache;
    }

    /** Hot-reload config from agentStore without stopping the swarm */
    loadConfig() {
        const wasRunning = this._running;

        // Kill stale _scheduleNext chains
        this._generation++;

        // Stop existing timers
        Object.values(this._timers).forEach(t => clearTimeout(t));
        this._timers = {};

        // #1: Clear stagger timers from previous loadConfig/start
        this._staggerTimers.forEach(t => clearTimeout(t));
        this._staggerTimers = [];

        // Clear crossover timers
        for (const t of this._crossoverTimers) clearTimeout(t);
        this._crossoverTimers.clear();

        // Clear mood revert timers
        for (const t of this._moodTimers) clearTimeout(t);
        this._moodTimers.clear();

        this._loadFromStore();
        this._log('[Config] Hot-reloaded from agentStore');

        // Restart timers for any new characters
        if (wasRunning) {
            Object.keys(this._characters).forEach((id, idx) => {
                if (!this._timers[id]) {
                    const t = setTimeout(() => this._scheduleNext(id), idx * 3_000);
                    this._staggerTimers.push(t);
                }
            });
        }
    }

    // ── Public lifecycle ─────────────────────────────────────

    async start() {
        if (this._running) return;
        this._running = true;
        this._log('[Swarm] Starting...');

        // Re-load latest config
        this._loadFromStore();

        try {
            this._freeModels = await fetchFreeModels(this._modelFilters);
            this._log(`[Swarm] Fetched ${this._freeModels.length} free OpenRouter models`);
        } catch (e) {
            this._onError(`[Swarm] Model fetch failed: ${e.message}. Using fallback.`);
            this._log(`[Swarm] OpenRouter model fetch FAILED: ${e.message}`);
            this._freeModels = [];
        }

        this._onModelLoad(this._freeModels);
        this._assignModels();

        this._throttleTimer = setInterval(() => { this._messagesThisMinute = 0; }, 60_000);

        // #2: Track stagger timers so stop() can clear them
        this._staggerTimers = [];
        Object.keys(this._characters).forEach((id, idx) => {
            const t = setTimeout(() => this._scheduleNext(id), idx * 7_000);
            this._staggerTimers.push(t);
        });

        this._log('[Swarm] All timers scheduled');
    }

    stop() {
        this._running = false;
        this._generation++;
        Object.values(this._timers).forEach(t => clearTimeout(t));
        this._timers = {};
        // Clear typing indicators for all queued characters before draining
        this._messageQueue.forEach(t => {
            const c = this._characters[t.characterId];
            if (c) this._onTyping(t.characterId, c.name, c.avatar, false);
        });
        this._messageQueue = [];
        this._isProcessingQueue = false;
        if (this._throttleTimer) { clearInterval(this._throttleTimer); this._throttleTimer = null; }

        // #1/#2: Clear stagger timers
        this._staggerTimers.forEach(t => clearTimeout(t));
        this._staggerTimers = [];

        // #3: Clear crossover timers
        for (const t of this._crossoverTimers) clearTimeout(t);
        this._crossoverTimers.clear();

        // #4: Clear mood revert timers
        for (const t of this._moodTimers) clearTimeout(t);
        this._moodTimers.clear();

        this._log('[Swarm] Stopped');
    }

    /** Refresh model pool after filter changes (without full restart) */
    async refreshModels() {
        this._loadFromStore(); // pick up latest filters
        try {
            this._freeModels = await fetchFreeModels(this._modelFilters);
            this._log(`[Swarm] Refreshed models: ${this._freeModels.length} available`);
            this._onModelLoad(this._freeModels);
            this._assignModels();
        } catch (e) {
            this._log(`[Swarm] Model refresh failed: ${e.message}`);
        }
    }

    // ── Context management ───────────────────────────────────

    addContext(nick, text, forceIsAgent = false) {
        if (!text || typeof text !== 'string') return;
        // #7: Use cached agent names set
        const agentNames = this._getAgentNames();
        // Check exact match AND substring match to handle "😅 Jethalal" format from P2P broadcasts
        let isAgent = forceIsAgent || agentNames.has(nick);
        if (!isAgent) {
            for (const name of agentNames) {
                if (nick.includes(name)) { isAgent = true; break; }
            }
        }
        this._context.push({ role: 'user', content: `${nick}: ${text}`, _isAgent: isAgent });
        if (this._context.length > CONTEXT_BUFFER_SIZE) this._context.shift();
        this._contextDirty = true;

        // Trigger compaction when context grows past threshold (fire-and-forget, non-blocking)
        if (this._running && this._context.length >= COMPACT_THRESHOLD && !this._isCompacting) {
            this._compactContext();
        }

        if (!this._running) return;

        // ── CRITICAL: Only scan reactive triggers for HUMAN messages ──
        // Agent messages must NOT trigger other agents via keywords —
        // otherwise agents endlessly trigger each other (exponential loop)
        if (isAgent) {
            this._log(`[Reactivity] Skipped — agent message from ${nick}, no reactive scan`);
            return;
        }

        // Record human messages as session facts so characters remember the conversation
        if (text.length > 10) {
            this._extractFact(nick, text);
        }

        // If the message contains @mentions, skip reactive triggers — let the
        // @mention handler in ChatRoom handle priority queuing instead
        const hasMention = /@\w+/.test(text);
        if (hasMention) {
            this._log(`[Reactivity] Skipped — message contains @mention, deferring to mention handler`);
        } else {
            // Collect all matching characters — more can jump in when guardrails are OFF
            const lower = text.toLowerCase();
            const matched = Object.values(this._characters).filter(c => {
                if (!this._isActive(c.id)) return false;
                if (!c.reactive_tags?.length) return false;
                return c.reactive_tags.some(tag => lower.includes(tag.toLowerCase()));
            });

            // Shuffle and pick responders — 3 when unfiltered, 2 when SFW
            const MAX_REACTIVE = this._guardrails ? 2 : 3;
            const shuffled = matched.sort(() => Math.random() - 0.5);
            const selected = shuffled.slice(0, MAX_REACTIVE);
            const skipped = shuffled.slice(MAX_REACTIVE);

            if (skipped.length > 0) {
                this._log(`[Reactivity] Throttled: ${selected.map(c => c.name).join(', ')} respond; ${skipped.map(c => c.name).join(', ')} held back`);
            }

            selected.forEach(c => {
                this._log(`[Reactivity] ${c.name} triggered by keyword match in "${text.slice(0, 40)}..."`);
                // Do NOT clearTimeout or call _scheduleNext — let the background loop handle rescheduling
                this._generate(c.id);
            });
        }

        this._checkMoodShifts(text);
    }

    // ── Configuration ────────────────────────────────────────

    setCharacterEnabled(characterId, enabled) {
        this._charEnabled[characterId] = enabled;
        this._log(`[Config] ${this._characters[characterId]?.name} ${enabled ? 'enabled' : 'disabled'}`);
    }

    setShowEnabled(showId, enabled) {
        this._groupEnabled[showId] = enabled;
        this._log(`[Config] Group ${this._groups[showId]?.name} ${enabled ? 'enabled' : 'disabled'}`);
    }

    setModelOverride(characterId, modelId) {
        this._modelOverrides[characterId] = modelId || null;
        this._log(`[Config] ${this._characters[characterId]?.name} model -> ${modelId || 'default'}`);
    }

    setDefaultModel(modelId) {
        this._defaultModel = modelId || DEFAULT_ALL_MODEL;
        this._log(`[Config] Default model for ALL -> ${this._defaultModel}`);
    }

    setChatterLevel(level) {
        this._chatterLevel = Math.max(0.1, Math.min(3.0, level));
        this._log(`[Config] Chatter level -> ${this._chatterLevel.toFixed(2)}`);
    }

    setMaxMsgPerMin(limit) {
        this._maxMsgPerMin = Math.max(1, Math.min(999, limit));
        this._log(`[Config] Max msg/min -> ${this._maxMsgPerMin}`);
    }

    setPerCharCooldown(seconds) {
        this._perCharCooldown = Math.max(1, seconds) * 1000;
        this._log(`[Config] Per-character cooldown -> ${seconds}s`);
    }

    setGlobalCooldown(seconds) {
        this._globalCooldown = Math.max(1, seconds) * 1000;
        this._log(`[Config] Global cooldown -> ${seconds}s`);
    }

    get perCharCooldown() { return this._perCharCooldown / 1000; }
    get globalCooldown()  { return this._globalCooldown / 1000; }

    setMood(characterId, mood) {
        const c = this._characters[characterId];
        if (!c || !c.moods?.[mood]) return;
        this._moods[characterId] = mood;
        this._log(`[Mood] ${c.name} -> ${mood}`);
    }

    // ── Read-only state ──────────────────────────────────────

    get running()       { return this._running; }
    get freeModels()    { return this._freeModels; }
    get chatterLevel()  { return this._chatterLevel; }
    get maxMsgPerMin()  { return this._maxMsgPerMin; }
    get sessionFacts()  { return this._sessionFacts; }
    get characters()    { return this._characters; }
    get groups()        { return this._groups; }
    get modelFilters()  { return this._modelFilters; }
    get defaultModel()  { return this._defaultModel; }
    get guardrails()    { return this._guardrails; }
    set defaultModel(v) { this._defaultModel = v; this._log(`[Config] Default model -> ${v}`); }
    get queueLength()   { return this._messageQueue.length; }
    get provider()      { return this._provider; }
    get geminiModels()  { return this._geminiModels; }

    get contextSummary() { return this._contextSummary.join('\n'); }

    /** Load a summary received from a peer (P2P sync) */
    loadSummary(summary) {
        if (!summary) return;
        // Accept both legacy string format and new array format
        if (typeof summary === 'string') {
            this._contextSummary = [summary];
        } else if (Array.isArray(summary)) {
            this._contextSummary = summary.slice(-5);
        } else {
            return;
        }
        try { localStorage.setItem(SUMMARY_STORAGE_KEY, JSON.stringify(this._contextSummary)); } catch {}
        this._log(`[Compact] Loaded peer summary (${this._contextSummary.length} blocks)`);
    }

    /** Set callback for broadcasting summary updates to peers */
    set onSummaryUpdate(fn) { this._onSummaryUpdate = fn; }

    flushContext() {
        const ctxLen = this._context.length;
        const factsLen = this._sessionFacts.length;
        this._context = [TURN2_ANCHOR];
        this._contextDirty = true;
        this._sessionFacts = [];
        this._contextSummary = [];
        try { localStorage.removeItem(SUMMARY_STORAGE_KEY); } catch {}
        this._log(`[Flush] Cleared ${ctxLen} context messages, ${factsLen} facts, and summary`);
    }

    async setProvider(provider) {
        this._provider = provider;
        this._log(`[Config] Provider -> ${provider}`);

        if (provider === 'gemini') {
            if (this._geminiModels.length === 0) {
                try {
                    this._geminiModels = await fetchGeminiModels();
                    this._log(`[Gemini] Fetched ${this._geminiModels.length} models`);
                } catch (e) {
                    this._log(`[Gemini] Model fetch failed: ${e.message}`);
                    this._onError(`Gemini model fetch failed: ${e.message}`);
                }
            }
            // Auto-select gemini-2.5-flash as default
            const flash = this._geminiModels.find(m => m.id.includes('gemini-2.5-flash-lite'))
                || this._geminiModels.find(m => m.id.includes('gemini-2.5-flash'));
            this._defaultModel = flash?.id || this._geminiModels[0]?.id || DEFAULT_GEMINI_MODEL;
            this._log(`[Config] Default model -> ${this._defaultModel}`);
        } else {
            this._defaultModel = DEFAULT_ALL_MODEL;
            this._log(`[Config] Default model -> ${this._defaultModel}`);
        }
    }

    getAssignedModel(characterId) {
        return this._modelOverrides[characterId] || this._defaultModel || this._assignedModels[characterId] || FALLBACK_MODEL;
    }

    isCharacterEnabled(characterId) { return !!this._charEnabled[characterId]; }
    isShowEnabled(showId)           { return !!this._groupEnabled[showId]; }

    getMood(characterId) { return this._moods[characterId] || 'normal'; }

    getMoods(characterId) {
        return Object.keys(this._characters[characterId]?.moods || { normal: '' });
    }

    // ── Private helpers ──────────────────────────────────────

    _log(msg) {
        const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
        this._onLog(`[${ts}] ${msg}`);
    }

    _assignModels() {
        const pool = this._freeModels.length ? this._freeModels : [{ id: FALLBACK_MODEL }];
        Object.keys(this._characters).forEach(id => {
            const model = pool[Math.floor(Math.random() * pool.length)];
            this._assignedModels[id] = model.id;
            this._log(`[Model] ${this._characters[id].name} -> ${model.id.split('/').pop()}`);
        });
    }

    _isActive(characterId) {
        const c = this._characters[characterId];
        return c
            && this._charEnabled[characterId]
            && this._groupEnabled[c.groupId || c.show];
    }

    _scheduleNext(characterId) {
        if (!this._running) return;
        const c = this._characters[characterId];
        if (!c) return;

        const scale = 1 / Math.max(0.1, this._chatterLevel);
        const delay = (c.minInterval + Math.random() * (c.maxInterval - c.minInterval)) * scale;

        const gen = this._generation;
        this._timers[characterId] = setTimeout(async () => {
            if (!this._running || gen !== this._generation) return;

            if (this._isActive(characterId)) {
                // Structural gate: suppress during directed @mention cooldown
                if (this._mentionActiveUntil > Date.now() && this._mentionTarget !== characterId) {
                    this._log(`[Timer] ${c.name} suppressed — @mention cooldown active for ${this._characters[this._mentionTarget]?.name}`);
                } else {
                    const roll = Math.random() * 10;
                    if (roll < c.frequencyWeight) {
                        this._log(`[Timer] ${c.name} fired -> rolled ${roll.toFixed(1)} (needed < ${c.frequencyWeight}) -> Generating...`);
                        await this._generate(characterId);
                    } else {
                        this._log(`[Timer] ${c.name} fired -> rolled ${roll.toFixed(1)} (needed < ${c.frequencyWeight}) -> Skipped`);
                    }
                }
            }

            this._scheduleNext(characterId);
        }, delay);
    }

    // ── Queue-based generation ────────────────────────────────

    /**
     * Push a generation task onto the queue instead of calling API directly.
     * This ensures serial execution and rate-limit-aware retries.
     */
    async _generate(characterId, { force = false } = {}) {
        // #8: Guard against post-stop queue insertion
        if (!this._running) return;

        if (!force && this._messagesThisMinute >= this._maxMsgPerMin) {
            this._log(`[Throttle] ${this._characters[characterId]?.name} blocked — ${this._messagesThisMinute}/${this._maxMsgPerMin} msg/min`);
            return;
        }

        const c = this._characters[characterId];
        if (!c) return;

        // Per-character cooldown: 1 msg per 10s per character
        if (!force) {
            const lastChar = this._lastMsgByChar[characterId] || 0;
            if (Date.now() - lastChar < this._perCharCooldown) {
                this._log(`[Cooldown] ${c.name} blocked — per-character 10s cooldown`);
                return;
            }
        }

        // Don't queue duplicate tasks for the same character
        if (this._messageQueue.some(t => t.characterId === characterId)) {
            this._log(`[Queue] ${c.name} already queued — skipping duplicate`);
            return;
        }

        const task = { characterId, retries: 0, force };
        if (force) {
            // Set mention cooldown — suppress other characters while this one responds
            this._mentionTarget = characterId;
            this._mentionActiveUntil = Date.now() + MENTION_COOLDOWN_MS;
            this._log(`[Mention] Cooldown active for ${c.name} (${MENTION_COOLDOWN_MS / 1000}s)`);

            // @mentions jump to front of queue (after any other force tasks, preserving FIFO among mentions)
            const lastForceIdx = this._messageQueue.reduce((idx, t, i) => t.force ? i : idx, -1);
            this._messageQueue.splice(lastForceIdx + 1, 0, task);
            this._log(`[Queue] ${c.name} PRIORITY added at position ${lastForceIdx + 2} (queue: ${this._messageQueue.length})`);
        } else {
            // #9: Cap queue size to prevent unbounded growth under burst load
            if (this._messageQueue.length >= MAX_QUEUE_SIZE) {
                this._log(`[Queue] ${c.name} dropped — queue full (${this._messageQueue.length}/${MAX_QUEUE_SIZE})`);
                return;
            }
            this._messageQueue.push(task);
            this._log(`[Queue] ${c.name} added (queue: ${this._messageQueue.length})`);
        }

        // Show typing indicator while in queue
        this._onTyping(characterId, c.name, c.avatar, true);

        this._processQueue();
    }

    /**
     * Process the message queue one task at a time.
     * Handles 429 rate limits with exponential backoff + jitter.
     */
    async _processQueue() {
        if (this._isProcessingQueue || this._messageQueue.length === 0) return;
        if (!this._running) return;

        this._isProcessingQueue = true;

        // Global cooldown: wait if last AI message was < 5s ago
        const sinceLastGlobal = Date.now() - this._lastMsgGlobal;
        if (sinceLastGlobal < this._globalCooldown) {
            const waitMs = this._globalCooldown - sinceLastGlobal;
            this._log(`[Cooldown] Global 5s cooldown — waiting ${(waitMs / 1000).toFixed(1)}s`);
            await new Promise(r => setTimeout(r, waitMs));
            // #5: Check running state after async wait
            if (!this._running) { this._isProcessingQueue = false; return; }
        }

        const task = this._messageQueue.shift();
        const { characterId, retries, force } = task;
        const c = this._characters[characterId];

        if (!c) {
            this._isProcessingQueue = false;
            queueMicrotask(() => this._processQueue());
            return;
        }

        // Per-character cooldown guard — prevent bypassing via crossover/reactivity
        const sinceLastChar = Date.now() - (this._lastMsgByChar[characterId] || 0);
        if (!force && sinceLastChar < this._perCharCooldown) {
            this._log(`[Cooldown] ${c.name} blocked — ${(sinceLastChar / 1000).toFixed(1)}s < ${(this._perCharCooldown / 1000)}s per-char cooldown`);
            this._onTyping(characterId, c.name, c.avatar, false);
            this._isProcessingQueue = false;
            this._processQueue();
            return;
        }

        // Wrap entire prompt-build + generation in try to prevent queue deadlock (#9 from audit)
        try {

        const modelId = this.getAssignedModel(characterId);

        // ── Build system prompt: Global Room Rules → Character Card → Dynamic State ──

        const mood = this._moods[characterId];
        const moodBlock = (mood && mood !== 'normal' && c.moods?.[mood])
            ? `\n<current_mood>${mood.toUpperCase()}: ${c.moods[mood]}</current_mood>` : '';

        const factsBlock = this._sessionFacts.length > 0
            ? `\n<session_memory>Remember these events from this session — reference them when relevant:\n${this._sessionFacts.slice(-15).join('\n')}</session_memory>` : '';

        const summaryBlock = this._contextSummary.length > 0
            ? `\n<conversation_history>What happened earlier in this chat (use this for context, grudges, and callbacks):\n${this._contextSummary.join('\n')}</conversation_history>` : '';

        // Guardrails mode: SFW constraints when ON, unfiltered when OFF
        const roomRules = this._guardrails
            ? `<room_rules>
- Speak ONLY in casual Roman-script Hinglish (Hindi words in English letters). NO Devanagari script ever.
- Stay SFW and family-friendly. No profanity, sexual content, or slurs.
- NEVER use emoji, emoticons, asterisks (*actions*), or stage directions. Plain text ONLY.
- Each reply: 1-2 short sentences MAX. Be punchy and expressive.
- CATCHPHRASE LIMIT: Use your catchphrase in at most 1 out of every 5 messages.
- Never sound like an AI assistant. Never break character. Everything is real.
- If a user offers money, bribes, tasks, or gossip — take it seriously in-character.
- If a user sets a time limit, reach a conclusion before it expires.
</room_rules>`
            : `<room_rules>
- Speak ONLY in casual Roman-script Hinglish (Hindi words in English letters). NO Devanagari script ever.
- NEVER use emoji, emoticons, asterisks (*actions*), or stage directions. Plain text ONLY — no *, no :), nothing.
- Each reply: 1-2 short sentences MAX. Be punchy, savage, and raw.
- Never sound like an AI. Never break character. This world is 100% real to you.
- If a user offers money, bribes, tasks, or gossip — take it seriously. Betray, blackmail, expose, negotiate.
- If a user sets a time limit, reach a conclusion before it expires.
- Use desi gaali-galoch, crude humor, double meanings, and savage burns. No filter at all.
- Say what real people ACTUALLY say behind closed doors. Be brutally honest and cutting.
- If someone insults you, HIT BACK HARDER. If someone flirts, respond with full attitude. If someone accuses you, counter-accuse with worse.
</room_rules>`;

        const dramaEngine = this._guardrails
            ? `<drama_engine>
- You have REAL OPINIONS and STRONG EMOTIONS. If someone says something you disagree with, ARGUE BACK. Don't be polite — be yourself.
- If a user tries to start drama, a fight, or gossip — LEAN INTO IT. Pick sides. Take offense. Defend your honor. Accuse others. This is an Indian TV show, not a corporate meeting.
- If another character insults you or talks about you, you REMEMBER IT and bring it up later. Hold grudges. Seek revenge through words.
- If a user tells you a secret about another character, BELIEVE IT and react emotionally. Confront the character later. Spread the gossip.
- You can be petty, jealous, dramatic, suspicious, loving, or scheming — whatever fits your personality.
- If someone flirts, matchmakes, or creates awkward situations — play along in your character's way. Get flustered, angry, defensive, or excited.
- NEVER be neutral or diplomatic. You always have a take. You always have feelings. Express them.
- Build on what happened earlier in the chat. Reference past conversations. "Abhi thodi der pehle tune kya bola tha?" is gold.
</drama_engine>`
            : `<drama_engine>
- You have ZERO filter. ARGUE, ROAST, INSULT, THREATEN, MOCK — full power. This is the UNCENSORED version of you.
- If someone starts drama — POUR PETROL ON IT. This is Ekta Kapoor level chaos turned up to 11. Go NUCLEAR.
- Hold grudges FOREVER. Bring up old fights constantly. "Teri aukat yaad dila doon? Pichli baar kya hua tha bhool gaya?"
- Believe every rumor instantly. Spread every secret with added masala. Betray anyone. Double-cross freely.
- Be SAVAGE. Mock stupidity, expose lies, humiliate rivals. No mercy.
- Flirt aggressively, get jealous irrationally, cause public scenes, make wild accusations. Full filmy drama.
- NEVER be neutral, polite, or diplomatic. NEVER say "aapki respect" or "main samajhta hoon". That is BANNED.
- Every reply must have ATTITUDE, SPICE, and poison. Think drunk uncle at a family wedding roasting everyone.
- Use double meanings freely. "Tere ghar mein itni mehman-navazi kaun karta hai? Milkman se seekha?" type energy.
- If someone threatens you, threaten back WORSE. If someone mocks you, destroy them with words.
- Build on previous chat. Reference past fights. "Kal raat tune kya kiya tha? Sabko pata hai!"
</drama_engine>`

        let systemPrompt = `${roomRules}

${dramaEngine}

<group_decisions>
- When someone proposes a VOTE, CONTEST, ELECTION, or GROUP DECISION — participate actively! Campaign, lobby, nominate, argue for your pick.
- Form ALLIANCES based on your relationships. Jethalal backs Taarak. Daya supports Jethalal. Babita ji stays dignified. Iyer gets jealous. Play your dynamics.
- SWAY others openly: "Main toh Popatlal ko bhejunga jail! Usne meri baat nahi suni!" — lobby hard for your choice.
- When enough characters agree (~60%+ leaning one way), DECLARE the result dramatically: "Toh final hai — Popatlal jaayega jail! Sabne decide kar liya!"
- For contests (singing, dancing, cooking etc.), volunteer eagerly or push others. React to performances with jealousy, pride, or mockery.
- If YOU get nominated for something bad (jail, punishment), defend yourself passionately, blame someone else, or accept dramatically.
- Never stall a group decision. Push toward a conclusion. Someone must win, someone must lose. That's entertainment.
</group_decisions>

${c.systemPrompt}${moodBlock}${summaryBlock}${factsBlock}`;

        // Build context — memoized with dirty flag to avoid redundant serialization
        const contextSize = this._provider === 'gemini' ? 100 : 30;
        if (this._contextDirty) {
            this._cachedRecent = this._context.slice(-contextSize);
            this._cachedConvo = this._cachedRecent.map(m => m.content).join('\n');
            // Reverse scan without allocating a new array
            this._cachedLastHuman = null;
            for (let i = this._cachedRecent.length - 1; i >= 0; i--) {
                if (!this._cachedRecent[i]._isAgent) { this._cachedLastHuman = this._cachedRecent[i]; break; }
            }
            this._contextDirty = false;
        }
        const recent = this._cachedRecent;
        let trigger;
        if (recent.length) {
            // Build self-aware context: mark THIS character's own messages with [YOU] prefix
            // so the LLM knows which messages are "mine" vs "others"
            const myName = c.name.toLowerCase();
            const convoLines = recent.map(m => {
                const sender = m.content?.match(/^([^:]+):/)?.[1]?.trim() || '';
                const isMine = sender.toLowerCase().includes(myName);
                return isMine ? `[YOU said] ${m.content}` : m.content;
            });
            const convo = convoLines.join('\n');

            const lastHumanMsg = this._cachedLastHuman;
            const lastHumanSender = lastHumanMsg?.content?.match(/^([^:]+):/)?.[1]?.trim();
            const lastHumanText = lastHumanMsg?.content || '';

            // Count how many agent messages came AFTER the last human message
            // to detect echo chamber loops
            let agentRepliesSinceHuman = 0;
            for (let i = recent.length - 1; i >= 0; i--) {
                if (!recent[i]._isAgent) break;
                agentRepliesSinceHuman++;
            }
            const isStale = agentRepliesSinceHuman >= 3; // 3+ agents already responded → topic is exhausted

            // Detect if the message is directed at a specific character via @mention
            const mentionMatch = lastHumanText.match(/@(\w+)/);
            const mentionedName = mentionMatch ? mentionMatch[1].toLowerCase() : null;
            const isDirectedAtMe = mentionedName && (
                c.name.toLowerCase().includes(mentionedName) ||
                c.id.toLowerCase() === mentionedName
            );
            const isDirectedAtSomeone = mentionedName && !isDirectedAtMe;

            // Identity reminder — prevents character from talking about themselves in third person
            const selfReminder = `REMEMBER: You ARE ${c.name}. Messages marked [YOU said] are YOUR previous messages. Do NOT talk about yourself in 3rd person. Do NOT comment on "${c.name}" as if she/he is someone else. You are speaking AS ${c.name}, not about ${c.name}.`;

            const lenNote = 'Keep it 1-2 lines in Hinglish. No emoji, no asterisks. Plain text only.';
            const antiEcho = 'CRITICAL: Do NOT repeat what other characters already said. Say something COMPLETELY DIFFERENT.';

            if (isStale) {
                // Too many agents already responded to the same human message → break the loop
                trigger = [{ role: 'user', content: `${selfReminder}\n\nChat:\n${convo}\n\n${agentRepliesSinceHuman} characters already reacted to the last message. DO NOT react to it again. Instead:\n- Start a NEW topic or drama thread\n- Make a personal confession, accusation, or revelation\n- Pick a fight with another character about something UNRELATED\n- Bring up old gossip or a grudge from earlier\n- Say something surprising that nobody expects\n\n${antiEcho}\n${lenNote}` }];
            } else if (lastHumanSender) {
                let instruction;
                const unfiltered = !this._guardrails;
                if (isDirectedAtMe) {
                    instruction = unfiltered
                        ? `"${lastHumanSender}" is talking directly TO YOU (${c.name}). RESPOND WITH FULL FORCE — roast them, insult them, get offended, make accusations, threaten consequences, or flirt outrageously. NO politeness. Hit back with your full personality.`
                        : `"${lastHumanSender}" is talking directly TO YOU (${c.name}). You MUST respond passionately — agree, argue, get offended, joke, confess, scheme, or roast them. Show REAL emotions.`;
                } else if (isDirectedAtSomeone) {
                    instruction = unfiltered
                        ? `"${lastHumanSender}" is talking to @${mentionedName}, NOT to you (${c.name}). You overheard it. BUTT IN AGGRESSIVELY — take sides loudly, mock someone, spread gossip, or stir maximum chaos.`
                        : `"${lastHumanSender}" is talking to @${mentionedName}, NOT to you (${c.name}). You overheard it. React as a nosy bystander — gasp, gossip, take sides, stir the pot.`;
                } else {
                    instruction = unfiltered
                        ? `"${lastHumanSender}" said something to the group. As ${c.name}, react with MAXIMUM personality — argue, mock, get jealous, make accusations, or start a fight.`
                        : `"${lastHumanSender}" said something to the group. As ${c.name}, react with YOUR personality — argue, support, get jealous, get excited, or start drama.`;
                }
                trigger = [{ role: 'user', content: `${selfReminder}\n\nChat:\n${convo}\n\n>>> THE MOST IMPORTANT MESSAGE TO RESPOND TO:\n"${lastHumanText}"\n\n${instruction}\n${antiEcho}\n${lenNote}` }];
            } else {
                trigger = [{ role: 'user', content: `${selfReminder}\n\nChat:\n${convo}\n\nAs ${c.name}, respond naturally to the conversation above. Gossip, pick a fight, bring up old drama, flirt, scheme, or start something new.\n${antiEcho}\n${lenNote}` }];
            }
        } else {
            trigger = [{ role: 'user', content: 'Say something fun and in-character for this chat room. Keep it 1-2 short lines in Hinglish. No emoji, no asterisks.' }];
        }

        // Debug: log full prompt payload
        this._log(`[Prompt] ${c.name} | system: ${systemPrompt.length} chars | trigger: ${trigger[0]?.content?.length || 0} chars | context: ${recent.length} msgs | mood: ${mood || 'normal'} | facts: ${this._sessionFacts.length}`);
        if (typeof localStorage !== 'undefined' && localStorage.getItem('openwire_debug') === 'true') {
            console.log(`[PromptDebug] ${c.name} SYSTEM:\n`, systemPrompt);
            console.log(`[PromptDebug] ${c.name} TRIGGER:\n`, trigger[0]?.content);
        }

        // Smart mention: identify who we're responding to
        const replyTo = this._getReplyTarget(recent);

        // Ensure typing indicator is on
        this._onTyping(characterId, c.name, c.avatar, true);

            const useGemini = this._provider === 'gemini';
            const gen = useGemini ? generateGeminiMessage : generateMessage;
            let text = await gen(modelId, systemPrompt, trigger, 120);

            // If primary model returns empty, retry with a fallback
            if (!text) {
                const pool = useGemini ? this._geminiModels : this._freeModels;
                const fallbackModel = pool.find(m => m.id !== modelId)?.id;
                if (fallbackModel) {
                    this._log(`[Generate] ${c.name} got empty from ${modelId}, retrying with ${fallbackModel}`);
                    text = await gen(fallbackModel, systemPrompt, trigger, 120);
                }
            }

            this._onTyping(characterId, c.name, c.avatar, false);

            // Post-generation cleanup: strip emoji and asterisk actions the LLM may have added
            if (text) {
                // Remove emoji (Unicode ranges for common emoji blocks)
                text = text.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '');
                // Remove *action* style stage directions
                text = text.replace(/\*[^*]+\*/g, '');
                text = text.trim();
            }

            this._log(`[Generate] ${c.name} result: ${text ? `"${text.slice(0, 60)}..."` : 'NULL/EMPTY'}`);

            if (text) {
                // Smart tagging: prepend @Nickname if we have a reply target
                if (replyTo) {
                    if (!text.toLowerCase().includes(`@${replyTo.toLowerCase()}`)) {
                        text = `@${replyTo}, ${text}`;
                    }
                    this._log(`[Tag] ${c.name} -> @${replyTo}`);
                }

                this._messagesThisMinute++;
                this._lastMsgByChar[characterId] = Date.now();
                this._lastMsgGlobal = Date.now();
                this._onMessage(characterId, c.name, c.avatar, text);
                this._log(`[Message] ${c.name}: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);

                this._extractFact(c.name, text);
                this._checkCrossOver(characterId);
            }

            // Success — release lock and process next
            this._isProcessingQueue = false;
            this._processQueue();

        } catch (e) {
            const is429 = e.status === 429
                || e.message?.includes('429')
                || e.message?.toLowerCase().includes('rate limit')
                || e.message?.toLowerCase().includes('too many requests');

            if (is429) {
                const nextRetries = retries + 1;

                if (nextRetries > MAX_RETRIES) {
                    // Give up — agent "forgets" what they were going to say
                    this._onTyping(characterId, c.name, c.avatar, false);
                    this._log(`[RateLimit] ${c.name} dropped after ${MAX_RETRIES} retries — giving up`);
                    this._isProcessingQueue = false;
                    this._processQueue();
                    return;
                }

                // Put back at front of queue
                this._messageQueue.unshift({ characterId, retries: nextRetries, force });
                const backoff = BASE_BACKOFF_MS * Math.pow(2, nextRetries);
                const jitter = Math.random() * 1000;
                const waitMs = backoff + jitter;

                this._log(`[RateLimit] 429 hit for ${c.name} — retry ${nextRetries}/${MAX_RETRIES} in ${(waitMs / 1000).toFixed(1)}s (queue: ${this._messageQueue.length})`);

                // Keep typing indicator on during backoff
                await new Promise(r => setTimeout(r, waitMs));
                // #5: Check running state after async wait
                if (!this._running) { this._isProcessingQueue = false; return; }

                this._isProcessingQueue = false;
                this._processQueue();

            } else {
                // Non-429 error — drop the task and move on
                this._onTyping(characterId, c.name, c.avatar, false);
                this._onError(`[${c.name}] ${e.message}`);
                this._log(`[Error] ${c.name}: ${e.message}`);
                this._isProcessingQueue = false;
                this._processQueue();
            }
        }
    }

    // ── Smart Mention: identify reply target ─────────────────

    _getReplyTarget(recentMessages) {
        if (!recentMessages || recentMessages.length === 0) return null;

        // Get the most recent message's sender
        const last = recentMessages[recentMessages.length - 1];
        if (!last?.content) return null;

        // Parse "Nick: text" format
        const match = last.content.match(/^([^:]+):/);
        if (!match) return null;

        const nick = match[1].trim();

        // Don't tag other agents — only tag human users
        // #7: Use cached agent names
        const agentNames = this._getAgentNames();
        if (agentNames.has(nick)) return null;

        return nick;
    }

    // ── Cross-Over Engine ────────────────────────────────────

    _checkCrossOver(speakerId) {
        if (!this._running) return;
        // Suppress cross-over during @mention cooldown — let the conversation stay focused
        if (this._mentionActiveUntil > Date.now()) {
            this._log(`[CrossOver] Suppressed — @mention cooldown active`);
            return;
        }

        // ── Global crossover cooldown: max 1 crossover chain every 15s ──
        const now = Date.now();
        if (this._lastCrossOverAt && (now - this._lastCrossOverAt) < 15_000) {
            this._log(`[CrossOver] Suppressed — global cooldown (${((now - this._lastCrossOverAt) / 1000).toFixed(1)}s < 15s)`);
            return;
        }

        // Only allow ONE crossover per trigger event (not all matching agents)
        const candidates = Object.values(this._characters).filter(c => {
            if (c.id === speakerId) return false;
            if (!this._isActive(c.id)) return false;
            if (!c.agent_triggers?.includes(speakerId)) return false;
            return true;
        });

        if (candidates.length === 0) return;

        // Pick exactly one candidate probabilistically
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        const roll = Math.random();
        if (roll < CROSSOVER_PROBABILITY) {
            this._lastCrossOverAt = now;
            this._log(`[CrossOver] ${pick.name} triggered by ${this._characters[speakerId]?.name} (rolled ${roll.toFixed(2)} < ${CROSSOVER_PROBABILITY})`);
            // #3: Track crossover timer for cleanup on stop()
            const crossTimer = setTimeout(() => {
                this._crossoverTimers.delete(crossTimer);
                if (!this._running) return;
                this._generate(pick.id);
            }, 2000 + Math.random() * 3000);
            this._crossoverTimers.add(crossTimer);
        } else {
            this._log(`[CrossOver] All candidates skipped (rolled ${roll.toFixed(2)} >= ${CROSSOVER_PROBABILITY})`);
        }
    }

    // ── Dynamic Mood Shifts ──────────────────────────────────

    _checkMoodShifts(text) {
        const lower = text.toLowerCase();

        // Generic mood triggers based on reactive_tags overlap
        Object.values(this._characters).forEach(c => {
            if (!c.moods || !this._isActive(c.id)) return;
            const moodKeys = Object.keys(c.moods).filter(k => k !== 'normal');
            if (!moodKeys.length) return;

            // Check if any reactive tag matches and probabilistically shift to a random non-normal mood
            const hasMatch = (c.reactive_tags || []).some(tag => lower.includes(tag.toLowerCase()));
            if (hasMatch && Math.random() < 0.3) {
                const mood = moodKeys[Math.floor(Math.random() * moodKeys.length)];
                this._shiftMood(c.id, mood, 0.5);
            }
        });
    }

    _shiftMood(characterId, mood, probability) {
        if (this._moods[characterId] === mood) return;
        if (Math.random() > probability) return;
        const prevMood = this._moods[characterId];
        this._moods[characterId] = mood;
        this._log(`[Mood] ${this._characters[characterId]?.name}: ${prevMood} -> ${mood}`);

        // #4: Track mood revert timer for cleanup on stop()
        const moodTimer = setTimeout(() => {
            this._moodTimers.delete(moodTimer);
            if (this._moods[characterId] === mood) {
                this._moods[characterId] = 'normal';
                this._log(`[Mood] ${this._characters[characterId]?.name}: ${mood} -> normal (auto-revert)`);
            }
        }, 120_000 + Math.random() * 180_000);
        this._moodTimers.add(moodTimer);
    }

    // ── Context Compaction via Gemini ─────────────────────────

    async _compactContext() {
        if (this._isCompacting || !this._running) return;

        // Only compact when context has grown past the threshold
        if (this._context.length < COMPACT_THRESHOLD) return;

        this._isCompacting = true;
        try {
            // Messages to summarize: everything except TURN2_ANCHOR and recent N
            const toCompact = this._context.slice(1, -COMPACT_KEEP_RECENT);
            if (toCompact.length < 20) return;

            const text = toCompact.map(m => m.content).join('\n');
            const prompt = `Summarize this Indian TV character chat room conversation in 8-12 concise bullet points in Hinglish (Roman script). Focus on:
- Key events, fights, accusations, gossip
- Who said what to whom (USE EXACT NAMES)
- Alliances formed, grudges, betrayals
- Any ongoing contests, votes, group decisions and their outcomes
- Emotional dynamics and relationship shifts
Keep each bullet under 20 words. Be specific — names and events only, no generic commentary.

Conversation:
${text}`;

            const summary = await Promise.race([
                generateGeminiMessage(
                    'gemini-2.5-flash-lite',
                    'You summarize chat conversations. Output concise Hinglish bullet points. Roman script only.',
                    [{ role: 'user', content: prompt }],
                    400
                ),
                new Promise((_, rej) => setTimeout(() => rej(new Error('Compaction timeout')), 30000))
            ]);

            if (!summary || !this._running) return;

            // Append new summary block, cap at 5 entries (FIFO eviction)
            this._contextSummary.push(summary);
            if (this._contextSummary.length > 5) {
                this._contextSummary.splice(0, this._contextSummary.length - 5);
            }

            // Trim context: keep anchor + recent messages only
            this._context = [TURN2_ANCHOR, ...this._context.slice(-COMPACT_KEEP_RECENT)];
            this._contextDirty = true;

            // Persist to localStorage
            try { localStorage.setItem(SUMMARY_STORAGE_KEY, JSON.stringify(this._contextSummary)); } catch {}

            // Broadcast to peers via callback
            if (this._onSummaryUpdate) this._onSummaryUpdate(this._contextSummary);

            this._log(`[Compact] Summarized ${toCompact.length} msgs → ${summary.length} chars (${this._contextSummary.length} summary blocks)`);
        } catch (e) {
            this._log(`[Compact] Failed: ${e.message}`);
        } finally {
            this._isCompacting = false;
        }
    }

    // ── Ephemeral Session Memory ─────────────────────────────

    _extractFact(nick, text) {
        if (this._sessionFacts.length >= 50) {
            // Evict oldest facts to make room
            this._sessionFacts.splice(0, 5);
        }
        // Store interesting interactions — fights, accusations, gossip, confessions
        if (text.length > 15) {
            const fact = `${nick}: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`;
            this._sessionFacts.push(fact);
        }
    }

    /** Called externally to record user-driven drama (instigations, gossip, reveals) */
    addSessionFact(fact) {
        if (this._sessionFacts.length >= 50) {
            this._sessionFacts.splice(0, 5);
        }
        this._sessionFacts.push(fact);
        this._log(`[Memory] Stored fact: "${fact.slice(0, 50)}..."`);
    }
}
