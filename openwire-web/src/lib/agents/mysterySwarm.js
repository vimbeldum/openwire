/* ═══════════════════════════════════════════════════════════
   OpenWire — Murder Mystery: AI Pipeline Adapter
   Bounded Context: MurderMystery (AI Pipeline)
   Standalone orchestrator that manages suspect AI responses
   during the murder mystery game. Uses the same LLM generation
   functions as AgentSwarm but does NOT extend it.
   ═══════════════════════════════════════════════════════════ */

import { ViolationBot } from './violationBot.js';
import { getClueForPlayer } from '../mystery/clues.js';

/* ── Constants ────────────────────────────────────────────── */

const MAX_HISTORY = 20;          // conversation history window per suspect
const MAX_RESPONSE_TOKENS = 200; // LLM response token limit
const FALLBACK_MODEL = 'meta-llama/llama-3.1-8b-instruct:free';

/* ── Template response pools (used when no LLM available) ── */

const ALIBI_RESPONSES = [
    (s) => `*${s.name} meets your gaze steadily* ${s.alibi}. I have nothing to hide about my whereabouts.`,
    (s) => `*${s.name} sighs* I've been over this. ${s.alibi}. Ask anyone who was there.`,
    (s) => `*${s.name} leans back* You want to know where I was? ${s.alibi}. Satisfied?`,
];

const CROSS_SUSPECT_RESPONSES = [
    (s, otherName) => `*${s.name} raises an eyebrow* ${otherName}? Now that's someone you should be looking at more closely.`,
    (s, otherName) => `*${s.name} lowers their voice* I don't want to speak ill of anyone, but ${otherName} was acting strangely that evening.`,
    (s, otherName) => `*${s.name} pauses carefully* I noticed ${otherName} seemed on edge. Perhaps they know more than they're letting on.`,
];

const EVASIVE_RESPONSES = [
    (s) => `*${s.name} shifts uncomfortably* Everyone has things they'd rather keep private. That doesn't make me a suspect.`,
    (s) => `*${s.name} looks away* I'm not sure what you're implying, but I suggest you look elsewhere.`,
    (s) => `*${s.name} stiffens* Some questions are better left unasked, detective.`,
];

const GENERIC_RESPONSES = [
    (s) => `*${s.name} considers the question* I'm not sure I can help you with that. I only know what I saw.`,
    (s) => `*${s.name} folds their arms* I've told you everything I know. Perhaps you should speak to the others.`,
    (s) => `*${s.name} shakes their head* This is a terrible business. I just want it resolved as much as you do.`,
    (s) => `*${s.name} drums their fingers* Ask me something specific and I'll do my best to answer.`,
    (s) => `*${s.name} exhales slowly* I keep replaying the evening in my head, but nothing stands out.`,
];

const MOTIVE_RESPONSES = [
    (s) => `*${s.name} bristles* Why would I? I had nothing to gain from this. Absolutely nothing.`,
    (s) => `*${s.name}'s jaw tightens* Don't you dare suggest I had a reason. That's an outrageous accusation.`,
    (s) => `*${s.name} scoffs* A motive? Look at the others first. My relationship with the victim was perfectly fine.`,
];

const ACCUSATION_RESPONSES = [
    (s) => `*${s.name} stands abruptly* How dare you! I had nothing to do with this!`,
    (s) => `*${s.name}'s eyes flash with anger* You're pointing fingers without evidence. That's dangerous.`,
    (s) => `*${s.name} looks genuinely hurt* I can't believe you'd accuse me. I've been nothing but cooperative.`,
];

/**
 * MysterySwarm — AI pipeline adapter for Murder Mystery suspect interrogation.
 *
 * Lifecycle:
 *   1. Create instance: `new MysterySwarm()`
 *   2. Initialize:      `swarm.init(mysteryData, generateFn, modelId)`
 *   3. Generate:        `await swarm.generateResponse(suspectId, question, playerNick)`
 *   4. Destroy:         `swarm.destroy()`
 */
export class MysterySwarm {
    constructor() {
        /** @type {Object<string, SuspectState>} */
        this.suspects = {};
        /** @type {Function|null} LLM generation fn: (model, system, messages, maxTokens) => Promise<string> */
        this.generateFn = null;
        /** @type {string|null} Model ID to use for generation */
        this.modelId = null;
        /** @type {ViolationBot|null} */
        this.violationBot = null;
        /** @type {Function|null} callback(suspectId, responseText, isRevised) */
        this.onResponse = null;
    }

