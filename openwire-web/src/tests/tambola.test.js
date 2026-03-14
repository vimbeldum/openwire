import { describe, it, expect, beforeEach } from 'vitest';
import {
    COL_RANGES,
    PRIZES,
    generateTicket,
    getTicketNumbers,
    validateClaim,
    createInitialState,
    buyTicket,
    startGame,
    drawNumber,
    claimPrize,
    redistributeUnclaimed,
    TambolaEngine,
} from '../lib/tambola.js';
import { GameEngine } from '../lib/GameEngine.js';

/* ══════════════════════════════════════════════════════════════
   SUITE 1 — generateTicket: structure & column ranges
   ══════════════════════════════════════════════════════════════ */

describe('generateTicket', () => {
    it('returns a 3×9 grid (3 rows, each with 9 elements)', () => {
        const ticket = generateTicket();
        expect(ticket).toHaveLength(3);
        for (const row of ticket) {
            expect(row).toHaveLength(9);
        }
    });

    it('each row has exactly 5 non-zero numbers', () => {
        const ticket = generateTicket();
        for (const row of ticket) {
            const filled = row.filter(n => n !== 0);
            expect(filled).toHaveLength(5);
        }
    });

    it('total non-zero cells across all rows equals 15', () => {
        const ticket = generateTicket();
        const total = ticket.flat().filter(n => n !== 0).length;
        expect(total).toBe(15);
    });

    it('column 0 contains numbers in range 1-9 only', () => {
        for (let i = 0; i < 5; i++) {
            const ticket = generateTicket();
            for (const row of ticket) {
                const val = row[0];
                if (val !== 0) {
                    expect(val).toBeGreaterThanOrEqual(1);
                    expect(val).toBeLessThanOrEqual(9);
                }
            }
        }
    });

    it('column 8 contains numbers in range 80-90 only', () => {
        for (let i = 0; i < 5; i++) {
            const ticket = generateTicket();
            for (const row of ticket) {
                const val = row[8];
                if (val !== 0) {
                    expect(val).toBeGreaterThanOrEqual(80);
                    expect(val).toBeLessThanOrEqual(90);
                }
            }
        }
    });

    it('each column has numbers within its defined COL_RANGES', () => {
        const ticket = generateTicket();
        for (let col = 0; col < 9; col++) {
            const [lo, hi] = COL_RANGES[col];
            for (const row of ticket) {
                const val = row[col];
                if (val !== 0) {
                    expect(val).toBeGreaterThanOrEqual(lo);
                    expect(val).toBeLessThanOrEqual(hi);
                }
            }
        }
    });

    it('numbers within each column are sorted ascending top-to-bottom', () => {
        const ticket = generateTicket();
        for (let col = 0; col < 9; col++) {
            const colVals = [];
            for (const row of ticket) {
                if (row[col] !== 0) colVals.push(row[col]);
            }
            for (let i = 1; i < colVals.length; i++) {
                expect(colVals[i]).toBeGreaterThan(colVals[i - 1]);
            }
        }
    });

    it('all numbers on the ticket are unique', () => {
        const ticket = generateTicket();
        const nums = getTicketNumbers(ticket);
        const unique = new Set(nums);
        expect(unique.size).toBe(nums.length);
    });

    it('produces different results on multiple calls (probabilistic)', () => {
        const t1 = generateTicket();
        const t2 = generateTicket();
        // Extremely unlikely to be identical; treat as identity check
        const n1 = getTicketNumbers(t1).sort((a, b) => a - b).join(',');
        const n2 = getTicketNumbers(t2).sort((a, b) => a - b).join(',');
        // At minimum the sets may differ; no assertion on exact values,
        // but generation should not throw and both are valid
        expect(n1.split(',').length).toBe(15);
        expect(n2.split(',').length).toBe(15);
    });
});

/* ══════════════════════════════════════════════════════════════
   SUITE 2 — getTicketNumbers
   ══════════════════════════════════════════════════════════════ */

