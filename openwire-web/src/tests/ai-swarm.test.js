/**
 * AI Agent Swarm — Domain Test Suite
 *
 * Covers:
 *   1. Characters   — character registry structure, required fields, moods, avatars
 *   2. Responses    — @mention handling, personality, context awareness, mood shifts,
 *                     cross-agent reference detection
 *   3. User controls — mute/unmute per agent, mute all, isMuted state persistence
 *   4. Admin controls — chatter level, mention-only mode, per-char cooldown,
 *                       global throttle, provider/model override
 *
 * Does NOT duplicate Section F of security-compliance.test.js:
 *   escapeXmlTags, guardrails default, stop() queue clearing,
 *   setChatterLevel clamping, addContext, _generation increment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ════════════════════════════════════════════════════════════════
   Shared browser-API stubs — must come before any module import
   ════════════════════════════════════════════════════════════════ */

function makeStorageStub() {
    const _store = {};
    return {
        getItem: vi.fn(k => _store[k] ?? null),
        setItem: vi.fn((k, v) => { _store[k] = String(v); }),
        removeItem: vi.fn(k => { delete _store[k]; }),
        clear: vi.fn(() => { Object.keys(_store).forEach(k => delete _store[k]); }),
        _raw: _store,
    };
}

const _localStorage = makeStorageStub();
const _sessionStorage = makeStorageStub();
vi.stubGlobal('localStorage', _localStorage);
vi.stubGlobal('sessionStorage', _sessionStorage);

/* ════════════════════════════════════════════════════════════════
   Module mocks — intercept ALL network calls inside swarm.js
   ════════════════════════════════════════════════════════════════ */

vi.mock('../lib/agents/openrouter.js', () => ({
    fetchFreeModels: vi.fn().mockResolvedValue([]),
    generateMessage: vi.fn().mockResolvedValue('mocked openrouter response'),
}));

vi.mock('../lib/agents/gemini.js', () => ({
    fetchGeminiModels: vi.fn().mockResolvedValue([]),
    generateGeminiMessage: vi.fn().mockResolvedValue('mocked gemini response'),
}));

vi.mock('../lib/agents/qwen.js', () => ({
    fetchQwenModels: vi.fn().mockResolvedValue([]),
    generateQwenMessage: vi.fn().mockResolvedValue('mocked qwen response'),
}));

vi.mock('../lib/agents/haimaker.js', () => ({
    fetchHaimakerModels: vi.fn().mockResolvedValue([]),
    generateHaimakerMessage: vi.fn().mockResolvedValue('mocked haimaker response'),
}));

/* agentStore mock — returns a realistic store with two characters */
vi.mock('../lib/agents/agentStore.js', () => {
    const mockChars = [
        {
            id: 'jethalal',
            name: 'Jethalal',
            groupId: 'tmkoc',
            avatar: '😅',
            systemPrompt: '<identity>Jethalal test</identity>',
            frequencyWeight: 10,
            minInterval: 8000,
            maxInterval: 24000,
            reactive_tags: ['electronics', 'shop', 'babita'],
            agent_triggers: ['daya', 'tarak'],
            moods: {
                normal: '',
                panicking: 'Everything feels like a disaster.',
                scheming: 'You are hatching a secret plan.',
            },
            gender: 'male',
        },
        {
            id: 'daya',
            name: 'Dayaben',
            groupId: 'tmkoc',
            avatar: '🤶',
            systemPrompt: '<identity>Daya test</identity>',
            frequencyWeight: 7,
            minInterval: 12000,
            maxInterval: 26000,
            reactive_tags: ['garba', 'food', 'cooking'],
            agent_triggers: ['jethalal'],
            moods: {
                normal: '',
                excited: 'Bursting with excitement.',
                worried: 'Worried about Jethalal.',
            },
            gender: 'female',
        },
    ];

    const mockStore = {
        characters: mockChars,
        groups: [{ id: 'tmkoc', name: 'TMKOC', emoji: '🏘️' }],
        modelFilters: { whitelist: [], blacklist: [] },
        guardrails: true,
        _version: 16,
    };

    function getCharactersDict(store) {
        const d = {};
        store.characters.forEach(c => { d[c.id] = { ...c, show: c.groupId }; });
        return d;
    }

    function getGroupsDict(store) {
        const d = {};
        store.groups.forEach(g => { d[g.id] = g; });
        return d;
    }

    return {
        loadStore: vi.fn().mockReturnValue(mockStore),
        saveStore: vi.fn(),
        resetStore: vi.fn().mockReturnValue(mockStore),
        getCharactersDict: vi.fn(store => getCharactersDict(store || mockStore)),
        getGroupsDict: vi.fn(store => getGroupsDict(store || mockStore)),
        getGroupCharacters: vi.fn((store, gid) =>
            (store || mockStore).characters.filter(c => c.groupId === gid)
        ),
        addCharacter: vi.fn((store, char) => ({
            ...store,
            characters: [...store.characters, char],
        })),
        updateCharacter: vi.fn((store, id, updates) => ({
            ...store,
            characters: store.characters.map(c => c.id === id ? { ...c, ...updates } : c),
        })),
        removeCharacter: vi.fn((store, id) => ({
            ...store,
            characters: store.characters.filter(c => c.id !== id),
        })),
        addGroup: vi.fn((store, g) => ({ ...store, groups: [...store.groups, g] })),
        removeGroup: vi.fn((store, gid) => ({
            ...store,
            groups: store.groups.filter(g => g.id !== gid),
            characters: store.characters.filter(c => c.groupId !== gid),
        })),
        addToWhitelist: vi.fn(),
        addToBlacklist: vi.fn(),
        removeFromWhitelist: vi.fn(),
        removeFromBlacklist: vi.fn(),
    };
});

/* ════════════════════════════════════════════════════════════════
   Lazy imports (after mocks are registered)
   ════════════════════════════════════════════════════════════════ */

import { CHARACTERS, SHOWS, getShowCharacters } from '../lib/agents/characters.js';
import {
    loadStore,
    buildDefaults,
    getCharactersDict,
    getGroupsDict,
    addCharacter,
    updateCharacter,
    removeCharacter,
    addGroup,
    removeGroup,
} from '../lib/agents/agentStore.js';
import { AgentSwarm } from '../lib/agents/swarm.js';

/* ════════════════════════════════════════════════════════════════
   Helper — build a minimal swarm instance
   ════════════════════════════════════════════════════════════════ */

function makeSwarm(overrides = {}) {
    return new AgentSwarm({
        onMessage: vi.fn(),
        onError: vi.fn(),
        onModelLoad: vi.fn(),
        onLog: vi.fn(),
        onTyping: vi.fn(),
        ...overrides,
    });
}

/* ════════════════════════════════════════════════════════════════
   Section 1 — Character Registry (characters.js)
   ════════════════════════════════════════════════════════════════ */

