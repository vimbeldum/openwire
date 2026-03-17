/* ═══════════════════════════════════════════════════════════
   OpenWire — Bounties / Challenges System
   Pure ESM module. No React. No side effects at module level.
   ═══════════════════════════════════════════════════════════ */

/* ── Constants ────────────────────────────────────────────── */
export const MIN_REWARD          = 100;
export const MAX_REWARD          = 5000;
export const MIN_KARMA_TO_CREATE = 200;          // Trusted tier required
export const MAX_ACTIVE_PER_USER = 2;
export const EXPIRY_MS           = 60 * 60 * 1000;    // 1 hour
export const VOTING_DURATION_MS  = 10 * 60 * 1000;   // 10 minutes
export const WIN_THRESHOLD       = 0.6;               // 60% of participants
export const MAX_SUBMISSIONS     = 5;                 // per user per bounty

/* ── Internal helpers ─────────────────────────────────────── */

// djb2 hash — same pattern as deaddrops.js
function hashDeviceId(deviceId) {
    let hash = 5381;
    for (let i = 0; i < deviceId.length; i++) {
        hash = ((hash << 5) + hash) + deviceId.charCodeAt(i);
        hash |= 0;
    }
    return hash.toString(16);
}

function countActiveBountiesForUser(activeBounties, deviceHash) {
    return activeBounties.filter(
        b => b.creatorDeviceHash === deviceHash &&
             (b.status === 'open' || b.status === 'voting')
    ).length;
}

/* ── 1. createBounty ──────────────────────────────────────── */
// Returns { success, bounty?, reason? }
export function createBounty(roomId, creatorDeviceId, creatorNick, description, reward, karma, activeBounties, nowMs) {
    if (karma < MIN_KARMA_TO_CREATE)
        return { success: false, reason: 'insufficient_karma' };

    if (!Number.isFinite(reward) || reward < MIN_REWARD || reward > MAX_REWARD)
        return { success: false, reason: 'invalid_reward' };

    if (!description || typeof description !== 'string' || description.trim().length === 0)
        return { success: false, reason: 'empty_description' };

    if (description.length > 300)
        return { success: false, reason: 'description_too_long' };

    const creatorDeviceHash = hashDeviceId(creatorDeviceId);

    if (countActiveBountiesForUser(activeBounties, creatorDeviceHash) >= MAX_ACTIVE_PER_USER)
        return { success: false, reason: 'too_many_active_bounties' };

    return {
        success: true,
        bounty: {
            id: `bounty_${nowMs}_${creatorDeviceHash.slice(0, 6)}`,
            roomId,
            creatorDeviceHash,
            creatorNick,
            description: description.trim(),
            reward,
            status: 'open',
            createdAt: nowMs,
            expiresAt: nowMs + EXPIRY_MS,
            submissions: [],
            votedBy: [],
            winnerId: null,
        },
    };
}

/* ── 2. escrowBounty ──────────────────────────────────────── */
// Inline debit (no wallet.js import — avoids circular deps)
// Returns { success, wallet?, bounty?, reason? }
export function escrowBounty(wallet, bounty) {
    const total = (wallet.baseBalance || 0) + (wallet.adminBonus || 0);
    if (total < bounty.reward)
        return { success: false, reason: 'insufficient_balance' };

    let base  = wallet.baseBalance || 0;
    let bonus = wallet.adminBonus  || 0;

    if (bounty.reward <= base) {
        base -= bounty.reward;
    } else {
        bonus -= (bounty.reward - base);
        base   = 0;
    }

    const newTotal = Math.max(0, base) + Math.max(0, bonus);
    return {
        success: true,
        wallet: {
            ...wallet,
            baseBalance: Math.max(0, base),
            adminBonus: Math.max(0, bonus),
            history: [
                ...(wallet.history ?? []).slice(-99),
                { time: Date.now(), reason: 'Bounty escrow', amount: -bounty.reward, balance: newTotal },
            ],
        },
        bounty: { ...bounty, escrowedAt: Date.now() },
    };
}

/* ── 3. submitAttempt ─────────────────────────────────────── */
// Returns { success, bounty?, reason? }
export function submitAttempt(bounty, deviceId, nick, messageRef, nowMs) {
    if (bounty.status !== 'open' && bounty.status !== 'voting')
        return { success: false, reason: 'bounty_not_accepting_submissions' };

    if (nowMs >= bounty.expiresAt)
        return { success: false, reason: 'bounty_expired' };

    const deviceHash = hashDeviceId(deviceId);

    if (bounty.submissions.filter(s => s.deviceHash === deviceHash).length >= MAX_SUBMISSIONS)
        return { success: false, reason: 'max_submissions_reached' };

    const updatedSubmissions = [...bounty.submissions, { deviceHash, nick, messageRef, votes: 0 }];
    let updatedBounty = { ...bounty, submissions: updatedSubmissions };

    // Transition to voting once >= 2 submissions
    if (updatedSubmissions.length >= 2 && updatedBounty.status === 'open') {
        updatedBounty = { ...updatedBounty, status: 'voting', votingEndsAt: nowMs + VOTING_DURATION_MS };
    }

    return { success: true, bounty: updatedBounty };
}