    /**
     * Initialize the swarm with mystery data and an LLM generation function.
     *
     * @param {object}   mystery       The mystery game state (with suspects array)
     * @param {Function} [generateFn]  LLM function: (modelId, systemPrompt, contextMessages, maxTokens) => Promise<string|null>
     * @param {string}   [modelId]     Model ID to use (defaults to FALLBACK_MODEL)
     */
    init(mystery, generateFn, modelId) {
        this.generateFn = generateFn || null;
        this.modelId = modelId || FALLBACK_MODEL;

        // ViolationBot uses the same LLM function and model
        this.violationBot = new ViolationBot(this.generateFn, this.modelId);

        // Build suspect state from mystery data
        const suspects = mystery.suspects || [];
        for (const suspect of suspects) {
            this.suspects[suspect.id] = {
                config: suspect,
                systemPrompt: suspect._systemPrompt || '',
                conversationHistory: [],
                liesTracked: [],
                cluesRevealed: [],
                suspicionLevel: 0,
            };
        }
    }

    /**
     * Generate a suspect's response to a player's question.
     *
     * Flow:
     *   1. Build message array from system prompt + history + question
     *   2. Call LLM (or template fallback)
     *   3. Run ViolationBot check
     *   4. If violation, refine
     *   5. Track conversation history + clue discovery
     *
     * @param {string} suspectId     Target suspect id
     * @param {string} playerQuestion The player's question text
     * @param {string} playerNick    The player's display name
     * @returns {Promise<{ text: string, isRevised: boolean, error?: boolean }>}
     */
    async generateResponse(suspectId, playerQuestion, playerNick) {
        const suspect = this.suspects[suspectId];
        if (!suspect) {
            return {
                text: '*The suspect does not respond.*',
                isRevised: false,
                error: true,
            };
        }

        // Build the messages array for the LLM
        const historySlice = suspect.conversationHistory.slice(-MAX_HISTORY);
        const contextMessages = [
            ...historySlice.map(h => ({ role: h.role, content: h.content })),
            { role: 'user', content: `${playerNick}: ${playerQuestion}` },
        ];

        try {
            // Step 1: Generate initial response (LLM or template)
            let response = await this._callLLM(suspect.systemPrompt, contextMessages);

            // If LLM returned null/empty, fall back to template
            if (!response) {
                response = this._templateResponse(suspect.config, playerQuestion);
            }

            // Step 2: Run violation check
            const violation = await this.violationBot.check(response, suspect.config);

            // Step 3: If violation detected, refine the response
            if (violation.hasViolation) {
                const systemMsg = { role: 'system', content: suspect.systemPrompt };
                response = await this.violationBot.refine(
                    response,
                    violation,
                    suspect.config,
                    [systemMsg, ...contextMessages],
                );
            }

            // Step 4: Track conversation history
            suspect.conversationHistory.push(
                { role: 'user', content: `${playerNick}: ${playerQuestion}` },
                { role: 'assistant', content: response },
            );

            // Step 5: Check if any clues were revealed
            const clueCheck = getClueForPlayer(suspect.config, playerQuestion);
            if (clueCheck && !suspect.cluesRevealed.includes(clueCheck)) {
                suspect.cluesRevealed.push(clueCheck);
            }

            // Step 6: Update suspicion level based on accusatory language
            this._trackSuspicion(suspect, playerQuestion);

            // Fire callback if registered
            if (this.onResponse) {
                this.onResponse(suspectId, response, violation.hasViolation);
            }

            return { text: response, isRevised: violation.hasViolation };
        } catch (err) {
            // Fallback: return an in-character deflection on any error
            const fallbackText = `*${suspect.config.name} pauses* I... I'd rather not discuss that right now.`;
            return {
                text: fallbackText,
                isRevised: false,
                error: true,
            };
        }
    }

