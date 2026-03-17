import { describe, it, expect, beforeEach } from 'vitest';
import {
    TIERS,
    KARMA_EVENTS,
    getTier,
    calculateKarmaChange,
    applyKarma,
    checkCooldown,
    checkAntiGaming,
    getKarmaHistory,
} from '../lib/reputation.js';

/* ── Helpers ────────────────────────────────────────────── */
function makeRep(karma = 0, history = []) {
    return { karma, tier: getTier(karma).name, history };
}

/* ══════════════════════════════════════════════════════════
   getTier
   ══════════════════════════════════════════════════════════ */
describe('getTier', () => {
    it('returns newcomer for karma 0', () => {
        expect(getTier(0).name).toBe('newcomer');
    });

    it('returns newcomer for karma 49 (upper boundary)', () => {
        expect(getTier(49).name).toBe('newcomer');
    });

    it('returns regular for karma 50 (lower boundary)', () => {
        expect(getTier(50).name).toBe('regular');
    });

    it('returns regular for karma 199 (upper boundary)', () => {
        expect(getTier(199).name).toBe('regular');
    });

    it('returns trusted for karma 200', () => {
        expect(getTier(200).name).toBe('trusted');
    });

    it('returns legend for karma 500', () => {
        expect(getTier(500).name).toBe('legend');
    });

    it('returns mythic for karma 1000', () => {
        expect(getTier(1000).name).toBe('mythic');
    });

    it('returns mythic for karma well above 1000', () => {
        expect(getTier(99999).name).toBe('mythic');
    });
});

/* ══════════════════════════════════════════════════════════
   calculateKarmaChange
   ══════════════════════════════════════════════════════════ */
describe('calculateKarmaChange', () => {
    it('TIP_RECEIVED: 500 chips → +10', () => {
        expect(calculateKarmaChange(KARMA_EVENTS.TIP_RECEIVED, { amount: 500 }).delta).toBe(10);
    });

    it('TIP_RECEIVED: 100 chips → +2', () => {
        expect(calculateKarmaChange(KARMA_EVENTS.TIP_RECEIVED, { amount: 100 }).delta).toBe(2);
    });

    it('TIP_RECEIVED: 50 chips → +1 (floor)', () => {
        expect(calculateKarmaChange(KARMA_EVENTS.TIP_RECEIVED, { amount: 50 }).delta).toBe(1);
    });

    it('GAME_WIN → +3', () => {
        expect(calculateKarmaChange(KARMA_EVENTS.GAME_WIN).delta).toBe(3);
    });

    it('REACTION_RECEIVED → +1', () => {
        expect(calculateKarmaChange(KARMA_EVENTS.REACTION_RECEIVED).delta).toBe(1);
    });

    it('DEAD_DROP_UPVOTED: 10 upvotes → +4', () => {
        expect(calculateKarmaChange(KARMA_EVENTS.DEAD_DROP_UPVOTED, { upvotes: 10 }).delta).toBe(4);
    });

    it('BOUNTY_WON → +5', () => {
        expect(calculateKarmaChange(KARMA_EVENTS.BOUNTY_WON).delta).toBe(5);
    });

    it('KICKED → -10', () => {
        expect(calculateKarmaChange(KARMA_EVENTS.KICKED).delta).toBe(-10);
    });

    it('BANNED → -50', () => {
        expect(calculateKarmaChange(KARMA_EVENTS.BANNED).delta).toBe(-50);
    });

    it('DAILY_STREAK with streakCount 7 → +1', () => {
        expect(calculateKarmaChange(KARMA_EVENTS.DAILY_STREAK, { streakCount: 7 }).delta).toBe(1);
    });

    it('DAILY_STREAK with streakCount < 7 → 0', () => {
        expect(calculateKarmaChange(KARMA_EVENTS.DAILY_STREAK, { streakCount: 6 }).delta).toBe(0);
    });

    it('IDLE_DECAY → -1', () => {
        expect(calculateKarmaChange(KARMA_EVENTS.IDLE_DECAY).delta).toBe(-1);
    });

    it('unknown event → 0', () => {
        expect(calculateKarmaChange('totally_unknown').delta).toBe(0);
    });
});

/* ══════════════════════════════════════════════════════════
   applyKarma
   ══════════════════════════════════════════════════════════ */
