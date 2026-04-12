/* ═══════════════════════════════════════════════════════════
   OpenWire — Shashn Game Engine
   2-player trick-taking card game
   Bounded Context: Shashn | Shared Core: GameEngine
   Non-financial (no real money) — uses NonFinancialEvent
   ═══════════════════════════════════════════════════════════ */

import { GameEngine, registerGame } from './GameEngine.js';
import { createNonFinancialEvent } from './core/PayoutEvent.js';

/* ── Constants ────────────────────────────────────────────── */

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 2;
export const CARDS_PER_PLAYER = 6;
export const TRICKS_PER_ROUND = 6;
export const WINNING_SCORE = 150;
export const SUITS = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
export const RANKS = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/* ── Card Helpers ─────────────────────────────────────────── */

function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push({ suit, rank, id: `${rank}${suit[0]}` });
        }
    }
    return deck;
}

function shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function getCardValue(card, trumpSuit) {
    const rankOrder = { '6': 0, '7': 1, '8': 2, '9': 3, '10': 4, 'J': 5, 'Q': 6, 'K': 7, 'A': 8 };
    let value = rankOrder[card.rank] || 0;
    if (card.suit === trumpSuit) {
        value += 100; // Trump is always higher
    }
    return value;
}

function compareCards(card1, card2, leadSuit, trumpSuit) {
    // If one is trump and other isn't, trump wins
    if (card1.suit === trumpSuit && card2.suit !== trumpSuit) return card1;
    if (card2.suit === trumpSuit && card1.suit !== trumpSuit) return card2;

    // If both are trump, higher rank wins
    if (card1.suit === trumpSuit && card2.suit === trumpSuit) {
        return getCardValue(card1, trumpSuit) >= getCardValue(card2, trumpSuit) ? card1 : card2;
    }

    // If both are same suit (lead suit), higher rank wins
    if (card1.suit === card2.suit) {
        return getCardValue(card1, trumpSuit) >= getCardValue(card2, trumpSuit) ? card1 : card2;
    }

    // Different non-trump suits - lead suit wins
    return card1.suit === leadSuit ? card1 : card2;
}

function canFollowSuit(hand, leadSuit) {
    return hand.some(card => card.suit === leadSuit);
}

/* ── Create Game ──────────────────────────────────────────── */

export function createShashn(roomId) {
    return {
        type: 'shashn',
        roomId,
        phase: 'deal', // 'deal' | 'play' | 'trick_end' | 'round_end' | 'game_end'
        players: [
            { peer_id: null, nick: null, hand: [], tricksWon: 0, score: 0 },
            { peer_id: null, nick: null, hand: [], tricksWon: 0, score: 0 },
        ],
        currentPlayer: 0,
        currentTrick: { cards: [], leadSuit: null, winner: null },
        deck: null,
        trumpSuit: null,
        round: 1,
        trickNumber: 1,
        discards: [],
        winner: null,
        log: [],
    };
}

/* ── Player Management ────────────────────────────────────── */

export function addPlayer(game, peer_id, nick) {
    if (game.phase !== 'deal') return game;
    const slot = game.players[0].peer_id === null ? 0 : (game.players[1].peer_id === null ? 1 : -1);
    if (slot === -1) return game;

    return {
        ...game,
        players: game.players.map((p, i) =>
            i === slot ? { ...p, peer_id, nick } : p
        ),
    };
}

export function removePlayer(game, peer_id) {
    return {
        ...game,
        players: game.players.map(p =>
            p.peer_id === peer_id ? { ...p, peer_id: null, nick: null, hand: [] } : p
        ),
    };
}

/* ── Game Actions ─────────────────────────────────────────── */

export function startGame(game) {
    if (game.phase !== 'deal') return game;
    if (!game.players[0].peer_id || !game.players[1].peer_id) return game;

    // Shuffle and deal
    const deck = shuffleDeck(createDeck());
    const player0Hand = deck.slice(0, CARDS_PER_PLAYER);
    const player1Hand = deck.slice(CARDS_PER_PLAYER, CARDS_PER_PLAYER * 2);
    const trumpSuit = deck[CARDS_PER_PLAYER * 2].suit; // Card after hands is trump

    return {
        ...game,
        phase: 'play',
        players: game.players.map((p, i) => ({
            ...p,
            hand: i === 0 ? player0Hand : player1Hand,
            tricksWon: 0,
        })),
        deck,
        trumpSuit,
        currentPlayer: 0,
        trickNumber: 1,
        log: [`🎴 Shashn started! Trump: ${trumpSuit}`],
    };
}

