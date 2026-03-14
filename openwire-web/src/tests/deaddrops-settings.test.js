/**
 * deaddrops-settings.test.js
 *
 * Tests for the configurable karma threshold feature in Dead Drops.
 * Covers getMinKarmaToPost, setMinKarmaToPost, and dynamic createPost behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Mock socket.js (transitive dependency) ──────────────────── */
vi.mock('../lib/socket.js', () => ({
    stripDangerousTags: (text) => text,
}));

/* ── Mock localStorage ───────────────────────────────────────── */
const _lsStore = {};
vi.stubGlobal('localStorage', {
    getItem: vi.fn((k) => _lsStore[k] ?? null),
    setItem: vi.fn((k, v) => { _lsStore[k] = v; }),
    removeItem: vi.fn((k) => { delete _lsStore[k]; }),
});

/* ── Mock sessionStorage (transitive dep) ────────────────────── */
vi.stubGlobal('sessionStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
});

/* ── Import module under test ────────────────────────────────── */
import {
    getMinKarmaToPost,
    setMinKarmaToPost,
    createPost,
    DEFAULT_MIN_KARMA_TO_POST,
} from '../lib/deaddrops.js';

/* ── Helpers ─────────────────────────────────────────────────── */
const ROOM = 'room_settings';
const DEVICE = 'device-settings-1';
const NOW = 1_700_000_000_000;

beforeEach(() => {
    Object.keys(_lsStore).forEach(k => delete _lsStore[k]);
    vi.clearAllMocks();
});

/* ═══════════════════════════════════════════════════════════════
   getMinKarmaToPost / setMinKarmaToPost
   ═══════════════════════════════════════════════════════════════ */

describe('getMinKarmaToPost', () => {
    it('returns DEFAULT_MIN_KARMA_TO_POST (10) by default', () => {
        expect(getMinKarmaToPost()).toBe(DEFAULT_MIN_KARMA_TO_POST);
        expect(getMinKarmaToPost()).toBe(10);
    });
});

describe('setMinKarmaToPost', () => {
    it('persists value and getMinKarmaToPost returns it', () => {
        setMinKarmaToPost(50);
        expect(getMinKarmaToPost()).toBe(50);
    });

    it('overwrites previous value', () => {
        setMinKarmaToPost(25);
        expect(getMinKarmaToPost()).toBe(25);
        setMinKarmaToPost(75);
        expect(getMinKarmaToPost()).toBe(75);
    });
});

/* ═══════════════════════════════════════════════════════════════
   createPost uses dynamic getMinKarmaToPost
   ═══════════════════════════════════════════════════════════════ */

describe('createPost with configurable karma', () => {
    it('uses dynamic getMinKarmaToPost not hardcoded value', () => {
        setMinKarmaToPost(50);

        // karma 49 should be blocked because threshold is now 50
        const blocked = createPost(ROOM, 'Hello', DEVICE, 49, [], NOW);
        expect(blocked.success).toBe(false);
        expect(blocked.reason).toMatch(/karma/i);

        // karma 50 should succeed
        const allowed = createPost(ROOM, 'Hello', DEVICE, 50, [], NOW);
        expect(allowed.success).toBe(true);
    });

    it('after setMinKarmaToPost(0), any karma >= 0 can post', () => {
        setMinKarmaToPost(0);

        const result0 = createPost(ROOM, 'Zero karma post', DEVICE, 0, [], NOW);
        expect(result0.success).toBe(true);

        const result5 = createPost(ROOM, 'Low karma post', DEVICE, 5, [], NOW);
        expect(result5.success).toBe(true);
    });

    it('after setMinKarmaToPost(100), karma 99 is blocked', () => {
        setMinKarmaToPost(100);

        const blocked = createPost(ROOM, 'Not enough karma', DEVICE, 99, [], NOW);
        expect(blocked.success).toBe(false);
        expect(blocked.reason).toMatch(/karma/i);

        const allowed = createPost(ROOM, 'Exactly 100 karma', DEVICE, 100, [], NOW);
        expect(allowed.success).toBe(true);
    });

    it('resetting to default works', () => {
        setMinKarmaToPost(DEFAULT_MIN_KARMA_TO_POST);
        expect(getMinKarmaToPost()).toBe(10);

        const blocked = createPost(ROOM, 'Low karma', DEVICE, 9, [], NOW);
        expect(blocked.success).toBe(false);

        const allowed = createPost(ROOM, 'Exact karma', DEVICE, 10, [], NOW);
        expect(allowed.success).toBe(true);
    });
});