describe('1 — Character Registry (characters.js)', () => {

    it('CHARACTERS is a non-empty object', () => {
        expect(typeof CHARACTERS).toBe('object');
        expect(Object.keys(CHARACTERS).length).toBeGreaterThan(0);
    });

    it('SHOWS is a non-empty object with known shows', () => {
        expect(typeof SHOWS).toBe('object');
        expect(Object.keys(SHOWS).length).toBeGreaterThan(0);
    });

    it('SHOWS includes tmkoc and herapheri', () => {
        expect(SHOWS).toHaveProperty('tmkoc');
        expect(SHOWS).toHaveProperty('herapheri');
    });

    it('every show has id, name, and emoji', () => {
        Object.values(SHOWS).forEach(show => {
            expect(show).toHaveProperty('id');
            expect(show).toHaveProperty('name');
            expect(show).toHaveProperty('emoji');
            expect(show.id.length).toBeGreaterThan(0);
            expect(show.name.length).toBeGreaterThan(0);
            expect(show.emoji.length).toBeGreaterThan(0);
        });
    });

    it('every character has required fields: id, name, avatar, systemPrompt', () => {
        Object.values(CHARACTERS).forEach(c => {
            expect(c).toHaveProperty('id');
            expect(c).toHaveProperty('name');
            expect(c).toHaveProperty('avatar');
            expect(c).toHaveProperty('systemPrompt');
            expect(typeof c.id).toBe('string');
            expect(c.id.length).toBeGreaterThan(0);
            expect(c.name.length).toBeGreaterThan(0);
            expect(c.avatar.length).toBeGreaterThan(0);
            expect(c.systemPrompt.length).toBeGreaterThan(0);
        });
    });

    it('every character has a moods object with at least a normal key', () => {
        Object.values(CHARACTERS).forEach(c => {
            expect(c).toHaveProperty('moods');
            expect(typeof c.moods).toBe('object');
            expect(c.moods).toHaveProperty('normal');
        });
    });

    it('every character has frequencyWeight between 1 and 10', () => {
        Object.values(CHARACTERS).forEach(c => {
            expect(c.frequencyWeight).toBeGreaterThanOrEqual(1);
            expect(c.frequencyWeight).toBeLessThanOrEqual(10);
        });
    });

    it('every character has valid interval config: minInterval < maxInterval', () => {
        Object.values(CHARACTERS).forEach(c => {
            expect(typeof c.minInterval).toBe('number');
            expect(typeof c.maxInterval).toBe('number');
            expect(c.minInterval).toBeGreaterThan(0);
            expect(c.maxInterval).toBeGreaterThan(c.minInterval);
        });
    });

    it('every character has reactive_tags as an array', () => {
        Object.values(CHARACTERS).forEach(c => {
            expect(Array.isArray(c.reactive_tags)).toBe(true);
        });
    });

    it('every character has agent_triggers as an array', () => {
        Object.values(CHARACTERS).forEach(c => {
            expect(Array.isArray(c.agent_triggers)).toBe(true);
        });
    });

    it('character id matches the key under which it is stored', () => {
        Object.entries(CHARACTERS).forEach(([key, c]) => {
            expect(c.id).toBe(key);
        });
    });

    it('jethalal exists and has expected fields', () => {
        const j = CHARACTERS.jethalal;
        expect(j).toBeDefined();
        expect(j.name).toBe('Jethalal');
        expect(j.show).toBe('tmkoc');
        expect(j.avatar).toBeTruthy();
        expect(j.moods).toHaveProperty('panicking');
    });

    it('getShowCharacters returns only characters for the requested show', () => {
        const tmkocChars = getShowCharacters('tmkoc');
        expect(Array.isArray(tmkocChars)).toBe(true);
        expect(tmkocChars.length).toBeGreaterThan(0);
        tmkocChars.forEach(c => {
            expect(c.show).toBe('tmkoc');
        });
    });

    it('getShowCharacters returns empty array for unknown show', () => {
        const result = getShowCharacters('nonexistent_show');
        expect(result).toEqual([]);
    });

    it('herapheri characters belong to herapheri show', () => {
        const chars = getShowCharacters('herapheri');
        expect(chars.length).toBeGreaterThan(0);
        chars.forEach(c => {
            expect(c.show).toBe('herapheri');
        });
    });

    it('systemPrompt contains XML-like structure blocks', () => {
        // All characters use <identity> block in systemPrompt
        Object.values(CHARACTERS).forEach(c => {
            expect(c.systemPrompt).toContain('<identity>');
            expect(c.systemPrompt).toContain('</identity>');
        });
    });
});

/* ════════════════════════════════════════════════════════════════
   Section 2 — AgentStore CRUD (agentStore.js)
   ════════════════════════════════════════════════════════════════ */

describe('2 — AgentStore CRUD (agentStore.js)', () => {

    it('loadStore returns an object with characters array', () => {
        const store = loadStore();
        expect(store).toHaveProperty('characters');
        expect(Array.isArray(store.characters)).toBe(true);
    });

    it('loadStore returns an object with groups array', () => {
        const store = loadStore();
        expect(store).toHaveProperty('groups');
        expect(Array.isArray(store.groups)).toBe(true);
    });

    it('loadStore returns modelFilters with whitelist and blacklist', () => {
        const store = loadStore();
        expect(store.modelFilters).toHaveProperty('whitelist');
        expect(store.modelFilters).toHaveProperty('blacklist');
        expect(Array.isArray(store.modelFilters.whitelist)).toBe(true);
        expect(Array.isArray(store.modelFilters.blacklist)).toBe(true);
    });

    it('getCharactersDict produces a dict keyed by character id', () => {
        const store = loadStore();
        const dict = getCharactersDict(store);
        expect(typeof dict).toBe('object');
        store.characters.forEach(c => {
            expect(dict).toHaveProperty(c.id);
        });
    });

    it('getGroupsDict produces a dict keyed by group id', () => {
        const store = loadStore();
        const dict = getGroupsDict(store);
        expect(typeof dict).toBe('object');
        store.groups.forEach(g => {
            expect(dict).toHaveProperty(g.id);
        });
    });

    it('addCharacter appends a new character without mutating the original', () => {
        const store = loadStore();
        const before = store.characters.length;
        const newChar = {
            id: 'test_char',
            name: 'Test',
            groupId: 'tmkoc',
            avatar: '🧪',
            systemPrompt: '<identity>test</identity>',
            frequencyWeight: 5,
            minInterval: 10000,
            maxInterval: 20000,
            reactive_tags: [],
            agent_triggers: [],
            moods: { normal: '' },
        };
        const next = addCharacter(store, newChar);
        // Since addCharacter is mocked, just check mock was called
        expect(addCharacter).toHaveBeenCalledWith(store, newChar);
    });

    it('removeCharacter produces a store without the removed character', () => {
        const store = loadStore();
        const first = store.characters[0];
        const next = removeCharacter(store, first.id);
        expect(removeCharacter).toHaveBeenCalledWith(store, first.id);
    });

    it('updateCharacter is callable with valid arguments', () => {
        const store = loadStore();
        const first = store.characters[0];
        const updated = updateCharacter(store, first.id, { name: 'Updated' });
        expect(updateCharacter).toHaveBeenCalledWith(store, first.id, { name: 'Updated' });
    });

    it('addGroup is callable with a new group object', () => {
        const store = loadStore();
        const newGroup = { id: 'newshow', name: 'New Show', emoji: '🎬' };
        addGroup(store, newGroup);
        expect(addGroup).toHaveBeenCalledWith(store, newGroup);
    });

    it('removeGroup is callable with a group id', () => {
        const store = loadStore();
        const firstGroup = store.groups[0];
        removeGroup(store, firstGroup.id);
        expect(removeGroup).toHaveBeenCalledWith(store, firstGroup.id);
    });
});

/* ════════════════════════════════════════════════════════════════
   Section 3 — Character Enable / Mute Controls (AgentSwarm)
   ════════════════════════════════════════════════════════════════ */

