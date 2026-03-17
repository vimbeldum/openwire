/**
 * mystery.test.js
 *
 * Comprehensive test suite for the Murder Mystery game engine.
 * Covers: mystery.js core, mystery/scoring.js, mystery/clues.js, mystery/suspects.js
 *
 * Does NOT test UI components (MysteryBoard.jsx) — those are in browser/ tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Storage stubs ─────────────────────────────────────────── */
const _lsStore = new Map();
vi.stubGlobal('localStorage', {
    getItem: (k) => _lsStore.get(k) ?? null,
    setItem: (k, v) => _lsStore.set(k, String(v)),
    removeItem: (k) => _lsStore.delete(k),
    clear: () => _lsStore.clear(),
});
const _ssStore = new Map();
vi.stubGlobal('sessionStorage', {
    getItem: (k) => _ssStore.get(k) ?? null,
    setItem: (k, v) => _ssStore.set(k, String(v)),
    removeItem: (k) => _ssStore.delete(k),
    clear: () => _ssStore.clear(),
});

/* ── Deterministic crypto ──────────────────────────────────── */
vi.stubGlobal('crypto', {
    getRandomValues: (buf) => { buf.fill(0); return buf; },
    randomUUID: () => 'test-uuid-0000',
});

/* ── Imports under test ─────────────────────────────────────── */

// Core mystery engine
import {
    createMystery,
    addPlayer,
    removePlayer,
    advanceToDeliberation,
    advanceToAccusation,
    startInvestigation,
    addInterrogation,
    castVote,
    allPlayersVoted,
    reveal,
    newRound,
    migrateHost,
    serializeGame,
    deserializeGame,
    isMysteryMessage,
    parseMysteryAction,
    serializeMysteryAction,
    MysteryEngine,
    MYSTERY_RULES,
    INVESTIGATION_DURATION_MS,
    DELIBERATION_DURATION_MS,
    ACCUSATION_DURATION_MS,
    MIN_PLAYERS,
    MAX_PLAYERS,
} from '../lib/mystery.js';

// Sub-modules
import { SCORING, calculateScores } from '../lib/mystery/scoring.js';
import { distributeClues, getClueForPlayer } from '../lib/mystery/clues.js';
import { buildSuspectPrompt, sanitizeSuspects } from '../lib/mystery/suspects.js';

/* ── Helpers ────────────────────────────────────────────────── */

function makeLobbyGame() {
    let g = createMystery('room-1', 'host-peer');
    g = addPlayer(g, 'host-peer', 'Alice');
    g = addPlayer(g, 'peer-2', 'Bob');
    g = addPlayer(g, 'peer-3', 'Charlie');
    return g;
}

function makeInvestigationGame() {
    const g = makeLobbyGame();
    // Manually set phase to investigation with mock mystery data
    return {
        ...g,
        phase: 'investigation',
        mystery: {
            id: 'test-mystery-1',
            title: 'The Garden Murder',
            setting: 'A moonlit garden party',
            victim: { name: 'Victor' },
            weapon: 'Poison',
            motive: 'Greed',
            culpritId: 'suspect_0',
        },
        suspects: [
            {
                id: 'suspect_0', name: 'Rosa', role: 'gardener',
                personality: 'nervous', backstory: 'gardener for 10 years',
                alibi: 'I was watering plants', secret: 'I stole the jewels',
                relationshipToVictim: 'employee',
                isCulprit: true,
                _systemPrompt: 'test-prompt',
                _secretConstraints: ['never admit guilt'],
                _crossClues: ['[About Marco]: saw him near the shed'],
                _conversationHistory: [],
            },
            {
                id: 'suspect_1', name: 'Marco', role: 'chef',
                personality: 'brash', backstory: 'hired last month',
                alibi: 'I was cooking', secret: 'I was embezzling',
                relationshipToVictim: 'acquaintance',
                isCulprit: false,
                _systemPrompt: 'test-prompt-2',
                _secretConstraints: [],
                _crossClues: [],
                _conversationHistory: [],
            },
        ],
        phaseStartedAt: Date.now(),
        phaseDuration: INVESTIGATION_DURATION_MS,
    };
}

function makeAccusationGame() {
    const g = makeInvestigationGame();
    const g2 = advanceToDeliberation(g);
    return advanceToAccusation(g2);
}

/* ═══════════════════════════════════════════════════════════════
   SECTION A — MYSTERY ENGINE CORE (mystery.js)
   ═══════════════════════════════════════════════════════════════ */

