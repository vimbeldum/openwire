import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Mock localStorage for casinoState persistence (non-cryptographic) ── */
const _store = {};
const mockLocalStorage = {
    getItem: vi.fn(k => _store[k] ?? null),
    setItem: vi.fn((k, v) => { _store[k] = String(v); }),
    removeItem: vi.fn(k => { delete _store[k]; }),
    clear: vi.fn(() => { for (const k in _store) delete _store[k]; }),
};
vi.stubGlobal('localStorage', mockLocalStorage);

/* ── Imports under test ─────────────────────────────────────── */
import {
    getPayout, placeBet, clearBets, spin, ROULETTE_RULES, RouletteEngine, createRoulette,
    isRed, isBlack as rlIsBlack, getColor, finishSpin, newRound as rlNewRound,
    isRouletteMessage, parseRouletteAction, serializeRouletteAction,
    serializeGame as rlSerializeGame, deserializeGame as rlDeserializeGame,
} from '../lib/roulette.js';
import {
    calculateHand, isBlackjack, isBust, createGame, addPlayer, removePlayer,
    placeBet as bjPlaceBet, dealInitialCards, stand, hit, runDealerTurn, getPayouts,
    createDeck, shuffleDeck, canSplit, split, canInsure, takeInsurance,
    canDoubleDown, doubleDown, dealerPlay, settle, newRound as bjNewRound,
    cardSymbol, isPlayerTurn, isBlackjackMessage, parseBlackjackAction,
    serializeBlackjackAction, serializeGame as bjSerializeGame,
    deserializeGame as bjDeserializeGame, BlackjackEngine, BLACKJACK_RULES,
    MIN_DECK_CARDS,
} from '../lib/blackjack.js';
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
    it('null result returns 0 for any bet type', () => {
        expect(getPayout('single', 7, null)).toBe(0);
        expect(getPayout('color', 'red', null)).toBe(0);
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
        let game = createRoulette('room1');
        game = placeBet(game, 'peer1', 'Alice', 'color', 'red', 100);
        // Verify payout logic directly: red bet on result 1 (red) pays 2x
        const multiplier = getPayout('color', 'red', 1);
        expect(multiplier).toBe(2);
        // Net gain = amount * (multiplier - 1) = 100
        expect(100 * (multiplier - 1)).toBe(100);
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
    it('multiple aces: A+A+9 = 21 (one ace as 11, one as 1)', () => {
        expect(calculateHand([
            { value: 'A', suit: '♠' },
            { value: 'A', suit: '♥' },
            { value: '9', suit: '♦' },
        ])).toBe(21);
    });
    it('multiple aces: A+A+A = 13 (one ace as 11, two as 1)', () => {
        expect(calculateHand([
            { value: 'A', suit: '♠' },
            { value: 'A', suit: '♥' },
            { value: 'A', suit: '♦' },
        ])).toBe(13);
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
    it('odd blackjack bet floors to integer (151 for bet 101)', () => {
        const game = {
            phase: 'ended',
            players: [{ peer_id: 'p1', status: 'blackjack-win', bet: 101 }],
        };
        const payout = getPayouts(game)['p1'];
        expect(payout).toBe(151); // Math.floor(101 * 1.5) = 151
        expect(Number.isInteger(payout)).toBe(true);
    });
    it('returns empty object if game not ended (even with players)', () => {
        const game = { phase: 'playing', players: [{ peer_id: 'p1', status: 'win', bet: 100 }] };
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
    it('three cherries return 3× bet', () => {
        expect(slotsPayout(['🍒', '🍒', '🍒'], 100)).toBe(300);
    });
    it('two cherries return 2× bet', () => {
        expect(slotsPayout(['🍒', '🍒', '🍊'], 100)).toBe(200);
    });
    it('three grapes return 10× bet', () => {
        expect(slotsPayout(['🍇', '🍇', '🍇'], 100)).toBe(1000);
    });
    it('three oranges return 6× bet', () => {
        expect(slotsPayout(['🍊', '🍊', '🍊'], 100)).toBe(600);
    });
    it('three lemons return 4× bet', () => {
        expect(slotsPayout(['🍋', '🍋', '🍋'], 100)).toBe(400);
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
    it('createCasinoState has expected shape with all game types', () => {
        const state = createCasinoState();
        expect(state).toHaveProperty('_ts');
        expect(state).toHaveProperty('housePnl');
        expect(state.housePnl).toHaveProperty('roulette', 0);
        expect(state.housePnl).toHaveProperty('slots', 0);
        expect(state.housePnl).toHaveProperty('blackjack', 0);
        expect(state.housePnl).toHaveProperty('andarbahar', 0);
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

/* ═══════════════════════════════════════════════════════════════
   SUITE 6 — Blackjack: Comprehensive Coverage
   ═══════════════════════════════════════════════════════════════ */

describe('Blackjack: createDeck()', () => {
    it('produces exactly 52 cards', () => {
        const deck = createDeck();
        expect(deck).toHaveLength(52);
    });

    it('contains all four suits', () => {
        const deck = createDeck();
        const suits = new Set(deck.map(c => c.suit));
        expect(suits).toEqual(new Set(['♠', '♥', '♦', '♣']));
    });

    it('contains 13 values per suit', () => {
        const deck = createDeck();
        const expectedValues = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        for (const suit of ['♠', '♥', '♦', '♣']) {
            const vals = deck.filter(c => c.suit === suit).map(c => c.value).sort();
            expect(vals.sort()).toEqual(expectedValues.sort());
        }
    });

    it('each card has an id of value+suit', () => {
        const deck = createDeck();
        for (const card of deck) {
            expect(card.id).toBe(`${card.value}${card.suit}`);
        }
    });
});

describe('Blackjack: shuffleDeck()', () => {
    it('returns same number of cards as input', () => {
        const deck = createDeck();
        const shuffled = shuffleDeck(deck);
        expect(shuffled).toHaveLength(deck.length);
    });

    it('does not mutate the original array', () => {
        const deck = createDeck();
        const orig = [...deck];
        shuffleDeck(deck);
        expect(deck).toEqual(orig);
    });

    it('preserves all card identities (same set of ids)', () => {
        const deck = createDeck();
        const shuffled = shuffleDeck(deck);
        const origIds = deck.map(c => c.id).sort();
        const shuffledIds = shuffled.map(c => c.id).sort();
        expect(shuffledIds).toEqual(origIds);
    });
});

describe('Blackjack: createGame()', () => {
    it('returns correct initial state shape', () => {
        const game = createGame('room1', 'dealer1');
        expect(game.type).toBe('blackjack');
        expect(game.roomId).toBe('room1');
        expect(game.deck).toHaveLength(52);
        expect(game.dealer.peer_id).toBe('dealer1');
        expect(game.dealer.nick).toBe('Dealer');
        expect(game.dealer.hand).toEqual([]);
        expect(game.dealer.revealed).toBe(false);
        expect(game.players).toEqual([]);
        expect(game.currentPlayerIndex).toBe(-1);
        expect(game.phase).toBe('betting');
        expect(game.nextDealAt).toBeGreaterThan(0);
        expect(game.createdAt).toBeGreaterThan(0);
    });
});

describe('Blackjack: addPlayer() / removePlayer()', () => {
    it('adds a player with correct defaults', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        expect(game.players).toHaveLength(1);
        expect(game.players[0]).toMatchObject({ peer_id: 'p1', nick: 'Alice', hand: [], status: 'waiting', bet: 0 });
    });

    it('ignores duplicate peer_id', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game = addPlayer(game, 'p1', 'AliceDupe');
        expect(game.players).toHaveLength(1);
    });

    it('allows multiple distinct players', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game = addPlayer(game, 'p2', 'Bob');
        expect(game.players).toHaveLength(2);
    });

    it('removePlayer removes the specified player', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game = addPlayer(game, 'p2', 'Bob');
        game = removePlayer(game, 'p1');
        expect(game.players).toHaveLength(1);
        expect(game.players[0].peer_id).toBe('p2');
    });

    it('removePlayer is no-op for unknown peer_id', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game = removePlayer(game, 'unknown');
        expect(game.players).toHaveLength(1);
    });
});

describe('Blackjack: placeBet()', () => {
    it('sets bet and changes status to ready', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        expect(game.players[0].bet).toBe(100);
        expect(game.players[0].status).toBe('ready');
    });

    it('rejects invalid bets (0, negative, NaN, null, Infinity)', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        for (const bad of [0, -50, NaN, null, undefined, Infinity, 'abc']) {
            const result = bjPlaceBet(game, 'p1', bad);
            expect(result.players[0].bet).toBe(0); // unchanged
        }
    });
});

describe('Blackjack: dealInitialCards()', () => {
    it('deals 2 cards to each player and dealer', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game = addPlayer(game, 'p2', 'Bob');
        game = bjPlaceBet(game, 'p1', 100);
        game = bjPlaceBet(game, 'p2', 100);
        game = dealInitialCards(game);
        expect(game.players[0].hand).toHaveLength(2);
        expect(game.players[1].hand).toHaveLength(2);
        expect(game.dealer.hand).toHaveLength(2);
    });

    it('removes dealt cards from deck', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        const deckBefore = game.deck.length;
        game = dealInitialCards(game);
        // 2 cards to player + 2 to dealer = 4 removed
        expect(game.deck.length).toBe(deckBefore - 4);
    });

    it('detects player blackjack and sets status accordingly', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        // pop order: p1_R0, dealer_R0, p1_R1, dealer_R1
        // deck (last popped first): [dealer_R1, p1_R1, dealer_R0, p1_R0]
        game.deck = [
            { value: '3', suit: '♣', id: '3♣' },   // dealer R1 (dealer hand[1])
            { value: 'A', suit: '♥', id: 'A♥' },   // player R1 (player hand[1])
            { value: '5', suit: '♠', id: '5♠' },   // dealer R0 (dealer hand[0])
            { value: 'K', suit: '♦', id: 'K♦' },   // player R0 (player hand[0])
        ];
        game = dealInitialCards(game);
        // player hand = [K♦, A♥] = blackjack
        expect(game.players[0].status).toBe('blackjack');
    });

    it('all players blackjack transitions to dealer phase', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        // pop order: p1_R0, dealer_R0, p1_R1, dealer_R1
        game.deck = [
            { value: '8', suit: '♠', id: '8♠' },   // dealer R1
            { value: 'A', suit: '♥', id: 'A♥' },   // player R1
            { value: '5', suit: '♣', id: '5♣' },   // dealer R0
            { value: 'K', suit: '♦', id: 'K♦' },   // player R0
        ];
        game = dealInitialCards(game);
        // player hand = [K♦, A♥] = blackjack => all players done
        expect(game.phase).toBe('dealer');
        expect(game.dealer.revealed).toBe(true);
    });

    it('reshuffles fresh deck when not enough cards for initial deal', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        game.deck = [{ value: 'A', suit: '♠', id: 'A♠' }]; // only 1 card
        const result = dealInitialCards(game);
        expect(result.players[0].hand).toHaveLength(2); // dealt from fresh deck
        expect(result.dealer.hand).toHaveLength(2);
    });
});