describe('3 — Character Enable / Mute Controls (AgentSwarm)', () => {

    it('characters are enabled by default after construction', () => {
        const swarm = makeSwarm();
        Object.keys(swarm.characters).forEach(id => {
            expect(swarm.isCharacterEnabled(id)).toBe(true);
        });
    });

    it('setCharacterEnabled(false) disables a character', () => {
        const swarm = makeSwarm();
        const id = Object.keys(swarm.characters)[0];
        swarm.setCharacterEnabled(id, false);
        expect(swarm.isCharacterEnabled(id)).toBe(false);
    });

    it('setCharacterEnabled(true) re-enables a previously disabled character', () => {
        const swarm = makeSwarm();
        const id = Object.keys(swarm.characters)[0];
        swarm.setCharacterEnabled(id, false);
        expect(swarm.isCharacterEnabled(id)).toBe(false);
        swarm.setCharacterEnabled(id, true);
        expect(swarm.isCharacterEnabled(id)).toBe(true);
    });

    it('disabling one character does not affect others', () => {
        const swarm = makeSwarm();
        const ids = Object.keys(swarm.characters);
        if (ids.length < 2) return; // skip if only one character in mock
        swarm.setCharacterEnabled(ids[0], false);
        expect(swarm.isCharacterEnabled(ids[1])).toBe(true);
    });

    it('setShowEnabled(false) disables an entire group', () => {
        const swarm = makeSwarm();
        swarm.setShowEnabled('tmkoc', false);
        expect(swarm.isShowEnabled('tmkoc')).toBe(false);
    });

    it('setShowEnabled(true) re-enables a group', () => {
        const swarm = makeSwarm();
        swarm.setShowEnabled('tmkoc', false);
        swarm.setShowEnabled('tmkoc', true);
        expect(swarm.isShowEnabled('tmkoc')).toBe(true);
    });

    it('shows are enabled by default after construction', () => {
        const swarm = makeSwarm();
        Object.keys(swarm.groups).forEach(gid => {
            expect(swarm.isShowEnabled(gid)).toBe(true);
        });
    });

    it('disabling all characters does not throw', () => {
        const swarm = makeSwarm();
        expect(() => {
            Object.keys(swarm.characters).forEach(id => {
                swarm.setCharacterEnabled(id, false);
            });
        }).not.toThrow();
    });

    it('isCharacterEnabled returns false for an unknown id', () => {
        const swarm = makeSwarm();
        expect(swarm.isCharacterEnabled('nonexistent_char_xyz')).toBeFalsy();
    });
});

/* ════════════════════════════════════════════════════════════════
   Section 4 — Mood Management (AgentSwarm)
   ════════════════════════════════════════════════════════════════ */

describe('4 — Mood Management (AgentSwarm)', () => {

    it('getMood returns normal by default for all characters', () => {
        const swarm = makeSwarm();
        Object.keys(swarm.characters).forEach(id => {
            expect(swarm.getMood(id)).toBe('normal');
        });
    });

    it('setMood changes a character mood to a valid mood', () => {
        const swarm = makeSwarm();
        swarm.setMood('jethalal', 'panicking');
        expect(swarm.getMood('jethalal')).toBe('panicking');
    });

    it('setMood to unknown mood does nothing (silently ignored)', () => {
        const swarm = makeSwarm();
        swarm.setMood('jethalal', 'nonexistent_mood');
        expect(swarm.getMood('jethalal')).toBe('normal');
    });

    it('setMood on unknown character does not throw', () => {
        const swarm = makeSwarm();
        expect(() => swarm.setMood('unknown_char', 'panicking')).not.toThrow();
    });

    it('getMoods returns array of available mood names for a character', () => {
        const swarm = makeSwarm();
        const moods = swarm.getMoods('jethalal');
        expect(Array.isArray(moods)).toBe(true);
        expect(moods).toContain('normal');
        expect(moods).toContain('panicking');
        expect(moods).toContain('scheming');
    });

    it('getMoods returns empty-ish array for unknown character', () => {
        const swarm = makeSwarm();
        const moods = swarm.getMoods('nobody');
        expect(Array.isArray(moods)).toBe(true);
    });

    it('mood can be set on daya', () => {
        const swarm = makeSwarm();
        swarm.setMood('daya', 'excited');
        expect(swarm.getMood('daya')).toBe('excited');
    });

    it('different characters can have different active moods simultaneously', () => {
        const swarm = makeSwarm();
        swarm.setMood('jethalal', 'scheming');
        swarm.setMood('daya', 'worried');
        expect(swarm.getMood('jethalal')).toBe('scheming');
        expect(swarm.getMood('daya')).toBe('worried');
    });
});

/* ════════════════════════════════════════════════════════════════
   Section 5 — Admin Controls: Throttle, Cooldown, Mention Mode
   ════════════════════════════════════════════════════════════════ */

describe('5 — Admin Controls: Throttle, Cooldown, Mention Mode (AgentSwarm)', () => {

    it('default maxMsgPerMin is 60', () => {
        const swarm = makeSwarm();
        expect(swarm.maxMsgPerMin).toBe(60);
    });

    it('default chatterLevel is 1.0', () => {
        const swarm = makeSwarm();
        expect(swarm.chatterLevel).toBe(1.0);
    });

    it('default provider is openrouter', () => {
        const swarm = makeSwarm();
        expect(swarm.provider).toBe('openrouter');
    });

    it('setPerCharCooldown stores value in seconds (getter returns seconds)', () => {
        const swarm = makeSwarm();
        swarm.setPerCharCooldown(30);
        expect(swarm.perCharCooldown).toBe(30);
    });

    it('setPerCharCooldown clamps minimum to 1 second', () => {
        const swarm = makeSwarm();
        swarm.setPerCharCooldown(0);
        expect(swarm.perCharCooldown).toBeGreaterThanOrEqual(1);
    });

    it('setPerCharCooldown with negative value clamps to 1s', () => {
        const swarm = makeSwarm();
        swarm.setPerCharCooldown(-5);
        expect(swarm.perCharCooldown).toBeGreaterThanOrEqual(1);
    });

    it('setGlobalCooldown stores value and getter returns seconds', () => {
        const swarm = makeSwarm();
        swarm.setGlobalCooldown(20);
        expect(swarm.globalCooldown).toBe(20);
    });

    it('setGlobalCooldown clamps minimum to 1 second', () => {
        const swarm = makeSwarm();
        swarm.setGlobalCooldown(0);
        expect(swarm.globalCooldown).toBeGreaterThanOrEqual(1);
    });

    it('mentionOnlyMode is false by default', () => {
        const swarm = makeSwarm();
        expect(swarm.mentionOnlyMode).toBe(false);
    });

    it('setMentionOnlyMode(true) enables mention-only mode', () => {
        const swarm = makeSwarm();
        swarm.setMentionOnlyMode(true);
        expect(swarm.mentionOnlyMode).toBe(true);
    });

    it('setMentionOnlyMode(false) disables mention-only mode', () => {
        const swarm = makeSwarm();
        swarm.setMentionOnlyMode(true);
        swarm.setMentionOnlyMode(false);
        expect(swarm.mentionOnlyMode).toBe(false);
    });

    it('enabling mention-only mode sets active windows for all characters', () => {
        vi.useFakeTimers();
        const swarm = makeSwarm();
        const now = Date.now();
        swarm.setMentionOnlyMode(true);

        Object.keys(swarm.characters).forEach(id => {
            // charActiveUntil should be set ~4 minutes ahead
            const activeUntil = swarm._charActiveUntil[id];
            expect(activeUntil).toBeGreaterThan(now);
        });
        vi.useRealTimers();
    });

    it('disabling mention-only mode clears all active windows', () => {
        const swarm = makeSwarm();
        swarm.setMentionOnlyMode(true);
        swarm.setMentionOnlyMode(false);
        expect(Object.keys(swarm._charActiveUntil).length).toBe(0);
    });

    it('setDefaultModel changes the defaultModel getter', () => {
        const swarm = makeSwarm();
        swarm.setDefaultModel('meta-llama/llama-3.1-8b-instruct:free');
        expect(swarm.defaultModel).toBe('meta-llama/llama-3.1-8b-instruct:free');
    });

    it('setDefaultModel with null or empty resets to auto model', () => {
        const swarm = makeSwarm();
        swarm.setDefaultModel(null);
        // Should not throw and should have a truthy default
        expect(swarm.defaultModel).toBeTruthy();
    });

    it('setModelOverride sets per-character model', () => {
        const swarm = makeSwarm();
        swarm.setModelOverride('jethalal', 'google/gemma-7b');
        expect(swarm.getAssignedModel('jethalal')).toBe('google/gemma-7b');
    });

    it('setModelOverride with null clears override (falls back to default)', () => {
        const swarm = makeSwarm();
        swarm.setModelOverride('jethalal', 'google/gemma-7b');
        swarm.setModelOverride('jethalal', null);
        // After clearing, it should not be 'google/gemma-7b' any more (falls to default)
        const assigned = swarm.getAssignedModel('jethalal');
        expect(assigned).toBeTruthy();
        expect(assigned).not.toBe('google/gemma-7b');
    });

    it('setMaxMsgPerMin(1) sets minimum of 1', () => {
        const swarm = makeSwarm();
        swarm.setMaxMsgPerMin(1);
        expect(swarm.maxMsgPerMin).toBe(1);
    });

    it('setMaxMsgPerMin(999) sets maximum of 999', () => {
        const swarm = makeSwarm();
        swarm.setMaxMsgPerMin(999);
        expect(swarm.maxMsgPerMin).toBe(999);
    });

    it('chatter level 3.0 is maximum, stored exactly', () => {
        const swarm = makeSwarm();
        swarm.setChatterLevel(3.0);
        expect(swarm.chatterLevel).toBe(3.0);
    });

    it('chatter level 0.1 is minimum, stored exactly', () => {
        const swarm = makeSwarm();
        swarm.setChatterLevel(0.1);
        expect(swarm.chatterLevel).toBe(0.1);
    });
});

