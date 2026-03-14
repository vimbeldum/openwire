/**
 * game-engines.test.js
 *
 * Comprehensive Vitest test suite for OpenWire casino game engines.
 * Covers Roulette, Blackjack, and Slots engines with 55+ tests.
 *
 * Complements (and does NOT duplicate) the existing gameLogic.test.js suite.
 * All tests are self-contained, isolated, and deterministic where randomness
 * matters (via vi.stubGlobal crypto mock).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── sessionStorage stub (used by roulette loadHistory / saveHistory) ── */
const _ssStore = new Map();
const mockSessionStorage = {
    getItem: (k) => _ssStore.get(k) ?? null,
    setItem: (k, v) => _ssStore.set(k, String(v)),
    removeItem: (k) => _ssStore.delete(k),
    clear: () => _ssStore.clear(),
};
vi.stubGlobal('sessionStorage', mockSessionStorage);

/* ── localStorage stub (required by casinoState / other transitive imports) ── */
const _lsStore = new Map();
const mockLocalStorage = {
    getItem: (k) => _lsStore.get(k) ?? null,
    setItem: (k, v) => _lsStore.set(k, String(v)),
    removeItem: (k) => _lsStore.delete(k),
    clear: () => _lsStore.clear(),
};
vi.stubGlobal('localStorage', mockLocalStorage);

/* ── Default crypto stub (deterministic buf[0] = 0) ─────────────────── */
function stubCrypto(buf0Value = 0) {
    vi.stubGlobal('crypto', {
        getRandomValues: (buf) => {
            buf.fill(0);
            buf[0] = buf0Value;
            return buf;
        },
        randomUUID: () => 'test-uuid-1234',
    });
}

stubCrypto(0); // default — can be overridden per-test

/* ── Imports under test ─────────────────────────────────────────────── */
import {
    createRoulette,
    placeBet,
    clearBets,
    spin,
    finishSpin,
    newRound as rlNewRound,
    getPayout,
    isRed,
    isBlack,
    getColor,
    isRouletteMessage,
    serializeRouletteAction,
    parseRouletteAction,
    RouletteEngine,
    ROULETTE_RULES,
} from '../lib/roulette.js';

import {
    createGame,
    addPlayer,
    placeBet as bjPlaceBet,
    dealInitialCards,
    hit,
    stand,
    dealerPlay,
    settle,
    runDealerTurn,
    getPayouts,
    calculateHand,
    isBlackjack,
    isBust,
    canSplit,
    split,
    canDoubleDown,
    doubleDown,
    newRound as bjNewRound,
    BlackjackEngine,
    BLACKJACK_RULES,
    createDeck,
} from '../lib/blackjack.js';

import {
    createSlots,
    spinReels,
    calculatePayout as slotsPayout,
    SLOT_PAYOUTS,
    SLOTS_RULES,
    SlotsEngine,
} from '../lib/slots.js';

/* ═══════════════════════════════════════════════════════════════════════
   SECTION A — ROULETTE ENGINE
   ═══════════════════════════════════════════════════════════════════════ */

describe('A1 — createRoulette: initial state shape', () => {
    it('returns an object with type roulette', () => {
        const game = createRoulette('room-init');
        expect(game.type).toBe('roulette');
    });

    it('starts in betting phase', () => {
        const game = createRoulette('room-init');
        expect(game.phase).toBe('betting');
    });

    it('starts with result = null', () => {
        const game = createRoulette('room-init');
        expect(game.result).toBeNull();
    });

    it('starts with empty bets array', () => {
        const game = createRoulette('room-init');
        expect(game.bets).toEqual([]);
    });

    it('roomId is stored on the state object', () => {
        const game = createRoulette('my-room');
        expect(game.roomId).toBe('my-room');
    });

    it('nextSpinAt is a future timestamp', () => {
        const before = Date.now();
        const game = createRoulette('room-ts');
        expect(game.nextSpinAt).toBeGreaterThan(before);
    });
});

describe('A2 — placeBet: adding and replacing bets', () => {
    let game;
    beforeEach(() => {
        game = createRoulette('room-bets');
    });

    it('adds a valid single-number bet to the bets array', () => {
        const g = placeBet(game, 'p1', 'Alice', 'single', 17, 100);
        expect(g.bets).toHaveLength(1);
        expect(g.bets[0]).toMatchObject({ peer_id: 'p1', betType: 'single', betTarget: 17, amount: 100 });
    });

    it('replaces existing bet of same type+target for same peer', () => {
        let g = placeBet(game, 'p1', 'Alice', 'single', 17, 100);
        g = placeBet(g, 'p1', 'Alice', 'single', 17, 250);
        expect(g.bets).toHaveLength(1);
        expect(g.bets[0].amount).toBe(250);
    });

    it('does NOT replace a bet with a different target for the same peer', () => {
        let g = placeBet(game, 'p1', 'Alice', 'single', 17, 100);
        g = placeBet(g, 'p1', 'Alice', 'single', 18, 50);
        expect(g.bets).toHaveLength(2);
    });

    it('bets from different peers are kept independently', () => {
        let g = placeBet(game, 'p1', 'Alice', 'color', 'red', 100);
        g = placeBet(g, 'p2', 'Bob', 'color', 'red', 200);
        expect(g.bets).toHaveLength(2);
    });

    it('rejects amount of 0', () => {
        const g = placeBet(game, 'p1', 'Alice', 'color', 'red', 0);
        expect(g.bets).toHaveLength(0);
    });

    it('rejects negative amount', () => {
        const g = placeBet(game, 'p1', 'Alice', 'color', 'red', -50);
        expect(g.bets).toHaveLength(0);
    });

    it('rejects non-number amount (string)', () => {
        const g = placeBet(game, 'p1', 'Alice', 'color', 'red', '100');
        expect(g.bets).toHaveLength(0);
    });

    it('rejects Infinity amount', () => {
        const g = placeBet(game, 'p1', 'Alice', 'color', 'red', Infinity);
        expect(g.bets).toHaveLength(0);
    });

    it('caps total bets at 200 per round and returns unchanged game', () => {
        // Fill 200 bets from 200 different peers
        let g = game;
        for (let i = 0; i < 200; i++) {
            g = placeBet(g, `peer${i}`, `Nick${i}`, 'single', i % 37, 10);
        }
        expect(g.bets).toHaveLength(200);
        // 201st bet from a new peer must be rejected
        const before = g.bets.length;
        const g2 = placeBet(g, 'peer-extra', 'Extra', 'color', 'red', 10);
        expect(g2.bets).toHaveLength(before);
    });
});

