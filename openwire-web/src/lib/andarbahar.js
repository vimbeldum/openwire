/* ═══════════════════════════════════════════════════════════
   OpenWire Web — Andar Bahar game engine
   Classic Indian card game: bet Inside (Andar) or Outside (Bahar)
   Full auto-cycle every 2 minutes, P2P host-driven
   Bounded Context: Andar Bahar | Shared Core: GameEngine + payouts
   ═══════════════════════════════════════════════════════════ */

import { GameEngine, registerGame } from './GameEngine.js';
import { settleBets } from './core/payouts.js';
import { createPayoutEvent } from './core/PayoutEvent.js';
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
    if (!amount || typeof amount !== 'number' || amount <= 0 || !isFinite(amount)) return game;
    if (game.phase !== 'betting') return game;
    // Allow multiple bets per player on different sides (like roulette)
    const bets = game.bets.filter(b => !(b.peer_id === peer_id && b.side === side));
    if (bets.length >= 200) return game; // cap total bets per round
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

    if (!game.deck || game.deck.length === 0) {
        return { ...game, phase: 'ended', result: 'draw', payouts: {} };
    }

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

/* ── Rules (used by HowToPlay) ────────────────────────────── */

export const ANDARBAHAR_RULES = {
    name: 'Andar Bahar',
    description: 'A trump card is drawn; bet whether its matching rank appears first in Andar (Inside) or Bahar (Outside). Cards are dealt alternately, starting from Bahar.',
    bets: [
        { name: 'Andar (Inside)', odds: '0.9:1', description: 'The matching card lands on the Andar pile. Pays 0.9:1 when trump appeared first on Bahar.' },
        { name: 'Bahar (Outside)', odds: '1:1', description: 'The matching card lands on the Bahar pile. Pays 1:1.' },
        { name: 'Side Bet 1–5', odds: '3.5×', description: 'Match found within 1–5 total cards dealt.' },
        { name: 'Side Bet 6–10', odds: '4.5×', description: 'Match found within 6–10 total cards dealt.' },
        { name: 'Side Bet 11–15', odds: '5.5×', description: 'Match found within 11–15 total cards dealt.' },
        { name: 'Side Bet 16–25', odds: '4.5×', description: 'Match found within 16–25 total cards dealt.' },
        { name: 'Side Bet 26–35', odds: '15×', description: 'Match found within 26–35 total cards dealt.' },
        { name: 'Side Bet 36–40', odds: '50×', description: 'Match found within 36–40 total cards dealt.' },
        { name: 'Side Bet 41+', odds: '120×', description: 'Match found after 41 or more cards dealt.' },
    ],
};

/* ── GameEngine implementation ────────────────────────────── */

export class AndarBaharEngine extends GameEngine {
    constructor(game) {
        super();
        this._game = game;
    }

    getGameState() {
        return this._game;
    }

    /**
     * @param {Array<{peer_id: string, side: string, amount: number}>} bets
     * @param {{ winningSide: string, totalCards: number, trumpFirst: string }} result
     * @returns {{ [peer_id: string]: number }}
     */
    calculatePayout(bets, result) {
        const { winningSide, totalCards, trumpFirst } = result;
        return settleBets(bets, (bet) => {
            if (bet.side === winningSide) {
                const multiplier = (winningSide === 'andar' && trumpFirst === 'bahar') ? 0.9 : 1.0;
                return Math.floor(bet.amount * multiplier);
            }
            if (SIDE_BETS[bet.side]) {
                return isSideBetWin(bet.side, totalCards)
                    ? Math.floor(bet.amount * SIDE_BETS[bet.side])
                    : -bet.amount;
            }
            return -bet.amount;
        });
    }

    getRules() {
        return ANDARBAHAR_RULES;
    }

    /**
     * Process a completed Andar Bahar round and return a financial PayoutEvent.
     * Handles main bets (Andar 0.9:1 / Bahar 1:1) and all 7 side bet ranges.
     *
     * @param {object} gameState  Ended game state (phase === 'ended')
     * @returns {object}          PayoutEvent
     */
    calculateResults(gameState) {
        const { result, bets, andar, bahar, roomId, trumpFirst } = gameState;
        const totalCards = (andar?.length || 0) + (bahar?.length || 0);
        const resultLabel = result
            ? `${result.toUpperCase()} wins — ${totalCards} cards dealt`
            : 'Round ended';

        const breakdown = (bets || []).map(bet => {
            let net, outcome, betLabel;

            if (bet.side === result) {
                const multiplier = (result === 'andar' && trumpFirst === 'bahar') ? 0.9 : 1.0;
                net = Math.floor(bet.amount * multiplier);
                outcome = 'win';
                betLabel = `${bet.side.charAt(0).toUpperCase() + bet.side.slice(1)} (${multiplier === 0.9 ? '0.9' : '1'}:1)`;
            } else if (SIDE_BETS[bet.side]) {
                if (isSideBetWin(bet.side, totalCards)) {
                    net = Math.floor(bet.amount * SIDE_BETS[bet.side]);
                    outcome = 'win';
                    betLabel = `Side Bet ${bet.side} (${SIDE_BETS[bet.side]}×)`;
                } else {
                    net = -bet.amount;
                    outcome = 'loss';
                    betLabel = `Side Bet ${bet.side} (missed)`;
                }
            } else {
                net = -bet.amount;
                outcome = 'loss';
                betLabel = `${bet.side.charAt(0).toUpperCase() + bet.side.slice(1)} (lost)`;
            }

            return { peer_id: bet.peer_id, nick: bet.nick, betLabel, wager: bet.amount, net, outcome };
        });

        const totals = {};
        for (const b of breakdown) {
            totals[b.peer_id] = (totals[b.peer_id] ?? 0) + b.net;
        }

        return createPayoutEvent({
            gameType: 'andarbahar',
            roundId: `${roomId}-${Date.now()}`,
            resultLabel,
            breakdown,
            totals,
        });
    }
}

registerGame('andarbahar', AndarBaharEngine);

// Message protocol
export function isAndarBaharMessage(data) { return typeof data === 'string' && data.startsWith('AB:'); }
export function parseAndarBaharAction(data) {
    if (!isAndarBaharMessage(data)) return null;
    try { return JSON.parse(data.slice(3)); } catch { return null; }
}
export function serializeAndarBaharAction(action) { return 'AB:' + JSON.stringify(action); }
export function serializeGame(game) {
    const { deck, ...safe } = game;
    return JSON.stringify({ ...safe, deckCount: deck?.length || 0 });
}
export function deserializeGame(data) {
    try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        // Peers won't have the deck (host keeps it); ensure graceful handling
        if (parsed && !parsed.deck) parsed.deck = null;
        return parsed;
    } catch { return null; }
}
