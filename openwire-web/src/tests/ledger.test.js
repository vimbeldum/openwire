import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Mock browser APIs before importing modules ────────────────── */
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
const listeners = {};
vi.stubGlobal('window', {
    ...globalThis.window,
    addEventListener: vi.fn((event, fn) => { listeners[event] = fn; }),
});
vi.stubGlobal('sessionStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
});

/* ── Mock the wallet module so ledger tests don't depend on real wallet logic ── */
vi.mock('../lib/wallet.js', () => ({
    credit: vi.fn((wallet, amount, reason) => ({
        ...wallet,
        baseBalance: wallet.baseBalance + amount,
        history: [...(wallet.history || []), { reason, amount }],
    })),
    debit: vi.fn((wallet) => wallet),
    saveWallet: vi.fn(),
    saveWalletSync: vi.fn(),
    getDeviceId: vi.fn(() => 'test-device-uuid'),
    getTotalBalance: vi.fn((w) => (w.baseBalance || 0) + (w.adminBonus || 0)),
    loadWallet: vi.fn(),
    canAfford: vi.fn(),
    adminAdjust: vi.fn(),
    DAILY_BASE: 1000,
}));

import { record, getHistory, clearHistory, processEvent, getStats, _resetCache } from '../lib/core/ledger.js';
import * as walletLib from '../lib/wallet.js';

const DEVICE_ID = 'dev-001';
const LEDGER_KEY = `openwire_ledger_${DEVICE_ID}`;

beforeEach(() => {
    Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    _resetCache();
    vi.clearAllMocks();
});

/* ── Helper: make a wallet object ── */
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
   1 -- record()
   ═══════════════════════════════════════════════════════════════ */

describe('record()', () => {
    it('appends an event to an empty history', () => {
        const event = { gameType: 'roulette', financial: true };
        record(DEVICE_ID, event);

        const stored = JSON.parse(mockStorage[LEDGER_KEY]);
        expect(stored).toHaveLength(1);
        expect(stored[0]).toEqual(event);
    });

    it('appends to existing history', () => {
        mockStorage[LEDGER_KEY] = JSON.stringify([{ gameType: 'blackjack' }]);
        const event = { gameType: 'roulette' };
        record(DEVICE_ID, event);

        const stored = JSON.parse(mockStorage[LEDGER_KEY]);
        expect(stored).toHaveLength(2);
        expect(stored[1].gameType).toBe('roulette');
    });

    it('caps history at MAX_EVENTS (500), dropping oldest entries', () => {
        const existing = Array.from({ length: 500 }, (_, i) => ({ id: i }));
        mockStorage[LEDGER_KEY] = JSON.stringify(existing);

        record(DEVICE_ID, { id: 'new' });

        const stored = JSON.parse(mockStorage[LEDGER_KEY]);
        expect(stored).toHaveLength(500);
        // The oldest (id: 0) should have been dropped
        expect(stored[0].id).toBe(1);
        expect(stored[stored.length - 1].id).toBe('new');
    });

    it('handles localStorage.getItem failure gracefully', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        localStorage.getItem.mockImplementationOnce(() => { throw new Error('quota exceeded'); });

        // Should not throw
        expect(() => record(DEVICE_ID, { gameType: 'roulette' })).not.toThrow();
        expect(warnSpy).toHaveBeenCalledWith(
            '[Ledger] Failed to record event:',
            expect.any(Error),
        );
        warnSpy.mockRestore();
    });

    it('handles localStorage.setItem failure gracefully', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        localStorage.setItem.mockImplementationOnce(() => { throw new Error('storage full'); });

        expect(() => record(DEVICE_ID, { gameType: 'roulette' })).not.toThrow();
        expect(warnSpy).toHaveBeenCalledWith(
            '[Ledger] Failed to record event:',
            expect.any(Error),
        );
        warnSpy.mockRestore();
    });

    it('handles corrupt JSON in localStorage', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockStorage[LEDGER_KEY] = '{{{invalid json';

        expect(() => record(DEVICE_ID, { gameType: 'roulette' })).not.toThrow();
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});

/* ═══════════════════════════════════════════════════════════════
   2 -- getHistory()
   ═══════════════════════════════════════════════════════════════ */