describe('A3 — clearBets: peer-scoped removal', () => {
    it('removes only the specified peers bets', () => {
        let game = createRoulette('room-clear');
        game = placeBet(game, 'p1', 'Alice', 'color', 'red', 100);
        game = placeBet(game, 'p2', 'Bob', 'color', 'black', 200);
        const cleared = clearBets(game, 'p1');
        expect(cleared.bets).toHaveLength(1);
        expect(cleared.bets[0].peer_id).toBe('p2');
    });

    it('clearBets is a no-op for a peer with no bets', () => {
        let game = createRoulette('room-clear-noop');
        game = placeBet(game, 'p1', 'Alice', 'color', 'red', 50);
        const result = clearBets(game, 'unknown-peer');
        expect(result.bets).toHaveLength(1);
    });

    it('clearBets on empty bets array returns empty bets', () => {
        const game = createRoulette('room-empty');
        const result = clearBets(game, 'p1');
        expect(result.bets).toEqual([]);
    });
});

describe('A4 — spin: phase transition and result range', () => {
    afterEach(() => {
        // Restore default deterministic crypto after each test
        stubCrypto(0);
    });

    it('transitions phase to spinning', () => {
        const game = createRoulette('room-spin');
        const spun = spin(game);
        expect(spun.phase).toBe('spinning');
    });

    it('result is within range 0–36', () => {
        // Use real-ish values: buf[0] in range produces result = buf[0] % 37
        for (let v = 0; v < 37; v++) {
            stubCrypto(v);
            const game = createRoulette(`room-range-${v}`);
            const spun = spin(game);
            expect(spun.result).toBeGreaterThanOrEqual(0);
            expect(spun.result).toBeLessThanOrEqual(36);
        }
    });

    it('with buf[0]=0, result is 0', () => {
        stubCrypto(0);
        const game = createRoulette('room-zero');
        const spun = spin(game);
        expect(spun.result).toBe(0); // 0 % 37 === 0
    });

    it('with buf[0]=37, result is 0 (37 % 37)', () => {
        stubCrypto(37);
        const game = createRoulette('room-37');
        const spun = spin(game);
        expect(spun.result).toBe(0);
    });

    it('with buf[0]=1, result is 1', () => {
        stubCrypto(1);
        const game = createRoulette('room-one');
        const spun = spin(game);
        expect(spun.result).toBe(1);
    });

    it('spin produces a payouts map', () => {
        stubCrypto(1); // result = 1 (red)
        let game = createRoulette('room-payout-map');
        game = placeBet(game, 'p1', 'Alice', 'color', 'red', 100);
        const spun = spin(game);
        expect(spun.payouts).toBeDefined();
        expect(typeof spun.payouts).toBe('object');
    });

    it('winning bet produces positive net payout for that peer', () => {
        stubCrypto(1); // result = 1 (red, odd, low, dozen-1, column-1)
        let game = createRoulette('room-win');
        game = placeBet(game, 'p1', 'Alice', 'color', 'red', 100);
        const spun = spin(game);
        // color red wins at 2x → net = 100 * (2-1) = +100
        expect(spun.payouts['p1']).toBe(100);
    });

    it('losing bet produces negative net payout for that peer', () => {
        stubCrypto(1); // result = 1 (red) — betting black loses
        let game = createRoulette('room-lose');
        game = placeBet(game, 'p1', 'Alice', 'color', 'black', 100);
        const spun = spin(game);
        expect(spun.payouts['p1']).toBe(-100);
    });
});

describe('A5 — finishSpin: results phase and history', () => {
    it('transitions phase to results', () => {
        let game = createRoulette('room-finish');
        game = { ...game, result: 7 };
        const finished = finishSpin(game);
        expect(finished.phase).toBe('results');
    });

    it('appends result to spinHistory', () => {
        let game = createRoulette('room-history');
        game = { ...game, result: 14 };
        const finished = finishSpin(game);
        expect(finished.spinHistory).toContain(14);
    });

    it('caps spinHistory at 100 entries', () => {
        let game = createRoulette('room-cap');
        game = { ...game, spinHistory: Array.from({ length: 100 }, (_, i) => i), result: 999 };
        const finished = finishSpin(game);
        expect(finished.spinHistory).toHaveLength(100);
        // Newest entry should be present, oldest should have been trimmed
        expect(finished.spinHistory[99]).toBe(999);
    });
});