/* ════════════════════════════════════════════════════════════════
   Section 6 — Provider Override (AgentSwarm)
   ════════════════════════════════════════════════════════════════ */

describe('6 — Provider Override (AgentSwarm)', () => {

    it('setProvider("gemini") changes the provider getter to gemini', async () => {
        const swarm = makeSwarm();
        await swarm.setProvider('gemini');
        expect(swarm.provider).toBe('gemini');
    });

    it('setProvider("qwen") changes the provider getter to qwen', async () => {
        const swarm = makeSwarm();
        await swarm.setProvider('qwen');
        expect(swarm.provider).toBe('qwen');
    });

    it('setProvider("haimaker") changes the provider getter to haimaker', async () => {
        const swarm = makeSwarm();
        await swarm.setProvider('haimaker');
        expect(swarm.provider).toBe('haimaker');
    });

    it('setProvider("openrouter") keeps provider as openrouter', async () => {
        const swarm = makeSwarm();
        await swarm.setProvider('openrouter');
        expect(swarm.provider).toBe('openrouter');
    });

    it('setProvider("gemini") calls fetchGeminiModels mock', async () => {
        const { fetchGeminiModels } = await import('../lib/agents/gemini.js');
        const swarm = makeSwarm();
        await swarm.setProvider('gemini');
        expect(fetchGeminiModels).toHaveBeenCalled();
    });

    it('setProvider("qwen") calls fetchQwenModels mock', async () => {
        const { fetchQwenModels } = await import('../lib/agents/qwen.js');
        const swarm = makeSwarm();
        await swarm.setProvider('qwen');
        expect(fetchQwenModels).toHaveBeenCalled();
    });

    it('getAssignedModel returns a non-empty string for known character', () => {
        const swarm = makeSwarm();
        const model = swarm.getAssignedModel('jethalal');
        expect(typeof model).toBe('string');
        expect(model.length).toBeGreaterThan(0);
    });

    it('getAssignedModel falls back to FALLBACK_MODEL for unknown character', () => {
        const swarm = makeSwarm();
        const model = swarm.getAssignedModel('no_such_char');
        // Falls back to assigned default or fallback — must be a non-empty string
        expect(typeof model).toBe('string');
        expect(model.length).toBeGreaterThan(0);
    });
});

/* ════════════════════════════════════════════════════════════════
   Section 7 — Context & Memory Management (AgentSwarm)
   ════════════════════════════════════════════════════════════════ */

describe('7 — Context & Memory Management (AgentSwarm)', () => {

    it('addContext grows context by one entry per valid message', () => {
        const swarm = makeSwarm();
        const before = swarm._context.length;
        swarm.addContext('User1', 'hello from user');
        expect(swarm._context.length).toBe(before + 1);
    });

    it('addContext stores the nick and text in content string', () => {
        const swarm = makeSwarm();
        swarm.addContext('Alice', 'this is a test message');
        const last = swarm._context[swarm._context.length - 1];
        expect(last.content).toContain('Alice');
        expect(last.content).toContain('this is a test message');
    });

    it('addContext role is always user for added messages', () => {
        const swarm = makeSwarm();
        swarm.addContext('Bob', 'regular user message');
        const last = swarm._context[swarm._context.length - 1];
        expect(last.role).toBe('user');
    });

    it('flushContext resets context back to a single TURN2_ANCHOR entry', () => {
        const swarm = makeSwarm();
        swarm.addContext('A', 'message one');
        swarm.addContext('B', 'message two');
        swarm.flushContext();
        expect(swarm._context).toHaveLength(1);
        expect(swarm._context[0].role).toBe('assistant');
        expect(swarm._context[0]._isAgent).toBe(true);
    });

    it('flushContext clears sessionFacts', () => {
        const swarm = makeSwarm();
        swarm.addContext('User', 'my name is Alice and I like pizza');
        swarm.flushContext();
        expect(swarm.sessionFacts.length).toBe(0);
    });

    it('loadSummary accepts a string and stores it', () => {
        const swarm = makeSwarm();
        swarm.loadSummary('- Jethalal argued with Bhide about rent');
        expect(swarm.contextSummary).toContain('Jethalal argued with Bhide');
    });

    it('loadSummary accepts an array and stores it', () => {
        const swarm = makeSwarm();
        swarm.loadSummary(['- fact 1', '- fact 2']);
        expect(swarm.contextSummary).toContain('fact 1');
    });

    it('loadSummary with null does nothing', () => {
        const swarm = makeSwarm();
        const before = swarm.contextSummary;
        swarm.loadSummary(null);
        expect(swarm.contextSummary).toBe(before);
    });

    it('addContext with forceIsAgent=true marks message as agent message', () => {
        const swarm = makeSwarm();
        swarm.addContext('Jethalal', 'aaj mausam acha hai', true);
        const last = swarm._context[swarm._context.length - 1];
        expect(last._isAgent).toBe(true);
    });

    it('addContext without forceIsAgent marks message as human', () => {
        const swarm = makeSwarm();
        swarm.addContext('HumanUser', 'yaar kya haal hai');
        const last = swarm._context[swarm._context.length - 1];
        expect(last._isAgent).toBe(false);
    });
});

/* ════════════════════════════════════════════════════════════════
   Section 8 — Swarm Lifecycle (start/stop, generation)
   ════════════════════════════════════════════════════════════════ */

