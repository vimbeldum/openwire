/**
 * gap-blackjack-host.test.js
 *
 * Pure Vitest tests for migrateHost() in blackjack.js.
 * No jsdom required — all tests operate on plain JS objects.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Browser API stubs (blackjack.js uses crypto.getRandomValues) ── */
beforeEach(() => {
    vi.stubGlobal('crypto', {
        getRandomValues: (buf) => {
            buf.fill(0);
            return buf;
        },
        randomUUID: () => 'test-uuid',
    });
    vi.stubGlobal('localStorage', {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
        clear: () => {},
    });
    vi.stubGlobal('sessionStorage', {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
        clear: () => {},
    });
});

import {
    createGame,
    addPlayer,
    placeBet as bjPlaceBet,
    dealInitialCards,
    migrateHost,
} from '../../lib/blackjack.js';

/* ── Helpers ─────────────────────────────────────────────────────── */

/**
 * Build a game with the given peer IDs as players.
 * The first peer_id is used as the host (dealerId for createGame).
 */
function buildGame(peerIds, { phase = 'betting' } = {}) {
    let game = createGame('room-1', peerIds[0]);
    for (const id of peerIds) {
        game = addPlayer(game, id, `Nick-${id}`);
    }
    return { ...game, phase };
}

/**
 * Build a mid-round game (dealing done, phase='playing').
 * Returns the game after dealInitialCards so hands/deck are real.
 */
function buildPlayingGame(peerIds) {
    let game = createGame('room-1', peerIds[0]);
    for (const id of peerIds) {
        game = addPlayer(game, id, `Nick-${id}`);
        game = bjPlaceBet(game, id, 100);
    }
    return dealInitialCards(game);
}

/* ═══════════════════════════════════════════════════════════════════
   SUITE 1 — Basic host migration
   ═══════════════════════════════════════════════════════════════════ */

describe('migrateHost — host departs', () => {
    it('next player in array becomes the new host when host departs', () => {
        const game = buildGame(['alice', 'bob', 'carol']);
        const updated = migrateHost(game, 'alice');
        expect(updated).not.toBeNull();
        expect(updated.hostPeerId).toBe('bob');
    });

    it('departed host is removed from players array', () => {
        const game = buildGame(['alice', 'bob', 'carol']);
        const updated = migrateHost(game, 'alice');
        const ids = updated.players.map(p => p.peer_id);
        expect(ids).not.toContain('alice');
        expect(ids).toContain('bob');
        expect(ids).toContain('carol');
    });

    it('new host is the first remaining player by original index order', () => {
        // alice=host, bob departs first (non-host), then alice departs
        const game = buildGame(['alice', 'bob', 'carol']);
        const afterBob = migrateHost(game, 'bob');
        // alice still host, carol is second remaining player
        const afterAlice = migrateHost(afterBob, 'alice');
        expect(afterAlice.hostPeerId).toBe('carol');
    });

    it('new host peer has isHost flag derivable via hostPeerId match', () => {
        const game = buildGame(['alice', 'bob']);
        const updated = migrateHost(game, 'alice');
        expect(updated.hostPeerId).toBe('bob');
        const newHost = updated.players.find(p => p.peer_id === updated.hostPeerId);
        expect(newHost).toBeDefined();
    });
});

/* ═══════════════════════════════════════════════════════════════════
   SUITE 2 — Non-host departure
   ═══════════════════════════════════════════════════════════════════ */

describe('migrateHost — non-host departs', () => {
    it('host is unchanged when a non-host player departs', () => {
        const game = buildGame(['alice', 'bob', 'carol']);
        const updated = migrateHost(game, 'bob');
        expect(updated.hostPeerId).toBe('alice');
    });

    it('departed non-host is removed from players array', () => {
        const game = buildGame(['alice', 'bob', 'carol']);
        const updated = migrateHost(game, 'carol');
        expect(updated.players.map(p => p.peer_id)).toEqual(['alice', 'bob'].map(id => id));
        expect(updated.players.find(p => p.peer_id === 'carol')).toBeUndefined();
    });

    it('remaining player count decreases by exactly one', () => {
        const game = buildGame(['alice', 'bob', 'carol']);
        const updated = migrateHost(game, 'bob');
        expect(updated.players).toHaveLength(2);
    });
});

/* ═══════════════════════════════════════════════════════════════════
   SUITE 3 — Last player departs
   ═══════════════════════════════════════════════════════════════════ */

describe('migrateHost — last player departs', () => {
    it('returns null when the only player (who is host) departs', () => {
        const game = buildGame(['alice']);
        const result = migrateHost(game, 'alice');
        expect(result).toBeNull();
    });

    it('returns null when two players remain and both depart sequentially', () => {
        const game = buildGame(['alice', 'bob']);
        const afterAlice = migrateHost(game, 'alice'); // bob becomes host
        expect(afterAlice).not.toBeNull();
        const afterBob = migrateHost(afterAlice, 'bob'); // bob (now host) departs
        expect(afterBob).toBeNull();
    });
});

