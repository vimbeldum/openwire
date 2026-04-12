/* ═══════════════════════════════════════════════════════════
   OpenWire — Cluedo (Clue) Game Engine
   Detective deduction game for 3–6 players
   Bounded Context: Cluedo | Shared Core: GameEngine
   Non-financial (no real money) — uses NonFinancialEvent
   ═══════════════════════════════════════════════════════════ */

import { GameEngine, registerGame } from './GameEngine.js';
import { createNonFinancialEvent } from './core/PayoutEvent.js';

/* ── Constants ────────────────────────────────────────────── */

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;

// Room adjacency map (can move between adjacent rooms)
const ROOM_ADJACENCY = {
    'Hall': ['Lounge', 'Dining Room', 'Study'],
    'Lounge': ['Hall', 'Dining Room'],
    'Dining Room': ['Lounge', 'Hall', 'Kitchen'],
    'Kitchen': ['Dining Room', 'Ballroom'],
    'Ballroom': ['Kitchen', 'Conservatory', 'Billiard Room'],
    'Conservatory': ['Ballroom', 'Billiard Room', 'Library'],
    'Billiard Room': ['Ballroom', 'Conservatory', 'Library'],
    'Library': ['Conservatory', 'Billiard Room', 'Study'],
    'Study': ['Library', 'Hall'],
};

const SUSPECTS = ['Miss Scarlet', 'Colonel Mustard', 'Mrs. White', 'Mr. Green', 'Mrs. Peacock', 'Professor Plum'];
const WEAPONS = ['Candlestick', 'Dagger', 'Lead Pipe', 'Revolver', 'Rope', 'Wrench'];
const ROOMS = ['Hall', 'Lounge', 'Dining Room', 'Kitchen', 'Ballroom', 'Conservatory', 'Billiard Room', 'Library', 'Study'];

/* ── Helpers ──────────────────────────────────────────────── */

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function rollDice() {
    return [Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1];
}

function distributeCards(players, suspects, weapons, rooms) {
    // Select envelope
    const envelope = {
        suspect: suspects[Math.floor(Math.random() * suspects.length)],
        weapon: weapons[Math.floor(Math.random() * weapons.length)],
        room: rooms[Math.floor(Math.random() * rooms.length)],
    };

    // Create deck (all cards except envelope)
    let deck = [
        ...suspects.filter(s => s !== envelope.suspect),
        ...weapons.filter(w => w !== envelope.weapon),
        ...rooms.filter(r => r !== envelope.room),
    ];
    deck = shuffle(deck);

    // Distribute cards
    const hands = {};
    let cardIndex = 0;
    players.forEach((player, i) => {
        const hand = [];
        while (hand.length < Math.ceil(deck.length / players.length) && cardIndex < deck.length) {
            hand.push(deck[cardIndex++]);
        }
        hands[player.peer_id] = hand;
    });

    return { envelope, hands };
}

/* ── Create Game ──────────────────────────────────────────── */

export function createCluedo(roomId) {
    return {
        type: 'cluedo',
        roomId,
        phase: 'lobby', // 'lobby' | 'roll' | 'move' | 'suggest' | 'accuse' | 'ended'
        players: [],
        currentPlayer: 0,
        deck: { suspects: SUSPECTS, weapons: WEAPONS, rooms: ROOMS },
        envelope: null,
        hands: {},
        suggestions: [],
        accusations: [],
        dice: [0, 0],
        diceRolled: false,
        currentRoom: null,
        winner: null,
        log: [],
    };
}

/* ── Player Management ────────────────────────────────────── */

export function addPlayer(game, peer_id, nick) {
    if (game.phase !== 'lobby') return game;
    if (game.players.find(p => p.peer_id === peer_id)) return game;
    if (game.players.length >= MAX_PLAYERS) return game;

    return {
        ...game,
        players: [...game.players, { peer_id, nick, position: null, eliminated: false, isInRoom: false }],
    };
}

export function removePlayer(game, peer_id) {
    return {
        ...game,
        players: game.players.map(p =>
            p.peer_id === peer_id ? { ...p, eliminated: true } : p
        ),
    };
}

/* ── Game Actions ─────────────────────────────────────────── */