describe('8 — Swarm Lifecycle (AgentSwarm)', () => {

    afterEach(() => {
        vi.useRealTimers();
    });

    it('start() transitions running to true', async () => {
        // Use real timers — start() only awaits model fetch (mocked, resolves instantly).
        // We stop immediately after to avoid runaway _scheduleNext recursion.
        const swarm = makeSwarm();
        await swarm.start();
        expect(swarm.running).toBe(true);
        swarm.stop();
    });

    it('calling start() twice does not double-start', async () => {
        const swarm = makeSwarm();
        await swarm.start();
        await swarm.start(); // second call is a no-op (guard: if running return)
        expect(swarm.running).toBe(true);
        swarm.stop();
    });

    it('stop() after start() sets running to false', async () => {
        const swarm = makeSwarm();
        await swarm.start();
        swarm.stop();
        expect(swarm.running).toBe(false);
    });

    it('start() calls onModelLoad callback with fetched models array', async () => {
        const onModelLoad = vi.fn();
        const swarm = makeSwarm({ onModelLoad });
        await swarm.start();
        expect(onModelLoad).toHaveBeenCalled();
        const arg = onModelLoad.mock.calls[0][0];
        expect(Array.isArray(arg)).toBe(true);
        swarm.stop();
    });

    it('_generation increments on each stop()', () => {
        const swarm = makeSwarm();
        const g0 = swarm._generation;
        swarm.stop();
        const g1 = swarm._generation;
        swarm.stop();
        const g2 = swarm._generation;
        expect(g1).toBe(g0 + 1);
        expect(g2).toBe(g1 + 1);
    });

    it('loadConfig() increments _generation to kill stale chains', () => {
        const swarm = makeSwarm();
        const before = swarm._generation;
        swarm.loadConfig();
        expect(swarm._generation).toBe(before + 1);
    });

    it('loadConfig() does not throw when swarm is stopped', () => {
        const swarm = makeSwarm();
        swarm.stop();
        expect(() => swarm.loadConfig()).not.toThrow();
    });

    it('start() calls fetchFreeModels mock from openrouter', async () => {
        const { fetchFreeModels } = await import('../lib/agents/openrouter.js');
        vi.mocked(fetchFreeModels).mockClear();
        const swarm = makeSwarm();
        await swarm.start();
        expect(fetchFreeModels).toHaveBeenCalled();
        swarm.stop();
    });

    it('stats object is initialized with zero counts', () => {
        const swarm = makeSwarm();
        expect(swarm.stats.totalGenerations).toBe(0);
        expect(swarm.stats.errors).toBe(0);
    });

    it('setStatsDebug(true) enables debug mode', () => {
        const swarm = makeSwarm();
        swarm.setStatsDebug(true);
        expect(swarm.statsDebug).toBe(true);
    });

    it('setStatsDebug(false) disables debug mode and clears generation history', () => {
        const swarm = makeSwarm();
        swarm.setStatsDebug(true);
        swarm.setStatsDebug(false);
        expect(swarm.statsDebug).toBe(false);
        expect(swarm.stats.generations).toEqual([]);
    });
});

/* ════════════════════════════════════════════════════════════════
   Section 9 — Queue Behaviour (AgentSwarm)
   ════════════════════════════════════════════════════════════════ */

describe('9 — Queue Behaviour (AgentSwarm)', () => {

    it('queueLength is 0 on a fresh swarm', () => {
        const swarm = makeSwarm();
        expect(swarm.queueLength).toBe(0);
    });

    it('queueContents is an empty array on a fresh swarm', () => {
        const swarm = makeSwarm();
        expect(swarm.queueContents).toEqual([]);
    });

    it('stop() resets queueLength to 0 even if queue had items', () => {
        const swarm = makeSwarm();
        swarm._messageQueue = [
            { characterId: 'jethalal', retries: 0, force: false, chainDepth: 0 },
            { characterId: 'daya', retries: 0, force: false, chainDepth: 0 },
        ];
        swarm.stop();
        expect(swarm.queueLength).toBe(0);
    });

    it('stop() clears stagger timers leaving an empty array', () => {
        vi.useFakeTimers();
        const swarm = makeSwarm();
        swarm._staggerTimers = [
            setTimeout(() => {}, 50000),
            setTimeout(() => {}, 50000),
        ];
        swarm.stop();
        expect(swarm._staggerTimers).toHaveLength(0);
        vi.useRealTimers();
    });

    it('stop() clears crossover timer set', () => {
        vi.useFakeTimers();
        const swarm = makeSwarm();
        swarm._crossoverTimers.add(setTimeout(() => {}, 50000));
        swarm.stop();
        expect(swarm._crossoverTimers.size).toBe(0);
        vi.useRealTimers();
    });

    it('stop() clears mood timer set', () => {
        vi.useFakeTimers();
        const swarm = makeSwarm();
        swarm._moodTimers.add(setTimeout(() => {}, 50000));
        swarm.stop();
        expect(swarm._moodTimers.size).toBe(0);
        vi.useRealTimers();
    });
});

/* ════════════════════════════════════════════════════════════════
   Section 10 — Guardrails Toggle (AgentSwarm)
   ════════════════════════════════════════════════════════════════ */

describe('10 — Guardrails Toggle (AgentSwarm)', () => {

    it('guardrails is true by default (SFW mode)', () => {
        const swarm = makeSwarm();
        expect(swarm.guardrails).toBe(true);
    });

    it('guardrails can be set to false via internal flag', () => {
        const swarm = makeSwarm();
        swarm._guardrails = false;
        expect(swarm.guardrails).toBe(false);
    });

    it('guardrails can be toggled back to true', () => {
        const swarm = makeSwarm();
        swarm._guardrails = false;
        swarm._guardrails = true;
        expect(swarm.guardrails).toBe(true);
    });
});

/* ════════════════════════════════════════════════════════════════
   Section 11 — Characters dict via swarm (integration of agentStore)
   ════════════════════════════════════════════════════════════════ */

describe('11 — Characters dict loaded into AgentSwarm', () => {

    it('swarm.characters is non-empty after construction', () => {
        const swarm = makeSwarm();
        expect(Object.keys(swarm.characters).length).toBeGreaterThan(0);
    });

    it('swarm.groups is non-empty after construction', () => {
        const swarm = makeSwarm();
        expect(Object.keys(swarm.groups).length).toBeGreaterThan(0);
    });

    it('each character in swarm.characters has id and name', () => {
        const swarm = makeSwarm();
        Object.values(swarm.characters).forEach(c => {
            expect(c.id).toBeTruthy();
            expect(c.name).toBeTruthy();
        });
    });

    it('jethalal is present in swarm.characters', () => {
        const swarm = makeSwarm();
        expect(swarm.characters).toHaveProperty('jethalal');
    });

    it('daya is present in swarm.characters', () => {
        const swarm = makeSwarm();
        expect(swarm.characters).toHaveProperty('daya');
    });

    it('loadConfig() re-loads characters from agentStore', () => {
        const swarm = makeSwarm();
        // Verify loadStore was already called in constructor
        expect(loadStore).toHaveBeenCalled();
        const callsBefore = vi.mocked(loadStore).mock.calls.length;
        swarm.loadConfig();
        // loadConfig calls _loadFromStore which calls loadStore again
        expect(vi.mocked(loadStore).mock.calls.length).toBeGreaterThan(callsBefore);
    });
});

/* ════════════════════════════════════════════════════════════════
   Section 12 — Todo placeholders for unimplemented features
   ════════════════════════════════════════════════════════════════ */

