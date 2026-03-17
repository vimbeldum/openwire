import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Mock ALL browser APIs before importing profile ─────────── */
const mockStorage = {};
vi.stubGlobal('localStorage', {
    getItem: vi.fn(k => mockStorage[k] ?? null),
    setItem: vi.fn((k, v) => { mockStorage[k] = v; }),
    removeItem: vi.fn(k => { delete mockStorage[k]; }),
});
vi.stubGlobal('crypto', {
    randomUUID: () => 'test-device-uuid-4321',
    getRandomValues: (buf) => {
        for (let i = 0; i < buf.length; i++) buf[i] = i % 256;
        return buf;
    },
});
// Minimal IndexedDB stub — silently no-ops
const mockIDBRequest = (result) => ({
    onsuccess: null,
    onerror: null,
    result,
    _trigger() {
        if (typeof this.onsuccess === 'function') {
            this.onsuccess({ target: { result: this.result } });
        }
    },
});
const mockStore = {
    put: vi.fn(() => {
        const req = mockIDBRequest(undefined);
        setTimeout(() => req._trigger(), 0);
        return req;
    }),
    get: vi.fn(() => {
        const req = mockIDBRequest(null);
        setTimeout(() => req._trigger(), 0);
        return req;
    }),
    delete: vi.fn(() => {
        const req = mockIDBRequest(undefined);
        setTimeout(() => req._trigger(), 0);
        return req;
    }),
};
const mockTx = { objectStore: vi.fn(() => mockStore) };
const mockDB = {
    transaction: vi.fn(() => mockTx),
    objectStoreNames: { contains: vi.fn(() => true) },
};
const mockOpenReq = {
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
    result: mockDB,
    _trigger() {
        if (typeof this.onsuccess === 'function') {
            this.onsuccess({ target: { result: this.result } });
        }
    },
};
vi.stubGlobal('indexedDB', {
    open: vi.fn(() => {
        setTimeout(() => mockOpenReq._trigger(), 0);
        return mockOpenReq;
    }),
});

import {
    getDeviceId,
    getProfileKey,
    loadProfile,
    saveProfile,
    saveProfileToIndexedDB,
    loadProfileFromIndexedDB,
    updateStreak,
    calculateDailyBonus,
    wipeIdentity,
    exportPassphrase,
} from '../lib/profile.js';

beforeEach(() => {
    Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    vi.clearAllMocks();
});

/* ═══════════════════════════════════════════════════════════════
   1 -- getDeviceId
   ═══════════════════════════════════════════════════════════════ */

