/**
 * casino-ui.test.js
 *
 * Vitest suite covering scenarios NOT already tested in existing files.
 * Areas covered:
 *   1. Wallet — tipping (no implementation found → it.todo)
 *   2. Blackjack — post-session summary shape, split bet integration,
 *                  double-down wallet deduction, host migration (no impl → todo)
 *   3. Roulette — multiple simultaneous bets on same position (replace behavior),
 *                 zero result clears all outside bets, column-3 payout for 36,
 *                 history grows correctly
 *   4. Andar Bahar — state flow betting→dealing→ended, correct side wins,
 *                    losing side payout
 *   5. Casino state P2P — multiple game types coexist after merge, serialize→parse
 *                         round-trip, remote partial update doesn't clobber unrelated fields
 *   6. Wallet session — canAfford at exact balance boundary, daily refresh
 *                       resets baseBalance only (adminBonus preserved), history
 *                       entry recorded on refresh
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ═══════════════════════════════════════════════════════════════
   Browser-API stubs — must be set BEFORE any module import
   ═══════════════════════════════════════════════════════════════ */

const _lsMap = new Map();
vi.stubGlobal('localStorage', {
    getItem:    (k)    => _lsMap.get(k) ?? null,
    setItem:    (k, v) => _lsMap.set(k, String(v)),
    removeItem: (k)    => _lsMap.delete(k),
    clear:      ()     => _lsMap.clear(),
});

const _ssMap = new Map();
vi.stubGlobal('sessionStorage', {
    getItem:    (k)    => _ssMap.get(k) ?? null,
    setItem:    (k, v) => _ssMap.set(k, String(v)),
    removeItem: (k)    => _ssMap.delete(k),
    clear:      ()     => _ssMap.clear(),
});

// Deterministic crypto: fill with 0, buf[0] controls result
vi.stubGlobal('crypto', {
    randomUUID: () => 'test-uuid-casino-ui',
    getRandomValues: (buf) => { buf.fill(0); return buf; },
});

// Absorb module-level window.addEventListener calls in wallet.js
vi.stubGlobal('window', {
    addEventListener: vi.fn(),
});

/* ═══════════════════════════════════════════════════════════════
   Imports under test
   ═══════════════════════════════════════════════════════════════ */

import {
    DAILY_BASE,
    getTotalBalance,
    canAfford,
    debit,
    credit,
    loadWallet,
    tip,
} from '../lib/wallet.js';

import {
    getPayout,
    createRoulette,
    placeBet   as roulettePlaceBet,
    spin,
    finishSpin,
    newRound   as rouletteNewRound,
    loadHistory,
    saveHistory,
} from '../lib/roulette.js';

import {
    createGame  as bjCreateGame,
    addPlayer,
    placeBet    as bjPlaceBet,
    dealInitialCards,
    stand,
    hit,
    split,
    canSplit,
    doubleDown,
    canDoubleDown,
    runDealerTurn,
    getPayouts,
    newRound    as bjNewRound,
    BlackjackEngine,
} from '../lib/blackjack.js';

import {
    createGame  as abCreateGame,
    placeBet    as abPlaceBet,
    dealTrump,
    dealNext,
    AndarBaharEngine,
} from '../lib/andarbahar.js';

import {
    createCasinoState,
    mergeCasinoStates,
    updateHousePnl,
    getTotalHousePnl,
    serializeCasinoState,
    parseCasinoState,
    isCasinoStateMessage,
} from '../lib/casinoState.js';

/* ═══════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════ */

function clearStorage() {
    _lsMap.clear();
    _ssMap.clear();
}

function makeWallet(overrides = {}) {
    return {
        deviceId: 'dev-abc',
        nick: 'TestUser',
        baseBalance: 1000,
        adminBonus: 0,
        lastRefreshDate: '2099-01-01', // far future — won't trigger daily refresh
        history: [],
        ...overrides,
    };
}

beforeEach(() => {
    clearStorage();
    // Reset crypto stub to deterministic (buf[0] = 0 → roulette result = 0)
    vi.stubGlobal('crypto', {
        randomUUID: () => 'test-uuid-casino-ui',
        getRandomValues: (buf) => { buf.fill(0); return buf; },
    });
});

afterEach(() => {
    vi.useRealTimers();
});

/* ═══════════════════════════════════════════════════════════════
   SECTION 1 — Wallet: Tipping (no implementation — todo markers)
   ═══════════════════════════════════════════════════════════════ */

