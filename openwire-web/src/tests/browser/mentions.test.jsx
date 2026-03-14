/**
 * mentions.test.jsx
 *
 * Tests for @mention autocomplete logic extracted from ChatRoom.jsx.
 *
 * Strategy: The mention filtering logic inside ChatRoom is NOT exported as a
 * standalone function; it lives in React state/useMemo/useEffect hooks.
 * We extract the same pure logic inline here and test it directly — the same
 * pattern used in messaging.test.js for addReaction / isVisibleToMe.
 *
 * UI interaction tests (keyboard navigation, click-to-insert, dropdown render)
 * are marked it.todo() because rendering ChatRoom requires mocking 15+ modules.
 */

import { describe, it, expect } from 'vitest';

/* ═══════════════════════════════════════════════════════════════
   Pure logic extracted from ChatRoom.jsx
   ─────────────────────────────────────────────────────────────
   Source: ChatRoom.jsx lines 1514-1538 (allMentionables + filter effect)
   ═══════════════════════════════════════════════════════════════ */

/**
 * Build the sorted list of mentionable names from CHARACTERS (agents) and peers.
 * Mirrors the `allMentionables` useMemo in ChatRoom.jsx.
 */
function buildAllMentionables(characters, peers, myNick) {
    const names = new Map();

    // Agents first
    Object.values(characters).forEach(c => {
        names.set(c.name.toLowerCase(), { display: c.name, avatar: c.avatar, type: 'agent' });
    });

    // Online peers (excluding self)
    peers.forEach(p => {
        if (p.nick && p.nick !== myNick) {
            const key = p.nick.toLowerCase();
            if (!names.has(key)) names.set(key, { display: p.nick, avatar: '👤', type: 'peer' });
        }
    });

    return [...names.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, val]) => ({ key, ...val }));
}

/**
 * Filter mentionables by prefix query.
 * Mirrors the filter logic in the mentionQuery useEffect in ChatRoom.jsx.
 *
 * Returns all mentionables when query is '' (empty), filtered list otherwise.
 */
function getMentionSuggestions(query, allMentionables) {
    if (query === '' || query === null) return allMentionables;
    const q = query.toLowerCase();
    return allMentionables.filter(m => m.key.startsWith(q));
}

/**
 * Determine whether '@' at a given cursor position should trigger the dropdown.
 * Mirrors the handleInputChange logic in ChatRoom.jsx (lines 1542-1563).
 */
function getMentionQuery(inputValue, cursorPos) {
    const textBefore = inputValue.slice(0, cursorPos);
    const atIdx = textBefore.lastIndexOf('@');
    if (atIdx < 0) return null;
    const charBefore = atIdx > 0 ? textBefore[atIdx - 1] : ' ';
    if (charBefore !== ' ' && atIdx !== 0) return null;
    const query = textBefore.slice(atIdx + 1);
    if (/\s/.test(query)) return null; // space in query means we moved past the mention
    return query;
}

/* ═══════════════════════════════════════════════════════════════
   Test fixtures
   ═══════════════════════════════════════════════════════════════ */

const CHARACTERS = {
    'agent-babita': { id: 'agent-babita', name: 'Babita Ji', avatar: '💃' },
    'agent-hathi':  { id: 'agent-hathi',  name: 'Dr. Hathi', avatar: '🐘' },
    'agent-jethu':  { id: 'agent-jethu',  name: 'Jethalal',  avatar: '🧔' },
};

const PEERS = [
    { nick: 'foobar', peer_id: 'p1', online: true },
    { nick: 'FooQux', peer_id: 'p2', online: true },
    { nick: 'Zelda',  peer_id: 'p3', online: true },
];

const MY_NICK = 'Alice';

/* ═══════════════════════════════════════════════════════════════
   1. buildAllMentionables
   ═══════════════════════════════════════════════════════════════ */

describe('buildAllMentionables()', () => {
    it('includes all agent characters', () => {
        const list = buildAllMentionables(CHARACTERS, [], MY_NICK);
        const keys = list.map(m => m.key);
        expect(keys).toContain('babita ji');
        expect(keys).toContain('dr. hathi');
        expect(keys).toContain('jethalal');
    });

    it('includes online peers', () => {
        const list = buildAllMentionables(CHARACTERS, PEERS, MY_NICK);
        const keys = list.map(m => m.key);
        expect(keys).toContain('foobar');
        expect(keys).toContain('fooqux');
        expect(keys).toContain('zelda');
    });

    it('excludes self (myNick) from suggestions', () => {
        const peersWithSelf = [...PEERS, { nick: MY_NICK, peer_id: 'self-id', online: true }];
        const list = buildAllMentionables(CHARACTERS, peersWithSelf, MY_NICK);
        const keys = list.map(m => m.key);
        expect(keys).not.toContain(MY_NICK.toLowerCase());
    });

    it('result is sorted alphabetically by key', () => {
        const list = buildAllMentionables(CHARACTERS, PEERS, MY_NICK);
        const keys = list.map(m => m.key);
        const sorted = [...keys].sort((a, b) => a.localeCompare(b));
        expect(keys).toEqual(sorted);
    });

    it('agent entries carry type "agent"', () => {
        const list = buildAllMentionables(CHARACTERS, [], MY_NICK);
        list.forEach(m => expect(m.type).toBe('agent'));
    });

    it('peer entries carry type "peer"', () => {
        const list = buildAllMentionables({}, PEERS, MY_NICK);
        list.forEach(m => expect(m.type).toBe('peer'));
    });

    it('returns an empty list when no characters and no peers', () => {
        const list = buildAllMentionables({}, [], MY_NICK);
        expect(list).toHaveLength(0);
    });

    it('agent avatar is preserved in the entry', () => {
        const list = buildAllMentionables(CHARACTERS, [], MY_NICK);
        const babita = list.find(m => m.key === 'babita ji');
        expect(babita.avatar).toBe('💃');
    });

    it('peer avatar defaults to 👤', () => {
        const list = buildAllMentionables({}, PEERS, MY_NICK);
        list.forEach(m => expect(m.avatar).toBe('👤'));
    });

    it('duplicate nick between agent and peer: agent key wins (Map keeps first set)', () => {
        const dupChars = { 'agent-z': { id: 'agent-z', name: 'Zelda', avatar: '🧝' } };
        const list = buildAllMentionables(dupChars, PEERS, MY_NICK);
        const zelda = list.find(m => m.key === 'zelda');
        expect(zelda.type).toBe('agent'); // agent was inserted first
    });
});