describe('A1 — createMystery: initial state shape', () => {
    it('returns an object with type mystery', () => {
        const g = createMystery('room-1', 'host-1');
        expect(g.type).toBe('mystery');
    });

    it('starts in lobby phase', () => {
        const g = createMystery('room-1', 'host-1');
        expect(g.phase).toBe('lobby');
    });

    it('has correct roomId and hostPeerId', () => {
        const g = createMystery('room-x', 'host-x');
        expect(g.roomId).toBe('room-x');
        expect(g.hostPeerId).toBe('host-x');
    });

    it('starts with empty players array', () => {
        const g = createMystery('room-1', 'host-1');
        expect(g.players).toEqual([]);
    });

    it('starts with null mystery and empty suspects', () => {
        const g = createMystery('room-1', 'host-1');
        expect(g.mystery).toBeNull();
        expect(g.suspects).toEqual([]);
    });

    it('starts with empty interrogations and null results', () => {
        const g = createMystery('room-1', 'host-1');
        expect(g.interrogations).toEqual([]);
        expect(g.results).toBeNull();
    });

    it('uses default durations when no config provided', () => {
        const g = createMystery('room-1', 'host-1');
        expect(g.investigationDurationMs).toBe(INVESTIGATION_DURATION_MS);
        expect(g.deliberationDurationMs).toBe(DELIBERATION_DURATION_MS);
        expect(g.accusationDurationMs).toBe(ACCUSATION_DURATION_MS);
    });

    it('allows custom duration overrides', () => {
        const g = createMystery('room-1', 'host-1', {
            investigationDurationMs: 5000,
            deliberationDurationMs: 3000,
            accusationDurationMs: 1000,
        });
        expect(g.investigationDurationMs).toBe(5000);
        expect(g.deliberationDurationMs).toBe(3000);
        expect(g.accusationDurationMs).toBe(1000);
    });
});

describe('A2 — addPlayer', () => {
    it('adds a player to lobby game', () => {
        let g = createMystery('room-1', 'host-1');
        g = addPlayer(g, 'peer-1', 'Alice');
        expect(g.players).toHaveLength(1);
        expect(g.players[0].peer_id).toBe('peer-1');
        expect(g.players[0].nick).toBe('Alice');
    });

    it('initializes score and vote to defaults', () => {
        let g = createMystery('room-1', 'host-1');
        g = addPlayer(g, 'peer-1', 'Alice');
        expect(g.players[0].score).toBe(0);
        expect(g.players[0].vote).toBeNull();
        expect(g.players[0].votedAt).toBeNull();
    });

    it('prevents duplicate players', () => {
        let g = createMystery('room-1', 'host-1');
        g = addPlayer(g, 'peer-1', 'Alice');
        g = addPlayer(g, 'peer-1', 'Alice-duplicate');
        expect(g.players).toHaveLength(1);
    });

    it('rejects players when not in lobby', () => {
        const g = makeInvestigationGame();
        const g2 = addPlayer(g, 'peer-new', 'NewPlayer');
        expect(g2.players).toHaveLength(g.players.length);
    });

    it('enforces MAX_PLAYERS limit', () => {
        let g = createMystery('room-1', 'host-1');
        for (let i = 0; i < MAX_PLAYERS + 2; i++) {
            g = addPlayer(g, `peer-${i}`, `Player${i}`);
        }
        expect(g.players).toHaveLength(MAX_PLAYERS);
    });
});

describe('A3 — removePlayer', () => {
    it('removes an existing player', () => {
        let g = makeLobbyGame();
        expect(g.players).toHaveLength(3);
        g = removePlayer(g, 'peer-2');
        expect(g.players).toHaveLength(2);
        expect(g.players.find(p => p.peer_id === 'peer-2')).toBeUndefined();
    });

    it('no-op for non-existent player', () => {
        const g = makeLobbyGame();
        const g2 = removePlayer(g, 'peer-nonexistent');
        expect(g2.players).toHaveLength(3);
    });
});

describe('A4 — Phase transitions', () => {
    it('startInvestigation resets timer on investigation phase', () => {
        const g = makeInvestigationGame();
        const before = g.phaseStartedAt;
        const g2 = startInvestigation(g);
        expect(g2.phase).toBe('investigation');
        expect(g2.phaseDuration).toBe(g.investigationDurationMs);
    });

    it('startInvestigation is no-op if not in investigation phase', () => {
        const g = makeLobbyGame();
        const g2 = startInvestigation(g);
        expect(g2).toBe(g);
    });

    it('advanceToDeliberation transitions from investigation', () => {
        const g = makeInvestigationGame();
        const g2 = advanceToDeliberation(g);
        expect(g2.phase).toBe('deliberation');
        expect(g2.phaseDuration).toBe(g.deliberationDurationMs);
    });

    it('advanceToDeliberation is no-op if not in investigation', () => {
        const g = makeLobbyGame();
        const g2 = advanceToDeliberation(g);
        expect(g2).toBe(g);
    });

    it('advanceToAccusation transitions from deliberation', () => {
        const g = makeInvestigationGame();
        const g2 = advanceToDeliberation(g);
        const g3 = advanceToAccusation(g2);
        expect(g3.phase).toBe('accusation');
        expect(g3.phaseDuration).toBe(g.accusationDurationMs);
    });

    it('advanceToAccusation is no-op if not in deliberation', () => {
        const g = makeInvestigationGame();
        const g2 = advanceToAccusation(g);
        expect(g2).toBe(g);
    });
});