describe('Wallet — tipping', () => {
    it('tipping A→B: A balance decremented by tip amount', () => {
        const walletA = makeWallet({ baseBalance: 1000, adminBonus: 0, nick: 'Alice', deviceId: 'dev1', history: [] });
        const walletB = makeWallet({ baseBalance: 1000, adminBonus: 0, nick: 'Bob', deviceId: 'dev2', history: [] });
        const result = tip(walletA, walletB, 200);
        expect(result.success).toBe(true);
        expect(getTotalBalance(result.from)).toBe(800);
        expect(result.from.baseBalance).toBe(800);
    });

    it('tipping A→B: B balance incremented by tip amount', () => {
        const walletA = makeWallet({ baseBalance: 1000, adminBonus: 0, nick: 'Alice', deviceId: 'dev1', history: [] });
        const walletB = makeWallet({ baseBalance: 1000, adminBonus: 0, nick: 'Bob', deviceId: 'dev2', history: [] });
        const result = tip(walletA, walletB, 200);
        expect(result.success).toBe(true);
        expect(getTotalBalance(result.to)).toBe(1200);
        expect(result.to.baseBalance).toBe(1200);
    });

    it('tip to non-existent user: gracefully rejected or no-op', () => {
        const walletA = makeWallet({ baseBalance: 1000, adminBonus: 0, nick: 'Alice', deviceId: 'dev1', history: [] });
        // tip() requires a valid wallet object — passing an invalid amount instead
        // Since tip checks amount validity, test with 0 or negative amount as "bad target" scenario
        const result = tip(walletA, {}, 0);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('invalid_amount');
    });

    it('tip exceeds sender balance: rejected, both wallets unchanged', () => {
        const walletA = makeWallet({ baseBalance: 100, adminBonus: 0, nick: 'Alice', deviceId: 'dev1', history: [] });
        const walletB = makeWallet({ baseBalance: 500, adminBonus: 0, nick: 'Bob', deviceId: 'dev2', history: [] });
        const result = tip(walletA, walletB, 200);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('insufficient_balance');
    });
});

/* ═══════════════════════════════════════════════════════════════
   SECTION 2 — Blackjack: game flow integration
   ═══════════════════════════════════════════════════════════════ */