/* ═══════════════════════════════════════════════════════════════
   2. getMentionSuggestions() — prefix filtering
   ═══════════════════════════════════════════════════════════════ */

describe('getMentionSuggestions() — prefix filtering', () => {
    const ALL = buildAllMentionables(CHARACTERS, PEERS, MY_NICK);

    it('empty string returns all mentionables', () => {
        const result = getMentionSuggestions('', ALL);
        expect(result).toHaveLength(ALL.length);
    });

    it('null query returns all mentionables', () => {
        const result = getMentionSuggestions(null, ALL);
        expect(result).toHaveLength(ALL.length);
    });

    it('"fo" prefix matches foobar and fooqux but not zelda', () => {
        const result = getMentionSuggestions('fo', ALL);
        const keys = result.map(m => m.key);
        expect(keys).toContain('foobar');
        expect(keys).toContain('fooqux');
        expect(keys).not.toContain('zelda');
    });

    it('prefix match is case-insensitive', () => {
        const result = getMentionSuggestions('FO', ALL);
        const keys = result.map(m => m.key);
        expect(keys).toContain('foobar');
        expect(keys).toContain('fooqux');
    });

    it('exact match returns exactly one result', () => {
        const result = getMentionSuggestions('zelda', ALL);
        expect(result).toHaveLength(1);
        expect(result[0].key).toBe('zelda');
    });

    it('prefix with no matches returns empty array', () => {
        const result = getMentionSuggestions('zzz', ALL);
        expect(result).toHaveLength(0);
    });

    it('"ba" prefix matches babita ji', () => {
        const result = getMentionSuggestions('ba', ALL);
        const keys = result.map(m => m.key);
        expect(keys).toContain('babita ji');
    });

    it('"je" prefix matches jethalal', () => {
        const result = getMentionSuggestions('je', ALL);
        const keys = result.map(m => m.key);
        expect(keys).toContain('jethalal');
    });
});

/* ═══════════════════════════════════════════════════════════════
   3. getMentionQuery() — trigger detection
   ═══════════════════════════════════════════════════════════════ */

describe('getMentionQuery() — @trigger detection from input', () => {
    it('returns empty string when input is exactly "@"', () => {
        expect(getMentionQuery('@', 1)).toBe('');
    });

    it('returns the partial query after "@"', () => {
        expect(getMentionQuery('@fo', 3)).toBe('fo');
    });

    it('returns null when "@" is preceded by a non-space character (email context)', () => {
        // e.g. "user@example" — should NOT trigger dropdown
        expect(getMentionQuery('user@example', 12)).toBeNull();
    });

    it('returns the query when "@" is preceded by a space', () => {
        expect(getMentionQuery('hello @ali', 10)).toBe('ali');
    });

    it('returns null when there is no "@" in input', () => {
        expect(getMentionQuery('hello world', 11)).toBeNull();
    });

    it('returns null when the query part contains a space (user finished the mention)', () => {
        // "@Alice has" — cursor at end; space after "Alice" means done
        expect(getMentionQuery('@Alice has', 10)).toBeNull();
    });

    it('returns empty string at cursor right after "@"', () => {
        expect(getMentionQuery('hello @', 7)).toBe('');
    });
});

/* ═══════════════════════════════════════════════════════════════
   4. UI interaction tests — require RTL + full ChatRoom render
   ═══════════════════════════════════════════════════════════════ */

describe('Mention autocomplete — UI interactions (ChatRoom render)', () => {
    it.todo('clicking a suggestion inserts @Name into the input');
    it.todo('Tab key selects the highlighted suggestion');
    it.todo('Enter key selects the highlighted suggestion without submitting the form');
    it.todo('ArrowDown / ArrowUp navigate the dropdown list');
    it.todo('Escape key closes the dropdown without inserting text');
    it.todo('mention dropdown closes when @ is deleted from input');
    it.todo('mention toast appears when another peer @-mentions you');
});