describe('getHistory()', () => {
    it('returns events in newest-first order', () => {
        const events = [{ id: 1 }, { id: 2 }, { id: 3 }];
        mockStorage[LEDGER_KEY] = JSON.stringify(events);

        const history = getHistory(DEVICE_ID);
        expect(history).toEqual([{ id: 3 }, { id: 2 }, { id: 1 }]);
    });

    it('returns empty array when no history exists', () => {
        const history = getHistory(DEVICE_ID);
        expect(history).toEqual([]);
    });

    it('returns empty array for corrupt JSON data', () => {
        mockStorage[LEDGER_KEY] = '!!!not-json';

        const history = getHistory(DEVICE_ID);
        expect(history).toEqual([]);
    });

    it('does not mutate the stored array', () => {
        const events = [{ id: 1 }, { id: 2 }];
        mockStorage[LEDGER_KEY] = JSON.stringify(events);

        getHistory(DEVICE_ID);

        // Original stored data should be unchanged
        const stored = JSON.parse(mockStorage[LEDGER_KEY]);
        expect(stored).toEqual([{ id: 1 }, { id: 2 }]);
    });
});

/* ═══════════════════════════════════════════════════════════════
   3 -- clearHistory()
   ═══════════════════════════════════════════════════════════════ */

describe('clearHistory()', () => {
    it('removes the ledger key from localStorage', () => {
        mockStorage[LEDGER_KEY] = JSON.stringify([{ id: 1 }]);

        clearHistory(DEVICE_ID);

        expect(localStorage.removeItem).toHaveBeenCalledWith(LEDGER_KEY);
        expect(mockStorage[LEDGER_KEY]).toBeUndefined();
    });

    it('does not throw when key does not exist', () => {
        expect(() => clearHistory(DEVICE_ID)).not.toThrow();
        expect(localStorage.removeItem).toHaveBeenCalledWith(LEDGER_KEY);
    });
});

/* ═══════════════════════════════════════════════════════════════
   4 -- processEvent()
   ═══════════════════════════════════════════════════════════════ */

describe('processEvent()', () => {
    const MY_ID = 'peer-abc';

    it('updates wallet and records for financial events', () => {
        const wallet = makeWallet();
        const event = {
            financial: true,
            gameType: 'roulette',
            totals: { [MY_ID]: 100 },
            breakdown: [{ peer_id: MY_ID, wager: 50 }],
        };

        const result = processEvent(wallet, event, MY_ID, DEVICE_ID);

        // Should have called walletLib.credit (via applyEventToWallet)
        expect(walletLib.credit).toHaveBeenCalled();
        // Event should be recorded in localStorage
        const stored = JSON.parse(mockStorage[LEDGER_KEY]);
        expect(stored).toHaveLength(1);
        expect(stored[0]).toEqual(event);
        expect(result.event).toEqual(event);
    });

    it('records but does NOT update wallet for non-financial events', () => {
        const wallet = makeWallet();
        const event = {
            financial: false,
            gameType: 'tictactoe',
            playerStats: [{ peer_id: MY_ID, outcome: 'win' }],
        };

        const result = processEvent(wallet, event, MY_ID, DEVICE_ID);

        // Wallet should be unchanged (same reference)
        expect(result.updatedWallet).toBe(wallet);
        expect(walletLib.credit).not.toHaveBeenCalled();
        // But event should still be recorded
        const stored = JSON.parse(mockStorage[LEDGER_KEY]);
        expect(stored).toHaveLength(1);
    });

    it('returns unchanged wallet when player not in totals', () => {
        const wallet = makeWallet();
        const event = {
            financial: true,
            gameType: 'blackjack',
            totals: { 'other-peer': 200 },
            breakdown: [{ peer_id: 'other-peer', wager: 100 }],
        };

        const result = processEvent(wallet, event, MY_ID, DEVICE_ID);

        // applyEventToWallet returns unchanged wallet when myId not in totals
        expect(result.updatedWallet).toBe(wallet);
    });

    it('always returns the event in the result', () => {
        const wallet = makeWallet();
        const event = { financial: false, gameType: 'tictactoe' };

        const result = processEvent(wallet, event, MY_ID, DEVICE_ID);
        expect(result.event).toBe(event);
    });
});

