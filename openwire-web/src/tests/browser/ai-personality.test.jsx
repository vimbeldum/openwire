/**
 * ai-personality.test.jsx
 *
 * Tests for AgentSwarm prompt construction — verifying WHAT goes into the LLM
 * call, not what the LLM returns.
 *
 * Key API shapes confirmed from source (swarm.js + openrouter.js):
 *   generateMessage(modelId, systemPrompt, contextMessages, maxTokens)
 *     contextMessages = [{ role: 'user', content: '...' }]  (the trigger array)
 *
 *   AgentSwarm constructor: { onMessage, onError, onModelLoad, onLog, onTyping }
 *   addContext(nick, text, forceIsAgent?)
 *   setMentionOnlyMode(bool)
 *   setModelOverride(characterId, modelId)
 *   setMood(characterId, mood)
 *   _processQueue()  — internal async method, called by _generate()
 *
 * Test strategy: bypass queue timers by directly calling _processQueue()
 * and awaiting it. This avoids vi.waitFor polling races.
 */

import { AgentSwarm } from '../../lib/agents/swarm';

// ── localStorage stub — swarm.js uses localStorage.getItem inside _processQueue ──
// The jsdom environment provided by vitest does not reliably wire a full localStorage.
// We install a minimal in-memory stub before module initialization.

const _localStorageStore = {};
const _localStorageMock = {
    getItem: vi.fn((key) => _localStorageStore[key] ?? null),
    setItem: vi.fn((key, val) => { _localStorageStore[key] = String(val); }),
    removeItem: vi.fn((key) => { delete _localStorageStore[key]; }),
    clear: vi.fn(() => { Object.keys(_localStorageStore).forEach(k => delete _localStorageStore[k]); }),
};
Object.defineProperty(globalThis, 'localStorage', {
    value: _localStorageMock,
    writable: true,
    configurable: true,
});

// ── Mock all provider modules ─────────────────────────────────────────────

vi.mock('../../lib/agents/openrouter.js', () => ({
    fetchFreeModels: vi.fn().mockResolvedValue([]),
    generateMessage: vi.fn().mockResolvedValue('mock response'),
}));

vi.mock('../../lib/agents/gemini.js', () => ({
    fetchGeminiModels: vi.fn().mockResolvedValue([]),
    generateGeminiMessage: vi.fn().mockResolvedValue('mock gemini response'),
}));

vi.mock('../../lib/agents/qwen.js', () => ({
    fetchQwenModels: vi.fn().mockResolvedValue([]),
    generateQwenMessage: vi.fn().mockResolvedValue('mock qwen response'),
}));

vi.mock('../../lib/agents/haimaker.js', () => ({
    fetchHaimakerModels: vi.fn().mockResolvedValue([]),
    generateHaimakerMessage: vi.fn().mockResolvedValue('mock haimaker response'),
}));

vi.mock('../../lib/agents/agentStore.js', () => {
    const characters = {
        jethalal: {
            id: 'jethalal',
            name: 'Jethalal',
            avatar: '😅',
            gender: 'male',
            show: 'tmkoc',
            groupId: 'tmkoc',
            frequencyWeight: 10,
            minInterval: 8000,
            maxInterval: 24000,
            reactive_tags: ['electronics', 'shop'],
            agent_triggers: ['daya'],
            systemPrompt: '<identity>You are Jethalal Gada.</identity>',
            moods: {
                normal: '',
                panicking: 'Everything feels like a disaster.',
            },
        },
    };
    const groups = {
        tmkoc: { id: 'tmkoc', name: 'TMKOC', emoji: '🏘️' },
    };
    return {
        loadStore: vi.fn(() => ({
            characters: Object.values(characters),
            groups: Object.values(groups),
            modelFilters: { whitelist: [], blacklist: [] },
            guardrails: true,
        })),
        getCharactersDict: vi.fn(() => ({ ...characters })),
        getGroupsDict: vi.fn(() => ({ ...groups })),
    };
});

// ── Import the mock AFTER vi.mock hoisting ────────────────────────────────

import { generateMessage } from '../../lib/agents/openrouter.js';

// ── Helper: build a running swarm with cooldowns zeroed out ───────────────

function makeRunningSwarm() {
    const swarm = new AgentSwarm({
        onMessage: vi.fn(),
        onError: vi.fn(),
        onModelLoad: vi.fn(),
        onLog: vi.fn(),
        onTyping: vi.fn(),
    });
    // Mark as running so _generate() accepts work
    swarm._running = true;
    // Zero out cooldowns so queue processes immediately
    swarm._globalCooldown = 0;
    swarm._perCharCooldown = 0;
    swarm._lastMsgGlobal = 0;
    // Set a deterministic default model
    swarm._defaultModel = 'test-model-fallback';
    return swarm;
}

