import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    MIN_REWARD,
    MAX_REWARD,
    MIN_KARMA_TO_CREATE,
    MAX_ACTIVE_PER_USER,
    EXPIRY_MS,
    VOTING_DURATION_MS,
    WIN_THRESHOLD,
    MAX_SUBMISSIONS,
    createBounty,
    escrowBounty,
    submitAttempt,
    castVote,
    resolveBounty,
    expireBounty,
    releaseEscrow,
    refundEscrow,
} from '../lib/bounties.js';

/* ── Helpers ─────────────────────────────────────────────── */

const NOW = 1_000_000;
const ROOM = 'room_abc';

function makeWallet(overrides = {}) {
    return {
        deviceId: 'creator-device',
        nick: 'CoolGuy99',
        baseBalance: 2000,
        adminBonus: 0,
        ...overrides,
    };
}

/**
 * Creates a valid bounty directly via createBounty() with sensible defaults.
 * activeBounties defaults to [] unless overridden.
 */
function makeBounty({
    deviceId = 'creator-device',
    nick = 'CoolGuy99',
    description = 'Do something cool',
    reward = 500,
    karma = 300,
    activeBounties = [],
    nowMs = NOW,
} = {}) {
    return createBounty(ROOM, deviceId, nick, description, reward, karma, activeBounties, nowMs);
}

/* ═══════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════ */

describe('Constants', () => {
    it('MIN_REWARD is 100', () => expect(MIN_REWARD).toBe(100));
    it('MAX_REWARD is 5000', () => expect(MAX_REWARD).toBe(5000));
    it('MIN_KARMA_TO_CREATE is 200', () => expect(MIN_KARMA_TO_CREATE).toBe(200));
    it('MAX_ACTIVE_PER_USER is 2', () => expect(MAX_ACTIVE_PER_USER).toBe(2));
    it('EXPIRY_MS is 1 hour', () => expect(EXPIRY_MS).toBe(60 * 60 * 1000));
    it('VOTING_DURATION_MS is 10 minutes', () => expect(VOTING_DURATION_MS).toBe(10 * 60 * 1000));
    it('WIN_THRESHOLD is 0.6', () => expect(WIN_THRESHOLD).toBe(0.6));
    it('MAX_SUBMISSIONS is 5', () => expect(MAX_SUBMISSIONS).toBe(5));
});

/* ═══════════════════════════════════════════════════════════════
   1 -- createBounty
   ═══════════════════════════════════════════════════════════════ */

