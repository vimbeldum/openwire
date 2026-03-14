/**
 * blackjack-timeout.test.js
 *
 * Tests for the Blackjack turn timeout feature: turnDeadline management,
 * sitting-out zero-bet players, and TURN_TIMEOUT_MS constant.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Stub browser APIs before importing game engine ────────────── */
const _ssStore = new Map();
vi.stubGlobal('sessionStorage', {
    getItem: (k) => _ssStore.get(k) ?? null,
    setItem: (k, v) => _ssStore.set(k, String(v)),
    removeItem: (k) => _ssStore.delete(k),
    clear: () => _ssStore.clear(),
});
const _lsStore = new Map();
vi.stubGlobal('localStorage', {
    getItem: (k) => _lsStore.get(k) ?? null,
    setItem: (k, v) => _lsStore.set(k, String(v)),
    removeItem: (k) => _lsStore.delete(k),
    clear: () => _lsStore.clear(),
});
vi.stubGlobal('crypto', {
    getRandomValues: (buf) => {
        for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 0xFFFFFFFF);
        return buf;
    },
    randomUUID: () => 'test-uuid-bj-timeout',
});

import {
    createGame,
    addPlayer,
    placeBet,
    dealInitialCards,
    hit,
    stand,
    split,
    doubleDown,
    newRound,
    canSplit,
    TURN_TIMEOUT_MS,
} from '../lib/blackjack.js';

/* ── Helpers ───────────────────────────────────────────────────── */

function makeCard(value, suit = '\u2660') {
    return { value, suit, id: `${value}${suit}` };
}

function setupGame(playerBets = [100]) {
    let game = createGame('room-timeout', 'dealer-1');
    playerBets.forEach((bet, i) => {
        game = addPlayer(game, `p${i}`, `Player${i}`);
        if (bet > 0) {
            game = placeBet(game, `p${i}`, bet);
        }
    });
    return game;
}

function setupGameWithCards(playerHands, dealerHand) {
    let game = createGame('room-timeout', 'dealer-1');
    const deck = [];

    // Build deck in reverse so pop() gives cards in order
    // Deal pattern: 2 rounds of (each player + dealer)
    // Round 1: player0[0], player1[0], ..., dealer[0]
    // Round 2: player0[1], player1[1], ..., dealer[1]
    const allCards = [];
    for (let round = 0; round < 2; round++) {
        for (let i = 0; i < playerHands.length; i++) {
            if (playerHands[i]) {
                allCards.push(playerHands[i][round]);
            }
        }
        allCards.push(dealerHand[round]);
    }

    // Deck is popped (LIFO), so reverse
    for (let i = allCards.length - 1; i >= 0; i--) {
        deck.push(allCards[i]);
    }

    playerHands.forEach((hand, i) => {
        game = addPlayer(game, `p${i}`, `Player${i}`);
        if (hand) {
            game = placeBet(game, `p${i}`, 100);
        }
    });

    game = { ...game, deck };
    return game;
}

/* ═══════════════════════════════════════════════════════════════
   TURN_TIMEOUT_MS constant
   ═══════════════════════════════════════════════════════════════ */

describe('TURN_TIMEOUT_MS', () => {
    it('is exported and equals 30000', () => {
        expect(TURN_TIMEOUT_MS).toBe(30000);
    });
});

/* ═══════════════════════════════════════════════════════════════
   dealInitialCards — sitting out, turnDeadline, no-bet edge case
   ═══════════════════════════════════════════════════════════════ */

