/* ═══════════════════════════════════════════════════════════
   OpenWire — Jackpot Pool System
   Pure ESM module. No React. No side effects.
   ═══════════════════════════════════════════════════════════ */

/** Rake rates per game (fraction of bet amount) */
export const RAKE = {
  blackjack: 0.03,
  roulette: 0.01,
  andar_bahar: 0.02,
  tambola: 0.05,
  slots: 0.02,
};

const VALID_GAMES = new Set(Object.keys(RAKE));

/** Minimum pool balance required before a payout can be triggered */
const MIN_PAYOUT_POOL = 100;

/**
 * Creates the initial jackpot state for a room.
 * @param {string} roomId
 * @returns {object}
 */
export function createJackpotState(roomId) {
  return {
    roomId,
    pool: 0,
    lastPayout: null,
    contributions: { blackjack: 0, roulette: 0, andar_bahar: 0, tambola: 0, slots: 0 },
  };
}

/**
 * Adds rake from a bet to the jackpot pool.
 * Pure function — returns a new jackpot state object.
 *
 * @param {object} jackpot - Current jackpot state
 * @param {string} game    - One of: 'blackjack' | 'roulette' | 'andar_bahar' | 'tambola'
 * @param {number} betAmount
 * @returns {object} Updated jackpot state
 */
export function addRake(jackpot, game, betAmount) {
  if (!VALID_GAMES.has(game)) {
    throw new Error(`addRake: unknown game "${game}". Valid games: ${[...VALID_GAMES].join(', ')}`);
  }
  const rakeAmount = Math.floor(betAmount * RAKE[game]);
  return {
    ...jackpot,
    pool: jackpot.pool + rakeAmount,
    contributions: {
      ...jackpot.contributions,
      [game]: jackpot.contributions[game] + rakeAmount,
    },
  };
}

/**
 * Checks whether an event triggers a jackpot payout.
 * Pure function — does not mutate the jackpot.
 *
 * @param {object} jackpot
 * @param {{ type: string, playerId: string, data: object }} event
 * @returns {{ triggered: boolean, trigger?: string, payout?: number, newJackpot?: object }}
 */
export function checkTriggers(jackpot, event) {
  const { type, data = {} } = event;

  let payoutFraction = null;
  let trigger = null;

  if (type === 'blackjack_3x' && data.consecutiveBlackjacks >= 3) {
    trigger = 'blackjack_3x';
    payoutFraction = 0.5;
  } else if (type === 'roulette_repeat' && data.sameNumberTwice === true) {
    trigger = 'roulette_repeat';
    payoutFraction = 0.25;
  } else if (type === 'tambola_speedhouse' && data.numbersCalledForFullHouse <= 30) {
    trigger = 'tambola_speedhouse';
    payoutFraction = 0.75;
  } else if (type === 'random' && Math.random() < 1 / 500) {
    trigger = 'random';
    payoutFraction = 0.10;
  }

  if (trigger === null || jackpot.pool < MIN_PAYOUT_POOL) {
    return { triggered: false };
  }

  const payout = Math.floor(jackpot.pool * payoutFraction);
  const newJackpot = {
    ...jackpot,
    pool: jackpot.pool - payout,
  };

  return { triggered: true, trigger, payout, newJackpot };
}

/**
 * Records a jackpot payout event on the jackpot state.
 * Pure function — returns updated jackpot with lastPayout populated.
 *
 * @param {object} jackpot
 * @param {string} trigger
 * @param {number} payout
 * @param {string} winner   - Player ID or display name
 * @param {number|string} timestamp
 * @returns {object} Updated jackpot state
 */
export function recordPayout(jackpot, trigger, payout, winner, timestamp) {
  return {
    ...jackpot,
    lastPayout: { trigger, payout, winner, timestamp },
  };
}

/**
 * Returns the formatted ticker message for a jackpot win.
 *
 * @param {string} trigger
 * @param {string} winner
 * @param {number} payout
 * @returns {string}
 */
export function getTickerMessage(trigger, winner, payout) {
  const messages = {
    blackjack_3x: `🎰 [JACKPOT] ${winner} hit the jackpot! +${payout} chips from Blackjack 3x Streak! 🎰`,
    roulette_repeat: `🎰 [JACKPOT] ${winner} hit the jackpot! +${payout} chips from Roulette Repeat! 🎰`,
    tambola_speedhouse: `🎰 [JACKPOT] ${winner} hit the jackpot! +${payout} chips from Tambola Speed House! 🎰`,
    random: `🎰 [JACKPOT] ${winner} hit the jackpot! +${payout} chips from Lucky Strike! 🎰`,
  };
  return messages[trigger] ?? `🎰 [JACKPOT] ${winner} hit the jackpot! +${payout} chips! 🎰`;
}

/**
 * Applies a 10% resale fee from cosmetics to the jackpot pool.
 * Pure function — returns updated jackpot state.
 *
 * @param {object} jackpot
 * @param {number} resalePrice
 * @returns {object} Updated jackpot state
 */
export function applyResaleFee(jackpot, resalePrice) {
  const fee = Math.floor(resalePrice * 0.10);
  return {
    ...jackpot,
    pool: jackpot.pool + fee,
  };
}