/**
 * Queue a task for the given character and directly await _processQueue().
 * This bypasses setTimeout-based scheduling entirely.
 * Throws if the swarm's onError was called (i.e., an error occurred in the queue).
 */
async function triggerAndDrain(swarm, characterId) {
    // Manually queue the task (same as _generate with force=true but without timers)
    const c = swarm._characters[characterId];
    if (!c) throw new Error(`Character '${characterId}' not found in swarm`);

    // Track any errors swallowed by the queue
    let queueError = null;
    const origOnError = swarm._onError;
    swarm._onError = (msg) => { queueError = msg; origOnError(msg); };

    const task = { characterId, retries: 0, force: true, chainDepth: 0 };
    swarm._messageQueue.push(task);
    swarm._isProcessingQueue = false; // ensure not blocked
    await swarm._processQueue();

    if (queueError) {
        throw new Error(`AgentSwarm queue error: ${queueError}`);
    }
}

// ── Prompt construction tests ─────────────────────────────────────────────

describe('AgentSwarm — system prompt construction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('includes the character systemPrompt in the system prompt passed to generateMessage', async () => {
        const swarm = makeRunningSwarm();
        swarm.addContext('User1', 'Hello everyone!');
        await triggerAndDrain(swarm, 'jethalal');

        expect(generateMessage).toHaveBeenCalledOnce();
        const [, systemPrompt] = generateMessage.mock.calls[0];
        expect(systemPrompt).toContain('<identity>You are Jethalal Gada.</identity>');
    });

    it('includes room_rules block in the system prompt', async () => {
        const swarm = makeRunningSwarm();
        swarm.addContext('User1', 'test message');
        await triggerAndDrain(swarm, 'jethalal');

        expect(generateMessage).toHaveBeenCalledOnce();
        const [, systemPrompt] = generateMessage.mock.calls[0];
        expect(systemPrompt).toContain('<room_rules>');
    });

    it('includes drama_engine block in the system prompt', async () => {
        const swarm = makeRunningSwarm();
        swarm.addContext('User1', 'hey');
        await triggerAndDrain(swarm, 'jethalal');

        expect(generateMessage).toHaveBeenCalledOnce();
        const [, systemPrompt] = generateMessage.mock.calls[0];
        expect(systemPrompt).toContain('<drama_engine>');
    });

    it('uses the correct model ID — from setModelOverride when set', async () => {
        const swarm = makeRunningSwarm();
        swarm.setModelOverride('jethalal', 'specific-model-id');
        swarm.addContext('User1', 'hello');
        await triggerAndDrain(swarm, 'jethalal');

        expect(generateMessage).toHaveBeenCalledOnce();
        const [modelId] = generateMessage.mock.calls[0];
        expect(modelId).toBe('specific-model-id');
    });

    it('falls back to _defaultModel when no override is set', async () => {
        const swarm = makeRunningSwarm();
        swarm._defaultModel = 'my-default-model';
        swarm.addContext('User1', 'hi');
        await triggerAndDrain(swarm, 'jethalal');

        expect(generateMessage).toHaveBeenCalledOnce();
        const [modelId] = generateMessage.mock.calls[0];
        expect(modelId).toBe('my-default-model');
    });
});

// ── Context / chat history injection tests ───────────────────────────────

