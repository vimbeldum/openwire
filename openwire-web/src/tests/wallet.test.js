import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Mock ALL browser APIs before importing wallet ──────────── */
const mockStorage = {};
vi.stubGlobal('localStorage', {
    getItem: vi.fn(k => mockStorage[k] ?? null),
    setItem: vi.fn((k, v) => { mockStorage[k] = v; }),
    removeItem: vi.fn(k => { delete mockStorage[k]; }),
});
vi.stubGlobal('crypto', {
    randomUUID: () => 'test-device-uuid',
    getRandomValues: (buf) => {
        for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 0xFFFFFFFF);
        return buf;
    },
});
// Mock window.addEventListener (used at module level for beforeunload)
const listeners = {};
vi.stubGlobal('window', {
    ...globalThis.window,
    addEventListener: vi.fn((event, fn) => {
        listeners[event] = fn;
    }),
});
// Mock sessionStorage for transitive imports (andarbahar -> blackjack -> GameEngine registry)
vi.stubGlobal('sessionStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
});

import {
    DAILY_BASE,
    getTotalBalance,
    canAfford,
    debit,
    credit,
    adminAdjust,
    loadWallet,
    getDeviceId,
    saveWallet,
    saveWalletSync,
    tip,
} from '../lib/wallet.js';

beforeEach(() => {
    Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    vi.clearAllMocks();
    vi.useFakeTimers();
});

/* ── Helper: create a wallet object directly (avoids localStorage side effects) ── */
function makeWallet(overrides = {}) {
    return {
        deviceId: 'test-dev',
        nick: 'Alice',
        baseBalance: 500,
        adminBonus: 200,
        lastRefreshDate: '2026-01-01',
        history: [],
        ...overrides,
    };
}

/* ═══════════════════════════════════════════════════════════════
   1 -- DAILY_BASE constant
   ═══════════════════════════════════════════════════════════════ */

describe('DAILY_BASE', () => {
    it('equals 1000', () => {
        expect(DAILY_BASE).toBe(1000);
    });
});

/* ═══════════════════════════════════════════════════════════════
   2 -- getTotalBalance
   ═══════════════════════════════════════════════════════════════ */

describe('getTotalBalance', () => {
    it('returns sum of baseBalance and adminBonus', () => {
        const wallet = makeWallet({ baseBalance: 500, adminBonus: 200 });
        expect(getTotalBalance(wallet)).toBe(700);
    });

    it('returns baseBalance when adminBonus is 0', () => {
        const wallet = makeWallet({ baseBalance: 1000, adminBonus: 0 });
        expect(getTotalBalance(wallet)).toBe(1000);
    });

    it('handles missing fields gracefully (defaults to 0)', () => {
        expect(getTotalBalance({})).toBe(0);
        expect(getTotalBalance({ baseBalance: 100 })).toBe(100);
        expect(getTotalBalance({ adminBonus: 50 })).toBe(50);
    });
});

/* ═══════════════════════════════════════════════════════════════
   3 -- canAfford
   ═══════════════════════════════════════════════════════════════ */

describe('canAfford', () => {
    it('returns true when total balance >= amount', () => {
        const wallet = makeWallet({ baseBalance: 500, adminBonus: 200 });
        expect(canAfford(wallet, 700)).toBe(true);
        expect(canAfford(wallet, 500)).toBe(true);
    });

    it('returns false when total balance < amount', () => {
        const wallet = makeWallet({ baseBalance: 500, adminBonus: 200 });
        expect(canAfford(wallet, 701)).toBe(false);
    });

    it('returns true when amount is 0', () => {
        const wallet = makeWallet({ baseBalance: 0, adminBonus: 0 });
        expect(canAfford(wallet, 0)).toBe(true);
    });
});

/* ═══════════════════════════════════════════════════════════════
   4 -- debit
   ═══════════════════════════════════════════════════════════════ */