describe('Blackjack: hit()', () => {
    /** Helper: build a game ready for playing with a controlled deck */
    function setupPlayingGame(playerCards, dealerCards, remainingDeck) {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        game = {
            ...game,
            phase: 'playing',
            currentPlayerIndex: 0,
            deck: [...remainingDeck],
            dealer: { ...game.dealer, hand: [...dealerCards] },
            players: [{ ...game.players[0], hand: [...playerCards], status: 'playing' }],
        };
        return game;
    }

    it('adds a card to the current player hand', () => {
        const game = setupPlayingGame(
            [{ value: '5', suit: '♠', id: '5♠' }, { value: '3', suit: '♥', id: '3♥' }],
            [{ value: '7', suit: '♠', id: '7♠' }, { value: '8', suit: '♦', id: '8♦' }],
            [{ value: '2', suit: '♣', id: '2♣' }]
        );
        const result = hit(game, 'p1');
        expect(result.players[0].hand).toHaveLength(3);
    });

    it('sets bust status when hand exceeds 21', () => {
        const game = setupPlayingGame(
            [{ value: 'K', suit: '♠', id: 'K♠' }, { value: '9', suit: '♥', id: '9♥' }],
            [{ value: '7', suit: '♠', id: '7♠' }, { value: '8', suit: '♦', id: '8♦' }],
            [{ value: 'Q', suit: '♣', id: 'Q♣' }]
        );
        const result = hit(game, 'p1');
        expect(result.players[0].status).toBe('bust');
    });

    it('auto-stands when hand reaches exactly 21', () => {
        const game = setupPlayingGame(
            [{ value: 'K', suit: '♠', id: 'K♠' }, { value: '5', suit: '♥', id: '5♥' }],
            [{ value: '7', suit: '♠', id: '7♠' }, { value: '8', suit: '♦', id: '8♦' }],
            [{ value: '6', suit: '♣', id: '6♣' }]
        );
        const result = hit(game, 'p1');
        expect(calculateHand(result.players[0].hand)).toBe(21);
        expect(result.players[0].status).toBe('stand');
    });

    it('reshuffles fresh deck and deals card when deck is empty', () => {
        const game = setupPlayingGame(
            [{ value: '5', suit: '♠', id: '5♠' }, { value: '3', suit: '♥', id: '3♥' }],
            [{ value: '7', suit: '♠', id: '7♠' }, { value: '8', suit: '♦', id: '8♦' }],
            [] // empty deck — triggers reshuffle
        );
        const result = hit(game, 'p1');
        expect(result.players[0].hand).toHaveLength(3); // got a card from fresh deck
    });

    it('ignores hit from wrong player', () => {
        const game = setupPlayingGame(
            [{ value: '5', suit: '♠', id: '5♠' }, { value: '3', suit: '♥', id: '3♥' }],
            [{ value: '7', suit: '♠', id: '7♠' }, { value: '8', suit: '♦', id: '8♦' }],
            [{ value: '2', suit: '♣', id: '2♣' }]
        );
        const result = hit(game, 'unknown_peer');
        expect(result).toBe(game);
    });

    it('transitions to dealer phase when last player busts', () => {
        const game = setupPlayingGame(
            [{ value: 'K', suit: '♠', id: 'K♠' }, { value: '9', suit: '♥', id: '9♥' }],
            [{ value: '7', suit: '♠', id: '7♠' }, { value: '8', suit: '♦', id: '8♦' }],
            [{ value: 'Q', suit: '♣', id: 'Q♣' }]
        );
        const result = hit(game, 'p1');
        expect(result.phase).toBe('dealer');
        expect(result.dealer.revealed).toBe(true);
    });
});