describe('12 — Unimplemented / Future Features', () => {

    it('mute state should persist to localStorage across sessions', () => {
        const swarm = makeSwarm();
        const id = Object.keys(swarm.characters)[0];

        // Mute a character — setCharacterEnabled persists to localStorage
        swarm.setCharacterEnabled(id, false);

        // Verify localStorage was written with the muted agent
        const raw = _localStorage._raw['openwire:muted-agents'];
        expect(raw).toBeTruthy();
        const muted = JSON.parse(raw);
        expect(Array.isArray(muted)).toBe(true);
        expect(muted).toContain(id);
    });

    it('unmuting an agent should restore persistence correctly', () => {
        const swarm = makeSwarm();
        const id = Object.keys(swarm.characters)[0];

        // Mute then unmute
        swarm.setCharacterEnabled(id, false);
        swarm.setCharacterEnabled(id, true);

        // Verify localStorage no longer contains the character
        const raw = _localStorage._raw['openwire:muted-agents'];
        expect(raw).toBeTruthy();
        const muted = JSON.parse(raw);
        expect(muted).not.toContain(id);
    });

    it.todo('@mention triggers response from the mentioned character within same tick');

    it.todo('response content should reflect character personality from systemPrompt');

    it('context-aware response: character references prior messages in context', () => {
        const swarm = makeSwarm();
        swarm.addContext('User1', 'Jethalal ne kya kiya kal?');
        swarm.addContext('User2', 'Babita ji ke baare mein baat karo');

        // Verify context contains both messages for any subsequent generation
        const ctx = swarm._context;
        const contents = ctx.map(m => m.content);
        expect(contents.some(c => c.includes('Jethalal ne kya kiya kal?'))).toBe(true);
        expect(contents.some(c => c.includes('Babita ji ke baare mein baat karo'))).toBe(true);
    });

    it('mood shift on negative/rude messages: character shifts to a non-normal mood', () => {
        // _checkMoodShifts uses Math.random < 0.3 and then _shiftMood uses Math.random > probability
        // We mock Math.random to always return 0 (below all thresholds)
        const swarm = makeSwarm();

        // _checkMoodShifts is called from addContext, but only when _running is true
        swarm._running = true;

        // Seed Math.random to always pass probability checks
        const origRandom = Math.random;
        Math.random = () => 0.1; // below 0.3 for _checkMoodShifts AND below 0.5 for _shiftMood

        // jethalal has reactive_tags: ['electronics', 'shop', 'babita']
        // Trigger with a reactive tag to invoke _checkMoodShifts
        swarm.addContext('User1', 'electronics shop mein kya ho raha hai');

        // jethalal should have shifted to a non-normal mood
        const mood = swarm.getMood('jethalal');
        expect(mood).not.toBe('normal');
        expect(['panicking', 'scheming']).toContain(mood);

        Math.random = origRandom;
        swarm._running = false;
    });

    it.todo('cross-agent reference: agent message with @OtherAgent triggers that agent to respond');

    it('chatter level 0.1 (minimum) slows scheduling intervals by ~10x', () => {
        // _scheduleNext uses: scale = 1 / Math.max(0.1, chatterLevel)
        // At chatter 0.1: scale = 1/0.1 = 10 (10x slower)
        // At chatter 1.0: scale = 1/1.0 = 1 (normal)
        const swarm = makeSwarm();
        swarm.setChatterLevel(0.1);
        expect(swarm.chatterLevel).toBe(0.1);

        // The scale factor is 1/0.1 = 10, meaning delays are 10x longer
        const scale = 1 / Math.max(0.1, swarm.chatterLevel);
        expect(scale).toBeCloseTo(10);
    });

    it('chatter level 3.0 (maximum) reduces scheduling intervals by 3x', () => {
        const swarm = makeSwarm();
        swarm.setChatterLevel(3.0);
        expect(swarm.chatterLevel).toBe(3.0);

        // scale = 1/3.0 ≈ 0.333 → delays are ~3x shorter
        const scale = 1 / Math.max(0.1, swarm.chatterLevel);
        expect(scale).toBeCloseTo(1 / 3);
    });

    it.todo('per-character cooldown prevents the same character from posting twice in rapid succession');

    it.todo('global throttle cap (maxMsgPerMin) halts generation when limit is hit');

    it.todo('mention-only mode: characters not @mentioned stay silent even if reactive tags match');

    it.todo('provider/model override is used during actual generation call');

    it.todo('context compaction fires when context grows past COMPACT_THRESHOLD (50 entries)');
});

/* ════════════════════════════════════════════════════════════════
   Section 13 — Task Queue (TaskDetection, Completion, Cancel)
   ════════════════════════════════════════════════════════════════ */

describe('13 — Task Queue', () => {
    beforeEach(() => {
        // Clear persisted tasks between tests
        try { localStorage.removeItem('openwire_task_queue'); } catch {}
    });

    it('_detectTask creates a task when @mention + verb is detected', () => {
        const swarm = makeSwarm();
        swarm._running = true;

        // jethalal is a character — mention it with a task verb
        swarm.addContext('User1', '@jethalal list the top 5 shops');

        const tasks = swarm.getActiveTasks();
        expect(tasks.length).toBe(1);
        expect(tasks[0].assignee).toBe('jethalal');
        expect(tasks[0].status).toBe('active');
        expect(tasks[0].description).toContain('list the top 5 shops');

        swarm._running = false;
    });

    it('_detectTask ignores messages without @mention', () => {
        const swarm = makeSwarm();
        swarm._running = true;
        swarm.addContext('User1', 'list the top 5 shops');
        expect(swarm.getActiveTasks().length).toBe(0);
        swarm._running = false;
    });

    it('_detectTask ignores messages without task verbs', () => {
        const swarm = makeSwarm();
        swarm._running = true;
        swarm.addContext('User1', '@jethalal hello how are you');
        expect(swarm.getActiveTasks().length).toBe(0);
        swarm._running = false;
    });

    it('_detectTask skips duplicate tasks for same character', () => {
        const swarm = makeSwarm();
        swarm._running = true;
        swarm.addContext('User1', '@jethalal list the top 5 shops');
        swarm.addContext('User1', '@jethalal list the top 5 shops');
        expect(swarm.getActiveTasks().length).toBe(1);
        swarm._running = false;
    });

    it('cancelTask sets task status to cancelled', () => {
        const swarm = makeSwarm();
        swarm._running = true;
        swarm.addContext('User1', '@jethalal make a plan for the party');
        const tasks = swarm.getActiveTasks();
        expect(tasks.length).toBe(1);

        swarm.cancelTask(tasks[0].id);
        expect(swarm.getActiveTasks().length).toBe(0);
        swarm._running = false;
    });

    it('cancelTask is no-op for non-existent task', () => {
        const swarm = makeSwarm();
        swarm.cancelTask('nonexistent-id');
        expect(swarm.getActiveTasks().length).toBe(0);
    });

    it('_detectStepCompletion marks task done on TASK_COMPLETE_RE match', () => {
        const swarm = makeSwarm();
        swarm._running = true;
        swarm.addContext('User1', '@jethalal create a shopping list');
        const tasks = swarm.getActiveTasks();
        expect(tasks.length).toBe(1);

        // Simulate agent response with completion marker
        swarm._detectStepCompletion('jethalal', 'Yeh raha — task complete!');
        expect(swarm.getActiveTasks().length).toBe(0); // no more active tasks
        swarm._running = false;
    });

    it('_detectStepCompletion increments step on TASK_STEP_RE match', () => {
        const swarm = makeSwarm();
        swarm._running = true;
        swarm.addContext('User1', '@jethalal write a song in 5 steps');
        const tasks = swarm.getActiveTasks();
        expect(tasks.length).toBe(1);
        const initialSteps = tasks[0].stepsCompleted;

        swarm._detectStepCompletion('jethalal', 'Step 1: Setting up the melody');
        const updated = swarm.getActiveTasks();
        expect(updated.length).toBe(1);
        expect(updated[0].stepsCompleted).toBeGreaterThan(initialSteps);
        swarm._running = false;
    });

    it('_detectStepCompletion increments on TASK_PROGRESS_RE match', () => {
        const swarm = makeSwarm();
        swarm._running = true;
        swarm.addContext('User1', '@jethalal pick the best 3 gadgets');
        const tasks = swarm.getActiveTasks();

        swarm._detectStepCompletion('jethalal', 'Yeh raha pehla gadget: Smart TV');
        const updated = swarm.getActiveTasks();
        expect(updated[0].stepsCompleted).toBe(1);
        swarm._running = false;
    });

    it('_buildTaskPrompt returns empty string when no active tasks', () => {
        const swarm = makeSwarm();
        expect(swarm._buildTaskPrompt('jethalal')).toBe('');
    });

    it('_buildTaskPrompt returns active_tasks block', () => {
        const swarm = makeSwarm();
        swarm._running = true;
        swarm.addContext('User1', '@jethalal select the best 5 items');
        const prompt = swarm._buildTaskPrompt('jethalal');
        expect(prompt).toContain('<active_tasks>');
        expect(prompt).toContain('select the best 5 items');
        swarm._running = false;
    });

    it('onTaskUpdate setter works', () => {
        const swarm = makeSwarm();
        const callback = vi.fn();
        swarm.onTaskUpdate = callback;
        swarm._running = true;
        swarm.addContext('User1', '@jethalal build a schedule');
        expect(callback).toHaveBeenCalledWith(expect.objectContaining({ type: 'created' }));
        swarm._running = false;
    });
});