    /**
     * Call the LLM generation function.
     * Adapts to the standard OpenWire LLM signature:
     *   (modelId, systemPrompt, contextMessages, maxTokens) => Promise<string|null>
     *
     * @param {string} systemPrompt   The suspect's system prompt
     * @param {Array}  contextMessages  Conversation context
     * @returns {Promise<string>}
     */
    async _callLLM(systemPrompt, contextMessages) {
        if (!this.generateFn) {
            // No LLM available — return null to trigger template fallback
            return null;
        }

        const result = await this.generateFn(
            this.modelId,
            systemPrompt,
            contextMessages,
            MAX_RESPONSE_TOKENS,
        );

        // The generation functions return string|null
        if (typeof result === 'string') return result.trim() || null;
        // Handle unexpected object returns
        if (result && typeof result === 'object') {
            return (result.content || result.text || '').trim() || null;
        }
        return null;
    }

    /**
     * Generate a template-based response when no LLM is available.
     * Uses keyword matching on the question to select an appropriate response pool.
     *
     * @param {object} suspect   Suspect config object
     * @param {string} question  The player's question
     * @returns {string}
     */
    _templateResponse(suspect, question) {
        const lower = (question || '').toLowerCase();

        // Check for alibi / location keywords
        if (/\b(alibi|where were you|where was|location|whereabouts|at the time)\b/.test(lower)) {
            return _pick(ALIBI_RESPONSES)(suspect);
        }

        // Check for accusation keywords
        if (/\b(you did it|you killed|you murdered|accuse|guilty|confess)\b/.test(lower)) {
            return _pick(ACCUSATION_RESPONSES)(suspect);
        }

        // Check for motive keywords
        if (/\b(motive|why would|reason|gain|benefit|profit)\b/.test(lower)) {
            return _pick(MOTIVE_RESPONSES)(suspect);
        }

        // Check for secret / hiding keywords
        if (/\b(secret|hiding|conceal|lie|lying|truth|honest)\b/.test(lower)) {
            return _pick(EVASIVE_RESPONSES)(suspect);
        }

        // Check if question mentions another suspect by name (cross-suspect)
        const otherSuspects = Object.values(this.suspects)
            .filter(s => s.config.id !== suspect.id);
        for (const other of otherSuspects) {
            const otherName = other.config.name.toLowerCase();
            // Match first or full name
            const firstName = otherName.split(' ')[0];
            if (lower.includes(otherName) || lower.includes(firstName)) {
                return _pick(CROSS_SUSPECT_RESPONSES)(suspect, other.config.name);
            }
        }

        // Default: generic in-character response
        return _pick(GENERIC_RESPONSES)(suspect);
    }

    /**
     * Track how aggressively the player is questioning this suspect.
     * Raises suspicion level, which could influence future responses.
     * @param {object} suspectState  Internal suspect state
     * @param {string} question      The player's question
     */
    _trackSuspicion(suspectState, question) {
        const lower = (question || '').toLowerCase();
        const accusatory = /\b(liar|lying|guilty|confess|admit|suspicious|caught|accuse)\b/;
        if (accusatory.test(lower)) {
            suspectState.suspicionLevel = Math.min(
                suspectState.suspicionLevel + 1,
                10,
            );
        }
    }

    /**
     * Get summary of clues discovered for a specific suspect.
     * @param {string} suspectId
     * @returns {string[]}
     */
    getRevealedClues(suspectId) {
        return this.suspects[suspectId]?.cluesRevealed || [];
    }

    /**
     * Get conversation history for a specific suspect.
     * @param {string} suspectId
     * @returns {Array}
     */
    getHistory(suspectId) {
        return this.suspects[suspectId]?.conversationHistory || [];
    }

    /**
     * Clean up all state and references.
     */
    destroy() {
        this.suspects = {};
        this.generateFn = null;
        this.modelId = null;
        this.violationBot = null;
        this.onResponse = null;
    }
}

/* ── Convenience: Standalone Response Generator ──────────── */

/**
 * Generate a suspect response as a standalone function.
 * Creates a temporary MysterySwarm, wires the appropriate LLM
 * provider, generates the response, and returns the result.
 *
 * This is the primary entry point for ChatRoom integration:
 *   - Resolves the correct LLM provider (openrouter/gemini/qwen/haimaker)
 *   - Initializes a MysterySwarm with the game state
 *   - Generates a response with violation checking
 *   - Checks for clue reveals
 *   - Returns { text, clue, isRevised }
 *
 * @param {object}  suspect        The suspect object from game state
 * @param {string}  playerMessage  The player's interrogation text
 * @param {object}  mystery        The full mystery game state (with suspects array)
 * @param {object}  [options]      { swarm, provider, model }
 * @returns {Promise<{ text: string, clue: string|null, isRevised: boolean }>}
 */