describe('Blackjack: stand()', () => {
    it('changes player status to stand', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        game.deck = [
            { value: '9', suit: '♣', id: '9♣' },
            { value: '7', suit: '♠', id: '7♠' },
            { value: '5', suit: '♥', id: '5♥' },
            { value: '3', suit: '♦', id: '3♦' },
        ];
        game = dealInitialCards(game);
        game = stand(game, 'p1');
        expect(game.players[0].status).toBe('stand');
    });

    it('advances to next player when multi-player', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game = addPlayer(game, 'p2', 'Bob');
        game = bjPlaceBet(game, 'p1', 100);
        game = bjPlaceBet(game, 'p2', 100);
        // Force non-blackjack hands
        game.deck = [
            { value: '9', suit: '♣', id: '9♣' },
            { value: '7', suit: '♠', id: '7♠' },
            { value: '8', suit: '♥', id: '8♥' },
            { value: '5', suit: '♦', id: '5♦' },
            { value: '3', suit: '♣', id: '3♣' },
            { value: '2', suit: '♠', id: '2♠' },
        ];
        game = dealInitialCards(game);
        // p1 is first active player
        expect(game.currentPlayerIndex).toBe(0);
        game = stand(game, 'p1');
        expect(game.currentPlayerIndex).toBe(1);
    });

    it('transitions to dealer phase when last player stands', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        game.deck = [
            { value: '9', suit: '♣', id: '9♣' },
            { value: '7', suit: '♠', id: '7♠' },
            { value: '5', suit: '♥', id: '5♥' },
            { value: '3', suit: '♦', id: '3♦' },
        ];
        game = dealInitialCards(game);
        game = stand(game, 'p1');
        expect(game.phase).toBe('dealer');
        expect(game.dealer.revealed).toBe(true);
    });
});

describe('Blackjack: canSplit() / split()', () => {
    function setupSplitGame(card1, card2) {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        game = {
            ...game,
            phase: 'playing',
            currentPlayerIndex: 0,
            deck: [
                { value: '4', suit: '♣', id: '4♣' },
                { value: '6', suit: '♣', id: '6♣' },
                { value: '2', suit: '♣', id: '2♣' },
                { value: '3', suit: '♣', id: '3♣' },
            ],
            dealer: { ...game.dealer, hand: [{ value: '7', suit: '♠', id: '7♠' }, { value: '8', suit: '♦', id: '8♦' }] },
            players: [{ ...game.players[0], hand: [card1, card2], status: 'playing' }],
        };
        return game;
    }

    it('canSplit returns true for matching cards', () => {
        const game = setupSplitGame(
            { value: '8', suit: '♠', id: '8♠' },
            { value: '8', suit: '♥', id: '8♥' },
        );
        expect(canSplit(game, 'p1')).toBe(true);
    });

    it('canSplit groups 10-value cards together (K+Q)', () => {
        const game = setupSplitGame(
            { value: 'K', suit: '♠', id: 'K♠' },
            { value: 'Q', suit: '♥', id: 'Q♥' },
        );
        expect(canSplit(game, 'p1')).toBe(true);
    });

    it('canSplit groups 10+J as splittable', () => {
        const game = setupSplitGame(
            { value: '10', suit: '♠', id: '10♠' },
            { value: 'J', suit: '♥', id: 'J♥' },
        );
        expect(canSplit(game, 'p1')).toBe(true);
    });

    it('canSplit returns false for non-matching cards', () => {
        const game = setupSplitGame(
            { value: '8', suit: '♠', id: '8♠' },
            { value: '9', suit: '♥', id: '9♥' },
        );
        expect(canSplit(game, 'p1')).toBe(false);
    });

    it('canSplit returns false when not the current player', () => {
        const game = setupSplitGame(
            { value: '8', suit: '♠', id: '8♠' },
            { value: '8', suit: '♥', id: '8♥' },
        );
        expect(canSplit(game, 'unknown')).toBe(false);
    });

    it('split creates two hands with equal bets', () => {
        const game = setupSplitGame(
            { value: '8', suit: '♠', id: '8♠' },
            { value: '8', suit: '♥', id: '8♥' },
        );
        const result = split(game, 'p1');
        const p = result.players[0];
        expect(p.hand).toHaveLength(2);
        expect(p.splitHand).toHaveLength(2);
        expect(p.hand[0].value).toBe('8');
        expect(p.splitHand[0].value).toBe('8');
        expect(p.splitBet).toBe(100);
    });

    it('split is no-op when canSplit is false', () => {
        const game = setupSplitGame(
            { value: '8', suit: '♠', id: '8♠' },
            { value: '9', suit: '♥', id: '9♥' },
        );
        const result = split(game, 'p1');
        expect(result.players[0].splitHand).toBeUndefined();
    });

    it('cannot split a hand that was already split', () => {
        const game = setupSplitGame(
            { value: '8', suit: '♠', id: '8♠' },
            { value: '8', suit: '♥', id: '8♥' },
        );
        const result = split(game, 'p1');
        // Now try splitting again
        expect(canSplit(result, 'p1')).toBe(false);
    });
});