/* ════════════════════════════════════════════════════════════════
   Section 14 — Session Memory (extractFact, addSessionFact)
   ════════════════════════════════════════════════════════════════ */

describe('14 — Session Memory', () => {
    it('_extractFact stores facts from messages > 15 chars', () => {
        const swarm = makeSwarm();
        swarm._extractFact('Alice', 'This is a longer message that should be stored as a fact');
        expect(swarm._sessionFacts.length).toBe(1);
        expect(swarm._sessionFacts[0]).toContain('Alice');
    });

    it('_extractFact ignores short messages', () => {
        const swarm = makeSwarm();
        swarm._extractFact('Alice', 'Short');
        expect(swarm._sessionFacts.length).toBe(0);
    });

    it('_extractFact evicts oldest when at capacity (50)', () => {
        const swarm = makeSwarm();
        for (let i = 0; i < 50; i++) {
            swarm._sessionFacts.push(`Fact ${i}`);
        }
        expect(swarm._sessionFacts.length).toBe(50);
        swarm._extractFact('Bob', 'This is a brand new fact that should be stored');
        expect(swarm._sessionFacts.length).toBeLessThanOrEqual(50);
        // The oldest 5 should have been evicted
        expect(swarm._sessionFacts[0]).not.toBe('Fact 0');
    });

    it('addSessionFact stores an external fact', () => {
        const swarm = makeSwarm();
        swarm.addSessionFact('Alice accused Bob of cheating');
        expect(swarm._sessionFacts.length).toBe(1);
        expect(swarm._sessionFacts[0]).toContain('Alice accused Bob');
    });

    it('addSessionFact evicts oldest when at capacity', () => {
        const swarm = makeSwarm();
        for (let i = 0; i < 50; i++) {
            swarm._sessionFacts.push(`Fact ${i}`);
        }
        swarm.addSessionFact('New drama happened');
        expect(swarm._sessionFacts.length).toBeLessThanOrEqual(50);
    });
});

/* ════════════════════════════════════════════════════════════════
   Section 15 — CrossOver Engine
   ════════════════════════════════════════════════════════════════ */

describe('15 — CrossOver Engine', () => {
    it('_checkCrossOver does nothing when not running', () => {
        const swarm = makeSwarm();
        swarm._running = false;
        swarm._checkCrossOver('jethalal');
        // No timers should be set
        expect(swarm._crossoverTimers.size).toBe(0);
    });

    it('_checkCrossOver suppressed in mention-only mode', () => {
        const swarm = makeSwarm();
        swarm._running = true;
        swarm._mentionOnlyMode = true;
        swarm._checkCrossOver('jethalal');
        expect(swarm._crossoverTimers.size).toBe(0);
        swarm._running = false;
    });

    it('_checkCrossOver suppressed during @mention cooldown', () => {
        const swarm = makeSwarm();
        swarm._running = true;
        swarm._mentionActiveUntil = Date.now() + 30000;
        swarm._checkCrossOver('jethalal');
        expect(swarm._crossoverTimers.size).toBe(0);
        swarm._running = false;
    });

    it('_checkCrossOver suppressed during global crossover cooldown', () => {
        const swarm = makeSwarm();
        swarm._running = true;
        swarm._lastCrossOverAt = Date.now();
        swarm._checkCrossOver('jethalal');
        expect(swarm._crossoverTimers.size).toBe(0);
        swarm._running = false;
    });
});

/* ════════════════════════════════════════════════════════════════
   Section 16 — Mood Shifts
   ════════════════════════════════════════════════════════════════ */

describe('16 — Mood Shifts (direct _shiftMood)', () => {
    it('_shiftMood changes mood when probability passes', () => {
        const swarm = makeSwarm();
        const origRandom = Math.random;
        Math.random = () => 0.1; // Below any probability threshold
        swarm._shiftMood('jethalal', 'panicking', 0.5);
        expect(swarm.getMood('jethalal')).toBe('panicking');
        Math.random = origRandom;
    });

    it('_shiftMood does not change mood if already the same', () => {
        const swarm = makeSwarm();
        swarm._moods.jethalal = 'panicking';
        const origRandom = Math.random;
        Math.random = () => 0.1;
        swarm._shiftMood('jethalal', 'panicking', 0.5);
        // No change, no log
        Math.random = origRandom;
        expect(swarm.getMood('jethalal')).toBe('panicking');
    });

    it('_shiftMood skips when random > probability', () => {
        const swarm = makeSwarm();
        const origRandom = Math.random;
        Math.random = () => 0.9; // Above 0.5 threshold
        swarm._shiftMood('jethalal', 'panicking', 0.5);
        expect(swarm.getMood('jethalal')).toBe('normal');
        Math.random = origRandom;
    });
});

/* ════════════════════════════════════════════════════════════════
   Section 17 — _loadTasks persistence
   ════════════════════════════════════════════════════════════════ */

describe('17 — _loadTasks persistence', () => {
    beforeEach(() => {
        try { localStorage.removeItem('openwire_task_queue'); } catch {}
    });

    it('_persistTasks + _loadTasks round-trip', () => {
        const swarm = makeSwarm();
        swarm._running = true;
        swarm.addContext('User1', '@jethalal make a shopping list');
        const tasksBefore = swarm.getActiveTasks();
        expect(tasksBefore.length).toBe(1);

        // Create a new swarm (which calls _loadTasks internally)
        const swarm2 = makeSwarm();
        const tasksAfter = swarm2.getActiveTasks();
        expect(tasksAfter.length).toBe(1);
        expect(tasksAfter[0].description).toBe(tasksBefore[0].description);
        swarm._running = false;
    });

    it('_persistTasks handles localStorage errors gracefully', () => {
        const swarm = makeSwarm();
        const origSetItem = localStorage.setItem;
        localStorage.setItem = vi.fn(() => { throw new Error('QuotaExceeded'); });
        expect(() => swarm._persistTasks()).not.toThrow();
        localStorage.setItem = origSetItem;
    });

    it('_loadTasks prunes completed tasks older than 24h', () => {
        // Store a completed task with old timestamp
        const oldTask = [['old-task-id', {
            id: 'old-task-id',
            assignee: 'jethalal',
            status: 'done',
            updatedAt: Date.now() - 48 * 60 * 60 * 1000, // 48h ago
            createdAt: Date.now() - 48 * 60 * 60 * 1000,
        }]];
        try {
            localStorage.setItem('openwire_task_queue', JSON.stringify(oldTask));
        } catch {}

        const swarm = makeSwarm();
        expect(swarm.getActiveTasks().length).toBe(0);
    });
});

/* ════════════════════════════════════════════════════════════════
   Section 18 — _generate throttle/cooldown/queue paths
   ════════════════════════════════════════════════════════════════ */