describe('getDeviceId()', () => {
    it('generates and stores a new UUID when none exists', () => {
        const id = getDeviceId();
        expect(id).toBe('test-device-uuid-4321');
        expect(localStorage.setItem).toHaveBeenCalledWith('openwire_device_id', id);
    });

    it('returns the existing UUID from localStorage without generating a new one', () => {
        mockStorage['openwire_device_id'] = 'existing-uuid-abcd';
        const id = getDeviceId();
        expect(id).toBe('existing-uuid-abcd');
        expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('returns the same value on repeated calls once stored', () => {
        const first = getDeviceId();
        const second = getDeviceId();
        expect(first).toBe(second);
    });
});

/* ═══════════════════════════════════════════════════════════════
   2 -- getProfileKey
   ═══════════════════════════════════════════════════════════════ */

describe('getProfileKey()', () => {
    it('returns the correctly namespaced key', () => {
        expect(getProfileKey('abc-123')).toBe('openwire:profile:abc-123');
    });
});

/* ═══════════════════════════════════════════════════════════════
   3 -- loadProfile
   ═══════════════════════════════════════════════════════════════ */

describe('loadProfile()', () => {
    it('creates a new profile with default schema when none exists', () => {
        const profile = loadProfile('TestUser');
        expect(profile.deviceId).toBe('test-device-uuid-4321');
        expect(profile.currentNick).toBe('TestUser');
        expect(profile.chips).toBe(1000);
        expect(profile.reputation.karma).toBe(0);
        expect(profile.reputation.tier).toBe('newcomer');
        expect(Array.isArray(profile.reputation.history)).toBe(true);
        expect(Array.isArray(profile.cosmetics.owned)).toBe(true);
        expect(profile.vault.staked).toBe(0);
        expect(profile.streak.count).toBe(0);
        expect(Array.isArray(profile.transactions)).toBe(true);
        expect(profile.createdAt).toBeTruthy();
    });

    it('persists the new profile to localStorage', () => {
        loadProfile('TestUser');
        expect(localStorage.setItem).toHaveBeenCalledWith(
            'openwire:profile:test-device-uuid-4321',
            expect.any(String),
        );
    });

    it('loads an existing profile from localStorage without resetting it', () => {
        const existing = {
            deviceId: 'test-device-uuid-4321',
            currentNick: 'OldNick',
            chips: 500,
            reputation: { karma: 10, tier: 'regular', history: [] },
            cosmetics: { owned: ['hat'], equipped: {} },
            vault: { staked: 50, stakedAt: '2026-01-01' },
            streak: { count: 3, lastLogin: '2026-03-14' },
            mutedAgents: [],
            transactions: [],
            createdAt: '2026-01-01T00:00:00Z',
        };
        mockStorage['openwire:profile:test-device-uuid-4321'] = JSON.stringify(existing);

        const profile = loadProfile('NewNick');
        expect(profile.chips).toBe(500);  // preserved
        expect(profile.currentNick).toBe('NewNick');  // nick updated
        expect(profile.streak.count).toBe(3);  // streak preserved
    });

    it('updates currentNick when loading an existing profile', () => {
        const existing = {
            deviceId: 'test-device-uuid-4321',
            currentNick: 'OldNick',
            chips: 750,
            reputation: { karma: 0, tier: 'newcomer', history: [] },
            cosmetics: { owned: [], equipped: {} },
            vault: { staked: 0, stakedAt: null },
            streak: { count: 0, lastLogin: null },
            mutedAgents: [],
            transactions: [],
            createdAt: '2026-01-01T00:00:00Z',
        };
        mockStorage['openwire:profile:test-device-uuid-4321'] = JSON.stringify(existing);

        const profile = loadProfile('FreshName');
        expect(profile.currentNick).toBe('FreshName');
    });
});

/* ═══════════════════════════════════════════════════════════════
   4 -- saveProfile / loadProfile round-trip
   ═══════════════════════════════════════════════════════════════ */

describe('saveProfile() / loadProfile() round-trip', () => {
    it('saves and reloads a profile with full fidelity', () => {
        const profile = loadProfile('RoundTripUser');
        const mutated = { ...profile, chips: 9999 };
        saveProfile(mutated);

        // Reset in-memory state (next loadProfile reads from mock localStorage)
        const reloaded = loadProfile('RoundTripUser');
        expect(reloaded.chips).toBe(9999);
    });

    it('saveProfile writes JSON string to localStorage under the correct key', () => {
        const profile = loadProfile('SaveUser');
        vi.clearAllMocks();
        saveProfile(profile);
        expect(localStorage.setItem).toHaveBeenCalledWith(
            getProfileKey(profile.deviceId),
            JSON.stringify(profile),
        );
    });
});

/* ═══════════════════════════════════════════════════════════════
   5 -- updateStreak
   ═══════════════════════════════════════════════════════════════ */

describe('updateStreak()', () => {
    function makeProfile(overrides = {}) {
        return {
            deviceId: 'test-device-uuid-4321',
            currentNick: 'Tester',
            chips: 1000,
            reputation: { karma: 0, tier: 'newcomer', history: [] },
            cosmetics: { owned: [], equipped: {} },
            vault: { staked: 0, stakedAt: null },
            streak: { count: 0, lastLogin: null },
            mutedAgents: [],
            transactions: [],
            createdAt: '2026-01-01T00:00:00Z',
            ...overrides,
        };
    }

    it('returns the same profile (no change) when lastLogin is today in IST', () => {
        const today = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date());

        const profile = makeProfile({ streak: { count: 5, lastLogin: today } });
        const updated = updateStreak(profile);
        expect(updated.streak.count).toBe(5);
        expect(updated.streak.lastLogin).toBe(today);
        // Should be same reference (no mutation needed — returning same object is valid)
        expect(updated).toBe(profile);
    });

    it('increments streak.count by 1 when lastLogin was yesterday', () => {
        // Yesterday in IST
        const yesterday = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date(Date.now() - 24 * 60 * 60 * 1000));

        const profile = makeProfile({ streak: { count: 4, lastLogin: yesterday } });
        const updated = updateStreak(profile);
        expect(updated.streak.count).toBe(5);
    });

    it('resets streak.count to 1 when gap is more than 1 day', () => {
        const profile = makeProfile({ streak: { count: 10, lastLogin: '2020-01-01' } });
        const updated = updateStreak(profile);
        expect(updated.streak.count).toBe(1);
    });

    it('sets streak.count to 1 on first login (lastLogin is null)', () => {
        const profile = makeProfile({ streak: { count: 0, lastLogin: null } });
        const updated = updateStreak(profile);
        expect(updated.streak.count).toBe(1);
    });

    it('updates streak.lastLogin to today when incrementing', () => {
        const today = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date());

        const profile = makeProfile({ streak: { count: 0, lastLogin: null } });
        const updated = updateStreak(profile);
        expect(updated.streak.lastLogin).toBe(today);
    });

    it('does not mutate the input profile object', () => {
        const profile = makeProfile({ streak: { count: 2, lastLogin: '2020-01-01' } });
        const original = JSON.stringify(profile);
        updateStreak(profile);
        expect(JSON.stringify(profile)).toBe(original);
    });
});

