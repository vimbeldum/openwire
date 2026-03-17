/* ═══════════════════════════════════════════════════════════
   OpenWire — Reputation / Karma System
   Pure ESM, no React, no side-effects.
   All state is immutable: functions return new objects.
   ═══════════════════════════════════════════════════════════ */

/* ── Tier definitions ────────────────────────────────────── */
export const TIERS = [
    { name: 'newcomer', min: 0,    max: 49,       color: null,      badge: null,  cssClass: 'tier-newcomer' },
    { name: 'regular',  min: 50,   max: 199,      color: '#00D4FF', badge: '★',   cssClass: 'tier-regular'  },
    { name: 'trusted',  min: 200,  max: 499,      color: '#FFD700', badge: '★★',  cssClass: 'tier-trusted'  },
    { name: 'legend',   min: 500,  max: 999,      color: '#A855F7', badge: '★★★', cssClass: 'tier-legend'   },
    { name: 'mythic',   min: 1000, max: Infinity, color: 'rainbow', badge: '👑',  cssClass: 'tier-mythic'   },
];

/* ── Karma event type constants ──────────────────────────── */
export const KARMA_EVENTS = {
    TIP_RECEIVED:        'tip_received',
    GAME_WIN:            'game_win',
    REACTION_RECEIVED:   'reaction_received',
    DEAD_DROP_UPVOTED:   'dead_drop_upvoted',
    BOUNTY_WON:          'bounty_won',
    KICKED:              'kicked',
    BANNED:              'banned',
    DAILY_STREAK:        'daily_streak',
    IDLE_DECAY:          'idle_decay',
};

const HISTORY_LIMIT = 50;
const ONE_HOUR_MS   = 3_600_000;
const TEN_MIN_MS    =   600_000;

/* ── 1. getTier ──────────────────────────────────────────── */
/**
 * Returns the TIERS entry whose [min, max] range contains karma.
 * @param {number} karma
 * @returns {object} tier entry
 */
export function getTier(karma) {
    return TIERS.find(t => karma >= t.min && karma <= t.max) ?? TIERS[0];
}

/* ── 2. calculateKarmaChange ─────────────────────────────── */
/**
 * Pure function — computes the karma delta for a given event.
 * @param {string} eventType  One of KARMA_EVENTS values
 * @param {object} data       Event-specific payload
 * @returns {{ delta: number, reason: string }}
 */
export function calculateKarmaChange(eventType, data = {}) {
    switch (eventType) {
        case KARMA_EVENTS.TIP_RECEIVED:
            return {
                delta:  Math.floor(((data.amount ?? 0) / 100) * 2),
                reason: `Tip received: ${data.amount ?? 0} chips`,
            };
        case KARMA_EVENTS.GAME_WIN:
            return { delta: 3, reason: 'Game win' };
        case KARMA_EVENTS.REACTION_RECEIVED:
            return { delta: 1, reason: 'Reaction received' };
        case KARMA_EVENTS.DEAD_DROP_UPVOTED:
            return {
                delta:  Math.floor((data.upvotes ?? 0) / 5) * 2,
                reason: `Dead drop upvoted: ${data.upvotes ?? 0} votes`,
            };
        case KARMA_EVENTS.BOUNTY_WON:
            return { delta: 5, reason: 'Bounty won' };
        case KARMA_EVENTS.KICKED:
            return { delta: -10, reason: 'Kicked from room' };
        case KARMA_EVENTS.BANNED:
            return { delta: -50, reason: 'Banned' };
        case KARMA_EVENTS.DAILY_STREAK:
            return {
                delta:  (data.streakCount ?? 0) >= 7 ? 1 : 0,
                reason: `Daily streak: ${data.streakCount} days`,
            };
        case KARMA_EVENTS.IDLE_DECAY:
            return { delta: -1, reason: 'Idle decay' };
        default:
            return { delta: 0, reason: `Unknown event: ${eventType}` };
    }
}

