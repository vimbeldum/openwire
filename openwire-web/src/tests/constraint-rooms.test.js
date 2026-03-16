/**
 * constraint-rooms.test.js
 *
 * Unit tests for Constraint Rooms logic (lib/chaosAgent.js).
 *
 * Covers:
 *   1. 5-word constraint — word counting, boundary values
 *   2. Emoji-only constraint — filtering non-emoji characters
 *   3. No-backspace constraint — metadata and key detection logic
 *   4. ROOM_CONSTRAINTS registry — completeness and structure
 */

import { describe, it, expect } from 'vitest';

import {
    ROOM_CONSTRAINTS,
    validateConstraint,
    filterEmojiOnly,
} from '../lib/chaosAgent.js';

/* ═══════════════════════════════════════════════════════════════
   SUITE 1 — ROOM_CONSTRAINTS registry
   ═══════════════════════════════════════════════════════════════ */

describe('ROOM_CONSTRAINTS', () => {
    it('has 5word, emoji, and nobackspace keys', () => {
        expect(ROOM_CONSTRAINTS).toHaveProperty('5word');
        expect(ROOM_CONSTRAINTS).toHaveProperty('emoji');
        expect(ROOM_CONSTRAINTS).toHaveProperty('nobackspace');
    });

    it('each constraint has label, badge, and description', () => {
        for (const [key, constraint] of Object.entries(ROOM_CONSTRAINTS)) {
            expect(constraint).toHaveProperty('label');
            expect(constraint).toHaveProperty('badge');
            expect(constraint).toHaveProperty('description');
            expect(typeof constraint.label).toBe('string');
            expect(typeof constraint.badge).toBe('string');
            expect(typeof constraint.description).toBe('string');
        }
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 2 — 5-word constraint (validateConstraint)
   ═══════════════════════════════════════════════════════════════ */

describe('5-word constraint', () => {
    it('allows exactly 5 words', () => {
        const result = validateConstraint('hello world foo bar baz', '5word');
        expect(result.valid).toBe(true);
        expect(result.wordCount).toBe(5);
    });

    it('blocks 6 words', () => {
        const result = validateConstraint('hello world foo bar baz qux', '5word');
        expect(result.valid).toBe(false);
        expect(result.wordCount).toBe(6);
    });

    it('allows fewer than 5 words', () => {
        const result = validateConstraint('just three words', '5word');
        expect(result.valid).toBe(true);
        expect(result.wordCount).toBe(3);
    });

    it('allows a single word', () => {
        const result = validateConstraint('hello', '5word');
        expect(result.valid).toBe(true);
        expect(result.wordCount).toBe(1);
    });

    it('handles empty string', () => {
        const result = validateConstraint('', '5word');
        expect(result.valid).toBe(true);
        expect(result.wordCount).toBe(0);
    });

    it('handles whitespace-only string', () => {
        const result = validateConstraint('   ', '5word');
        expect(result.valid).toBe(true);
        expect(result.wordCount).toBe(0);
    });

    it('collapses multiple spaces between words', () => {
        const result = validateConstraint('hello   world   foo', '5word');
        expect(result.valid).toBe(true);
        expect(result.wordCount).toBe(3);
    });

    it('trims leading and trailing whitespace', () => {
        const result = validateConstraint('  one two three four five  ', '5word');
        expect(result.valid).toBe(true);
        expect(result.wordCount).toBe(5);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 3 — Emoji-only constraint (filterEmojiOnly)
   ═══════════════════════════════════════════════════════════════ */

describe('Emoji-only constraint', () => {
    it('strips non-emoji characters, keeping emoji and spaces', () => {
        const result = filterEmojiOnly('hello \uD83D\uDE00 world \uD83C\uDF89');
        // Should contain only the emojis and whitespace, no alpha characters
        expect(result).not.toContain('hello');
        expect(result).not.toContain('world');
        expect(result).toContain('\uD83D\uDE00');
        expect(result).toContain('\uD83C\uDF89');
    });

    it('preserves pure emoji input', () => {
        const input = '\uD83D\uDE00\uD83C\uDF89\uD83D\uDD25';
        const result = filterEmojiOnly(input);
        expect(result).toContain('\uD83D\uDE00');
        expect(result).toContain('\uD83C\uDF89');
        expect(result).toContain('\uD83D\uDD25');
    });

    it('returns empty string for plain text', () => {
        const result = filterEmojiOnly('hello world');
        expect(result.trim()).toBe('');
    });

    it('handles empty string', () => {
        const result = filterEmojiOnly('');
        expect(result).toBe('');
    });

    it('preserves whitespace between emoji', () => {
        const result = filterEmojiOnly('\uD83D\uDE00 \uD83C\uDF89');
        expect(result).toContain(' ');
    });

    it('strips alphabetic characters and most punctuation', () => {
        const result = filterEmojiOnly('abc!@\uD83D\uDE00');
        expect(result).not.toContain('a');
        expect(result).not.toContain('b');
        expect(result).not.toContain('c');
        expect(result).not.toContain('!');
        expect(result).not.toContain('@');
        expect(result).toContain('\uD83D\uDE00');
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 4 — No-backspace constraint logic
   ═══════════════════════════════════════════════════════════════ */

describe('No-backspace constraint', () => {
    it('ROOM_CONSTRAINTS.nobackspace has correct metadata', () => {
        const nb = ROOM_CONSTRAINTS.nobackspace;
        expect(nb.label).toBe('No Backspace');
        expect(nb.description).toContain('Backspace');
    });

    it('detects Backspace key from keyboard event', () => {
        // Simulate the logic a component would use to detect backspace
        const event = { key: 'Backspace' };
        const isBackspace = event.key === 'Backspace';
        expect(isBackspace).toBe(true);
    });

    it('does not flag non-Backspace keys', () => {
        const normalKeys = ['a', 'Enter', 'Shift', 'ArrowLeft', ' '];
        for (const key of normalKeys) {
            const isBackspace = key === 'Backspace';
            expect(isBackspace).toBe(false);
        }
    });

    it('detects Delete key as distinct from Backspace', () => {
        const event = { key: 'Delete' };
        const isBackspace = event.key === 'Backspace';
        expect(isBackspace).toBe(false);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 5 — validateConstraint with no constraint / unknown constraint
   ═══════════════════════════════════════════════════════════════ */

describe('validateConstraint edge cases', () => {
    it('returns valid:true when constraint is null', () => {
        const result = validateConstraint('anything goes here', null);
        expect(result.valid).toBe(true);
    });

    it('returns valid:true when constraint is undefined', () => {
        const result = validateConstraint('anything goes here', undefined);
        expect(result.valid).toBe(true);
    });

    it('returns valid:true for unknown constraint type', () => {
        const result = validateConstraint('test', 'nonexistent');
        expect(result.valid).toBe(true);
    });
});