describe('createBounty', () => {
    it('succeeds with valid inputs', () => {
        const result = makeBounty();
        expect(result.success).toBe(true);
        expect(result.bounty).toBeDefined();
        expect(result.bounty.status).toBe('open');
        expect(result.bounty.roomId).toBe(ROOM);
        expect(result.bounty.reward).toBe(500);
        expect(result.bounty.submissions).toEqual([]);
        expect(result.bounty.votedBy).toEqual([]);
        expect(result.bounty.winnerId).toBeNull();
    });

    it('sets expiresAt to nowMs + EXPIRY_MS', () => {
        const result = makeBounty({ nowMs: NOW });
        expect(result.bounty.expiresAt).toBe(NOW + EXPIRY_MS);
    });

    it('blocked when karma < MIN_KARMA_TO_CREATE', () => {
        const result = makeBounty({ karma: 199 });
        expect(result.success).toBe(false);
        expect(result.reason).toBe('insufficient_karma');
    });

    it('blocked when karma is exactly MIN_KARMA_TO_CREATE - 1', () => {
        const result = makeBounty({ karma: MIN_KARMA_TO_CREATE - 1 });
        expect(result.success).toBe(false);
    });

    it('succeeds when karma equals MIN_KARMA_TO_CREATE exactly', () => {
        const result = makeBounty({ karma: MIN_KARMA_TO_CREATE });
        expect(result.success).toBe(true);
    });

    it('blocked when reward < MIN_REWARD', () => {
        const result = makeBounty({ reward: 99 });
        expect(result.success).toBe(false);
        expect(result.reason).toBe('invalid_reward');
    });

    it('blocked when reward > MAX_REWARD', () => {
        const result = makeBounty({ reward: 5001 });
        expect(result.success).toBe(false);
        expect(result.reason).toBe('invalid_reward');
    });

    it('blocked when reward is exactly MIN_REWARD - 1', () => {
        expect(makeBounty({ reward: MIN_REWARD - 1 }).success).toBe(false);
    });

    it('succeeds when reward equals MIN_REWARD exactly', () => {
        expect(makeBounty({ reward: MIN_REWARD }).success).toBe(true);
    });

    it('succeeds when reward equals MAX_REWARD exactly', () => {
        expect(makeBounty({ reward: MAX_REWARD }).success).toBe(true);
    });

    it('blocked when description is empty string', () => {
        const result = makeBounty({ description: '' });
        expect(result.success).toBe(false);
        expect(result.reason).toBe('empty_description');
    });

    it('blocked when description is only whitespace', () => {
        const result = makeBounty({ description: '   ' });
        expect(result.success).toBe(false);
        expect(result.reason).toBe('empty_description');
    });

    it('blocked when description exceeds 300 chars', () => {
        const result = makeBounty({ description: 'x'.repeat(301) });
        expect(result.success).toBe(false);
        expect(result.reason).toBe('description_too_long');
    });

    it('succeeds when description is exactly 300 chars', () => {
        const result = makeBounty({ description: 'x'.repeat(300) });
        expect(result.success).toBe(true);
    });

    it('blocked when creator has MAX_ACTIVE_PER_USER active bounties in room', () => {
        // Create MAX_ACTIVE_PER_USER bounties for the same creator
        const existingBounties = [];
        for (let i = 0; i < MAX_ACTIVE_PER_USER; i++) {
            const r = makeBounty({ activeBounties: existingBounties });
            existingBounties.push(r.bounty);
        }

        const result = makeBounty({ activeBounties: existingBounties });
        expect(result.success).toBe(false);
        expect(result.reason).toBe('too_many_active_bounties');
    });

    it('allows a different creator in the same room regardless of existing bounties', () => {
        const existingBounties = [];
        for (let i = 0; i < MAX_ACTIVE_PER_USER; i++) {
            const r = makeBounty({ activeBounties: existingBounties });
            existingBounties.push(r.bounty);
        }
        // Different device — should succeed
        const result = makeBounty({ deviceId: 'other-device', activeBounties: existingBounties });
        expect(result.success).toBe(true);
    });

    it('counts only open/voting bounties against the limit (resolved ones do not count)', () => {
        const r1 = makeBounty();
        const resolvedBounty = { ...r1.bounty, status: 'resolved' };
        const r2 = makeBounty();
        const expiredBounty = { ...r2.bounty, status: 'expired' };

        // Two resolved/expired bounties should not block a new one
        const result = makeBounty({ activeBounties: [resolvedBounty, expiredBounty] });
        expect(result.success).toBe(true);
    });
});

/* ═══════════════════════════════════════════════════════════════
   2 -- escrowBounty
   ═══════════════════════════════════════════════════════════════ */