describe('applyKarma', () => {
    it('adds event to history', () => {
        const rep    = makeRep(100);
        const result = applyKarma(rep, KARMA_EVENTS.GAME_WIN, { gameType: 'blackjack' }, 1_000_000);
        expect(result.history).toHaveLength(1);
        expect(result.history[0].eventType).toBe(KARMA_EVENTS.GAME_WIN);
    });

    it('history is newest-first', () => {
        let rep = makeRep(100);
        rep = applyKarma(rep, KARMA_EVENTS.BOUNTY_WON, {}, 1000);
        rep = applyKarma(rep, KARMA_EVENTS.REACTION_RECEIVED, {}, 2000);
        expect(rep.history[0].eventType).toBe(KARMA_EVENTS.REACTION_RECEIVED);
        expect(rep.history[1].eventType).toBe(KARMA_EVENTS.BOUNTY_WON);
    });

    it('caps history at 50 entries', () => {
        let rep = makeRep(300);
        for (let i = 0; i < 60; i++) {
            // Use unique reactorId + messageId each time to bypass cooldown
            rep = applyKarma(rep, KARMA_EVENTS.REACTION_RECEIVED, { reactorId: `r${i}`, messageId: `m${i}` }, i);
        }
        expect(rep.history).toHaveLength(50);
    });

    it('karma floor at 0 (never negative)', () => {
        const rep    = makeRep(5);
        const result = applyKarma(rep, KARMA_EVENTS.BANNED, {}, Date.now());
        expect(result.karma).toBe(0);
    });

    it('BANNED resets tier to newcomer even when karma would be higher', () => {
        const rep    = makeRep(900);
        const result = applyKarma(rep, KARMA_EVENTS.BANNED, {}, Date.now());
        expect(result.tier).toBe('newcomer');
    });

    it('recalculates tier on threshold crossing (newcomer → regular)', () => {
        const rep    = makeRep(48);
        const result = applyKarma(rep, KARMA_EVENTS.BOUNTY_WON, {}, Date.now());
        // 48 + 5 = 53 → regular
        expect(result.tier).toBe('regular');
    });

    it('does not mutate the original reputation object', () => {
        const rep    = makeRep(100);
        applyKarma(rep, KARMA_EVENTS.GAME_WIN, { gameType: 'slots' }, Date.now());
        expect(rep.history).toHaveLength(0);
        expect(rep.karma).toBe(100);
    });

    it('returns unchanged reputation when cooldown is active (GAME_WIN same type within hour)', () => {
        let rep = makeRep(100);
        const now = Date.now();
        // First GAME_WIN for blackjack succeeds
        rep = applyKarma(rep, KARMA_EVENTS.GAME_WIN, { gameType: 'blackjack' }, now);
        const karmaBefore = rep.karma;
        const historyLen = rep.history.length;
        // Second GAME_WIN for blackjack within same hour — should be blocked by cooldown
        const result = applyKarma(rep, KARMA_EVENTS.GAME_WIN, { gameType: 'blackjack' }, now + 1000);
        expect(result.karma).toBe(karmaBefore);
        expect(result.history).toHaveLength(historyLen); // no new entry added
    });

    it('allows GAME_WIN for different gameType even during cooldown', () => {
        let rep = makeRep(100);
        const now = Date.now();
        rep = applyKarma(rep, KARMA_EVENTS.GAME_WIN, { gameType: 'blackjack' }, now);
        const karmaBefore = rep.karma;
        // Different gameType should NOT be blocked
        const result = applyKarma(rep, KARMA_EVENTS.GAME_WIN, { gameType: 'roulette' }, now + 1000);
        expect(result.karma).toBeGreaterThan(karmaBefore);
    });
});

/* ══════════════════════════════════════════════════════════
   checkCooldown
   ══════════════════════════════════════════════════════════ */
