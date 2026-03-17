import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    isSideBetWin, createGame, placeBet, clearBets, dealTrump, dealNext,
    newRound, MIN_DECK_SIZE, SIDE_BETS, ANDARBAHAR_RULES,
    AndarBaharEngine,
    isAndarBaharMessage, parseAndarBaharAction, serializeAndarBaharAction,
    serializeGame, deserializeGame,
} from '../lib/andarbahar.js';

/* ── Browser API mocks ──────────────────────────────────────── */

let mockStorage;

beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal('sessionStorage', {
        getItem: vi.fn(k => mockStorage[k] ?? null),
        setItem: vi.fn((k, v) => { mockStorage[k] = v; }),
        removeItem: vi.fn(k => { delete mockStorage[k]; }),
    });
    vi.stubGlobal('localStorage', {
        getItem: vi.fn(k => mockStorage[k] ?? null),
        setItem: vi.fn((k, v) => { mockStorage[k] = v; }),
        removeItem: vi.fn(k => { delete mockStorage[k]; }),
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 1 — isSideBetWin (all 7 ranges)
   ═══════════════════════════════════════════════════════════════ */

describe('isSideBetWin', () => {
    it('1-5 range matches correctly', () => {
        expect(isSideBetWin('1-5', 1)).toBe(true);
        expect(isSideBetWin('1-5', 5)).toBe(true);
        expect(isSideBetWin('1-5', 6)).toBe(false);
        expect(isSideBetWin('1-5', 0)).toBe(false);
    });
    it('6-10 range matches correctly', () => {
        expect(isSideBetWin('6-10', 6)).toBe(true);
        expect(isSideBetWin('6-10', 10)).toBe(true);
        expect(isSideBetWin('6-10', 5)).toBe(false);
        expect(isSideBetWin('6-10', 11)).toBe(false);
    });
    it('11-15 range matches correctly', () => {
        expect(isSideBetWin('11-15', 11)).toBe(true);
        expect(isSideBetWin('11-15', 15)).toBe(true);
        expect(isSideBetWin('11-15', 10)).toBe(false);
    });
    it('16-25 range matches correctly', () => {
        expect(isSideBetWin('16-25', 16)).toBe(true);
        expect(isSideBetWin('16-25', 25)).toBe(true);
        expect(isSideBetWin('16-25', 26)).toBe(false);
    });
    it('26-35 range matches correctly', () => {
        expect(isSideBetWin('26-35', 26)).toBe(true);
        expect(isSideBetWin('26-35', 35)).toBe(true);
        expect(isSideBetWin('26-35', 36)).toBe(false);
    });
    it('36-40 range matches correctly', () => {
        expect(isSideBetWin('36-40', 36)).toBe(true);
        expect(isSideBetWin('36-40', 40)).toBe(true);
        expect(isSideBetWin('36-40', 41)).toBe(false);
    });
    it('41+ range matches correctly', () => {
        expect(isSideBetWin('41+', 41)).toBe(true);
        expect(isSideBetWin('41+', 100)).toBe(true);
        expect(isSideBetWin('41+', 40)).toBe(false);
    });
    it('unknown side returns false', () => {
        expect(isSideBetWin('invalid', 5)).toBe(false);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 2 — createGame
   ═══════════════════════════════════════════════════════════════ */

describe('createGame', () => {
    it('creates game with correct initial state', () => {
        const game = createGame('room-ab');
        expect(game.type).toBe('andarbahar');
        expect(game.roomId).toBe('room-ab');
        expect(game.phase).toBe('betting');
        expect(game.trumpCard).toBeNull();
        expect(game.andar).toEqual([]);
        expect(game.bahar).toEqual([]);
        expect(game.bets).toEqual([]);
        expect(game.result).toBeNull();
        expect(game.payouts).toBeNull();
        expect(game.dealCount).toBe(0);
    });
    it('has a full 52-card deck', () => {
        const game = createGame('room-ab');
        expect(game.deck).toHaveLength(52);
    });
    it('has timing fields', () => {
        const game = createGame('room-ab');
        expect(game.bettingEndsAt).toBeGreaterThan(Date.now() - 1000);
        expect(game.nextGameAt).toBeGreaterThan(game.bettingEndsAt);
        expect(game.startedAt).toBeLessThanOrEqual(Date.now());
    });
    it('loads empty trump history when none saved', () => {
        const game = createGame('room-ab');
        expect(game.trumpHistory).toEqual([]);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 3 — placeBet / clearBets
   ═══════════════════════════════════════════════════════════════ */

describe('placeBet', () => {
    it('adds a bet during betting phase', () => {
        let game = createGame('room-ab');
        game = placeBet(game, 'p1', 'Alice', 'andar', 100);
        expect(game.bets).toHaveLength(1);
        expect(game.bets[0]).toMatchObject({ peer_id: 'p1', nick: 'Alice', side: 'andar', amount: 100 });
    });
    it('replaces same-side bet from same player', () => {
        let game = createGame('room-ab');
        game = placeBet(game, 'p1', 'Alice', 'andar', 100);
        game = placeBet(game, 'p1', 'Alice', 'andar', 200);
        expect(game.bets).toHaveLength(1);
        expect(game.bets[0].amount).toBe(200);
    });
    it('allows different-side bets from same player', () => {
        let game = createGame('room-ab');
        game = placeBet(game, 'p1', 'Alice', 'andar', 100);
        game = placeBet(game, 'p1', 'Alice', 'bahar', 50);
        expect(game.bets).toHaveLength(2);
    });
    it('rejects bet with invalid amount', () => {
        let game = createGame('room-ab');
        expect(placeBet(game, 'p1', 'Alice', 'andar', 0)).toBe(game);
        expect(placeBet(game, 'p1', 'Alice', 'andar', -50)).toBe(game);
        expect(placeBet(game, 'p1', 'Alice', 'andar', NaN)).toBe(game);
        expect(placeBet(game, 'p1', 'Alice', 'andar', Infinity)).toBe(game);
    });
    it('rejects bet when not in betting phase', () => {
        let game = createGame('room-ab');
        game = { ...game, phase: 'dealing' };
        expect(placeBet(game, 'p1', 'Alice', 'andar', 100)).toBe(game);
    });
});

describe('clearBets', () => {
    it('removes only specified player bets', () => {
        let game = createGame('room-ab');
        game = placeBet(game, 'p1', 'Alice', 'andar', 100);
        game = placeBet(game, 'p2', 'Bob', 'bahar', 50);
        game = clearBets(game, 'p1');
        expect(game.bets).toHaveLength(1);
        expect(game.bets[0].peer_id).toBe('p2');
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 4 — dealTrump / dealNext
   ═══════════════════════════════════════════════════════════════ */

describe('dealTrump', () => {
    it('transitions from betting to dealing and sets trump card', () => {
        let game = createGame('room-ab');
        game = dealTrump(game);
        expect(game.phase).toBe('dealing');
        expect(game.trumpCard).not.toBeNull();
        expect(game.trumpCard).toHaveProperty('value');
        expect(game.trumpCard).toHaveProperty('suit');
        expect(game.deck).toHaveLength(51);
    });
    it('does nothing if not in betting phase', () => {
        let game = createGame('room-ab');
        game = { ...game, phase: 'dealing' };
        const original = game;
        expect(dealTrump(game)).toBe(original);
    });
});

describe('dealNext', () => {
    it('first deal goes to bahar', () => {
        let game = createGame('room-ab');
        game = dealTrump(game);
        const before = game.bahar.length;
        game = dealNext(game);
        // Either ended (match) or bahar got a card
        if (game.phase !== 'ended') {
            expect(game.bahar.length).toBe(before + 1);
            expect(game.andar.length).toBe(0);
        }
    });
    it('alternates between bahar and andar', () => {
        let game = createGame('room-ab');
        game = dealTrump(game);
        // Deal two cards (if no match happens)
        game = dealNext(game);
        if (game.phase === 'ended') return; // match on first card
        game = dealNext(game);
        if (game.phase === 'ended') return;
        // After 2 deals: 1 bahar, 1 andar
        expect(game.bahar.length).toBe(1);
        expect(game.andar.length).toBe(1);
    });
    it('detects match and ends game with payouts', () => {
        let game = createGame('room-ab');
        game = placeBet(game, 'p1', 'Alice', 'andar', 100);
        game = dealTrump(game);

        // Deal until match found
        let safety = 0;
        while (game.phase === 'dealing' && safety < 52) {
            game = dealNext(game);
            safety++;
        }
        expect(game.phase).toBe('ended');
        expect(game.result).toMatch(/^(andar|bahar|draw)$/);
        expect(game.payouts).toBeDefined();
    });
    it('does nothing if not in dealing phase', () => {
        let game = createGame('room-ab');
        expect(dealNext(game)).toBe(game);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 5 — newRound
   ═══════════════════════════════════════════════════════════════ */

describe('newRound', () => {
    it('creates a new round preserving trump history', () => {
        let game = createGame('room-ab');
        game = { ...game, trumpHistory: ['andar', 'bahar'] };
        const next = newRound(game);
        expect(next.phase).toBe('betting');
        expect(next.trumpCard).toBeNull();
        expect(next.trumpHistory).toEqual(['andar', 'bahar']);
    });
    it('reshuffles deck when fewer than MIN_DECK_SIZE cards', () => {
        let game = createGame('room-ab');
        game = { ...game, deck: Array(MIN_DECK_SIZE - 1).fill({ value: '2', suit: '♠' }) };
        const next = newRound(game);
        expect(next.deck).toHaveLength(52);
        expect(next.reshuffled).toBe(true);
    });
    it('always starts with fresh 52-card deck regardless of remaining cards', () => {
        let game = createGame('room-ab');
        const bigDeck = Array(20).fill({ value: '2', suit: '♠' });
        game = { ...game, deck: bigDeck };
        const next = newRound(game);
        expect(next.deck).toHaveLength(52);
        expect(next.reshuffled).toBe(true);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 6 — AndarBaharEngine (GameEngine interface)
   ═══════════════════════════════════════════════════════════════ */

describe('AndarBaharEngine', () => {
    it('getGameState returns the game', () => {
        const game = createGame('room-ab');
        const engine = new AndarBaharEngine(game);
        expect(engine.getGameState()).toBe(game);
    });
    it('getRules returns ANDARBAHAR_RULES', () => {
        const game = createGame('room-ab');
        const engine = new AndarBaharEngine(game);
        expect(engine.getRules()).toBe(ANDARBAHAR_RULES);
        expect(ANDARBAHAR_RULES.name).toBe('Andar Bahar');
        expect(ANDARBAHAR_RULES.bets.length).toBeGreaterThan(0);
    });
    it('calculatePayout returns correct payout for andar win (0.9:1 when trump on bahar)', () => {
        const game = createGame('room-ab');
        const engine = new AndarBaharEngine(game);
        const bets = [{ peer_id: 'p1', side: 'andar', amount: 100 }];
        const result = { winningSide: 'andar', totalCards: 5, trumpFirst: 'bahar' };
        const payouts = engine.calculatePayout(bets, result);
        expect(payouts['p1']).toBe(90); // 0.9 * 100
    });
    it('calculatePayout returns 1:1 for bahar win', () => {
        const game = createGame('room-ab');
        const engine = new AndarBaharEngine(game);
        const bets = [{ peer_id: 'p1', side: 'bahar', amount: 100 }];
        const result = { winningSide: 'bahar', totalCards: 8, trumpFirst: 'bahar' };
        const payouts = engine.calculatePayout(bets, result);
        expect(payouts['p1']).toBe(100);
    });
    it('calculatePayout returns negative for losing main bet', () => {
        const game = createGame('room-ab');
        const engine = new AndarBaharEngine(game);
        const bets = [{ peer_id: 'p1', side: 'andar', amount: 100 }];
        const result = { winningSide: 'bahar', totalCards: 8, trumpFirst: 'bahar' };
        const payouts = engine.calculatePayout(bets, result);
        expect(payouts['p1']).toBe(-100);
    });
    it('calculatePayout handles winning side bet', () => {
        const game = createGame('room-ab');
        const engine = new AndarBaharEngine(game);
        const bets = [{ peer_id: 'p1', side: '1-5', amount: 100 }];
        const result = { winningSide: 'andar', totalCards: 3, trumpFirst: 'bahar' };
        const payouts = engine.calculatePayout(bets, result);
        expect(payouts['p1']).toBe(Math.floor(100 * SIDE_BETS['1-5'])); // 350
    });
    it('calculatePayout handles losing side bet', () => {
        const game = createGame('room-ab');
        const engine = new AndarBaharEngine(game);
        const bets = [{ peer_id: 'p1', side: '1-5', amount: 100 }];
        const result = { winningSide: 'andar', totalCards: 20, trumpFirst: 'bahar' };
        const payouts = engine.calculatePayout(bets, result);
        expect(payouts['p1']).toBe(-100);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 7 — Message protocol & serialization
   ═══════════════════════════════════════════════════════════════ */

describe('AndarBaharEngine.calculateResults', () => {
    function makeEndedState(bets, result = 'andar', trumpFirst = 'bahar', totalCards = 8) {
        return {
            roomId: 'room-ab',
            result,
            trumpFirst,
            bets,
            andar: Array(Math.ceil(totalCards / 2)).fill({ value: '5', suit: '♠' }),
            bahar: Array(Math.floor(totalCards / 2)).fill({ value: '3', suit: '♥' }),
            phase: 'ended',
        };
    }

    it('returns win breakdown for main bet on winning side', () => {
        const state = makeEndedState([{ peer_id: 'p1', nick: 'A', side: 'andar', amount: 100 }], 'andar', 'bahar');
        const engine = new AndarBaharEngine(state);
        const event = engine.calculateResults(state);
        const row = event.breakdown.find(b => b.peer_id === 'p1');
        expect(row.outcome).toBe('win');
        expect(row.net).toBe(90); // 0.9:1 for andar when trump on bahar
    });

    it('returns loss breakdown for main bet on losing side', () => {
        const state = makeEndedState([{ peer_id: 'p1', nick: 'A', side: 'bahar', amount: 100 }], 'andar', 'bahar');
        const engine = new AndarBaharEngine(state);
        const event = engine.calculateResults(state);
        const row = event.breakdown.find(b => b.peer_id === 'p1');
        expect(row.outcome).toBe('loss');
        expect(row.net).toBe(-100);
    });

    it('returns win for correct side bet', () => {
        // 1-5 range side bet wins when totalCards <= 5
        const state = makeEndedState([{ peer_id: 'p1', nick: 'A', side: '1-5', amount: 100 }], 'andar', 'bahar', 3);
        const engine = new AndarBaharEngine(state);
        const event = engine.calculateResults(state);
        const row = event.breakdown.find(b => b.peer_id === 'p1');
        expect(row.outcome).toBe('win');
        expect(row.net).toBeGreaterThan(0);
    });

    it('returns loss for incorrect side bet', () => {
        // 1-5 range side bet loses when totalCards > 5
        const state = makeEndedState([{ peer_id: 'p1', nick: 'A', side: '1-5', amount: 100 }], 'andar', 'bahar', 20);
        const engine = new AndarBaharEngine(state);
        const event = engine.calculateResults(state);
        const row = event.breakdown.find(b => b.peer_id === 'p1');
        expect(row.outcome).toBe('loss');
        expect(row.net).toBe(-100);
    });

    it('calculates totals per player', () => {
        const state = makeEndedState([
            { peer_id: 'p1', nick: 'A', side: 'andar', amount: 100 },
            { peer_id: 'p1', nick: 'A', side: '1-5', amount: 50 },
        ], 'andar', 'bahar', 3);
        const engine = new AndarBaharEngine(state);
        const event = engine.calculateResults(state);
        expect(event.totals.p1).toBeDefined();
    });

    it('handles empty bets array', () => {
        const state = makeEndedState([], 'andar');
        const engine = new AndarBaharEngine(state);
        const event = engine.calculateResults(state);
        expect(event.breakdown).toEqual([]);
        expect(event.totals).toEqual({});
    });
});

describe('Andar Bahar message protocol', () => {
    it('isAndarBaharMessage detects AB: prefix', () => {
        expect(isAndarBaharMessage('AB:{"action":"bet"}')).toBe(true);
        expect(isAndarBaharMessage('RL:something')).toBe(false);
        expect(isAndarBaharMessage(42)).toBe(false);
    });
    it('serialize/parse round-trips correctly', () => {
        const action = { action: 'bet', side: 'andar', amount: 100 };
        const serialized = serializeAndarBaharAction(action);
        expect(serialized).toBe('AB:{"action":"bet","side":"andar","amount":100}');
        expect(parseAndarBaharAction(serialized)).toEqual(action);
    });
    it('parseAndarBaharAction returns null for invalid data', () => {
        expect(parseAndarBaharAction('AB:not-json')).toBeNull();
        expect(parseAndarBaharAction('RL:something')).toBeNull();
    });
});

describe('serializeGame / deserializeGame', () => {
    it('serializeGame strips the deck', () => {
        const game = createGame('room-ab');
        const json = serializeGame(game);
        const parsed = JSON.parse(json);
        expect(parsed.deck).toBeUndefined();
        expect(parsed.deckCount).toBe(52);
    });
    it('deserializeGame ensures arrays exist', () => {
        const parsed = deserializeGame('{"type":"andarbahar","phase":"betting"}');
        expect(parsed.deck).toEqual([]);
        expect(parsed.andar).toEqual([]);
        expect(parsed.bahar).toEqual([]);
        expect(parsed.bets).toEqual([]);
        expect(parsed.trumpHistory).toEqual([]);
    });
    it('deserializeGame returns null for invalid input', () => {
        expect(deserializeGame('not-json')).toBeNull();
    });
});