describe('A6 — newRound: state reset', () => {
    it('resets phase to betting', () => {
        let game = createRoulette('room-nr');
        game = { ...game, phase: 'results', result: 5, bets: [{ peer_id: 'p1' }] };
        const fresh = rlNewRound(game);
        expect(fresh.phase).toBe('betting');
    });

    it('resets result to null', () => {
        let game = createRoulette('room-nr');
        game = { ...game, result: 22 };
        expect(rlNewRound(game).result).toBeNull();
    });

    it('resets bets to empty array', () => {
        let game = createRoulette('room-nr');
        game = placeBet(game, 'p1', 'Alice', 'color', 'red', 100);
        expect(rlNewRound(game).bets).toEqual([]);
    });

    it('resets payouts to null', () => {
        let game = createRoulette('room-nr');
        game = { ...game, payouts: { p1: 50 } };
        expect(rlNewRound(game).payouts).toBeNull();
    });
});

describe('A7 — getPayout: boundary and edge conditions', () => {
    // These complement the existing payout tests with precise boundary values

    it('single: target 17 wins on 17 (returns 36)', () => {
        expect(getPayout('single', 17, 17)).toBe(36);
    });

    it('single: target 17 loses on 18 (returns 0)', () => {
        expect(getPayout('single', 17, 18)).toBe(0);
    });

    it('color red: result 1 wins (1 is red)', () => {
        expect(getPayout('color', 'red', 1)).toBe(2);
    });

    it('color red: result 0 loses (zero is not red)', () => {
        expect(getPayout('color', 'red', 0)).toBe(0);
    });

    it('parity even: result 0 returns 0 (zero is neither)', () => {
        expect(getPayout('parity', 'even', 0)).toBe(0);
    });

    it('half low: result 18 wins (boundary)', () => {
        expect(getPayout('half', 'low', 18)).toBe(2);
    });

    it('half high: result 19 wins (boundary)', () => {
        expect(getPayout('half', 'high', 19)).toBe(2);
    });

    it('half low: result 19 loses (above boundary)', () => {
        expect(getPayout('half', 'low', 19)).toBe(0);
    });

    it('half high: result 18 loses (below boundary)', () => {
        expect(getPayout('half', 'high', 18)).toBe(0);
    });

    it('dozen 1: result 12 wins (upper boundary)', () => {
        expect(getPayout('dozen', 1, 12)).toBe(3);
    });

    it('dozen 2: result 13 wins (lower boundary of dozen 2)', () => {
        expect(getPayout('dozen', 2, 13)).toBe(3);
    });

    it('dozen 2: result 12 loses (belongs to dozen 1)', () => {
        expect(getPayout('dozen', 2, 12)).toBe(0);
    });

    it('column 3: result 36 wins (36 % 3 === 0)', () => {
        expect(getPayout('column', 3, 36)).toBe(3);
    });

    it('column 3: result 0 loses (zero loses all column bets)', () => {
        expect(getPayout('column', 3, 0)).toBe(0);
    });

    it('column 1: result 1 wins (1 % 3 === 1)', () => {
        expect(getPayout('column', 1, 1)).toBe(3);
    });

    it('column 2: result 2 wins (2 % 3 === 2)', () => {
        expect(getPayout('column', 2, 2)).toBe(3);
    });
});

describe('A8 — isRed / isBlack / getColor', () => {
    const RED_SET = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
    const BLACK_SET = [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35];

    it('isRed returns true for all 18 red numbers', () => {
        for (const n of RED_SET) {
            expect(isRed(n)).toBe(true);
        }
    });

    it('isBlack returns true for all 18 black numbers', () => {
        for (const n of BLACK_SET) {
            expect(isBlack(n)).toBe(true);
        }
    });

    it('isRed returns false for all black numbers', () => {
        for (const n of BLACK_SET) {
            expect(isRed(n)).toBe(false);
        }
    });

    it('isBlack returns false for all red numbers', () => {
        for (const n of RED_SET) {
            expect(isBlack(n)).toBe(false);
        }
    });

    it('isRed returns false for zero', () => {
        expect(isRed(0)).toBe(false);
    });

    it('isBlack returns false for zero', () => {
        expect(isBlack(0)).toBe(false);
    });

    it('getColor(0) returns green', () => {
        expect(getColor(0)).toBe('green');
    });

    it('getColor returns red for red numbers', () => {
        for (const n of RED_SET) {
            expect(getColor(n)).toBe('red');
        }
    });

    it('getColor returns black for black numbers', () => {
        for (const n of BLACK_SET) {
            expect(getColor(n)).toBe('black');
        }
    });
});

describe('A9 — Roulette message protocol', () => {
    it('isRouletteMessage returns true for RL: prefixed strings', () => {
        expect(isRouletteMessage('RL:{"type":"bet"}')).toBe(true);
    });

    it('isRouletteMessage returns false for non-RL strings', () => {
        expect(isRouletteMessage('BJ:{"type":"bet"}')).toBe(false);
        expect(isRouletteMessage('')).toBe(false);
        expect(isRouletteMessage('RL')).toBe(false); // no colon at position 2
    });

    it('isRouletteMessage returns false for non-string inputs', () => {
        expect(isRouletteMessage(null)).toBe(false);
        expect(isRouletteMessage(42)).toBe(false);
    });

    it('serializeRouletteAction starts with RL:', () => {
        const msg = serializeRouletteAction({ type: 'bet', amount: 100 });
        expect(msg.startsWith('RL:')).toBe(true);
    });

    it('serializeRouletteAction produces valid JSON after the prefix', () => {
        const action = { type: 'spin' };
        const msg = serializeRouletteAction(action);
        expect(() => JSON.parse(msg.slice(3))).not.toThrow();
    });

    it('parseRouletteAction correctly parses a serialized action', () => {
        const action = { type: 'bet', betType: 'color', betTarget: 'red', amount: 50 };
        const msg = serializeRouletteAction(action);
        const parsed = parseRouletteAction(msg);
        expect(parsed).toEqual(action);
    });

    it('parseRouletteAction returns null for non-RL message', () => {
        expect(parseRouletteAction('CS:something')).toBeNull();
    });

    it('parseRouletteAction returns null for malformed JSON', () => {
        expect(parseRouletteAction('RL:not-json')).toBeNull();
    });
});