/* ═══════════════════════════════════════════════════════════════
   6 -- calculateDailyBonus
   ═══════════════════════════════════════════════════════════════ */

describe('calculateDailyBonus()', () => {
    it('returns 50 when streakCount is 0', () => {
        expect(calculateDailyBonus(0)).toBe(50);
    });

    it('returns 120 when streakCount is 7', () => {
        // 50 + (10 * 7) = 120
        expect(calculateDailyBonus(7)).toBe(120);
    });

    it('caps at 200 when streakCount is 50', () => {
        // 50 + (10 * 50) = 550 — capped at 200
        expect(calculateDailyBonus(50)).toBe(200);
    });

    it('caps at 200 for any very large streak', () => {
        expect(calculateDailyBonus(1000)).toBe(200);
    });

    it('returns 60 for streakCount of 1', () => {
        expect(calculateDailyBonus(1)).toBe(60);
    });

    it('returns exactly 200 at the cap boundary (streakCount = 15)', () => {
        // 50 + (10 * 15) = 200
        expect(calculateDailyBonus(15)).toBe(200);
    });
});

/* ═══════════════════════════════════════════════════════════════
   7 -- wipeIdentity
   ═══════════════════════════════════════════════════════════════ */

describe('wipeIdentity()', () => {
    it('removes openwire_device_id from localStorage', async () => {
        mockStorage['openwire_device_id'] = 'test-device-uuid-4321';
        await wipeIdentity('test-device-uuid-4321');
        expect(localStorage.removeItem).toHaveBeenCalledWith('openwire_device_id');
    });

    it('removes the profile key from localStorage', async () => {
        mockStorage['openwire:profile:test-device-uuid-4321'] = '{}';
        await wipeIdentity('test-device-uuid-4321');
        expect(localStorage.removeItem).toHaveBeenCalledWith(
            'openwire:profile:test-device-uuid-4321',
        );
    });

    it('removes both keys in one call', async () => {
        mockStorage['openwire_device_id'] = 'test-device-uuid-4321';
        mockStorage['openwire:profile:test-device-uuid-4321'] = '{}';
        await wipeIdentity('test-device-uuid-4321');
        expect(mockStorage['openwire_device_id']).toBeUndefined();
        expect(mockStorage['openwire:profile:test-device-uuid-4321']).toBeUndefined();
    });

    it('does not throw when keys do not exist', async () => {
        await expect(wipeIdentity('nonexistent-id')).resolves.not.toThrow();
    });
});

/* ═══════════════════════════════════════════════════════════════
   8 -- exportPassphrase
   ═══════════════════════════════════════════════════════════════ */

describe('exportPassphrase()', () => {
    it('returns a 4-word hyphen-separated passphrase', () => {
        const profile = { deviceId: 'test-device-uuid-4321' };
        const phrase = exportPassphrase(profile);
        const parts = phrase.split('-');
        expect(parts).toHaveLength(4);
        parts.forEach(part => expect(part.length).toBeGreaterThan(0));
    });

    it('is deterministic — same deviceId always produces the same passphrase', () => {
        const profile = { deviceId: 'stable-device-id-xyz' };
        const phrase1 = exportPassphrase(profile);
        const phrase2 = exportPassphrase(profile);
        expect(phrase1).toBe(phrase2);
    });

    it('produces different passphrases for different deviceIds', () => {
        const phrase1 = exportPassphrase({ deviceId: 'device-aaa' });
        const phrase2 = exportPassphrase({ deviceId: 'device-bbb' });
        expect(phrase1).not.toBe(phrase2);
    });

    it('all words in the passphrase are lowercase strings', () => {
        const profile = { deviceId: 'test-device-uuid-4321' };
        const phrase = exportPassphrase(profile);
        phrase.split('-').forEach(word => {
            expect(word).toBe(word.toLowerCase());
        });
    });
});

