/**
 * slots-board.test.jsx
 *
 * Vitest + RTL tests for SlotsBoard component.
 * Covers: rendering, chip selection, spin, result display, payout table, history.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

/* ── Mock wallet + slots libs ──────────────────────── */
vi.mock('../../lib/wallet.js', () => ({
    debit: vi.fn((w, amount) => ({ ...w, baseBalance: w.baseBalance - amount })),
    credit: vi.fn((w, amount) => ({ ...w, baseBalance: w.baseBalance + amount })),
    getTotalBalance: vi.fn(w => (w?.baseBalance || 0) + (w?.adminBonus || 0)),
}));
vi.mock('../../lib/slots.js', () => ({
    spinReels: vi.fn(() => ['🍒', '🍒', '🍒']),
    calculatePayout: vi.fn(() => 250),
    SLOT_PAYOUTS: { '🍒🍒🍒': 10, '🍋🍋🍋': 5, '🍊🍊🍊': 3 },
}));

import SlotsBoard from '../../components/SlotsBoard.jsx';
import * as walletLib from '../../lib/wallet.js';
import * as slotsLib from '../../lib/slots.js';

/* ── Helpers ─────────────────────────────────────── */

const WALLET = { baseBalance: 1000, adminBonus: 0 };

function renderBoard(props = {}) {
    const defaults = {
        wallet: WALLET,
        onWalletUpdate: vi.fn(),
        onClose: vi.fn(),
        onHelp: vi.fn(),
    };
    return render(<SlotsBoard {...defaults} {...props} />);
}

/* ── Tests ──────────────────────────────────────── */

describe('SlotsBoard', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        walletLib.debit.mockImplementation((w, amount) => ({ ...w, baseBalance: w.baseBalance - amount }));
        walletLib.credit.mockImplementation((w, amount) => ({ ...w, baseBalance: w.baseBalance + amount }));
        walletLib.getTotalBalance.mockImplementation(w => (w?.baseBalance || 0) + (w?.adminBonus || 0));
        slotsLib.spinReels.mockReturnValue(['🍒', '🍒', '🍒']);
        slotsLib.calculatePayout.mockReturnValue(250);
    });
    afterEach(() => { vi.useRealTimers(); });

    describe('rendering', () => {
        it('renders Lucky Slots title', () => {
            renderBoard();
            expect(screen.getByText('Lucky Slots')).toBeInTheDocument();
        });

        it('displays wallet balance', () => {
            renderBoard();
            expect(screen.getByText(/1,000/)).toBeInTheDocument();
        });

        it('renders initial reel symbols', () => {
            const { container } = renderBoard();
            const reels = container.querySelectorAll('.slots-reel');
            expect(reels).toHaveLength(3);
        });

        it('renders chip selector with all amounts', () => {
            renderBoard();
            [10, 25, 50, 100, 250, 500].forEach(a => {
                expect(screen.getByText(String(a), { selector: '.chip-btn' })).toBeInTheDocument();
            });
        });

        it('renders spin button', () => {
            renderBoard();
            expect(screen.getByText(/SPIN/)).toBeInTheDocument();
        });

        it('renders payout table', () => {
            renderBoard();
            expect(screen.getByText('Payouts')).toBeInTheDocument();
            expect(screen.getByText('10x')).toBeInTheDocument();
        });

        it('renders help button', () => {
            const onHelp = vi.fn();
            renderBoard({ onHelp });
            fireEvent.click(screen.getByTitle('How to Play'));
            expect(onHelp).toHaveBeenCalledOnce();
        });

        it('renders close button', () => {
            const onClose = vi.fn();
            renderBoard({ onClose });
            fireEvent.click(screen.getByText('✕'));
            expect(onClose).toHaveBeenCalledOnce();
        });

        it('shows idle message before first spin', () => {
            renderBoard();
            expect(screen.getByText(/Place your bet/)).toBeInTheDocument();
        });
    });

    describe('chip selection', () => {
        it('defaults to 25 chip', () => {
            renderBoard();
            expect(screen.getByText(/SPIN — 25 chips/)).toBeInTheDocument();
        });

        it('changes bet amount when chip clicked', () => {
            renderBoard();
            fireEvent.click(screen.getByText('100', { selector: '.chip-btn' }));
            expect(screen.getByText(/SPIN — 100 chips/)).toBeInTheDocument();
        });

        it('disables chips exceeding balance', () => {
            renderBoard({ wallet: { baseBalance: 200, adminBonus: 0 } });
            const chip500 = screen.getByText('500', { selector: '.chip-btn' });
            expect(chip500).toBeDisabled();
        });
    });

    describe('spin', () => {
        it('calls debit when spinning', () => {
            renderBoard();
            fireEvent.click(screen.getByText(/SPIN/));
            expect(walletLib.debit).toHaveBeenCalledWith(WALLET, 25, 'Slots spin');
        });

        it('shows Spinning text during spin', () => {
            renderBoard();
            fireEvent.click(screen.getByText(/SPIN/));
            expect(screen.getByText('SPINNING...')).toBeInTheDocument();
            expect(screen.getByText('Spinning...')).toBeInTheDocument();
        });

        it('disables spin button while spinning', () => {
            renderBoard();
            fireEvent.click(screen.getByText(/SPIN/));
            const btn = screen.getByText('SPINNING...');
            expect(btn).toBeDisabled();
        });

        it('shows win result after spin completes', () => {
            const onWalletUpdate = vi.fn();
            renderBoard({ onWalletUpdate });
            fireEvent.click(screen.getByText(/SPIN/));
            act(() => { vi.advanceTimersByTime(1600); });
            expect(screen.getByText(/WIN/)).toBeInTheDocument();
        });

        it('calls credit for winning spin', () => {
            const onWalletUpdate = vi.fn();
            renderBoard({ onWalletUpdate });
            fireEvent.click(screen.getByText(/SPIN/));
            act(() => { vi.advanceTimersByTime(1600); });
            expect(walletLib.credit).toHaveBeenCalled();
        });

        it('shows loss result for losing spin', () => {
            slotsLib.calculatePayout.mockReturnValue(0);
            const onWalletUpdate = vi.fn();
            renderBoard({ onWalletUpdate });
            fireEvent.click(screen.getByText(/SPIN/));
            act(() => { vi.advanceTimersByTime(1600); });
            expect(screen.getByText(/No match/)).toBeInTheDocument();
        });

        it('does not call credit for losing spin', () => {
            slotsLib.calculatePayout.mockReturnValue(0);
            renderBoard();
            fireEvent.click(screen.getByText(/SPIN/));
            act(() => { vi.advanceTimersByTime(1600); });
            expect(walletLib.credit).not.toHaveBeenCalled();
        });

        it('adds to spin history after spin', () => {
            const { container } = renderBoard();
            fireEvent.click(screen.getByText(/SPIN/));
            act(() => { vi.advanceTimersByTime(1600); });
            expect(screen.getByText('Recent Spins')).toBeInTheDocument();
            const pips = container.querySelectorAll('.slots-history-pip');
            expect(pips).toHaveLength(1);
        });

        it('does not spin when balance is insufficient', () => {
            renderBoard({ wallet: { baseBalance: 10, adminBonus: 0 } });
            const btn = screen.getByText(/SPIN — 25 chips/);
            expect(btn).toBeDisabled();
        });
    });
});