export function startGame(game) {
    if (game.phase !== 'lobby') return game;
    if (game.players.length < MIN_PLAYERS) return game;

    const { envelope, hands } = distributeCards(game.players, SUSPECTS, WEAPONS, ROOMS);
    const startRoom = ROOMS[Math.floor(Math.random() * ROOMS.length)];

    return {
        ...game,
        phase: 'roll',
        envelope,
        hands,
        currentPlayer: 0,
        currentRoom: startRoom,
        players: game.players.map((p, i) => ({
            ...p,
            position: startRoom,
            isInRoom: true,
        })),
        log: [...game.log, 'Cluedo game started! Make suggestions to find the truth.'],
    };
}

export function roll(game) {
    const player = game.players[game.currentPlayer];
    if (!player || player.eliminated) return game;
    if (game.phase !== 'roll') return game;
    if (game.diceRolled) return game;

    const dice = rollDice();
    const total = dice[0] + dice[1];

    return {
        ...game,
        dice,
        diceRolled: true,
        phase: 'move',
        log: [...game.log, `${player.nick} rolled ${dice[0]}+${dice[1]} = ${total}`],
    };
}

export function moveToRoom(game, room) {
    const player = game.players[game.currentPlayer];
    if (!player || player.eliminated) return game;
    if (game.phase !== 'move') return game;

    // Can only move to adjacent room
    const currentRoom = player.position;
    if (!ROOM_ADJACENCY[currentRoom]?.includes(room)) return game;

    return {
        ...game,
        players: game.players.map((p, i) =>
            i === game.currentPlayer ? { ...p, position: room, isInRoom: true } : p
        ),
        currentRoom: room,
        phase: 'suggest',
        log: [...game.log, `${player.nick} moved to ${room}`],
    };
}

export function stayInRoom(game) {
    const player = game.players[game.currentPlayer];
    if (!player || player.eliminated) return game;
    if (game.phase !== 'move') return game;

    return {
        ...game,
        phase: 'suggest',
        log: [...game.log, `${player.nick} stayed in ${player.position}`],
    };
}

export function makeSuggestion(game, suspect, weapon, room) {
    const player = game.players[game.currentPlayer];
    if (!player || player.eliminated) return game;
    if (game.phase !== 'suggest') return game;

    // Verify suspect and weapon are valid (must be in a room)
    const suspectRoom = game.players.find(p => p.position === suspect)?.position || room;
    const suggestion = {
        player: player.peer_id,
        playerNick: player.nick,
        suspect,
        weapon,
        room: suspectRoom,
        disprovedBy: null,
        disprovedCard: null,
    };

    // Find next player who might disprove
    let disproverIdx = (game.currentPlayer + 1) % game.players.length;
    let attempts = 0;
    let foundDisprover = false;

    while (attempts < game.players.length) {
        const disprover = game.players[disproverIdx];
        if (!disprover.eliminated && disprover.peer_id !== player.peer_id) {
            const hand = game.hands[disprover.peer_id] || [];
            const card = hand.find(c =>
                c === suspect || c === weapon || c === suspectRoom
            );
            if (card) {
                suggestion.disprovedBy = disprover.peer_id;
                suggestion.disprovedCard = card;
                foundDisprover = true;
                break;
            }
        }
        disproverIdx = (disproverIdx + 1) % game.players.length;
        attempts++;
    }

    const newGame = {
        ...game,
        suggestions: [...game.suggestions, suggestion],
        log: [...game.log, `${player.nick} suggested: ${suspect} in ${suspectRoom} with ${weapon}${foundDisprover ? ` (${game.players.find(p => p.peer_id === suggestion.disprovedBy)?.nick || 'Unknown'} showed ${suggestion.disprovedCard})` : ' (no one could disprove)'}`],
    };

    return advanceTurn(newGame);
}

