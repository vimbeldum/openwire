/* ═══════════════════════════════════════════════════════════
   OpenWire — Shared Core: Pop-Culture Agent Swarm Orchestrator
   Manages per-character timers, model assignment, shared chat
   context, and message generation via the OpenRouter service.

   Features:
     - Cross-over engine (agent-to-agent reactivity)
     - Dynamic mood states per character
     - God-mode logging for admin debugger
     - Ephemeral session memory (session_facts)
     - Global throttle & chatter level
     - Typing indicators
   ═══════════════════════════════════════════════════════════ */

import { CHARACTERS, SHOWS } from './characters.js';
import { fetchFreeModels, generateMessage } from './openrouter.js';

/** How many recent messages to keep in the shared context buffer */
const CONTEXT_BUFFER_SIZE = 20;

/** Default fallback free model if none are fetched */
const FALLBACK_MODEL = 'meta-llama/llama-3.2-3b-instruct:free';

/** Max global messages per minute before throttle kicks in */
const DEFAULT_MSG_PER_MIN = 8;

/** Cross-over probability (0–1): chance an agent responds to a triggering agent */
const CROSSOVER_PROBABILITY = 0.7;

/**
 * AgentSwarm — orchestrates multiple character agents.
 *
 * Usage:
 *   const swarm = new AgentSwarm({ onMessage, onError, onModelLoad, onLog, onTyping });
 *   await swarm.start();
 *   swarm.addContext('UserNick', 'some message text');
 *   swarm.stop();
 */
export class AgentSwarm {
    /**
     * @param {object} opts
     * @param {Function} opts.onMessage    Called with (characterId, nick, avatar, text)
     * @param {Function} [opts.onError]    Called with (errorString)
     * @param {Function} [opts.onModelLoad] Called with (modelsArray) after init
     * @param {Function} [opts.onLog]      Called with (logString) for god-mode debugger
     * @param {Function} [opts.onTyping]   Called with (characterId, nick, avatar, isTyping)
     */
    constructor({ onMessage, onError, onModelLoad, onLog, onTyping }) {
        this._onMessage   = onMessage;
        this._onError     = onError   || (() => {});
        this._onModelLoad = onModelLoad || (() => {});
        this._onLog       = onLog     || (() => {});
        this._onTyping    = onTyping  || (() => {});

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

        // Feature 2: Dynamic mood states
        this._moods = {};              // { characterId: 'normal' | 'panicking' | etc. }

        // Feature 4: Ephemeral session memory
        this._sessionFacts = [];       // ["User Nick claimed he owed Raju money", ...]
        this._factTimer = null;        // periodic summarizer interval

        // Feature 5: Throttle
        this._messagesThisMinute = 0;
        this._throttleTimer = null;
        this._maxMsgPerMin = DEFAULT_MSG_PER_MIN;
        this._chatterLevel = 1.0;      // 0.25 = quiet, 1.0 = normal, 2.0 = chaotic

        // Seed enabled state from character defaults
        Object.values(CHARACTERS).forEach(c => {
            this._charEnabled[c.id] = true;
            this._moods[c.id] = 'normal';
        });
        Object.values(SHOWS).forEach(s => { this._showEnabled[s.id] = true; });
    }

    // ── Public lifecycle ─────────────────────────────────────

    /** Load models, assign them to characters, and start all timers. */
    async start() {
        if (this._running) return;
        this._running = true;

        this._log('[Swarm] Starting...');

        try {
            this._freeModels = await fetchFreeModels();
            this._log(`[Swarm] Fetched ${this._freeModels.length} free models`);
        } catch (e) {
            this._onError(`[Swarm] Model fetch failed: ${e.message}. Using fallback.`);
            this._log(`[Swarm] Model fetch FAILED: ${e.message}`);
            this._freeModels = [];
        }

        this._onModelLoad(this._freeModels);
        this._assignModels();

        // Throttle reset timer: reset counter every 60s
        this._throttleTimer = setInterval(() => { this._messagesThisMinute = 0; }, 60_000);

        // Stagger initial timers so characters don't all fire simultaneously
        Object.keys(CHARACTERS).forEach((id, idx) => {
            setTimeout(() => this._scheduleNext(id), idx * 7_000);
        });

        this._log('[Swarm] All timers scheduled');
    }

