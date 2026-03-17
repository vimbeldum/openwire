/* ═══════════════════════════════════════════════════════════
   OpenWire — Chip Staking / Vault
   Allows players to stake chips to earn compound interest
   at 2% per 24h. Withdrawing before 12h forfeits interest.

   All functions are pure / immutable — they return new
   objects and never mutate their inputs.
   ═══════════════════════════════════════════════════════════ */

import { getTotalBalance, canAfford, saveWalletSync } from './wallet.js';

/* ── Constants ────────────────────────────────────────────── */
export const MIN_STAKE    = 100;
export const MAX_STAKE    = 10000;
export const RATE         = 0.02;  // 2% per 24 hours compound
export const PENALTY_HOURS = 12;   // withdraw penalty if < 12h staked

/* ── calculateInterest ────────────────────────────────────── */
/**
 * Pure function. Computes compound interest earned since staking.
 * @param {number} principal - Amount staked
 * @param {number} stakedAtTimestamp - Unix ms timestamp when staked
 * @returns {number} Floored integer interest chips earned
 */
export function calculateInterest(principal, stakedAtTimestamp) {
    const hoursElapsed = Math.max(0, (Date.now() - stakedAtTimestamp) / 3_600_000);
    const periods = hoursElapsed / 24;
    return Math.floor(principal * Math.pow(1 + RATE, periods) - principal);
}

/* ── getVaultState ────────────────────────────────────────── */
/**
 * Returns a snapshot of the vault state for a profile.
 * @param {object} profile - Player profile with a `vault` sub-object
 * @returns {{ staked: number, stakedAt: number|null, interestAccrued: number, hoursStaked: number, penaltyApplies: boolean }}
 */
export function getVaultState(profile) {
    const vault = profile.vault ?? { staked: 0, stakedAt: null };
    const staked   = vault.staked   ?? 0;
    const stakedAt = vault.stakedAt ?? null;

    const interestAccrued = staked > 0 && stakedAt !== null
        ? calculateInterest(staked, stakedAt)
        : 0;

    const hoursStaked = stakedAt !== null
        ? (Date.now() - stakedAt) / 3_600_000
        : 0;

    const penaltyApplies = staked > 0 && hoursStaked < PENALTY_HOURS;

    return { staked, stakedAt, interestAccrued, hoursStaked, penaltyApplies };
}

/* ── stake ────────────────────────────────────────────────── */
/**
 * Stakes `amount` chips from wallet into the vault.
 * Deducts from wallet using the same baseBalance-first rule as wallet.debit.
 * @param {object} profile - Player profile (immutable)
 * @param {object} wallet  - Wallet object (immutable)
 * @param {number} amount  - Chips to stake
 * @returns {{ success: boolean, profile: object, wallet: object, reason?: string }}
 */
export function stake(profile, wallet, amount) {
    if (!Number.isFinite(amount) || amount <= 0) {
        return { success: false, profile, wallet, reason: 'invalid_amount' };
    }
    if (amount < MIN_STAKE) {
        return { success: false, profile, wallet, reason: `minimum_stake_${MIN_STAKE}` };
    }

    const currentStaked = profile.vault?.staked ?? 0;
    const currentStakedAt = profile.vault?.stakedAt ?? null;
    const accruedInterest = currentStaked > 0 && currentStakedAt !== null
        ? calculateInterest(currentStaked, currentStakedAt)
        : 0;
    if (currentStaked + accruedInterest + amount > MAX_STAKE) {
        return { success: false, profile, wallet, reason: `max_stake_exceeded_${MAX_STAKE}` };
    }

    if (!canAfford(wallet, amount)) {
        return { success: false, profile, wallet, reason: 'insufficient_balance' };
    }

    // Debit wallet inline (baseBalance first, then adminBonus) — avoids circular dep
    let base  = wallet.baseBalance  ?? 0;
    let bonus = wallet.adminBonus   ?? 0;
    if (amount <= base) {
        base -= amount;
    } else {
        const fromBase = base;
        base  = 0;
        bonus -= (amount - fromBase);
    }
    const newTotal = Math.max(0, base) + Math.max(0, bonus);
    const updatedWallet = {
        ...wallet,
        baseBalance: Math.max(0, base),
        adminBonus:  Math.max(0, bonus),
        history: [
            ...(wallet.history ?? []).slice(-99),
            { time: Date.now(), reason: 'Vault stake', amount: -amount, balance: newTotal },
        ],
    };

    // Persist wallet synchronously — the vault update is stored in the profile
    // (a separate object), so if profile saves first and a reload occurs before
    // the debounced wallet timer fires, the user would have staked chips AND
    // keep the old wallet balance (chip duplication).
    saveWalletSync(updatedWallet);

    // Compound accrued interest into principal before resetting the timer,
    // so additional deposits don't silently destroy earned interest.
    const updatedProfile = {
        ...profile,
        vault: {
            staked:   currentStaked + accruedInterest + amount,
            stakedAt: Date.now(),
        },
    };

    return { success: true, profile: updatedProfile, wallet: updatedWallet };
}

/* ── withdraw ─────────────────────────────────────────────── */
/**
 * Withdraws all staked chips (plus interest if past penalty window)
 * back into wallet.baseBalance.
 * @param {object} profile - Player profile (immutable)
 * @param {object} wallet  - Wallet object (immutable)
 * @returns {{ success: boolean, profile: object, wallet: object, amount: number, penaltyApplied: boolean, reason?: string }}
 */
export function withdraw(profile, wallet) {
    const vault    = profile.vault ?? { staked: 0, stakedAt: null };
    const staked   = vault.staked   ?? 0;
    const stakedAt = vault.stakedAt ?? null;

    if (staked <= 0) {
        return { success: false, profile, wallet, amount: 0, penaltyApplied: false, reason: 'nothing_staked' };
    }

    const hoursStaked    = stakedAt !== null ? (Date.now() - stakedAt) / 3_600_000 : 0;
    const penaltyApplied = hoursStaked < PENALTY_HOURS;
    const interest       = calculateInterest(staked, stakedAt);
    const amount         = penaltyApplied ? staked : staked + interest;

    // Credit wallet (goes to baseBalance — same as game winnings)
    const updatedWallet = {
        ...wallet,
        baseBalance: (wallet.baseBalance ?? 0) + amount,
        history: [
            ...(wallet.history ?? []).slice(-99),
            {
                time:    Date.now(),
                reason:  penaltyApplied ? 'Vault withdraw (early — interest forfeited)' : 'Vault withdraw',
                amount:  +amount,
                balance: getTotalBalance(wallet) + amount,
            },
        ],
    };

    // Reset vault
    const updatedProfile = {
        ...profile,
        vault: { staked: 0, stakedAt: null },
    };

    return { success: true, profile: updatedProfile, wallet: updatedWallet, amount, penaltyApplied };
}

/* ── getVaultSummary ──────────────────────────────────────── */
/**
 * Returns a human-readable one-liner for use in UI displays.
 * @param {object} profile - Player profile
 * @returns {string} e.g. "Staked: 500 chips | Interest: +12 chips | Time: 14.3h"
 */
export function getVaultSummary(profile) {
    const { staked, interestAccrued, hoursStaked } = getVaultState(profile);
    if (staked === 0) return 'No chips staked';
    return `Staked: ${staked} chips | Interest: +${interestAccrued} chips | Time: ${hoursStaked.toFixed(1)}h`;
}