export async function generateSuspectResponse(suspect, playerMessage, mystery, options = {}) {
    const swarm = options.swarm; // AgentSwarm instance if available

    // Resolve LLM generation function and model from the active provider
    const { generateFn, modelId } = await _resolveGenerateFn(swarm, options);

    // Build a temporary MysterySwarm instance initialized with just enough state
    const ms = new MysterySwarm();
    ms.init(mystery, generateFn, modelId);

    // Restore conversation history if the suspect already has some
    if (suspect._conversationHistory && ms.suspects[suspect.id]) {
        ms.suspects[suspect.id].conversationHistory = [
            ...suspect._conversationHistory,
        ];
    }

    // Generate the response
    const playerNick = options.playerNick || 'Detective';
    const result = await ms.generateResponse(suspect.id, playerMessage, playerNick);

    // Check for clue reveal
    const clue = getClueForPlayer(suspect, playerMessage);

    // Propagate conversation history back to the suspect object (host-only mutation)
    if (ms.suspects[suspect.id]) {
        suspect._conversationHistory = ms.suspects[suspect.id].conversationHistory;
    }

    ms.destroy();

    return {
        text: result.text,
        clue,
        isRevised: result.isRevised,
    };
}

/**
 * Check whether AI (LLM) generation is available for mystery suspects.
 * Returns true if a swarm with an LLM provider is configured.
 *
 * @param {object} [swarm]  Optional AgentSwarm instance
 * @returns {boolean}
 */
export function isAIAvailable(swarm) {
    if (!swarm) return false;
    // Check if the swarm has a valid provider and model
    return !!(swarm.provider && swarm._defaultModel);
}

/**
 * Resolve the LLM generation function and model based on the active provider.
 * @param {object} [swarm]    AgentSwarm instance
 * @param {object} [options]  { provider, model }
 * @returns {{ generateFn: Function|null, modelId: string }}
 */
async function _resolveGenerateFn(swarm, options = {}) {
    // Allow explicit override
    if (options.generateFn && options.model) {
        return { generateFn: options.generateFn, modelId: options.model };
    }

    // Resolve provider from swarm or options
    const provider = options.provider
        || (swarm && swarm.provider)
        || 'openrouter';

    const model = options.model
        || (swarm && swarm._defaultModel)
        || FALLBACK_MODEL;

    // Ensure generators are loaded (async init may not have completed)
    if (!_cachedGenerators[provider]) {
        await _initGenerators();
    }

    // Direct import fallback if cached generator is still null
    let generateFn = _cachedGenerators[provider] || null;
    if (!generateFn) {
        try {
            if (provider === 'gemini') {
                const mod = await import('./gemini.js');
                generateFn = mod.generateGeminiMessage;
            } else if (provider === 'haimaker') {
                const mod = await import('./haimaker.js');
                generateFn = mod.generateHaimakerMessage;
            } else if (provider === 'openrouter') {
                const mod = await import('./openrouter.js');
                generateFn = mod.generateMessage;
            } else if (provider === 'qwen') {
                const mod = await import('./qwen.js');
                generateFn = mod.generateQwenMessage;
            }
        } catch { /* provider not available */ }
    }

    return { generateFn, modelId: model };
}

// Lazy accessors for LLM generation functions (avoids circular imports)
function _getOpenRouterGen() {
    // Already imported at top of this file via the import chain
    return _cachedGenerators.openrouter;
}
function _getGeminiGen() {
    return _cachedGenerators.gemini;
}
function _getQwenGen() {
    return _cachedGenerators.qwen;
}
function _getHaimakerGen() {
    return _cachedGenerators.haimaker;
}

// Populated via initGenerators() — called once at module load
const _cachedGenerators = {
    openrouter: null,
    gemini: null,
    qwen: null,
    haimaker: null,
};

/**
 * Initialize the cached generator references.
 * Called automatically on first import of this module.
 */