describe('checkCooldown', () => {
    const now = Date.now();

    it('GAME_WIN blocks same gameType within 1 hour', () => {
        const rep = makeRep(100, [{
            eventType: KARMA_EVENTS.GAME_WIN,
            timestamp: now - 1800_000,      // 30 min ago
            data: { gameType: 'blackjack' },
        }]);
        expect(checkCooldown(rep, KARMA_EVENTS.GAME_WIN, { gameType: 'blackjack' })).toBe(true);
    });

    it('GAME_WIN allows same gameType after 1 hour', () => {
        const rep = makeRep(100, [{
            eventType: KARMA_EVENTS.GAME_WIN,
            timestamp: now - 3_700_000,     // just over 1 hour ago
            data: { gameType: 'blackjack' },
        }]);
        expect(checkCooldown(rep, KARMA_EVENTS.GAME_WIN, { gameType: 'blackjack' })).toBe(false);
    });

    it('GAME_WIN allows different gameType within 1 hour', () => {
        const rep = makeRep(100, [{
            eventType: KARMA_EVENTS.GAME_WIN,
            timestamp: now - 1800_000,
            data: { gameType: 'blackjack' },
        }]);
        expect(checkCooldown(rep, KARMA_EVENTS.GAME_WIN, { gameType: 'roulette' })).toBe(false);
    });

    it('REACTION_RECEIVED blocks same reactorId + messageId', () => {
        const rep = makeRep(100, [{
            eventType: KARMA_EVENTS.REACTION_RECEIVED,
            timestamp: now - 60_000,
            data: { reactorId: 'alice', messageId: 'msg-1' },
        }]);
        expect(checkCooldown(rep, KARMA_EVENTS.REACTION_RECEIVED, { reactorId: 'alice', messageId: 'msg-1' })).toBe(true);
    });

    it('REACTION_RECEIVED allows different reactorId on same message', () => {
        const rep = makeRep(100, [{
            eventType: KARMA_EVENTS.REACTION_RECEIVED,
            timestamp: now - 60_000,
            data: { reactorId: 'alice', messageId: 'msg-1' },
        }]);
        expect(checkCooldown(rep, KARMA_EVENTS.REACTION_RECEIVED, { reactorId: 'bob', messageId: 'msg-1' })).toBe(false);
    });

    it('TIP_RECEIVED has no cooldown', () => {
        const rep = makeRep(100, [{
            eventType: KARMA_EVENTS.TIP_RECEIVED,
            timestamp: now - 1000,
            data: {},
        }]);
        expect(checkCooldown(rep, KARMA_EVENTS.TIP_RECEIVED, {})).toBe(false);
    });
});

/* ══════════════════════════════════════════════════════════
   checkAntiGaming
   ══════════════════════════════════════════════════════════ */
describe('checkAntiGaming', () => {
    const now = Date.now();

    it('blocks self-tip (same device hash)', () => {
        const rep    = makeRep(100);
        const result = checkAntiGaming('device-A', 'device-A', rep, KARMA_EVENTS.TIP_RECEIVED);
        expect(result.blocked).toBe(true);
        expect(result.reason).toMatch(/self/i);
    });

    it('blocks tip cycling within 10 minutes', () => {
        // rep history shows that "toDeviceHash" (device-B) tipped "fromDeviceHash" (device-A) 5 min ago
        const rep = makeRep(100, [{
            eventType: KARMA_EVENTS.TIP_RECEIVED,
            timestamp: now - 300_000,       // 5 min ago
            data: { fromDeviceHash: 'device-B' },
        }]);
        // Now device-A tips device-B — this is cycling
        const result = checkAntiGaming('device-A', 'device-B', rep, KARMA_EVENTS.TIP_RECEIVED);
        expect(result.blocked).toBe(true);
        expect(result.reason).toMatch(/cycling/i);
    });

    it('allows tip from same pair after 10 minutes', () => {
        const rep = makeRep(100, [{
            eventType: KARMA_EVENTS.TIP_RECEIVED,
            timestamp: now - 700_000,       // 11+ min ago
            data: { fromDeviceHash: 'device-B' },
        }]);
        const result = checkAntiGaming('device-A', 'device-B', rep, KARMA_EVENTS.TIP_RECEIVED);
        expect(result.blocked).toBe(false);
    });

    it('passes through non-tip events without blocking', () => {
        const rep    = makeRep(100);
        const result = checkAntiGaming('device-A', 'device-B', rep, KARMA_EVENTS.GAME_WIN);
        expect(result.blocked).toBe(false);
    });
});

/* ══════════════════════════════════════════════════════════
   getKarmaHistory
   ══════════════════════════════════════════════════════════ */
describe('getKarmaHistory', () => {
    it('returns at most limit entries (default 10)', () => {
        const history = Array.from({ length: 20 }, (_, i) => ({
            eventType: KARMA_EVENTS.REACTION_RECEIVED,
            timestamp: i,
            delta: 1,
            data: {},
        }));
        const rep = makeRep(100, history);
        expect(getKarmaHistory(rep)).toHaveLength(10);
    });

    it('respects custom limit', () => {
        const history = Array.from({ length: 20 }, (_, i) => ({
            eventType: KARMA_EVENTS.REACTION_RECEIVED,
            timestamp: i,
            delta: 1,
            data: {},
        }));
        const rep = makeRep(100, history);
        expect(getKarmaHistory(rep, 5)).toHaveLength(5);
    });

    it('returns empty array for reputation with no history', () => {
        const rep = makeRep(0);
        expect(getKarmaHistory(rep)).toEqual([]);
    });
});