    /** Stop all character timers. */
    stop() {
        this._running = false;
        Object.values(this._timers).forEach(t => clearTimeout(t));
        this._timers = {};
        if (this._throttleTimer) { clearInterval(this._throttleTimer); this._throttleTimer = null; }
        if (this._factTimer) { clearInterval(this._factTimer); this._factTimer = null; }
        this._log('[Swarm] Stopped');
    }

    // ── Context management ───────────────────────────────────

    /**
     * Feed a new chat message into the shared context buffer.
     * Call this from ChatRoom whenever a user or peer sends a message.
     */
    addContext(nick, text) {
        if (!text || typeof text !== 'string') return;
        this._context.push({ role: 'user', content: `${nick}: ${text}` });
        if (this._context.length > CONTEXT_BUFFER_SIZE) this._context.shift();

        // Reactive tags: check if any active character should respond immediately
        if (!this._running) return;
        const lower = text.toLowerCase();
        Object.values(CHARACTERS).forEach(c => {
            if (!this._isActive(c.id)) return;
            if (!c.reactive_tags?.length) return;
            const matched = c.reactive_tags.some(tag => lower.includes(tag.toLowerCase()));
            if (matched) {
                this._log(`[Reactivity] ${c.name} triggered by keyword match in "${text.slice(0, 40)}..."`);
                if (this._timers[c.id]) clearTimeout(this._timers[c.id]);
                this._generate(c.id).then(() => this._scheduleNext(c.id));
            }
        });

        // Feature 2: Mood shift based on sentiment triggers
        this._checkMoodShifts(text);
    }

    // ── Configuration ────────────────────────────────────────

    setCharacterEnabled(characterId, enabled) {
        this._charEnabled[characterId] = enabled;
        this._log(`[Config] ${CHARACTERS[characterId]?.name} ${enabled ? 'enabled' : 'disabled'}`);
    }

    setShowEnabled(showId, enabled) {
        this._showEnabled[showId] = enabled;
        this._log(`[Config] Show ${SHOWS[showId]?.name} ${enabled ? 'enabled' : 'disabled'}`);
    }

    setModelOverride(characterId, modelId) {
        this._modelOverrides[characterId] = modelId || null;
        this._log(`[Config] ${CHARACTERS[characterId]?.name} model → ${modelId || 'auto'}`);
    }

    /** Set the chatter level multiplier (0.25 = quiet, 1.0 = normal, 2.0 = chaotic) */
    setChatterLevel(level) {
        this._chatterLevel = Math.max(0.1, Math.min(3.0, level));
        this._log(`[Config] Chatter level → ${this._chatterLevel.toFixed(2)}`);
    }

    /** Set the max messages per minute */
    setMaxMsgPerMin(limit) {
        this._maxMsgPerMin = Math.max(1, Math.min(30, limit));
        this._log(`[Config] Max msg/min → ${this._maxMsgPerMin}`);
    }

    /** Set a character's mood */
    setMood(characterId, mood) {
        const c = CHARACTERS[characterId];
        if (!c || !c.moods?.[mood]) return;
        this._moods[characterId] = mood;
        this._log(`[Mood] ${c.name} → ${mood}`);
    }

    // ── Read-only state ──────────────────────────────────────

    get running()       { return this._running; }
    get freeModels()    { return this._freeModels; }
    get logs()          { return this._logBuffer; }
    get chatterLevel()  { return this._chatterLevel; }
    get maxMsgPerMin()  { return this._maxMsgPerMin; }
    get sessionFacts()  { return this._sessionFacts; }

    getAssignedModel(characterId) {
        return this._modelOverrides[characterId] || this._assignedModels[characterId] || FALLBACK_MODEL;
    }

    isCharacterEnabled(characterId) {
        return !!this._charEnabled[characterId];
    }

    isShowEnabled(showId) {
        return !!this._showEnabled[showId];
    }

    getMood(characterId) {
        return this._moods[characterId] || 'normal';
    }

