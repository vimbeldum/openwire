/**
 * wallet-persistence.test.js
 *
 * Tests for wallet synchronous persistence: credit and adminAdjust
 * must call saveWalletSync (immediate localStorage write, not debounced).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Mock ALL browser APIs before importing wallet ──────────── */
const mockStorage = {};
vi.stubGlobal('localStorage', {
    getItem: vi.fn(k => mockStorage[k] ?? null),
    setItem: vi.fn((k, v) => { mockStorage[k] = v; }),
    removeItem: vi.fn(k => { delete mockStorage[k]; }),
});
vi.stubGlobal('crypto', {
    randomUUID: () => 'test-device-uuid-persist',
    getRandomValues: (buf) => {
        for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 0xFFFFFFFF);
        return buf;
    },
});
vi.stubGlobal('window', {
    ...globalThis.window,
    addEventListener: vi.fn(),
});
vi.stubGlobal('sessionStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
});

import {
    credit,
    adminAdjust,
    getTotalBalance,
} from '../lib/wallet.js';

/* ── Helpers ─────────────────────────────────────────────────── */

function makeWallet(overrides = {}) {
    return {
        deviceId: 'test-dev-persist',
        nick: 'Alice',
        baseBalance: 500,
        adminBonus: 200,
        lastRefreshDate: '2026-01-01',
        history: [],
        ...overrides,
    };
}

beforeEach(() => {
    Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    vi.clearAllMocks();
});

/* ═══════════════════════════════════════════════════════════════
   credit() — synchronous save
   ═══════════════════════════════════════════════════════════════ */

describe('credit() persistence', () => {
    it('calls saveWalletSync (synchronous, not debounced)', () => {
        const wallet = makeWallet();
        credit(wallet, 200, 'Winnings');

        // saveWalletSync writes to localStorage.setItem immediately
        expect(localStorage.setItem).toHaveBeenCalled();
    });

    it('wallet is in localStorage immediately after credit (no 1s delay)', () => {
        const wallet = makeWallet({ deviceId: 'test-dev-persist' });
        const updated = credit(wallet, 300, 'Roulette win');

        // Verify localStorage was written synchronously
        const key = `openwire_wallet_dev_${wallet.deviceId}`;
        expect(mockStorage[key]).toBeDefined();

        const stored = JSON.parse(mockStorage[key]);
        expect(stored.baseBalance).toBe(800); // 500 + 300
    });
});

/* ═══════════════════════════════════════════════════════════════
   adminAdjust() — synchronous save
   ═══════════════════════════════════════════════════════════════ */

describe('adminAdjust() persistence', () => {
    it('calls saveWalletSync (synchronous, not debounced)', () => {
        const wallet = makeWallet();
        adminAdjust(wallet, 100, 'Admin bonus');

        expect(localStorage.setItem).toHaveBeenCalled();
    });

    it('wallet is in localStorage immediately after adminAdjust (no 1s delay)', () => {
        const wallet = makeWallet({ deviceId: 'test-dev-persist' });
        adminAdjust(wallet, 500, 'Promo');

        const key = `openwire_wallet_dev_${wallet.deviceId}`;
        expect(mockStorage[key]).toBeDefined();

        const stored = JSON.parse(mockStorage[key]);
        expect(stored.adminBonus).toBe(700); // 200 + 500
    });
});

/* ═══════════════════════════════════════════════════════════════
   Verify synchronous (not debounced) behavior
   ═══════════════════════════════════════════════════════════════ */

describe('Synchronous vs debounced save', () => {
    it('credit writes to localStorage without needing timer advancement', () => {
        vi.useFakeTimers();
        const wallet = makeWallet({ deviceId: 'test-dev-persist' });

        credit(wallet, 100, 'Win');

        // Without advancing timers, the value should already be persisted
        const key = `openwire_wallet_dev_${wallet.deviceId}`;
        expect(mockStorage[key]).toBeDefined();

        const stored = JSON.parse(mockStorage[key]);
        expect(stored.baseBalance).toBe(600);

        vi.useRealTimers();
    });

    it('adminAdjust writes to localStorage without needing timer advancement', () => {
        vi.useFakeTimers();
        const wallet = makeWallet({ deviceId: 'test-dev-persist' });

        adminAdjust(wallet, 50, 'Bonus');

        const key = `openwire_wallet_dev_${wallet.deviceId}`;
        expect(mockStorage[key]).toBeDefined();

        const stored = JSON.parse(mockStorage[key]);
        expect(stored.adminBonus).toBe(250);

        vi.useRealTimers();
    });
});
