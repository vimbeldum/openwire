/* ═══════════════════════════════════════════════════════════
   OpenWire — Universal GameEngine Interface
   All casino games must extend this class and implement the
   three required methods: getGameState, calculatePayout, getRules.
   ═══════════════════════════════════════════════════════════ */

/**
 * Abstract base class for all OpenWire casino game engines.
 * Provides a unified contract for game state, payout calculation,
 * and rule introspection used by the dynamic UI and P2P sync layer.
 */
export class GameEngine {
    /**
     * Returns the current immutable game state object.
     * @returns {object}
     */
    getGameState() {
        throw new Error(`${this.constructor.name} must implement getGameState()`);
    }

    /**
     * Calculates net chip payouts for all bets given an outcome.
     *
     * @param {Array<{peer_id: string, nick: string, amount: number, [key: string]: *}>} bets
     * @param {*} result  Game-specific outcome (number, string[], etc.)
     * @returns {{ [peer_id: string]: number }}  Net chip change per player (positive = won)
     */
    calculatePayout(bets, result) {
        throw new Error(`${this.constructor.name} must implement calculatePayout()`);
    }

    /**
     * Returns the human-readable rules and payout table for this game.
     * Used by the dynamic HowToPlay component.
     *
     * @returns {{
     *   name: string,
     *   description: string,
     *   bets: Array<{ name: string, odds: string, description: string }>
     * }}
     */
    getRules() {
        throw new Error(`${this.constructor.name} must implement getRules()`);
    }
}

/* ── Global Game Registry ─────────────────────────────────── */

/** Maps gameType string → GameEngine subclass constructor */
const _registry = new Map();

/**
 * Register a game engine class under a type key.
 * Call this at module level in each game's lib file.
 *
 * @param {string} gameType       e.g. 'roulette', 'slots'
 * @param {typeof GameEngine} EngineClass
 */
export function registerGame(gameType, EngineClass) {
    _registry.set(gameType, EngineClass);
}

/** Returns an array of all registered game type keys. */
export function getRegisteredGames() {
    return Array.from(_registry.keys());
}

/**
 * Instantiate a GameEngine for the given game type and state.
 * @param {string} gameType
 * @param {object} gameState
 * @returns {GameEngine}
 */
export function createGameEngine(gameType, gameState) {
    const EngineClass = _registry.get(gameType);
    if (!EngineClass) throw new Error(`No GameEngine registered for: "${gameType}"`);
    return new EngineClass(gameState);
}