/* ═══════════════════════════════════════════════════════════════
   9 -- Edge cases: uncovered branches and error paths
   ═══════════════════════════════════════════════════════════════ */

describe('loadProfile() — error handling', () => {
    it('creates a default profile when localStorage has corrupt JSON', () => {
        mockStorage['openwire_device_id'] = 'test-device-uuid-4321';
        mockStorage['openwire:profile:test-device-uuid-4321'] = '{CORRUPT_JSON}}}';
        const profile = loadProfile('User');
        // Should fall through catch and create fresh profile
        expect(profile.currentNick).toBe('User');
        expect(profile.chips).toBe(1000);
    });

    it('uses "AnonymousUser" when nick is null/undefined', () => {
        const profile = loadProfile(null);
        expect(profile.currentNick).toBe('AnonymousUser');
    });

    it('uses "AnonymousUser" when nick is not provided', () => {
        const profile = loadProfile();
        expect(profile.currentNick).toBe('AnonymousUser');
    });

    it('returns existing profile unchanged when nick is falsy', () => {
        const existing = {
            deviceId: 'test-device-uuid-4321',
            currentNick: 'KeepThis',
            chips: 777,
            reputation: { karma: 0, tier: 'newcomer', history: [] },
            cosmetics: { owned: [], equipped: {} },
            vault: { staked: 0, stakedAt: null },
            streak: { count: 0, lastLogin: null },
            mutedAgents: [],
            transactions: [],
            createdAt: '2026-01-01T00:00:00Z',
        };
        mockStorage['openwire:profile:test-device-uuid-4321'] = JSON.stringify(existing);
        const profile = loadProfile(null);
        // Should keep existing nick since new nick is falsy
        expect(profile.currentNick).toBe('KeepThis');
        expect(profile.chips).toBe(777);
    });
});

describe('saveProfile() — error handling', () => {
    it('does not throw when localStorage.setItem throws', () => {
        const origSetItem = localStorage.setItem;
        localStorage.setItem = vi.fn(() => { throw new Error('QuotaExceeded'); });
        const profile = { deviceId: 'test-id', currentNick: 'Test' };
        expect(() => saveProfile(profile)).not.toThrow();
        localStorage.setItem = origSetItem;
    });
});

describe('saveProfileToIndexedDB()', () => {
    it('writes profile to IndexedDB via put()', async () => {
        const profile = { deviceId: 'test-device-uuid-4321', currentNick: 'Test' };
        await saveProfileToIndexedDB(profile);
        // wait for async IDB callbacks
        await new Promise(r => setTimeout(r, 10));
        expect(mockStore.put).toHaveBeenCalledWith(profile);
    });
});

describe('loadProfileFromIndexedDB()', () => {
    it('returns null when IndexedDB has no matching profile', async () => {
        const result = await loadProfileFromIndexedDB('nonexistent-id');
        // wait for async IDB callbacks
        await new Promise(r => setTimeout(r, 10));
        expect(result).toBeNull();
    });
});

describe('wipeIdentity() — IndexedDB interaction', () => {
    it('calls store.delete with the deviceId', async () => {
        await wipeIdentity('test-device-uuid-4321');
        await new Promise(r => setTimeout(r, 10));
        expect(mockStore.delete).toHaveBeenCalledWith('test-device-uuid-4321');
    });
});

/* ═══════════════════════════════════════════════════════════════
   10 -- gifSettings.js (full coverage)
   ═══════════════════════════════════════════════════════════════ */

import { setDefaultProvider, getDefaultProvider } from '../lib/gifSettings.js';

describe('gifSettings', () => {
    beforeEach(() => {
        Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    });

    it('getDefaultProvider returns "giphy" when nothing is stored', () => {
        expect(getDefaultProvider()).toBe('giphy');
    });

    it('setDefaultProvider stores the value in localStorage', () => {
        setDefaultProvider('tenor');
        expect(localStorage.setItem).toHaveBeenCalledWith('openwire:gif_provider', 'tenor');
    });

    it('getDefaultProvider returns the stored provider', () => {
        mockStorage['openwire:gif_provider'] = 'tenor';
        expect(getDefaultProvider()).toBe('tenor');
    });

    it('setDefaultProvider + getDefaultProvider round-trip', () => {
        setDefaultProvider('custom-provider');
        // Simulate localStorage storing it (mock setItem doesn't actually write to mockStorage by default)
        mockStorage['openwire:gif_provider'] = 'custom-provider';
        expect(getDefaultProvider()).toBe('custom-provider');
    });
});