/* ── 3. applyKarma ───────────────────────────────────────── */
/**
 * Immutably applies a karma event to a reputation object.
 * @param {object} reputation  Current reputation state
 * @param {string} eventType
 * @param {object} data
 * @param {number} timestamp   Unix ms (defaults to Date.now())
 * @returns {{ karma: number, tier: string, history: Array }}
 */
export function applyKarma(reputation, eventType, data = {}, timestamp = Date.now()) {
    if (checkCooldown(reputation, eventType, data, timestamp)) {
        return { ...reputation };
    }

    const { delta, reason } = calculateKarmaChange(eventType, data);

    let newKarma = Math.max(0, (reputation.karma ?? 0) + delta);

    // BANNED resets karma to 0 so the user must rebuild reputation
    if (eventType === KARMA_EVENTS.BANNED) {
        newKarma = 0;
    }

    const entry = {
        eventType,
        delta: eventType === KARMA_EVENTS.BANNED ? -(reputation.karma ?? 0) : delta,
        reason,
        timestamp,
        data: { ...data },
    };

    const history = [entry, ...(reputation.history ?? [])].slice(0, HISTORY_LIMIT);

    const tier = eventType === KARMA_EVENTS.BANNED
        ? 'newcomer'
        : getTier(newKarma).name;

    return { karma: newKarma, tier, history };
}

/* ── 4. checkCooldown ────────────────────────────────────── */
/**
 * Returns true if the event is on cooldown and should be skipped.
 * @param {object} reputation
 * @param {string} eventType
 * @param {object} data
 * @returns {boolean}
 */
export function checkCooldown(reputation, eventType, data = {}, nowMs = Date.now()) {
    const history = reputation.history ?? [];
    const now     = nowMs;

    if (eventType === KARMA_EVENTS.GAME_WIN) {
        const gameType = data.gameType;
        return history.some(
            e =>
                e.eventType === KARMA_EVENTS.GAME_WIN &&
                e.data?.gameType === gameType &&
                now - e.timestamp < ONE_HOUR_MS,
        );
    }

    if (eventType === KARMA_EVENTS.REACTION_RECEIVED) {
        const { reactorId, messageId } = data;
        return history.some(
            e =>
                e.eventType === KARMA_EVENTS.REACTION_RECEIVED &&
                e.data?.reactorId === reactorId &&
                e.data?.messageId === messageId,
        );
    }

    return false;
}

/* ── 5. checkAntiGaming ──────────────────────────────────── */
/**
 * Detects self-tipping and tip-cycling abuse.
 * @param {string} fromDeviceHash  Sender device hash
 * @param {string} toDeviceHash    Recipient device hash
 * @param {object} reputation      Recipient's reputation (for history)
 * @param {string} eventType
 * @returns {{ blocked: boolean, reason: string }}
 */
export function checkAntiGaming(fromDeviceHash, toDeviceHash, reputation, eventType) {
    if (eventType !== KARMA_EVENTS.TIP_RECEIVED) {
        return { blocked: false, reason: '' };
    }

    // Self-tip detection
    if (fromDeviceHash === toDeviceHash) {
        return { blocked: true, reason: 'Self-tipping is not allowed' };
    }

    // Tip-cycling: recipient tipped the sender within the last 10 minutes
    const history = reputation.history ?? [];
    const now     = Date.now();
    const cycling = history.some(
        e =>
            e.eventType === KARMA_EVENTS.TIP_RECEIVED &&
            e.data?.fromDeviceHash === toDeviceHash &&
            now - e.timestamp < TEN_MIN_MS,
    );

    if (cycling) {
        return { blocked: true, reason: 'Tip cycling detected within 10 minutes' };
    }

    return { blocked: false, reason: '' };
}

/* ── 6. getKarmaHistory ──────────────────────────────────── */
/**
 * Returns the most recent karma events, newest first.
 * @param {object} reputation
 * @param {number} limit  Max entries to return (default 10)
 * @returns {Array}
 */
export function getKarmaHistory(reputation, limit = 10) {
    return (reputation.history ?? []).slice(0, limit);
}
