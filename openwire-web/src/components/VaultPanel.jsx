/* ═══════════════════════════════════════════════════════════
   OpenWire — Presentation Domain: Chip Vault Panel
   Modal overlay for staking chips and earning compound interest.
   Follows the ah-overlay / ah-panel / ah-header pattern from
   AccountHistory.jsx. Vault-specific elements use vault- prefix.
   ═══════════════════════════════════════════════════════════ */

import { useState, useMemo } from 'react';
import { calculateInterest, MIN_STAKE, MAX_STAKE, PENALTY_HOURS } from '../lib/vault.js';

function formatHours(h) {
    if (h < 1) return `${Math.floor(h * 60)}m`;
    return `${h.toFixed(1)}h`;
}

export default function VaultPanel({ wallet, vaultData, onClose, onStake, onWithdraw }) {
    const [stakeInput, setStakeInput] = useState('');

    const staked   = vaultData?.staked   ?? 0;
    const stakedAt = vaultData?.stakedAt ?? null;

    // Derived vault state — computed from props (no profile needed here)
    const vaultState = useMemo(() => {
        const interestAccrued = staked > 0 && stakedAt !== null
            ? calculateInterest(staked, stakedAt)
            : 0;
        const hoursStaked = stakedAt !== null
            ? (Date.now() - stakedAt) / 3_600_000
            : 0;
        const penaltyApplies = staked > 0 && hoursStaked < PENALTY_HOURS;
        return { interestAccrued, hoursStaked, penaltyApplies };
    }, [staked, stakedAt]);

    const available = (wallet?.baseBalance ?? 0) + (wallet?.adminBonus ?? 0);
    const isStaked  = staked > 0;

    function handleStake() {
        const amount = Number(stakeInput);
        if (!Number.isFinite(amount) || amount < MIN_STAKE || amount > MAX_STAKE) return;
        if (amount > available) return;
        onStake(amount);
        setStakeInput('');
    }

    const stakeAmount   = Number(stakeInput);
    const stakeDisabled = !Number.isFinite(stakeAmount)
        || stakeAmount < MIN_STAKE
        || stakeAmount > MAX_STAKE
        || stakeAmount > available;

    return (
        <div className="ah-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="ah-panel">

                {/* Header — mirrors ah-header pattern */}
                <div className="ah-header">
                    <span className="ah-title">🏦 Chip Vault</span>
                    <button className="btn-icon-close" onClick={onClose}>✕</button>
                </div>

                {/* Body */}
                <div className="vault-body">

                    {!isStaked ? (
                        /* ── Nothing staked: show stake form ── */
                        <>
                            <div className="vault-empty-msg">No chips staked</div>

                            <div className="vault-form">
                                <label className="vault-label">
                                    Stake amount
                                    <span className="vault-available">
                                        Available: {available} chips
                                    </span>
                                </label>
                                <input
                                    className="vault-input"
                                    type="number"
                                    min={MIN_STAKE}
                                    max={MAX_STAKE}
                                    step="50"
                                    placeholder={`${MIN_STAKE} – ${MAX_STAKE}`}
                                    value={stakeInput}
                                    onChange={e => setStakeInput(e.target.value)}
                                />
                                <button
                                    className="vault-btn vault-btn-stake"
                                    onClick={handleStake}
                                    disabled={stakeDisabled}
                                >
                                    Stake Chips
                                </button>
                            </div>

                            <p className="vault-info">
                                2% per 24h compound interest. Withdraw anytime
                                (interest forfeited if &lt; {PENALTY_HOURS} hours staked).
                            </p>
                        </>
                    ) : (
                        /* ── Staked: show withdraw section ── */
                        <>
                            <div className="vault-stats">
                                <div className="vault-stat-row">
                                    <span className="vault-stat-label">Staked</span>
                                    <span className="vault-stat-val">{staked} chips</span>
                                </div>
                                <div className="vault-stat-row">
                                    <span className="vault-stat-label">Interest</span>
                                    <span className="vault-stat-val vault-interest">
                                        +{vaultState.interestAccrued} chips
                                    </span>
                                </div>
                                <div className="vault-stat-row vault-stat-total">
                                    <span className="vault-stat-label">Total on withdrawal</span>
                                    <span className="vault-stat-val">
                                        {staked + (vaultState.penaltyApplies ? 0 : vaultState.interestAccrued)} chips
                                    </span>
                                </div>
                                <div className="vault-stat-row">
                                    <span className="vault-stat-label">Time staked</span>
                                    <span className="vault-stat-val">
                                        {formatHours(vaultState.hoursStaked)}
                                    </span>
                                </div>
                            </div>

                            {vaultState.penaltyApplies && (
                                <div className="vault-penalty">
                                    ⚠ Withdrawing now forfeits interest (staked &lt; {PENALTY_HOURS}h)
                                </div>
                            )}

                            <button
                                className="vault-btn vault-btn-withdraw"
                                onClick={onWithdraw}
                            >
                                Withdraw
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