describe('escrowBounty', () => {
    it('deducts reward from wallet baseBalance', () => {
        const wallet = makeWallet({ baseBalance: 1000 });
        const { bounty } = makeBounty({ reward: 500 });
        const result = escrowBounty(wallet, bounty);

        expect(result.success).toBe(true);
        expect(result.wallet.baseBalance).toBe(500);
    });

    it('spills to adminBonus when baseBalance is insufficient', () => {
        const wallet = makeWallet({ baseBalance: 100, adminBonus: 500 });
        const { bounty } = makeBounty({ reward: 300 });
        const result = escrowBounty(wallet, bounty);

        expect(result.success).toBe(true);
        expect(result.wallet.baseBalance).toBe(0);
        expect(result.wallet.adminBonus).toBe(300);
    });

    it('fails if total balance is insufficient', () => {
        const wallet = makeWallet({ baseBalance: 50, adminBonus: 0 });
        const { bounty } = makeBounty({ reward: 500 });
        const result = escrowBounty(wallet, bounty);

        expect(result.success).toBe(false);
        expect(result.reason).toBe('insufficient_balance');
    });

    it('adds escrowedAt timestamp to the bounty', () => {
        const wallet = makeWallet({ baseBalance: 2000 });
        const { bounty } = makeBounty({ reward: 500 });
        const result = escrowBounty(wallet, bounty);

        expect(result.bounty.escrowedAt).toBeDefined();
        expect(typeof result.bounty.escrowedAt).toBe('number');
    });

    it('does not mutate original wallet', () => {
        const wallet = makeWallet({ baseBalance: 1000 });
        const { bounty } = makeBounty({ reward: 500 });
        escrowBounty(wallet, bounty);
        expect(wallet.baseBalance).toBe(1000); // unchanged
    });

    it('persists wallet synchronously to localStorage after escrow', () => {
        // Mock localStorage for this test — bounties.js calls it inline
        const origSetItem = globalThis.localStorage?.setItem;
        const setItemSpy = vi.fn();
        globalThis.localStorage = { ...globalThis.localStorage, setItem: setItemSpy, getItem: vi.fn(() => null) };

        const wallet = makeWallet({ baseBalance: 1000, deviceId: 'test-dev-bounty' });
        const { bounty } = makeBounty({ reward: 500 });
        const result = escrowBounty(wallet, bounty);

        expect(result.success).toBe(true);
        // Wallet should have been saved synchronously to localStorage
        expect(setItemSpy).toHaveBeenCalledWith(
            'openwire_wallet_dev_test-dev-bounty',
            expect.stringContaining('"baseBalance":500'),
        );

        // Restore
        if (origSetItem) globalThis.localStorage.setItem = origSetItem;
    });
});

/* ═══════════════════════════════════════════════════════════════
   3 -- submitAttempt
   ═══════════════════════════════════════════════════════════════ */

describe('submitAttempt', () => {
    let bounty;

    beforeEach(() => {
        bounty = makeBounty({ nowMs: NOW }).bounty;
    });

    it('adds submission to the bounty', () => {
        const result = submitAttempt(bounty, 'user-1', 'Alice', 'msg_001', NOW + 1000);
        expect(result.success).toBe(true);
        expect(result.bounty.submissions).toHaveLength(1);
        expect(result.bounty.submissions[0].nick).toBe('Alice');
        expect(result.bounty.submissions[0].messageRef).toBe('msg_001');
        expect(result.bounty.submissions[0].votes).toBe(0);
    });

    it('stores hashed deviceId, not the raw ID', () => {
        const result = submitAttempt(bounty, 'user-1', 'Alice', 'msg_001', NOW + 1000);
        expect(result.bounty.submissions[0].deviceHash).not.toBe('user-1');
        expect(typeof result.bounty.submissions[0].deviceHash).toBe('string');
    });

    it('status becomes voting when 2+ submissions exist', () => {
        let b = submitAttempt(bounty, 'user-1', 'Alice', 'msg_001', NOW + 1000).bounty;
        expect(b.status).toBe('open');

        b = submitAttempt(b, 'user-2', 'Bob', 'msg_002', NOW + 2000).bounty;
        expect(b.status).toBe('voting');
    });

    it('sets votingEndsAt when transitioning to voting', () => {
        let b = submitAttempt(bounty, 'user-1', 'Alice', 'msg_001', NOW + 1000).bounty;
        b = submitAttempt(b, 'user-2', 'Bob', 'msg_002', NOW + 2000).bounty;
        expect(b.votingEndsAt).toBe(NOW + 2000 + VOTING_DURATION_MS);
    });

    it('allows submission when status is voting', () => {
        let b = submitAttempt(bounty, 'user-1', 'Alice', 'msg_001', NOW + 1000).bounty;
        b = submitAttempt(b, 'user-2', 'Bob',   'msg_002', NOW + 2000).bounty; // triggers voting
        const result = submitAttempt(b, 'user-3', 'Carol', 'msg_003', NOW + 3000);
        expect(result.success).toBe(true);
    });

    it('blocked when status is resolved', () => {
        const resolvedBounty = { ...bounty, status: 'resolved' };
        const result = submitAttempt(resolvedBounty, 'user-1', 'Alice', 'msg_001', NOW + 1000);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('bounty_not_accepting_submissions');
    });

    it('blocked after expiry time', () => {
        const result = submitAttempt(bounty, 'user-1', 'Alice', 'msg_001', NOW + EXPIRY_MS + 1);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('bounty_expired');
    });

    it('blocked when user reaches MAX_SUBMISSIONS', () => {
        let b = bounty;
        for (let i = 0; i < MAX_SUBMISSIONS; i++) {
            b = submitAttempt(b, 'user-1', 'Alice', `msg_${i}`, NOW + 1000 + i).bounty;
        }
        const result = submitAttempt(b, 'user-1', 'Alice', 'msg_extra', NOW + 9000);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('max_submissions_reached');
    });

    it('does not mutate the original bounty', () => {
        const original = { ...bounty, submissions: [...bounty.submissions] };
        submitAttempt(bounty, 'user-1', 'Alice', 'msg_001', NOW + 1000);
        expect(bounty.submissions).toHaveLength(original.submissions.length);
    });
});

