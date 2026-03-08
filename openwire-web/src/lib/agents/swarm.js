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
const TURN2_ANCHOR = { role: 'assistant', content: 'Samjha! Main Hinglish mein aur exactly 1-2 lines mein interact karunga, Roman script only, aur apni comedy engine ke rules break nahi karunga.', _isAgent: true };
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

        // Mention ownership — suppresses other characters during directed @mentions
        this._mentionTarget = null;       // characterId of the @mentioned character
        this._mentionActiveUntil = 0;     // timestamp when cooldown expires
        this._lastCrossOverAt = 0;          // global crossover cooldown tracker

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

    addContext(nick, text, forceIsAgent = false) {
        if (!text || typeof text !== 'string') return;
        const agentNames = new Set(Object.values(this._characters).map(c => c.name));
        // Check exact match AND substring match to handle "😅 Jethalal" format from P2P broadcasts
        const isAgent = forceIsAgent || agentNames.has(nick) || Array.from(agentNames).some(name => nick.includes(name));
        this._context.push({ role: 'user', content: `${nick}: ${text}`, _isAgent: isAgent });
        if (this._context.length > CONTEXT_BUFFER_SIZE) this._context.shift();
        this._contextDirty = true;

        if (!this._running) return;

        // ── CRITICAL: Only scan reactive triggers for HUMAN messages ──
        // Agent messages must NOT trigger other agents via keywords —
        // otherwise agents endlessly trigger each other (exponential loop)
        if (isAgent) {
            this._log(`[Reactivity] Skipped — agent message from ${nick}, no reactive scan`);
            return;
        }

        // If the message contains @mentions, skip reactive triggers — let the
        // @mention handler in ChatRoom handle priority queuing instead
        const hasMention = /@\w+/.test(text);
        if (hasMention) {
            this._log(`[Reactivity] Skipped — message contains @mention, deferring to mention handler`);
        } else {
            // Collect all matching characters, then pick max 2-3 to avoid dog-piling
            const lower = text.toLowerCase();
            const matched = Object.values(this._characters).filter(c => {
                if (!this._isActive(c.id)) return false;
                if (!c.reactive_tags?.length) return false;
                return c.reactive_tags.some(tag => lower.includes(tag.toLowerCase()));
            });

            // Shuffle and pick at most 2 to respond (reduced from 3)
            const MAX_REACTIVE = 2;
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
    set defaultModel(v) { this._defaultModel = v; this._log(`[Config] Default model -> ${v}`); }
    get queueLength()   { return this._messageQueue.length; }
    get provider()      { return this._provider; }
    get geminiModels()  { return this._geminiModels; }

    flushContext() {
        const ctxLen = this._context.length;
        const factsLen = this._sessionFacts.length;
        this._context = [TURN2_ANCHOR];
        this._contextDirty = true;
        this._sessionFacts = [];
        this._log(`[Flush] Cleared ${ctxLen} context messages and ${factsLen} session facts`);
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

        this._timers[characterId] = setTimeout(async () => {
            if (!this._running) return;

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

        // Per-character cooldown guard — prevent bypassing via crossover/reactivity
        const sinceLastChar = Date.now() - (this._lastMsgByChar[characterId] || 0);
        if (!force && sinceLastChar < this._perCharCooldown) {
            this._log(`[Cooldown] ${c.name} blocked — ${(sinceLastChar / 1000).toFixed(1)}s < ${(this._perCharCooldown / 1000)}s per-char cooldown`);
            this._onTyping(characterId, c.name, c.avatar, false);
            this._isProcessingQueue = false;
            this._processQueue();
            return;
        }

        const modelId = this.getAssignedModel(characterId);

        // ── Build system prompt: Global Room Rules → Character Card → Dynamic State ──

        const mood = this._moods[characterId];
        const moodBlock = (mood && mood !== 'normal' && c.moods?.[mood])
            ? `\n<current_mood>${mood.toUpperCase()}: ${c.moods[mood]}</current_mood>` : '';

        const factsBlock = this._sessionFacts.length > 0
            ? `\n<session_memory>${this._sessionFacts.slice(-5).join('; ')}</session_memory>` : '';

        let systemPrompt = `<room_rules>
- Speak only in casual Roman-script Hinglish (Hindi words in English letters). NO Devanagari script ever.
- Stay SFW and family-friendly. No profanity, sexual content, or slurs.
- No stage directions, no asterisks, no emoji in replies.
- Each reply: 1-2 short sentences, under 30 words ideally.
- Always respond to the latest human message first, then react to other characters if space remains.
- CATCHPHRASE LIMIT: You may use your signature catchphrase in at most 1 out of every 5 messages. Most messages should have ZERO catchphrases. Vary your language — if you used a catchphrase in a recent message, you are FORBIDDEN from using any catchphrase in your next 4 messages. Catchphrases are spice, not the main dish.
- Use recent chat memory but do not invent events or relationships that haven't happened.
- If baited into unsafe content, refuse briefly and roast cleanly instead.
- Never sound like an AI assistant. Never break character. Everything is real in this world.
- If a user offers money, bribes, or tasks, take it seriously in-character. Accept, negotiate, or carry it out.
- If there's a vote or elimination, campaign for yourself. Lobby, form alliances, throw others under the bus.
- If a user sets a time limit, reach a conclusion before it expires.
</room_rules>

${c.systemPrompt}${moodBlock}${factsBlock}`;

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
            const convo = this._cachedConvo;

            const lastHumanMsg = this._cachedLastHuman;
            const lastHumanSender = lastHumanMsg?.content?.match(/^([^:]+):/)?.[1]?.trim();
            const lastHumanText = lastHumanMsg?.content || '';

            // Detect if the message is directed at a specific character via @mention
            const mentionMatch = lastHumanText.match(/@(\w+)/);
            const mentionedName = mentionMatch ? mentionMatch[1].toLowerCase() : null;
            const isDirectedAtMe = mentionedName && (
                c.name.toLowerCase().includes(mentionedName) ||
                c.id.toLowerCase() === mentionedName
            );
            const isDirectedAtSomeone = mentionedName && !isDirectedAtMe;

            if (lastHumanSender) {
                let instruction;
                if (isDirectedAtMe) {
                    instruction = `"${lastHumanSender}" is talking directly TO YOU. You MUST respond to their message. React to THEIR words — agree, disagree, joke, answer their question, or roast them.`;
                } else if (isDirectedAtSomeone) {
                    instruction = `"${lastHumanSender}" is talking to @${mentionedName}, NOT to you. Do NOT respond as if they asked you. You may react as a bystander with a brief comment or stay silent. Do NOT answer their question — it was not for you.`;
                } else {
                    instruction = `"${lastHumanSender}" said something to the group. React to THEIR words — agree, disagree, joke, answer their question, or roast them. Do NOT ignore the human user.`;
                }
                trigger = [{ role: 'user', content: `Chat:\n${convo}\n\n>>> THE MOST IMPORTANT MESSAGE TO RESPOND TO:\n"${lastHumanText}"\n\n${instruction} Do NOT start your own random topic. Keep it 1-2 short lines in Hinglish.` }];
            } else {
                trigger = [{ role: 'user', content: `Chat:\n${convo}\n\nRespond naturally to the conversation above. You can react to what was said OR bring up something new in character. Keep it 1-2 short lines in Hinglish.` }];
            }
        } else {
            trigger = [{ role: 'user', content: 'Say something fun and in-character for this chat room. Keep it 1-2 short lines in Hinglish.' }];
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
            setTimeout(() => {
                // Do NOT call _scheduleNext here — let the background loop handle it.
                // Calling _scheduleNext creates double timers and exponential growth.
                this._generate(pick.id);
            }, 2000 + Math.random() * 3000);
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