describe('AgentSwarm — context injection into trigger message', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('includes the chat history (addContext messages) in the trigger message content', async () => {
        const swarm = makeRunningSwarm();
        swarm.addContext('Alice', 'What is going on today?');
        swarm.addContext('Bob', 'I have no idea!');
        await triggerAndDrain(swarm, 'jethalal');

        expect(generateMessage).toHaveBeenCalledOnce();
        const [, , contextMessages] = generateMessage.mock.calls[0];
        const triggerContent = contextMessages[0]?.content || '';
        expect(triggerContent).toContain('Alice: What is going on today?');
        expect(triggerContent).toContain('Bob: I have no idea!');
    });

    it('the context messages array (trigger) has role: "user"', async () => {
        const swarm = makeRunningSwarm();
        swarm.addContext('User1', 'Simple message');
        await triggerAndDrain(swarm, 'jethalal');

        expect(generateMessage).toHaveBeenCalledOnce();
        const [, , contextMessages] = generateMessage.mock.calls[0];
        expect(contextMessages.length).toBeGreaterThan(0);
        expect(contextMessages[0].role).toBe('user');
    });

    it('marks Jethalal own prior messages with [THIS WAS SAID BY YOU] in the context', async () => {
        const swarm = makeRunningSwarm();
        // forceIsAgent=true marks this as an agent message
        swarm.addContext('Jethalal', 'Main toh bas yahi chahta tha', true);
        swarm.addContext('User1', 'Really?');
        await triggerAndDrain(swarm, 'jethalal');

        expect(generateMessage).toHaveBeenCalledOnce();
        const [, , contextMessages] = generateMessage.mock.calls[0];
        const triggerContent = contextMessages[0]?.content || '';
        expect(triggerContent).toContain('[THIS WAS SAID BY YOU');
    });

    it('passes the trigger as an array (not a bare string)', async () => {
        const swarm = makeRunningSwarm();
        swarm.addContext('User1', 'test');
        await triggerAndDrain(swarm, 'jethalal');

        expect(generateMessage).toHaveBeenCalledOnce();
        const [, , contextMessages] = generateMessage.mock.calls[0];
        expect(Array.isArray(contextMessages)).toBe(true);
    });
});

// ── Mood injection tests ──────────────────────────────────────────────────

describe('AgentSwarm — mood in system prompt', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does NOT include <current_mood> block when mood is "normal"', async () => {
        const swarm = makeRunningSwarm();
        swarm.setMood('jethalal', 'normal');
        swarm.addContext('User1', 'hi');
        await triggerAndDrain(swarm, 'jethalal');

        expect(generateMessage).toHaveBeenCalledOnce();
        const [, systemPrompt] = generateMessage.mock.calls[0];
        expect(systemPrompt).not.toContain('<current_mood>');
    });

    it('includes <current_mood> block in system prompt when mood is non-normal', async () => {
        const swarm = makeRunningSwarm();
        swarm.setMood('jethalal', 'panicking');
        swarm.addContext('User1', 'hi');
        await triggerAndDrain(swarm, 'jethalal');

        expect(generateMessage).toHaveBeenCalledOnce();
        const [, systemPrompt] = generateMessage.mock.calls[0];
        expect(systemPrompt).toContain('<current_mood>');
        expect(systemPrompt).toContain('PANICKING');
    });

    it('includes the mood modifier text from character config in system prompt', async () => {
        const swarm = makeRunningSwarm();
        swarm.setMood('jethalal', 'panicking');
        swarm.addContext('User1', 'anything');
        await triggerAndDrain(swarm, 'jethalal');

        expect(generateMessage).toHaveBeenCalledOnce();
        const [, systemPrompt] = generateMessage.mock.calls[0];
        // The exact modifier text from the character's moods.panicking config
        expect(systemPrompt).toContain('Everything feels like a disaster.');
    });

    it('setMood with an invalid mood key does not corrupt the swarm state', () => {
        const swarm = makeRunningSwarm();
        // 'nonexistent' is not a key in jethalal.moods — setMood is a no-op
        swarm.setMood('jethalal', 'nonexistent');
        // Mood should stay at 'normal' (unchanged) since guard in setMood: if (!c.moods?.[mood]) return
        // _moods is set to 'normal' at initialization, so nonexistent mood is rejected
        expect(swarm._moods['jethalal']).toBe('normal');
    });
});

// ── Mention-only mode tests ───────────────────────────────────────────────

describe('AgentSwarm — mention-only mode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('generateMessage is NOT called via reactive path when mention-only mode is ON and no active window', async () => {
        const swarm = makeRunningSwarm();
        swarm.setMentionOnlyMode(true);
        // Clear ALL activation windows so no character is active
        swarm._charActiveUntil = {};

        // Non-mention message — addContext will try reactive triggers but character has no active window
        swarm.addContext('User1', 'just chatting here');

        // Allow microtasks to flush
        await new Promise(r => setTimeout(r, 20));
        expect(generateMessage).not.toHaveBeenCalled();
    });

    it('generateMessage IS called for an explicit trigger even in mention-only mode', async () => {
        const swarm = makeRunningSwarm();
        swarm.setMentionOnlyMode(true);
        swarm.addContext('User1', '@jethalal kya kar raha hai?');
        await triggerAndDrain(swarm, 'jethalal');
        expect(generateMessage).toHaveBeenCalledOnce();
    });
});

// ── Model override tests ──────────────────────────────────────────────────