/* ═══════════════════════════════════════════════════════════════
   4 -- castVote
   ═══════════════════════════════════════════════════════════════ */

describe('castVote', () => {
    /**
     * Sets up a bounty in 'voting' status with two submissions
     * from 'user-1' (Alice) and 'user-2' (Bob).
     */
    function makeVotingBounty() {
        let b = makeBounty({ deviceId: 'creator-device', nowMs: NOW }).bounty;
        b = submitAttempt(b, 'user-1', 'Alice', 'msg_001', NOW + 1000).bounty;
        b = submitAttempt(b, 'user-2', 'Bob',   'msg_002', NOW + 2000).bounty;
        return b;
    }

    it('increments vote count for target submission', () => {
        const b = makeVotingBounty();
        const result = castVote(b, 'voter-1', 0, 10, NOW + 3000);
        expect(result.success).toBe(true);
        expect(result.bounty.submissions[0].votes).toBe(1);
    });

    it('adds voter hash to votedBy list', () => {
        const b = makeVotingBounty();
        const result = castVote(b, 'voter-1', 0, 10, NOW + 3000);
        expect(result.bounty.votedBy).toHaveLength(1);
    });

    it('creator cannot vote', () => {
        const b = makeVotingBounty();
        // Creator's raw device ID is 'creator-device'
        const result = castVote(b, 'creator-device', 0, 10, NOW + 3000);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('creator_cannot_vote');
    });

    it('same voter cannot vote twice', () => {
        let b = makeVotingBounty();
        b = castVote(b, 'voter-1', 0, 10, NOW + 3000).bounty;
        const result = castVote(b, 'voter-1', 1, 10, NOW + 3000);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('already_voted');
    });

    it('voter cannot vote for own submission', () => {
        const b = makeVotingBounty();
        // 'user-1' submitted at index 0 — they should not be able to vote for themselves
        const result = castVote(b, 'user-1', 0, 10, NOW + 3000);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('cannot_vote_own_submission');
    });

    it('fails when submissionIndex is out of range', () => {
        const b = makeVotingBounty();
        const result = castVote(b, 'voter-1', 99, 10, NOW + 3000);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('invalid_submission_index');
    });

    it('fails when status is not voting', () => {
        const b = makeBounty({ nowMs: NOW }).bounty; // status === 'open'
        const result = castVote(b, 'voter-1', 0, 10, NOW + 3000);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('voting_not_open');
    });

    it('triggers early resolution when votes reach WIN_THRESHOLD * participants', () => {
        const participants = 5;
        // WIN_THRESHOLD (0.6) * 5 = 3 votes needed
        let b = makeVotingBounty();

        b = castVote(b, 'voter-1', 0, participants, NOW + 3000).bounty;
        b = castVote(b, 'voter-2', 0, participants, NOW + 4000).bounty;
        const result = castVote(b, 'voter-3', 0, participants, NOW + 5000);

        expect(result.success).toBe(true);
        expect(result.triggered).toBe('resolved');
        expect(result.bounty.status).toBe('resolved');
    });

    it('triggers resolution when votingEndsAt has passed', () => {
        let b = makeVotingBounty();
        b = castVote(b, 'voter-1', 0, 10, NOW + 3000).bounty;

        // Vote at a time after votingEndsAt
        const afterVotingEnd = b.votingEndsAt + 1;
        const result = castVote(b, 'voter-2', 1, 10, afterVotingEnd);

        expect(result.triggered).toBe('resolved');
        expect(result.bounty.status).toBe('resolved');
    });
});

