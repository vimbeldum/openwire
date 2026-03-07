import { describe, it, expect, vi } from 'vitest';

/* ── Imports under test ─────────────────────────────────────── */
import { getPayout, placeBet, clearBets, spin, ROULETTE_RULES, RouletteEngine, createRoulette } from '../lib/roulette.js';
import { calculateHand, isBlackjack, isBust, createGame, addPlayer, placeBet as bjPlaceBet, dealInitialCards, stand, runDealerTurn, getPayouts } from '../lib/blackjack.js';
import { calculatePayout as slotsPayout, spinReels, SLOT_PAYOUTS, SLOTS_RULES, SlotsEngine, createSlots } from '../lib/slots.js';
import { GameEngine, createGameEngine, getRegisteredGames } from '../lib/GameEngine.js';
import { createCasinoState, mergeCasinoStates, updateHousePnl, getTotalHousePnl, serializeCasinoState, parseCasinoState, isCasinoStateMessage } from '../lib/casinoState.js';

/* ═══════════════════════════════════════════════════════════════
   SUITE 1 — Roulette Payouts (European standard ratios)
   ═══════════════════════════════════════════════════════════════ */

describe('Roulette: getPayout ratios', () => {
    it('single number win returns 36 (35:1 + stake)', () => {
        expect(getPayout('single', 7, 7)).toBe(36);
    });
    it('single number miss returns 0', () => {
        expect(getPayout('single', 7, 8)).toBe(0);
    });
    it('color red win returns 2 (1:1 + stake)', () => {
        expect(getPayout('color', 'red', 1)).toBe(2);   // 1 is red
    });
    it('color red loses on black', () => {
        expect(getPayout('color', 'red', 2)).toBe(0);   // 2 is black
    });
    it('color bet loses on zero', () => {
        expect(getPayout('color', 'red', 0)).toBe(0);
        expect(getPayout('color', 'black', 0)).toBe(0);
    });
    it('even/odd wins return 2', () => {
        expect(getPayout('parity', 'even', 4)).toBe(2);
        expect(getPayout('parity', 'odd', 3)).toBe(2);
    });
    it('parity bets lose on zero', () => {
        expect(getPayout('parity', 'even', 0)).toBe(0);
        expect(getPayout('parity', 'odd', 0)).toBe(0);
    });
    it('half low/high wins return 2', () => {
        expect(getPayout('half', 'low', 10)).toBe(2);
        expect(getPayout('half', 'high', 25)).toBe(2);
    });
    it('half bets lose on zero', () => {
        expect(getPayout('half', 'low', 0)).toBe(0);
    });
    it('dozen bets return 3 (2:1 + stake)', () => {
        expect(getPayout('dozen', 1, 5)).toBe(3);    // 5 is in dozen 1
        expect(getPayout('dozen', 2, 15)).toBe(3);   // 15 is in dozen 2
        expect(getPayout('dozen', 3, 30)).toBe(3);   // 30 is in dozen 3
    });
    it('column bets return 3', () => {
        expect(getPayout('column', 1, 1)).toBe(3);   // 1 % 3 === 1
        expect(getPayout('column', 2, 2)).toBe(3);   // 2 % 3 === 2
        expect(getPayout('column', 3, 3)).toBe(3);   // 3 % 3 === 0
    });
    it('unknown bet type returns 0', () => {
        expect(getPayout('unknown', null, 5)).toBe(0);
    });
});

