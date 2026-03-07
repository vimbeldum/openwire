/* ═══════════════════════════════════════════════════════════
   OpenWire Web — Slots game engine (scaffold)
   3-reel weighted symbol slots with classic paylines.
   Implements the universal GameEngine interface.
   ═══════════════════════════════════════════════════════════ */

import { GameEngine, registerGame } from './GameEngine.js';

/* ── Symbols & weights ────────────────────────────────────── */

const SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '💎', '7️⃣'];
// Weights must sum to 100; higher = more common
const SYMBOL_WEIGHTS = [30, 25, 20, 15, 7, 3];

/* ── Payout table ─────────────────────────────────────────── */

/**
 * Maps a reel combination string to a multiplier applied to bet amount.
 * Net return to player = betAmount * multiplier.
 * 0 = house wins (player loses their bet).
 */
export const SLOT_PAYOUTS = {
    '7️⃣7️⃣7️⃣': 50,   // jackpot
    '💎💎💎':   20,
    '🍇🍇🍇':   10,
    '🍊🍊🍊':    6,
    '🍋🍋🍋':    4,
    '🍒🍒🍒':    3,
    '🍒🍒':      2,   // two-cherry partial match (first two reels)
};

/* ── Core logic ───────────────────────────────────────────── */

function weightedSpin() {
    const total = SYMBOL_WEIGHTS.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < SYMBOLS.length; i++) {
        r -= SYMBOL_WEIGHTS[i];
        if (r <= 0) return SYMBOLS[i];
    }
    return SYMBOLS[0];
}

/**
 * Spin the reels and return the resulting symbol array.
 * @param {number} count  Number of reels (default 3)
 * @returns {string[]}
 */
export function spinReels(count = 3) {
    return Array.from({ length: count }, weightedSpin);
}

/**
 * Calculate net chip change for a single spin.
 * @param {string[]} reels      Result of spinReels()
 * @param {number}   betAmount  Chips wagered
 * @returns {number}            Net chip change (positive = win, negative = loss)
 */
export function calculatePayout(reels, betAmount) {
    const key3 = reels.join('');
    const key2 = reels.slice(0, 2).join('');
    const multiplier = SLOT_PAYOUTS[key3] ?? SLOT_PAYOUTS[key2] ?? 0;
    return multiplier > 0 ? betAmount * multiplier : -betAmount;
}

/* ── Game state factory ───────────────────────────────────── */

export function createSlots(roomId) {
    return {
        type: 'slots',
        roomId,
        phase: 'betting',   // 'betting' | 'spinning' | 'results'
        reels: [],
        bets: [],
        payouts: null,
        _ts: Date.now(),
    };
}

/* ── Rules (used by HowToPlay) ────────────────────────────── */

export const SLOTS_RULES = {
    name: 'Lucky Slots',
    description: 'Spin 3 weighted reels and match symbols to win. Rarer symbols pay bigger multipliers.',
    bets: [
        { name: 'Spin', odds: 'variable', description: 'Place any bet amount and spin to see your result.' },
        { name: '7️⃣7️⃣7️⃣ Jackpot', odds: '50×', description: 'Three lucky 7s — the biggest payout on the board.' },
        { name: '💎💎💎 Diamonds', odds: '20×', description: 'Three diamonds for a premium return.' },
        { name: '🍇🍇🍇 Grapes', odds: '10×', description: 'Three grapes.' },
        { name: '🍊🍊🍊 Oranges', odds: '6×', description: 'Three oranges.' },
        { name: '🍋🍋🍋 Lemons', odds: '4×', description: 'Three lemons.' },
        { name: '🍒🍒🍒 Cherries', odds: '3×', description: 'Three cherries.' },
        { name: '🍒🍒 Two Cherries', odds: '2×', description: 'Two cherries in the first two reels (any third symbol).' },
    ],
};

/* ── GameEngine implementation ────────────────────────────── */

export class SlotsEngine extends GameEngine {
    constructor(game) {
        super();
        this._game = game;
    }

    getGameState() {
        return this._game;
    }

    /**
     * @param {Array<{peer_id: string, amount: number}>} bets
     * @param {string[]} reels  Result from spinReels()
     */
    calculatePayout(bets, reels) {
        const payouts = {};
        for (const bet of bets) {
            const net = calculatePayout(reels, bet.amount);
            payouts[bet.peer_id] = (payouts[bet.peer_id] ?? 0) + net;
        }
        return payouts;
    }

    getRules() {
        return SLOTS_RULES;
    }
}

registerGame('slots', SlotsEngine);
