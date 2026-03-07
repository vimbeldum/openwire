/* ═══════════════════════════════════════════════════════════
   OpenWire — Shared Core: Payout Utilities
   All casino game engines share this module for chip math.
   No game-specific logic here — pure arithmetic contracts.
   ═══════════════════════════════════════════════════════════ */

/**
 * Calculate the house's net chip gain from a completed round.
 * houseGain = -(sum of all player net payouts)
 * Positive value means the house profited.
 *
 * @param {{ [peer_id: string]: number }} payoutsMap
 * @returns {number}
 */
export function calcHouseGain(payoutsMap) {
    return -Object.values(payoutsMap).reduce((s, v) => s + v, 0);
}

/**
 * Clamp a chip value to a minimum of 0.
 * @param {number} n
 * @returns {number}
 */
export function clampChips(n) {
    return Math.max(0, n);
}

/**
 * Build a payouts map from a list of bets using a per-bet settler function.
 * Accumulates multiple bets from the same peer_id automatically.
 *
 * @param {Array<{peer_id: string, amount: number, [key: string]: *}>} bets
 * @param {(bet: object) => number} settleFn  Returns net chip delta for one bet
 * @returns {{ [peer_id: string]: number }}
 */
export function settleBets(bets, settleFn) {
    const payouts = {};
    for (const bet of bets) {
        payouts[bet.peer_id] = (payouts[bet.peer_id] ?? 0) + settleFn(bet);
    }
    return payouts;
}