describe('debit', () => {
    it('deducts from baseBalance first', () => {
        const wallet = makeWallet({ baseBalance: 500, adminBonus: 200 });
        const updated = debit(wallet, 300, 'Bet');
        expect(updated.baseBalance).toBe(200);
        expect(updated.adminBonus).toBe(200);
    });

    it('spills over to adminBonus when baseBalance is insufficient', () => {
        const wallet = makeWallet({ baseBalance: 100, adminBonus: 200 });
        const updated = debit(wallet, 250, 'Bet');
        expect(updated.baseBalance).toBe(0);
        expect(updated.adminBonus).toBe(50);
    });

    it('returns unchanged wallet when cannot afford', () => {
        const wallet = makeWallet({ baseBalance: 100, adminBonus: 50 });
        const updated = debit(wallet, 200, 'Bet');
        expect(updated).toBe(wallet); // same reference, unchanged
    });

    it('never produces negative balances', () => {
        const wallet = makeWallet({ baseBalance: 100, adminBonus: 200 });
        const updated = debit(wallet, 300, 'Bet');
        expect(updated.baseBalance).toBeGreaterThanOrEqual(0);
        expect(updated.adminBonus).toBeGreaterThanOrEqual(0);
    });

    it('deducts exact amount from baseBalance when enough', () => {
        const wallet = makeWallet({ baseBalance: 500, adminBonus: 0 });
        const updated = debit(wallet, 500, 'Bet');
        expect(updated.baseBalance).toBe(0);
        expect(updated.adminBonus).toBe(0);
    });

    it('appends to history', () => {
        const wallet = makeWallet({ history: [{ time: 1, reason: 'old', amount: 10, balance: 10 }] });
        const updated = debit(wallet, 100, 'Test bet');
        expect(updated.history.length).toBeGreaterThan(1);
        const lastEntry = updated.history[updated.history.length - 1];
        expect(lastEntry.reason).toBe('Test bet');
        expect(lastEntry.amount).toBe(-100);
    });

    it('caps history at 100 entries', () => {
        const wallet = makeWallet({
            baseBalance: 10000,
            history: Array(99).fill({ time: 1, reason: 'x', amount: 1, balance: 1 }),
        });
        const updated = debit(wallet, 10, 'Bet');
        expect(updated.history.length).toBeLessThanOrEqual(100);
    });

    it('calls saveWalletSync (synchronous save)', () => {
        const wallet = makeWallet();
        debit(wallet, 50, 'Bet');
        // saveWalletSync writes to localStorage immediately
        expect(localStorage.setItem).toHaveBeenCalled();
    });
});

/* ═══════════════════════════════════════════════════════════════
   5 -- credit
   ═══════════════════════════════════════════════════════════════ */

describe('credit', () => {
    it('adds game winnings to baseBalance', () => {
        const wallet = makeWallet({ baseBalance: 500, adminBonus: 100 });
        const updated = credit(wallet, 200, 'Winnings');
        expect(updated.baseBalance).toBe(700);
        expect(updated.adminBonus).toBe(100); // unchanged
    });

    it('adds admin grants to adminBonus', () => {
        const wallet = makeWallet({ baseBalance: 500, adminBonus: 100 });
        const updated = credit(wallet, 300, 'Bonus', true);
        expect(updated.baseBalance).toBe(500); // unchanged
        expect(updated.adminBonus).toBe(400);
    });

    it('appends to history with reason', () => {
        const wallet = makeWallet();
        const updated = credit(wallet, 100, 'Roulette win');
        const lastEntry = updated.history[updated.history.length - 1];
        expect(lastEntry.reason).toBe('Roulette win');
        expect(lastEntry.amount).toBe(100);
    });

    it('prefixes admin grant reason in history', () => {
        const wallet = makeWallet();
        const updated = credit(wallet, 500, 'Welcome bonus', true);
        const lastEntry = updated.history[updated.history.length - 1];
        expect(lastEntry.reason).toBe('Admin grant: Welcome bonus');
    });

    it('records correct balance in history entry', () => {
        const wallet = makeWallet({ baseBalance: 300, adminBonus: 100 });
        const updated = credit(wallet, 200, 'Win');
        const lastEntry = updated.history[updated.history.length - 1];
        // getTotalBalance(wallet) + amount = (300 + 100) + 200 = 600
        expect(lastEntry.balance).toBe(600);
    });
});

/* ═══════════════════════════════════════════════════════════════
   6 -- adminAdjust
   ═══════════════════════════════════════════════════════════════ */

describe('adminAdjust', () => {
    it('increases adminBonus by positive delta', () => {
        const wallet = makeWallet({ adminBonus: 100 });
        const updated = adminAdjust(wallet, 50, 'Admin top-up');
        expect(updated.adminBonus).toBe(150);
    });

    it('decreases adminBonus by negative delta', () => {
        const wallet = makeWallet({ adminBonus: 200 });
        const updated = adminAdjust(wallet, -50, 'Admin deduction');
        expect(updated.adminBonus).toBe(150);
    });

    it('clamps adminBonus to 0 (never negative)', () => {
        const wallet = makeWallet({ adminBonus: 50 });
        const updated = adminAdjust(wallet, -100, 'Admin reset');
        expect(updated.adminBonus).toBe(0);
    });

    it('does not touch baseBalance', () => {
        const wallet = makeWallet({ baseBalance: 500, adminBonus: 100 });
        const updated = adminAdjust(wallet, 200, 'Boost');
        expect(updated.baseBalance).toBe(500);
    });

    it('appends to history', () => {
        const wallet = makeWallet();
        const updated = adminAdjust(wallet, 100, 'Promo');
        const lastEntry = updated.history[updated.history.length - 1];
        expect(lastEntry.reason).toBe('Promo');
        expect(lastEntry.amount).toBe(100);
    });

    it('records correct balance in history entry', () => {
        const wallet = makeWallet({ baseBalance: 500, adminBonus: 100 });
        const updated = adminAdjust(wallet, 200, 'Boost');
        const lastEntry = updated.history[updated.history.length - 1];
        // baseBalance + new adminBonus = 500 + 300 = 800
        expect(lastEntry.balance).toBe(800);
    });
});