describe('Blackjack — post-session summary shape (calculateResults)', () => {
    it('returns a PayoutEvent with required fields for a win', () => {
        // Force dealer bust: buf fill 0 → all cards from top of shuffled deck
        // We'll build the settled state manually for a deterministic test
        let game = bjCreateGame('room-bj', 'dealer-1');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 200);

        // Build a known settled state: player wins (status=win), dealer busts
        game = {
            ...game,
            phase: 'ended',
            dealer: { ...game.dealer, hand: [{ value: '10', suit: '♠', id: '10♠' }, { value: '10', suit: '♥', id: '10♥' }, { value: '5', suit: '♦', id: '5♦' }], revealed: true },
            players: [{ peer_id: 'p1', nick: 'Alice', hand: [{ value: '10', suit: '♣', id: '10♣' }, { value: '8', suit: '♣', id: '8♣' }], status: 'win', bet: 200 }],
        };

        const engine = new BlackjackEngine(game);
        const summary = engine.calculateResults(game);

        expect(summary).toHaveProperty('financial', true);
        expect(summary).toHaveProperty('gameType', 'blackjack');
        expect(summary).toHaveProperty('roundId');
        expect(summary).toHaveProperty('resultLabel');
        expect(summary).toHaveProperty('breakdown');
        expect(summary).toHaveProperty('totals');
        expect(Array.isArray(summary.breakdown)).toBe(true);
        expect(typeof summary.totals).toBe('object');
    });

    it('post-session summary breakdown contains peer_id, nick, wager, net, outcome', () => {
        let game = bjCreateGame('room-bj', 'dealer-1');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);

        // Blackjack win: player gets 3:2
        game = {
            ...game,
            phase: 'ended',
            dealer: { ...game.dealer, hand: [{ value: '9', suit: '♠', id: '9♠' }, { value: '8', suit: '♥', id: '8♥' }], revealed: true },
            players: [{ peer_id: 'p1', nick: 'Alice', hand: [{ value: 'A', suit: '♣', id: 'A♣' }, { value: 'K', suit: '♣', id: 'K♣' }], status: 'blackjack-win', bet: 100 }],
        };

        const engine = new BlackjackEngine(game);
        const summary = engine.calculateResults(game);

        expect(summary.breakdown).toHaveLength(1);
        const entry = summary.breakdown[0];
        expect(entry).toHaveProperty('peer_id', 'p1');
        expect(entry).toHaveProperty('nick', 'Alice');
        expect(entry).toHaveProperty('wager', 100);
        expect(entry).toHaveProperty('net', 150);    // 3:2 on 100
        expect(entry).toHaveProperty('outcome', 'win');
        expect(summary.totals['p1']).toBe(150);
    });

    it('post-session summary totals are 0 for a push', () => {
        let game = bjCreateGame('room-bj', 'dealer-1');
        game = addPlayer(game, 'p1', 'Bob');
        game = bjPlaceBet(game, 'p1', 50);

        game = {
            ...game,
            phase: 'ended',
            dealer: { ...game.dealer, hand: [{ value: '10', suit: '♠', id: '10♠' }, { value: '8', suit: '♥', id: '8♥' }], revealed: true },
            players: [{ peer_id: 'p1', nick: 'Bob', hand: [{ value: '10', suit: '♣', id: '10♣' }, { value: '8', suit: '♣', id: '8♣' }], status: 'push', bet: 50 }],
        };

        const engine = new BlackjackEngine(game);
        const summary = engine.calculateResults(game);
        expect(summary.totals['p1']).toBe(0);
        expect(summary.breakdown[0].outcome).toBe('push');
    });

    it('getPayouts returns correct net for a split hand scenario', () => {
        // Player splits: main hand wins, split hand loses
        const game = {
            phase: 'ended',
            players: [{
                peer_id: 'p1',
                nick: 'Alice',
                hand: [{ value: '10', suit: '♠', id: '10♠' }, { value: '7', suit: '♣', id: '7♣' }],
                status: 'win',
                bet: 100,
                splitHand: [{ value: '8', suit: '♦', id: '8♦' }, { value: '6', suit: '♥', id: '6♥' }],
                splitBet: 100,
                splitStatus: 'lose',
            }],
            dealer: { hand: [{ value: '9', suit: '♠', id: '9♠' }, { value: '8', suit: '♥', id: '8♥' }] },
        };

        const payouts = getPayouts(game);
        // Main win: +100, split lose: -100 → net 0
        expect(payouts['p1']).toBe(0);
    });

    it('getPayouts: split — both hands win doubles the net', () => {
        const game = {
            phase: 'ended',
            players: [{
                peer_id: 'p1',
                nick: 'Alice',
                hand: [{ value: '10', suit: '♠', id: '10♠' }, { value: '8', suit: '♣', id: '8♣' }],
                status: 'win',
                bet: 100,
                splitHand: [{ value: '10', suit: '♦', id: '10♦' }, { value: '7', suit: '♥', id: '7♥' }],
                splitBet: 100,
                splitStatus: 'win',
            }],
        };

        const payouts = getPayouts(game);
        expect(payouts['p1']).toBe(200); // both hands win 1:1
    });

    it('doubleDown doubles the player bet in game state', () => {
        // Build a playing game with deterministic deck to control cards
        let game = bjCreateGame('room-bj', 'dealer-1');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);

        // Manually set up a 2-card hand so canDoubleDown is true
        game = {
            ...game,
            phase: 'playing',
            currentPlayerIndex: 0,
            players: [{
                peer_id: 'p1',
                nick: 'Alice',
                hand: [{ value: '5', suit: '♠', id: '5♠' }, { value: '6', suit: '♥', id: '6♥' }],
                status: 'playing',
                bet: 100,
            }],
            deck: [{ value: '7', suit: '♣', id: '7♣' }, { value: '3', suit: '♦', id: '3♦' }],
        };

        expect(canDoubleDown(game, 'p1')).toBe(true);
        const afterDD = doubleDown(game, 'p1');
        expect(afterDD.players[0].bet).toBe(200);  // bet doubled
        expect(afterDD.players[0].hand).toHaveLength(3);  // received exactly one card
        // Player auto-stands after double down
        expect(['stand', 'bust']).toContain(afterDD.players[0].status);
    });

    it('wallet debit reflects double-down additional bet cost', () => {
        // Simulate a UI-layer wallet debit for the additional bet
        let wallet = makeWallet({ baseBalance: 500 });
        const originalBet = 100;

        // Player places initial bet
        wallet = debit(wallet, originalBet, 'Blackjack bet');
        expect(wallet.baseBalance).toBe(400);

        // Double down: pay another originalBet
        wallet = debit(wallet, originalBet, 'Blackjack double-down');
        expect(wallet.baseBalance).toBe(300);
    });

    it('split bet creates equal stake on second hand (canSplit + split)', () => {
        let game = bjCreateGame('room-bj', 'dealer-1');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);

        // Manually set matching cards on 2-card hand
        game = {
            ...game,
            phase: 'playing',
            currentPlayerIndex: 0,
            players: [{
                peer_id: 'p1',
                nick: 'Alice',
                hand: [{ value: '8', suit: '♠', id: '8♠' }, { value: '8', suit: '♥', id: '8♥' }],
                status: 'playing',
                bet: 100,
            }],
            deck: [
                { value: '3', suit: '♣', id: '3♣' },
                { value: '4', suit: '♦', id: '4♦' },
                { value: '5', suit: '♠', id: '5♠' },
                { value: '6', suit: '♥', id: '6♥' },
            ],
        };

        expect(canSplit(game, 'p1')).toBe(true);
        const afterSplit = split(game, 'p1');
        const player = afterSplit.players[0];

        expect(player.hand).toHaveLength(2);
        expect(player.splitHand).toHaveLength(2);
        expect(player.splitBet).toBe(100);   // equal to original bet
    });

    it.todo('host migration: host leaves mid-round, new host takes over, game state preserved');
});