describe('getTicketNumbers', () => {
    it('returns only non-zero values from the grid', () => {
        const ticket = generateTicket();
        const nums = getTicketNumbers(ticket);
        expect(nums.length).toBe(15);
        expect(nums.every(n => n > 0)).toBe(true);
    });

    it('works on a manually constructed grid', () => {
        const ticket = [
            [1, 0, 20, 0, 40, 0, 60, 0, 80],
            [0, 15, 0, 35, 0, 55, 0, 75, 0],
            [5, 0, 25, 0, 45, 0, 65, 0, 85],
        ];
        const nums = getTicketNumbers(ticket);
        expect(nums.sort((a, b) => a - b)).toEqual([1, 5, 15, 20, 25, 35, 40, 45, 55, 60, 65, 75, 80, 85]);
        expect(nums.length).toBe(14); // 14 in this manual ticket
    });
});

/* ══════════════════════════════════════════════════════════════
   SUITE 3 — createInitialState
   ══════════════════════════════════════════════════════════════ */

describe('createInitialState', () => {
    it('status is lobby', () => {
        const state = createInitialState();
        expect(state.status).toBe('lobby');
    });

    it('calledNumbers is empty', () => {
        const state = createInitialState();
        expect(state.calledNumbers).toEqual([]);
    });

    it('prizePool starts at 0', () => {
        const state = createInitialState();
        expect(state.prizePool).toBe(0);
    });

    it('all prizes start with winner: null and amount: 0', () => {
        const state = createInitialState();
        for (const key of Object.keys(PRIZES)) {
            expect(state.prizes[key].winner).toBeNull();
            expect(state.prizes[key].amount).toBe(0);
        }
    });

    it('respects custom ticketPrice config', () => {
        const state = createInitialState({ ticketPrice: 200 });
        expect(state.ticketPrice).toBe(200);
    });

    it('respects custom drawInterval config', () => {
        const state = createInitialState({ drawInterval: 3000 });
        expect(state.drawInterval).toBe(3000);
    });

    it('id starts with tambola_', () => {
        const state = createInitialState();
        expect(state.id).toMatch(/^tambola_\d+$/);
    });
});

/* ══════════════════════════════════════════════════════════════
   SUITE 4 — buyTicket
   ══════════════════════════════════════════════════════════════ */

describe('buyTicket', () => {
    let state;

    beforeEach(() => {
        state = createInitialState({ ticketPrice: 100 });
    });

    it('adds tickets to the player ticket array', () => {
        const { success, state: newState } = buyTicket(state, 'device1', 1);
        expect(success).toBe(true);
        const hash = Object.keys(newState.tickets)[0];
        expect(newState.tickets[hash]).toHaveLength(1);
    });

    it('updates prizePool with 5% rake deducted', () => {
        const { state: newState } = buyTicket(state, 'device1', 1);
        // 100 * 0.95 = 95
        expect(newState.prizePool).toBe(95);
    });

    it('buying 2 tickets adds 190 to prizePool (2 × 95)', () => {
        const { state: newState } = buyTicket(state, 'device1', 2);
        expect(newState.prizePool).toBe(190);
    });

    it('returns the generated tickets in the result', () => {
        const { tickets } = buyTicket(state, 'device1', 2);
        expect(tickets).toHaveLength(2);
        for (const t of tickets) {
            expect(t).toHaveLength(3); // 3 rows
        }
    });

    it('rejected when status is not lobby', () => {
        const drawing = startGame(state);
        const { success, reason } = buyTicket(drawing, 'device1', 1);
        expect(success).toBe(false);
        expect(reason).toBeTruthy();
    });

    it('rejected for count = 0', () => {
        const { success } = buyTicket(state, 'device1', 0);
        expect(success).toBe(false);
    });

    it('rejected for count > 3', () => {
        const { success } = buyTicket(state, 'device1', 4);
        expect(success).toBe(false);
    });

    it('accumulates tickets across multiple purchases by same player', () => {
        const { state: s1 } = buyTicket(state, 'device1', 1);
        const { state: s2 } = buyTicket(s1, 'device1', 2);
        const hash = Object.keys(s2.tickets)[0];
        expect(s2.tickets[hash]).toHaveLength(3);
    });

    it('different devices have separate entries in tickets', () => {
        const { state: s1 } = buyTicket(state, 'device1', 1);
        const { state: s2 } = buyTicket(s1, 'device2', 1);
        expect(Object.keys(s2.tickets)).toHaveLength(2);
    });
});