describe('A5 — addInterrogation', () => {
    it('adds a player message during investigation', () => {
        const g = makeInvestigationGame();
        const g2 = addInterrogation(g, 'Alice', 'suspect_0', 'Where were you?', 'player');
        expect(g2.interrogations).toHaveLength(1);
        expect(g2.interrogations[0].sender).toBe('Alice');
        expect(g2.interrogations[0].suspectId).toBe('suspect_0');
        expect(g2.interrogations[0].senderType).toBe('player');
        expect(g2.interrogations[0].content).toBe('Where were you?');
    });

    it('adds a suspect response during investigation', () => {
        const g = makeInvestigationGame();
        const g2 = addInterrogation(g, 'Rosa', 'suspect_0', 'I was in the garden.', 'suspect');
        expect(g2.interrogations[0].senderType).toBe('suspect');
    });

    it('works during deliberation phase', () => {
        const g = makeInvestigationGame();
        const g2 = advanceToDeliberation(g);
        const g3 = addInterrogation(g2, 'Alice', null, 'I think it was Rosa', 'player');
        expect(g3.interrogations).toHaveLength(1);
    });

    it('rejects messages during lobby or accusation', () => {
        const lobby = makeLobbyGame();
        const lobby2 = addInterrogation(lobby, 'Alice', null, 'test', 'player');
        expect(lobby2).toBe(lobby);

        const accuse = makeAccusationGame();
        const accuse2 = addInterrogation(accuse, 'Alice', null, 'test', 'player');
        expect(accuse2).toBe(accuse);
    });

    it('caps interrogation log at 200 entries', () => {
        let g = makeInvestigationGame();
        for (let i = 0; i < 210; i++) {
            g = addInterrogation(g, 'Alice', 'suspect_0', `Q${i}`, 'player');
        }
        expect(g.interrogations.length).toBeLessThanOrEqual(200);
    });

    it('tracks isRevised flag', () => {
        const g = makeInvestigationGame();
        const g2 = addInterrogation(g, 'Rosa', 'suspect_0', 'Revised answer', 'suspect', true);
        expect(g2.interrogations[0].isRevised).toBe(true);
    });

    it('sets suspectId to null when not provided', () => {
        const g = makeInvestigationGame();
        const g2 = addInterrogation(g, 'Alice', null, 'General discussion', 'player');
        expect(g2.interrogations[0].suspectId).toBeNull();
    });
});

describe('A6 — castVote', () => {
    it('records a vote during accusation phase', () => {
        const g = makeAccusationGame();
        const g2 = castVote(g, 'host-peer', 'suspect_0');
        const voter = g2.players.find(p => p.peer_id === 'host-peer');
        expect(voter.vote).toBe('suspect_0');
        expect(voter.votedAt).toBeTypeOf('number');
    });

    it('rejects votes outside accusation phase', () => {
        const g = makeInvestigationGame();
        const g2 = castVote(g, 'host-peer', 'suspect_0');
        expect(g2).toBe(g);
    });

    it('rejects votes for non-existent suspects', () => {
        const g = makeAccusationGame();
        const g2 = castVote(g, 'host-peer', 'suspect_999');
        const voter = g2.players.find(p => p.peer_id === 'host-peer');
        expect(voter.vote).toBeNull();
    });

    it('allows changing vote', () => {
        const g = makeAccusationGame();
        const g2 = castVote(g, 'host-peer', 'suspect_0');
        const g3 = castVote(g2, 'host-peer', 'suspect_1');
        const voter = g3.players.find(p => p.peer_id === 'host-peer');
        expect(voter.vote).toBe('suspect_1');
    });
});

describe('A7 — allPlayersVoted', () => {
    it('returns false when no votes cast', () => {
        const g = makeAccusationGame();
        expect(allPlayersVoted(g)).toBe(false);
    });

    it('returns false when some players have not voted', () => {
        let g = makeAccusationGame();
        g = castVote(g, 'host-peer', 'suspect_0');
        expect(allPlayersVoted(g)).toBe(false);
    });

    it('returns true when all players have voted', () => {
        let g = makeAccusationGame();
        g = castVote(g, 'host-peer', 'suspect_0');
        g = castVote(g, 'peer-2', 'suspect_1');
        g = castVote(g, 'peer-3', 'suspect_0');
        expect(allPlayersVoted(g)).toBe(true);
    });
});

