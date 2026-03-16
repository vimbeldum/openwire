/**
 * chaos-agent.test.js
 *
 * Unit tests for the AI Chaos Agent module (lib/chaosAgent.js).
 *
 * Covers:
 *   1. CHAOS_PERSONALITIES registry — all 4 types, required fields
 *   2. SILENCE_TIMEOUT_MS constant
 *   3. pickChaosMessage — random template selection
 *   4. buildChaosPrompt — prompt construction with personality, participants, messages
 *   5. CHAOS_TEMPLATES — pool completeness
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
    CHAOS_PERSONALITIES,
    PERSONALITY_KEYS,
    SILENCE_TIMEOUT_MS,
    CHAOS_TEMPLATES,
    pickChaosMessage,
    buildChaosPrompt,
    nextPersonality,
} from '../lib/chaosAgent.js';

/* ═══════════════════════════════════════════════════════════════
   SUITE 1 — CHAOS_PERSONALITIES registry
   ═══════════════════════════════════════════════════════════════ */

describe('CHAOS_PERSONALITIES', () => {
    it('has all 4 personality types', () => {
        const keys = Object.keys(CHAOS_PERSONALITIES);
        expect(keys).toContain('instigator');
        expect(keys).toContain('snoop');
        expect(keys).toContain('hype');
        expect(keys).toContain('philosopher');
        expect(keys).toHaveLength(4);
    });

    it('each personality has name, emoji, and style fields', () => {
        for (const key of Object.keys(CHAOS_PERSONALITIES)) {
            const p = CHAOS_PERSONALITIES[key];
            expect(p).toHaveProperty('name');
            expect(p).toHaveProperty('emoji');
            expect(p).toHaveProperty('style');
            expect(typeof p.name).toBe('string');
            expect(typeof p.emoji).toBe('string');
            expect(typeof p.style).toBe('string');
            expect(p.name.length).toBeGreaterThan(0);
            expect(p.emoji.length).toBeGreaterThan(0);
            expect(p.style.length).toBeGreaterThan(0);
        }
    });

    it('PERSONALITY_KEYS matches CHAOS_PERSONALITIES keys', () => {
        expect(PERSONALITY_KEYS).toEqual(Object.keys(CHAOS_PERSONALITIES));
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 2 — SILENCE_TIMEOUT_MS constant
   ═══════════════════════════════════════════════════════════════ */

describe('SILENCE_TIMEOUT_MS', () => {
    it('equals 30000 (30 seconds)', () => {
        expect(SILENCE_TIMEOUT_MS).toBe(30000);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 3 — pickChaosMessage
   ═══════════════════════════════════════════════════════════════ */

describe('pickChaosMessage', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns a non-empty string for instigator', () => {
        const msg = pickChaosMessage('instigator');
        expect(typeof msg).toBe('string');
        expect(msg.length).toBeGreaterThan(0);
    });

    it('returns a string for all 4 personalities', () => {
        for (const key of PERSONALITY_KEYS) {
            const msg = pickChaosMessage(key);
            expect(typeof msg).toBe('string');
            expect(msg.length).toBeGreaterThan(0);
        }
    });

    it('returns a message from one of the template pools', () => {
        const allMessages = [
            ...CHAOS_TEMPLATES.silence_break,
            ...CHAOS_TEMPLATES.challenges,
            ...CHAOS_TEMPLATES.roasts,
        ];
        // Run several times to increase confidence
        for (let i = 0; i < 20; i++) {
            const msg = pickChaosMessage('hype');
            expect(allMessages).toContain(msg);
        }
    });

    it('picks from challenges pool when Math.random > 0.5', () => {
        vi.spyOn(Math, 'random')
            .mockReturnValueOnce(0.8)   // roll > 0.5 => challenges
            .mockReturnValueOnce(0);     // index 0
        const msg = pickChaosMessage('instigator');
        expect(CHAOS_TEMPLATES.challenges).toContain(msg);
    });

    it('picks from silence_break pool when Math.random is between 0.3 and 0.5', () => {
        vi.spyOn(Math, 'random')
            .mockReturnValueOnce(0.4)   // 0.3 < roll <= 0.5 => silence_break
            .mockReturnValueOnce(0);     // index 0
        const msg = pickChaosMessage('snoop');
        expect(CHAOS_TEMPLATES.silence_break).toContain(msg);
    });

    it('picks from roasts pool when Math.random <= 0.3', () => {
        vi.spyOn(Math, 'random')
            .mockReturnValueOnce(0.1)   // roll <= 0.3 => roasts
            .mockReturnValueOnce(0);     // index 0
        const msg = pickChaosMessage('philosopher');
        expect(CHAOS_TEMPLATES.roasts).toContain(msg);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 4 — buildChaosPrompt
   ═══════════════════════════════════════════════════════════════ */

describe('buildChaosPrompt', () => {
    it('includes personality name for instigator', () => {
        const prompt = buildChaosPrompt('instigator', [], ['Alice']);
        expect(prompt).toContain('The Instigator');
    });

    it('includes personality name for all 4 types', () => {
        const expectedNames = {
            instigator: 'The Instigator',
            snoop: 'The Snoop',
            hype: 'The Hype Beast',
            philosopher: 'The Philosopher',
        };
        for (const [key, expectedName] of Object.entries(expectedNames)) {
            const prompt = buildChaosPrompt(key, [], ['TestUser']);
            expect(prompt).toContain(expectedName);
        }
    });

    it('includes participant names', () => {
        const prompt = buildChaosPrompt('instigator', [], ['Alice', 'Bob']);
        expect(prompt).toContain('Alice');
        expect(prompt).toContain('Bob');
    });

    it('includes recent messages in the prompt', () => {
        const messages = [
            { nick: 'Alice', text: 'Hello everyone!' },
            { nick: 'Bob', text: 'How is it going?' },
        ];
        const prompt = buildChaosPrompt('snoop', messages, ['Alice', 'Bob']);
        expect(prompt).toContain('Alice: Hello everyone!');
        expect(prompt).toContain('Bob: How is it going?');
    });

    it('shows ghost town placeholder when no recent messages', () => {
        const prompt = buildChaosPrompt('hype', [], ['TestUser']);
        expect(prompt).toContain('ghost town');
    });

    it('shows ghost town placeholder for null messages', () => {
        const prompt = buildChaosPrompt('hype', null, ['TestUser']);
        expect(prompt).toContain('ghost town');
    });

    it('includes the personality style', () => {
        const prompt = buildChaosPrompt('philosopher', [], ['TestUser']);
        expect(prompt).toContain('deep questions');
    });

    it('falls back to instigator for unknown personality key', () => {
        const prompt = buildChaosPrompt('nonexistent', [], ['TestUser']);
        expect(prompt).toContain('The Instigator');
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 5 — CHAOS_TEMPLATES pool completeness
   ═══════════════════════════════════════════════════════════════ */

describe('CHAOS_TEMPLATES', () => {
    it('has silence_break pool with entries', () => {
        expect(CHAOS_TEMPLATES.silence_break).toBeDefined();
        expect(Array.isArray(CHAOS_TEMPLATES.silence_break)).toBe(true);
        expect(CHAOS_TEMPLATES.silence_break.length).toBeGreaterThan(0);
    });

    it('has challenges pool with entries', () => {
        expect(CHAOS_TEMPLATES.challenges).toBeDefined();
        expect(Array.isArray(CHAOS_TEMPLATES.challenges)).toBe(true);
        expect(CHAOS_TEMPLATES.challenges.length).toBeGreaterThan(0);
    });

    it('has roasts pool with entries', () => {
        expect(CHAOS_TEMPLATES.roasts).toBeDefined();
        expect(Array.isArray(CHAOS_TEMPLATES.roasts)).toBe(true);
        expect(CHAOS_TEMPLATES.roasts.length).toBeGreaterThan(0);
    });

    it('all template entries are non-empty strings', () => {
        for (const [poolName, pool] of Object.entries(CHAOS_TEMPLATES)) {
            for (const entry of pool) {
                expect(typeof entry).toBe('string');
                expect(entry.length).toBeGreaterThan(0);
            }
        }
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 6 — nextPersonality cycling
   ═══════════════════════════════════════════════════════════════ */

describe('nextPersonality', () => {
    it('cycles from instigator to snoop', () => {
        expect(nextPersonality('instigator')).toBe('snoop');
    });

    it('cycles from philosopher back to instigator (wrap-around)', () => {
        expect(nextPersonality('philosopher')).toBe('instigator');
    });

    it('full cycle returns to start', () => {
        let current = 'instigator';
        for (let i = 0; i < PERSONALITY_KEYS.length; i++) {
            current = nextPersonality(current);
        }
        expect(current).toBe('instigator');
    });

    it('returns first personality for unknown key', () => {
        // indexOf returns -1, (-1 + 1) % 4 = 0 => first key
        expect(nextPersonality('nonexistent')).toBe(PERSONALITY_KEYS[0]);
    });
});
