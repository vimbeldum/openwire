/**
 * cosmetics-rendering.test.js
 *
 * Tests for cosmetics rendering helpers: getEquippedClasses and getSenderCosmetics.
 * Validates correct cssClass mapping for equipped items, and null for unequipped slots.
 */

import { describe, it, expect } from 'vitest';

import {
    CATEGORIES,
    getEquippedClasses,
    getSenderCosmetics,
} from '../lib/cosmetics.js';

/* ── Helpers ───────────────────────────────────────────────────── */

function freshProfile(ownedIds = [], equipped = {}) {
    return {
        cosmetics: {
            owned: [...ownedIds],
            equipped: { ...equipped },
        },
    };
}

/* ═══════════════════════════════════════════════════════════════
   getEquippedClasses
   ═══════════════════════════════════════════════════════════════ */

describe('getEquippedClasses', () => {
    it('returns correct cssClass for equipped bubbleStyle (neon-green-bubble)', () => {
        const profile = freshProfile(['neon-green-bubble'], { bubbleStyle: 'neon-green-bubble' });
        const classes = getEquippedClasses(profile);
        expect(classes.bubbleStyle).toBe('bubble-neon-green');
    });

    it('returns correct cssClass for equipped cyberpunk-red-bubble', () => {
        const profile = freshProfile(['cyberpunk-red-bubble'], { bubbleStyle: 'cyberpunk-red-bubble' });
        const classes = getEquippedClasses(profile);
        expect(classes.bubbleStyle).toBe('bubble-cyberpunk-red');
    });

    it('returns correct cssClass for equipped gold-name', () => {
        const profile = freshProfile(['gold-name'], { nameColor: 'gold-name' });
        const classes = getEquippedClasses(profile);
        expect(classes.nameColor).toBe('name-gold');
    });

    it('returns correct cssClass for equipped rainbow-name', () => {
        const profile = freshProfile(['rainbow-name'], { nameColor: 'rainbow-name' });
        const classes = getEquippedClasses(profile);
        expect(classes.nameColor).toBe('name-rainbow');
    });

    it('returns correct cssClass for equipped entryAnimation (flames-entry)', () => {
        const profile = freshProfile(['flames-entry'], { entryAnimation: 'flames-entry' });
        const classes = getEquippedClasses(profile);
        expect(classes.entryAnimation).toBe('entry-flames');
    });

    it('returns correct cssClass for equipped chatFlair (sparkle-flair)', () => {
        const profile = freshProfile(['sparkle-flair'], { chatFlair: 'sparkle-flair' });
        const classes = getEquippedClasses(profile);
        expect(classes.chatFlair).toBe('flair-sparkle');
    });

    it('returns correct cssClass for equipped chatFlair (glitch-flair)', () => {
        const profile = freshProfile(['glitch-flair'], { chatFlair: 'glitch-flair' });
        const classes = getEquippedClasses(profile);
        expect(classes.chatFlair).toBe('flair-glitch');
    });

    it('returns null for unequipped categories', () => {
        const profile = freshProfile(['neon-green-bubble'], { bubbleStyle: 'neon-green-bubble' });
        const classes = getEquippedClasses(profile);
        expect(classes.nameColor).toBeNull();
        expect(classes.customEmoji).toBeNull();
        expect(classes.entryAnimation).toBeNull();
        expect(classes.chatFlair).toBeNull();
    });

    it('returns all null when nothing is equipped', () => {
        const profile = freshProfile([]);
        const classes = getEquippedClasses(profile);
        for (const category of CATEGORIES) {
            expect(classes[category]).toBeNull();
        }
    });

    it('returns null for an equipped id not found in catalog', () => {
        const profile = freshProfile(['nonexistent-item'], { bubbleStyle: 'nonexistent-item' });
        const classes = getEquippedClasses(profile);
        expect(classes.bubbleStyle).toBeNull();
    });
});

/* ═══════════════════════════════════════════════════════════════
   getSenderCosmetics
   ═══════════════════════════════════════════════════════════════ */

describe('getSenderCosmetics', () => {
    it('returns all categories with null for unequipped', () => {
        const profile = freshProfile([]);
        const meta = getSenderCosmetics(profile);
        for (const category of CATEGORIES) {
            expect(Object.prototype.hasOwnProperty.call(meta, category)).toBe(true);
            expect(meta[category]).toBeNull();
        }
    });

    it('returns cssClass for cyberpunk-red-bubble when equipped', () => {
        const profile = freshProfile(['cyberpunk-red-bubble'], { bubbleStyle: 'cyberpunk-red-bubble' });
        const meta = getSenderCosmetics(profile);
        expect(meta.bubbleStyle).toBe('bubble-cyberpunk-red');
    });

    it('returns cssClass for gold-name when equipped', () => {
        const profile = freshProfile(['gold-name'], { nameColor: 'gold-name' });
        const meta = getSenderCosmetics(profile);
        expect(meta.nameColor).toBe('name-gold');
    });

    it('returns multiple equipped classes at once', () => {
        const profile = freshProfile(
            ['cyberpunk-red-bubble', 'gold-name', 'sparkle-flair'],
            { bubbleStyle: 'cyberpunk-red-bubble', nameColor: 'gold-name', chatFlair: 'sparkle-flair' },
        );
        const meta = getSenderCosmetics(profile);
        expect(meta.bubbleStyle).toBe('bubble-cyberpunk-red');
        expect(meta.nameColor).toBe('name-gold');
        expect(meta.chatFlair).toBe('flair-sparkle');
        expect(meta.customEmoji).toBeNull();
        expect(meta.entryAnimation).toBeNull();
    });
});
