/**
 * Gap Security Tests
 *
 * Gap 3: Mute state persistence in AgentSwarm (swarm.js)
 * Gap 5: stripDangerousTags XSS sanitization (socket.js)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ════════════════════════════════════════════════════════════════
   localStorage stub — must come before any module import
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

let _localStorage = makeStorageStub();
vi.stubGlobal('localStorage', _localStorage);
vi.stubGlobal('sessionStorage', makeStorageStub());

/* ════════════════════════════════════════════════════════════════
   Module mocks for swarm.js dependencies
   ════════════════════════════════════════════════════════════════ */

vi.mock('../../lib/agents/openrouter.js', () => ({
    fetchFreeModels: vi.fn().mockResolvedValue([]),
    generateMessage: vi.fn().mockResolvedValue('mocked'),
}));
vi.mock('../../lib/agents/gemini.js', () => ({
    fetchGeminiModels: vi.fn().mockResolvedValue([]),
    generateGeminiMessage: vi.fn().mockResolvedValue('mocked'),
}));
vi.mock('../../lib/agents/qwen.js', () => ({
    fetchQwenModels: vi.fn().mockResolvedValue([]),
    generateQwenMessage: vi.fn().mockResolvedValue('mocked'),
}));
vi.mock('../../lib/agents/haimaker.js', () => ({
    fetchHaimakerModels: vi.fn().mockResolvedValue([]),
    generateHaimakerMessage: vi.fn().mockResolvedValue('mocked'),
}));

vi.mock('../../lib/agents/agentStore.js', () => {
    const mockChars = [
        {
            id: 'char1',
            name: 'Char One',
            groupId: 'grp1',
            avatar: '😀',
            systemPrompt: '<identity>Char1</identity>',
            frequencyWeight: 5,
            minInterval: 8000,
            maxInterval: 20000,
            reactive_tags: [],
            agent_triggers: [],
            moods: { normal: '' },
            gender: 'male',
        },
        {
            id: 'char2',
            name: 'Char Two',
            groupId: 'grp1',
            avatar: '😎',
            systemPrompt: '<identity>Char2</identity>',
            frequencyWeight: 5,
            minInterval: 8000,
            maxInterval: 20000,
            reactive_tags: [],
            agent_triggers: [],
            moods: { normal: '' },
            gender: 'female',
        },
    ];
    const mockGroups = [{ id: 'grp1', name: 'Group One', characters: ['char1', 'char2'] }];
    const mockStore = {
        characters: mockChars,
        groups: mockGroups,
        modelFilters: { whitelist: [], blacklist: [] },
        guardrails: true,
    };

    function getCharactersDict(store) {
        return Object.fromEntries((store.characters || []).map(c => [c.id, c]));
    }
    function getGroupsDict(store) {
        return Object.fromEntries((store.groups || []).map(g => [g.id, g]));
    }
    return {
        loadStore: vi.fn(() => mockStore),
        getCharactersDict: vi.fn(getCharactersDict),
        getGroupsDict: vi.fn(getGroupsDict),
    };
});

/* ════════════════════════════════════════════════════════════════
   Imports
   ════════════════════════════════════════════════════════════════ */

import { AgentSwarm } from '../../lib/agents/swarm.js';
import { stripDangerousTags } from '../../lib/socket.js';

const MUTED_KEY = 'openwire:muted-agents';

function makeSwarm() {
    return new AgentSwarm({
        onMessage: vi.fn(),
        onError: vi.fn(),
        onModelLoad: vi.fn(),
        onLog: vi.fn(),
        onTyping: vi.fn(),
    });
}

/* ════════════════════════════════════════════════════════════════
   Gap 5: stripDangerousTags
   ════════════════════════════════════════════════════════════════ */

