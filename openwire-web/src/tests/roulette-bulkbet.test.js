/**
 * roulette-bulkbet.test.js
 *
 * Tests for roulette bulkBet pattern: placeBet called multiple times
 * via reduce to atomically accumulate bets.
 */

import { describe, it, expect, vi } from 'vitest';

/* ── Stub browser APIs ───────────────────────────────────────── */
const _ssStore = new Map();
vi.stubGlobal('sessionStorage', {
    getItem: (k) => _ssStore.get(k) ?? null,
    setItem: (k, v) => _ssStore.set(k, String(v)),
    removeItem: (k) => _ssStore.delete(k),
    clear: () => _ssStore.clear(),
});
vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
});
vi.stubGlobal('crypto', {
    getRandomValues: (buf) => {
        for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 0xFFFFFFFF);
        return buf;
    },
    randomUUID: () => 'test-uuid-rl-bulk',
});

import {
    createRoulette,
    placeBet,
} from '../lib/roulette.js';

/* ═══════════════════════════════════════════════════════════════
   bulkBet via reduce
   ═══════════════════════════════════════════════════════════════ */

describe('Roulette bulkBet (placeBet via reduce)', () => {
    it('placeBet can be called multiple times via reduce to build up bets atomically', () => {
        const bets = [
            { betType: 'color', betTarget: 'red', amount: 100 },
            { betType: 'single', betTarget: 17, amount: 50 },
            { betType: 'parity', betTarget: 'even', amount: 75 },
        ];

        const game = createRoulette('room-bulk');

        const result = bets.reduce(
            (g, bet) => placeBet(g, 'player-1', 'Alice', bet.betType, bet.betTarget, bet.amount),
            game,
        );

        expect(result.bets).toHaveLength(3);
    });

    it('bets array accumulates correctly with distinct bet types', () => {
        const game = createRoulette('room-bulk-2');

        let g = placeBet(game, 'p1', 'Alice', 'color', 'red', 100);
        g = placeBet(g, 'p1', 'Alice', 'color', 'black', 200);
        g = placeBet(g, 'p1', 'Alice', 'single', 7, 50);

        expect(g.bets).toHaveLength(3);
        expect(g.bets[0]).toMatchObject({ betType: 'color', betTarget: 'red', amount: 100 });
        expect(g.bets[1]).toMatchObject({ betType: 'color', betTarget: 'black', amount: 200 });
        expect(g.bets[2]).toMatchObject({ betType: 'single', betTarget: 7, amount: 50 });
    });

    it('replaces existing bet of same type+target', () => {
        const game = createRoulette('room-replace');

        let g = placeBet(game, 'p1', 'Alice', 'color', 'red', 100);
        g = placeBet(g, 'p1', 'Alice', 'color', 'red', 200);

        // Same type+target from same player should replace, not duplicate
        expect(g.bets).toHaveLength(1);
        expect(g.bets[0].amount).toBe(200);
    });

    it('allows different players to bet on the same type+target', () => {
        const game = createRoulette('room-multi');

        let g = placeBet(game, 'p1', 'Alice', 'color', 'red', 100);
        g = placeBet(g, 'p2', 'Bob', 'color', 'red', 150);

        expect(g.bets).toHaveLength(2);
        expect(g.bets.find(b => b.peer_id === 'p1').amount).toBe(100);
        expect(g.bets.find(b => b.peer_id === 'p2').amount).toBe(150);
    });

    it('rejects invalid amounts (0, negative, NaN)', () => {
        const game = createRoulette('room-invalid');

        const g1 = placeBet(game, 'p1', 'Alice', 'color', 'red', 0);
        expect(g1.bets).toHaveLength(0);

        const g2 = placeBet(game, 'p1', 'Alice', 'color', 'red', -10);
        expect(g2.bets).toHaveLength(0);

        const g3 = placeBet(game, 'p1', 'Alice', 'color', 'red', NaN);
        expect(g3.bets).toHaveLength(0);
    });

    it('bulk reduce with 5 bets produces correct accumulation', () => {
        const bets = [
            { betType: 'color', betTarget: 'red', amount: 100 },
            { betType: 'color', betTarget: 'black', amount: 100 },
            { betType: 'parity', betTarget: 'even', amount: 50 },
            { betType: 'half', betTarget: 'low', amount: 75 },
            { betType: 'dozen', betTarget: 1, amount: 25 },
        ];

        const game = createRoulette('room-5bets');
        const result = bets.reduce(
            (g, bet) => placeBet(g, 'p1', 'Alice', bet.betType, bet.betTarget, bet.amount),
            game,
        );

        expect(result.bets).toHaveLength(5);
        const totalWagered = result.bets.reduce((sum, b) => sum + b.amount, 0);
        expect(totalWagered).toBe(350);
    });

    it('does not mutate the original game object', () => {
        const game = createRoulette('room-immutable');
        const original = { ...game, bets: [...game.bets] };

        placeBet(game, 'p1', 'Alice', 'color', 'red', 100);

        expect(game.bets).toEqual(original.bets);
    });
});