    getMoods(characterId) {
        return Object.keys(CHARACTERS[characterId]?.moods || {});
    }

    // ── Private helpers ──────────────────────────────────────

    _log(msg) {
        const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
        const line = `[${ts}] ${msg}`;
        this._onLog(line);
    }

    /** Randomly assign a free model to each character on start */
    _assignModels() {
        const pool = this._freeModels.length ? this._freeModels : [{ id: FALLBACK_MODEL }];
        Object.keys(CHARACTERS).forEach(id => {
            const model = pool[Math.floor(Math.random() * pool.length)];
            this._assignedModels[id] = model.id;
            this._log(`[Model] ${CHARACTERS[id].name} → ${model.id.split('/').pop()}`);
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

        // Chatter level scales intervals inversely: higher level = shorter delays
        const scale = 1 / Math.max(0.1, this._chatterLevel);
        const delay = (c.minInterval + Math.random() * (c.maxInterval - c.minInterval)) * scale;

        this._timers[characterId] = setTimeout(async () => {
            if (!this._running) return;

            if (this._isActive(characterId)) {
                const roll = Math.random() * 10;
                if (roll < c.frequencyWeight) {
                    this._log(`[Timer] ${c.name} fired → rolled ${roll.toFixed(1)} (needed < ${c.frequencyWeight}) → Generating...`);
                    await this._generate(characterId);
                } else {
                    this._log(`[Timer] ${c.name} fired → rolled ${roll.toFixed(1)} (needed < ${c.frequencyWeight}) → Skipped`);
                }
            }

            this._scheduleNext(characterId);
        }, delay);
    }

    /** Generate and emit a message for the given character */
    async _generate(characterId) {
        // Feature 5: Throttle check
        if (this._messagesThisMinute >= this._maxMsgPerMin) {
            this._log(`[Throttle] ${CHARACTERS[characterId].name} blocked — ${this._messagesThisMinute}/${this._maxMsgPerMin} msg/min`);
            return;
        }

        const c = CHARACTERS[characterId];
        const modelId = this.getAssignedModel(characterId);

        // Feature 2: Build system prompt with mood modifier
        let systemPrompt = c.systemPrompt;
        const mood = this._moods[characterId];
        if (mood && mood !== 'normal' && c.moods?.[mood]) {
            systemPrompt += `\n\n[CURRENT MOOD: ${mood.toUpperCase()}] ${c.moods[mood]}`;
        }

        // Feature 4: Inject session facts into system prompt
        if (this._sessionFacts.length > 0) {
            const factsStr = this._sessionFacts.slice(-5).join('; ');
            systemPrompt += `\n\n[SESSION MEMORY] Things that happened earlier: ${factsStr}`;
        }

        // Build context: last 7 messages plus a trigger prompt
        const recent = this._context.slice(-7);
        const trigger = recent.length
            ? [{ role: 'user', content: `Recent conversation:\n${recent.map(m => m.content).join('\n')}\n\nNow respond in character with ONE short message.` }]
            : [{ role: 'user', content: 'Say something fun and in-character for this chat room.' }];

        // Feature 6: Typing indicator ON
        this._onTyping(characterId, c.name, c.avatar, true);

        try {
            const text = await generateMessage(modelId, systemPrompt, trigger, 120);

            // Feature 6: Typing indicator OFF
            this._onTyping(characterId, c.name, c.avatar, false);

            if (text) {
                this._messagesThisMinute++;
                this._onMessage(characterId, c.name, c.avatar, text);
                this._log(`[Message] ${c.name}: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);

                // Feature 4: Extract notable facts from agent messages
                this._extractFact(c.name, text);

                // Feature 1: Cross-over engine — check if this agent triggers others
                this._checkCrossOver(characterId);
            }
        } catch (e) {
            this._onTyping(characterId, c.name, c.avatar, false);
            this._onError(`[${c.name}] ${e.message}`);
            this._log(`[Error] ${c.name}: ${e.message}`);
        }
    }

    // ── Feature 1: Cross-Over Engine ─────────────────────────

    /** After an agent speaks, check if any other agent is triggered to respond */
    _checkCrossOver(speakerId) {
        if (!this._running) return;

        Object.values(CHARACTERS).forEach(c => {
            if (c.id === speakerId) return;
            if (!this._isActive(c.id)) return;
            if (!c.agent_triggers?.includes(speakerId)) return;

            const roll = Math.random();
            if (roll < CROSSOVER_PROBABILITY) {
                this._log(`[CrossOver] ${c.name} triggered by ${CHARACTERS[speakerId].name} (rolled ${roll.toFixed(2)} < ${CROSSOVER_PROBABILITY})`);
                // Small delay (1-3s) so it feels like a natural reply
                setTimeout(() => {
                    if (this._timers[c.id]) clearTimeout(this._timers[c.id]);
                    this._generate(c.id).then(() => this._scheduleNext(c.id));
                }, 1000 + Math.random() * 2000);
            } else {
                this._log(`[CrossOver] ${c.name} skipped (rolled ${roll.toFixed(2)} >= ${CROSSOVER_PROBABILITY})`);
            }
        });
    }

    // ── Feature 2: Dynamic Mood Shifts ───────────────────────

    /** Check chat text for mood-shifting keywords */
    _checkMoodShifts(text) {
        const lower = text.toLowerCase();

        // Jethalal mood triggers
        if (lower.includes('bapuji') || lower.includes('trouble') || lower.includes('problem')) {
            this._shiftMood('jethalal', 'panicking', 0.4);
        }
        if (lower.includes('babita')) {
            this._shiftMood('jethalal', 'lovesick', 0.5);
        }

        // Dayaben mood triggers
        if (lower.includes('garba') || lower.includes('festival') || lower.includes('celebrate')) {
            this._shiftMood('daya', 'excited', 0.5);
        }
        if (lower.includes('jethalal') && (lower.includes('problem') || lower.includes('trouble'))) {
            this._shiftMood('daya', 'worried', 0.4);
        }

        // Raju mood triggers
        if (lower.includes('crore') || lower.includes('scheme') || lower.includes('plan')) {
            this._shiftMood('raju', 'scheming', 0.5);
        }

        // Shyam mood triggers
        if (lower.includes('bakwas') || lower.includes('nonsense') || lower.includes('pagal')) {
            this._shiftMood('shyam', 'exasperated', 0.5);
        }

        // Baburao mood triggers
        if (lower.includes('rent') || lower.includes('pay')) {
            this._shiftMood('babu_bhaiya', 'angry', 0.4);
        }

        // Iyer mood triggers
        if (lower.includes('science') || lower.includes('history') || lower.includes('education')) {
            this._shiftMood('iyer', 'lecturing', 0.5);
        }
    }

    /** Probabilistically shift a character's mood */
    _shiftMood(characterId, mood, probability) {
        if (this._moods[characterId] === mood) return;
        if (Math.random() > probability) return;
        const prevMood = this._moods[characterId];
        this._moods[characterId] = mood;
        this._log(`[Mood] ${CHARACTERS[characterId]?.name}: ${prevMood} → ${mood}`);

        // Auto-revert to normal after 2-5 minutes
        setTimeout(() => {
            if (this._moods[characterId] === mood) {
                this._moods[characterId] = 'normal';
                this._log(`[Mood] ${CHARACTERS[characterId]?.name}: ${mood} → normal (auto-revert)`);
            }
        }, 120_000 + Math.random() * 180_000);
    }

    // ── Feature 4: Ephemeral Session Memory ──────────────────

    /** Extract a short fact from a message for session memory */
    _extractFact(nick, text) {
        // Simple heuristic: store notable messages as facts
        if (text.length > 30 && this._sessionFacts.length < 30) {
            const fact = `${nick} said: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`;
            this._sessionFacts.push(fact);
        }
    }

    /** Add an external fact to session memory (e.g., from user chat) */
    addSessionFact(fact) {
        if (this._sessionFacts.length < 50) {
            this._sessionFacts.push(fact);
            this._log(`[Memory] Stored fact: "${fact.slice(0, 50)}..."`);
        }
    }
}
