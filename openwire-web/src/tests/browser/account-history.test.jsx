/**
 * account-history.test.jsx
 *
 * Vitest + RTL tests for AccountHistory component.
 * Covers: rendering, filtering, clear, stats, financial/non-financial rows.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

/* ── Mock ledger ─────────────────────────────────── */
vi.mock('../../lib/core/ledger.js', () => ({
    getHistory: vi.fn(() => []),
    clearHistory: vi.fn(),
    getStats: vi.fn(() => ({})),
}));

import AccountHistory from '../../components/AccountHistory.jsx';
import * as ledger from '../../lib/core/ledger.js';

/* ── Helpers ─────────────────────────────────────── */

const sampleFinancialEvent = {
    id: 'ev-1',
    gameType: 'roulette',
    financial: true,
    resultLabel: 'Result: 7 Red',
    totals: { me: 500 },
    breakdown: [{ peer_id: 'me', betLabel: 'Red', wager: 100, net: 100, outcome: 'win' }],
    timestamp: Date.now(),
};

const sampleNonFinancialEvent = {
    id: 'ev-2',
    gameType: 'tictactoe',
    financial: false,
    resultLabel: 'Alice wins!',
    playerStats: [{ peer_id: 'me', nick: 'Alice', outcome: 'win' }],
    timestamp: Date.now(),
};

const sampleBlackjackEvent = {
    id: 'ev-3',
    gameType: 'blackjack',
    financial: true,
    resultLabel: 'Dealer 20',
    totals: { me: -100 },
    breakdown: [],
    timestamp: Date.now(),
};

function renderHistory(props = {}) {
    const defaults = {
        deviceId: 'dev-1',
        myId: 'me',
        onClose: vi.fn(),
    };
    return render(<AccountHistory {...defaults} {...props} />);
}

/* ── Tests ──────────────────────────────────────── */

describe('AccountHistory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ledger.getHistory.mockReturnValue([]);
        ledger.getStats.mockReturnValue({});
    });

    describe('rendering', () => {
        it('renders Account History title', () => {
            renderHistory();
            expect(screen.getByText(/Account History/)).toBeInTheDocument();
        });

        it('renders close button', () => {
            const onClose = vi.fn();
            renderHistory({ onClose });
            fireEvent.click(screen.getByText('✕'));
            expect(onClose).toHaveBeenCalledOnce();
        });

        it('shows empty message when no history', () => {
            renderHistory();
            expect(screen.getByText(/No history yet/)).toBeInTheDocument();
        });

        it('renders filter tabs', () => {
            renderHistory();
            expect(screen.getByText('All')).toBeInTheDocument();
        });
    });

    describe('with history', () => {
        beforeEach(() => {
            ledger.getHistory.mockReturnValue([sampleFinancialEvent, sampleNonFinancialEvent, sampleBlackjackEvent]);
        });

        it('renders all history rows', () => {
            const { container } = renderHistory();
            const rows = container.querySelectorAll('.ah-row');
            expect(rows).toHaveLength(3);
        });

        it('shows financial event with net amount', () => {
            const { container } = renderHistory();
            const netEl = container.querySelector('.ah-row-net.win');
            expect(netEl.textContent).toContain('+500');
        });

        it('shows non-financial event with outcome badge', () => {
            const { container } = renderHistory();
            const badge = container.querySelector('.ah-outcome-badge.win');
            expect(badge.textContent).toBe('Win');
        });

        it('shows result label for each event', () => {
            renderHistory();
            expect(screen.getByText('Result: 7 Red')).toBeInTheDocument();
            expect(screen.getByText('Alice wins!')).toBeInTheDocument();
        });

        it('shows Clear button when history exists', () => {
            renderHistory();
            expect(screen.getByText('Clear')).toBeInTheDocument();
        });
    });

    describe('filtering', () => {
        beforeEach(() => {
            ledger.getHistory.mockReturnValue([sampleFinancialEvent, sampleNonFinancialEvent, sampleBlackjackEvent]);
        });

        it('filters by game type when tab clicked', () => {
            const { container } = renderHistory();
            // Click Tic-Tac-Toe filter
            const tttTab = screen.getAllByText(/Tic-Tac-Toe/).find(el => el.classList.contains('ah-filter-btn'));
            fireEvent.click(tttTab);
            const rows = container.querySelectorAll('.ah-row');
            expect(rows).toHaveLength(1);
        });

        it('shows no results message when filter has no matches', () => {
            ledger.getHistory.mockReturnValue([sampleFinancialEvent]);
            renderHistory();
            // Click Tic-Tac-Toe filter (no TTT events)
            const tttTab = screen.getAllByText(/Tic-Tac-Toe/).find(el => el.classList.contains('ah-filter-btn'));
            fireEvent.click(tttTab);
            expect(screen.getByText(/No results for this filter/)).toBeInTheDocument();
        });

        it('shows all when All tab clicked', () => {
            const { container } = renderHistory();
            // Click a specific filter first
            const rlTab = screen.getAllByText(/Roulette/).find(el => el.classList.contains('ah-filter-btn'));
            fireEvent.click(rlTab);
            // Then click All
            fireEvent.click(screen.getByText('All'));
            const rows = container.querySelectorAll('.ah-row');
            expect(rows).toHaveLength(3);
        });
    });

    describe('clear history', () => {
        it('clears all history when Clear button clicked', () => {
            ledger.getHistory.mockReturnValue([sampleFinancialEvent]);
            renderHistory();
            fireEvent.click(screen.getByText('Clear'));
            expect(ledger.clearHistory).toHaveBeenCalledWith('dev-1');
            expect(screen.getByText(/No history yet/)).toBeInTheDocument();
        });
    });

    describe('stats bar', () => {
        it('renders stats when data available', () => {
            ledger.getStats.mockReturnValue({
                roulette: { wins: 5, losses: 3, totalNet: 200 },
            });
            renderHistory();
            expect(screen.getByText('Net Chips')).toBeInTheDocument();
            expect(screen.getByText('Wins')).toBeInTheDocument();
            expect(screen.getByText('Losses')).toBeInTheDocument();
        });

        it('does not render stats when empty', () => {
            ledger.getStats.mockReturnValue({});
            const { container } = renderHistory();
            expect(container.querySelector('.ah-stats-bar')).not.toBeInTheDocument();
        });
    });

    describe('loss/draw events', () => {
        it('shows Loss badge for non-financial loss', () => {
            const lossEvent = {
                ...sampleNonFinancialEvent,
                id: 'ev-loss',
                playerStats: [{ peer_id: 'me', nick: 'Alice', outcome: 'loss' }],
            };
            ledger.getHistory.mockReturnValue([lossEvent]);
            const { container } = renderHistory();
            const badge = container.querySelector('.ah-outcome-badge.loss');
            expect(badge.textContent).toBe('Loss');
        });

        it('shows Draw badge for draw', () => {
            const drawEvent = {
                ...sampleNonFinancialEvent,
                id: 'ev-draw',
                playerStats: [{ peer_id: 'me', nick: 'Alice', outcome: 'draw' }],
            };
            ledger.getHistory.mockReturnValue([drawEvent]);
            const { container } = renderHistory();
            const badge = container.querySelector('.ah-outcome-badge.draw');
            expect(badge.textContent).toBe('Draw');
        });

        it('shows negative net for financial loss', () => {
            ledger.getHistory.mockReturnValue([sampleBlackjackEvent]);
            const { container } = renderHistory();
            const netEl = container.querySelector('.ah-row-net.loss');
            expect(netEl.textContent).toContain('-100');
        });
    });
});