/* ═══════════════════════════════════════════════════════════════
   5 -- applyEventToWallet() (tested indirectly via processEvent)
   ═══════════════════════════════════════════════════════════════ */

describe('applyEventToWallet (via processEvent)', () => {
    const MY_ID = 'peer-abc';

    it('sums totalWager from breakdown entries for the player', () => {
        const wallet = makeWallet();
        const event = {
            financial: true,
            gameType: 'roulette',
            totals: { [MY_ID]: 50 },
            breakdown: [
                { peer_id: MY_ID, wager: 30 },
                { peer_id: MY_ID, wager: 20 },
                { peer_id: 'other', wager: 100 },
            ],
        };

        processEvent(wallet, event, MY_ID, DEVICE_ID);

        // totalWager = 30 + 20 = 50, net = 50, credit = 50 + 50 = 100
        expect(walletLib.credit).toHaveBeenCalledWith(wallet, 100, 'roulette win');
    });

    it('does not credit when creditAmount <= 0 (loss)', () => {
        const wallet = makeWallet();
        const event = {
            financial: true,
            gameType: 'blackjack',
            totals: { [MY_ID]: -100 },
            breakdown: [{ peer_id: MY_ID, wager: 100 }],
        };

        processEvent(wallet, event, MY_ID, DEVICE_ID);

        // totalWager = 100, net = -100, credit = 0 -> guard returns early
        expect(walletLib.credit).not.toHaveBeenCalled();
    });

    it('labels reason as "push" when net is 0', () => {
        const wallet = makeWallet();
        const event = {
            financial: true,
            gameType: 'blackjack',
            totals: { [MY_ID]: 0 },
            breakdown: [{ peer_id: MY_ID, wager: 100 }],
        };

        processEvent(wallet, event, MY_ID, DEVICE_ID);

        // totalWager = 100, net = 0, credit = 100 > 0 -> should credit
        // net <= 0, so reason = "blackjack push"
        expect(walletLib.credit).toHaveBeenCalledWith(wallet, 100, 'blackjack push');
    });

    it('labels reason as "win" when net > 0', () => {
        const wallet = makeWallet();
        const event = {
            financial: true,
            gameType: 'roulette',
            totals: { [MY_ID]: 200 },
            breakdown: [{ peer_id: MY_ID, wager: 100 }],
        };

        processEvent(wallet, event, MY_ID, DEVICE_ID);

        // totalWager = 100, net = 200, credit = 300 -> "roulette win"
        expect(walletLib.credit).toHaveBeenCalledWith(wallet, 300, 'roulette win');
    });

    it('handles missing breakdown gracefully', () => {
        const wallet = makeWallet();
        const event = {
            financial: true,
            gameType: 'roulette',
            totals: { [MY_ID]: 50 },
            // no breakdown field
        };

        processEvent(wallet, event, MY_ID, DEVICE_ID);

        // totalWager = 0 (no breakdown), net = 50, credit = 50 > 0
        expect(walletLib.credit).toHaveBeenCalledWith(wallet, 50, 'roulette win');
    });

    it('handles breakdown entries with missing wager field', () => {
        const wallet = makeWallet();
        const event = {
            financial: true,
            gameType: 'roulette',
            totals: { [MY_ID]: 50 },
            breakdown: [{ peer_id: MY_ID }], // wager is undefined
        };

        processEvent(wallet, event, MY_ID, DEVICE_ID);

        // totalWager = 0 (undefined wager -> 0), net = 50, credit = 50
        expect(walletLib.credit).toHaveBeenCalledWith(wallet, 50, 'roulette win');
    });
});

/* ═══════════════════════════════════════════════════════════════
   6 -- getStats()
   ═══════════════════════════════════════════════════════════════ */