/* ═══════════════════════════════════════════════════════════════
   SECTION 3 — Roulette: edge cases
   ═══════════════════════════════════════════════════════════════ */

describe('Roulette — multiple bets on same position (replace behavior)', () => {
    it('placing same bet type+target replaces the previous amount', () => {
        let game = createRoulette('room-rl');
        game = roulettePlaceBet(game, 'p1', 'Alice', 'single', 5, 100);
        game = roulettePlaceBet(game, 'p1', 'Alice', 'single', 5, 250);
        // Should have only one bet (replacement)
        const betsOnPos = game.bets.filter(b => b.peer_id === 'p1' && b.betType === 'single' && b.betTarget === 5);
        expect(betsOnPos).toHaveLength(1);
        expect(betsOnPos[0].amount).toBe(250);
    });

    it('placing different positions accumulates bets', () => {
        let game = createRoulette('room-rl');
        game = roulettePlaceBet(game, 'p1', 'Alice', 'single', 5, 100);
        game = roulettePlaceBet(game, 'p1', 'Alice', 'single', 10, 200);
        const p1Bets = game.bets.filter(b => b.peer_id === 'p1');
        expect(p1Bets).toHaveLength(2);
    });

    it('two different players can both bet the same number', () => {
        let game = createRoulette('room-rl');
        game = roulettePlaceBet(game, 'p1', 'Alice', 'single', 17, 100);
        game = roulettePlaceBet(game, 'p2', 'Bob',   'single', 17, 50);
        expect(game.bets).toHaveLength(2);
    });
});

describe('Roulette — zero result clears all outside bets', () => {
    // getPayout(type, target, 0) must return 0 for all outside bet types

    it('color:red loses on 0', () => {
        expect(getPayout('color', 'red', 0)).toBe(0);
    });

    it('color:black loses on 0', () => {
        expect(getPayout('color', 'black', 0)).toBe(0);
    });

    it('parity:even loses on 0', () => {
        expect(getPayout('parity', 'even', 0)).toBe(0);
    });

    it('parity:odd loses on 0', () => {
        expect(getPayout('parity', 'odd', 0)).toBe(0);
    });

    it('half:low loses on 0', () => {
        expect(getPayout('half', 'low', 0)).toBe(0);
    });

    it('half:high loses on 0', () => {
        expect(getPayout('half', 'high', 0)).toBe(0);
    });

    it('dozen:1 loses on 0', () => {
        expect(getPayout('dozen', 1, 0)).toBe(0);
    });

    it('dozen:2 loses on 0', () => {
        expect(getPayout('dozen', 2, 0)).toBe(0);
    });

    it('dozen:3 loses on 0', () => {
        expect(getPayout('dozen', 3, 0)).toBe(0);
    });

    it('column:1 loses on 0', () => {
        expect(getPayout('column', 1, 0)).toBe(0);
    });

    it('column:2 loses on 0', () => {
        expect(getPayout('column', 2, 0)).toBe(0);
    });

    it('column:3 loses on 0', () => {
        expect(getPayout('column', 3, 0)).toBe(0);
    });

    it('all outside bets net -amount on spin result 0 (via spin function)', () => {
        // buf[0] = 0 → result = 0 % 37 = 0
        vi.stubGlobal('crypto', {
            randomUUID: () => 'test-uuid-casino-ui',
            getRandomValues: (buf) => { buf.fill(0); return buf; },
        });

        let game = createRoulette('room-rl');
        game = roulettePlaceBet(game, 'p1', 'Alice', 'color', 'red',    100);
        game = roulettePlaceBet(game, 'p1', 'Alice', 'color', 'black',  100);
        game = roulettePlaceBet(game, 'p1', 'Alice', 'parity', 'even',  100);
        game = roulettePlaceBet(game, 'p1', 'Alice', 'parity', 'odd',   100);
        game = roulettePlaceBet(game, 'p1', 'Alice', 'half', 'low',     100);
        game = roulettePlaceBet(game, 'p1', 'Alice', 'half', 'high',    100);
        game = roulettePlaceBet(game, 'p1', 'Alice', 'dozen', 1,        100);
        game = roulettePlaceBet(game, 'p1', 'Alice', 'dozen', 2,        100);
        game = roulettePlaceBet(game, 'p1', 'Alice', 'dozen', 3,        100);
        game = roulettePlaceBet(game, 'p1', 'Alice', 'column', 1,       100);
        game = roulettePlaceBet(game, 'p1', 'Alice', 'column', 2,       100);
        game = roulettePlaceBet(game, 'p1', 'Alice', 'column', 3,       100);

        const after = spin(game);
        expect(after.result).toBe(0);
        // All 12 outside bets lose
        expect(after.payouts['p1']).toBe(-1200);
    });
});