/* ── 4. castVote ──────────────────────────────────────────── */
// Returns { success, bounty?, triggered?, reason? }
export function castVote(bounty, voterDeviceId, submissionIndex, roomParticipantCount, nowMs) {
    if (bounty.status !== 'voting')
        return { success: false, reason: 'voting_not_open' };

    const voterHash = hashDeviceId(voterDeviceId);

    if (bounty.votedBy.includes(voterHash))
        return { success: false, reason: 'already_voted' };

    if (submissionIndex < 0 || submissionIndex >= bounty.submissions.length)
        return { success: false, reason: 'invalid_submission_index' };

    if (voterHash === bounty.creatorDeviceHash)
        return { success: false, reason: 'creator_cannot_vote' };

    if (bounty.submissions[submissionIndex].deviceHash === voterHash)
        return { success: false, reason: 'cannot_vote_own_submission' };

    const updatedSubmissions = bounty.submissions.map((s, i) =>
        i === submissionIndex ? { ...s, votes: s.votes + 1 } : s
    );

    let updatedBounty = {
        ...bounty,
        submissions: updatedSubmissions,
        votedBy: [...bounty.votedBy, voterHash],
    };

    const earlyResolution = updatedSubmissions[submissionIndex].votes >= roomParticipantCount * WIN_THRESHOLD;
    const votingExpired   = bounty.votingEndsAt && nowMs >= bounty.votingEndsAt;

    if (earlyResolution || votingExpired) {
        updatedBounty = resolveBounty(updatedBounty, nowMs);
        return { success: true, bounty: updatedBounty, triggered: 'resolved' };
    }

    return { success: true, bounty: updatedBounty };
}

/* ── 5. resolveBounty ─────────────────────────────────────── */
// Picks highest-vote winner; null on tie or no submissions.
export function resolveBounty(bounty, nowMs) {
    if (bounty.submissions.length === 0)
        return { ...bounty, status: 'resolved', resolvedAt: nowMs, winnerId: null };

    const maxVotes     = Math.max(...bounty.submissions.map(s => s.votes));
    const topSubmissions = bounty.submissions.filter(s => s.votes === maxVotes);
    const winnerId     = topSubmissions.length === 1 ? topSubmissions[0].deviceHash : null;

    return { ...bounty, status: 'resolved', resolvedAt: nowMs, winnerId };
}

/* ── 6. expireBounty ──────────────────────────────────────── */
// Handles both 'open' bounties past expiresAt and 'voting' bounties past votingEndsAt.
// Without the voting check, bounties stuck in 'voting' with no new votes would
// lock escrowed funds permanently.
export function expireBounty(bounty, nowMs) {
    if (nowMs >= bounty.expiresAt && bounty.status === 'open')
        return { ...bounty, status: 'expired' };
    if (bounty.status === 'voting' && bounty.votingEndsAt && nowMs >= bounty.votingEndsAt)
        return resolveBounty(bounty, nowMs);
    return bounty;
}

/* ── 7. releaseEscrow ─────────────────────────────────────── */
// Credits winner's wallet. Call with the winning participant's wallet.
export function releaseEscrow(wallet, bounty) {
    if (!bounty.winnerId) return wallet;
    const newBase = (wallet.baseBalance || 0) + bounty.reward;
    return {
        ...wallet,
        baseBalance: newBase,
        history: [
            ...(wallet.history ?? []).slice(-99),
            { time: Date.now(), reason: 'Bounty reward', amount: bounty.reward, balance: newBase + (wallet.adminBonus || 0) },
        ],
    };
}

/* ── 8. refundEscrow ──────────────────────────────────────── */
// Returns escrowed reward to creator (expired / tied / no valid winner).
export function refundEscrow(wallet, bounty) {
    const newBase = (wallet.baseBalance || 0) + bounty.reward;
    return {
        ...wallet,
        baseBalance: newBase,
        history: [
            ...(wallet.history ?? []).slice(-99),
            { time: Date.now(), reason: 'Bounty refund', amount: bounty.reward, balance: newBase + (wallet.adminBonus || 0) },
        ],
    };
}