/* ═══════════════════════════════════════════════════════════════════
   SUITE 4 — State preservation
   ═══════════════════════════════════════════════════════════════════ */

describe('migrateHost — preserves game state', () => {
    it('deck is preserved after host migration', () => {
        const game = buildPlayingGame(['alice', 'bob', 'carol']);
        const deckBefore = game.deck;
        const updated = migrateHost(game, 'alice');
        expect(updated.deck).toEqual(deckBefore);
    });

    it('remaining player hands are preserved after host migration', () => {
        const game = buildPlayingGame(['alice', 'bob', 'carol']);
        const bobHandBefore = game.players.find(p => p.peer_id === 'bob').hand;
        const updated = migrateHost(game, 'alice');
        const bobHandAfter = updated.players.find(p => p.peer_id === 'bob').hand;
        expect(bobHandAfter).toEqual(bobHandBefore);
    });

    it('bets are preserved after non-host departure', () => {
        const game = buildPlayingGame(['alice', 'bob', 'carol']);
        const aliceBetBefore = game.players.find(p => p.peer_id === 'alice').bet;
        const updated = migrateHost(game, 'carol');
        const aliceBetAfter = updated.players.find(p => p.peer_id === 'alice').bet;
        expect(aliceBetAfter).toBe(aliceBetBefore);
    });

    it('phase is preserved after host migration mid-round (playing)', () => {
        const game = buildPlayingGame(['alice', 'bob']);
        expect(game.phase).toBe('playing');
        const updated = migrateHost(game, 'alice');
        expect(updated.phase).toBe('playing');
    });

    it('currentPlayerIndex is preserved after host migration', () => {
        const game = buildPlayingGame(['alice', 'bob', 'carol']);
        const indexBefore = game.currentPlayerIndex;
        const updated = migrateHost(game, 'alice');
        expect(updated.currentPlayerIndex).toBe(indexBefore);
    });

    it('roomId is preserved after host migration', () => {
        const game = buildGame(['alice', 'bob']);
        const updated = migrateHost(game, 'alice');
        expect(updated.roomId).toBe('room-1');
    });
});

/* ═══════════════════════════════════════════════════════════════════
   SUITE 5 — Phase-specific mid-round migration
   ═══════════════════════════════════════════════════════════════════ */

describe('migrateHost — phase=playing preserved', () => {
    it('game phase remains playing when host departs during play', () => {
        const game = buildPlayingGame(['alice', 'bob', 'carol']);
        const playing = { ...game, phase: 'playing' };
        const updated = migrateHost(playing, 'alice');
        expect(updated.phase).toBe('playing');
    });

    it('game phase remains dealer when host departs during dealer phase', () => {
        const game = buildGame(['alice', 'bob']);
        const dealerPhase = { ...game, phase: 'dealer' };
        const updated = migrateHost(dealerPhase, 'alice');
        expect(updated.phase).toBe('dealer');
    });

    it('game phase remains settlement when host departs during settlement', () => {
        const game = buildGame(['alice', 'bob']);
        const settlementPhase = { ...game, phase: 'settlement' };
        const updated = migrateHost(settlementPhase, 'alice');
        expect(updated.phase).toBe('settlement');
    });
});

/* ═══════════════════════════════════════════════════════════════════
   SUITE 6 — Unknown / edge case peer IDs
   ═══════════════════════════════════════════════════════════════════ */

describe('migrateHost — unknown peer ID', () => {
    it('returns game unchanged (same player count) when peerId not found', () => {
        const game = buildGame(['alice', 'bob', 'carol']);
        const updated = migrateHost(game, 'unknown-peer');
        expect(updated.players).toHaveLength(3);
    });

    it('host is unchanged when unknown peerId is passed', () => {
        const game = buildGame(['alice', 'bob']);
        const updated = migrateHost(game, 'nobody');
        expect(updated.hostPeerId).toBe('alice');
    });

    it('all original players are still present after unknown peer departure', () => {
        const game = buildGame(['alice', 'bob', 'carol']);
        const updated = migrateHost(game, 'ghost');
        const ids = updated.players.map(p => p.peer_id);
        expect(ids).toContain('alice');
        expect(ids).toContain('bob');
        expect(ids).toContain('carol');
    });
});

/* ═══════════════════════════════════════════════════════════════════
   SUITE 7 — Immutability (pure function)
   ═══════════════════════════════════════════════════════════════════ */

describe('migrateHost — pure function (no mutation)', () => {
    it('does not mutate the original game object', () => {
        const game = buildGame(['alice', 'bob', 'carol']);
        const originalPlayerCount = game.players.length;
        const originalHost = game.hostPeerId;
        migrateHost(game, 'alice');
        expect(game.players).toHaveLength(originalPlayerCount);
        expect(game.hostPeerId).toBe(originalHost);
    });

    it('does not mutate the original players array', () => {
        const game = buildGame(['alice', 'bob']);
        const originalPlayers = game.players;
        migrateHost(game, 'alice');
        expect(game.players).toBe(originalPlayers); // same reference
    });
});
