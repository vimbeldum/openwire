import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Mock browser globals before any imports ────────────────── */
const mockStorage = {};
vi.stubGlobal('localStorage', {
    getItem:    vi.fn(k => mockStorage[k] ?? null),
    setItem:    vi.fn((k, v) => { mockStorage[k] = v; }),
    removeItem: vi.fn(k => { delete mockStorage[k]; }),
});
vi.stubGlobal('crypto', {
    randomUUID: () => 'test-device-uuid',
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
    getItem:    vi.fn(() => null),
    setItem:    vi.fn(),
    removeItem: vi.fn(),
});

import {
    MIN_STAKE,
    MAX_STAKE,
    RATE,
    PENALTY_HOURS,
    calculateInterest,
    getVaultState,
    stake,
    withdraw,
    getVaultSummary,
} from '../lib/vault.js';

/* ── Helpers ─────────────────────────────────────────────── */
const NOW = 1_700_000_000_000; // fixed reference timestamp (ms)

function makeWallet(overrides = {}) {
    return {
        deviceId:    'test-dev',
        nick:        'Alice',
        baseBalance: 1000,
        adminBonus:  0,
        history:     [],
        ...overrides,
    };
}

function makeProfile(vaultOverrides = {}) {
    return {
        id:   'player-1',
        vault: {
            staked:   0,
            stakedAt: null,
            ...vaultOverrides,
        },
    };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    vi.clearAllMocks();
});

afterEach(() => {
    vi.useRealTimers();
});

/* ═══════════════════════════════════════════════════════════
   1 — Constants
   ═══════════════════════════════════════════════════════════ */

describe('Constants', () => {
    it('MIN_STAKE is 100', () => expect(MIN_STAKE).toBe(100));
    it('MAX_STAKE is 10000', () => expect(MAX_STAKE).toBe(10000));
    it('RATE is 0.02', () => expect(RATE).toBe(0.02));
    it('PENALTY_HOURS is 12', () => expect(PENALTY_HOURS).toBe(12));
});

/* ═══════════════════════════════════════════════════════════
   2 — calculateInterest
   ═══════════════════════════════════════════════════════════ */

describe('calculateInterest', () => {
    it('returns 0 when called at the same moment as stakedAt', () => {
        expect(calculateInterest(100, NOW)).toBe(0);
    });

    it('returns 2 after exactly 24h (2% on 100)', () => {
        const stakedAt = NOW - 24 * 3_600_000;
        expect(calculateInterest(100, stakedAt)).toBe(2);
    });

    it('returns 4 after 48h (compound: floor(100 * 1.02^2 - 100) = 4)', () => {
        const stakedAt = NOW - 48 * 3_600_000;
        const expected = Math.floor(100 * Math.pow(1.02, 2) - 100); // 4
        expect(calculateInterest(100, stakedAt)).toBe(expected);
    });

    it('floors fractional chips (no decimals)', () => {
        const stakedAt = NOW - 12 * 3_600_000; // 12h = 0.5 periods
        const result   = calculateInterest(100, stakedAt);
        expect(Number.isInteger(result)).toBe(true);
    });

    it('scales linearly with principal', () => {
        const stakedAt = NOW - 24 * 3_600_000;
        expect(calculateInterest(500, stakedAt)).toBe(10); // 2% of 500
    });

    it('returns 0 for a principal of 0', () => {
        const stakedAt = NOW - 24 * 3_600_000;
        expect(calculateInterest(0, stakedAt)).toBe(0);
    });
});

/* ═══════════════════════════════════════════════════════════
   3 — getVaultState
   ═══════════════════════════════════════════════════════════ */

describe('getVaultState', () => {
    it('returns zeroes when nothing is staked', () => {
        const profile = makeProfile();
        const state   = getVaultState(profile);
        expect(state.staked).toBe(0);
        expect(state.interestAccrued).toBe(0);
        expect(state.hoursStaked).toBe(0);
        expect(state.penaltyApplies).toBe(false);
    });

    it('penaltyApplies is true when hoursStaked < PENALTY_HOURS', () => {
        const stakedAt = NOW - 6 * 3_600_000; // only 6h ago
        const profile  = makeProfile({ staked: 500, stakedAt });
        const state    = getVaultState(profile);
        expect(state.penaltyApplies).toBe(true);
    });

    it('penaltyApplies is false when hoursStaked >= PENALTY_HOURS', () => {
        const stakedAt = NOW - 13 * 3_600_000; // 13h ago
        const profile  = makeProfile({ staked: 500, stakedAt });
        const state    = getVaultState(profile);
        expect(state.penaltyApplies).toBe(false);
    });

    it('returns correct interestAccrued after 24h', () => {
        const stakedAt = NOW - 24 * 3_600_000;
        const profile  = makeProfile({ staked: 1000, stakedAt });
        const state    = getVaultState(profile);
        expect(state.interestAccrued).toBe(20); // 2% of 1000
    });

    it('hoursStaked reflects elapsed time', () => {
        const stakedAt = NOW - 10 * 3_600_000;
        const profile  = makeProfile({ staked: 200, stakedAt });
        const state    = getVaultState(profile);
        expect(state.hoursStaked).toBeCloseTo(10, 5);
    });
});