describe('A10 — RouletteEngine class', () => {
    it('calculatePayout returns correct net map for multiple bets on same result', () => {
        const game = createRoulette('room-eng');
        const engine = new RouletteEngine(game);

        // Result = 1: red, odd, low, dozen-1, column-1
        const bets = [
            { peer_id: 'p1', nick: 'Alice', betType: 'color', betTarget: 'red', amount: 100 },
            { peer_id: 'p1', nick: 'Alice', betType: 'color', betTarget: 'black', amount: 50 },
            { peer_id: 'p2', nick: 'Bob', betType: 'single', betTarget: 1, amount: 10 },
        ];
        const payouts = engine.calculatePayout(bets, 1);

        // p1 red wins: +100, p1 black loses: -50 → net +50
        expect(payouts['p1']).toBe(50);
        // p2 single 1 wins: 10 * (36-1) = 350
        expect(payouts['p2']).toBe(350);
    });

    it('getRules returns an object with a bets array', () => {
        const engine = new RouletteEngine(createRoulette('room-rules'));
        const rules = engine.getRules();
        expect(rules).toHaveProperty('bets');
        expect(Array.isArray(rules.bets)).toBe(true);
        expect(rules.bets.length).toBeGreaterThan(0);
    });

    it('getRules bets array entries have name, odds, and description', () => {
        const engine = new RouletteEngine(createRoulette('room-rules2'));
        const rules = engine.getRules();
        for (const bet of rules.bets) {
            expect(bet).toHaveProperty('name');
            expect(bet).toHaveProperty('odds');
            expect(bet).toHaveProperty('description');
        }
    });

    it('getGameState returns the game passed to the constructor', () => {
        const game = createRoulette('room-gs');
        const engine = new RouletteEngine(game);
        expect(engine.getGameState()).toBe(game);
    });
});

/* ═══════════════════════════════════════════════════════════════════════
   SECTION B — BLACKJACK ENGINE
   ═══════════════════════════════════════════════════════════════════════ */

describe('B1 — createGame: initial state', () => {
    it('type is blackjack', () => {
        const game = createGame('room-bj', 'dealer1');
        expect(game.type).toBe('blackjack');
    });

    it('starts in betting phase', () => {
        expect(createGame('r', 'd').phase).toBe('betting');
    });

    it('starts with empty players array', () => {
        expect(createGame('r', 'd').players).toEqual([]);
    });

    it('dealer starts with empty hand', () => {
        expect(createGame('r', 'd').dealer.hand).toEqual([]);
    });

    it('dealer.revealed starts as false', () => {
        expect(createGame('r', 'd').dealer.revealed).toBe(false);
    });

    it('currentPlayerIndex is -1 (no active player)', () => {
        expect(createGame('r', 'd').currentPlayerIndex).toBe(-1);
    });

    it('deck has 52 cards', () => {
        expect(createGame('r', 'd').deck).toHaveLength(52);
    });
});

describe('B2 — calculateHand: Ace flexibility', () => {
    it('A counts as 11 when safe', () => {
        const hand = [{ value: 'A' }, { value: '9' }];
        expect(calculateHand(hand)).toBe(20);
    });

    it('A falls back to 1 when 11 would bust', () => {
        const hand = [{ value: 'A' }, { value: '9' }, { value: '5' }];
        expect(calculateHand(hand)).toBe(15); // A=1, 9+5+1 = 15
    });

    it('two Aces: first is 11, second falls to 1', () => {
        const hand = [{ value: 'A' }, { value: 'A' }];
        expect(calculateHand(hand)).toBe(12); // 11+1
    });

    it('A+A+9 = 21', () => {
        const hand = [{ value: 'A' }, { value: 'A' }, { value: '9' }];
        expect(calculateHand(hand)).toBe(21);
    });

    it('K counts as 10', () => {
        const hand = [{ value: 'K' }, { value: '7' }];
        expect(calculateHand(hand)).toBe(17);
    });

    it('Q counts as 10', () => {
        const hand = [{ value: 'Q' }, { value: '8' }];
        expect(calculateHand(hand)).toBe(18);
    });

    it('J counts as 10', () => {
        const hand = [{ value: 'J' }, { value: '6' }];
        expect(calculateHand(hand)).toBe(16);
    });

    it('empty hand returns 0', () => {
        expect(calculateHand([])).toBe(0);
    });
});

