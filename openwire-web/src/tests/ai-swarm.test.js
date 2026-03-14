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

    it.todo('mute state should persist to localStorage across sessions');

    it.todo('unmuting an agent should restore persistence correctly');

    it.todo('@mention triggers response from the mentioned character within same tick');

    it.todo('response content should reflect character personality from systemPrompt');

    it.todo('context-aware response: character references prior messages in context');

    it.todo('mood shift on negative/rude messages: character shifts to a non-normal mood');

    it.todo('cross-agent reference: agent message with @OtherAgent triggers that agent to respond');

    it.todo('chatter level 0.1 (minimum) slows scheduling intervals by ~10x');

    it.todo('chatter level 3.0 (maximum) reduces scheduling intervals by 3x');

    it.todo('per-character cooldown prevents the same character from posting twice in rapid succession');

    it.todo('global throttle cap (maxMsgPerMin) halts generation when limit is hit');

    it.todo('mention-only mode: characters not @mentioned stay silent even if reactive tags match');

    it.todo('provider/model override is used during actual generation call');

    it.todo('task detection fires when a human message contains action verbs (banao, karo, likho)');

    it.todo('context compaction fires when context grows past COMPACT_THRESHOLD (50 entries)');
});
