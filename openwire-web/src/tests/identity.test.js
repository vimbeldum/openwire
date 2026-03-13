import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Mock sessionStorage before importing identity ─────────────── */
const mockSessionStorage = {};
vi.stubGlobal('sessionStorage', {
    getItem: vi.fn(k => mockSessionStorage[k] ?? null),
    setItem: vi.fn((k, v) => { mockSessionStorage[k] = v; }),
    removeItem: vi.fn(k => { delete mockSessionStorage[k]; }),
});

import { getRoomAlias, clearRoomAlias } from '../lib/core/identity.js';

beforeEach(() => {
    Object.keys(mockSessionStorage).forEach(k => delete mockSessionStorage[k]);
    vi.clearAllMocks();
});

/* ═══════════════════════════════════════════════════════════════
   1 -- getRoomAlias()
   ═══════════════════════════════════════════════════════════════ */

describe('getRoomAlias()', () => {
    it('generates an alias matching the "Adjective Noun #NN" format', () => {
        const alias = getRoomAlias('room-123');

        // Format: "Word Word #DD" where DD is zero-padded 01-99
        expect(alias).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ #\d{2}$/);
    });

    it('caches the alias in sessionStorage for subsequent calls', () => {
        const alias1 = getRoomAlias('room-456');
        const alias2 = getRoomAlias('room-456');

        expect(alias1).toBe(alias2);
        // setItem called once on first generation
        expect(sessionStorage.setItem).toHaveBeenCalledTimes(1);
        expect(sessionStorage.setItem).toHaveBeenCalledWith(
            'openwire_alias_room-456',
            alias1,
        );
    });

    it('returns different aliases for different rooms', () => {
        // With randomness this is probabilistic, but we can at least verify
        // that independent calls use different storage keys
        getRoomAlias('room-A');
        getRoomAlias('room-B');

        expect(sessionStorage.getItem).toHaveBeenCalledWith('openwire_alias_room-A');
        expect(sessionStorage.getItem).toHaveBeenCalledWith('openwire_alias_room-B');
    });

    it('returns the stored alias when one already exists in sessionStorage', () => {
        mockSessionStorage['openwire_alias_room-789'] = 'Gold Wolf #42';

        const alias = getRoomAlias('room-789');

        expect(alias).toBe('Gold Wolf #42');
        // setItem should not be called since alias already existed
        expect(sessionStorage.setItem).not.toHaveBeenCalled();
    });

    it('returns fallback "Anonymous" when roomId is null', () => {
        const alias = getRoomAlias(null);
        expect(alias).toBe('Anonymous');
    });

    it('returns fallback "Anonymous" when roomId is undefined', () => {
        const alias = getRoomAlias(undefined);
        expect(alias).toBe('Anonymous');
    });

    it('returns fallback "Anonymous" when roomId is empty string', () => {
        const alias = getRoomAlias('');
        expect(alias).toBe('Anonymous');
    });

    it('returns custom fallback when roomId is falsy and fallback provided', () => {
        const alias = getRoomAlias(null, 'Guest User');
        expect(alias).toBe('Guest User');
    });

    it('returns fallback when sessionStorage.getItem throws', () => {
        sessionStorage.getItem.mockImplementationOnce(() => {
            throw new Error('sessionStorage disabled');
        });

        const alias = getRoomAlias('room-broken');
        expect(alias).toBe('Anonymous');
    });

    it('returns fallback when sessionStorage.setItem throws', () => {
        // getItem returns null (no cached alias), but setItem throws
        sessionStorage.getItem.mockReturnValueOnce(null);
        sessionStorage.setItem.mockImplementationOnce(() => {
            throw new Error('quota exceeded');
        });

        const alias = getRoomAlias('room-broken');
        // Falls into catch block, returns fallback
        expect(alias).toBe('Anonymous');
    });

    it('generates number in range 01-99', () => {
        // Run multiple times to gain confidence on the range
        for (let i = 0; i < 50; i++) {
            // Clear cache for each iteration
            Object.keys(mockSessionStorage).forEach(k => delete mockSessionStorage[k]);
            vi.clearAllMocks();

            const alias = getRoomAlias(`room-iter-${i}`);
            const numMatch = alias.match(/#(\d{2})$/);
            expect(numMatch).not.toBeNull();
            const num = parseInt(numMatch[1], 10);
            expect(num).toBeGreaterThanOrEqual(1);
            expect(num).toBeLessThanOrEqual(99);
        }
    });

    it('zero-pads single-digit numbers', () => {
        // Mock Math.random to produce a small number -> digit 1
        const originalRandom = Math.random;
        Math.random = vi.fn()
            .mockReturnValueOnce(0.0)  // adjective index 0
            .mockReturnValueOnce(0.0)  // noun index 0
            .mockReturnValueOnce(0.0); // number: floor(0 * 99) + 1 = 1

        const alias = getRoomAlias('room-pad-test');
        expect(alias).toMatch(/#01$/);

        Math.random = originalRandom;
    });
});

/* ═══════════════════════════════════════════════════════════════
   2 -- clearRoomAlias()
   ═══════════════════════════════════════════════════════════════ */

describe('clearRoomAlias()', () => {
    it('removes the alias key from sessionStorage', () => {
        mockSessionStorage['openwire_alias_room-123'] = 'Shadow Hawk #07';

        clearRoomAlias('room-123');

        expect(sessionStorage.removeItem).toHaveBeenCalledWith('openwire_alias_room-123');
        expect(mockSessionStorage['openwire_alias_room-123']).toBeUndefined();
    });

    it('does nothing when roomId is null', () => {
        clearRoomAlias(null);
        expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    });

    it('does nothing when roomId is undefined', () => {
        clearRoomAlias(undefined);
        expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    });

    it('does nothing when roomId is empty string', () => {
        clearRoomAlias('');
        expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    });

    it('does not throw when key does not exist in sessionStorage', () => {
        expect(() => clearRoomAlias('nonexistent-room')).not.toThrow();
        expect(sessionStorage.removeItem).toHaveBeenCalledWith('openwire_alias_nonexistent-room');
    });

    it('does not throw when sessionStorage.removeItem throws', () => {
        sessionStorage.removeItem.mockImplementationOnce(() => {
            throw new Error('storage error');
        });

        expect(() => clearRoomAlias('room-err')).not.toThrow();
    });

    it('after clearing, getRoomAlias generates a new alias', () => {
        // Generate initial alias
        const original = getRoomAlias('room-regen');

        // Clear it
        clearRoomAlias('room-regen');

        // Re-clear the mock call counts but keep the cleared storage state
        vi.clearAllMocks();

        // Next call should generate fresh (setItem should be called again)
        const regenerated = getRoomAlias('room-regen');
        expect(sessionStorage.setItem).toHaveBeenCalledTimes(1);
        // The regenerated alias should still match the format
        expect(regenerated).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ #\d{2}$/);
    });
});