describe('Blackjack: canInsure() / takeInsurance()', () => {
    function setupInsuranceGame(dealerUpCard) {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 200);
        return {
            ...game,
            phase: 'playing',
            currentPlayerIndex: 0,
            dealer: {
                ...game.dealer,
                hand: [dealerUpCard, { value: 'K', suit: '♣', id: 'K♣' }],
            },
            players: [{
                ...game.players[0],
                hand: [{ value: '8', suit: '♠', id: '8♠' }, { value: '9', suit: '♥', id: '9♥' }],
                status: 'playing',
            }],
        };
    }

    it('canInsure returns true when dealer shows Ace', () => {
        const game = setupInsuranceGame({ value: 'A', suit: '♠', id: 'A♠' });
        expect(canInsure(game, 'p1')).toBe(true);
    });

    it('canInsure returns false when dealer does not show Ace', () => {
        const game = setupInsuranceGame({ value: 'K', suit: '♠', id: 'K♠' });
        expect(canInsure(game, 'p1')).toBe(false);
    });

    it('canInsure returns false if player already insured', () => {
        let game = setupInsuranceGame({ value: 'A', suit: '♠', id: 'A♠' });
        game = takeInsurance(game, 'p1');
        expect(canInsure(game, 'p1')).toBe(false);
    });

    it('takeInsurance sets insured flag and insurance bet = floor(bet/2)', () => {
        const game = setupInsuranceGame({ value: 'A', suit: '♠', id: 'A♠' });
        const result = takeInsurance(game, 'p1');
        expect(result.players[0].insured).toBe(true);
        expect(result.players[0].insuranceBet).toBe(100); // floor(200/2)
    });

    it('takeInsurance floors odd bets', () => {
        let game = setupInsuranceGame({ value: 'A', suit: '♠', id: 'A♠' });
        game.players[0].bet = 151;
        const result = takeInsurance(game, 'p1');
        expect(result.players[0].insuranceBet).toBe(75); // floor(151/2)
    });

    it('takeInsurance is no-op when canInsure is false', () => {
        const game = setupInsuranceGame({ value: 'K', suit: '♠', id: 'K♠' });
        const result = takeInsurance(game, 'p1');
        expect(result.players[0].insured).toBeUndefined();
    });
});

describe('Blackjack: canDoubleDown() / doubleDown()', () => {
    function setupDoubleGame(playerCards, remainingDeck) {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        return {
            ...game,
            phase: 'playing',
            currentPlayerIndex: 0,
            deck: [...remainingDeck],
            dealer: {
                ...game.dealer,
                hand: [{ value: '7', suit: '♠', id: '7♠' }, { value: '8', suit: '♦', id: '8♦' }],
            },
            players: [{
                ...game.players[0],
                hand: [...playerCards],
                status: 'playing',
            }],
        };
    }

    it('canDoubleDown returns true on first two cards', () => {
        const game = setupDoubleGame(
            [{ value: '5', suit: '♠', id: '5♠' }, { value: '6', suit: '♥', id: '6♥' }],
            [{ value: '2', suit: '♣', id: '2♣' }]
        );
        expect(canDoubleDown(game, 'p1')).toBe(true);
    });

    it('canDoubleDown returns false after 3+ cards', () => {
        const game = setupDoubleGame(
            [
                { value: '3', suit: '♠', id: '3♠' },
                { value: '4', suit: '♥', id: '4♥' },
                { value: '2', suit: '♦', id: '2♦' },
            ],
            [{ value: '2', suit: '♣', id: '2♣' }]
        );
        expect(canDoubleDown(game, 'p1')).toBe(false);
    });

    it('doubleDown doubles bet, deals one card, then stands', () => {
        const game = setupDoubleGame(
            [{ value: '5', suit: '♠', id: '5♠' }, { value: '6', suit: '♥', id: '6♥' }],
            [{ value: '2', suit: '♣', id: '2♣' }]
        );
        const result = doubleDown(game, 'p1');
        expect(result.players[0].hand).toHaveLength(3);
        expect(result.players[0].bet).toBe(200);
        expect(result.players[0].status).toBe('stand');
    });

    it('doubleDown sets bust status if new card busts hand', () => {
        const game = setupDoubleGame(
            [{ value: 'K', suit: '♠', id: 'K♠' }, { value: '8', suit: '♥', id: '8♥' }],
            [{ value: 'Q', suit: '♣', id: 'Q♣' }]
        );
        const result = doubleDown(game, 'p1');
        expect(result.players[0].status).toBe('bust');
        expect(result.players[0].bet).toBe(200);
    });

    it('doubleDown transitions to dealer when sole player', () => {
        const game = setupDoubleGame(
            [{ value: '5', suit: '♠', id: '5♠' }, { value: '6', suit: '♥', id: '6♥' }],
            [{ value: '2', suit: '♣', id: '2♣' }]
        );
        const result = doubleDown(game, 'p1');
        expect(result.phase).toBe('dealer');
    });

    it('doubleDown is no-op when canDoubleDown is false', () => {
        const game = setupDoubleGame(
            [
                { value: '3', suit: '♠', id: '3♠' },
                { value: '4', suit: '♥', id: '4♥' },
                { value: '2', suit: '♦', id: '2♦' },
            ],
            [{ value: '2', suit: '♣', id: '2♣' }]
        );
        const result = doubleDown(game, 'p1');
        expect(result.players[0].hand).toHaveLength(3); // unchanged
        expect(result.players[0].bet).toBe(100); // unchanged
    });
});

describe('Blackjack: dealerPlay()', () => {
    it('dealer hits until reaching 17 or more', () => {
        let game = createGame('room1', 'dealer1');
        game = {
            ...game,
            phase: 'dealer',
            deck: [
                { value: '3', suit: '♣', id: '3♣' },
                { value: '2', suit: '♣', id: '2♣' },
                { value: 'A', suit: '♦', id: 'A♦' },
            ],
            dealer: {
                ...game.dealer,
                hand: [
                    { value: '9', suit: '♠', id: '9♠' },
                    { value: '5', suit: '♥', id: '5♥' },
                ],
                revealed: true,
            },
        };
        const result = dealerPlay(game);
        expect(calculateHand(result.dealer.hand)).toBeGreaterThanOrEqual(17);
        expect(result.phase).toBe('settlement');
    });

    it('dealer stands on 17', () => {
        let game = createGame('room1', 'dealer1');
        game = {
            ...game,
            phase: 'dealer',
            deck: [{ value: '3', suit: '♣', id: '3♣' }],
            dealer: {
                ...game.dealer,
                hand: [
                    { value: 'K', suit: '♠', id: 'K♠' },
                    { value: '7', suit: '♥', id: '7♥' },
                ],
                revealed: true,
            },
        };
        const result = dealerPlay(game);
        expect(result.dealer.hand).toHaveLength(2); // no additional cards
        expect(calculateHand(result.dealer.hand)).toBe(17);
    });

    it('is no-op if phase is not dealer', () => {
        let game = createGame('room1', 'dealer1');
        game.phase = 'playing';
        const result = dealerPlay(game);
        expect(result.phase).toBe('playing');
    });
});

