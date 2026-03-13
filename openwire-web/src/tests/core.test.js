import { describe, it, expect, vi } from 'vitest';

import {
    createPayoutEvent,
    createNonFinancialEvent,
} from '../lib/core/PayoutEvent.js';

import {
    calcHouseGain,
    clampChips,
    settleBets,
} from '../lib/core/payouts.js';

/* ═══════════════════════════════════════════════════════════════
   SUITE 1 -- createPayoutEvent
   ═══════════════════════════════════════════════════════════════ */

describe('createPayoutEvent', () => {
    it('returns an object with financial:true', () => {
        const event = createPayoutEvent({
            gameType: 'roulette',
            roundId: 'r-1',
            resultLabel: 'Red wins',
            breakdown: [],
            totals: {},
        });
        expect(event.financial).toBe(true);
    });

    it('includes id, gameType, roundId, timestamp, resultLabel', () => {
        const event = createPayoutEvent({
            gameType: 'blackjack',
            roundId: 'bj-42',
            resultLabel: 'Dealer busts',
            breakdown: [{ peer_id: 'p1', nick: 'A', betLabel: 'x', wager: 100, net: 100, outcome: 'win' }],
            totals: { p1: 100 },
        });
        expect(event.id).toBeTruthy();
        expect(event.gameType).toBe('blackjack');
        expect(event.roundId).toBe('bj-42');
        expect(event.timestamp).toBeGreaterThan(0);
        expect(event.resultLabel).toBe('Dealer busts');
    });

    it('includes breakdown and totals', () => {
        const breakdown = [
            { peer_id: 'p1', nick: 'A', betLabel: 'Red', wager: 50, net: 50, outcome: 'win' },
            { peer_id: 'p2', nick: 'B', betLabel: 'Black', wager: 50, net: -50, outcome: 'loss' },
        ];
        const totals = { p1: 50, p2: -50 };
        const event = createPayoutEvent({
            gameType: 'roulette',
            roundId: 'r-1',
            resultLabel: 'Red',
            breakdown,
            totals,
        });
        expect(event.breakdown).toHaveLength(2);
        expect(event.totals).toEqual(totals);
    });

    it('defaults breakdown to empty array when omitted', () => {
        const event = createPayoutEvent({
            gameType: 'roulette',
            roundId: 'r-1',
            resultLabel: 'Zero',
        });
        expect(event.breakdown).toEqual([]);
    });

    it('defaults totals to empty object when omitted', () => {
        const event = createPayoutEvent({
            gameType: 'roulette',
            roundId: 'r-1',
            resultLabel: 'Zero',
        });
        expect(event.totals).toEqual({});
    });

    it('generates unique ids for each event', () => {
        const e1 = createPayoutEvent({ gameType: 'a', roundId: 'r1', resultLabel: 'x' });
        const e2 = createPayoutEvent({ gameType: 'a', roundId: 'r2', resultLabel: 'x' });
        expect(e1.id).not.toBe(e2.id);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 2 -- createNonFinancialEvent
   ═══════════════════════════════════════════════════════════════ */

describe('createNonFinancialEvent', () => {
    it('returns an object with financial:false', () => {
        const event = createNonFinancialEvent({
            gameType: 'tictactoe',
            roundId: 'ttt-1',
            resultLabel: 'X wins',
            playerStats: [],
        });
        expect(event.financial).toBe(false);
    });

    it('includes id, gameType, roundId, timestamp, resultLabel', () => {
        const event = createNonFinancialEvent({
            gameType: 'tictactoe',
            roundId: 'ttt-1',
            resultLabel: 'Draw',
            playerStats: [{ peer_id: 'p1', nick: 'Alice', outcome: 'draw' }],
        });
        expect(event.id).toBeTruthy();
        expect(event.gameType).toBe('tictactoe');
        expect(event.roundId).toBe('ttt-1');
        expect(event.timestamp).toBeGreaterThan(0);
        expect(event.resultLabel).toBe('Draw');
    });

    it('includes playerStats', () => {
        const stats = [
            { peer_id: 'p1', nick: 'Alice', outcome: 'win' },
            { peer_id: 'p2', nick: 'Bob', outcome: 'loss' },
        ];
        const event = createNonFinancialEvent({
            gameType: 'tictactoe',
            roundId: 'ttt-1',
            resultLabel: 'Alice wins',
            playerStats: stats,
        });
        expect(event.playerStats).toHaveLength(2);
        expect(event.playerStats[0].outcome).toBe('win');
    });

    it('defaults playerStats to empty array when omitted', () => {
        const event = createNonFinancialEvent({
            gameType: 'tictactoe',
            roundId: 'ttt-1',
            resultLabel: 'Draw',
        });
        expect(event.playerStats).toEqual([]);
    });

    it('always has empty breakdown and totals', () => {
        const event = createNonFinancialEvent({
            gameType: 'tictactoe',
            roundId: 'ttt-1',
            resultLabel: 'X wins',
            playerStats: [{ peer_id: 'p1', nick: 'A', outcome: 'win' }],
        });
        expect(event.breakdown).toEqual([]);
        expect(event.totals).toEqual({});
    });

    it('generates unique ids for each event', () => {
        const e1 = createNonFinancialEvent({ gameType: 'a', roundId: 'r1', resultLabel: 'x' });
        const e2 = createNonFinancialEvent({ gameType: 'a', roundId: 'r2', resultLabel: 'x' });
        expect(e1.id).not.toBe(e2.id);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 3 -- calcHouseGain
   ═══════════════════════════════════════════════════════════════ */

describe('calcHouseGain', () => {
    it('returns positive when players lose chips (negative payouts)', () => {
        // Player loses 100 => payout is -100 => house gains 100
        expect(calcHouseGain({ p1: -100 })).toBe(100);
    });

    it('returns negative when players win chips (positive payouts)', () => {
        // Player wins 50 => payout is 50 => house gains -50
        expect(calcHouseGain({ p1: 50 })).toBe(-50);
    });

    it('handles mixed player results', () => {
        // p1 wins 100, p2 loses 75 => sum = 25 => house gains -25
        expect(calcHouseGain({ p1: 100, p2: -75 })).toBe(-25);
    });

    it('returns 0 for empty payouts', () => {
        expect(calcHouseGain({} ) + 0).toBe(0);
    });

    it('handles multiple players all losing', () => {
        expect(calcHouseGain({ p1: -50, p2: -50, p3: -100 })).toBe(200);
    });

    it('handles zero payout', () => {
        expect(calcHouseGain({ p1: 0 }) + 0).toBe(0);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 4 -- clampChips
   ═══════════════════════════════════════════════════════════════ */

describe('clampChips', () => {
    it('returns 0 for negative values', () => {
        expect(clampChips(-50)).toBe(0);
        expect(clampChips(-1)).toBe(0);
    });

    it('returns 0 for zero', () => {
        expect(clampChips(0)).toBe(0);
    });

    it('returns unchanged positive value', () => {
        expect(clampChips(100)).toBe(100);
        expect(clampChips(1)).toBe(1);
    });

    it('handles large numbers', () => {
        expect(clampChips(1_000_000)).toBe(1_000_000);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 5 -- settleBets
   ═══════════════════════════════════════════════════════════════ */

describe('settleBets', () => {
    it('accumulates payouts for bets from same peer_id', () => {
        const bets = [
            { peer_id: 'p1', amount: 50 },
            { peer_id: 'p1', amount: 100 },
        ];
        const payouts = settleBets(bets, bet => bet.amount);
        expect(payouts['p1']).toBe(150);
    });

    it('separates payouts for different peer_ids', () => {
        const bets = [
            { peer_id: 'p1', amount: 50 },
            { peer_id: 'p2', amount: 100 },
        ];
        const payouts = settleBets(bets, bet => bet.amount);
        expect(payouts['p1']).toBe(50);
        expect(payouts['p2']).toBe(100);
    });

    it('returns empty object for empty bets', () => {
        expect(settleBets([], () => 0)).toEqual({});
    });

    it('handles negative settle results (losses)', () => {
        const bets = [{ peer_id: 'p1', amount: 100 }];
        const payouts = settleBets(bets, bet => -bet.amount);
        expect(payouts['p1']).toBe(-100);
    });

    it('handles mixed wins and losses for same peer', () => {
        const bets = [
            { peer_id: 'p1', amount: 100, side: 'red' },
            { peer_id: 'p1', amount: 50, side: 'black' },
        ];
        const payouts = settleBets(bets, bet => {
            return bet.side === 'red' ? bet.amount : -bet.amount;
        });
        // 100 + (-50) = 50
        expect(payouts['p1']).toBe(50);
    });

    it('uses settleFn to determine each bet payout', () => {
        const bets = [
            { peer_id: 'p1', amount: 100, multiplier: 2 },
            { peer_id: 'p2', amount: 50, multiplier: 0 },
        ];
        const payouts = settleBets(bets, bet => bet.amount * bet.multiplier);
        expect(payouts['p1']).toBe(200);
        expect(payouts['p2']).toBe(0);
    });
});