/* ═══════════════════════════════════════════════════════════════
   7 -- getDeviceId
   ═══════════════════════════════════════════════════════════════ */

describe('getDeviceId', () => {
    it('returns existing device ID from localStorage', () => {
        mockStorage['openwire_device_id'] = 'existing-uuid';
        const id = getDeviceId();
        expect(id).toBe('existing-uuid');
    });

    it('generates and stores a new ID when none exists', () => {
        const id = getDeviceId();
        expect(id).toBeTruthy();
        expect(localStorage.setItem).toHaveBeenCalledWith('openwire_device_id', id);
    });
});

/* ═══════════════════════════════════════════════════════════════
   8 -- loadWallet
   ═══════════════════════════════════════════════════════════════ */

describe('loadWallet', () => {
    it('creates a new wallet with DAILY_BASE when none exists', () => {
        const wallet = loadWallet('Alice');
        expect(wallet.baseBalance).toBe(DAILY_BASE);
        expect(wallet.adminBonus).toBe(0);
        expect(wallet.nick).toBe('Alice');
    });

    it('creates wallet with initial history entry', () => {
        const wallet = loadWallet('Alice');
        expect(wallet.history).toHaveLength(1);
        expect(wallet.history[0].reason).toBe('Daily refresh');
    });

    it('creates fresh wallet when localStorage has corrupt JSON', () => {
        mockStorage['openwire_wallet_dev_test-device-uuid'] = '{CORRUPT!!!}}}';
        const wallet = loadWallet('Alice');
        expect(wallet.baseBalance).toBe(DAILY_BASE);
        expect(wallet.nick).toBe('Alice');
    });

    it('loads existing wallet from localStorage', () => {
        // Pre-populate localStorage with wallet data
        const existing = {
            deviceId: 'test-device-uuid',
            nick: 'OldNick',
            baseBalance: 750,
            adminBonus: 100,
            lastRefreshDate: new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Kolkata',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).format(new Date()), // today in IST
            history: [{ time: 1, reason: 'Initial', amount: 1000, balance: 1000 }],
        };
        mockStorage['openwire_wallet_dev_test-device-uuid'] = JSON.stringify(existing);

        const wallet = loadWallet('NewNick');
        expect(wallet.baseBalance).toBe(750); // preserved, same day
        expect(wallet.nick).toBe('NewNick'); // nick updated
    });

    it('resets baseBalance on new IST day but preserves adminBonus', () => {
        const existing = {
            deviceId: 'test-device-uuid',
            nick: 'Alice',
            baseBalance: 300,
            adminBonus: 500,
            lastRefreshDate: '2020-01-01', // old date
            history: [],
        };
        mockStorage['openwire_wallet_dev_test-device-uuid'] = JSON.stringify(existing);

        const wallet = loadWallet('Alice');
        expect(wallet.baseBalance).toBe(DAILY_BASE); // reset
        expect(wallet.adminBonus).toBe(500); // preserved (adminBonus is not touched by daily refresh)
    });
});

/* ═══════════════════════════════════════════════════════════════
   9 -- Composite operations (debit then credit)
   ═══════════════════════════════════════════════════════════════ */

describe('Composite wallet operations', () => {
    it('debit followed by credit restores balance correctly', () => {
        let wallet = makeWallet({ baseBalance: 500, adminBonus: 0 });
        wallet = debit(wallet, 200, 'Bet');
        wallet = credit(wallet, 400, 'Jackpot');
        expect(wallet.baseBalance).toBe(700);
    });

    it('multiple debits drain baseBalance then adminBonus', () => {
        let wallet = makeWallet({ baseBalance: 300, adminBonus: 100 });
        wallet = debit(wallet, 200, 'Bet 1');
        expect(wallet.baseBalance).toBe(100);
        wallet = debit(wallet, 200, 'Bet 2');
        // 100 from base + 100 from admin = 200
        expect(wallet.baseBalance).toBe(0);
        expect(wallet.adminBonus).toBe(0);
    });

    it('tracks full history across operations', () => {
        let wallet = makeWallet({ history: [] });
        wallet = debit(wallet, 100, 'Bet');
        wallet = credit(wallet, 200, 'Win');
        wallet = adminAdjust(wallet, 50, 'Bonus');
        expect(wallet.history).toHaveLength(3);
    });
});