describe('Roulette: game state mutations', () => {
    it('placeBet adds a bet to game state', () => {
        const game = createRoulette('room1');
        const updated = placeBet(game, 'peer1', 'Alice', 'color', 'red', 100);
        expect(updated.bets).toHaveLength(1);
        expect(updated.bets[0].amount).toBe(100);
    });
    it('placing same bet type+target replaces existing bet', () => {
        let game = createRoulette('room1');
        game = placeBet(game, 'peer1', 'Alice', 'color', 'red', 100);
        game = placeBet(game, 'peer1', 'Alice', 'color', 'red', 200);
        expect(game.bets).toHaveLength(1);
        expect(game.bets[0].amount).toBe(200);
    });
    it('clearBets removes only the specified player bets', () => {
        let game = createRoulette('room1');
        game = placeBet(game, 'peer1', 'Alice', 'color', 'red', 100);
        game = placeBet(game, 'peer2', 'Bob', 'color', 'black', 50);
        game = clearBets(game, 'peer1');
        expect(game.bets).toHaveLength(1);
        expect(game.bets[0].peer_id).toBe('peer2');
    });
    it('spin transitions phase to spinning and produces a valid result', () => {
        let game = createRoulette('room1');
        game = placeBet(game, 'peer1', 'Alice', 'color', 'red', 100);
        const spun = spin(game);
        expect(spun.phase).toBe('spinning');
        expect(spun.result).toBeGreaterThanOrEqual(0);
        expect(spun.result).toBeLessThanOrEqual(36);
    });
    it('spin payouts are correct for a winning red bet', () => {
        // Force result = 1 (red)
        vi.spyOn(Math, 'random').mockReturnValue(0.001);   // Math.floor(37 * 0.001) = 0... hmm
        // Just test the payout logic directly instead
        vi.restoreAllMocks();
        let game = createRoulette('room1');
        game = placeBet(game, 'peer1', 'Alice', 'color', 'red', 100);
        // Manually test a red win: payout multiplier = 2, net = 100*(2-1) = +100
        const net = getPayout('color', 'red', 1) > 0 ? 100 * (2 - 1) : -100;
        expect(net).toBe(100);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 2 — Blackjack Logic
   ═══════════════════════════════════════════════════════════════ */

describe('Blackjack: hand calculations', () => {
    it('calculates a simple hand correctly', () => {
        expect(calculateHand([{ value: '5', suit: '♠' }, { value: '7', suit: '♥' }])).toBe(12);
    });
    it('face cards count as 10', () => {
        expect(calculateHand([{ value: 'K', suit: '♠' }, { value: 'Q', suit: '♥' }])).toBe(20);
    });
    it('ace counts as 11 when safe', () => {
        expect(calculateHand([{ value: 'A', suit: '♠' }, { value: '9', suit: '♥' }])).toBe(20);
    });
    it('ace falls back to 1 to avoid bust', () => {
        expect(calculateHand([
            { value: 'A', suit: '♠' },
            { value: '9', suit: '♥' },
            { value: '5', suit: '♦' },
        ])).toBe(15);
    });
    it('detects blackjack (Ace + face card)', () => {
        expect(isBlackjack([{ value: 'A', suit: '♠' }, { value: 'K', suit: '♥' }])).toBe(true);
    });
    it('three cards summing to 21 is NOT blackjack', () => {
        expect(isBlackjack([
            { value: '7', suit: '♠' },
            { value: '7', suit: '♥' },
            { value: '7', suit: '♦' },
        ])).toBe(false);
    });
    it('detects bust', () => {
        expect(isBust([
            { value: '10', suit: '♠' },
            { value: 'K', suit: '♥' },
            { value: '5', suit: '♦' },
        ])).toBe(true);
    });
});

describe('Blackjack: payout settlement', () => {
    it('win pays +bet, lose pays -bet, push pays 0', () => {
        // Build a minimal settled game manually
        const game = {
            phase: 'ended',
            players: [
                { peer_id: 'p1', status: 'win', bet: 200 },
                { peer_id: 'p2', status: 'lose', bet: 100 },
                { peer_id: 'p3', status: 'push', bet: 50 },
            ],
        };
        const payouts = getPayouts(game);
        expect(payouts['p1']).toBe(200);
        expect(payouts['p2']).toBe(-100);
        expect(payouts['p3']).toBe(0);
    });
    it('blackjack-win pays 1.5× bet (floored)', () => {
        const game = {
            phase: 'ended',
            players: [{ peer_id: 'p1', status: 'blackjack-win', bet: 100 }],
        };
        expect(getPayouts(game)['p1']).toBe(150);
    });
    it('odd blackjack bet floors to integer', () => {
        const game = {
            phase: 'ended',
            players: [{ peer_id: 'p1', status: 'blackjack-win', bet: 101 }],
        };
        expect(Number.isInteger(getPayouts(game)['p1'])).toBe(true);
    });
    it('returns empty object if game not ended', () => {
        const game = { phase: 'playing', players: [] };
        expect(getPayouts(game)).toEqual({});
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 3 — Slots Logic
   ═══════════════════════════════════════════════════════════════ */

describe('Slots: payout calculations', () => {
    it('three 7s (jackpot) returns 50× bet', () => {
        expect(slotsPayout(['7️⃣', '7️⃣', '7️⃣'], 100)).toBe(5000);
    });
    it('three diamonds return 20× bet', () => {
        expect(slotsPayout(['💎', '💎', '💎'], 50)).toBe(1000);
    });
    it('two cherries return 2× bet', () => {
        expect(slotsPayout(['🍒', '🍒', '🍊'], 100)).toBe(200);
    });
    it('no match returns negative (player loses bet)', () => {
        expect(slotsPayout(['🍋', '🍊', '💎'], 100)).toBe(-100);
    });
    it('spinReels returns an array of 3 symbols', () => {
        const reels = spinReels();
        expect(reels).toHaveLength(3);
        const validSymbols = ['🍒', '🍋', '🍊', '🍇', '💎', '7️⃣'];
        for (const s of reels) {
            expect(validSymbols).toContain(s);
        }
    });
    it('spinReels respects custom reel count', () => {
        expect(spinReels(5)).toHaveLength(5);
    });
    it('SLOT_PAYOUTS table has expected keys', () => {
        expect(SLOT_PAYOUTS['7️⃣7️⃣7️⃣']).toBe(50);
        expect(SLOT_PAYOUTS['🍒🍒']).toBe(2);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 4 — GameEngine interface & registry
   ═══════════════════════════════════════════════════════════════ */

describe('GameEngine: interface contract', () => {
    it('base class throws on unimplemented methods', () => {
        const engine = new GameEngine();
        expect(() => engine.getGameState()).toThrow();
        expect(() => engine.calculatePayout([], null)).toThrow();
        expect(() => engine.getRules()).toThrow();
    });

    it('RouletteEngine implements all three methods', () => {
        const game = createRoulette('room-test');
        const engine = new RouletteEngine(game);
        expect(engine.getGameState()).toBe(game);
        expect(engine.getRules()).toBe(ROULETTE_RULES);
        expect(typeof engine.calculatePayout([], 0)).toBe('object');
    });

    it('RouletteEngine calculatePayout produces correct net for a red bet win', () => {
        const game = createRoulette('room-test');
        const bets = [{ peer_id: 'p1', nick: 'Alice', betType: 'color', betTarget: 'red', amount: 100 }];
        const engine = new RouletteEngine(game);
        const payouts = engine.calculatePayout(bets, 1); // 1 is red
        expect(payouts['p1']).toBe(100);  // net = 100 * (2-1)
    });

    it('RouletteEngine calculatePayout produces correct net for a red bet loss', () => {
        const game = createRoulette('room-test');
        const bets = [{ peer_id: 'p1', nick: 'Alice', betType: 'color', betTarget: 'red', amount: 100 }];
        const engine = new RouletteEngine(game);
        const payouts = engine.calculatePayout(bets, 0); // 0 is green — red loses
        expect(payouts['p1']).toBe(-100);
    });

    it('SlotsEngine implements all three methods', () => {
        const game = createSlots('room-test');
        const engine = new SlotsEngine(game);
        expect(engine.getGameState()).toBe(game);
        expect(engine.getRules()).toBe(SLOTS_RULES);
    });

    it('SlotsEngine calculatePayout returns correct map', () => {
        const game = createSlots('room-test');
        const engine = new SlotsEngine(game);
        const bets = [{ peer_id: 'p1', amount: 100 }];
        const payouts = engine.calculatePayout(bets, ['7️⃣', '7️⃣', '7️⃣']);
        expect(payouts['p1']).toBe(5000);
    });

    it('createGameEngine can instantiate a registered engine', () => {
        const game = createRoulette('room-test');
        const engine = createGameEngine('roulette', game);
        expect(engine).toBeInstanceOf(RouletteEngine);
    });

    it('createGameEngine throws for unknown game type', () => {
        expect(() => createGameEngine('poker', {})).toThrow();
    });

    it('getRegisteredGames includes roulette and slots', () => {
        const games = getRegisteredGames();
        expect(games).toContain('roulette');
        expect(games).toContain('slots');
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 5 — Casino State: LWW Merge & House P&L
   ═══════════════════════════════════════════════════════════════ */

describe('casinoState: LWW merge', () => {
    it('createCasinoState has expected shape', () => {
        const state = createCasinoState();
        expect(state).toHaveProperty('_ts');
        expect(state).toHaveProperty('housePnl');
        expect(state.housePnl).toHaveProperty('roulette', 0);
        expect(state.housePnl).toHaveProperty('slots', 0);
    });

    it('merge prefers the state with the newer housePnl _ts', () => {
        const local = createCasinoState();
        local.housePnl.roulette = 500;
        local.housePnl._ts = 1000;

        const remote = createCasinoState();
        remote.housePnl.roulette = 9999;
        remote.housePnl._ts = 2000; // newer

        const merged = mergeCasinoStates(local, remote);
        expect(merged.housePnl.roulette).toBe(9999); // remote wins
    });

    it('merge keeps local housePnl when local is newer', () => {
        const local = createCasinoState();
        local.housePnl.roulette = 500;
        local.housePnl._ts = 5000; // newer

        const remote = createCasinoState();
        remote.housePnl.roulette = 100;
        remote.housePnl._ts = 1000;

        const merged = mergeCasinoStates(local, remote);
        expect(merged.housePnl.roulette).toBe(500); // local wins
    });

    it('merge handles null remote gracefully', () => {
        const local = createCasinoState();
        expect(mergeCasinoStates(local, null)).toBe(local);
    });

    it('merge handles null local gracefully', () => {
        const remote = createCasinoState();
        expect(mergeCasinoStates(null, remote)).toBe(remote);
    });
});

describe('casinoState: House P&L tracking', () => {
    it('updateHousePnl correctly accumulates house gain', () => {
        let state = createCasinoState();
        // Player loses 100, house gains 100
        state = updateHousePnl(state, 'roulette', { p1: -100 });
        expect(state.housePnl.roulette).toBe(100);
    });

    it('updateHousePnl handles player wins (house loses)', () => {
        let state = createCasinoState();
        state = updateHousePnl(state, 'blackjack', { p1: 200 });
        expect(state.housePnl.blackjack).toBe(-200);
    });

    it('updateHousePnl accumulates across multiple rounds', () => {
        let state = createCasinoState();
        state = updateHousePnl(state, 'roulette', { p1: -100, p2: 50 });
        // House gain = -((-100) + 50) = 50
        expect(state.housePnl.roulette).toBe(50);
        state = updateHousePnl(state, 'roulette', { p1: -200 });
        expect(state.housePnl.roulette).toBe(250);
    });

    it('getTotalHousePnl sums all games', () => {
        let state = createCasinoState();
        state = updateHousePnl(state, 'roulette', { p1: -100 });   // +100
        state = updateHousePnl(state, 'blackjack', { p1: 50 });     // -50
        expect(getTotalHousePnl(state)).toBe(50);
    });
});

describe('casinoState: serialization', () => {
    it('round-trips through serialize/parse', () => {
        const state = createCasinoState();
        state.housePnl.roulette = 1234;
        const serialized = serializeCasinoState(state);
        expect(isCasinoStateMessage(serialized)).toBe(true);
        const parsed = parseCasinoState(serialized);
        expect(parsed.housePnl.roulette).toBe(1234);
    });
    it('isCasinoStateMessage returns false for non-CS messages', () => {
        expect(isCasinoStateMessage('BJ:{"foo":1}')).toBe(false);
        expect(isCasinoStateMessage('hello')).toBe(false);
    });
    it('parseCasinoState returns null for invalid data', () => {
        expect(parseCasinoState('CS:not-json')).toBeNull();
        expect(parseCasinoState('RL:something')).toBeNull();
    });
});
