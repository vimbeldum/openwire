/* ═══════════════════════════════════════════════════════════
   OpenWire — Murder Mystery Game Engine
   Bounded Context: MurderMystery | Shared Core: GameEngine
   Pure functions, immutable state. Host peer runs transitions
   and broadcasts state to other peers via socket.sendRoomMessage().
   ═══════════════════════════════════════════════════════════ */

import { GameEngine, registerGame } from './GameEngine.js';
import { createNonFinancialEvent } from './core/PayoutEvent.js';
import { pickRandomTemplate, getTemplateById } from './mystery/templates.js';
import { buildSuspectPrompt, sanitizeSuspects } from './mystery/suspects.js';
import { distributeClues } from './mystery/clues.js';
import { calculateScores, SCORING } from './mystery/scoring.js';

/* ── Constants ────────────────────────────────────────────── */

export const INVESTIGATION_DURATION_MS = 10 * 60 * 1000; // 10 min
export const DELIBERATION_DURATION_MS  = 3 * 60 * 1000;  // 3 min
export const ACCUSATION_DURATION_MS    = 2 * 60 * 1000;   // 2 min
export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 12;

/* ── Unique ID generator ─────────────────────────────────── */

function uid() {
    return (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/* ── Create Game ──────────────────────────────────────────── */

/**
 * Create a new mystery game in the lobby phase.
 * @param {string} roomId
 * @param {string} hostPeerId
 * @param {object} [config]  Optional duration overrides
 * @returns {object}  Initial game state
 */
export function createMystery(roomId, hostPeerId, config = {}) {
    return {
        type: 'mystery',
        roomId,
        hostPeerId,
        phase: 'lobby',

        mystery: null,
        suspects: [],
        players: [],

        phaseStartedAt: Date.now(),
        phaseDuration: 0,
        investigationDurationMs: config.investigationDurationMs || INVESTIGATION_DURATION_MS,
        deliberationDurationMs:  config.deliberationDurationMs  || DELIBERATION_DURATION_MS,
        accusationDurationMs:    config.accusationDurationMs    || ACCUSATION_DURATION_MS,

        interrogations: [],
        results: null,
        createdAt: Date.now(),
    };
}

/* ── Player Management ────────────────────────────────────── */

/**
 * Add a player to the game.
 * @param {object} game
 * @param {string} peer_id
 * @param {string} nick
 * @returns {object}  Updated game state
 */
export function addPlayer(game, peer_id, nick) {
    if (game.phase !== 'lobby') return game;
    if (game.players.find(p => p.peer_id === peer_id)) return game;
    if (game.players.length >= MAX_PLAYERS) return game;

    return {
        ...game,
        players: [
            ...game.players,
            {
                peer_id,
                nick,
                joinedAt: Date.now(),
                score: 0,
                vote: null,
                votedAt: null,
            },
        ],
    };
}

/**
 * Remove a player from the game.
 * @param {object} game
 * @param {string} peer_id
 * @returns {object}  Updated game state
 */
export function removePlayer(game, peer_id) {
    return {
        ...game,
        players: game.players.filter(p => p.peer_id !== peer_id),
    };
}

/* ── Mystery Generation ───────────────────────────────────── */

/**
 * Generate a mystery from a template. Assigns suspects, distributes
 * clues, sets culprit, and builds AI system prompts.
 *
 * @param {object}  game
 * @param {string}  [templateId]  Optional specific template id
 * @returns {object}  Game state in 'investigation' phase
 */
export function generateMystery(game, templateId) {
    if (game.phase !== 'lobby') return game;

    const template = templateId
        ? getTemplateById(templateId) || pickRandomTemplate()
        : pickRandomTemplate();

    // Distribute cross-clues into suspect contexts
    const suspectsWithClues = distributeClues(template);

    // Build suspect IDs and mark culprit
    const culpritIndex = template.culpritIndex;
    const suspects = suspectsWithClues.map((s, idx) => {
        const isCulprit = idx === culpritIndex;
        const suspect = {
            id: `suspect_${idx}`,
            ...s,
            isCulprit,
            _systemPrompt: '',
            _secretConstraints: s.secretConstraints || [],
            _conversationHistory: [],
        };
        return suspect;
    });

    const mysteryDef = {
        id: uid(),
        title: template.title,
        setting: template.setting,
        victim: { ...template.victim },
        weapon: template.weapon,
        motive: template.motive,
        culpritId: `suspect_${culpritIndex}`,
    };

    // Build system prompts (requires mysteryDef to be set)
    const suspectsWithPrompts = suspects.map(s => ({
        ...s,
        _systemPrompt: buildSuspectPrompt(s, mysteryDef),
    }));

    return {
        ...game,
        phase: 'investigation',
        mystery: mysteryDef,
        suspects: suspectsWithPrompts,
        phaseStartedAt: Date.now(),
        phaseDuration: game.investigationDurationMs,
        interrogations: [],
        results: null,
    };
}

/* ── Phase Transitions ────────────────────────────────────── */

/**
 * Start the investigation phase. Called after mystery generation
 * if the game needs an explicit start trigger.
 * @param {object} game
 * @returns {object}
 */
export function startInvestigation(game) {
    if (game.phase !== 'investigation') return game;
    return {
        ...game,
        phaseStartedAt: Date.now(),
        phaseDuration: game.investigationDurationMs,
    };
}

/**
 * Advance from investigation to deliberation.
 * @param {object} game
 * @returns {object}
 */
export function advanceToDeliberation(game) {
    if (game.phase !== 'investigation') return game;
    return {
        ...game,
        phase: 'deliberation',
        phaseStartedAt: Date.now(),
        phaseDuration: game.deliberationDurationMs,
    };
}

/**
 * Advance from deliberation to accusation.
 * @param {object} game
 * @returns {object}
 */
export function advanceToAccusation(game) {
    if (game.phase !== 'deliberation') return game;
    return {
        ...game,
        phase: 'accusation',
        phaseStartedAt: Date.now(),
        phaseDuration: game.accusationDurationMs,
    };
}

/* ── Interrogation ────────────────────────────────────────── */

/**
 * Add an interrogation message to the game log.
 * @param {object}  game
 * @param {string}  sender       Nick or suspect name
 * @param {string}  suspectId    Target suspect id (or null)
 * @param {string}  content      Message text
 * @param {'player'|'suspect'} senderType
 * @param {boolean} [isRevised]  True if violation bot rewrote this
 * @returns {object}
 */
export function addInterrogation(game, sender, suspectId, content, senderType, isRevised = false) {
    if (game.phase !== 'investigation') return game;
    return {
        ...game,
        interrogations: [
            ...game.interrogations,
            {
                id: uid(),
                timestamp: Date.now(),
                sender,
                senderType,
                suspectId: suspectId || null,
                content,
                isRevised,
            },
        ],
    };
}

/* ── Voting ───────────────────────────────────────────────── */

/**
 * Cast a vote for a suspect during the accusation phase.
 * @param {object} game
 * @param {string} peer_id
 * @param {string} suspectId
 * @returns {object}
 */
export function castVote(game, peer_id, suspectId) {
    if (game.phase !== 'accusation') return game;

    // Validate suspectId exists
    if (!game.suspects.find(s => s.id === suspectId)) return game;

    return {
        ...game,
        players: game.players.map(p =>
            p.peer_id === peer_id
                ? { ...p, vote: suspectId, votedAt: Date.now() }
                : p,
        ),
    };
}

/**
 * Check whether all players have voted.
 * @param {object} game
 * @returns {boolean}
 */
export function allPlayersVoted(game) {
    return game.players.length > 0 && game.players.every(p => p.vote !== null);
}

/* ── Reveal ───────────────────────────────────────────────── */

/**
 * Reveal the truth: calculate scores, tag correct voters,
 * transition to 'reveal' phase.
 * @param {object} game
 * @returns {object}
 */
export function reveal(game) {
    if (game.phase !== 'accusation') return game;

    const results = calculateScores(game);

    // Apply scores to player objects
    const players = game.players.map(p => ({
        ...p,
        score: results.scores[p.peer_id] || 0,
    }));

    return {
        ...game,
        phase: 'reveal',
        players,
        results,
        phaseStartedAt: Date.now(),
        phaseDuration: 0,
    };
}

/* ── New Round ────────────────────────────────────────────── */

/**
 * Reset the game for a new mystery round. Keeps players, clears everything else.
 * @param {object} game
 * @returns {object}
 */
export function newRound(game) {
    return {
        ...createMystery(game.roomId, game.hostPeerId, {
            investigationDurationMs: game.investigationDurationMs,
            deliberationDurationMs:  game.deliberationDurationMs,
            accusationDurationMs:    game.accusationDurationMs,
        }),
        players: game.players.map(p => ({
            peer_id: p.peer_id,
            nick: p.nick,
            joinedAt: p.joinedAt,
            score: 0,
            vote: null,
            votedAt: null,
        })),
    };
}

/* ── Host Migration ───────────────────────────────────────── */

/**
 * Handle host departure. Promotes the next player as host.
 * Returns null if no players remain.
 * @param {object} game
 * @param {string} departedPeerId
 * @returns {object|null}
 */
export function migrateHost(game, departedPeerId) {
    const remainingPlayers = game.players.filter(p => p.peer_id !== departedPeerId);
    const wasHost = game.hostPeerId === departedPeerId;

    if (!wasHost) {
        return { ...game, players: remainingPlayers };
    }

    if (remainingPlayers.length === 0) return null;

    const newHostPeerId = remainingPlayers[0].peer_id;

    // New host must rebuild system prompts from template data
    const suspectsWithPrompts = game.mystery
        ? game.suspects.map(s => ({
            ...s,
            _systemPrompt: buildSuspectPrompt(s, game.mystery),
        }))
        : game.suspects;

    return {
        ...game,
        hostPeerId: newHostPeerId,
        players: remainingPlayers,
        suspects: suspectsWithPrompts,
    };
}

/* ── Serialization ────────────────────────────────────────── */

/**
 * Serialize game state for P2P broadcast.
 * Strips host-only AI fields from suspects.
 * @param {object} game
 * @returns {string}
 */
export function serializeGame(game) {
    return JSON.stringify({
        ...game,
        suspects: sanitizeSuspects(game.suspects),
    });
}

/**
 * Deserialize game state received from a peer.
 * @param {string|object} data
 * @returns {object|null}
 */
export function deserializeGame(data) {
    try {
        return typeof data === 'string' ? JSON.parse(data) : data;
    } catch {
        return null;
    }
}

/* ── Wire Protocol (MM: prefix) ───────────────────────────── */

/**
 * Check if a message is a murder mystery action.
 * @param {*} data
 * @returns {boolean}
 */
export function isMysteryMessage(data) {
    return typeof data === 'string' && data.startsWith('MM:');
}

/**
 * Parse a murder mystery action from wire format.
 * @param {*} data
 * @returns {object|null}
 */
export function parseMysteryAction(data) {
    if (!isMysteryMessage(data)) return null;
    try { return JSON.parse(data.slice(3)); } catch { return null; }
}

/**
 * Serialize a murder mystery action for wire transmission.
 * @param {object} action
 * @returns {string}
 */
export function serializeMysteryAction(action) {
    return 'MM:' + JSON.stringify(action);
}

/* ── Rules (used by HowToPlay) ────────────────────────────── */

export const MYSTERY_RULES = {
    name: 'Murder Mystery',
    description:
        'A collaborative social deduction game. AI-driven suspects have committed a murder. ' +
        'Interrogate them, uncover clues, and vote to identify the culprit. ' +
        'No chips wagered — earn points for sharp detective work.',
    bets: [
        { name: 'Correct Accusation', odds: `+${SCORING.correctAccusation}`, description: 'Vote for the actual culprit during the accusation phase.' },
        { name: 'Questions Asked', odds: `+${SCORING.questionsAskedBonus}/ea`, description: 'Points per interrogation question asked during investigation.' },
        { name: 'Unique Suspects', odds: `+${SCORING.uniqueSuspectsBonus}/ea`, description: 'Bonus for each unique suspect you interrogated.' },
        { name: 'Early Vote', odds: `+${SCORING.earlyVoteBonus}`, description: 'Bonus for voting correctly with more than half the time remaining.' },
    ],
};

/* ── GameEngine Implementation ────────────────────────────── */

export class MysteryEngine extends GameEngine {
    constructor(game) {
        super();
        this._game = game;
    }

    getGameState() {
        return this._game;
    }

    /**
     * Murder Mystery is non-financial. Returns empty payouts.
     */
    calculatePayout(_bets, _result) {
        return {};
    }

    getRules() {
        return MYSTERY_RULES;
    }

    /**
     * Return a NonFinancialEvent with player scores.
     * @param {object} gameState  Settled game (phase === 'reveal' or 'ended')
     * @returns {object}          NonFinancialEvent
     */
    calculateResults(gameState) {
        const mystery = gameState.mystery || {};
        const results = gameState.results || {};
        const correctVoters = results.correctVoters || [];

        const resultLabel = `Mystery: ${mystery.title || 'Unknown'}`;

        const playerStats = (gameState.players || []).map(p => ({
            peer_id: p.peer_id,
            nick: p.nick,
            outcome: correctVoters.includes(p.peer_id) ? 'win' : 'loss',
        }));

        return createNonFinancialEvent({
            gameType: 'mystery',
            roundId: mystery.id || `mystery-${Date.now()}`,
            resultLabel,
            playerStats,
        });
    }
}

registerGame('mystery', MysteryEngine);