describe('AgentSwarm — model override', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses the overridden model when setModelOverride() is called', async () => {
        const swarm = makeRunningSwarm();
        swarm.setModelOverride('jethalal', 'gpt-4-turbo');
        swarm.addContext('User1', 'hello');
        await triggerAndDrain(swarm, 'jethalal');

        expect(generateMessage).toHaveBeenCalledOnce();
        const [modelId] = generateMessage.mock.calls[0];
        expect(modelId).toBe('gpt-4-turbo');
    });

    it('reverts to defaultModel when override is cleared by passing null', async () => {
        const swarm = makeRunningSwarm();
        swarm._defaultModel = 'default-model-id';
        swarm.setModelOverride('jethalal', 'temp-override');
        swarm.setModelOverride('jethalal', null); // clear override

        swarm.addContext('User1', 'hello');
        await triggerAndDrain(swarm, 'jethalal');

        expect(generateMessage).toHaveBeenCalledOnce();
        const [modelId] = generateMessage.mock.calls[0];
        expect(modelId).toBe('default-model-id');
    });
});

// ── maxTokens parameter tests ─────────────────────────────────────────────

describe('AgentSwarm — maxTokens parameter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('passes maxTokens=120 to generateMessage for openrouter provider', async () => {
        const swarm = makeRunningSwarm();
        swarm._provider = 'openrouter';
        swarm.addContext('User1', 'hi');
        await triggerAndDrain(swarm, 'jethalal');

        expect(generateMessage).toHaveBeenCalledOnce();
        const [, , , maxTokens] = generateMessage.mock.calls[0];
        expect(maxTokens).toBe(120);
    });
});

// ── AgentSwarm state / config tests ─────────────────────────────────────

describe('AgentSwarm — configuration getters and setters', () => {
    it('running is false before start() is called', () => {
        const swarm = new AgentSwarm({
            onMessage: vi.fn(),
            onError: vi.fn(),
            onModelLoad: vi.fn(),
            onLog: vi.fn(),
            onTyping: vi.fn(),
        });
        expect(swarm.running).toBe(false);
    });

    it('mentionOnlyMode defaults to false', () => {
        const swarm = new AgentSwarm({
            onMessage: vi.fn(),
            onError: vi.fn(),
            onModelLoad: vi.fn(),
            onLog: vi.fn(),
            onTyping: vi.fn(),
        });
        expect(swarm.mentionOnlyMode).toBe(false);
    });

    it('setMentionOnlyMode(true) sets mentionOnlyMode to true', () => {
        const swarm = new AgentSwarm({
            onMessage: vi.fn(),
            onError: vi.fn(),
            onModelLoad: vi.fn(),
            onLog: vi.fn(),
            onTyping: vi.fn(),
        });
        swarm.setMentionOnlyMode(true);
        expect(swarm.mentionOnlyMode).toBe(true);
    });

    it('setModelOverride is reflected by getAssignedModel()', () => {
        const swarm = new AgentSwarm({
            onMessage: vi.fn(),
            onError: vi.fn(),
            onModelLoad: vi.fn(),
            onLog: vi.fn(),
            onTyping: vi.fn(),
        });
        swarm._defaultModel = 'default-model';
        swarm.setModelOverride('jethalal', 'special-model');
        expect(swarm.getAssignedModel('jethalal')).toBe('special-model');
    });

    it('flushContext resets context to only the TURN2_ANCHOR entry', () => {
        const swarm = new AgentSwarm({
            onMessage: vi.fn(),
            onError: vi.fn(),
            onModelLoad: vi.fn(),
            onLog: vi.fn(),
            onTyping: vi.fn(),
        });
        swarm.addContext('User1', 'message one');
        swarm.addContext('User2', 'message two');
        expect(swarm._context.length).toBe(3); // TURN2_ANCHOR + 2 added
        swarm.flushContext();
        expect(swarm._context.length).toBe(1); // only TURN2_ANCHOR remains
    });

    it('setChatterLevel clamps values below minimum to 0.1', () => {
        const swarm = makeRunningSwarm();
        swarm.setChatterLevel(0.0);
        expect(swarm.chatterLevel).toBe(0.1);
    });

    it('setChatterLevel clamps values above maximum to 3.0', () => {
        const swarm = makeRunningSwarm();
        swarm.setChatterLevel(99);
        expect(swarm.chatterLevel).toBe(3.0);
    });

    it('setMaxMsgPerMin clamps below minimum to 1', () => {
        const swarm = makeRunningSwarm();
        swarm.setMaxMsgPerMin(0);
        expect(swarm.maxMsgPerMin).toBe(1);
    });
});

// ── Browser-only / integration stubs ─────────────────────────────────────