/* ═══════════════════════════════════════════════════════════
   4 — stake
   ═══════════════════════════════════════════════════════════ */

describe('stake', () => {
    it('fails with invalid_amount when amount is 0', () => {
        const result = stake(makeProfile(), makeWallet(), 0);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('invalid_amount');
    });

    it('fails with invalid_amount when amount is negative', () => {
        const result = stake(makeProfile(), makeWallet(), -50);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('invalid_amount');
    });

    it('fails when amount is below MIN_STAKE', () => {
        const result = stake(makeProfile(), makeWallet(), 50);
        expect(result.success).toBe(false);
        expect(result.reason).toContain('minimum_stake');
    });

    it('fails when adding amount would exceed MAX_STAKE', () => {
        const profile = makeProfile({ staked: 9500, stakedAt: NOW });
        const result  = stake(profile, makeWallet({ baseBalance: 10000 }), 600);
        expect(result.success).toBe(false);
        expect(result.reason).toContain('max_stake_exceeded');
    });

    it('fails when wallet cannot afford the amount', () => {
        const result = stake(makeProfile(), makeWallet({ baseBalance: 50, adminBonus: 0 }), 200);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('insufficient_balance');
    });

    it('deducts amount from wallet baseBalance on success', () => {
        const wallet = makeWallet({ baseBalance: 500 });
        const { success, wallet: w } = stake(makeProfile(), wallet, 200);
        expect(success).toBe(true);
        expect(w.baseBalance).toBe(300);
    });

    it('deducts from adminBonus when baseBalance insufficient', () => {
        const wallet = makeWallet({ baseBalance: 50, adminBonus: 500 });
        const { success, wallet: w } = stake(makeProfile(), wallet, 200);
        expect(success).toBe(true);
        expect(w.baseBalance).toBe(0);
        expect(w.adminBonus).toBe(350);
    });

    it('updates profile.vault.staked correctly', () => {
        const { success, profile: p } = stake(makeProfile(), makeWallet(), 300);
        expect(success).toBe(true);
        expect(p.vault.staked).toBe(300);
    });

    it('sets profile.vault.stakedAt to current timestamp', () => {
        const { profile: p } = stake(makeProfile(), makeWallet(), 100);
        expect(p.vault.stakedAt).toBe(NOW);
    });

    it('accumulates staked amount on top of existing stake', () => {
        const profile = makeProfile({ staked: 200, stakedAt: NOW - 3_600_000 });
        const { profile: p } = stake(profile, makeWallet({ baseBalance: 500 }), 100);
        expect(p.vault.staked).toBe(300);
    });

    it('does not mutate original profile', () => {
        const profile = makeProfile();
        stake(profile, makeWallet(), 100);
        expect(profile.vault.staked).toBe(0);
    });

    it('does not mutate original wallet', () => {
        const wallet = makeWallet({ baseBalance: 500 });
        stake(makeProfile(), wallet, 100);
        expect(wallet.baseBalance).toBe(500);
    });

    it('appends to wallet history', () => {
        const { wallet: w } = stake(makeProfile(), makeWallet(), 100);
        const lastEntry = w.history[w.history.length - 1];
        expect(lastEntry.reason).toBe('Vault stake');
        expect(lastEntry.amount).toBe(-100);
    });

    it('persists wallet synchronously to localStorage after stake', () => {
        const wallet = makeWallet({ baseBalance: 500, deviceId: 'test-dev-vault' });
        const { success } = stake(makeProfile(), wallet, 200);
        expect(success).toBe(true);
        // Wallet should be saved synchronously to localStorage
        const stored = localStorage.getItem('openwire_wallet_dev_test-dev-vault');
        expect(stored).not.toBeNull();
        const parsed = JSON.parse(stored);
        expect(parsed.baseBalance).toBe(300);
    });
});

/* ═══════════════════════════════════════════════════════════
   5 — withdraw
   ═══════════════════════════════════════════════════════════ */