describe('A8 — reveal', () => {
    it('transitions to reveal phase and calculates scores', () => {
        let g = makeAccusationGame();
        g = castVote(g, 'host-peer', 'suspect_0'); // correct
        g = castVote(g, 'peer-2', 'suspect_1');     // wrong
        g = castVote(g, 'peer-3', 'suspect_0');     // correct
        const g2 = reveal(g);
        expect(g2.phase).toBe('reveal');
        expect(g2.results).toBeDefined();
        expect(g2.results.correctVoters).toContain('host-peer');
        expect(g2.results.correctVoters).toContain('peer-3');
        expect(g2.results.correctVoters).not.toContain('peer-2');
    });

    it('rejects reveal outside accusation phase', () => {
        const g = makeInvestigationGame();
        const g2 = reveal(g);
        expect(g2).toBe(g);
    });

    it('assigns scores to player objects', () => {
        let g = makeAccusationGame();
        g = castVote(g, 'host-peer', 'suspect_0');
        const g2 = reveal(g);
        const alice = g2.players.find(p => p.peer_id === 'host-peer');
        expect(alice.score).toBeGreaterThan(0);
    });
});

describe('A9 — newRound', () => {
    it('resets game back to lobby phase', () => {
        let g = makeAccusationGame();
        g = castVote(g, 'host-peer', 'suspect_0');
        const revealed = reveal(g);
        const fresh = newRound(revealed);
        expect(fresh.phase).toBe('lobby');
        expect(fresh.mystery).toBeNull();
        expect(fresh.suspects).toEqual([]);
        expect(fresh.interrogations).toEqual([]);
        expect(fresh.results).toBeNull();
    });

    it('preserves players but resets their scores and votes', () => {
        let g = makeAccusationGame();
        g = castVote(g, 'host-peer', 'suspect_0');
        const revealed = reveal(g);
        const fresh = newRound(revealed);
        expect(fresh.players).toHaveLength(3);
        fresh.players.forEach(p => {
            expect(p.score).toBe(0);
            expect(p.vote).toBeNull();
        });
    });

    it('preserves custom durations', () => {
        let g = createMystery('room-1', 'host-1', {
            investigationDurationMs: 5000,
            deliberationDurationMs: 3000,
            accusationDurationMs: 1000,
        });
        g = addPlayer(g, 'host-1', 'Alice');
        // Force into a state we can newRound from
        g = { ...g, phase: 'accusation', mystery: { culpritId: 'x' }, suspects: [{ id: 'x' }] };
        const fresh = newRound(g);
        expect(fresh.investigationDurationMs).toBe(5000);
    });
});

describe('A10 — migrateHost', () => {
    it('promotes next player when host leaves', () => {
        const g = makeLobbyGame();
        const g2 = migrateHost(g, 'host-peer');
        expect(g2.hostPeerId).toBe('peer-2');
        expect(g2.players).toHaveLength(2);
    });

    it('returns null when no players remain', () => {
        let g = createMystery('room-1', 'host-1');
        g = addPlayer(g, 'host-1', 'Alice');
        const result = migrateHost(g, 'host-1');
        expect(result).toBeNull();
    });

    it('only removes player when non-host leaves', () => {
        const g = makeLobbyGame();
        const g2 = migrateHost(g, 'peer-2');
        expect(g2.hostPeerId).toBe('host-peer');
        expect(g2.players).toHaveLength(2);
    });

    it('rebuilds suspect prompts when host changes mid-investigation', () => {
        const g = makeInvestigationGame();
        const g2 = migrateHost(g, 'host-peer');
        expect(g2.hostPeerId).toBe('peer-2');
        // Suspect prompts should be rebuilt
        expect(g2.suspects[0]._systemPrompt).toContain('Rosa');
    });
});

describe('A11 — Serialization', () => {
    it('serializeGame strips AI-only fields', () => {
        const g = makeInvestigationGame();
        const json = serializeGame(g);
        const parsed = JSON.parse(json);
        expect(parsed.suspects[0]._systemPrompt).toBeUndefined();
        expect(parsed.suspects[0]._secretConstraints).toBeUndefined();
        expect(parsed.suspects[0]._crossClues).toBeUndefined();
    });

    it('serializeGame preserves safe suspect fields', () => {
        const g = makeInvestigationGame();
        const json = serializeGame(g);
        const parsed = JSON.parse(json);
        expect(parsed.suspects[0].name).toBe('Rosa');
        expect(parsed.suspects[0].id).toBe('suspect_0');
    });

    it('deserializeGame parses valid JSON', () => {
        const g = makeInvestigationGame();
        const json = serializeGame(g);
        const result = deserializeGame(json);
        expect(result.type).toBe('mystery');
    });

    it('deserializeGame handles object input', () => {
        const g = makeInvestigationGame();
        const result = deserializeGame(g);
        expect(result).toBe(g);
    });

    it('deserializeGame returns null for invalid JSON', () => {
        expect(deserializeGame('not-json{')).toBeNull();
    });
});