/* ═══════════════════════════════════════════════════════════════
   5 -- resolveBounty
   ═══════════════════════════════════════════════════════════════ */

describe('resolveBounty', () => {
    it('picks the submission with the highest vote count as winner', () => {
        const b = {
            ...makeBounty({ nowMs: NOW }).bounty,
            status: 'voting',
            submissions: [
                { deviceHash: 'hash-alice', nick: 'Alice', messageRef: 'm1', votes: 3 },
                { deviceHash: 'hash-bob',   nick: 'Bob',   messageRef: 'm2', votes: 5 },
            ],
        };

        const resolved = resolveBounty(b, NOW + 5000);
        expect(resolved.status).toBe('resolved');
        expect(resolved.winnerId).toBe('hash-bob');
    });

    it('sets winnerId to null on a tie', () => {
        const b = {
            ...makeBounty({ nowMs: NOW }).bounty,
            status: 'voting',
            submissions: [
                { deviceHash: 'hash-alice', nick: 'Alice', messageRef: 'm1', votes: 3 },
                { deviceHash: 'hash-bob',   nick: 'Bob',   messageRef: 'm2', votes: 3 },
            ],
        };

        const resolved = resolveBounty(b, NOW + 5000);
        expect(resolved.status).toBe('resolved');
        expect(resolved.winnerId).toBeNull();
    });

    it('sets winnerId to null when there are no submissions', () => {
        const b = { ...makeBounty({ nowMs: NOW }).bounty, status: 'voting', submissions: [] };
        const resolved = resolveBounty(b, NOW + 5000);
        expect(resolved.winnerId).toBeNull();
    });

    it('sets resolvedAt timestamp', () => {
        const b = {
            ...makeBounty({ nowMs: NOW }).bounty,
            status: 'voting',
            submissions: [
                { deviceHash: 'hash-alice', nick: 'Alice', messageRef: 'm1', votes: 2 },
            ],
        };

        const resolved = resolveBounty(b, NOW + 6000);
        expect(resolved.resolvedAt).toBe(NOW + 6000);
    });

    it('does not mutate the original bounty', () => {
        const b = {
            ...makeBounty({ nowMs: NOW }).bounty,
            status: 'voting',
            submissions: [{ deviceHash: 'hash-alice', nick: 'Alice', messageRef: 'm1', votes: 1 }],
        };
        const originalStatus = b.status;
        resolveBounty(b, NOW + 5000);
        expect(b.status).toBe(originalStatus);
    });
});

/* ═══════════════════════════════════════════════════════════════
   6 -- expireBounty
   ═══════════════════════════════════════════════════════════════ */

describe('expireBounty', () => {
    it("sets status to 'expired' when nowMs >= expiresAt and status is 'open'", () => {
        const b = makeBounty({ nowMs: NOW }).bounty;
        const result = expireBounty(b, NOW + EXPIRY_MS);
        expect(result.status).toBe('expired');
    });

    it('sets status to expired at exactly expiresAt', () => {
        const b = makeBounty({ nowMs: NOW }).bounty;
        const result = expireBounty(b, b.expiresAt);
        expect(result.status).toBe('expired');
    });

    it('does NOT expire when nowMs < expiresAt', () => {
        const b = makeBounty({ nowMs: NOW }).bounty;
        const result = expireBounty(b, NOW + EXPIRY_MS - 1);
        expect(result.status).toBe('open');
    });

    it("does NOT change status when bounty is already 'voting'", () => {
        const b = { ...makeBounty({ nowMs: NOW }).bounty, status: 'voting' };
        const result = expireBounty(b, NOW + EXPIRY_MS + 1);
        expect(result.status).toBe('voting');
    });

    it("does NOT change status when bounty is already 'resolved'", () => {
        const b = { ...makeBounty({ nowMs: NOW }).bounty, status: 'resolved' };
        const result = expireBounty(b, NOW + EXPIRY_MS + 1);
        expect(result.status).toBe('resolved');
    });

    it('returns the same reference when no change needed', () => {
        const b = makeBounty({ nowMs: NOW }).bounty;
        const result = expireBounty(b, NOW + 100);
        expect(result).toBe(b);
    });
});

