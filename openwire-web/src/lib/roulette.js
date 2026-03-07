/* ═══════════════════════════════════════════════════════════
   OpenWire Web — Roulette game engine
   European roulette (0–36, single zero)
   Auto-spin every 2 minutes. P2P host-resilient.
   Implements the universal GameEngine interface.
   ═══════════════════════════════════════════════════════════ */

import { GameEngine, registerGame } from './GameEngine.js';
import { createPayoutEvent } from './core/PayoutEvent.js';

export const SPIN_INTERVAL_MS = 1 * 60 * 1000; // 1 minute
export const SPIN_PHASE_MS = 10 * 1000;        // 10s spinning animation
export const RESULTS_DISPLAY_MS = 10 * 1000;   // 10s results before new round

// Red numbers in European roulette
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export function isRed(n) { return RED_NUMBERS.has(n); }
export function isBlack(n) { return n > 0 && !RED_NUMBERS.has(n); }

export function getColor(n) {
    if (n === 0) return 'green';
    return isRed(n) ? 'red' : 'black';
}

// BET TYPES: { type, target? }
// single: target = 0-36
// color: target = 'red'|'black'
// parity: target = 'even'|'odd'
// half: target = 'low'|'high'
// dozen: target = 1|2|3
// column: target = 1|2|3
export function getPayout(betType, betTarget, result) {
    if (result === null) return 0;
    switch (betType) {
        case 'single': return result === betTarget ? 36 : 0; // 35:1 + stake
        case 'color':
            if (betTarget === 'red' && isRed(result)) return 2;
            if (betTarget === 'black' && isBlack(result)) return 2;
            return 0;
        case 'parity':
            if (result === 0) return 0;
            if (betTarget === 'even' && result % 2 === 0) return 2;
            if (betTarget === 'odd' && result % 2 !== 0) return 2;
            return 0;
        case 'half':
            if (result === 0) return 0;
            if (betTarget === 'low' && result >= 1 && result <= 18) return 2;
            if (betTarget === 'high' && result >= 19 && result <= 36) return 2;
            return 0;
        case 'dozen':
            if (result === 0) return 0;
            if (betTarget === 1 && result >= 1 && result <= 12) return 3;
            if (betTarget === 2 && result >= 13 && result <= 24) return 3;
            if (betTarget === 3 && result >= 25 && result <= 36) return 3;
            return 0;
        case 'column':
            if (result === 0) return 0;
            if (betTarget === 1 && result % 3 === 1) return 3;
            if (betTarget === 2 && result % 3 === 2) return 3;
            if (betTarget === 3 && result % 3 === 0) return 3;
            return 0;
        default: return 0;
    }
}

// sessionStorage key for spin history per room
function historyKey(roomId) { return `rl_history_${roomId}`; }

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

// Create a new roulette room state
export function createRoulette(roomId) {
    return {
        type: 'roulette',
        roomId,
        phase: 'betting',      // 'betting' | 'spinning' | 'results'
        result: null,
        bets: [],              // [{ peer_id, nick, betType, betTarget, amount }]
        spinHistory: loadHistory(roomId),
        nextSpinAt: Date.now() + SPIN_INTERVAL_MS,
        lastSpinAt: null,
    };
}

// Place a bet (or replace existing bet of same type+target)
export function placeBet(game, peer_id, nick, betType, betTarget, amount) {
    const bets = game.bets.filter(
        b => !(b.peer_id === peer_id && b.betType === betType && b.betTarget === betTarget)
    );
    return { ...game, bets: [...bets, { peer_id, nick, betType, betTarget, amount }] };
}

export function clearBets(game, peer_id) {
    return { ...game, bets: game.bets.filter(b => b.peer_id !== peer_id) };
}

// Spin the wheel — returns new game state with result + payouts
export function spin(game) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const result = buf[0] % 37; // 0-36

    // Compute net change per player
    const payouts = {};
    for (const bet of game.bets) {
        const multiplier = getPayout(bet.betType, bet.betTarget, result);
        const net = multiplier > 0
            ? bet.amount * (multiplier - 1)   // win: get stake back + profit
            : -bet.amount;                     // lose: stake gone
        payouts[bet.peer_id] = (payouts[bet.peer_id] || 0) + net;
    }

    return {
        ...game,
        phase: 'spinning',
        result,
        payouts,
        lastSpinAt: Date.now(),
        nextSpinAt: Date.now() + SPIN_PHASE_MS + RESULTS_DISPLAY_MS + SPIN_INTERVAL_MS,
    };
}

export function finishSpin(game) {
    const newHistory = [...(game.spinHistory || []), game.result].slice(-100);
    saveHistory(game.roomId, newHistory);
    return {
        ...game,
        phase: 'results',
        spinHistory: newHistory
    };
}

