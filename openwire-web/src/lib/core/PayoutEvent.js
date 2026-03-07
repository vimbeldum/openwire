/* ═══════════════════════════════════════════════════════════
   OpenWire — Shared Core: PayoutEvent Contract
   Every game engine's calculateResults() returns one of these.
   Financial events update wallets; non-financial log stats only.
   ═══════════════════════════════════════════════════════════ */

/**
 * Create a standardized financial PayoutEvent.
 * Returned by calculateResults() for Roulette, Blackjack, Andar Bahar.
 *
 * @param {{
 *   gameType: string,
 *   roundId: string,
 *   resultLabel: string,
 *   breakdown: Array<{peer_id,nick,betLabel,wager,net,outcome}>,
 *   totals: {[peer_id]: number}
 * }} params
 * @returns {object}
 */
export function createPayoutEvent({ gameType, roundId, resultLabel, breakdown, totals }) {
    return {
        id: (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        financial: true,
        gameType,
        roundId,
        timestamp: Date.now(),
        resultLabel,
        breakdown: breakdown || [],
        totals: totals || {},
    };
}

/**
 * Create a non-financial (stats-only) event for games without wagering.
 * Returned by calculateResults() for Tic-Tac-Toe.
 * The GlobalLedgerService will log stats but NOT touch wallets.
 *
 * @param {{
 *   gameType: string,
 *   roundId: string,
 *   resultLabel: string,
 *   playerStats: Array<{peer_id, nick, outcome: 'win'|'loss'|'draw'}>
 * }} params
 * @returns {object}
 */
export function createNonFinancialEvent({ gameType, roundId, resultLabel, playerStats }) {
    return {
        id: (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        financial: false,
        gameType,
        roundId,
        timestamp: Date.now(),
        resultLabel,
        playerStats: playerStats || [],
        breakdown: [],
        totals: {},
    };
}