describe('A12 — Wire protocol', () => {
    it('isMysteryMessage detects MM: prefix', () => {
        expect(isMysteryMessage('MM:{"action":"vote"}')).toBe(true);
        expect(isMysteryMessage('RL:{"action":"bet"}')).toBe(false);
        expect(isMysteryMessage(42)).toBe(false);
        expect(isMysteryMessage(null)).toBe(false);
    });

    it('serializeMysteryAction produces MM: prefixed JSON', () => {
        const action = { action: 'vote', suspectId: 'suspect_0' };
        const wire = serializeMysteryAction(action);
        expect(wire.startsWith('MM:')).toBe(true);
        expect(JSON.parse(wire.slice(3))).toEqual(action);
    });

    it('parseMysteryAction extracts action from wire format', () => {
        const wire = 'MM:{"action":"interrogate","text":"hello"}';
        const result = parseMysteryAction(wire);
        expect(result.action).toBe('interrogate');
        expect(result.text).toBe('hello');
    });

    it('parseMysteryAction returns null for non-MM messages', () => {
        expect(parseMysteryAction('RL:{"x":1}')).toBeNull();
    });

    it('parseMysteryAction returns null for invalid JSON', () => {
        expect(parseMysteryAction('MM:{bad')).toBeNull();
    });
});

describe('A13 — MysteryEngine class', () => {
    it('getGameState returns internal state', () => {
        const g = makeInvestigationGame();
        const engine = new MysteryEngine(g);
        expect(engine.getGameState()).toBe(g);
    });

    it('calculatePayout returns empty object (non-financial)', () => {
        const g = makeInvestigationGame();
        const engine = new MysteryEngine(g);
        expect(engine.calculatePayout([], {})).toEqual({});
    });

    it('getRules returns MYSTERY_RULES', () => {
        const g = makeInvestigationGame();
        const engine = new MysteryEngine(g);
        const rules = engine.getRules();
        expect(rules.name).toBe('Murder Mystery');
        expect(rules.bets).toHaveLength(4);
    });

    it('calculateResults returns NonFinancialEvent', () => {
        let g = makeAccusationGame();
        g = castVote(g, 'host-peer', 'suspect_0');
        g = castVote(g, 'peer-2', 'suspect_1');
        g = castVote(g, 'peer-3', 'suspect_0');
        const revealed = reveal(g);
        const engine = new MysteryEngine(revealed);
        const event = engine.calculateResults(revealed);
        expect(event.gameType).toBe('mystery');
        expect(event.playerStats).toHaveLength(3);
        // Alice voted correctly
        const aliceStat = event.playerStats.find(s => s.peer_id === 'host-peer');
        expect(aliceStat.outcome).toBe('win');
        // Bob voted wrong
        const bobStat = event.playerStats.find(s => s.peer_id === 'peer-2');
        expect(bobStat.outcome).toBe('loss');
    });
});

