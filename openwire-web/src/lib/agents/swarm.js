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

const CONTEXT_BUFFER_SIZE = 20;
const FALLBACK_MODEL = 'meta-llama/llama-3.1-8b-instruct:free';
const DEFAULT_ALL_MODEL = 'openrouter/auto';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';
const DEFAULT_MSG_PER_MIN = 60;
const CROSSOVER_PROBABILITY = 0.7;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2000;
const PER_CHAR_COOLDOWN_MS = 10_000;  // 1 message per 10s per character
const GLOBAL_COOLDOWN_MS = 5_000;     // 1 message per 5s across all AI

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

        this._context = [];
        this._assignedModels = {};
        this._moods = {};
        this._sessionFacts = [];
        this._factTimer = null;

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

        // Dynamic config — loaded from agentStore
        this._characters = {};  // dict { id: charObj }
        this._groups = {};      // dict { id: groupObj }
        this._modelFilters = { whitelist: [], blacklist: [] };

        // Load initial config from store
        this._loadFromStore();
    }

    // ── Config loading ────────────────────────────────────────

    _loadFromStore() {
        const store = loadStore();
        this._characters = getCharactersDict(store);
        this._groups = getGroupsDict(store);
        this._modelFilters = store.modelFilters || { whitelist: [], blacklist: [] };

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
    }

    /** Hot-reload config from agentStore without stopping the swarm */
    loadConfig() {
        const wasRunning = this._running;

        // Stop existing timers
        Object.values(this._timers).forEach(t => clearTimeout(t));
        this._timers = {};

        this._loadFromStore();
        this._log('[Config] Hot-reloaded from agentStore');

        // Restart timers for any new characters
        if (wasRunning) {
            Object.keys(this._characters).forEach((id, idx) => {
                if (!this._timers[id]) {
                    setTimeout(() => this._scheduleNext(id), idx * 3_000);
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

        Object.keys(this._characters).forEach((id, idx) => {
            setTimeout(() => this._scheduleNext(id), idx * 7_000);
        });

        this._log('[Swarm] All timers scheduled');
    }

    stop() {
        this._running = false;
        Object.values(this._timers).forEach(t => clearTimeout(t));
        this._timers = {};
        this._messageQueue = [];
        this._isProcessingQueue = false;
        if (this._throttleTimer) { clearInterval(this._throttleTimer); this._throttleTimer = null; }
        if (this._factTimer) { clearInterval(this._factTimer); this._factTimer = null; }
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

    addContext(nick, text) {
        if (!text || typeof text !== 'string') return;
        this._context.push({ role: 'user', content: `${nick}: ${text}` });
        if (this._context.length > CONTEXT_BUFFER_SIZE) this._context.shift();

        if (!this._running) return;
        const lower = text.toLowerCase();
        Object.values(this._characters).forEach(c => {
            if (!this._isActive(c.id)) return;
            if (!c.reactive_tags?.length) return;
            const matched = c.reactive_tags.some(tag => lower.includes(tag.toLowerCase()));
            if (matched) {
                this._log(`[Reactivity] ${c.name} triggered by keyword match in "${text.slice(0, 40)}..."`);
                if (this._timers[c.id]) clearTimeout(this._timers[c.id]);
                this._generate(c.id).then(() => this._scheduleNext(c.id));
            }
        });

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
    get queueLength()   { return this._messageQueue.length; }
    get provider()      { return this._provider; }
    get geminiModels()  { return this._geminiModels; }

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

        this._timers[characterId] = setTimeout(async () => {
            if (!this._running) return;

            if (this._isActive(characterId)) {
                const roll = Math.random() * 10;
                if (roll < c.frequencyWeight) {
                    this._log(`[Timer] ${c.name} fired -> rolled ${roll.toFixed(1)} (needed < ${c.frequencyWeight}) -> Generating...`);
                    await this._generate(characterId);
                } else {
                    this._log(`[Timer] ${c.name} fired -> rolled ${roll.toFixed(1)} (needed < ${c.frequencyWeight}) -> Skipped`);
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
            // @mentions jump to front of queue (after any other force tasks, preserving FIFO among mentions)
            const lastForceIdx = this._messageQueue.reduce((idx, t, i) => t.force ? i : idx, -1);
            this._messageQueue.splice(lastForceIdx + 1, 0, task);
            this._log(`[Queue] ${c.name} PRIORITY added at position ${lastForceIdx + 2} (queue: ${this._messageQueue.length})`);
        } else {
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
        }

        const task = this._messageQueue.shift();
        const { characterId, retries, force } = task;
        const c = this._characters[characterId];

        if (!c) {
            this._isProcessingQueue = false;
            this._processQueue();
            return;
        }

        const modelId = this.getAssignedModel(characterId);

        // Build system prompt with mood modifier
        let systemPrompt = c.systemPrompt;
        const mood = this._moods[characterId];
        if (mood && mood !== 'normal' && c.moods?.[mood]) {
            systemPrompt += `\n\n[CURRENT MOOD: ${mood.toUpperCase()}] ${c.moods[mood]}`;
        }

        // Inject session facts
        if (this._sessionFacts.length > 0) {
            const factsStr = this._sessionFacts.slice(-5).join('; ');
            systemPrompt += `\n\n[SESSION MEMORY] Things that happened earlier: ${factsStr}`;
        }

        // Build context: last 7 messages plus trigger
        const recent = this._context.slice(-7);
        const trigger = recent.length
            ? [{ role: 'user', content: `Recent conversation:\n${recent.map(m => m.content).join('\n')}\n\nNow respond in character with ONE short message.` }]
            : [{ role: 'user', content: 'Say something fun and in-character for this chat room.' }];

        // Smart mention: identify who we're responding to
        const replyTo = this._getReplyTarget(recent);

        // Ensure typing indicator is on
        this._onTyping(characterId, c.name, c.avatar, true);

        try {
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
        const agentNames = new Set(Object.values(this._characters).map(c => c.name));
        if (agentNames.has(nick)) return null;

        return nick;
    }

    // ── Cross-Over Engine ────────────────────────────────────

    _checkCrossOver(speakerId) {
        if (!this._running) return;

        Object.values(this._characters).forEach(c => {
            if (c.id === speakerId) return;
            if (!this._isActive(c.id)) return;
            if (!c.agent_triggers?.includes(speakerId)) return;

            const roll = Math.random();
            if (roll < CROSSOVER_PROBABILITY) {
                this._log(`[CrossOver] ${c.name} triggered by ${this._characters[speakerId]?.name} (rolled ${roll.toFixed(2)} < ${CROSSOVER_PROBABILITY})`);
                setTimeout(() => {
                    if (this._timers[c.id]) clearTimeout(this._timers[c.id]);
                    this._generate(c.id).then(() => this._scheduleNext(c.id));
                }, 1000 + Math.random() * 2000);
            } else {
                this._log(`[CrossOver] ${c.name} skipped (rolled ${roll.toFixed(2)} >= ${CROSSOVER_PROBABILITY})`);
            }
        });
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

        setTimeout(() => {
            if (this._moods[characterId] === mood) {
                this._moods[characterId] = 'normal';
                this._log(`[Mood] ${this._characters[characterId]?.name}: ${mood} -> normal (auto-revert)`);
            }
        }, 120_000 + Math.random() * 180_000);
    }

    // ── Ephemeral Session Memory ─────────────────────────────

    _extractFact(nick, text) {
        if (text.length > 30 && this._sessionFacts.length < 30) {
            const fact = `${nick} said: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`;
            this._sessionFacts.push(fact);
        }
    }

    addSessionFact(fact) {
        if (this._sessionFacts.length < 50) {
            this._sessionFacts.push(fact);
            this._log(`[Memory] Stored fact: "${fact.slice(0, 50)}..."`);
        }
    }
}