// Start a new betting round (called after results display period)
export function newRound(game) {
    return {
        ...game,
        phase: 'betting',
        result: null,
        bets: [],
        payouts: null,
        nextSpinAt: Date.now() + SPIN_INTERVAL_MS,
    };
}

// Message protocol helpers
export function isRouletteMessage(data) {
    return typeof data === 'string' && data.startsWith('RL:');
}
export function parseRouletteAction(data) {
    if (!isRouletteMessage(data)) return null;
    try { return JSON.parse(data.slice(3)); } catch { return null; }
}
export function serializeRouletteAction(action) {
    return 'RL:' + JSON.stringify(action);
}
export function serializeGame(game) {
    return JSON.stringify(game);
}
export function deserializeGame(data) {
    try { return typeof data === 'string' ? JSON.parse(data) : data; } catch { return null; }
}

/* ── Rules (used by HowToPlay) ────────────────────────────── */

export const ROULETTE_RULES = {
    name: 'European Roulette',
    description: 'European roulette with a single zero (0–36). Place bets before the wheel spins every minute. The house edge is 2.7%.',
    bets: [
        { name: 'Single Number', odds: '35:1', description: 'Bet on one specific number (0–36). Highest payout.' },
        { name: 'Red / Black', odds: '1:1', description: 'Bet on whether the result will be red or black. Zero loses.' },
        { name: 'Even / Odd', odds: '1:1', description: 'Bet on even or odd. Zero counts as neither.' },
        { name: 'Low (1–18)', odds: '1:1', description: 'Bet the result falls in the lower half (1–18).' },
        { name: 'High (19–36)', odds: '1:1', description: 'Bet the result falls in the upper half (19–36).' },
        { name: 'Dozen', odds: '2:1', description: '1st (1–12), 2nd (13–24), or 3rd (25–36) group of twelve.' },
        { name: 'Column', odds: '2:1', description: 'One of the three vertical columns on the betting board.' },
    ],
};

/* ── GameEngine implementation ────────────────────────────── */

export class RouletteEngine extends GameEngine {
    constructor(game) {
        super();
        this._game = game;
    }

    getGameState() {
        return this._game;
    }

    /**
     * @param {Array<{peer_id: string, nick: string, betType: string, betTarget: *, amount: number}>} bets
     * @param {number} result  Winning number (0–36)
     * @returns {{ [peer_id: string]: number }}
     */
    calculatePayout(bets, result) {
        const payouts = {};
        for (const bet of bets) {
            const multiplier = getPayout(bet.betType, bet.betTarget, result);
            const net = multiplier > 0
                ? bet.amount * (multiplier - 1)
                : -bet.amount;
            payouts[bet.peer_id] = (payouts[bet.peer_id] ?? 0) + net;
        }
        return payouts;
    }

    getRules() {
        return ROULETTE_RULES;
    }

    /**
     * Process a completed spin and return a financial PayoutEvent.
     * Supports all bet types: single, color, parity, half, dozen, column.
     *
     * @param {object} gameState  Settled roulette state (has result + bets)
     * @returns {object}          PayoutEvent
     */
    calculateResults(gameState) {
        const { result, bets, roomId } = gameState;
        const color = getColor(result);
        const colorLabel = color.charAt(0).toUpperCase() + color.slice(1);
        const resultLabel = `${result} — ${colorLabel}`;

        const breakdown = (bets || []).map(bet => {
            const multiplier = getPayout(bet.betType, bet.betTarget, result);
            const net = multiplier > 0 ? bet.amount * (multiplier - 1) : -bet.amount;
            return {
                peer_id: bet.peer_id,
                nick: bet.nick,
                betLabel: _formatBetLabel(bet.betType, bet.betTarget),
                wager: bet.amount,
                net,
                outcome: net > 0 ? 'win' : net === 0 ? 'push' : 'loss',
            };
        });

        const totals = {};
        for (const b of breakdown) {
            totals[b.peer_id] = (totals[b.peer_id] ?? 0) + b.net;
        }

        return createPayoutEvent({
            gameType: 'roulette',
            roundId: `${roomId}-${Date.now()}`,
            resultLabel,
            breakdown,
            totals,
        });
    }
}

function _formatBetLabel(betType, betTarget) {
    switch (betType) {
        case 'single': return `Single ${betTarget}`;
        case 'color': return betTarget === 'red' ? 'Red' : 'Black';
        case 'parity': return betTarget === 'even' ? 'Even' : 'Odd';
        case 'half': return betTarget === 'low' ? 'Low (1–18)' : 'High (19–36)';
        case 'dozen': return `Dozen ${betTarget}`;
        case 'column': return `Column ${betTarget}`;
        default: return betType;
    }
}

registerGame('roulette', RouletteEngine);
