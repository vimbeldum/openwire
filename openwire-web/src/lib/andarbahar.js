/* ═══════════════════════════════════════════════════════════
   OpenWire Web — Andar Bahar game engine
   Classic Indian card game: bet Inside (Andar) or Outside (Bahar)
   Full auto-cycle every 2 minutes, P2P host-driven
   ═══════════════════════════════════════════════════════════ */

import { createDeck } from './blackjack.js';

export const GAME_INTERVAL_MS = 2 * 60 * 1000; // 2 min full cycle
export const BETTING_DURATION_MS = 30 * 1000;  // 30s betting window
export const DEAL_INTERVAL_MS = 800;           // 0.8s between cards
export const RESULTS_DISPLAY_MS = 8 * 1000;   // 8s results before new round

export const SIDE_BETS = {
    '1-5': 3.5,
    '6-10': 4.5,
    '11-15': 5.5,
    '16-25': 4.5,
    '26-35': 15.0,
    '36-40': 50.0,
    '41+': 120.0
};

export function isSideBetWin(side, total) {
    if (side === '1-5') return total >= 1 && total <= 5;
    if (side === '6-10') return total >= 6 && total <= 10;
    if (side === '11-15') return total >= 11 && total <= 15;
    if (side === '16-25') return total >= 16 && total <= 25;
    if (side === '26-35') return total >= 26 && total <= 35;
    if (side === '36-40') return total >= 36 && total <= 40;
    if (side === '41+') return total >= 41;
    return false;
}

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
    const now = Date.now();
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
        trumpFirst: null,
        trumpHistory: loadHistory(roomId),
        // Auto-cycle timing
        bettingEndsAt: now + BETTING_DURATION_MS,
        nextGameAt: now + GAME_INTERVAL_MS,
        startedAt: now,
    };
}

export function placeBet(game, peer_id, nick, side, amount) {
    if (game.phase !== 'betting') return game;
    // Allow multiple bets per player on different sides (like roulette)
    const bets = game.bets.filter(b => !(b.peer_id === peer_id && b.side === side));
    return { ...game, bets: [...bets, { peer_id, nick, side, amount }] };
}

export function clearBets(game, peer_id) {
    return { ...game, bets: game.bets.filter(b => b.peer_id !== peer_id) };
}


// Host auto-deals trump at end of betting phase
export function dealTrump(game) {
    if (game.phase !== 'betting') return game;
    const deck = [...game.deck];
    const trumpCard = deck.pop();
    return { ...game, deck, trumpCard, phase: 'dealing', dealCount: 0 };
}

// Deal one card — alternating Bahar first then Andar
export function dealNext(game) {
    if (game.phase !== 'dealing' || !game.trumpCard) return game;

    const deck = [...game.deck];
    const card = deck.pop();
    if (!card) return game;

    const dealCount = game.dealCount;
    // Bahar (outside) first by tradition
    const side = dealCount % 2 === 0 ? 'bahar' : 'andar';
    const andar = side === 'andar' ? [...game.andar, card] : game.andar;
    const bahar = side === 'bahar' ? [...game.bahar, card] : game.bahar;
    const trumpFirst = game.trumpFirst ?? side;

    const isMatch = card.value === game.trumpCard.value;
    if (isMatch) {
        const result = side;
        const newHistory = [...(game.trumpHistory || []), result].slice(-100);
        saveHistory(game.roomId, newHistory);

        // Payout: Andar pays 0.9:1 if trump was first seen on Bahar side (standard rule)
        const payouts = {};
        const totalCards = andar.length + bahar.length;

        for (const bet of game.bets) {
            if (bet.side === result) {
                const multiplier = (result === 'andar' && trumpFirst === 'bahar') ? 0.9 : 1.0;
                payouts[bet.peer_id] = (payouts[bet.peer_id] || 0) + Math.floor(bet.amount * multiplier);
            } else if (SIDE_BETS[bet.side]) {
                if (isSideBetWin(bet.side, totalCards)) {
                    payouts[bet.peer_id] = (payouts[bet.peer_id] || 0) + Math.floor(bet.amount * SIDE_BETS[bet.side]);
                } else {
                    payouts[bet.peer_id] = (payouts[bet.peer_id] || 0) - bet.amount;
                }
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

export function newRound(game) {
    const deck = createDeck();
    const now = Date.now();
    return {
        ...createGame(game.roomId),
        trumpHistory: game.trumpHistory || [],
        deck,
        bettingEndsAt: now + BETTING_DURATION_MS,
        nextGameAt: now + GAME_INTERVAL_MS,
        startedAt: now,
    };
}

// Message protocol
export function isAndarBaharMessage(data) { return typeof data === 'string' && data.startsWith('AB:'); }
export function parseAndarBaharAction(data) {
    if (!isAndarBaharMessage(data)) return null;
    try { return JSON.parse(data.slice(3)); } catch { return null; }
}
export function serializeAndarBaharAction(action) { return 'AB:' + JSON.stringify(action); }
export function serializeGame(game) { return JSON.stringify(game); }
export function deserializeGame(data) {
    try { return typeof data === 'string' ? JSON.parse(data) : data; } catch { return null; }
}
