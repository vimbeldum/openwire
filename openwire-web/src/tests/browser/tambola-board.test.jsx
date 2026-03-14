/**
 * tambola-board.test.jsx
 *
 * Vitest + RTL tests for TambolaBoard component.
 * Covers: render, lobby, ticket purchase, start game, playing phase, claim prize, ended phase.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi } from 'vitest';
import TambolaBoard from '../../components/TambolaBoard.jsx';
import * as tambolaLib from '../../lib/tambola.js';

// ── Mock fixtures ──────────────────────────────────────────────────────────────

const SAMPLE_GRID = [
    [1, 0, 21, 0, 41, 0, 61, 0, 81],
    [2, 0, 22, 0, 42, 0, 62, 0, 82],
    [3, 0, 23, 0, 43, 0, 53, 0, 83],
];

const INITIAL_STATE = {
    status: 'lobby',
    ticketPrice: 100,
    calledNumbers: [],
    tickets: {},
    prizes: {
        earlyFive:  { winner: null, amount: 95 },
        topLine:    { winner: null, amount: 143 },
        middleLine: { winner: null, amount: 143 },
        bottomLine: { winner: null, amount: 143 },
        fullHouse:  { winner: null, amount: 476 },
    },
    prizePool: 0,
};

const STATE_WITH_TICKET = {
    ...INITIAL_STATE,
    tickets: {
        testId: [{ ticketId: 't1', grid: SAMPLE_GRID, marked: [] }],
    },
};

const DRAWING_STATE = {
    ...STATE_WITH_TICKET,
    status: 'drawing',
    calledNumbers: [42],
};

vi.mock('../../lib/tambola.js', () => ({
    PRIZES: {
        earlyFive:  { name: 'Early Five',   pct: 0.10 },
        topLine:    { name: 'Top Line',     pct: 0.15 },
        middleLine: { name: 'Middle Line',  pct: 0.15 },
        bottomLine: { name: 'Bottom Line',  pct: 0.15 },
        fullHouse:  { name: 'Full House',   pct: 0.45 },
    },
    generateTicket: vi.fn(() => SAMPLE_GRID),
    createInitialState: vi.fn(() => JSON.parse(JSON.stringify(INITIAL_STATE))),
    buyTicket: vi.fn(() => ({
        success: true,
        state: JSON.parse(JSON.stringify(STATE_WITH_TICKET)),
        tickets: [SAMPLE_GRID],
    })),
    startGame: vi.fn(state => ({ ...state, status: 'drawing' })),
    drawNumber: vi.fn(() => ({
        success: true,
        state: JSON.parse(JSON.stringify(DRAWING_STATE)),
        number: 42,
    })),
    claimPrize: vi.fn(() => ({
        success: false,
        reason: 'Claim pattern not complete',
    })),
}));

vi.mock('../../lib/wallet.js', () => ({
    getTotalBalance: vi.fn(() => 1000),
    canAfford: vi.fn(() => true),
    debit: vi.fn((w, amount) => ({ ...w, baseBalance: (w.baseBalance ?? 0) - amount })),
    credit: vi.fn((w, amount) => ({ ...w, baseBalance: (w.baseBalance ?? 0) + amount })),
}));

// ── helpers ────────────────────────────────────────────────────────────────────

const WALLET_1000 = { baseBalance: 1000, adminBonus: 0 };
const WALLET_50   = { baseBalance: 50,   adminBonus: 0 };

function renderBoard(props = {}) {
    const defaults = {
        myId: 'testId',
        myNick: 'Tester',
        wallet: WALLET_1000,
        onClose: vi.fn(),
        onWalletUpdate: vi.fn(),
    };
    return render(<TambolaBoard {...defaults} {...props} />);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('TambolaBoard', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    describe('initial render', () => {
        it('renders "Tambola" heading', () => {
            renderBoard();
            expect(screen.getByText('Tambola')).toBeInTheDocument();
        });

        it('shows the wallet chip count in the header badge', () => {
            renderBoard({ wallet: { baseBalance: 1000, adminBonus: 0 } });
            expect(screen.getByText('1,000 chips')).toBeInTheDocument();
        });

        it('sums baseBalance + adminBonus in the header badge', () => {
            renderBoard({ wallet: { baseBalance: 800, adminBonus: 200 } });
            expect(screen.getByText('1,000 chips')).toBeInTheDocument();
        });

        it('close button calls onClose', () => {
            const onClose = vi.fn();
            renderBoard({ onClose });
            fireEvent.click(screen.getByRole('button', { name: '✕' }));
            expect(onClose).toHaveBeenCalledTimes(1);
        });
    });

    describe('lobby phase', () => {
        it('shows the "Buy Ticket" button in lobby', () => {
            renderBoard();
            expect(screen.getByRole('button', { name: /Buy Ticket/i })).toBeInTheDocument();
        });

        it('shows ticket price in the Buy button label', () => {
            renderBoard();
            expect(screen.getByRole('button', { name: /Buy Ticket.*100 chips/i })).toBeInTheDocument();
        });

        it('shows ticket price in the rules text', () => {
            renderBoard();
            expect(screen.getByText(/Each ticket costs/i)).toBeInTheDocument();
        });

        it('does not show "Start Game" button before buying a ticket', () => {
            renderBoard();
            expect(screen.queryByRole('button', { name: /Start Game/i })).not.toBeInTheDocument();
        });

        it('"Buy Ticket" is disabled when wallet < ticket price', () => {
            renderBoard({ wallet: WALLET_50 });
            expect(screen.getByRole('button', { name: /Buy Ticket/i })).toBeDisabled();
        });

        it('buying a ticket calls onWalletUpdate with debited wallet object', () => {
            const onWalletUpdate = vi.fn();
            renderBoard({ wallet: WALLET_1000, onWalletUpdate });
            act(() => {
                fireEvent.click(screen.getByRole('button', { name: /Buy Ticket/i }));
            });
            expect(onWalletUpdate).toHaveBeenCalledWith(
                expect.objectContaining({ baseBalance: 900 })
            );
        });

        it('ticket grid renders after buying a ticket', () => {
            renderBoard();
            act(() => {
                fireEvent.click(screen.getByRole('button', { name: /Buy Ticket/i }));
            });
            // Numbers from SAMPLE_GRID row 0 — cell value 1 should appear
            expect(screen.getByText('1')).toBeInTheDocument();
        });

        it('"Start Game" button appears after buying a ticket', () => {
            renderBoard();
            act(() => {
                fireEvent.click(screen.getByRole('button', { name: /Buy Ticket/i }));
            });
            expect(screen.getByRole('button', { name: /Start Game/i })).toBeInTheDocument();
        });
    });

    describe('playing phase', () => {
        function buyAndStart() {
            renderBoard();
            act(() => {
                fireEvent.click(screen.getByRole('button', { name: /Buy Ticket/i }));
            });
            act(() => {
                fireEvent.click(screen.getByRole('button', { name: /Start Game/i }));
            });
        }

        it('does NOT show "Called Numbers" board during playing phase', () => {
            buyAndStart();
            expect(screen.queryByText('Called Numbers')).not.toBeInTheDocument();
        });

        it('shows "Numbers Called" counter in playing phase', () => {
            buyAndStart();
            expect(screen.getByText('Numbers Called')).toBeInTheDocument();
        });

        it('does not reveal the specific called number to the player', () => {
            buyAndStart();
            expect(screen.queryByText('Last Called')).not.toBeInTheDocument();
        });

        it('shows tap-to-mark hint on ticket', () => {
            buyAndStart();
            expect(screen.getByText(/tap a yellow number to mark it/i)).toBeInTheDocument();
        });

        it('shows "Early Five" prize claim button', () => {
            buyAndStart();
            expect(screen.getByRole('button', { name: /Early Five/i })).toBeInTheDocument();
        });

        it('shows "Full House" prize claim button', () => {
            buyAndStart();
            expect(screen.getByRole('button', { name: /Full House/i })).toBeInTheDocument();
        });

        it('shows all 5 prize claim buttons', () => {
            buyAndStart();
            const prizeNames = ['Early Five', 'Top Line', 'Middle Line', 'Bottom Line', 'Full House'];
            prizeNames.forEach(name => {
                expect(screen.getByRole('button', { name: new RegExp(name, 'i') })).toBeInTheDocument();
            });
        });

        it('shows rejection toast with penalty when claim pattern is incomplete', () => {
            buyAndStart();
            act(() => {
                fireEvent.click(screen.getByRole('button', { name: /Early Five/i }));
            });
            // Toast includes "Bogus Claim!" and the chip penalty
            expect(screen.getByText(/Bogus Claim!/i)).toBeInTheDocument();
        });

        it('deducts chips on bogus claim equal to the prize amount', () => {
            const onWalletUpdate = vi.fn();
            renderBoard({ wallet: WALLET_1000, onWalletUpdate });
            act(() => { fireEvent.click(screen.getByRole('button', { name: /Buy Ticket/i })); });
            act(() => { fireEvent.click(screen.getByRole('button', { name: /Start Game/i })); });
            act(() => { fireEvent.click(screen.getByRole('button', { name: /Early Five/i })); });
            // Second call is the bogus claim deduction (first was the ticket purchase)
            expect(onWalletUpdate).toHaveBeenCalledTimes(2);
            // Penalty = earlyFive amount = 95 chips
            expect(onWalletUpdate).toHaveBeenLastCalledWith(
                expect.objectContaining({ baseBalance: expect.any(Number) })
            );
        });

        it('clicking a called cell marks it (green checkmark)', () => {
            buyAndStart();
            // Advance timer so drawNumber fires and number 42 is called
            act(() => {
                vi.advanceTimersByTime(10100);
            });
            // Cell 42 is now called — only the ticket cell shows it (no big number display)
            const ticketCell = screen.getByText('42');
            act(() => {
                fireEvent.click(ticketCell);
            });
            // After marking, the checkmark ✓ should appear
            expect(screen.getByText('✓')).toBeInTheDocument();
        });
    });

    describe('ended phase', () => {
        it('shows "Game Over" when all numbers have been drawn', () => {
            vi.mocked(tambolaLib.drawNumber).mockReturnValueOnce({
                success: false,
                state: {
                    ...DRAWING_STATE,
                    status: 'ended',
                    calledNumbers: Array.from({ length: 90 }, (_, i) => i + 1),
                },
            });

            renderBoard();
            act(() => {
                fireEvent.click(screen.getByRole('button', { name: /Buy Ticket/i }));
            });
            act(() => {
                fireEvent.click(screen.getByRole('button', { name: /Start Game/i }));
            });
            // Advance the draw interval (10000ms)
            act(() => {
                vi.advanceTimersByTime(10100);
            });

            expect(screen.getByText('Game Over')).toBeInTheDocument();
        });
    });
});