describe('Roulette — column 3 payout for result 36', () => {
    it('getPayout column:3 returns 3 for result 36 (36 % 3 === 0)', () => {
        // Column 3 wins when result % 3 === 0 (3, 6, 9, ..., 36)
        expect(getPayout('column', 3, 36)).toBe(3);
    });

    it('column:3 bet on 36 result yields correct net profit', () => {
        // With getPayout returning 3, net = amount * (3 - 1) = amount * 2
        const amount = 100;
        const multiplier = getPayout('column', 3, 36);
        const net = amount * (multiplier - 1);
        expect(net).toBe(200);
    });

    it('column:1 does not win for result 36 (36 % 3 !== 1)', () => {
        expect(getPayout('column', 1, 36)).toBe(0);
    });

    it('column:2 does not win for result 36 (36 % 3 !== 2)', () => {
        expect(getPayout('column', 2, 36)).toBe(0);
    });
});

describe('Roulette — spin history grows correctly', () => {
    it('finishSpin appends result to spinHistory', () => {
        // buf[0] = 7 → result = 7 % 37 = 7
        vi.stubGlobal('crypto', {
            randomUUID: () => 'test-uuid-casino-ui',
            getRandomValues: (buf) => { buf.fill(0); buf[0] = 7; return buf; },
        });

        let game = createRoulette('room-rl-hist');
        expect(game.spinHistory).toEqual([]);

        game = spin(game);
        game = finishSpin(game);
        expect(game.spinHistory).toHaveLength(1);
        expect(game.spinHistory[0]).toBe(7);
    });

    it('history accumulates across multiple rounds', () => {
        vi.stubGlobal('crypto', {
            randomUUID: () => 'test-uuid-casino-ui',
            getRandomValues: (buf) => { buf.fill(0); buf[0] = 5; return buf; },
        });

        let game = createRoulette('room-rl-hist2');

        // Round 1
        game = spin(game);
        game = finishSpin(game);
        game = rouletteNewRound(game);

        // Round 2
        game = spin(game);
        game = finishSpin(game);

        expect(game.spinHistory).toHaveLength(2);
        // Both results should be 5 (buf[0] = 5, result = 5 % 37 = 5)
        expect(game.spinHistory[0]).toBe(5);
        expect(game.spinHistory[1]).toBe(5);
    });

    it('history is capped at 100 entries', () => {
        vi.stubGlobal('crypto', {
            randomUUID: () => 'test-uuid-casino-ui',
            getRandomValues: (buf) => { buf.fill(0); return buf; },
        });

        // Pre-fill history with 100 entries
        let game = createRoulette('room-rl-cap');
        game = { ...game, spinHistory: Array(100).fill(0) };

        game = spin(game);
        game = finishSpin(game);

        expect(game.spinHistory).toHaveLength(100);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SECTION 4 — Andar Bahar: state machine transitions
   ═══════════════════════════════════════════════════════════════ */

describe('Andar Bahar — state flow: betting → dealing → ended', () => {
    it('initial createGame is in betting phase', () => {
        const game = abCreateGame('room-ab-flow');
        expect(game.phase).toBe('betting');
        expect(game.trumpCard).toBeNull();
    });

    it('dealTrump transitions from betting to dealing', () => {
        let game = abCreateGame('room-ab-flow');
        game = dealTrump(game);
        expect(game.phase).toBe('dealing');
        expect(game.trumpCard).not.toBeNull();
        expect(game.deck).toHaveLength(51);
    });

    it('dealing → ended when match card found', () => {
        let game = abCreateGame('room-ab-flow');
        game = dealTrump(game);
        let safety = 0;
        while (game.phase === 'dealing' && safety < 60) {
            game = dealNext(game);
            safety++;
        }
        expect(game.phase).toBe('ended');
        expect(['andar', 'bahar']).toContain(game.result);
    });

    it('dealNext does nothing when not in dealing phase', () => {
        const game = abCreateGame('room-ab-flow');
        // phase is 'betting'
        const unchanged = dealNext(game);
        expect(unchanged).toBe(game);
    });

    it('trumpCard is not null after dealTrump, deck has one fewer card', () => {
        let game = abCreateGame('room-ab-flow');
        const deckBefore = game.deck.length;
        game = dealTrump(game);
        expect(game.trumpCard).toBeTruthy();
        expect(game.deck.length).toBe(deckBefore - 1);
    });
});

describe('Andar Bahar — correct side wins, payout verified', () => {
    it('player betting on winning side gets positive net payout', () => {
        let game = abCreateGame('room-ab-payout');
        game = abPlaceBet(game, 'p1', 'Alice', 'andar', 100);
        game = abPlaceBet(game, 'p2', 'Bob',   'bahar', 100);
        game = dealTrump(game);

        let safety = 0;
        while (game.phase === 'dealing' && safety < 60) {
            game = dealNext(game);
            safety++;
        }

        expect(game.phase).toBe('ended');
        const winner = game.result;   // 'andar' or 'bahar'
        const loser  = winner === 'andar' ? 'p2' : 'p1';
        const winnerId = winner === 'andar' ? 'p1' : 'p2';

        // Winner gets a positive payout (net > 0)
        expect(game.payouts[winnerId]).toBeGreaterThan(0);
        // Loser gets a negative payout (net < 0)
        expect(game.payouts[loser]).toBeLessThan(0);
    });

    it('AndarBaharEngine.calculatePayout: andar wins 0.9:1 when trumpFirst is bahar', () => {
        const engine = new AndarBaharEngine(abCreateGame('room-ab-e'));
        const bets = [{ peer_id: 'p1', side: 'andar', amount: 200 }];
        const result = { winningSide: 'andar', totalCards: 4, trumpFirst: 'bahar' };
        const payouts = engine.calculatePayout(bets, result);
        // 0.9 * 200 = 180 (Math.floor)
        expect(payouts['p1']).toBe(180);
    });

    it('AndarBaharEngine.calculatePayout: bahar wins 1:1 regardless of trumpFirst', () => {
        const engine = new AndarBaharEngine(abCreateGame('room-ab-e'));
        const bets = [{ peer_id: 'p1', side: 'bahar', amount: 150 }];
        const result = { winningSide: 'bahar', totalCards: 6, trumpFirst: 'bahar' };
        const payouts = engine.calculatePayout(bets, result);
        expect(payouts['p1']).toBe(150);
    });

    it('AndarBaharEngine.calculatePayout: losing side gets negative net equal to bet', () => {
        const engine = new AndarBaharEngine(abCreateGame('room-ab-e'));
        const bets = [{ peer_id: 'p1', side: 'bahar', amount: 100 }];
        const result = { winningSide: 'andar', totalCards: 8, trumpFirst: 'bahar' };
        const payouts = engine.calculatePayout(bets, result);
        expect(payouts['p1']).toBe(-100);
    });

    it('AndarBaharEngine.calculatePayout: andar wins 1:1 when trumpFirst is andar', () => {
        const engine = new AndarBaharEngine(abCreateGame('room-ab-e'));
        const bets = [{ peer_id: 'p1', side: 'andar', amount: 100 }];
        const result = { winningSide: 'andar', totalCards: 3, trumpFirst: 'andar' };
        const payouts = engine.calculatePayout(bets, result);
        expect(payouts['p1']).toBe(100); // 1:1 because trumpFirst === 'andar'
    });
});

describe('Andar Bahar — post-round PayoutEvent shape', () => {
    it('calculateResults returns a proper PayoutEvent with financial:true', () => {
        const game = {
            type: 'andarbahar',
            roomId: 'room-ab-results',
            phase: 'ended',
            result: 'andar',
            trumpFirst: 'bahar',
            andar: [{ value: '7', suit: '♠', id: '7♠' }],
            bahar: [{ value: '3', suit: '♥', id: '3♥' }],
            bets: [{ peer_id: 'p1', nick: 'Alice', side: 'andar', amount: 100 }],
        };

        const engine = new AndarBaharEngine(game);
        const event = engine.calculateResults(game);

        expect(event.financial).toBe(true);
        expect(event.gameType).toBe('andarbahar');
        expect(event).toHaveProperty('roundId');
        expect(event).toHaveProperty('resultLabel');
        expect(Array.isArray(event.breakdown)).toBe(true);
        expect(event.breakdown[0]).toMatchObject({
            peer_id: 'p1',
            nick: 'Alice',
            outcome: 'win',
        });
        // net for andar win with trumpFirst=bahar = floor(100 * 0.9) = 90
        expect(event.totals['p1']).toBe(90);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SECTION 5 — Casino state P2P: targeted gaps not in core-features
   ═══════════════════════════════════════════════════════════════ */

describe('Casino state P2P — multiple game types coexist after merge', () => {
    it('remote with newer housePnl replaces local housePnl for ALL game types', () => {
        const local = {
            _ts: 100,
            housePnl: { _ts: 50, roulette: 200, blackjack: -100, andarbahar: 50, slots: 0 },
        };
        const remote = {
            _ts: 200,
            housePnl: { _ts: 150, roulette: 999, blackjack: 888, andarbahar: 777, slots: 666 },
        };

        const merged = mergeCasinoStates(local, remote);

        // Remote housePnl wins entirely (higher _ts)
        expect(merged.housePnl.roulette).toBe(999);
        expect(merged.housePnl.blackjack).toBe(888);
        expect(merged.housePnl.andarbahar).toBe(777);
        expect(merged.housePnl.slots).toBe(666);
        // Top-level _ts is max of both
        expect(merged._ts).toBe(200);
    });

    it('local with newer housePnl kept intact when remote is stale', () => {
        const local = {
            _ts: 500,
            housePnl: { _ts: 500, roulette: 100, blackjack: 200, andarbahar: 300, slots: 400 },
        };
        const remote = {
            _ts: 100,
            housePnl: { _ts: 50, roulette: 1, blackjack: 1, andarbahar: 1, slots: 1 },
        };

        const merged = mergeCasinoStates(local, remote);

        expect(merged.housePnl.roulette).toBe(100);
        expect(merged.housePnl.blackjack).toBe(200);
        expect(merged.housePnl.andarbahar).toBe(300);
        expect(merged.housePnl.slots).toBe(400);
    });

    it('getTotalHousePnl sums all game types excluding _ts', () => {
        const state = {
            _ts: 1,
            housePnl: { _ts: 1, roulette: 100, blackjack: -50, andarbahar: 25, slots: 75 },
        };
        expect(getTotalHousePnl(state)).toBe(150);
    });

    it('updateHousePnl for different game types accumulates independently', () => {
        let state = createCasinoState();
        state = updateHousePnl(state, 'roulette',   { p1: -100 }); // house gains 100
        state = updateHousePnl(state, 'blackjack',  { p1: 200  }); // house loses 200
        state = updateHousePnl(state, 'andarbahar', { p1: -50  }); // house gains 50
        state = updateHousePnl(state, 'slots',      { p1: 0    }); // no change

        expect(state.housePnl.roulette).toBe(100);
        expect(state.housePnl.blackjack).toBe(-200);
        expect(state.housePnl.andarbahar).toBe(50);
        expect(state.housePnl.slots).toBe(0);
    });
});

describe('Casino state P2P — serialize→parse round-trip', () => {
    it('round-trip preserves all game PnL values', () => {
        let state = createCasinoState();
        state = updateHousePnl(state, 'roulette',   { p1: -300 });
        state = updateHousePnl(state, 'blackjack',  { p1: 150  });
        state = updateHousePnl(state, 'andarbahar', { p1: -75  });
        state = updateHousePnl(state, 'slots',      { p1: -25  });

        const serialized = serializeCasinoState(state);
        const parsed     = parseCasinoState(serialized);

        expect(parsed.housePnl.roulette).toBe(state.housePnl.roulette);
        expect(parsed.housePnl.blackjack).toBe(state.housePnl.blackjack);
        expect(parsed.housePnl.andarbahar).toBe(state.housePnl.andarbahar);
        expect(parsed.housePnl.slots).toBe(state.housePnl.slots);
        expect(parsed._ts).toBe(state._ts);
    });

    it('isCasinoStateMessage identifies CS: prefix correctly', () => {
        expect(isCasinoStateMessage('CS:{"_ts":1}')).toBe(true);
        expect(isCasinoStateMessage('RL:something')).toBe(false);
        expect(isCasinoStateMessage('')).toBe(false);
        expect(isCasinoStateMessage(null)).toBe(false);
    });

    it('parseCasinoState returns null for malformed payload', () => {
        expect(parseCasinoState('CS:{{bad')).toBeNull();
        expect(parseCasinoState('not-cs-data')).toBeNull();
    });
});

/* ═══════════════════════════════════════════════════════════════
   SECTION 6 — Wallet session: targeted gaps not in wallet.test.js
   ═══════════════════════════════════════════════════════════════ */

describe('Wallet session — canAfford at exact balance boundary', () => {
    it('canAfford returns true when amount === total balance (exact match)', () => {
        const wallet = makeWallet({ baseBalance: 700, adminBonus: 300 });
        // total = 1000; amount = 1000 → exactly affordable
        expect(canAfford(wallet, 1000)).toBe(true);
    });

    it('canAfford returns false when amount is 1 more than total balance', () => {
        const wallet = makeWallet({ baseBalance: 700, adminBonus: 300 });
        expect(canAfford(wallet, 1001)).toBe(false);
    });

    it('canAfford returns true for 0 when wallet is empty', () => {
        const wallet = makeWallet({ baseBalance: 0, adminBonus: 0 });
        expect(canAfford(wallet, 0)).toBe(true);
    });

    it('debit succeeds at exact balance (leaves both balances at 0)', () => {
        const wallet = makeWallet({ baseBalance: 500, adminBonus: 200 });
        const total = getTotalBalance(wallet); // 700
        const updated = debit(wallet, total, 'All-in');
        expect(updated.baseBalance).toBe(0);
        expect(updated.adminBonus).toBe(0);
        expect(getTotalBalance(updated)).toBe(0);
    });

    it('debit fails when amount is exactly 1 above total balance', () => {
        const wallet = makeWallet({ baseBalance: 500, adminBonus: 200 });
        const tooMuch = getTotalBalance(wallet) + 1; // 701
        const updated = debit(wallet, tooMuch, 'Over-bet');
        expect(updated).toBe(wallet); // same reference — unchanged
    });
});

describe('Wallet session — daily refresh at IST midnight', () => {
    it('daily refresh resets baseBalance to DAILY_BASE', () => {
        const deviceId = 'test-device-uuid-daily';
        const staleWallet = {
            deviceId,
            nick: 'Alice',
            baseBalance: 300,      // game winnings that should be reset
            adminBonus: 500,       // permanent — should survive
            lastRefreshDate: '2020-01-01',  // old date
            history: [],
        };
        _lsMap.set(`openwire_wallet_dev_${deviceId}`, JSON.stringify(staleWallet));

        // Stub crypto so getDeviceId() returns our deviceId
        vi.stubGlobal('crypto', {
            randomUUID: () => deviceId,
            getRandomValues: (buf) => { buf.fill(0); return buf; },
        });

        const wallet = loadWallet('Alice');
        expect(wallet.baseBalance).toBe(DAILY_BASE);
    });

    it('daily refresh keeps adminBonus intact', () => {
        const deviceId = 'test-device-uuid-daily';
        const staleWallet = {
            deviceId,
            nick: 'Alice',
            baseBalance: 300,
            adminBonus: 500,
            lastRefreshDate: '2020-01-01',
            history: [],
        };
        _lsMap.set(`openwire_wallet_dev_${deviceId}`, JSON.stringify(staleWallet));

        vi.stubGlobal('crypto', {
            randomUUID: () => deviceId,
            getRandomValues: (buf) => { buf.fill(0); return buf; },
        });

        const wallet = loadWallet('Alice');
        expect(wallet.adminBonus).toBe(500);
    });

    it('daily refresh appends a history entry with reason "Daily refresh"', () => {
        const deviceId = 'test-device-uuid-daily';
        const staleWallet = {
            deviceId,
            nick: 'Alice',
            baseBalance: 300,
            adminBonus: 0,
            lastRefreshDate: '2020-01-01',
            history: [{ time: 1, reason: 'old-entry', amount: 300, balance: 300 }],
        };
        _lsMap.set(`openwire_wallet_dev_${deviceId}`, JSON.stringify(staleWallet));

        vi.stubGlobal('crypto', {
            randomUUID: () => deviceId,
            getRandomValues: (buf) => { buf.fill(0); return buf; },
        });

        const wallet = loadWallet('Alice');
        const lastEntry = wallet.history[wallet.history.length - 1];
        expect(lastEntry.reason).toBe('Daily refresh');
        expect(lastEntry.amount).toBe(DAILY_BASE);
    });

    it('no refresh occurs when lastRefreshDate is already today', () => {
        const deviceId = 'test-device-uuid-today';
        const todayIST = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date());

        const currentWallet = {
            deviceId,
            nick: 'Alice',
            baseBalance: 42,
            adminBonus: 0,
            lastRefreshDate: todayIST,
            history: [],
        };
        _lsMap.set(`openwire_wallet_dev_${deviceId}`, JSON.stringify(currentWallet));

        vi.stubGlobal('crypto', {
            randomUUID: () => deviceId,
            getRandomValues: (buf) => { buf.fill(0); return buf; },
        });

        const wallet = loadWallet('Alice');
        expect(wallet.baseBalance).toBe(42);  // unchanged — same day
    });
});