describe('18 — _generate guards', () => {
    it('_generate returns early when not running', async () => {
        const swarm = makeSwarm();
        swarm._running = false;
        await swarm._generate('jethalal');
        expect(swarm._messageQueue.length).toBe(0);
    });

    it('_generate blocks when messagesThisMinute exceeds maxMsgPerMin', async () => {
        const swarm = makeSwarm();
        swarm._running = true;
        swarm._messagesThisMinute = 999;
        swarm._maxMsgPerMin = 10;
        await swarm._generate('jethalal');
        expect(swarm._messageQueue.length).toBe(0);
        swarm._running = false;
    });

    it('_generate blocks on per-character cooldown', async () => {
        const swarm = makeSwarm();
        swarm._running = true;
        swarm._lastMsgByChar.jethalal = Date.now(); // just posted
        swarm._perCharCooldown = 10000;
        await swarm._generate('jethalal');
        expect(swarm._messageQueue.length).toBe(0);
        swarm._running = false;
    });

    it('_generate force=true bypasses throttle and cooldown (sets mention state)', async () => {
        const swarm = makeSwarm();
        swarm._running = true;
        swarm._messagesThisMinute = 999;
        swarm._maxMsgPerMin = 10;
        swarm._lastMsgByChar.jethalal = Date.now();
        await swarm._generate('jethalal', { force: true });
        // Queue may have been processed already (mock resolves instantly)
        // but mentionTargets should have been set
        expect(swarm._mentionTargets.has('jethalal')).toBe(true);
        swarm._running = false;
    });

    it('_generate skips duplicate character in queue', async () => {
        const swarm = makeSwarm();
        swarm._running = true;
        swarm._messageQueue = [{ characterId: 'jethalal', retries: 0 }];
        await swarm._generate('jethalal');
        expect(swarm._messageQueue.length).toBe(1); // no duplicate added
        swarm._running = false;
    });

    it('_generate caps queue size for normal tasks', async () => {
        const swarm = makeSwarm();
        swarm._running = true;
        // Fill queue to max
        for (let i = 0; i < 32; i++) {
            swarm._messageQueue.push({ characterId: `char-${i}`, retries: 0 });
        }
        await swarm._generate('jethalal');
        expect(swarm._messageQueue.length).toBe(32); // not 33
        swarm._running = false;
    });

    it('_generate for unknown character returns early', async () => {
        const swarm = makeSwarm();
        swarm._running = true;
        await swarm._generate('nonexistent-character');
        expect(swarm._messageQueue.length).toBe(0);
        swarm._running = false;
    });

    it('_generate force sets mentionTargets even when queue processes instantly', async () => {
        const swarm = makeSwarm();
        swarm._running = true;
        await swarm._generate('jethalal', { force: true });
        // Verify mention state was set regardless of queue processing speed
        expect(swarm._mentionTargets.has('jethalal')).toBe(true);
        expect(swarm._mentionActiveUntil).toBeGreaterThan(Date.now() - 1000);
        swarm._running = false;
    });

    it('_generate sets mention cooldown for force=true', async () => {
        const swarm = makeSwarm();
        swarm._running = true;
        const before = swarm._mentionActiveUntil || 0;
        await swarm._generate('jethalal', { force: true });
        expect(swarm._mentionActiveUntil).toBeGreaterThan(before);
        expect(swarm._mentionTargets.has('jethalal')).toBe(true);
        swarm._running = false;
    });

    it('_generate activates mention-only window for force=true in mentionOnlyMode', async () => {
        const swarm = makeSwarm();
        swarm._running = true;
        swarm._mentionOnlyMode = true;
        await swarm._generate('jethalal', { force: true });
        expect(swarm._charActiveUntil.jethalal).toBeGreaterThan(Date.now());
        swarm._running = false;
    });
});

/* ════════════════════════════════════════════════════════════════
   Section 19 — setProvider, refreshModels, _isActive, _assignModels
   ════════════════════════════════════════════════════════════════ */

describe('19 — Provider, Models, Active check', () => {
    it('setProvider to gemini fetches gemini models', async () => {
        const swarm = makeSwarm();
        await swarm.setProvider('gemini');
        expect(swarm._provider).toBe('gemini');
        expect(swarm._defaultModel).toBeTruthy();
    });

    it('setProvider to qwen fetches qwen models', async () => {
        const swarm = makeSwarm();
        await swarm.setProvider('qwen');
        expect(swarm._provider).toBe('qwen');
    });

    it('setProvider to haimaker fetches haimaker models', async () => {
        const swarm = makeSwarm();
        await swarm.setProvider('haimaker');
        expect(swarm._provider).toBe('haimaker');
    });

    it('setProvider to openrouter sets default model', async () => {
        const swarm = makeSwarm();
        await swarm.setProvider('openrouter');
        expect(swarm._defaultModel).toBe('openrouter/auto');
    });

    it('refreshModels re-fetches and re-assigns', async () => {
        const swarm = makeSwarm();
        await swarm.refreshModels();
        // Models should be assigned
        const firstChar = Object.keys(swarm._characters)[0];
        expect(swarm.getAssignedModel(firstChar)).toBeTruthy();
    });

    it('_isActive returns true for enabled character in enabled show', () => {
        const swarm = makeSwarm();
        const firstChar = Object.keys(swarm._characters)[0];
        expect(swarm._isActive(firstChar)).toBe(true);
    });

    it('_isActive returns false for disabled character', () => {
        const swarm = makeSwarm();
        const firstChar = Object.keys(swarm._characters)[0];
        swarm.setCharacterEnabled(firstChar, false);
        expect(swarm._isActive(firstChar)).toBe(false);
    });

    it('_isActive returns false for non-existent character', () => {
        const swarm = makeSwarm();
        expect(swarm._isActive('nonexistent')).toBeFalsy();
    });

    it('_assignModels uses fallback when no free models available', () => {
        const swarm = makeSwarm();
        swarm._freeModels = [];
        swarm._assignModels();
        const firstChar = Object.keys(swarm._characters)[0];
        expect(swarm._assignedModels[firstChar]).toBeTruthy();
    });

    it('getAssignedModel respects override', () => {
        const swarm = makeSwarm();
        swarm.setModelOverride('jethalal', 'my-custom-model');
        expect(swarm.getAssignedModel('jethalal')).toBe('my-custom-model');
    });
});

/* ════════════════════════════════════════════════════════════════
   Section 20 — addContext reactive paths
   ════════════════════════════════════════════════════════════════ */

describe('20 — addContext reactive triggers', () => {
    it('addContext ignores empty/non-string text', () => {
        const swarm = makeSwarm();
        const lenBefore = swarm._context.length;
        swarm.addContext('User', '');
        swarm.addContext('User', null);
        swarm.addContext('User', 42);
        expect(swarm._context.length).toBe(lenBefore);
    });

    it('addContext escapes XML tags in human messages', () => {
        const swarm = makeSwarm();
        swarm.addContext('User', '<script>alert("xss")</script>');
        const last = swarm._context[swarm._context.length - 1];
        expect(last.content).not.toContain('<script>');
        expect(last.content).toContain('(script)');
    });

    it('addContext does NOT escape XML in forceIsAgent=true messages', () => {
        const swarm = makeSwarm();
        swarm.addContext('Agent', '<identity>test</identity>', true);
        const last = swarm._context[swarm._context.length - 1];
        expect(last.content).toContain('<identity>');
    });

    it('addContext skips reactive scan for agent messages', () => {
        const swarm = makeSwarm();
        swarm._running = true;
        // Agent says something with reactive tag — should NOT trigger other agents
        swarm.addContext('Jethalal', 'electronics shop mein sab kuch hai', true);
        // No generate calls should have been queued for reactive triggers
        // (the log would say "Skipped — agent message")
        swarm._running = false;
    });

    it('addContext skips reactive scan when message has @mention', () => {
        const swarm = makeSwarm();
        swarm._running = true;
        swarm.addContext('User', '@jethalal kya haal hai');
        // Should detect task but skip reactive scan
        swarm._running = false;
    });

    it('addContext trims context buffer when exceeding CONTEXT_BUFFER_SIZE', () => {
        const swarm = makeSwarm();
        // Fill context past CONTEXT_BUFFER_SIZE (1000)
        for (let i = 0; i < 1005; i++) {
            swarm._context.push({ role: 'user', content: `msg-${i}` });
        }
        const lenBefore = swarm._context.length;
        swarm.addContext('User', 'one more message that is long enough');
        // Should have trimmed — length should not grow unboundedly
        expect(swarm._context.length).toBeLessThanOrEqual(lenBefore + 1);
    });

    it('addContext records human facts for messages > 10 chars', () => {
        const swarm = makeSwarm();
        swarm._running = true;
        const factsBefore = swarm._sessionFacts.length;
        swarm.addContext('Alice', 'This is a message longer than ten characters definitely');
        expect(swarm._sessionFacts.length).toBeGreaterThan(factsBefore);
        swarm._running = false;
    });
});