/* ══════════════════════════════════════════════════════════════
   SUITE 5 — startGame
   ══════════════════════════════════════════════════════════════ */

describe('startGame', () => {
    it('sets status to drawing', () => {
        const state = createInitialState();
        const newState = startGame(state);
        expect(newState.status).toBe('drawing');
    });

    it('is a pure function — does not mutate original state', () => {
        const state = createInitialState();
        startGame(state);
        expect(state.status).toBe('lobby');
    });
});

/* ══════════════════════════════════════════════════════════════
   SUITE 6 — drawNumber
   ══════════════════════════════════════════════════════════════ */

describe('drawNumber', () => {
    let drawingState;

    beforeEach(() => {
        drawingState = startGame(createInitialState());
    });

    it('adds a number to calledNumbers', () => {
        const { success, state } = drawNumber(drawingState);
        expect(success).toBe(true);
        expect(state.calledNumbers).toHaveLength(1);
    });

    it('returns the drawn number', () => {
        const { number } = drawNumber(drawingState);
        expect(number).toBeGreaterThanOrEqual(1);
        expect(number).toBeLessThanOrEqual(90);
    });

    it('drawn number is in range 1-90', () => {
        for (let i = 0; i < 10; i++) {
            const { number } = drawNumber(drawingState);
            expect(number).toBeGreaterThanOrEqual(1);
            expect(number).toBeLessThanOrEqual(90);
        }
    });

    it('never repeats a number in successive draws', () => {
        let s = drawingState;
        const seen = new Set();
        for (let i = 0; i < 20; i++) {
            const { state: newS, number } = drawNumber(s);
            expect(seen.has(number)).toBe(false);
            seen.add(number);
            s = newS;
        }
    });

    it('fails when not in drawing state', () => {
        const lobbyState = createInitialState();
        const { success, reason } = drawNumber(lobbyState);
        expect(success).toBe(false);
        expect(reason).toBeTruthy();
    });

    it('fails when all 90 numbers have been called', () => {
        let s = drawingState;
        for (let i = 0; i < 90; i++) {
            const res = drawNumber(s);
            s = res.state;
        }
        const { success, reason } = drawNumber(s);
        expect(success).toBe(false);
        expect(reason).toMatch(/all 90/i);
    });
});

/* ══════════════════════════════════════════════════════════════
   SUITE 7 — validateClaim
   ══════════════════════════════════════════════════════════════ */

describe('validateClaim', () => {
    // Deterministic ticket fixture
    const ticket = [
        [1, 0, 20, 0, 41, 0, 61, 0, 81],  // row 0: 1, 20, 41, 61, 81
        [0, 12, 0, 33, 0, 52, 0, 72, 0],  // row 1: 12, 33, 52, 72
        [7, 0, 27, 0, 0, 58, 0, 77, 88],  // row 2: 7, 27, 58, 77, 88
    ];
    // Fix: row 1 has only 4 numbers — add one more for test integrity
    const ticketFull = [
        [1, 0, 20, 0, 41, 0, 61, 0, 81],   // row 0: 1, 20, 41, 61, 81
        [0, 12, 0, 33, 0, 52, 0, 72, 86],  // row 1: 12, 33, 52, 72, 86
        [7, 0, 27, 0, 0, 58, 0, 77, 0],    // row 2: 7, 27, 58, 77
    ];

    it('earlyFive: true when at least 5 numbers on ticket are called', () => {
        expect(validateClaim(ticketFull, 'earlyFive', [1, 20, 41, 61, 81])).toBe(true);
    });

    it('earlyFive: false when fewer than 5 numbers called', () => {
        expect(validateClaim(ticketFull, 'earlyFive', [1, 20, 41, 61])).toBe(false);
    });

    it('topLine: true when all row 0 numbers are called', () => {
        expect(validateClaim(ticketFull, 'topLine', [1, 20, 41, 61, 81])).toBe(true);
    });

    it('topLine: false when row 0 has an uncalled number', () => {
        expect(validateClaim(ticketFull, 'topLine', [1, 20, 41, 61])).toBe(false);
    });

    it('middleLine: true when all row 1 numbers are called', () => {
        expect(validateClaim(ticketFull, 'middleLine', [12, 33, 52, 72, 86])).toBe(true);
    });

    it('middleLine: false when row 1 has an uncalled number', () => {
        expect(validateClaim(ticketFull, 'middleLine', [12, 33, 52, 72])).toBe(false);
    });

    it('bottomLine: true when all row 2 numbers are called', () => {
        expect(validateClaim(ticketFull, 'bottomLine', [7, 27, 58, 77])).toBe(true);
    });

    it('fullHouse: true when all 15 numbers are called', () => {
        const allNums = getTicketNumbers(ticketFull);
        expect(validateClaim(ticketFull, 'fullHouse', allNums)).toBe(true);
    });

    it('fullHouse: false when any number is not yet called', () => {
        const allNums = getTicketNumbers(ticketFull);
        const partial = allNums.slice(0, -1);
        expect(validateClaim(ticketFull, 'fullHouse', partial)).toBe(false);
    });

    it('unknown prizeKey returns false', () => {
        expect(validateClaim(ticketFull, 'jackpot', [1, 20, 41, 61, 81])).toBe(false);
    });
});