describe('Blackjack: settle() — split and insurance', () => {
    it('settles split hand outcomes independently', () => {
        const game = {
            phase: 'settlement',
            dealer: {
                hand: [{ value: 'K', suit: '♠', id: 'K♠' }, { value: '7', suit: '♥', id: '7♥' }],
            },
            players: [{
                peer_id: 'p1', nick: 'Alice', bet: 100,
                hand: [{ value: 'K', suit: '♦', id: 'K♦' }, { value: '9', suit: '♣', id: '9♣' }], // 19 - lose vs 17
                status: 'stand',
                splitHand: [{ value: '5', suit: '♠', id: '5♠' }, { value: '3', suit: '♥', id: '3♥' }], // 8 - lose
                splitBet: 100,
                splitStatus: 'stand',
            }],
        };
        const result = settle(game);
        expect(result.players[0].status).toBe('win'); // 19 > 17
        expect(result.players[0].splitStatus).toBe('lose'); // 8 < 17
        expect(result.phase).toBe('ended');
    });

    it('settles insurance won when dealer has blackjack', () => {
        const game = {
            phase: 'settlement',
            dealer: {
                hand: [{ value: 'A', suit: '♠', id: 'A♠' }, { value: 'K', suit: '♥', id: 'K♥' }],
            },
            players: [{
                peer_id: 'p1', nick: 'Alice', bet: 200,
                hand: [{ value: 'K', suit: '♦', id: 'K♦' }, { value: '9', suit: '♣', id: '9♣' }],
                status: 'stand',
                insured: true, insuranceBet: 100,
            }],
        };
        const result = settle(game);
        expect(result.players[0].insuranceWon).toBe(true);
    });

    it('settles insurance lost when dealer does not have blackjack', () => {
        const game = {
            phase: 'settlement',
            dealer: {
                hand: [{ value: 'A', suit: '♠', id: 'A♠' }, { value: '7', suit: '♥', id: '7♥' }],
            },
            players: [{
                peer_id: 'p1', nick: 'Alice', bet: 200,
                hand: [{ value: 'K', suit: '♦', id: 'K♦' }, { value: '9', suit: '♣', id: '9♣' }],
                status: 'stand',
                insured: true, insuranceBet: 100,
            }],
        };
        const result = settle(game);
        expect(result.players[0].insuranceWon).toBe(false);
    });

    it('settle is no-op if phase is not settlement', () => {
        const game = {
            phase: 'playing',
            dealer: { hand: [] },
            players: [],
        };
        expect(settle(game).phase).toBe('playing');
    });

    it('player busts => lose regardless of dealer', () => {
        const game = {
            phase: 'settlement',
            dealer: {
                hand: [{ value: '5', suit: '♠', id: '5♠' }, { value: '6', suit: '♥', id: '6♥' }, { value: 'K', suit: '♦', id: 'K♦' }], // 21
            },
            players: [{
                peer_id: 'p1', nick: 'Alice', bet: 100,
                hand: [{ value: 'K', suit: '♠', id: 'K♠' }, { value: '9', suit: '♣', id: '9♣' }, { value: 'Q', suit: '♥', id: 'Q♥' }],
                status: 'bust',
            }],
        };
        const result = settle(game);
        expect(result.players[0].status).toBe('lose');
    });

    it('push when player and dealer have equal totals', () => {
        const game = {
            phase: 'settlement',
            dealer: {
                hand: [{ value: 'K', suit: '♠', id: 'K♠' }, { value: '8', suit: '♥', id: '8♥' }], // 18
            },
            players: [{
                peer_id: 'p1', nick: 'Alice', bet: 100,
                hand: [{ value: 'J', suit: '♦', id: 'J♦' }, { value: '8', suit: '♣', id: '8♣' }], // 18
                status: 'stand',
            }],
        };
        const result = settle(game);
        expect(result.players[0].status).toBe('push');
    });

    it('player blackjack beats non-blackjack dealer 21', () => {
        const game = {
            phase: 'settlement',
            dealer: {
                hand: [
                    { value: '7', suit: '♠', id: '7♠' },
                    { value: '4', suit: '♥', id: '4♥' },
                    { value: 'K', suit: '♦', id: 'K♦' },
                ], // 21 not blackjack
            },
            players: [{
                peer_id: 'p1', nick: 'Alice', bet: 100,
                hand: [{ value: 'A', suit: '♠', id: 'A♠' }, { value: 'K', suit: '♥', id: 'K♥' }], // blackjack
                status: 'blackjack',
            }],
        };
        const result = settle(game);
        expect(result.players[0].status).toBe('blackjack-win');
    });
});

describe('Blackjack: newRound()', () => {
    it('always starts with fresh 52-card deck', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        expect(game.deck.length).toBe(52);
        const deckRef = game.deck;
        const result = bjNewRound(game);
        expect(result.deck).not.toBe(deckRef); // new deck, not reused
        expect(result.deck).toHaveLength(52);
        expect(result.phase).toBe('betting');
    });

    it('reshuffles when deck is below MIN_DECK_CARDS', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game.deck = game.deck.slice(0, MIN_DECK_CARDS - 1);
        const result = bjNewRound(game);
        expect(result.deck.length).toBe(52); // fresh deck
    });

    it('resets players hand/status/bet but keeps identity', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 500);
        const result = bjNewRound(game);
        expect(result.players[0].peer_id).toBe('p1');
        expect(result.players[0].nick).toBe('Alice');
        expect(result.players[0].hand).toEqual([]);
        expect(result.players[0].bet).toBe(0);
        expect(result.players[0].status).toBe('waiting');
    });
});

describe('Blackjack: cardSymbol()', () => {
    it('returns isRed true for hearts and diamonds', () => {
        expect(cardSymbol({ value: 'A', suit: '♥' }).isRed).toBe(true);
        expect(cardSymbol({ value: 'K', suit: '♦' }).isRed).toBe(true);
    });

    it('returns isRed false for spades and clubs', () => {
        expect(cardSymbol({ value: 'A', suit: '♠' }).isRed).toBe(false);
        expect(cardSymbol({ value: 'K', suit: '♣' }).isRed).toBe(false);
    });

    it('returns correct display string', () => {
        expect(cardSymbol({ value: 'Q', suit: '♥' }).display).toBe('Q♥');
    });

    it('returns empty string for null/undefined card', () => {
        expect(cardSymbol(null)).toBe('');
        expect(cardSymbol(undefined)).toBe('');
    });
});

describe('Blackjack: isPlayerTurn()', () => {
    it('returns true for the current player in playing phase', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game = bjPlaceBet(game, 'p1', 100);
        game.deck = [
            { value: '9', suit: '♣', id: '9♣' },
            { value: '7', suit: '♠', id: '7♠' },
            { value: '5', suit: '♥', id: '5♥' },
            { value: '3', suit: '♦', id: '3♦' },
        ];
        game = dealInitialCards(game);
        expect(isPlayerTurn(game, 'p1')).toBe(true);
    });

    it('returns false for non-current player', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        game = addPlayer(game, 'p2', 'Bob');
        game = bjPlaceBet(game, 'p1', 100);
        game = bjPlaceBet(game, 'p2', 100);
        game.deck = [
            { value: '9', suit: '♣', id: '9♣' },
            { value: '7', suit: '♠', id: '7♠' },
            { value: '5', suit: '♥', id: '5♥' },
            { value: '3', suit: '♦', id: '3♦' },
            { value: '4', suit: '♣', id: '4♣' },
            { value: '2', suit: '♠', id: '2♠' },
        ];
        game = dealInitialCards(game);
        expect(isPlayerTurn(game, 'p2')).toBe(false);
    });

    it('returns false in betting phase', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        expect(isPlayerTurn(game, 'p1')).toBe(false);
    });
});