/* ═══════════════════════════════════════════════════════════════
   10 -- tip() — wallet-to-wallet transfer
   ═══════════════════════════════════════════════════════════════ */

describe('tip()', () => {
    it('transfers amount from sender to receiver', () => {
        const from = makeWallet({ baseBalance: 500, adminBonus: 0, nick: 'Alice' });
        const to = makeWallet({ baseBalance: 200, adminBonus: 0, nick: 'Bob', deviceId: 'device-bob' });
        const result = tip(from, to, 100);
        expect(result.success).toBe(true);
        expect(result.from.baseBalance).toBe(400);
        expect(result.to.baseBalance).toBe(300);
    });

    it('fails with invalid_amount for 0', () => {
        const from = makeWallet();
        const to = makeWallet({ deviceId: 'bob' });
        const result = tip(from, to, 0);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('invalid_amount');
    });

    it('fails with invalid_amount for negative', () => {
        const from = makeWallet();
        const to = makeWallet({ deviceId: 'bob' });
        const result = tip(from, to, -50);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('invalid_amount');
    });

    it('fails with invalid_amount for NaN', () => {
        const from = makeWallet();
        const to = makeWallet({ deviceId: 'bob' });
        const result = tip(from, to, NaN);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('invalid_amount');
    });

    it('fails with invalid_amount for Infinity', () => {
        const from = makeWallet();
        const to = makeWallet({ deviceId: 'bob' });
        const result = tip(from, to, Infinity);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('invalid_amount');
    });

    it('fails with insufficient_balance when sender cannot afford', () => {
        const from = makeWallet({ baseBalance: 50, adminBonus: 0 });
        const to = makeWallet({ deviceId: 'bob' });
        const result = tip(from, to, 100);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('insufficient_balance');
    });

    it('deducts from adminBonus when baseBalance is insufficient', () => {
        const from = makeWallet({ baseBalance: 30, adminBonus: 100, nick: 'Alice' });
        const to = makeWallet({ baseBalance: 200, adminBonus: 0, nick: 'Bob', deviceId: 'bob' });
        const result = tip(from, to, 80);
        expect(result.success).toBe(true);
        expect(result.from.baseBalance).toBe(0);
        expect(result.from.adminBonus).toBe(50); // 100 - 50 (80-30 taken from adminBonus)
    });

    it('adds tip history to both sender and receiver', () => {
        const from = makeWallet({ baseBalance: 500, nick: 'Alice', history: [] });
        const to = makeWallet({ baseBalance: 200, nick: 'Bob', deviceId: 'bob', history: [] });
        const result = tip(from, to, 100);
        expect(result.from.history[0].type).toBe('tip');
        expect(result.from.history[0].amount).toBe(-100);
        expect(result.to.history[0].type).toBe('tip');
        expect(result.to.history[0].amount).toBe(100);
    });

    it('uses deviceId in history when nick is not set', () => {
        const from = makeWallet({ baseBalance: 500, nick: undefined, deviceId: 'dev-from', history: [] });
        const to = makeWallet({ baseBalance: 200, nick: undefined, deviceId: 'dev-to', history: [] });
        const result = tip(from, to, 50);
        expect(result.from.history[0].reason).toContain('dev-to');
        expect(result.to.history[0].reason).toContain('dev-from');
    });
});

/* ═══════════════════════════════════════════════════════════════
   11 -- saveWallet debounce and beforeunload flush
   ═══════════════════════════════════════════════════════════════ */

describe('saveWalletSync() — immediate save', () => {
    it('writes to localStorage immediately', () => {
        vi.clearAllMocks();
        const w = makeWallet({ deviceId: 'test-device-uuid' });
        saveWalletSync(w);
        expect(localStorage.setItem).toHaveBeenCalledWith(
            'openwire_wallet_dev_test-device-uuid',
            JSON.stringify(w),
        );
    });

    it('does not throw when localStorage throws', () => {
        const origSetItem = localStorage.setItem;
        localStorage.setItem = vi.fn(() => { throw new Error('QuotaExceeded'); });
        const w = makeWallet({ deviceId: 'test-device-uuid' });
        expect(() => saveWalletSync(w)).not.toThrow();
        localStorage.setItem = origSetItem;
    });
});