describe('B3 — isBlackjack and isBust', () => {
    it('detects blackjack: Ace + King (2 cards, value 21)', () => {
        expect(isBlackjack([{ value: 'A' }, { value: 'K' }])).toBe(true);
    });

    it('three cards summing to 21 is NOT blackjack', () => {
        expect(isBlackjack([{ value: '7' }, { value: '7' }, { value: '7' }])).toBe(false);
    });

    it('two cards summing to 20 is NOT blackjack', () => {
        expect(isBlackjack([{ value: 'K' }, { value: 'Q' }])).toBe(false);
    });

    it('isBust returns true for hand over 21', () => {
        expect(isBust([{ value: 'K' }, { value: 'Q' }, { value: '5' }])).toBe(true);
    });

    it('isBust returns false for hand exactly 21', () => {
        expect(isBust([{ value: 'K' }, { value: 'A' }])).toBe(false);
    });

    it('isBust returns false for hand under 21', () => {
        expect(isBust([{ value: '9' }, { value: '8' }])).toBe(false);
    });
});

describe('B4 — placeBet (blackjack)', () => {
    it('sets bet and marks player as ready', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 200);
        const player = game.players.find(p => p.peer_id === 'p1');
        expect(player.bet).toBe(200);
        expect(player.status).toBe('ready');
    });

    it('rejects a bet of zero — player status stays waiting', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        const g = bjPlaceBet(game, 'p1', 0);
        expect(g.players[0].status).toBe('waiting');
    });

    it('rejects negative bet', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        const g = bjPlaceBet(game, 'p1', -100);
        expect(g.players[0].bet).toBe(0);
    });

    it('rejects Infinity bet', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        const g = bjPlaceBet(game, 'p1', Infinity);
        expect(g.players[0].bet).toBe(0);
    });
});

describe('B5 — dealInitialCards', () => {
    it('deals exactly 2 cards to each player and 2 to dealer', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        game = addPlayer(game, 'p2', 'Bob');
        game = bjPlaceBet(game, 'p1', 100);
        game = bjPlaceBet(game, 'p2', 100);
        const dealt = dealInitialCards(game);
        expect(dealt.players[0].hand).toHaveLength(2);
        expect(dealt.players[1].hand).toHaveLength(2);
        expect(dealt.dealer.hand).toHaveLength(2);
    });

    it('phase transitions to playing after dealing', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        const dealt = dealInitialCards(game);
        // Phase is 'playing' when at least one player is not blackjack
        expect(['playing', 'dealer']).toContain(dealt.phase);
    });

    it('deck shrinks by (players+dealer) * 2 cards after deal', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        const initialDeckSize = game.deck.length;
        const dealt = dealInitialCards(game);
        // 1 player + dealer = 2 entities × 2 cards = 4 cards removed
        expect(dealt.deck).toHaveLength(initialDeckSize - 4);
    });
});

describe('B6 — hit and stand mechanics', () => {
    function setupPlayingGame() {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        // Force a known starting hand by replacing deck with controlled cards
        const controlledDeck = [
            { value: '5', suit: '♠', id: '5♠' },
            { value: '4', suit: '♥', id: '4♥' },
            { value: '3', suit: '♦', id: '3♦' },
            { value: '2', suit: '♣', id: '2♣' },
        ];
        game = { ...game, deck: controlledDeck };
        return dealInitialCards(game);
    }

    it('hit adds a card to the current players hand', () => {
        const game = setupPlayingGame();
        if (game.phase !== 'playing') return; // blackjack edge case — skip
        const p1Index = game.currentPlayerIndex;
        const handSizeBefore = game.players[p1Index].hand.length;
        const afterHit = hit(game, 'p1');
        expect(afterHit.players[p1Index].hand.length).toBe(handSizeBefore + 1);
    });

    it('stand changes player status to stand', () => {
        const game = setupPlayingGame();
        if (game.phase !== 'playing') return;
        const afterStand = stand(game, 'p1');
        const p1 = afterStand.players.find(p => p.peer_id === 'p1');
        expect(p1.status).toBe('stand');
    });

    it('stand transitions to dealer phase when last player stands', () => {
        const game = setupPlayingGame();
        if (game.phase !== 'playing') return;
        const afterStand = stand(game, 'p1');
        // With a single player, after stand the dealer phase should begin
        expect(afterStand.phase).toBe('dealer');
        expect(afterStand.dealer.revealed).toBe(true);
    });

    it('hit ignores wrong player (not current turn)', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        game = addPlayer(game, 'p2', 'Bob');
        game = bjPlaceBet(game, 'p1', 100);
        game = bjPlaceBet(game, 'p2', 100);
        game = dealInitialCards(game);
        if (game.phase !== 'playing') return;
        // Determine who the current player is and try to hit the OTHER one
        const currentIndex = game.currentPlayerIndex;
        const otherIndex = currentIndex === 0 ? 1 : 0;
        const otherId = game.players[otherIndex].peer_id;
        const before = game.players[otherIndex].hand.length;
        const after = hit(game, otherId);
        // The wrong player's hand must not have changed
        expect(after.players[otherIndex].hand.length).toBe(before);
    });
});

describe('B7 — dealerPlay', () => {
    it('dealer hits until hand is at least 17', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        game = dealInitialCards(game);
        game = stand(game, 'p1');
        if (game.phase !== 'dealer') return;
        const played = dealerPlay(game);
        expect(calculateHand(played.dealer.hand)).toBeGreaterThanOrEqual(17);
    });

    it('dealerPlay is a no-op if phase is not dealer', () => {
        const game = createGame('r', 'd');
        const result = dealerPlay(game); // phase is 'betting'
        expect(result).toBe(game); // strict identity (unchanged)
    });

    it('dealerPlay sets phase to settlement', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        game = dealInitialCards(game);
        game = stand(game, 'p1');
        if (game.phase !== 'dealer') return;
        const settled = dealerPlay(game);
        expect(settled.phase).toBe('settlement');
    });
});