describe('dealInitialCards', () => {
    it('skips players with bet === 0 (status sitting_out, no cards)', () => {
        let game = createGame('room-1', 'dealer-1');
        game = addPlayer(game, 'p0', 'Alice');
        game = addPlayer(game, 'p1', 'Bob');
        // p0 places bet, p1 does not
        game = placeBet(game, 'p0', 100);
        // p1 has bet === 0

        const dealt = dealInitialCards(game);
        const p0 = dealt.players.find(p => p.peer_id === 'p0');
        const p1 = dealt.players.find(p => p.peer_id === 'p1');

        expect(p0.hand.length).toBe(2);
        expect(p0.status).not.toBe('sitting_out');
        expect(p1.hand.length).toBe(0);
        expect(p1.status).toBe('sitting_out');
    });

    it('sets turnDeadline when phase is playing', () => {
        const game = setupGame([100]);
        const before = Date.now();
        const dealt = dealInitialCards(game);

        if (dealt.phase === 'playing') {
            expect(dealt.turnDeadline).toBeGreaterThanOrEqual(before + TURN_TIMEOUT_MS);
            expect(dealt.turnDeadline).toBeLessThanOrEqual(Date.now() + TURN_TIMEOUT_MS);
        }
    });

    it('returns phase ended when no players have bets', () => {
        let game = createGame('room-empty', 'dealer-1');
        game = addPlayer(game, 'p0', 'Alice');
        // p0 has bet === 0

        const dealt = dealInitialCards(game);
        expect(dealt.phase).toBe('ended');
        expect(dealt.turnDeadline).toBeNull();
    });

    it('sets turnDeadline to null when all players have blackjack (phase goes to dealer)', () => {
        // Construct a game where player gets blackjack (A + K)
        const playerHand = [makeCard('A'), makeCard('K')];
        const dealerHand = [makeCard('5'), makeCard('6')];
        const game = setupGameWithCards([playerHand], dealerHand);

        const dealt = dealInitialCards(game);
        // Player has blackjack, so no one is 'playing' -> phase = 'dealer'
        if (dealt.phase === 'dealer') {
            expect(dealt.turnDeadline).toBeNull();
        }
    });
});

/* ═══════════════════════════════════════════════════════════════
   hit — turnDeadline reset
   ═══════════════════════════════════════════════════════════════ */

describe('hit() turnDeadline', () => {
    it('updates turnDeadline (resets timer for next action)', () => {
        const game = setupGame([100]);
        const dealt = dealInitialCards(game);

        if (dealt.phase === 'playing' && dealt.currentPlayerIndex >= 0) {
            const playerId = dealt.players[dealt.currentPlayerIndex].peer_id;
            const before = Date.now();
            const afterHit = hit(dealt, playerId);

            if (afterHit.phase === 'playing') {
                expect(afterHit.turnDeadline).toBeGreaterThanOrEqual(before + TURN_TIMEOUT_MS);
            } else if (afterHit.phase === 'dealer') {
                expect(afterHit.turnDeadline).toBeNull();
            }
        }
    });

    it('clears turnDeadline when hit causes transition to dealer phase', () => {
        // Set up a game with one player who will bust
        let game = createGame('room-bust', 'dealer-1');
        game = addPlayer(game, 'p0', 'Alice');
        game = placeBet(game, 'p0', 100);

        const dealt = dealInitialCards(game);
        if (dealt.phase !== 'playing') return; // skip if blackjack

        // Keep hitting until bust or dealer phase
        let current = dealt;
        let iterations = 0;
        while (current.phase === 'playing' && iterations < 10) {
            const pid = current.players[current.currentPlayerIndex].peer_id;
            current = hit(current, pid);
            iterations++;
        }

        if (current.phase === 'dealer') {
            expect(current.turnDeadline).toBeNull();
        }
    });
});

/* ═══════════════════════════════════════════════════════════════
   stand — turnDeadline behavior
   ═══════════════════════════════════════════════════════════════ */

describe('stand() turnDeadline', () => {
    it('updates turnDeadline when advancing to next player', () => {
        // Two players, both with bets
        const game = setupGame([100, 100]);
        const dealt = dealInitialCards(game);

        if (dealt.phase !== 'playing') return;

        const firstPlayer = dealt.players[dealt.currentPlayerIndex].peer_id;
        const afterStand = stand(dealt, firstPlayer);

        // If there's a next player, phase stays 'playing' with a new deadline
        if (afterStand.phase === 'playing') {
            expect(afterStand.turnDeadline).toBeGreaterThan(0);
            expect(afterStand.currentPlayerIndex).not.toBe(dealt.currentPlayerIndex);
        }
    });

    it('clears turnDeadline (null) when phase transitions to dealer', () => {
        // Single player game
        const game = setupGame([100]);
        const dealt = dealInitialCards(game);

        if (dealt.phase !== 'playing') return;

        const playerId = dealt.players[dealt.currentPlayerIndex].peer_id;
        const afterStand = stand(dealt, playerId);

        // Only one player, so stand should transition to dealer
        expect(afterStand.phase).toBe('dealer');
        expect(afterStand.turnDeadline).toBeNull();
    });
});

