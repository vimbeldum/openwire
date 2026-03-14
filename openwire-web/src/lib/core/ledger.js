/* ═══════════════════════════════════════════════════════════
   OpenWire — Shared Core: Global Ledger Service
   Listens for PayoutEvents from game engines.
   • Financial events  → update wallet + record to ledger
   • Non-financial events → record stats only (no wallet change)
   • All events stored in localStorage (max 500 per device)
   ═══════════════════════════════════════════════════════════ */

import * as walletLib from '../wallet.js';

const LEDGER_PREFIX = 'openwire_ledger_';
const MAX_EVENTS = 500;

// In-memory cache keyed by deviceId to avoid repeated localStorage reads
let _cache = null;

/** Reset the in-memory cache (for tests). */
export function _resetCache() { _cache = null; }

function ledgerKey(deviceId) {
    return `${LEDGER_PREFIX}${deviceId}`;
}

/* ── Persistence ──────────────────────────────────────────── */

/**
 * Append a PayoutEvent to the ledger (localStorage).
 * @param {string} deviceId
 * @param {object} event
 */
export function record(deviceId, event) {
    try {
        let history;
        if (_cache && _cache._deviceId === deviceId) {
            history = _cache.events;
        } else {
            const raw = localStorage.getItem(ledgerKey(deviceId));
            history = raw ? JSON.parse(raw) : [];
        }
        history.push(event);
        if (history.length > MAX_EVENTS) history.splice(0, history.length - MAX_EVENTS);
        localStorage.setItem(ledgerKey(deviceId), JSON.stringify(history));
        _cache = { _deviceId: deviceId, events: history };
    } catch (e) {
        console.warn('[Ledger] Failed to record event:', e);
    }
}

/**
 * Retrieve all stored events for a device, newest first.
 * @param {string} deviceId
 * @returns {object[]}
 */
export function getHistory(deviceId) {
    try {
        let events;
        if (_cache && _cache._deviceId === deviceId) {
            events = _cache.events;
        } else {
            const raw = localStorage.getItem(ledgerKey(deviceId));
            events = raw ? JSON.parse(raw) : [];
            _cache = { _deviceId: deviceId, events };
        }
        // Reverse-iterate to avoid array copy
        const reversed = new Array(events.length);
        for (let i = events.length - 1, j = 0; i >= 0; i--, j++) {
            reversed[j] = events[i];
        }
        return reversed;
    } catch {
        return [];
    }
}

/**
 * Clear all ledger history for a device.
 * @param {string} deviceId
 */
export function clearHistory(deviceId) {
    try {
        _cache = null;
        localStorage.removeItem(ledgerKey(deviceId));
    } catch { }
}

/* ── Wallet Application ───────────────────────────────────── */

/**
 * Apply settlement credit from a financial PayoutEvent to a wallet.
 *
 * With upfront debiting, chips are already deducted when bets are placed.
 * Settlement credits back: totalWager + net
 *   Win:  wager(100) + net(+100)  = credit 200
 *   Push: wager(100) + net(0)     = credit 100 (bet returned)
 *   Loss: wager(100) + net(-100)  = credit 0   (already deducted)
 *
 * @param {object} wallet   Current wallet object
 * @param {object} event    Financial PayoutEvent
 * @param {string} myId     Local player's peer_id
 * @returns {object}        Updated (or unchanged) wallet
 */
function applyEventToWallet(wallet, event, myId) {
    const net = event.totals?.[myId];
    if (net === undefined) return wallet;

    // Sum total wager from breakdown entries for this player
    const totalWager = (event.breakdown || [])
        .filter(b => b.peer_id === myId)
        .reduce((sum, b) => sum + (b.wager || 0), 0);

    const creditAmount = totalWager + net;
    if (creditAmount <= 0) return wallet; // loss — already debited upfront
    const reason = net > 0 ? `${event.gameType} win` : `${event.gameType} push`;
    return walletLib.credit(wallet, creditAmount, reason);
}

/* ── Core API ─────────────────────────────────────────────── */

/**
 * Process a PayoutEvent from a game engine.
 *
 * Financial events (Roulette, Blackjack, Andar Bahar):
 *   → Updates the player's wallet based on event.totals[myId]
 *   → Records the event to the persistent ledger
 *
 * Non-financial events (Tic-Tac-Toe):
 *   → Records stats to the ledger
 *   → Does NOT modify the wallet
 *
 * @param {object} currentWallet  The player's current wallet
 * @param {object} event          PayoutEvent or NonFinancialEvent
 * @param {string} myId           Local player's peer_id
 * @param {string} deviceId       For ledger storage key
 * @returns {{ updatedWallet: object, event: object }}
 */
export function processEvent(currentWallet, event, myId, deviceId) {
    let updatedWallet = currentWallet;

    if (event.financial) {
        updatedWallet = applyEventToWallet(currentWallet, event, myId);
        record(deviceId, event);
    } else {
        // Stats only — no wallet changes
        record(deviceId, event);
    }

    return { updatedWallet, event };
}

/* ── Statistics ───────────────────────────────────────────── */

/**
 * Compute per-game statistics from the ledger for a player.
 * Returns win / loss / push counts and total net chips.
 *
 * @param {string} deviceId
 * @param {string} myId
 * @returns {{ [gameType]: { wins, losses, pushes, totalNet } }}
 */
export function getStats(deviceId, myId) {
    const history = getHistory(deviceId);
    const stats = {};

    for (const event of history) {
        const type = event.gameType;
        if (!stats[type]) stats[type] = { wins: 0, losses: 0, pushes: 0, totalNet: 0 };

        if (event.financial) {
            const net = event.totals?.[myId] ?? 0;
            if (net > 0) stats[type].wins++;
            else if (net < 0) stats[type].losses++;
            else stats[type].pushes++;
            stats[type].totalNet += net;
        } else {
            const stat = event.playerStats?.find(p => p.peer_id === myId);
            if (stat) {
                if (stat.outcome === 'win') stats[type].wins++;
                else if (stat.outcome === 'loss') stats[type].losses++;
                else stats[type].pushes++;
            }
        }
    }

    return stats;
}