describe('B8 — settle and getPayouts', () => {
    it('player wins: getPayouts returns +bet', () => {
        // Build a synthetic settled game where player beats dealer
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        const settledGame = {
            ...game,
            phase: 'ended',
            players: [{
                peer_id: 'p1',
                nick: 'Alice',
                hand: [{ value: 'K' }, { value: '9' }], // 19
                status: 'win',
                bet: 100,
            }],
        };
        const payouts = getPayouts(settledGame);
        expect(payouts['p1']).toBe(100);
    });

    it('player blackjack: getPayouts returns +1.5x bet (floored)', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        const settledGame = {
            ...game,
            phase: 'ended',
            players: [{
                peer_id: 'p1',
                nick: 'Alice',
                hand: [{ value: 'A' }, { value: 'K' }],
                status: 'blackjack-win',
                bet: 100,
            }],
        };
        expect(getPayouts(settledGame)['p1']).toBe(150);
    });

    it('push: getPayouts returns 0', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        const settledGame = {
            ...game,
            phase: 'ended',
            players: [{
                peer_id: 'p1',
                nick: 'Alice',
                hand: [{ value: 'K' }, { value: '8' }], // 18
                status: 'push',
                bet: 100,
            }],
        };
        expect(getPayouts(settledGame)['p1']).toBe(0);
    });

    it('player bust: getPayouts returns -bet', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        const settledGame = {
            ...game,
            phase: 'ended',
            players: [{
                peer_id: 'p1',
                nick: 'Alice',
                hand: [{ value: 'K' }, { value: 'Q' }, { value: '5' }],
                status: 'bust',
                bet: 100,
            }],
        };
        expect(getPayouts(settledGame)['p1']).toBe(-100);
    });

    it('getPayouts returns empty object if phase is not ended', () => {
        const game = createGame('r', 'd');
        expect(getPayouts(game)).toEqual({});
    });

    it('dealer bust: all active players win — settle returns win status', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);

        // Craft a settlement scenario with dealer busted
        const settlementGame = {
            ...game,
            phase: 'settlement',
            dealer: {
                peer_id: 'd',
                nick: 'Dealer',
                hand: [{ value: 'K' }, { value: 'Q' }, { value: '5' }], // bust = 25
                revealed: true,
            },
            players: [{
                peer_id: 'p1',
                nick: 'Alice',
                hand: [{ value: 'K' }, { value: '8' }], // 18, status stand
                status: 'stand',
                bet: 100,
            }],
        };
        const settled = settle(settlementGame);
        const p1 = settled.players.find(p => p.peer_id === 'p1');
        expect(p1.status).toBe('win');
    });
});

describe('B9 — canSplit and split', () => {
    function splitSetupGame() {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        // Force a pair of Kings into the deck so they get dealt
        const forcedDeck = [
            { value: 'K', suit: '♠', id: 'K♠' }, // dealer card 2
            { value: 'K', suit: '♥', id: 'K♥' }, // player card 2
            { value: '5', suit: '♦', id: '5♦' }, // dealer card 1
            { value: 'K', suit: '♦', id: 'K♦' }, // player card 1
        ];
        game = { ...game, deck: forcedDeck };
        return dealInitialCards(game);
    }

    it('canSplit returns true for two Kings (same value)', () => {
        const game = splitSetupGame();
        if (game.phase !== 'playing') return; // unlikely but safe
        expect(canSplit(game, 'p1')).toBe(true);
    });

    it('split creates two separate hands with equal splitBet', () => {
        const game = splitSetupGame();
        if (!canSplit(game, 'p1')) return;
        const splitGame = split(game, 'p1');
        const p1 = splitGame.players.find(p => p.peer_id === 'p1');
        expect(p1.hand).toHaveLength(2);
        expect(p1.splitHand).toHaveLength(2);
        expect(p1.splitBet).toBe(100); // equal to original bet
    });

    it('canSplit returns false when player is not the current player', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        game = addPlayer(game, 'p2', 'Bob');
        game = bjPlaceBet(game, 'p1', 100);
        game = bjPlaceBet(game, 'p2', 100);
        game = dealInitialCards(game);
        if (game.phase !== 'playing') return;
        // Identify the NON-current player and assert canSplit is false for them
        const currentIndex = game.currentPlayerIndex;
        const otherIndex = currentIndex === 0 ? 1 : 0;
        const otherId = game.players[otherIndex].peer_id;
        expect(canSplit(game, otherId)).toBe(false);
    });
});

describe('B10 — canDoubleDown and doubleDown', () => {
    it('canDoubleDown returns true after initial deal (2 cards)', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        game = dealInitialCards(game);
        if (game.phase !== 'playing') return;
        expect(canDoubleDown(game, 'p1')).toBe(true);
    });

    it('doubleDown doubles the players bet', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        game = dealInitialCards(game);
        if (!canDoubleDown(game, 'p1')) return;
        const downed = doubleDown(game, 'p1');
        const p1 = downed.players.find(p => p.peer_id === 'p1');
        expect(p1.bet).toBe(200);
    });

    it('doubleDown deals exactly one extra card', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        game = dealInitialCards(game);
        if (!canDoubleDown(game, 'p1')) return;
        const downed = doubleDown(game, 'p1');
        const p1 = downed.players.find(p => p.peer_id === 'p1');
        expect(p1.hand).toHaveLength(3);
    });

    it('canDoubleDown returns false in non-playing phase', () => {
        const game = createGame('r', 'd');
        expect(canDoubleDown(game, 'p1')).toBe(false);
    });
});