describe('getStats()', () => {
    const MY_ID = 'peer-abc';

    it('aggregates financial wins, losses, and pushes per game', () => {
        const events = [
            { financial: true, gameType: 'roulette', totals: { [MY_ID]: 100 } },
            { financial: true, gameType: 'roulette', totals: { [MY_ID]: -50 } },
            { financial: true, gameType: 'roulette', totals: { [MY_ID]: 0 } },
            { financial: true, gameType: 'blackjack', totals: { [MY_ID]: 200 } },
        ];
        mockStorage[LEDGER_KEY] = JSON.stringify(events);

        const stats = getStats(DEVICE_ID, MY_ID);

        expect(stats.roulette).toEqual({ wins: 1, losses: 1, pushes: 1, totalNet: 50 });
        expect(stats.blackjack).toEqual({ wins: 1, losses: 0, pushes: 0, totalNet: 200 });
    });

    it('counts non-financial outcomes from playerStats', () => {
        const events = [
            {
                financial: false,
                gameType: 'tictactoe',
                playerStats: [{ peer_id: MY_ID, outcome: 'win' }],
            },
            {
                financial: false,
                gameType: 'tictactoe',
                playerStats: [{ peer_id: MY_ID, outcome: 'loss' }],
            },
            {
                financial: false,
                gameType: 'tictactoe',
                playerStats: [{ peer_id: MY_ID, outcome: 'draw' }],
            },
        ];
        mockStorage[LEDGER_KEY] = JSON.stringify(events);

        const stats = getStats(DEVICE_ID, MY_ID);

        expect(stats.tictactoe).toEqual({ wins: 1, losses: 1, pushes: 1, totalNet: 0 });
    });

    it('returns empty object when no history exists', () => {
        const stats = getStats(DEVICE_ID, MY_ID);
        expect(stats).toEqual({});
    });

    it('ignores financial events where player is not in totals', () => {
        const events = [
            { financial: true, gameType: 'roulette', totals: { 'other-peer': 100 } },
        ];
        mockStorage[LEDGER_KEY] = JSON.stringify(events);

        const stats = getStats(DEVICE_ID, MY_ID);

        // Player not in totals -> net defaults to 0 -> counted as push
        expect(stats.roulette).toEqual({ wins: 0, losses: 0, pushes: 1, totalNet: 0 });
    });

    it('skips non-financial events where player is not in playerStats', () => {
        const events = [
            {
                financial: false,
                gameType: 'tictactoe',
                playerStats: [{ peer_id: 'other-peer', outcome: 'win' }],
            },
        ];
        mockStorage[LEDGER_KEY] = JSON.stringify(events);

        const stats = getStats(DEVICE_ID, MY_ID);

        // Game type entry is created but no win/loss/push counted for our player
        expect(stats.tictactoe).toEqual({ wins: 0, losses: 0, pushes: 0, totalNet: 0 });
    });

    it('aggregates across multiple game types', () => {
        const events = [
            { financial: true, gameType: 'roulette', totals: { [MY_ID]: 100 } },
            { financial: true, gameType: 'blackjack', totals: { [MY_ID]: -50 } },
            { financial: false, gameType: 'tictactoe', playerStats: [{ peer_id: MY_ID, outcome: 'win' }] },
        ];
        mockStorage[LEDGER_KEY] = JSON.stringify(events);

        const stats = getStats(DEVICE_ID, MY_ID);

        expect(Object.keys(stats)).toHaveLength(3);
        expect(stats.roulette.wins).toBe(1);
        expect(stats.blackjack.losses).toBe(1);
        expect(stats.tictactoe.wins).toBe(1);
    });

    it('handles events with missing totals gracefully', () => {
        const events = [
            { financial: true, gameType: 'roulette' }, // no totals
        ];
        mockStorage[LEDGER_KEY] = JSON.stringify(events);

        const stats = getStats(DEVICE_ID, MY_ID);

        // totals?.[myId] ?? 0 -> 0 -> push
        expect(stats.roulette).toEqual({ wins: 0, losses: 0, pushes: 1, totalNet: 0 });
    });

    it('handles events with missing playerStats gracefully', () => {
        const events = [
            { financial: false, gameType: 'tictactoe' }, // no playerStats
        ];
        mockStorage[LEDGER_KEY] = JSON.stringify(events);

        const stats = getStats(DEVICE_ID, MY_ID);

        // playerStats?.find() returns undefined -> no count incremented
        expect(stats.tictactoe).toEqual({ wins: 0, losses: 0, pushes: 0, totalNet: 0 });
    });
});