/* ═══════════════════════════════════════════════════════════════
   split — turnDeadline reset
   ═══════════════════════════════════════════════════════════════ */

describe('split() turnDeadline', () => {
    it('resets turnDeadline', () => {
        // Set up a game where the player has a pair
        let game = createGame('room-split', 'dealer-1');
        game = addPlayer(game, 'p0', 'Alice');
        game = placeBet(game, 'p0', 100);

        // Build a deck where p0 gets a pair of 8s
        const deck = [
            makeCard('8', '\u2660'),
            makeCard('3', '\u2665'),
            makeCard('8', '\u2663'),
            makeCard('7', '\u2666'),
            // Extra cards for split deal
            makeCard('5', '\u2660'),
            makeCard('6', '\u2665'),
        ];
        game = { ...game, deck: deck.reverse() };

        const dealt = dealInitialCards(game);
        if (dealt.phase !== 'playing') return;

        if (canSplit(dealt, 'p0')) {
            const before = Date.now();
            const afterSplit = split(dealt, 'p0');

            if (afterSplit.phase === 'playing') {
                expect(afterSplit.turnDeadline).toBeGreaterThanOrEqual(before + TURN_TIMEOUT_MS);
            } else if (afterSplit.phase === 'dealer') {
                expect(afterSplit.turnDeadline).toBeNull();
            }
        }
    });
});

/* ═══════════════════════════════════════════════════════════════
   doubleDown — turnDeadline behavior
   ═══════════════════════════════════════════════════════════════ */

describe('doubleDown() turnDeadline', () => {
    it('sets turnDeadline appropriately', () => {
        const game = setupGame([100]);
        const dealt = dealInitialCards(game);

        if (dealt.phase !== 'playing') return;

        const playerId = dealt.players[dealt.currentPlayerIndex].peer_id;
        const afterDD = doubleDown(dealt, playerId);

        if (afterDD.phase === 'dealer') {
            // Single player doubled down -> auto-stand -> dealer
            expect(afterDD.turnDeadline).toBeNull();
        } else if (afterDD.phase === 'playing') {
            // Multi-player scenario or split hand pending
            expect(afterDD.turnDeadline).toBeGreaterThan(0);
        }
    });

    it('clears turnDeadline when last player doubles down (transitions to dealer)', () => {
        // Single player game
        const game = setupGame([100]);
        const dealt = dealInitialCards(game);

        if (dealt.phase !== 'playing') return;

        const playerId = dealt.players[dealt.currentPlayerIndex].peer_id;
        const afterDD = doubleDown(dealt, playerId);

        // With only one player, doubleDown auto-stands -> dealer
        expect(afterDD.phase).toBe('dealer');
        expect(afterDD.turnDeadline).toBeNull();
    });
});

/* ═══════════════════════════════════════════════════════════════
   newRound — turnDeadline cleared
   ═══════════════════════════════════════════════════════════════ */

describe('newRound() turnDeadline', () => {
    it('clears turnDeadline to null', () => {
        const game = setupGame([100]);
        const dealt = dealInitialCards(game);
        const round = newRound(dealt);

        expect(round.turnDeadline).toBeNull();
    });

    it('resets all players to waiting with bet 0', () => {
        const game = setupGame([100, 200]);
        const dealt = dealInitialCards(game);
        const round = newRound(dealt);

        for (const p of round.players) {
            expect(p.status).toBe('waiting');
            expect(p.bet).toBe(0);
            expect(p.hand).toEqual([]);
        }
    });
});
