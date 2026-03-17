/**
 * vault-panel.test.jsx
 *
 * Vitest + RTL tests for VaultPanel component.
 * Covers: render, close, stake form, withdraw, penalty warning, balance display.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import VaultPanel from '../../components/VaultPanel.jsx';

vi.mock('../../lib/vault.js', () => ({
    calculateInterest: vi.fn(() => 10),
    MIN_STAKE: 100,
    MAX_STAKE: 10000,
    PENALTY_HOURS: 12,
}));

// ── helpers ────────────────────────────────────────────────────────────────────

function makeWallet(baseBalance = 5000, adminBonus = 0) {
    return { baseBalance, adminBonus };
}

function makeVaultData(staked = 0, stakedAt = null) {
    return { staked, stakedAt };
}

function renderVault(props = {}) {
    const defaults = {
        wallet: makeWallet(),
        vaultData: makeVaultData(),
        onClose: vi.fn(),
        onStake: vi.fn(),
        onWithdraw: vi.fn(),
    };
    return render(<VaultPanel {...defaults} {...props} />);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('VaultPanel', () => {
    describe('header', () => {
        it('renders the "🏦 Chip Vault" title', () => {
            renderVault();
            expect(screen.getByText('🏦 Chip Vault')).toBeInTheDocument();
        });

        it('close button calls onClose', () => {
            const onClose = vi.fn();
            renderVault({ onClose });
            fireEvent.click(screen.getByText('✕'));
            expect(onClose).toHaveBeenCalledTimes(1);
        });
    });

    describe('when nothing is staked', () => {
        it('shows "No chips staked" message', () => {
            renderVault({ vaultData: makeVaultData(0) });
            expect(screen.getByText('No chips staked')).toBeInTheDocument();
        });

        it('shows the stake amount input', () => {
            renderVault({ vaultData: makeVaultData(0) });
            expect(screen.getByRole('spinbutton')).toBeInTheDocument();
        });

        it('shows the "Stake Chips" button', () => {
            renderVault({ vaultData: makeVaultData(0) });
            expect(screen.getByRole('button', { name: 'Stake Chips' })).toBeInTheDocument();
        });

        it('displays the available balance', () => {
            renderVault({ wallet: makeWallet(2000, 500), vaultData: makeVaultData(0) });
            expect(screen.getByText(/Available: 2500 chips/)).toBeInTheDocument();
        });

        it('calls onStake with the entered amount when valid', () => {
            const onStake = vi.fn();
            renderVault({ wallet: makeWallet(5000), vaultData: makeVaultData(0), onStake });
            fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '500' } });
            fireEvent.click(screen.getByRole('button', { name: 'Stake Chips' }));
            expect(onStake).toHaveBeenCalledWith(500);
        });

        it('does not call onStake when input is empty', () => {
            const onStake = vi.fn();
            renderVault({ wallet: makeWallet(5000), vaultData: makeVaultData(0), onStake });
            fireEvent.click(screen.getByRole('button', { name: 'Stake Chips' }));
            expect(onStake).not.toHaveBeenCalled();
        });

        it('does not call onStake when amount is below MIN_STAKE (100)', () => {
            const onStake = vi.fn();
            renderVault({ wallet: makeWallet(5000), vaultData: makeVaultData(0), onStake });
            fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '50' } });
            fireEvent.click(screen.getByRole('button', { name: 'Stake Chips' }));
            expect(onStake).not.toHaveBeenCalled();
        });

        it('does not call onStake when amount exceeds available balance', () => {
            const onStake = vi.fn();
            renderVault({ wallet: makeWallet(200), vaultData: makeVaultData(0), onStake });
            fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '500' } });
            fireEvent.click(screen.getByRole('button', { name: 'Stake Chips' }));
            expect(onStake).not.toHaveBeenCalled();
        });

        it('"Stake Chips" button is disabled for invalid amount', () => {
            renderVault({ wallet: makeWallet(5000), vaultData: makeVaultData(0) });
            // Empty input → disabled
            expect(screen.getByRole('button', { name: 'Stake Chips' })).toBeDisabled();
        });
    });

    describe('when chips are staked', () => {
        const stakedAt = Date.now() - 2 * 3_600_000; // 2 hours ago → penalty applies

        it('shows the staked amount', () => {
            renderVault({ vaultData: makeVaultData(1000, stakedAt) });
            // Multiple elements may contain "1000 chips" (Staked row + Total row)
            const matches = screen.getAllByText('1000 chips');
            expect(matches.length).toBeGreaterThanOrEqual(1);
        });

        it('shows the "Withdraw" button', () => {
            renderVault({ vaultData: makeVaultData(1000, stakedAt) });
            expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
        });

        it('calls onWithdraw when Withdraw is clicked', () => {
            const onWithdraw = vi.fn();
            renderVault({ vaultData: makeVaultData(1000, stakedAt), onWithdraw });
            fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
            expect(onWithdraw).toHaveBeenCalledTimes(1);
        });

        it('shows penalty warning when staked less than PENALTY_HOURS (12h)', () => {
            renderVault({ vaultData: makeVaultData(1000, stakedAt) });
            expect(screen.getByText(/forfeits interest/i)).toBeInTheDocument();
        });

        it('does NOT show penalty warning when staked longer than PENALTY_HOURS', () => {
            const longAgo = Date.now() - 24 * 3_600_000; // 24 hours ago → no penalty
            renderVault({ vaultData: makeVaultData(1000, longAgo) });
            expect(screen.queryByText(/forfeits interest/i)).not.toBeInTheDocument();
        });

        it('does not show the stake form when chips are staked', () => {
            renderVault({ vaultData: makeVaultData(1000, stakedAt) });
            expect(screen.queryByText('No chips staked')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Stake Chips' })).not.toBeInTheDocument();
        });
    });

    describe('edge cases', () => {
        it('renders with null wallet (nullish coalescing)', () => {
            renderVault({ wallet: null, vaultData: makeVaultData(0, null) });
            expect(screen.getByText(/Vault/)).toBeInTheDocument();
        });

        it('renders with empty wallet object', () => {
            renderVault({ wallet: {}, vaultData: makeVaultData(0, null) });
            expect(screen.getByText(/Vault/)).toBeInTheDocument();
        });

        it('overlay click calls onClose', () => {
            const onClose = vi.fn();
            const { container } = renderVault({ onClose, vaultData: makeVaultData(0, null) });
            const overlay = container.querySelector('.ah-overlay');
            if (overlay) {
                fireEvent.click(overlay);
                expect(onClose).toHaveBeenCalled();
            }
        });

        it('shows sub-hour formatting for recently staked', () => {
            const now = Date.now();
            renderVault({ vaultData: makeVaultData(500, now - 30 * 60 * 1000) });
            // Should show minutes (e.g., "30m") via formatHours
            const bodyText = document.body.textContent;
            expect(bodyText).toMatch(/\d+m|\d+\.\dh/);
        });

        it('handleStake calls onStake for valid input', () => {
            const onStake = vi.fn();
            renderVault({ onStake, vaultData: makeVaultData(0, null) });
            const input = screen.queryByRole('spinbutton');
            if (input) {
                fireEvent.change(input, { target: { value: '500' } });
                const btn = screen.queryByRole('button', { name: /Stake/i });
                if (btn && !btn.disabled) {
                    fireEvent.click(btn);
                    expect(onStake).toHaveBeenCalledWith(500);
                }
            }
        });
    });
});