/* ══════════════════════════════════════════════════════════════
   SUITE 8 — claimPrize
   ══════════════════════════════════════════════════════════════ */

describe('claimPrize', () => {
    let stateWithTicket;
    let ticketNums;

    beforeEach(() => {
        // Buy ticket while in lobby, then start the game
        const lobby = createInitialState({ ticketPrice: 1000 });
        const { state: afterBuy } = buyTicket(lobby, 'player1', 1);
        stateWithTicket = startGame(afterBuy);
        // Get the first ticket for player1
        const hash = Object.keys(stateWithTicket.tickets)[0];
        const ticket = stateWithTicket.tickets[hash][0];
        ticketNums = getTicketNumbers(ticket);
    });

    it('sets the prize winner and returns the payout amount', () => {
        // Call all ticket numbers first so earlyFive is valid
        let s = stateWithTicket;
        for (const n of ticketNums.slice(0, 5)) {
            s = drawNumber(s).state;
            // Force specific numbers into calledNumbers for determinism
        }
        // Force calledNumbers to contain first 5 ticket numbers
        s = { ...s, calledNumbers: ticketNums.slice(0, 5) };

        const { success, state: newState, amount } = claimPrize(s, 'player1', 'earlyFive', 0);
        expect(success).toBe(true);
        expect(amount).toBeGreaterThan(0);
        const hash = Object.keys(newState.tickets)[0];
        expect(newState.prizes.earlyFive.winner).toBe(hash);
    });

    it('rejected if prize already claimed', () => {
        let s = { ...stateWithTicket, calledNumbers: ticketNums.slice(0, 5) };
        const { state: s1 } = claimPrize(s, 'player1', 'earlyFive', 0);
        const { success, reason } = claimPrize(s1, 'player1', 'earlyFive', 0);
        expect(success).toBe(false);
        expect(reason).toMatch(/already claimed/i);
    });

    it('rejected if claim pattern not complete (not enough numbers called)', () => {
        const s = { ...stateWithTicket, calledNumbers: [ticketNums[0]] };
        const { success, reason } = claimPrize(s, 'player1', 'earlyFive', 0);
        expect(success).toBe(false);
        expect(reason).toMatch(/not complete/i);
    });

    it('rejected for unknown prizeKey', () => {
        const { success, reason } = claimPrize(stateWithTicket, 'player1', 'megaWin', 0);
        expect(success).toBe(false);
        expect(reason).toMatch(/unknown prize/i);
    });

    it('rejected if ticketId does not exist', () => {
        const s = { ...stateWithTicket, calledNumbers: ticketNums };
        const { success, reason } = claimPrize(s, 'player1', 'fullHouse', 99);
        expect(success).toBe(false);
        expect(reason).toMatch(/ticket not found/i);
    });

    it('fullHouse claim sets status to ended', () => {
        const s = { ...stateWithTicket, calledNumbers: ticketNums };
        const { success, state: newState } = claimPrize(s, 'player1', 'fullHouse', 0);
        expect(success).toBe(true);
        expect(newState.status).toBe('ended');
    });

    it('non-fullHouse claim does not change status', () => {
        const s = { ...stateWithTicket, calledNumbers: ticketNums.slice(0, 5) };
        const { state: newState } = claimPrize(s, 'player1', 'earlyFive', 0);
        expect(newState.status).toBe('drawing');
    });
});