/* ═══════════════════════════════════════════════════════════════
   7 -- releaseEscrow
   ═══════════════════════════════════════════════════════════════ */

describe('releaseEscrow', () => {
    it("credits winner's wallet with the bounty reward", () => {
        const wallet = makeWallet({ baseBalance: 200 });
        const bounty = { ...makeBounty({ reward: 500 }).bounty, winnerId: 'hash-winner' };

        const updated = releaseEscrow(wallet, bounty);
        expect(updated.baseBalance).toBe(700);
    });

    it('does not modify wallet when winnerId is null', () => {
        const wallet = makeWallet({ baseBalance: 200 });
        const bounty = { ...makeBounty({ reward: 500 }).bounty, winnerId: null };

        const updated = releaseEscrow(wallet, bounty);
        expect(updated.baseBalance).toBe(200);
        expect(updated).toBe(wallet);
    });

    it('does not mutate original wallet', () => {
        const wallet = makeWallet({ baseBalance: 200 });
        const bounty = { ...makeBounty({ reward: 500 }).bounty, winnerId: 'hash-winner' };
        releaseEscrow(wallet, bounty);
        expect(wallet.baseBalance).toBe(200);
    });
});

/* ═══════════════════════════════════════════════════════════════
   8 -- refundEscrow
   ═══════════════════════════════════════════════════════════════ */

describe('refundEscrow', () => {
    it("returns reward chips to creator's wallet", () => {
        const wallet = makeWallet({ baseBalance: 100 });
        const { bounty } = makeBounty({ reward: 500 });

        const updated = refundEscrow(wallet, bounty);
        expect(updated.baseBalance).toBe(600);
    });

    it('always refunds regardless of bounty status', () => {
        const wallet = makeWallet({ baseBalance: 0 });
        const expiredBounty = { ...makeBounty({ reward: 500 }).bounty, status: 'expired' };

        const updated = refundEscrow(wallet, expiredBounty);
        expect(updated.baseBalance).toBe(500);
    });

    it('does not mutate original wallet', () => {
        const wallet = makeWallet({ baseBalance: 100 });
        const { bounty } = makeBounty({ reward: 300 });
        refundEscrow(wallet, bounty);
        expect(wallet.baseBalance).toBe(100);
    });

    it('handles wallet with missing baseBalance (nullish coalescing)', () => {
        const wallet = {}; // no baseBalance
        const { bounty } = makeBounty({ reward: 200 });
        const updated = refundEscrow(wallet, bounty);
        expect(updated.baseBalance).toBe(200);
    });
});

/* ═══════════════════════════════════════════════════════════════
   9 -- Edge case: escrowBounty with missing wallet fields
   ═══════════════════════════════════════════════════════════════ */

describe('escrowBounty — nullish wallet fields', () => {
    it('handles wallet with zero baseBalance, adminBonus covers reward', () => {
        const wallet = makeWallet({ baseBalance: 0, adminBonus: 200 });
        const bounty = { reward: 100 };
        const result = escrowBounty(wallet, bounty);
        expect(result.success).toBe(true);
        expect(result.wallet.adminBonus).toBe(100);
    });
});

describe('releaseEscrow — nullish wallet fields', () => {
    it('handles wallet with missing baseBalance', () => {
        const wallet = {};
        const bounty = { ...makeBounty({ reward: 100 }).bounty, winnerId: 'winner' };
        const updated = releaseEscrow(wallet, bounty);
        expect(updated.baseBalance).toBe(100);
    });
});