export function makeAccusation(game, suspect, weapon, room) {
    const player = game.players[game.currentPlayer];
    if (!player || player.eliminated) return game;
    if (game.phase !== 'suggest' && game.phase !== 'roll') return game;

    const correct =
        game.envelope.suspect === suspect &&
        game.envelope.weapon === weapon &&
        game.envelope.room === room;

    const accusation = {
        player: player.peer_id,
        playerNick: player.nick,
        suspect,
        weapon,
        room,
        correct,
    };

    let newGame = {
        ...game,
        accusations: [...game.accusations, accusation],
        log: [...game.log, `${player.nick} accused: ${suspect} in ${room} with ${weapon} - ${correct ? 'CORRECT!' : 'Wrong!'}`],
    };

    if (correct) {
        // Winner!
        newGame = {
            ...newGame,
            phase: 'ended',
            winner: player.peer_id,
            log: [...newGame.log, `🎉 ${player.nick} wins by making the correct accusation!`],
        };
    } else {
        // Player is eliminated
        newGame = {
            ...newGame,
            players: newGame.players.map((p, i) =>
                i === game.currentPlayer ? { ...p, eliminated: true } : p
            ),
            log: [...newGame.log, `${player.nick} has been eliminated from the game.`],
        };

        // Check if only one player left
        const remaining = newGame.players.filter(p => !p.eliminated);
        if (remaining.length === 1) {
            newGame = {
                ...newGame,
                phase: 'ended',
                winner: remaining[0].peer_id,
                log: [...newGame.log, `🎉 ${remaining[0].nick} wins as the last remaining detective!`],
            };
        } else {
            newGame = advanceTurn(newGame);
        }
    }

    return newGame;
}

export function showCards(game, card) {
    // Called by disprover to show a specific card
    const player = game.players[game.currentPlayer];
    if (!player || player.eliminated) return game;

    const hand = game.hands[player.peer_id] || [];
    if (!hand.includes(card)) return game;

    // Update the last suggestion to record what was shown
    const lastSuggestionIdx = game.suggestions.findLastIndex(
        s => s.disprovedBy === player.peer_id && !s.disprovedCard
    );

    if (lastSuggestionIdx >= 0) {
        return {
            ...game,
            suggestions: game.suggestions.map((s, i) =>
                i === lastSuggestionIdx ? { ...s, disprovedCard: card } : s
            ),
        };
    }

    return game;
}

function advanceTurn(game) {
    let nextIdx = (game.currentPlayer + 1) % game.players.length;
    let attempts = 0;

    while (game.players[nextIdx]?.eliminated && attempts < game.players.length) {
        nextIdx = (nextIdx + 1) % game.players.length;
        attempts++;
    }

    return {
        ...game,
        currentPlayer: nextIdx,
        phase: 'roll',
        diceRolled: false,
    };
}

/* ── Message Protocol ─────────────────────────────────────── */

export function isCluedoMessage(data) {
    return data?.type?.startsWith('clue_');
}

export function serializeCluedoAction(action) {
    return JSON.stringify(action);
}

export function parseCluedoAction(data) {
    try {
        return typeof data === 'string' ? JSON.parse(data) : data;
    } catch {
        return null;
    }
}

/* ── Serialization ────────────────────────────────────────── */

export function serializeGame(game) {
    return JSON.stringify(game);
}

export function deserializeGame(data) {
    try {
        return JSON.parse(data);
    } catch {
        return null;
    }
}

/* ── GameEngine ────────────────────────────────────────────── */

class CluedoEngine extends GameEngine {
    constructor(gameState) {
        super();
        this._game = gameState;
    }

    getGameState() {
        return this._game;
    }

    calculatePayout(bets, result) {
        return {};
    }

    getRules() {
        return CLUEDO_RULES;
    }

    calculateResults(gameState) {
        const playerStats = gameState.players.map(p => ({
            peer_id: p.peer_id,
            nick: p.nick,
            eliminated: p.eliminated,
            suggestions: gameState.suggestions.filter(s => s.player === p.peer_id).length,
            accusations: gameState.accusations.filter(a => a.player === p.peer_id).length,
            winner: p.peer_id === gameState.winner,
        }));

        return createNonFinancialEvent({
            gameType: 'cluedo',
            playerStats,
        });
    }
}

export const CLUEDO_RULES = {
    name: 'Cluedo',
    description: 'Classic detective deduction game. Make suggestions and accusations to discover who committed the murder, with what weapon, and in which room.',
    bets: [],
};

/* ── Register ─────────────────────────────────────────────── */

registerGame('cluedo', CluedoEngine);