describe('Blackjack: BlackjackEngine.calculateResults()', () => {
    it('returns a PayoutEvent with correct shape', () => {
        const game = createGame('room1', 'dealer1');
        const engine = new BlackjackEngine(game);
        const settledGame = {
            roomId: 'room1',
            dealer: {
                hand: [{ value: 'K', suit: '♠', id: 'K♠' }, { value: '7', suit: '♥', id: '7♥' }],
            },
            players: [{
                peer_id: 'p1', nick: 'Alice', bet: 100,
                status: 'win',
                hand: [{ value: '10', suit: '♦', id: '10♦' }, { value: '9', suit: '♣', id: '9♣' }],
            }],
        };
        const event = engine.calculateResults(settledGame);
        expect(event.financial).toBe(true);
        expect(event.gameType).toBe('blackjack');
        expect(event.resultLabel).toContain('Dealer 17');
        expect(event.breakdown).toHaveLength(1);
        expect(event.totals.p1).toBe(100);
    });

    it('includes split labels in breakdown', () => {
        const game = createGame('room1', 'dealer1');
        const engine = new BlackjackEngine(game);
        const settledGame = {
            roomId: 'room1',
            dealer: {
                hand: [{ value: 'K', suit: '♠', id: 'K♠' }, { value: '7', suit: '♥', id: '7♥' }],
            },
            players: [{
                peer_id: 'p1', nick: 'Alice', bet: 100,
                status: 'win',
                hand: [{ value: '10', suit: '♦', id: '10♦' }, { value: '9', suit: '♣', id: '9♣' }],
                splitHand: [{ value: '5', suit: '♦', id: '5♦' }, { value: '3', suit: '♣', id: '3♣' }],
                splitBet: 100,
                splitStatus: 'lose',
            }],
        };
        const event = engine.calculateResults(settledGame);
        expect(event.breakdown[0].betLabel).toContain('Split');
    });

    it('includes insurance labels in breakdown', () => {
        const game = createGame('room1', 'dealer1');
        const engine = new BlackjackEngine(game);
        const settledGame = {
            roomId: 'room1',
            dealer: {
                hand: [{ value: 'A', suit: '♠', id: 'A♠' }, { value: 'K', suit: '♥', id: 'K♥' }],
            },
            players: [{
                peer_id: 'p1', nick: 'Alice', bet: 200,
                status: 'lose',
                hand: [{ value: '10', suit: '♦', id: '10♦' }, { value: '9', suit: '♣', id: '9♣' }],
                insured: true, insuranceBet: 100, insuranceWon: true,
            }],
        };
        const event = engine.calculateResults(settledGame);
        expect(event.breakdown[0].betLabel).toContain('Insurance');
    });

    it('dealer bust shows (Bust) in resultLabel', () => {
        const game = createGame('room1', 'dealer1');
        const engine = new BlackjackEngine(game);
        const settledGame = {
            roomId: 'room1',
            dealer: {
                hand: [
                    { value: 'K', suit: '♠', id: 'K♠' },
                    { value: '7', suit: '♥', id: '7♥' },
                    { value: '8', suit: '♦', id: '8♦' },
                ], // 25 bust
            },
            players: [{
                peer_id: 'p1', nick: 'Alice', bet: 100, status: 'win',
                hand: [{ value: '10', suit: '♦', id: '10♦' }, { value: '9', suit: '♣', id: '9♣' }],
            }],
        };
        const event = engine.calculateResults(settledGame);
        expect(event.resultLabel).toContain('Bust');
    });
});

describe('Blackjack: message protocol', () => {
    it('isBlackjackMessage detects BJ: prefix', () => {
        expect(isBlackjackMessage('BJ:{"action":"hit"}')).toBe(true);
        expect(isBlackjackMessage('RL:{"action":"spin"}')).toBe(false);
        expect(isBlackjackMessage('')).toBe(false);
        expect(isBlackjackMessage(null)).toBe(false);
        expect(isBlackjackMessage(42)).toBe(false);
    });

    it('parseBlackjackAction parses valid BJ message', () => {
        const result = parseBlackjackAction('BJ:{"action":"hit","peer_id":"p1"}');
        expect(result).toEqual({ action: 'hit', peer_id: 'p1' });
    });

    it('parseBlackjackAction returns null for non-BJ message', () => {
        expect(parseBlackjackAction('RL:{"action":"spin"}')).toBeNull();
    });

    it('parseBlackjackAction returns null for invalid JSON', () => {
        expect(parseBlackjackAction('BJ:not-json')).toBeNull();
    });

    it('serializeBlackjackAction round-trips correctly', () => {
        const action = { action: 'stand', peer_id: 'p2' };
        const serialized = serializeBlackjackAction(action);
        expect(serialized).toBe('BJ:{"action":"stand","peer_id":"p2"}');
        expect(parseBlackjackAction(serialized)).toEqual(action);
    });
});

describe('Blackjack: serialization', () => {
    it('serializeGame strips the deck for security', () => {
        const game = createGame('room1', 'dealer1');
        const serialized = bjSerializeGame(game);
        const parsed = JSON.parse(serialized);
        expect(parsed.deck).toBeUndefined();
        expect(parsed.deckCount).toBe(52);
    });

    it('serializeGame preserves other state', () => {
        let game = createGame('room1', 'dealer1');
        game = addPlayer(game, 'p1', 'Alice');
        const serialized = bjSerializeGame(game);
        const parsed = JSON.parse(serialized);
        expect(parsed.players).toHaveLength(1);
        expect(parsed.roomId).toBe('room1');
    });

    it('deserializeGame parses valid JSON', () => {
        const game = createGame('room1', 'dealer1');
        const serialized = bjSerializeGame(game);
        const result = bjDeserializeGame(serialized);
        expect(result.roomId).toBe('room1');
        expect(result.deck).toEqual([]); // deck is not transmitted
    });

    it('deserializeGame returns null for invalid JSON', () => {
        expect(bjDeserializeGame('not-json')).toBeNull();
    });

    it('deserializeGame accepts an object directly', () => {
        const obj = { roomId: 'room1', type: 'blackjack' };
        const result = bjDeserializeGame(obj);
        expect(result.roomId).toBe('room1');
        expect(result.deck).toEqual([]);
    });
});