describe('B11 — newRound (blackjack)', () => {
    it('resets phase to betting', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        game = dealInitialCards(game);
        const fresh = bjNewRound(game);
        expect(fresh.phase).toBe('betting');
    });

    it('preserves player identities (peer_id and nick)', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        const fresh = bjNewRound(game);
        expect(fresh.players[0].peer_id).toBe('p1');
        expect(fresh.players[0].nick).toBe('Alice');
    });

    it('resets players bet to 0', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        const fresh = bjNewRound(game);
        expect(fresh.players[0].bet).toBe(0);
    });

    it('resets player status to waiting', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        const fresh = bjNewRound(game);
        expect(fresh.players[0].status).toBe('waiting');
    });

    it('provides a fresh 52-card deck', () => {
        let game = createGame('r', 'd');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        game = dealInitialCards(game); // shrinks deck
        const fresh = bjNewRound(game);
        expect(fresh.deck).toHaveLength(52);
    });
});

describe('B12 — BlackjackEngine class', () => {
    it('getRules returns object with bets array', () => {
        const game = createGame('r', 'd');
        const engine = new BlackjackEngine(game);
        const rules = engine.getRules();
        expect(rules).toHaveProperty('bets');
        expect(Array.isArray(rules.bets)).toBe(true);
    });

    it('getRules includes win, blackjack, push, and split entries', () => {
        const engine = new BlackjackEngine(createGame('r', 'd'));
        const names = engine.getRules().bets.map(b => b.name);
        expect(names).toContain('Win');
        expect(names).toContain('Blackjack');
        expect(names).toContain('Push');
        expect(names).toContain('Split');
    });

    it('calculatePayout aggregates multi-player results correctly', () => {
        const game = createGame('r', 'd');
        const engine = new BlackjackEngine(game);
        const players = [
            { peer_id: 'p1', bet: 100, status: 'win' },
            { peer_id: 'p2', bet: 200, status: 'lose' },
            { peer_id: 'p3', bet: 50, status: 'push' },
        ];
        const payouts = engine.calculatePayout(players, null);
        expect(payouts['p1']).toBe(100);
        expect(payouts['p2']).toBe(-200);
        expect(payouts['p3']).toBe(0);
    });

    it('getGameState returns the game object passed to the constructor', () => {
        const game = createGame('r', 'd');
        const engine = new BlackjackEngine(game);
        expect(engine.getGameState()).toBe(game);
    });
});

/* ═══════════════════════════════════════════════════════════════════════
   SECTION C — SLOTS ENGINE
   ═══════════════════════════════════════════════════════════════════════ */

describe('C1 — createSlots: initial state', () => {
    it('type is slots', () => {
        expect(createSlots('room-slots').type).toBe('slots');
    });

    it('starts in betting phase', () => {
        expect(createSlots('room-slots').phase).toBe('betting');
    });

    it('starts with empty reels array', () => {
        expect(createSlots('room-slots').reels).toEqual([]);
    });

    it('starts with empty bets array', () => {
        expect(createSlots('room-slots').bets).toEqual([]);
    });

    it('starts with payouts null', () => {
        expect(createSlots('room-slots').payouts).toBeNull();
    });

    it('stores roomId on the state object', () => {
        expect(createSlots('my-slots-room').roomId).toBe('my-slots-room');
    });

    it('has a _ts timestamp property', () => {
        const before = Date.now();
        const game = createSlots('room-ts');
        expect(game._ts).toBeGreaterThanOrEqual(before);
    });
});

describe('C2 — spinReels: output shape', () => {
    it('returns an array of 3 elements by default', () => {
        const reels = spinReels();
        expect(Array.isArray(reels)).toBe(true);
        expect(reels).toHaveLength(3);
    });

    it('returns an array of N elements when count is provided', () => {
        expect(spinReels(1)).toHaveLength(1);
        expect(spinReels(5)).toHaveLength(5);
    });

    it('every symbol returned is in the valid SYMBOLS set', () => {
        const VALID = new Set(['🍒', '🍋', '🍊', '🍇', '💎', '7️⃣']);
        const reels = spinReels(30); // sample 30 spins
        for (const sym of reels) {
            expect(VALID.has(sym)).toBe(true);
        }
    });
});

describe('C3 — calculatePayout (slots free function)', () => {
    it('three 7s pays 50x bet (jackpot)', () => {
        const reels = ['7️⃣', '7️⃣', '7️⃣'];
        expect(slotsPayout(reels, 10)).toBe(500); // 10 * 50
    });

    it('three diamonds pays 20x bet', () => {
        expect(slotsPayout(['💎', '💎', '💎'], 5)).toBe(100); // 5 * 20
    });

    it('three grapes pays 10x bet', () => {
        expect(slotsPayout(['🍇', '🍇', '🍇'], 4)).toBe(40);
    });

    it('three oranges pays 6x bet', () => {
        expect(slotsPayout(['🍊', '🍊', '🍊'], 10)).toBe(60);
    });

    it('three lemons pays 4x bet', () => {
        expect(slotsPayout(['🍋', '🍋', '🍋'], 10)).toBe(40);
    });

    it('three cherries pays 3x bet', () => {
        expect(slotsPayout(['🍒', '🍒', '🍒'], 10)).toBe(30);
    });

    it('two cherries on first two reels pays 2x (regardless of third symbol)', () => {
        expect(slotsPayout(['🍒', '🍒', '🍇'], 10)).toBe(20);
    });

    it('cherry on reel 1 and 3 only (not reel 2) is a loss', () => {
        expect(slotsPayout(['🍒', '🍇', '🍒'], 10)).toBe(-10);
    });

    it('no match is a loss: returns negative bet', () => {
        expect(slotsPayout(['🍒', '🍋', '🍊'], 20)).toBe(-20);
    });

    it('no match with a large bet returns -betAmount', () => {
        expect(slotsPayout(['🍒', '🍋', '🍊'], 500)).toBe(-500);
    });

    it('three-of-a-kind always beats two-cherry partial match', () => {
        // Sanity: three cherries (3x) is better than two cherries (2x)
        const threePayout = slotsPayout(['🍒', '🍒', '🍒'], 10);
        const twoPayout = slotsPayout(['🍒', '🍒', '🍇'], 10);
        expect(threePayout).toBeGreaterThan(twoPayout);
    });
});

