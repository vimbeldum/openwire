/* ═══════════════════════════════════════════════════════════
   OpenWire — Unified Casino State
   • localStorage persistence — sessions survive page reloads
   • LWW (Last-Write-Wins) P2P merge — when a new peer joins
     they broadcast their state; both sides merge and keep the
     most recently updated values.
   • Global House P&L tracked per game type
   ═══════════════════════════════════════════════════════════ */

const STORAGE_KEY = 'openwire_casino_v1';

function now() { return Date.now(); }

/* ── State shape ──────────────────────────────────────────── */

/**
 * Create a fresh casino state.
 * @returns {object}
 */
export function createCasinoState() {
    return {
        _ts: now(),
        housePnl: {
            _ts: now(),
            roulette: 0,
            blackjack: 0,
            andarbahar: 0,
            slots: 0,
        },
    };
}

/* ── Persistence ──────────────────────────────────────────── */

/**
 * Load persisted casino state from localStorage.
 * Merges with defaults so new game types are always present.
 * @returns {object}
 */
export function loadCasinoState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            const defaults = createCasinoState();
            return {
                ...defaults,
                ...parsed,
                housePnl: { ...defaults.housePnl, ...parsed.housePnl },
            };
        }
    } catch { /* ignore corrupt data */ }
    return createCasinoState();
}

/**
 * Persist casino state to localStorage.
 * @param {object} state
 */
export function saveCasinoState(state) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        console.warn('[casinoState] Failed to save:', e);
    }
}

/* ── LWW P2P Merge ────────────────────────────────────────── */

/**
 * Merge two casino states using Last-Write-Wins semantics.
 *
 * Each top-level sub-object carries a `_ts` timestamp. When a new
 * P2P agent joins and broadcasts its state, both sides call this
 * function. For each sub-object, the version with the higher `_ts`
 * wins entirely — ensuring the most recent valid state is preserved.
 *
 * @param {object} local   Our current state
 * @param {object} remote  State received from a peer
 * @returns {object}       Merged state (not yet persisted — caller saves if desired)
 */
export function mergeCasinoStates(local, remote) {
    if (!remote) return local;
    if (!local) return remote;

    const merged = { ...local };

    // LWW on housePnl: whichever peer has the newer _ts wins
    if ((remote.housePnl?._ts ?? 0) > (local.housePnl?._ts ?? 0)) {
        merged.housePnl = { ...remote.housePnl };
    }

    // Top-level timestamp = max of both
    merged._ts = Math.max(local._ts ?? 0, remote._ts ?? 0);

    return merged;
}

/* ── House P&L ────────────────────────────────────────────── */

/**
 * Record house P&L after a completed game round.
 *
 * The house gains what players lose: houseDelta = -(sum of all payouts).
 * If payouts sum is negative (players lost more than they won), house profits.
 *
 * @param {object} state       Current casino state
 * @param {string} gameType    'roulette' | 'blackjack' | 'andarbahar' | 'slots'
 * @param {object} payoutsMap  { peer_id: netChips } — same map games produce
 * @returns {object}           Updated casino state (also persisted to localStorage)
 */
export function updateHousePnl(state, gameType, payoutsMap) {
    const houseGain = -Object.values(payoutsMap).reduce((s, v) => s + v, 0);
    const updatedPnl = {
        ...state.housePnl,
        [gameType]: (state.housePnl?.[gameType] ?? 0) + houseGain,
        _ts: now(),
    };
    const updated = { ...state, housePnl: updatedPnl, _ts: now() };
    saveCasinoState(updated);
    return updated;
}

/**
 * Sum of all game PnL values (excludes the internal `_ts` field).
 * @param {object} state
 * @returns {number}
 */
export function getTotalHousePnl(state) {
    return Object.entries(state.housePnl ?? {})
        .filter(([k]) => k !== '_ts')
        .reduce((sum, [, v]) => sum + (v ?? 0), 0);
}

/* ── P2P Serialization ────────────────────────────────────── */

export function serializeCasinoState(state) {
    return 'CS:' + JSON.stringify(state);
}

export function isCasinoStateMessage(data) {
    return typeof data === 'string' && data.startsWith('CS:');
}

export function parseCasinoState(data) {
    if (!isCasinoStateMessage(data)) return null;
    try { return JSON.parse(data.slice(3)); } catch { return null; }
}