describe('stripDangerousTags', () => {
    it('removes <script>...</script>', () => {
        const result = stripDangerousTags('hello<script>alert(1)</script>world');
        expect(result).not.toContain('<script>');
        expect(result).not.toContain('alert(1)');
        expect(result).toContain('hello');
        expect(result).toContain('world');
    });

    it('removes <SCRIPT> case-insensitively', () => {
        const result = stripDangerousTags('<SCRIPT>alert(1)</SCRIPT>');
        expect(result).not.toContain('SCRIPT');
        expect(result).not.toContain('alert(1)');
    });

    it('removes onerror event attribute from <img>', () => {
        const result = stripDangerousTags('<img src="x" onerror="alert(1)">');
        expect(result).not.toContain('onerror');
    });

    it('removes onclick but preserves element text content', () => {
        const result = stripDangerousTags('<div onclick="alert(1)">text</div>');
        expect(result).not.toContain('onclick');
        expect(result).toContain('text');
    });

    it('replaces javascript: with nojavascript:', () => {
        const result = stripDangerousTags('javascript:void(0)');
        expect(result).not.toMatch(/\bjavascript\s*:/i);
        expect(result).toContain('nojavascript:');
    });

    it('removes <iframe>...</iframe>', () => {
        const result = stripDangerousTags('<iframe src="evil.com">content</iframe>');
        expect(result).not.toContain('<iframe');
        expect(result).not.toContain('</iframe>');
    });

    it('leaves normal text unchanged', () => {
        expect(stripDangerousTags('hello world')).toBe('hello world');
    });

    it('preserves safe HTML like <b>bold text</b>', () => {
        const input = '<b>bold text</b>';
        const result = stripDangerousTags(input);
        expect(result).toContain('bold text');
        expect(result).toContain('<b>');
    });

    it('returns null as-is without crashing', () => {
        expect(stripDangerousTags(null)).toBe(null);
    });

    it('returns undefined as-is without crashing', () => {
        expect(stripDangerousTags(undefined)).toBe(undefined);
    });
});

/* ════════════════════════════════════════════════════════════════
   Gap 3: Mute state persistence
   ════════════════════════════════════════════════════════════════ */

describe('AgentSwarm mute persistence', () => {
    beforeEach(() => {
        // Reset localStorage stub between tests
        _localStorage = makeStorageStub();
        vi.stubGlobal('localStorage', _localStorage);
    });

    it('setCharacterEnabled(id, false) stores the id in localStorage muted array', () => {
        const swarm = makeSwarm();
        swarm.setCharacterEnabled('char1', false);

        expect(_localStorage.setItem).toHaveBeenCalledWith(MUTED_KEY, expect.any(String));
        const stored = JSON.parse(_localStorage._raw[MUTED_KEY]);
        expect(stored).toContain('char1');
    });

    it('setCharacterEnabled(id, true) removes id from muted array in localStorage', () => {
        const swarm = makeSwarm();
        swarm.setCharacterEnabled('char1', false);
        swarm.setCharacterEnabled('char2', false);
        swarm.setCharacterEnabled('char1', true);

        const stored = JSON.parse(_localStorage._raw[MUTED_KEY]);
        expect(stored).not.toContain('char1');
        expect(stored).toContain('char2');
    });

    it('new AgentSwarm reads muted array from localStorage and marks that character disabled', () => {
        // Pre-populate localStorage with a muted agent
        _localStorage._raw[MUTED_KEY] = JSON.stringify(['char1']);
        _localStorage.getItem.mockImplementation(k => _localStorage._raw[k] ?? null);

        const swarm = makeSwarm();
        expect(swarm.isCharacterEnabled('char1')).toBe(false);
        expect(swarm.isCharacterEnabled('char2')).toBe(true);
    });

    it('new AgentSwarm does not crash with corrupt localStorage JSON', () => {
        _localStorage._raw[MUTED_KEY] = '{not valid json[[[';
        _localStorage.getItem.mockImplementation(k => _localStorage._raw[k] ?? null);

        expect(() => makeSwarm()).not.toThrow();
        const swarm = makeSwarm();
        // Both chars should default to enabled when data is corrupt
        expect(swarm.isCharacterEnabled('char1')).toBe(true);
        expect(swarm.isCharacterEnabled('char2')).toBe(true);
    });

    it('new AgentSwarm starts with all enabled when localStorage key is missing', () => {
        // _localStorage is fresh with no MUTED_KEY set
        const swarm = makeSwarm();
        expect(swarm.isCharacterEnabled('char1')).toBe(true);
        expect(swarm.isCharacterEnabled('char2')).toBe(true);
    });
});