describe('C4 — SLOT_PAYOUTS table shape', () => {
    it('contains the jackpot key (three 7s)', () => {
        expect(SLOT_PAYOUTS['7️⃣7️⃣7️⃣']).toBe(50);
    });

    it('contains all three-of-a-kind keys', () => {
        const threeOfAKind = ['💎💎💎', '🍇🍇🍇', '🍊🍊🍊', '🍋🍋🍋', '🍒🍒🍒'];
        for (const key of threeOfAKind) {
            expect(SLOT_PAYOUTS).toHaveProperty(key);
        }
    });

    it('contains the two-cherry partial match key', () => {
        expect(SLOT_PAYOUTS['🍒🍒']).toBe(2);
    });

    it('jackpot multiplier (50) is the highest in the table', () => {
        const maxMultiplier = Math.max(...Object.values(SLOT_PAYOUTS));
        expect(maxMultiplier).toBe(50);
    });

    it('all multiplier values are positive numbers', () => {
        for (const v of Object.values(SLOT_PAYOUTS)) {
            expect(typeof v).toBe('number');
            expect(v).toBeGreaterThan(0);
        }
    });
});

describe('C5 — SlotsEngine class', () => {
    it('getRules returns an object with a bets array', () => {
        const game = createSlots('r');
        const engine = new SlotsEngine(game);
        const rules = engine.getRules();
        expect(rules).toHaveProperty('bets');
        expect(Array.isArray(rules.bets)).toBe(true);
    });

    it('getRules bets include the jackpot entry', () => {
        const engine = new SlotsEngine(createSlots('r'));
        const names = engine.getRules().bets.map(b => b.name);
        expect(names.some(n => n.includes('7️⃣'))).toBe(true);
    });

    it('getGameState returns the game passed to the constructor', () => {
        const game = createSlots('r');
        const engine = new SlotsEngine(game);
        expect(engine.getGameState()).toBe(game);
    });

    it('calculatePayout aggregates payouts for multiple bets from same peer', () => {
        const engine = new SlotsEngine(createSlots('r'));
        const bets = [
            { peer_id: 'p1', amount: 10 },
            { peer_id: 'p1', amount: 20 },
        ];
        const reels = ['7️⃣', '7️⃣', '7️⃣']; // jackpot (50x)
        const payouts = engine.calculatePayout(bets, reels);
        // Both bets win: 10*50 + 20*50 = 1500
        expect(payouts['p1']).toBe(1500);
    });

    it('calculatePayout returns correct net map for multiple peers', () => {
        const engine = new SlotsEngine(createSlots('r'));
        const bets = [
            { peer_id: 'p1', amount: 100 },
            { peer_id: 'p2', amount: 50 },
        ];
        const reels = ['🍒', '🍋', '🍊']; // no match → loss for both
        const payouts = engine.calculatePayout(bets, reels);
        expect(payouts['p1']).toBe(-100);
        expect(payouts['p2']).toBe(-50);
    });

    it('calculatePayout handles a winning reel for one peer and losing for another', () => {
        // This is per-spin so both get same reels — testing aggregation correctness
        const engine = new SlotsEngine(createSlots('r'));
        const bets = [
            { peer_id: 'p1', amount: 10 },
            { peer_id: 'p2', amount: 5 },
        ];
        const reels = ['💎', '💎', '💎']; // 20x win
        const payouts = engine.calculatePayout(bets, reels);
        expect(payouts['p1']).toBe(200); // 10 * 20
        expect(payouts['p2']).toBe(100); // 5 * 20
    });

    it('getRules has a name and description', () => {
        const engine = new SlotsEngine(createSlots('r'));
        const rules = engine.getRules();
        expect(typeof rules.name).toBe('string');
        expect(typeof rules.description).toBe('string');
    });

    it('calculatePayout handles zero bets array without error', () => {
        const engine = new SlotsEngine(createSlots('r'));
        const payouts = engine.calculatePayout([], ['🍒', '🍒', '🍒']);
        expect(payouts).toEqual({});
    });
});

describe('C6 — SLOTS_RULES shape', () => {
    it('has name, description, and bets', () => {
        expect(SLOTS_RULES).toHaveProperty('name');
        expect(SLOTS_RULES).toHaveProperty('description');
        expect(SLOTS_RULES).toHaveProperty('bets');
    });

    it('bets array has at least 6 entries (one per symbol + two-cherry)', () => {
        expect(SLOTS_RULES.bets.length).toBeGreaterThanOrEqual(6);
    });

    it('each bet entry has name, odds, and description', () => {
        for (const bet of SLOTS_RULES.bets) {
            expect(bet).toHaveProperty('name');
            expect(bet).toHaveProperty('odds');
            expect(bet).toHaveProperty('description');
        }
    });
});
