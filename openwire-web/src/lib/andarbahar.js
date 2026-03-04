/* ═══════════════════════════════════════════════════════════
   OpenWire Web — Andar Bahar game engine
   Classic Indian card game: bet Andar (left) or Bahar (right)
   Cards auto-deal until a rank match with trump card
   ═══════════════════════════════════════════════════════════ */

import { createDeck } from './blackjack.js';

// Payout multipliers (net)
// Andar: 0.9:1 (house edge if trump card dealt to Andar first)
// Bahar: 1:1
// Simplified: both pay 1:1 for simplicity, small house edge via 0.9

export const DEAL_INTERVAL_MS = 1000; // 1 second between cards
export const RESULTS_DISPLAY_MS = 8000;

function historyKey(roomId) { return `ab_history_${roomId}`; }

export function loadHistory(roomId) {
    try {
        const raw = sessionStorage.getItem(historyKey(roomId));
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

export function saveHistory(roomId, history) {
    try {
        sessionStorage.setItem(historyKey(roomId), JSON.stringify(history.slice(-100)));
    } catch { }
}

export function createGame(roomId) {
    const deck = createDeck();
    return {
        type: 'andarbahar',
        roomId,
        phase: 'betting',      // 'betting' | 'dealing' | 'ended'
        deck,
        trumpCard: null,
        andar: [],
        bahar: [],
        bets: [],              // [{ peer_id, nick, side: 'andar'|'bahar', amount }]
        result: null,          // 'andar' | 'bahar'
        payouts: null,
        dealCount: 0,
        trumpFirst: null,      // which side trump was first dealt to (affects payout)
        trumpHistory: loadHistory(roomId),
    };
}

// Place or replace bet
export function placeBet(game, peer_id, nick, side, amount) {
    if (game.phase !== 'betting') return game;
    const bets = game.bets.filter(b => b.peer_id !== peer_id);
    return { ...game, bets: [...bets, { peer_id, nick, side, amount }] };
}

// Deal the trump card (first state transition)
export function dealTrump(game) {
    if (game.phase !== 'betting') return game;
    const deck = [...game.deck];
    const trumpCard = deck.pop();
    return { ...game, deck, trumpCard, phase: 'dealing', dealCount: 0 };
}

// Deal one card to the next side (alternating bahar, andar, bahar, ...)
// First card goes to Bahar per traditional rules
export function dealNext(game) {
    if (game.phase !== 'dealing' || !game.trumpCard) return game;

    const deck = [...game.deck];
    const card = deck.pop();
    if (!card) return game; // shouldn't happen

    const dealCount = game.dealCount;
    // Bahar first, then alternate
    const side = dealCount % 2 === 0 ? 'bahar' : 'andar';
    const andar = side === 'andar' ? [...game.andar, card] : game.andar;
    const bahar = side === 'bahar' ? [...game.bahar, card] : game.bahar;

    const trumpFirst = game.trumpFirst ?? side; // first side card was dealt to

    // Check for match
    const isMatch = card.value === game.trumpCard.value;
    if (isMatch) {
        const result = side;
        const newHistory = [...(game.trumpHistory || []), game.trumpCard].slice(-100);
        saveHistory(game.roomId, newHistory);

        // Compute payouts
        // Andar bet wins at 0.9:1 if trump first went to Bahar (standard rule); otherwise 1:1
        const payouts = {};
        for (const bet of game.bets) {
            if (bet.side === result) {
                const multiplier = (result === 'andar' && trumpFirst === 'bahar') ? 0.9 : 1.0;
                payouts[bet.peer_id] = (payouts[bet.peer_id] || 0) + Math.floor(bet.amount * multiplier);
            } else {
                payouts[bet.peer_id] = (payouts[bet.peer_id] || 0) - bet.amount;
            }
        }

        return {
            ...game, deck, andar, bahar, phase: 'ended', result,
            dealCount: dealCount + 1, trumpFirst, payouts,
            trumpHistory: newHistory,
        };
    }

    return { ...game, deck, andar, bahar, dealCount: dealCount + 1, trumpFirst };
}

// Start new round, keep trump history
export function newRound(game) {
    const deck = createDeck();
    return {
        ...createGame(game.roomId),
        trumpHistory: game.trumpHistory || [],
        deck,
    };
}

// Message protocol
export function isAndarBaharMessage(data) {
    return typeof data === 'string' && data.startsWith('AB:');
}
export function parseAndarBaharAction(data) {
    if (!isAndarBaharMessage(data)) return null;
    try { return JSON.parse(data.slice(3)); } catch { return null; }
}
export function serializeAndarBaharAction(action) {
    return 'AB:' + JSON.stringify(action);
}
export function serializeGame(game) {
    return JSON.stringify(game);
}
export function deserializeGame(data) {
    try { return typeof data === 'string' ? JSON.parse(data) : data; } catch { return null; }
}
