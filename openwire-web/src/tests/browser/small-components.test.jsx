/**
 * small-components.test.jsx
 *
 * Tests for small zero-coverage components:
 * HowToPlay.jsx, GameBoard.jsx, PostSessionSummary.jsx
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

/* ═══════════════════════════════════════════════════════════════
   SECTION A — HowToPlay
   ═══════════════════════════════════════════════════════════════ */

import HowToPlay from '../../components/HowToPlay.jsx';

describe('HowToPlay', () => {
    it('renders the How to Play title', () => {
        render(<HowToPlay onClose={vi.fn()} />);
        expect(screen.getByText('How to Play')).toBeInTheDocument();
    });

    it('defaults to roulette when no activeGame specified', () => {
        const { container } = render(<HowToPlay onClose={vi.fn()} />);
        const active = container.querySelector('.howtoplay-tab.active');
        expect(active.textContent).toContain('Roulette');
    });

    it('starts on the specified activeGame tab', () => {
        const { container } = render(<HowToPlay activeGame="blackjack" onClose={vi.fn()} />);
        const active = container.querySelector('.howtoplay-tab.active');
        expect(active.textContent).toContain('Blackjack');
    });

    it('renders all game tabs', () => {
        const { container } = render(<HowToPlay onClose={vi.fn()} />);
        const tabs = container.querySelectorAll('.howtoplay-tab');
        expect(tabs).toHaveLength(5);
    });

    it('switches game when tab clicked', () => {
        const { container } = render(<HowToPlay activeGame="roulette" onClose={vi.fn()} />);
        // Click blackjack tab
        const bjTab = Array.from(container.querySelectorAll('.howtoplay-tab'))
            .find(el => el.textContent.includes('Blackjack'));
        fireEvent.click(bjTab);
        // Now blackjack title should be in content
        expect(container.querySelector('.howtoplay-title').textContent).toContain('Blackjack');
    });

    it('renders bets and payouts section', () => {
        render(<HowToPlay activeGame="roulette" onClose={vi.fn()} />);
        expect(screen.getByText(/Bets & Payouts/)).toBeInTheDocument();
    });

    it('renders close button', () => {
        const onClose = vi.fn();
        render(<HowToPlay onClose={onClose} />);
        fireEvent.click(screen.getByText('✕'));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose when clicking overlay background', () => {
        const onClose = vi.fn();
        const { container } = render(<HowToPlay onClose={onClose} />);
        const overlay = container.querySelector('.game-overlay');
        fireEvent.click(overlay);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('falls back to roulette for invalid activeGame', () => {
        const { container } = render(<HowToPlay activeGame="nonexistent" onClose={vi.fn()} />);
        const active = container.querySelector('.howtoplay-tab.active');
        expect(active.textContent).toContain('Roulette');
    });
});

/* ═══════════════════════════════════════════════════════════════
   SECTION B — GameBoard (Tic-Tac-Toe)
   ═══════════════════════════════════════════════════════════════ */

import GameBoard from '../../components/GameBoard.jsx';
import * as gameLib from '../../lib/game.js';

function makeGameState(overrides = {}) {
    return {
        board: Array(9).fill(gameLib.CELL.EMPTY),
        turn: gameLib.CELL.X,
        result: null,
        playerX: { peer_id: 'me', nick: 'Alice' },
        playerO: { peer_id: 'opp', nick: 'Bob' },
        score: { x: 0, o: 0, draws: 0 },
        ...overrides,
    };
}

describe('GameBoard', () => {
    it('renders Tic-Tac-Toe title', () => {
        render(<GameBoard game={makeGameState()} myId="me" onMove={vi.fn()} onRematch={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByText('Tic-Tac-Toe')).toBeInTheDocument();
    });

    it('renders 9 cells', () => {
        const { container } = render(<GameBoard game={makeGameState()} myId="me" onMove={vi.fn()} onRematch={vi.fn()} onClose={vi.fn()} />);
        expect(container.querySelectorAll('.game-cell')).toHaveLength(9);
    });

    it('shows player names', () => {
        const { container } = render(<GameBoard game={makeGameState()} myId="me" onMove={vi.fn()} onRematch={vi.fn()} onClose={vi.fn()} />);
        const players = container.querySelector('.game-players');
        expect(players.textContent).toContain('Alice');
        expect(players.textContent).toContain('Bob');
    });

    it('shows "Your turn" when it is my turn', () => {
        render(<GameBoard game={makeGameState()} myId="me" onMove={vi.fn()} onRematch={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByText(/Your turn/)).toBeInTheDocument();
    });

    it('shows "Waiting for" when it is opponent turn', () => {
        render(<GameBoard game={makeGameState({ turn: gameLib.CELL.O })} myId="me" onMove={vi.fn()} onRematch={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByText(/Waiting for/)).toBeInTheDocument();
    });

    it('calls onMove when clicking empty cell on my turn', () => {
        const onMove = vi.fn();
        const { container } = render(<GameBoard game={makeGameState()} myId="me" onMove={onMove} onRematch={vi.fn()} onClose={vi.fn()} />);
        const cells = container.querySelectorAll('.game-cell');
        fireEvent.click(cells[0]);
        expect(onMove).toHaveBeenCalledWith(0);
    });

    it('does not call onMove on opponent turn', () => {
        const onMove = vi.fn();
        const { container } = render(<GameBoard game={makeGameState({ turn: gameLib.CELL.O })} myId="me" onMove={onMove} onRematch={vi.fn()} onClose={vi.fn()} />);
        const cells = container.querySelectorAll('.game-cell');
        fireEvent.click(cells[0]);
        expect(onMove).not.toHaveBeenCalled();
    });

    it('shows win message with correct winner', () => {
        render(<GameBoard game={makeGameState({ result: 'X', board: [1, 1, 1, 0, 0, 0, 0, 0, 0] })} myId="me" onMove={vi.fn()} onRematch={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByText(/Alice wins/)).toBeInTheDocument();
    });

    it('shows draw message', () => {
        render(<GameBoard game={makeGameState({ result: 'draw' })} myId="me" onMove={vi.fn()} onRematch={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByText(/Draw/)).toBeInTheDocument();
    });

    it('shows Rematch button when game is over', () => {
        const onRematch = vi.fn();
        render(<GameBoard game={makeGameState({ result: 'X' })} myId="me" onMove={vi.fn()} onRematch={onRematch} onClose={vi.fn()} />);
        fireEvent.click(screen.getByText('Rematch'));
        expect(onRematch).toHaveBeenCalledOnce();
    });

    it('shows Rules button when onHelp provided', () => {
        const onHelp = vi.fn();
        render(<GameBoard game={makeGameState()} myId="me" onMove={vi.fn()} onRematch={vi.fn()} onClose={vi.fn()} onHelp={onHelp} />);
        fireEvent.click(screen.getByText('? Rules'));
        expect(onHelp).toHaveBeenCalledOnce();
    });

    it('shows Close button', () => {
        const onClose = vi.fn();
        render(<GameBoard game={makeGameState()} myId="me" onMove={vi.fn()} onRematch={vi.fn()} onClose={onClose} />);
        fireEvent.click(screen.getByText('Close'));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('shows scores', () => {
        const { container } = render(<GameBoard game={makeGameState({ score: { x: 3, o: 1, draws: 2 } })} myId="me" onMove={vi.fn()} onRematch={vi.fn()} onClose={vi.fn()} />);
        const score = container.querySelector('.game-score');
        expect(score.textContent).toContain('3');
        expect(score.textContent).toContain('2');
        expect(score.textContent).toContain('1');
    });

    it('highlights winning cells', () => {
        // Board: X wins first row
        const board = [1, 1, 1, 2, 0, 0, 2, 0, 0]; // 1=X, 2=O, 0=empty
        const { container } = render(
            <GameBoard game={makeGameState({ result: 'X', board })} myId="me" onMove={vi.fn()} onRematch={vi.fn()} onClose={vi.fn()} />
        );
        const winCells = container.querySelectorAll('.game-cell.win');
        expect(winCells).toHaveLength(3);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SECTION C — PostSessionSummary
   ═══════════════════════════════════════════════════════════════ */

import PostSessionSummary from '../../components/PostSessionSummary.jsx';

describe('PostSessionSummary', () => {
    it('returns null when event is null', () => {
        const { container } = render(<PostSessionSummary event={null} myId="me" onClose={vi.fn()} />);
        expect(container.innerHTML).toBe('');
    });

    describe('non-financial (TTT)', () => {
        const event = {
            financial: false,
            gameType: 'tictactoe',
            resultLabel: 'Alice wins!',
            playerStats: [
                { peer_id: 'me', nick: 'Alice', outcome: 'win' },
                { peer_id: 'opp', nick: 'Bob', outcome: 'loss' },
            ],
        };

        it('shows result label', () => {
            render(<PostSessionSummary event={event} myId="me" onClose={vi.fn()} />);
            expect(screen.getByText('Alice wins!')).toBeInTheDocument();
        });

        it('shows win outcome banner', () => {
            render(<PostSessionSummary event={event} myId="me" onClose={vi.fn()} />);
            expect(screen.getByText(/You Win/)).toBeInTheDocument();
        });

        it('shows loss outcome for losing player', () => {
            render(<PostSessionSummary event={event} myId="opp" onClose={vi.fn()} />);
            expect(screen.getByText(/You Lose/)).toBeInTheDocument();
        });

        it('shows draw outcome', () => {
            const drawEvent = {
                ...event,
                playerStats: [{ peer_id: 'me', nick: 'Alice', outcome: 'draw' }],
            };
            render(<PostSessionSummary event={drawEvent} myId="me" onClose={vi.fn()} />);
            expect(screen.getByText(/Draw/)).toBeInTheDocument();
        });

        it('shows Continue button', () => {
            const onClose = vi.fn();
            render(<PostSessionSummary event={event} myId="me" onClose={onClose} />);
            fireEvent.click(screen.getByText('Continue'));
            expect(onClose).toHaveBeenCalledOnce();
        });
    });

    describe('financial (casino)', () => {
        const event = {
            financial: true,
            gameType: 'roulette',
            resultLabel: 'Result: 7 Red',
            totals: { me: 850 },
            breakdown: [
                { peer_id: 'me', betLabel: 'Red', wager: 100, net: 100, outcome: 'win' },
                { peer_id: 'me', betLabel: '#7', wager: 25, net: 750, outcome: 'win' },
            ],
        };

        it('shows result label', () => {
            render(<PostSessionSummary event={event} myId="me" onClose={vi.fn()} />);
            expect(screen.getByText('Result: 7 Red')).toBeInTheDocument();
        });

        it('shows net total', () => {
            render(<PostSessionSummary event={event} myId="me" onClose={vi.fn()} />);
            expect(screen.getByText(/\+850/)).toBeInTheDocument();
        });

        it('shows bet breakdown', () => {
            render(<PostSessionSummary event={event} myId="me" onClose={vi.fn()} />);
            expect(screen.getByText('Red')).toBeInTheDocument();
            expect(screen.getByText('#7')).toBeInTheDocument();
        });

        it('shows negative total for losses', () => {
            const lossEvent = { ...event, totals: { me: -100 }, breakdown: [
                { peer_id: 'me', betLabel: 'Black', wager: 100, net: -100, outcome: 'loss' },
            ] };
            const { container } = render(<PostSessionSummary event={lossEvent} myId="me" onClose={vi.fn()} />);
            const total = container.querySelector('.pss-net-total');
            expect(total.textContent).toContain('-100');
        });

        it('shows "no bets" message when player had no bets', () => {
            const noBetsEvent = { ...event, breakdown: [], totals: { me: 0 } };
            render(<PostSessionSummary event={noBetsEvent} myId="me" onClose={vi.fn()} />);
            expect(screen.getByText(/no bets/)).toBeInTheDocument();
        });

        it('shows Got it button', () => {
            const onClose = vi.fn();
            render(<PostSessionSummary event={event} myId="me" onClose={onClose} />);
            fireEvent.click(screen.getByText('Got it'));
            expect(onClose).toHaveBeenCalledOnce();
        });
    });
});