describe('A14 — Constants', () => {
    it('INVESTIGATION_DURATION_MS is 10 minutes', () => {
        expect(INVESTIGATION_DURATION_MS).toBe(10 * 60 * 1000);
    });
    it('DELIBERATION_DURATION_MS is 3 minutes', () => {
        expect(DELIBERATION_DURATION_MS).toBe(3 * 60 * 1000);
    });
    it('ACCUSATION_DURATION_MS is 2 minutes', () => {
        expect(ACCUSATION_DURATION_MS).toBe(2 * 60 * 1000);
    });
    it('MIN_PLAYERS is 1', () => {
        expect(MIN_PLAYERS).toBe(1);
    });
    it('MAX_PLAYERS is 12', () => {
        expect(MAX_PLAYERS).toBe(12);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SECTION B — SCORING (mystery/scoring.js)
   ═══════════════════════════════════════════════════════════════ */

describe('B1 — SCORING constants', () => {
    it('correctAccusation is 100', () => {
        expect(SCORING.correctAccusation).toBe(100);
    });
    it('questionsAskedBonus is 2', () => {
        expect(SCORING.questionsAskedBonus).toBe(2);
    });
    it('uniqueSuspectsBonus is 10', () => {
        expect(SCORING.uniqueSuspectsBonus).toBe(10);
    });
    it('earlyVoteBonus is 25', () => {
        expect(SCORING.earlyVoteBonus).toBe(25);
    });
});

describe('B2 — calculateScores', () => {
    it('awards correctAccusation for correct vote', () => {
        const game = {
            mystery: { culpritId: 'suspect_0' },
            players: [
                { peer_id: 'p1', nick: 'Alice', vote: 'suspect_0', votedAt: Date.now() },
            ],
            interrogations: [],
            accusationDurationMs: 120000,
            phaseStartedAt: Date.now(),
        };
        const result = calculateScores(game);
        expect(result.scores.p1).toBeGreaterThanOrEqual(SCORING.correctAccusation);
        expect(result.correctVoters).toContain('p1');
    });

    it('gives 0 for wrong vote', () => {
        const game = {
            mystery: { culpritId: 'suspect_0' },
            players: [
                { peer_id: 'p1', nick: 'Alice', vote: 'suspect_1', votedAt: Date.now() },
            ],
            interrogations: [],
            accusationDurationMs: 120000,
            phaseStartedAt: Date.now(),
        };
        const result = calculateScores(game);
        expect(result.scores.p1).toBe(0);
        expect(result.correctVoters).not.toContain('p1');
    });

    it('awards questions asked bonus', () => {
        const game = {
            mystery: { culpritId: 'suspect_0' },
            players: [
                { peer_id: 'p1', nick: 'Alice', vote: 'suspect_1', votedAt: Date.now() },
            ],
            interrogations: [
                { senderType: 'player', sender: 'Alice', suspectId: 'suspect_0' },
                { senderType: 'player', sender: 'Alice', suspectId: 'suspect_0' },
                { senderType: 'player', sender: 'Alice', suspectId: 'suspect_1' },
            ],
            accusationDurationMs: 120000,
            phaseStartedAt: Date.now(),
        };
        const result = calculateScores(game);
        // 3 questions * 2 = 6, plus 2 unique suspects * 10 = 20
        expect(result.scores.p1).toBe(3 * SCORING.questionsAskedBonus + 2 * SCORING.uniqueSuspectsBonus);
        expect(result.totalQuestions.p1).toBe(3);
    });

    it('awards early vote bonus when voted in first half', () => {
        const now = Date.now();
        const game = {
            mystery: { culpritId: 'suspect_0' },
            players: [
                { peer_id: 'p1', nick: 'Alice', vote: 'suspect_0', votedAt: now + 10000 },
            ],
            interrogations: [],
            accusationDurationMs: 120000,
            phaseStartedAt: now,
        };
        const result = calculateScores(game);
        expect(result.scores.p1).toBe(SCORING.correctAccusation + SCORING.earlyVoteBonus);
    });

    it('no early vote bonus when voted in second half', () => {
        const now = Date.now();
        const game = {
            mystery: { culpritId: 'suspect_0' },
            players: [
                { peer_id: 'p1', nick: 'Alice', vote: 'suspect_0', votedAt: now + 100000 },
            ],
            interrogations: [],
            accusationDurationMs: 120000,
            phaseStartedAt: now,
        };
        const result = calculateScores(game);
        expect(result.scores.p1).toBe(SCORING.correctAccusation);
    });

    it('handles null mystery culpritId gracefully', () => {
        const game = {
            mystery: {},
            players: [{ peer_id: 'p1', nick: 'Alice', vote: 'suspect_0' }],
            interrogations: [],
        };
        const result = calculateScores(game);
        expect(result.scores.p1).toBe(0);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SECTION C — CLUE DISTRIBUTION (mystery/clues.js)
   ═══════════════════════════════════════════════════════════════ */

describe('C1 — distributeClues', () => {
    it('distributes cross-clues to correct suspects', () => {
        const template = {
            suspects: [
                { name: 'Rosa', _crossClues: [] },
                { name: 'Marco', _crossClues: [] },
            ],
            crossClues: [
                ['saw blood on hands', 0, 1], // Rosa knows this about Marco
            ],
        };
        const result = distributeClues(template);
        expect(result[0]._crossClues).toHaveLength(1);
        expect(result[0]._crossClues[0]).toContain('About Marco');
        expect(result[0]._crossClues[0]).toContain('saw blood on hands');
        expect(result[1]._crossClues).toHaveLength(0);
    });

    it('handles empty crossClues array', () => {
        const template = {
            suspects: [{ name: 'Rosa', _crossClues: [] }],
            crossClues: [],
        };
        const result = distributeClues(template);
        expect(result[0]._crossClues).toHaveLength(0);
    });

    it('skips out-of-bounds indices', () => {
        const template = {
            suspects: [{ name: 'Rosa' }],
            crossClues: [['clue', 5, 0]], // fromIdx 5 is out of bounds
        };
        const result = distributeClues(template);
        expect(result[0]._crossClues).toHaveLength(0);
    });

    it('handles undefined crossClues', () => {
        const template = {
            suspects: [{ name: 'Rosa' }],
        };
        const result = distributeClues(template);
        expect(result[0]._crossClues).toHaveLength(0);
    });

    it('preserves existing _crossClues', () => {
        const template = {
            suspects: [
                { name: 'Rosa', _crossClues: ['existing clue'] },
            ],
            crossClues: [['new clue', 0, 0]],
        };
        const result = distributeClues(template);
        expect(result[0]._crossClues).toHaveLength(2);
        expect(result[0]._crossClues[0]).toBe('existing clue');
    });
});

describe('C2 — getClueForPlayer', () => {
    it('returns clue when question mentions target suspect name', () => {
        const suspect = {
            _crossClues: ['[About Marco]: He was near the shed at midnight'],
        };
        const result = getClueForPlayer(suspect, 'What do you know about Marco?');
        expect(result).toContain('Marco');
    });

    it('returns clue on keyword overlap', () => {
        const suspect = {
            _crossClues: ['[About Rosa]: She had blood on her garden gloves after dinner'],
        };
        const result = getClueForPlayer(suspect, 'Tell me about the blood and the garden');
        expect(result).toContain('Rosa');
    });

    it('returns null when no clues match', () => {
        const suspect = {
            _crossClues: ['[About Marco]: He was cooking all night'],
        };
        const result = getClueForPlayer(suspect, 'What is the weather like?');
        expect(result).toBeNull();
    });

    it('returns null for empty cross-clues', () => {
        expect(getClueForPlayer({ _crossClues: [] }, 'question')).toBeNull();
    });

    it('returns null for null/undefined suspect clues', () => {
        expect(getClueForPlayer({}, 'question')).toBeNull();
        expect(getClueForPlayer({ _crossClues: null }, 'question')).toBeNull();
    });

    it('returns null for empty or invalid question', () => {
        const suspect = { _crossClues: ['[About Marco]: test'] };
        expect(getClueForPlayer(suspect, '')).toBeNull();
        expect(getClueForPlayer(suspect, null)).toBeNull();
        expect(getClueForPlayer(suspect, 42)).toBeNull();
    });
});

/* ═══════════════════════════════════════════════════════════════
   SECTION D — SUSPECTS (mystery/suspects.js)
   ═══════════════════════════════════════════════════════════════ */

describe('D1 — buildSuspectPrompt', () => {
    const suspect = {
        name: 'Rosa',
        role: 'gardener',
        personality: 'nervous',
        backstory: 'worked for 10 years',
        alibi: 'watering plants',
        secret: 'stole jewels',
        relationshipToVictim: 'employee',
        isCulprit: true,
        secretConstraints: ['never confess'],
        _crossClues: ['[About Marco]: saw him near shed'],
    };
    const mystery = {
        title: 'Garden Murder',
        setting: 'moonlit garden',
        victim: { name: 'Victor' },
        weapon: 'Poison',
        motive: 'Greed',
    };

    it('includes suspect name and role', () => {
        const prompt = buildSuspectPrompt(suspect, mystery);
        expect(prompt).toContain('Rosa');
        expect(prompt).toContain('gardener');
    });

    it('includes mystery title and setting', () => {
        const prompt = buildSuspectPrompt(suspect, mystery);
        expect(prompt).toContain('Garden Murder');
        expect(prompt).toContain('moonlit garden');
    });

    it('includes culprit-specific text for guilty suspect', () => {
        const prompt = buildSuspectPrompt(suspect, mystery);
        expect(prompt).toContain('You ARE the murderer');
        expect(prompt).toContain('Poison');
        expect(prompt).toContain('Greed');
    });

    it('includes innocent text for non-culprit suspect', () => {
        const innocentSuspect = { ...suspect, isCulprit: false };
        const prompt = buildSuspectPrompt(innocentSuspect, mystery);
        expect(prompt).toContain('You are INNOCENT');
        expect(prompt).not.toContain('You ARE the murderer');
    });

    it('includes secret constraints', () => {
        const prompt = buildSuspectPrompt(suspect, mystery);
        expect(prompt).toContain('never confess');
    });

    it('includes cross-clues', () => {
        const prompt = buildSuspectPrompt(suspect, mystery);
        expect(prompt).toContain('About Marco');
    });

    it('includes behavioral rules', () => {
        const prompt = buildSuspectPrompt(suspect, mystery);
        expect(prompt).toContain('Stay fully in character');
        expect(prompt).toContain('Hindi');
    });
});

describe('D2 — sanitizeSuspects', () => {
    it('removes _-prefixed AI fields', () => {
        const suspects = [{
            id: 'suspect_0',
            name: 'Rosa',
            _systemPrompt: 'secret prompt',
            _secretConstraints: ['x'],
            _crossClues: ['y'],
            _conversationHistory: ['z'],
        }];
        const safe = sanitizeSuspects(suspects);
        expect(safe[0].id).toBe('suspect_0');
        expect(safe[0].name).toBe('Rosa');
        expect(safe[0]._systemPrompt).toBeUndefined();
        expect(safe[0]._secretConstraints).toBeUndefined();
        expect(safe[0]._crossClues).toBeUndefined();
        expect(safe[0]._conversationHistory).toBeUndefined();
    });

    it('handles null/undefined input', () => {
        expect(sanitizeSuspects(null)).toEqual([]);
        expect(sanitizeSuspects(undefined)).toEqual([]);
    });

    it('handles empty array', () => {
        expect(sanitizeSuspects([])).toEqual([]);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SECTION E — MYSTERY_RULES shape
   ═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════
   SECTION E — ASYNC: generateMystery / generateMysteryFromScenario
   ═══════════════════════════════════════════════════════════════ */

import { generateMystery, generateMysteryFromScenario } from '../lib/mystery.js';

describe('E0 — generateMystery (async)', () => {
    it('generates a mystery from random template', async () => {
        const lobby = makeLobbyGame();
        const result = await generateMystery(lobby);
        expect(result.phase).toBe('investigation');
        expect(result.mystery).toBeDefined();
        expect(result.mystery.title).toBeTruthy();
        expect(result.suspects.length).toBeGreaterThan(0);
        expect(result.suspects[0]._systemPrompt).toBeTruthy();
    });

    it('generates a mystery from specific template ID', async () => {
        const lobby = makeLobbyGame();
        const result = await generateMystery(lobby, 'vineyard_manor');
        expect(result.phase).toBe('investigation');
        expect(result.mystery.title).toContain('Vineyard');
    });

    it('falls back to random template for invalid template ID', async () => {
        const lobby = makeLobbyGame();
        const result = await generateMystery(lobby, 'nonexistent_template_xyz');
        expect(result.phase).toBe('investigation');
        expect(result.mystery).toBeDefined();
    });

    it('returns game unchanged if not in lobby phase', async () => {
        const investigation = makeInvestigationGame();
        const result = await generateMystery(investigation);
        expect(result).toBe(investigation);
    });

    it('sets correct culprit in suspects', async () => {
        const lobby = makeLobbyGame();
        const result = await generateMystery(lobby);
        const culprit = result.suspects.find(s => s.isCulprit);
        expect(culprit).toBeDefined();
        expect(culprit.id).toBe(result.mystery.culpritId);
    });

    it('distributes cross-clues to suspects', async () => {
        const lobby = makeLobbyGame();
        const result = await generateMystery(lobby);
        // At least some suspects should have cross-clues
        const withClues = result.suspects.filter(s => s._crossClues && s._crossClues.length > 0);
        expect(withClues.length).toBeGreaterThan(0);
    });
});

describe('E0b — generateMysteryFromScenario (async)', () => {
    const mockScenario = {
        title: 'Custom Mystery',
        setting: 'A dark alley',
        victim: { name: 'John' },
        weapon: 'knife',
        motive: 'revenge',
        culpritIndex: 0,
        suspects: [
            { name: 'Suspect A', role: 'thief', personality: 'sneaky', backstory: 'came from nowhere', alibi: 'was sleeping', secret: 'stole money', relationshipToVictim: 'enemy' },
            { name: 'Suspect B', role: 'guard', personality: 'stoic', backstory: 'long career', alibi: 'on patrol', secret: 'saw something', relationshipToVictim: 'colleague' },
        ],
        crossClues: [['heard screaming', 0, 1]],
    };

    it('generates mystery from custom scenario', async () => {
        const lobby = makeLobbyGame();
        const result = await generateMysteryFromScenario(lobby, mockScenario);
        expect(result.phase).toBe('investigation');
        expect(result.mystery.title).toBe('Custom Mystery');
        expect(result.suspects.length).toBe(2);
    });

    it('returns game unchanged if not in lobby', async () => {
        const investigation = makeInvestigationGame();
        const result = await generateMysteryFromScenario(investigation, mockScenario);
        expect(result).toBe(investigation);
    });

    it('marks correct culprit from scenario', async () => {
        const lobby = makeLobbyGame();
        const result = await generateMysteryFromScenario(lobby, mockScenario);
        expect(result.suspects[0].isCulprit).toBe(true);
        expect(result.suspects[1].isCulprit).toBe(false);
    });
});

describe('E0c — getTemplates', () => {
    it('returns an array of templates', async () => {
        const { getTemplates } = await import('../lib/mystery/templates.js');
        const templates = getTemplates();
        expect(Array.isArray(templates)).toBe(true);
        expect(templates.length).toBeGreaterThan(0);
        expect(templates[0]).toHaveProperty('id');
        expect(templates[0]).toHaveProperty('title');
    });
});

describe('E1 — MYSTERY_RULES', () => {
    it('has name "Murder Mystery"', () => {
        expect(MYSTERY_RULES.name).toBe('Murder Mystery');
    });

    it('has a description string', () => {
        expect(typeof MYSTERY_RULES.description).toBe('string');
        expect(MYSTERY_RULES.description.length).toBeGreaterThan(20);
    });

    it('has 4 bet/scoring entries', () => {
        expect(MYSTERY_RULES.bets).toHaveLength(4);
        MYSTERY_RULES.bets.forEach(b => {
            expect(b).toHaveProperty('name');
            expect(b).toHaveProperty('odds');
            expect(b).toHaveProperty('description');
        });
    });
});