describe('AgentSwarm — browser-only / integration tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('start() fetches free models from OpenRouter and calls _assignModels()', async () => {
        const { fetchFreeModels } = await import('../../lib/agents/openrouter.js');
        vi.mocked(fetchFreeModels).mockClear();

        const onModelLoad = vi.fn();
        const swarm = new AgentSwarm({
            onMessage: vi.fn(),
            onError: vi.fn(),
            onModelLoad,
            onLog: vi.fn(),
            onTyping: vi.fn(),
        });

        await swarm.start();

        expect(fetchFreeModels).toHaveBeenCalled();
        expect(onModelLoad).toHaveBeenCalled();
        expect(Object.keys(swarm._assignedModels).length).toBeGreaterThan(0);

        swarm.stop();
    });

    it('stop() clears all timers, drains the message queue, and resets _running to false', async () => {
        const swarm = new AgentSwarm({
            onMessage: vi.fn(),
            onError: vi.fn(),
            onModelLoad: vi.fn(),
            onLog: vi.fn(),
            onTyping: vi.fn(),
        });

        await swarm.start();
        expect(swarm.running).toBe(true);

        swarm._messageQueue.push({ characterId: 'jethalal', retries: 0, force: false, chainDepth: 0 });

        swarm.stop();

        expect(swarm.running).toBe(false);
        expect(swarm.queueLength).toBe(0);
        expect(Object.keys(swarm._timers).length).toBe(0);
    });

    it('retry logic: 429 response triggers exponential backoff and re-queues the task', async () => {
        const swarm = makeRunningSwarm();
        swarm.addContext('User1', 'Hello everyone!');

        let callCount = 0;
        vi.mocked(generateMessage).mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                const err = new Error('429 Too Many Requests');
                err.status = 429;
                throw err;
            }
            return 'recovered response';
        });

        await triggerAndDrain(swarm, 'jethalal');

        expect(callCount).toBeGreaterThanOrEqual(2);
        expect(swarm._stats.rateLimitHits).toBeGreaterThanOrEqual(1);
    });

    it.todo('crossover: agent_triggers fires a second character when the first one responds');

    it('context compaction: _compactContext called when context reaches COMPACT_THRESHOLD (50)', () => {
        const swarm = makeRunningSwarm();

        const spy = vi.spyOn(swarm, '_compactContext').mockImplementation(async () => {});

        for (let i = 0; i < 50; i++) {
            swarm.addContext(`User${i}`, `Test message number ${i} for compaction threshold`);
        }

        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('P2P summary sync: loadSummary() is reflected in summaryBlock of system prompt', async () => {
        const swarm = makeRunningSwarm();
        swarm.loadSummary('- Jethalal argued with Bhide about rent');
        swarm.addContext('User1', 'kya chal raha hai?');

        await triggerAndDrain(swarm, 'jethalal');

        expect(generateMessage).toHaveBeenCalledOnce();
        const [, systemPrompt] = generateMessage.mock.calls[0];
        expect(systemPrompt).toContain('<conversation_history>');
        expect(systemPrompt).toContain('Jethalal argued with Bhide about rent');
    });

    it('guardrails=false: unfiltered room_rules block replaces the SFW version', async () => {
        const swarm = makeRunningSwarm();
        swarm._guardrails = false;
        swarm.addContext('User1', 'test message');

        await triggerAndDrain(swarm, 'jethalal');

        expect(generateMessage).toHaveBeenCalledOnce();
        const [, systemPrompt] = generateMessage.mock.calls[0];
        expect(systemPrompt).toContain('<room_rules>');
        expect(systemPrompt).toContain('savage');
        expect(systemPrompt).not.toContain('family-friendly');
    });

    it('session facts: _extractFact stores human messages and they appear in factsBlock', async () => {
        const swarm = makeRunningSwarm();

        // Use messages without reactive_tags to avoid triggering extra generations
        swarm.addContext('Alice', 'This is a really interesting conversation about something fun');
        swarm.addContext('Bob', 'I totally agree with what you are saying about that topic');

        expect(swarm.sessionFacts.length).toBeGreaterThan(0);

        await triggerAndDrain(swarm, 'jethalal');

        // generateMessage may have been called multiple times due to reactive triggers;
        // check the first call's system prompt for session_memory
        expect(generateMessage).toHaveBeenCalled();
        const [, systemPrompt] = generateMessage.mock.calls[0];
        expect(systemPrompt).toContain('<session_memory>');
    });

    it.todo('triple prompt repetition: non-thinking models get systemPrompt repeated 3x in generateMessage');
});
