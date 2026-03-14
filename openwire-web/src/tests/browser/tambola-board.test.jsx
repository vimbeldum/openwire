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
}));

// ── helpers ────────────────────────────────────────────────────────────────────

function renderBoard(props = {}) {
    const defaults = {
        myId: 'testId',
        myNick: 'Tester',
        wallet: 1000,
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
            // The Buy Ticket button contains "100 chips"
            expect(screen.getByRole('button', { name: /Buy Ticket.*100 chips/i })).toBeInTheDocument();
        });

        it('shows ticket price in the rules text', () => {
            renderBoard();
            // Rules paragraph references the ticket price
            expect(screen.getByText(/Each ticket costs/i)).toBeInTheDocument();
        });

        it('does not show "Start Game" button before buying a ticket', () => {
            renderBoard();
            expect(screen.queryByRole('button', { name: /Start Game/i })).not.toBeInTheDocument();
        });

        it('"Buy Ticket" is disabled when wallet < ticket price', () => {
            renderBoard({ wallet: 50 }); // less than TICKET_PRICE (100)
            expect(screen.getByRole('button', { name: /Buy Ticket/i })).toBeDisabled();
        });

        it('buying a ticket calls onWalletUpdate', () => {
            const onWalletUpdate = vi.fn();
            renderBoard({ wallet: 1000, onWalletUpdate });
            act(() => {
                fireEvent.click(screen.getByRole('button', { name: /Buy Ticket/i }));
            });
            expect(onWalletUpdate).toHaveBeenCalledWith(900);
        });

        it('ticket grid renders after buying a ticket', () => {
            renderBoard({ wallet: 1000 });
            act(() => {
                fireEvent.click(screen.getByRole('button', { name: /Buy Ticket/i }));
            });
            // Numbers from SAMPLE_GRID row 0 — cell value 1 should appear
            expect(screen.getByText('1')).toBeInTheDocument();
        });

        it('"Start Game" button appears after buying a ticket', () => {
            renderBoard({ wallet: 1000 });
            act(() => {
                fireEvent.click(screen.getByRole('button', { name: /Buy Ticket/i }));
            });
            expect(screen.getByRole('button', { name: /Start Game/i })).toBeInTheDocument();
        });
    });

    describe('playing phase', () => {
        function buyAndStart() {
            renderBoard({ wallet: 1000 });
            act(() => {
                fireEvent.click(screen.getByRole('button', { name: /Buy Ticket/i }));
            });
            act(() => {
                fireEvent.click(screen.getByRole('button', { name: /Start Game/i }));
            });
        }

        it('shows "Called Numbers" section heading in playing phase', () => {
            buyAndStart();
            expect(screen.getByText('Called Numbers')).toBeInTheDocument();
        });

        it('shows "Last Called" label in playing phase', () => {
            buyAndStart();
            expect(screen.getByText('Last Called')).toBeInTheDocument();
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

        it('shows rejection toast when claim pattern is incomplete', () => {
            buyAndStart();
            act(() => {
                fireEvent.click(screen.getByRole('button', { name: /Early Five/i }));
            });
            // claimPrize returns { success: false, reason: 'Claim pattern not complete' }
            // Component shows 'Bogus Claim!' toast for that reason
            expect(screen.getByText('Bogus Claim!')).toBeInTheDocument();
        });
    });

    describe('ended phase', () => {
        it('shows "Game Over" when all numbers have been drawn', () => {
            // Make drawNumber signal end-of-game on first call
            vi.mocked(tambolaLib.drawNumber).mockReturnValueOnce({
                success: false,
                state: {
                    ...DRAWING_STATE,
                    status: 'ended',
                    calledNumbers: Array.from({ length: 90 }, (_, i) => i + 1),
                },
            });

            renderBoard({ wallet: 1000 });
            act(() => {
                fireEvent.click(screen.getByRole('button', { name: /Buy Ticket/i }));
            });
            act(() => {
                fireEvent.click(screen.getByRole('button', { name: /Start Game/i }));
            });
            // Advance the draw interval (3000ms)
            act(() => {
                vi.advanceTimersByTime(3100);
            });

            expect(screen.getByText('Game Over')).toBeInTheDocument();
        });
    });
});