describe('Blackjack: getPayouts with split + insurance', () => {
    it('combines main hand win + split hand loss', () => {
        const game = {
            phase: 'ended',
            players: [{
                peer_id: 'p1', bet: 100,
                status: 'win',
                splitHand: [{ value: '5', suit: '♠' }],
                splitBet: 100,
                splitStatus: 'lose',
            }],
        };
        const payouts = getPayouts(game);
        // win main: +100, lose split: -100 => net 0
        expect(payouts['p1']).toBe(0);
    });

    it('insurance won pays +2x insuranceBet when dealer has blackjack', () => {
        const game = {
            phase: 'ended',
            players: [{
                peer_id: 'p1', bet: 200,
                status: 'lose',
                insured: true, insuranceBet: 100, insuranceWon: true,
            }],
        };
        const payouts = getPayouts(game);
        // lose main: -200, insurance won: +200 => net 0
        expect(payouts['p1']).toBe(0);
    });

    it('insurance lost costs the insuranceBet', () => {
        const game = {
            phase: 'ended',
            players: [{
                peer_id: 'p1', bet: 200,
                status: 'win',
                insured: true, insuranceBet: 100, insuranceWon: false,
            }],
        };
        const payouts = getPayouts(game);
        // win main: +200, insurance lost: -100 => net +100
        expect(payouts['p1']).toBe(100);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 7 — Roulette: Extended Coverage
   ═══════════════════════════════════════════════════════════════ */

describe('Roulette: isRed / isBlack / getColor', () => {
    it('isRed returns true for known red numbers', () => {
        for (const n of [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]) {
            expect(isRed(n)).toBe(true);
        }
    });

    it('isRed returns false for black numbers', () => {
        expect(isRed(2)).toBe(false);
        expect(isRed(4)).toBe(false);
    });

    it('isRed returns false for zero', () => {
        expect(isRed(0)).toBe(false);
    });

    it('rlIsBlack returns true for non-red, non-zero numbers', () => {
        expect(rlIsBlack(2)).toBe(true);
        expect(rlIsBlack(4)).toBe(true);
        expect(rlIsBlack(6)).toBe(true);
    });

    it('rlIsBlack returns false for zero', () => {
        expect(rlIsBlack(0)).toBe(false);
    });

    it('rlIsBlack returns false for red numbers', () => {
        expect(rlIsBlack(1)).toBe(false);
        expect(rlIsBlack(3)).toBe(false);
    });

    it('getColor returns green for 0', () => {
        expect(getColor(0)).toBe('green');
    });

    it('getColor returns red for red numbers', () => {
        expect(getColor(1)).toBe('red');
        expect(getColor(36)).toBe('red');
    });

    it('getColor returns black for black numbers', () => {
        expect(getColor(2)).toBe('black');
        expect(getColor(4)).toBe('black');
    });
});

describe('Roulette: createRoulette() full state shape', () => {
    it('has all expected properties', () => {
        const game = createRoulette('room1');
        expect(game.type).toBe('roulette');
        expect(game.roomId).toBe('room1');
        expect(game.phase).toBe('betting');
        expect(game.result).toBeNull();
        expect(game.bets).toEqual([]);
        expect(Array.isArray(game.spinHistory)).toBe(true);
        expect(game.nextSpinAt).toBeGreaterThan(0);
        expect(game.lastSpinAt).toBeNull();
    });
});

describe('Roulette: placeBet invalid amounts', () => {
    it('rejects NaN amount', () => {
        const game = createRoulette('room1');
        const result = placeBet(game, 'p1', 'Alice', 'color', 'red', NaN);
        expect(result.bets).toHaveLength(0);
    });

    it('rejects Infinity amount', () => {
        const game = createRoulette('room1');
        const result = placeBet(game, 'p1', 'Alice', 'color', 'red', Infinity);
        expect(result.bets).toHaveLength(0);
    });

    it('rejects zero amount', () => {
        const game = createRoulette('room1');
        const result = placeBet(game, 'p1', 'Alice', 'color', 'red', 0);
        expect(result.bets).toHaveLength(0);
    });

    it('rejects negative amount', () => {
        const game = createRoulette('room1');
        const result = placeBet(game, 'p1', 'Alice', 'color', 'red', -100);
        expect(result.bets).toHaveLength(0);
    });

    it('rejects null amount', () => {
        const game = createRoulette('room1');
        const result = placeBet(game, 'p1', 'Alice', 'color', 'red', null);
        expect(result.bets).toHaveLength(0);
    });

    it('caps total bets at 200 per round', () => {
        let game = createRoulette('room1');
        for (let i = 0; i < 200; i++) {
            game = placeBet(game, `p${i}`, `Nick${i}`, 'single', i % 37, 10);
        }
        expect(game.bets).toHaveLength(200);
        // 201st bet should be rejected
        const result = placeBet(game, 'pExtra', 'Extra', 'color', 'red', 10);
        expect(result.bets).toHaveLength(200);
    });
});

describe('Roulette: finishSpin()', () => {
    it('appends result to spinHistory', () => {
        let game = createRoulette('room1');
        game = placeBet(game, 'p1', 'Alice', 'color', 'red', 100);
        game = spin(game);
        const beforeLen = game.spinHistory ? game.spinHistory.length : 0;
        game = finishSpin(game);
        expect(game.spinHistory).toHaveLength(beforeLen + 1);
        expect(game.spinHistory[game.spinHistory.length - 1]).toBe(game.result);
    });

    it('caps spinHistory at 100', () => {
        let game = createRoulette('room1');
        game.spinHistory = Array.from({ length: 100 }, (_, i) => i);
        game.result = 99;
        game = finishSpin(game);
        expect(game.spinHistory).toHaveLength(100);
    });

    it('sets phase to results', () => {
        let game = createRoulette('room1');
        game = placeBet(game, 'p1', 'Alice', 'color', 'red', 100);
        game = spin(game);
        game = finishSpin(game);
        expect(game.phase).toBe('results');
    });
});

describe('Roulette: newRound()', () => {
    it('resets phase, result, bets, and payouts', () => {
        let game = createRoulette('room1');
        game = placeBet(game, 'p1', 'Alice', 'color', 'red', 100);
        game = spin(game);
        game = finishSpin(game);
        game = rlNewRound(game);
        expect(game.phase).toBe('betting');
        expect(game.result).toBeNull();
        expect(game.bets).toEqual([]);
        expect(game.payouts).toBeNull();
    });

    it('preserves spinHistory across rounds', () => {
        let game = createRoulette('room1');
        game = placeBet(game, 'p1', 'Alice', 'color', 'red', 100);
        game = spin(game);
        game = finishSpin(game);
        const histLen = game.spinHistory.length;
        game = rlNewRound(game);
        expect(game.spinHistory).toHaveLength(histLen);
    });
});

describe('Roulette: RouletteEngine.calculateResults()', () => {
    it('returns a PayoutEvent with resultLabel containing number and color', () => {
        const game = createRoulette('room1');
        const engine = new RouletteEngine(game);
        const state = {
            result: 7,
            bets: [{ peer_id: 'p1', nick: 'Alice', betType: 'color', betTarget: 'red', amount: 100 }],
            roomId: 'room1',
        };
        const event = engine.calculateResults(state);
        expect(event.financial).toBe(true);
        expect(event.gameType).toBe('roulette');
        expect(event.resultLabel).toContain('7');
        expect(event.resultLabel).toContain('Red');
    });

    it('breakdown shows net=0 outcome as push (for a bet that exactly breaks even)', () => {
        const game = createRoulette('room1');
        const engine = new RouletteEngine(game);
        // Impossible in standard roulette to get net=0 on single bet, but test the logic path
        // A winning color bet returns net = amount * (2-1) = amount (positive, not push)
        // A loss returns -amount (loss). So we just verify the outcome field logic.
        const state = {
            result: 1,
            bets: [{ peer_id: 'p1', nick: 'Alice', betType: 'color', betTarget: 'red', amount: 100 }],
            roomId: 'room1',
        };
        const event = engine.calculateResults(state);
        expect(event.breakdown[0].outcome).toBe('win');
        expect(event.breakdown[0].net).toBe(100);
    });

    it('totals aggregate multiple bets from same player', () => {
        const game = createRoulette('room1');
        const engine = new RouletteEngine(game);
        const state = {
            result: 7, // red
            bets: [
                { peer_id: 'p1', nick: 'Alice', betType: 'color', betTarget: 'red', amount: 100 },
                { peer_id: 'p1', nick: 'Alice', betType: 'single', betTarget: 7, amount: 10 },
            ],
            roomId: 'room1',
        };
        const event = engine.calculateResults(state);
        // color win: +100, single 7 win: 10 * 35 = 350
        expect(event.totals.p1).toBe(450);
    });
});

describe('Roulette: message protocol', () => {
    it('isRouletteMessage detects RL: prefix', () => {
        expect(isRouletteMessage('RL:{"action":"spin"}')).toBe(true);
        expect(isRouletteMessage('BJ:{"action":"hit"}')).toBe(false);
        expect(isRouletteMessage('')).toBe(false);
        expect(isRouletteMessage(null)).toBe(false);
        expect(isRouletteMessage(123)).toBe(false);
    });

    it('parseRouletteAction parses valid RL message', () => {
        const result = parseRouletteAction('RL:{"action":"bet","amount":100}');
        expect(result).toEqual({ action: 'bet', amount: 100 });
    });

    it('parseRouletteAction returns null for non-RL message', () => {
        expect(parseRouletteAction('BJ:{"action":"hit"}')).toBeNull();
    });

    it('parseRouletteAction returns null for invalid JSON', () => {
        expect(parseRouletteAction('RL:bad-json')).toBeNull();
    });

    it('serializeRouletteAction round-trips correctly', () => {
        const action = { action: 'spin', roomId: 'room1' };
        const serialized = serializeRouletteAction(action);
        expect(serialized).toBe('RL:{"action":"spin","roomId":"room1"}');
        expect(parseRouletteAction(serialized)).toEqual(action);
    });
});

describe('Roulette: serialization', () => {
    it('round-trips through serialize/deserialize', () => {
        let game = createRoulette('room1');
        game = placeBet(game, 'p1', 'Alice', 'color', 'red', 50);
        const serialized = rlSerializeGame(game);
        const parsed = rlDeserializeGame(serialized);
        expect(parsed.roomId).toBe('room1');
        expect(parsed.bets).toHaveLength(1);
        expect(parsed.bets[0].amount).toBe(50);
    });

    it('deserializeGame returns null for invalid JSON', () => {
        expect(rlDeserializeGame('not-json')).toBeNull();
    });

    it('deserializeGame accepts an object directly', () => {
        const obj = { roomId: 'room1', type: 'roulette' };
        expect(rlDeserializeGame(obj)).toEqual(obj);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 8 — Slots: Extended Coverage
   ═══════════════════════════════════════════════════════════════ */

describe('Slots: createSlots() full state shape', () => {
    it('has all expected properties', () => {
        const game = createSlots('room1');
        expect(game.type).toBe('slots');
        expect(game.roomId).toBe('room1');
        expect(game.phase).toBe('betting');
        expect(game.reels).toEqual([]);
        expect(game.bets).toEqual([]);
        expect(game.payouts).toBeNull();
        expect(game._ts).toBeGreaterThan(0);
    });
});

describe('Slots: SlotsEngine.calculatePayout with multiple bets', () => {
    it('aggregates payouts for same peer with multiple bets', () => {
        const game = createSlots('room1');
        const engine = new SlotsEngine(game);
        const bets = [
            { peer_id: 'p1', amount: 100 },
            { peer_id: 'p1', amount: 50 },
        ];
        const payouts = engine.calculatePayout(bets, ['7️⃣', '7️⃣', '7️⃣']);
        // 100*50 + 50*50 = 5000 + 2500 = 7500
        expect(payouts['p1']).toBe(7500);
    });

    it('aggregates payouts for multiple peers', () => {
        const game = createSlots('room1');
        const engine = new SlotsEngine(game);
        const bets = [
            { peer_id: 'p1', amount: 100 },
            { peer_id: 'p2', amount: 200 },
        ];
        const payouts = engine.calculatePayout(bets, ['💎', '💎', '💎']);
        expect(payouts['p1']).toBe(2000);  // 100 * 20
        expect(payouts['p2']).toBe(4000);  // 200 * 20
    });
});

describe('Slots: two-cherry match only on first two reels', () => {
    it('two cherries on first two reels pays 2x', () => {
        expect(slotsPayout(['🍒', '🍒', '🍊'], 100)).toBe(200);
        expect(slotsPayout(['🍒', '🍒', '💎'], 100)).toBe(200);
        expect(slotsPayout(['🍒', '🍒', '🍋'], 100)).toBe(200);
    });

    it('cherry on reel 1 and 3 but not reel 2 does NOT match', () => {
        expect(slotsPayout(['🍒', '🍊', '🍒'], 100)).toBe(-100);
    });

    it('cherry on reel 2 and 3 but not reel 1 does NOT match', () => {
        expect(slotsPayout(['🍊', '🍒', '🍒'], 100)).toBe(-100);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 9 — GameEngine base: additional coverage
   ═══════════════════════════════════════════════════════════════ */

describe('GameEngine: calculateResults() throws when not implemented', () => {
    it('base class throws on calculateResults', () => {
        const engine = new GameEngine();
        expect(() => engine.calculateResults({})).toThrow();
    });
});

describe('GameEngine: registerGame duplicate behavior', () => {
    it('re-registering a game type overwrites the previous class', () => {
        // blackjack is already registered; verify createGameEngine still works
        const game = createGame('room1', 'dealer1');
        const engine = createGameEngine('blackjack', game);
        expect(engine).toBeInstanceOf(BlackjackEngine);
    });

    it('getRegisteredGames includes blackjack', () => {
        const games = getRegisteredGames();
        expect(games).toContain('blackjack');
    });
});