async function _initGenerators() {
    try {
        const or = await import('./openrouter.js');
        _cachedGenerators.openrouter = or.generateMessage;
    } catch { /* proxy not configured */ }
    try {
        const gm = await import('./gemini.js');
        _cachedGenerators.gemini = gm.generateGeminiMessage;
    } catch { /* proxy not configured */ }
    try {
        const qw = await import('./qwen.js');
        _cachedGenerators.qwen = qw.generateQwenMessage;
    } catch { /* proxy not configured */ }
    try {
        const hm = await import('./haimaker.js');
        _cachedGenerators.haimaker = hm.generateHaimakerMessage;
    } catch { /* proxy not configured */ }
}

// Auto-initialize on module load
_initGenerators();

/* ── Custom Scenario Generation ──────────────────────────── */

/**
 * Generate a custom murder mystery scenario via LLM based on user inputs.
 * Returns a parsed scenario object matching the template format, or null on failure.
 *
 * @param {string} setting    User-provided setting description
 * @param {string} victim     User-provided victim name/role
 * @param {string} theme      User-provided theme/mood
 * @param {string} provider   AI provider (gemini, haimaker, openrouter, qwen)
 * @param {string} model      Model ID to use
 * @returns {Promise<object|null>}  Scenario object or null
 */
export async function generateCustomScenario(setting, victim, theme, provider, model) {
    const { generateFn, modelId } = await _resolveGenerateFn(null, { provider, model });
    if (!generateFn) return null;

    const prompt = `You are a murder mystery game designer. Create a murder mystery scenario.

Setting: ${setting || 'A mysterious location'}
Victim: ${victim || 'An important person'}
Theme: ${theme || 'Classic noir'}

Generate EXACTLY this JSON structure (no markdown, no explanation, just valid JSON):
{
    "title": "Mystery Title",
    "setting": "A vivid description of the setting (2-3 sentences)",
    "victim": { "name": "Victim Name", "role": "their role", "description": "brief description" },
    "weapon": "the murder weapon",
    "motive": "the culprit's motive",
    "culpritIndex": 0,
    "suspects": [
        {
            "name": "Suspect Name",
            "role": "their role/title",
            "avatar": "single emoji",
            "personality": "2-3 personality traits",
            "backstory": "2-3 sentence backstory",
            "alibi": "what they claim they were doing",
            "secret": "what they are hiding",
            "secretConstraints": ["keyword1", "keyword2"],
            "relationshipToVictim": "how they knew the victim"
        }
    ],
    "crossClues": [
        ["Clue text about suspect Y that suspect X knows", 0, 1]
    ]
}

Create exactly 5 suspects. The suspect at culpritIndex is the actual killer.
Create at least 6 crossClues as [text, fromSuspectIndex, aboutSuspectIndex].
Make alibis believable but the culprit's alibi should have a subtle weakness.
If the theme mentions Hindi/Hinglish, make dialogue and names Indian.`;

    try {
        const response = await generateFn(modelId, prompt, [], 2000);
        if (!response) return null;

        // Parse JSON from response (handle markdown code blocks)
        const responseText = typeof response === 'string' ? response : (response.content || response.text || '');
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;

        const scenario = JSON.parse(jsonMatch[0]);

        // Validate required fields
        if (!scenario.suspects || scenario.suspects.length < 3) return null;
        if (!scenario.title || !scenario.victim) return null;

        // Ensure culpritIndex is valid
        if (typeof scenario.culpritIndex !== 'number' ||
            scenario.culpritIndex < 0 ||
            scenario.culpritIndex >= scenario.suspects.length) {
            scenario.culpritIndex = 0;
        }

        // Ensure crossClues is an array
        if (!Array.isArray(scenario.crossClues)) {
            scenario.crossClues = [];
        }

        // Ensure each suspect has required fields with defaults
        scenario.suspects = scenario.suspects.map(s => ({
            name: s.name || 'Unknown',
            role: s.role || 'unknown role',
            avatar: s.avatar || '?',
            personality: s.personality || 'quiet and reserved',
            backstory: s.backstory || 'Not much is known about them.',
            alibi: s.alibi || 'I was somewhere else.',
            secret: s.secret || 'They have something to hide.',
            secretConstraints: Array.isArray(s.secretConstraints) ? s.secretConstraints : [],
            relationshipToVictim: s.relationshipToVictim || 'acquaintance',
        }));

        return scenario;
    } catch (err) {
        console.warn('[Mystery] Custom scenario generation failed:', err);
        return null;
    }
}

/* ── Utility ──────────────────────────────────────────────── */

/** Pick a random item from an array. */
function _pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