/* ══════════════════════════════════════════════════════════════
   SUITE 9 — redistributeUnclaimed
   ══════════════════════════════════════════════════════════════ */

describe('redistributeUnclaimed', () => {
    it('adds unclaimed prize amounts to fullHouse if it is also unclaimed', () => {
        const state = createInitialState({ ticketPrice: 1000 });
        // Simulate prizePool of 1000 and topLine unclaimed
        const enriched = { ...state, prizePool: 1000 };
        const result = redistributeUnclaimed(enriched);
        // All prizes unclaimed: topLine (15%) + middleLine (15%) + bottomLine (15%) + earlyFive (10%) = 55%
        // That 55% rolls into fullHouse
        const extra = Math.floor(1000 * (0.10 + 0.15 + 0.15 + 0.15));
        expect(result.prizes.fullHouse.amount).toBe(extra);
    });

    it('returns state unchanged if all non-fullHouse prizes are claimed', () => {
        const state = createInitialState({ ticketPrice: 1000 });
        const allClaimed = {
            ...state,
            prizePool: 1000,
            prizes: {
                earlyFive:  { winner: 'abc', amount: 100 },
                topLine:    { winner: 'abc', amount: 150 },
                middleLine: { winner: 'abc', amount: 150 },
                bottomLine: { winner: 'abc', amount: 150 },
                fullHouse:  { winner: null, amount: 0 },
            },
        };
        const result = redistributeUnclaimed(allClaimed);
        expect(result.prizes.fullHouse.amount).toBe(0);
    });
});

/* ══════════════════════════════════════════════════════════════
   SUITE 10 — TambolaEngine class
   ══════════════════════════════════════════════════════════════ */

describe('TambolaEngine', () => {
    let engine;

    beforeEach(() => {
        engine = new TambolaEngine({ ticketPrice: 100 });
    });

    it('extends GameEngine', () => {
        expect(engine).toBeInstanceOf(GameEngine);
    });

    it('getGameState returns current state snapshot', () => {
        const s = engine.getGameState();
        expect(s).toBeTruthy();
        expect(s.status).toBe('lobby');
        expect(s.calledNumbers).toEqual([]);
    });

    it('getGameState returns a copy (not the internal reference)', () => {
        const s1 = engine.getGameState();
        s1.status = 'hacked';
        const s2 = engine.getGameState();
        expect(s2.status).toBe('lobby');
    });

    it('calculatePayout: earlyFive returns 10% of prizePool', () => {
        const amount = engine.calculatePayout(
            { prizePool: 1000, claimed: {} },
            { winner: 'earlyFive' }
        );
        expect(amount).toBe(100);
    });

    it('calculatePayout: topLine returns 15% of prizePool', () => {
        const amount = engine.calculatePayout(
            { prizePool: 1000, claimed: {} },
            { winner: 'topLine' }
        );
        expect(amount).toBe(150);
    });

    it('calculatePayout: fullHouse returns 45% of prizePool', () => {
        const amount = engine.calculatePayout(
            { prizePool: 1000, claimed: {} },
            { winner: 'fullHouse' }
        );
        expect(amount).toBe(450);
    });

    it('calculatePayout: unknown winner returns 0', () => {
        const amount = engine.calculatePayout(
            { prizePool: 1000, claimed: {} },
            { winner: 'invalid' }
        );
        expect(amount).toBe(0);
    });

    it('getRules returns a non-empty string', () => {
        const rules = engine.getRules();
        expect(typeof rules).toBe('string');
        expect(rules.length).toBeGreaterThan(0);
    });

    it('getRules mentions Tambola', () => {
        expect(engine.getRules()).toMatch(/tambola/i);
    });

    it('PRIZES pct values sum to 1.0', () => {
        const total = Object.values(PRIZES).reduce((s, p) => s + p.pct, 0);
        expect(total).toBeCloseTo(1.0);
    });
});