export function playCard(game, cardId) {
    const player = game.players[game.currentPlayer];
    if (!player || player.peer_id === null) return game;
    if (game.phase !== 'play') return game;

    const cardIndex = player.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return game;

    // Check if can follow suit
    const leadSuit = game.currentTrick.leadSuit;
    if (leadSuit && player.hand.some(c => c.suit === leadSuit) && player.hand[cardIndex].suit !== leadSuit) {
        return game; // Must follow suit
    }

    const card = player.hand[cardIndex];
    const newHand = player.hand.filter((_, i) => i !== cardIndex);

    const newTrick = {
        ...game.currentTrick,
        cards: [...game.currentTrick.cards, { player: game.currentPlayer, card }],
        leadSuit: game.currentTrick.leadSuit || card.suit,
    };

    let newGame = {
        ...game,
        players: game.players.map((p, i) =>
            i === game.currentPlayer ? { ...p, hand: newHand } : p
        ),
        currentTrick: newTrick,
    };

    // If both players played, determine trick winner
    if (newTrick.cards.length === 2) {
        const [card1, card2] = newTrick.cards;
        const winner = compareCards(card1.card, card2.card, newTrick.leadSuit, game.trumpSuit);
        const winnerPlayer = winner === card1.card ? card1.player : card2.player;

        newGame = {
            ...newGame,
            currentTrick: { ...newTrick, winner: winnerPlayer },
            players: newGame.players.map((p, i) =>
                i === winnerPlayer ? { ...p, tricksWon: p.tricksWon + 1 } : p
            ),
            phase: 'trick_end',
            log: [
                ...newGame.log,
                `${newGame.players[card1.player].nick} played ${card1.card.rank}${card1.card.suit[0]}`,
                `${newGame.players[card2.player].nick} played ${card2.card.rank}${card2.card.suit[0]}`,
                `Trick won by ${newGame.players[winnerPlayer].nick}!`,
            ],
        };
    } else {
        // Next player's turn
        newGame = {
            ...newGame,
            currentPlayer: (game.currentPlayer + 1) % 2,
        };
    }

    return newGame;
}

export function collectTrick(game) {
    if (game.phase !== 'trick_end') return game;

    const trickWinner = game.currentTrick.winner;
    const winner = game.players[trickWinner];

    // Add trick to score (1 point per trick)
    const newScore = winner.score + 1;

    // Check if round is over (all tricks played)
    if (game.trickNumber >= TRICKS_PER_ROUND) {
        return endRound(game, trickWinner, newScore);
    }

    // Next trick
    return {
        ...game,
        phase: 'play',
        players: game.players.map((p, i) =>
            i === trickWinner ? { ...p, score: newScore } : p
        ),
        currentTrick: { cards: [], leadSuit: null, winner: null },
        currentPlayer: trickWinner,
        trickNumber: game.trickNumber + 1,
        log: [...game.log, `Score: ${game.players[0].nick} ${game.players[0].score} | ${game.players[1].nick} ${game.players[1].score}`],
    };
}

function endRound(game, winnerIdx, winnerScore) {
    // Check if someone won the game
    if (winnerScore >= WINNING_SCORE) {
        return {
            ...game,
            phase: 'game_end',
            winner: game.players[winnerIdx].peer_id,
            players: game.players.map((p, i) =>
                i === winnerIdx ? { ...p, score: winnerScore } : p
            ),
            log: [...game.log, `🏆 ${game.players[winnerIdx].nick} wins with ${winnerScore} points!`],
        };
    }

    // Start new round
    const deck = shuffleDeck(createDeck());
    const player0Hand = deck.slice(0, CARDS_PER_PLAYER);
    const player1Hand = deck.slice(CARDS_PER_PLAYER, CARDS_PER_PLAYER * 2);
    const trumpSuit = deck[CARDS_PER_PLAYER * 2].suit;

    return {
        ...game,
        phase: 'play',
        round: game.round + 1,
        players: [
            { ...game.players[0], hand: player0Hand, tricksWon: 0 },
            { ...game.players[1], hand: player1Hand, tricksWon: 0 },
        ],
        deck,
        trumpSuit,
        currentTrick: { cards: [], leadSuit: null, winner: null },
        currentPlayer: winnerIdx,
        trickNumber: 1,
        log: [
            ...game.log,
            `Round ${game.round} complete!`,
            `Starting Round ${game.round + 1}. Trump: ${trumpSuit}`,
        ],
    };
}

export function newRound(game) {
    // Manual new round trigger
    if (game.phase !== 'play' && game.phase !== 'trick_end') return game;

    const deck = shuffleDeck(createDeck());
    const player0Hand = deck.slice(0, CARDS_PER_PLAYER);
    const player1Hand = deck.slice(CARDS_PER_PLAYER, CARDS_PER_PLAYER * 2);
    const trumpSuit = deck[CARDS_PER_PLAYER * 2].suit;

    return {
        ...game,
        phase: 'play',
        round: game.round + 1,
        players: game.players.map((p, i) => ({
            ...p,
            hand: i === 0 ? player0Hand : player1Hand,
            tricksWon: 0,
        })),
        deck,
        trumpSuit,
        currentTrick: { cards: [], leadSuit: null, winner: null },
        currentPlayer: 0,
        trickNumber: 1,
        log: [...game.log, `Starting Round ${game.round + 1}. Trump: ${trumpSuit}`],
    };
}

/* ── Message Protocol ─────────────────────────────────────── */

export function isShashnMessage(data) {
    return data?.type?.startsWith('shashn_');
}

export function serializeShashnAction(action) {
    return JSON.stringify(action);
}

export function parseShashnAction(data) {
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

class ShashnEngine extends GameEngine {
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
        return SHASHN_RULES;
    }

    calculateResults(gameState) {
        const playerStats = gameState.players.map(p => ({
            peer_id: p.peer_id,
            nick: p.nick,
            tricksWon: p.tricksWon,
            finalScore: p.score,
            winner: p.peer_id === gameState.winner,
        }));

        return createNonFinancialEvent({
            gameType: 'shashn',
            playerStats,
        });
    }
}

export const SHASHN_RULES = {
    name: 'Shashn',
    description: 'Classic 2-player Russian trick-taking card game. Play 6 tricks per round, with the trump suit changing each round. First to 150 points wins!',
    bets: [],
};

/* ── Register ─────────────────────────────────────────────── */

registerGame('shashn', ShashnEngine);