describe('withdraw', () => {
    it('fails when nothing is staked', () => {
        const result = withdraw(makeProfile(), makeWallet());
        expect(result.success).toBe(false);
        expect(result.reason).toBe('nothing_staked');
    });

    it('returns staked + interest when > PENALTY_HOURS', () => {
        const stakedAt = NOW - 24 * 3_600_000; // 24h ago
        const profile  = makeProfile({ staked: 1000, stakedAt });
        const { success, amount, penaltyApplied } = withdraw(profile, makeWallet());
        expect(success).toBe(true);
        expect(penaltyApplied).toBe(false);
        expect(amount).toBe(1020); // 1000 + 2% interest
    });

    it('returns staked only (forfeits interest) when < PENALTY_HOURS', () => {
        const stakedAt = NOW - 6 * 3_600_000; // only 6h
        const profile  = makeProfile({ staked: 500, stakedAt });
        const { success, amount, penaltyApplied } = withdraw(profile, makeWallet());
        expect(success).toBe(true);
        expect(penaltyApplied).toBe(true);
        expect(amount).toBe(500); // no interest
    });

    it('credits amount to wallet.baseBalance', () => {
        const stakedAt = NOW - 24 * 3_600_000;
        const profile  = makeProfile({ staked: 200, stakedAt });
        const wallet   = makeWallet({ baseBalance: 100 });
        const { wallet: w } = withdraw(profile, wallet);
        expect(w.baseBalance).toBe(100 + 200 + calculateInterest(200, stakedAt));
    });

    it('resets vault.staked to 0 after withdrawal', () => {
        const stakedAt = NOW - 24 * 3_600_000;
        const profile  = makeProfile({ staked: 300, stakedAt });
        const { profile: p } = withdraw(profile, makeWallet());
        expect(p.vault.staked).toBe(0);
    });

    it('resets vault.stakedAt to null after withdrawal', () => {
        const stakedAt = NOW - 24 * 3_600_000;
        const profile  = makeProfile({ staked: 300, stakedAt });
        const { profile: p } = withdraw(profile, makeWallet());
        expect(p.vault.stakedAt).toBeNull();
    });

    it('does not mutate original profile', () => {
        const stakedAt = NOW - 24 * 3_600_000;
        const profile  = makeProfile({ staked: 300, stakedAt });
        withdraw(profile, makeWallet());
        expect(profile.vault.staked).toBe(300);
    });

    it('does not mutate original wallet', () => {
        const stakedAt = NOW - 24 * 3_600_000;
        const wallet   = makeWallet({ baseBalance: 100 });
        withdraw(makeProfile({ staked: 200, stakedAt }), wallet);
        expect(wallet.baseBalance).toBe(100);
    });

    it('appends to wallet history with correct reason when no penalty', () => {
        const stakedAt = NOW - 24 * 3_600_000;
        const profile  = makeProfile({ staked: 100, stakedAt });
        const { wallet: w } = withdraw(profile, makeWallet());
        const lastEntry = w.history[w.history.length - 1];
        expect(lastEntry.reason).toBe('Vault withdraw');
    });

    it('appends to wallet history with early-penalty reason', () => {
        const stakedAt = NOW - 3 * 3_600_000;
        const profile  = makeProfile({ staked: 100, stakedAt });
        const { wallet: w } = withdraw(profile, makeWallet());
        const lastEntry = w.history[w.history.length - 1];
        expect(lastEntry.reason).toContain('early');
    });

    it('handles profile with no vault object (nullish coalescing)', () => {
        const profile = { vault: undefined };
        const result = withdraw(profile, makeWallet());
        expect(result.success).toBe(false);
        expect(result.reason).toBe('nothing_staked');
    });

    it('handles vault with undefined staked/stakedAt', () => {
        const profile = { vault: { staked: undefined, stakedAt: undefined } };
        const result = withdraw(profile, makeWallet());
        expect(result.success).toBe(false);
    });

    it('handles wallet with missing baseBalance (nullish coalescing)', () => {
        const stakedAt = NOW - 24 * 3_600_000;
        const profile  = makeProfile({ staked: 100, stakedAt });
        const wallet = { history: [] }; // no baseBalance
        const { wallet: w } = withdraw(profile, wallet);
        expect(w.baseBalance).toBeGreaterThan(0);
    });

    it('handles wallet with missing history (nullish coalescing)', () => {
        const stakedAt = NOW - 24 * 3_600_000;
        const profile  = makeProfile({ staked: 100, stakedAt });
        const wallet = { baseBalance: 500 }; // no history
        const { wallet: w } = withdraw(profile, wallet);
        expect(w.history.length).toBe(1);
    });
});

/* ═══════════════════════════════════════════════════════════
   6 — getVaultSummary
   ═══════════════════════════════════════════════════════════ */

describe('getVaultSummary', () => {
    it('returns "No chips staked" when vault is empty', () => {
        const profile = makeProfile();
        expect(getVaultSummary(profile)).toBe('No chips staked');
    });

    it('includes staked amount in summary string', () => {
        const profile = makeProfile({ staked: 500, stakedAt: NOW - 3_600_000 });
        expect(getVaultSummary(profile)).toContain('500');
    });

    it('includes Interest label in summary string', () => {
        const profile = makeProfile({ staked: 500, stakedAt: NOW - 3_600_000 });
        expect(getVaultSummary(profile)).toContain('Interest');
    });

    it('includes Time label in summary string', () => {
        const profile = makeProfile({ staked: 500, stakedAt: NOW - 3_600_000 });
        expect(getVaultSummary(profile)).toContain('Time');
    });
});
