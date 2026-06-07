import { render, screen, fireEvent, act } from '@testing-library/react';
import { beforeEach, afterEach, vi } from 'vitest';
import MonopolyBoard from '../../components/MonopolyBoard.jsx';

function makeGame(overrides = {}) {
    return {
        phase: 'rolling',
        turnNumber: 3,
        currentPlayer: 0,
        dice: [3, 4],
        diceRolled: false,
        winner: null,
        log: ['Alice bought Baltic'],
        players: [
            { peer_id: 'me', nick: 'Alice', money: 1380, position: 1, properties: [2], inJail: false, eliminated: false },
            { peer_id: 'opp', nick: 'Bob', money: 1500, position: 7, properties: [], inJail: false, eliminated: false },
        ],
        properties: [
            { id: 1, name: 'Mediterranean', group: 'brown', price: 60, rent: [2, 4], houses: 0, owner: null },
            { id: 2, name: 'Baltic', group: 'brown', price: 60, rent: [4, 8], houses: 0, owner: 'me' },
        ],
        ...overrides,
    };
}

describe('MonopolyBoard', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders the Monopoly title and current turn summary', () => {
        render(
            <MonopolyBoard
                game={makeGame()}
                myId="me"
                onAction={vi.fn()}
                onClose={vi.fn()}
                onHelp={vi.fn()}
            />
        );

        expect(screen.getAllByText(/MONOPOLY/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/\$1,380/).length).toBeGreaterThan(0);
        expect(screen.getByText(/Roll, then end your turn/i)).toBeInTheDocument();
    });

    it('calls onHelp when the help button is clicked', () => {
        const onHelp = vi.fn();

        render(
            <MonopolyBoard
                game={makeGame()}
                myId="me"
                onAction={vi.fn()}
                onClose={vi.fn()}
                onHelp={onHelp}
            />
        );

        fireEvent.click(screen.getAllByText(/Help/i)[0]);
        expect(onHelp).toHaveBeenCalledWith('monopoly');
    });

    it('renders without a help callback', () => {
        render(
            <MonopolyBoard
                game={makeGame()}
                myId="me"
                onAction={vi.fn()}
                onClose={vi.fn()}
            />
        );

        fireEvent.click(screen.getAllByText(/Help/i)[0]);
        expect(screen.getByText(/My Properties/i)).toBeInTheDocument();
    });

    it('shows a lobby start button for the host and triggers begin', () => {
        const onAction = vi.fn();

        render(
            <MonopolyBoard
                game={makeGame({
                    phase: 'lobby',
                    players: [
                        { peer_id: 'me', nick: 'Alice', money: 1500, position: 0, properties: [], inJail: false, eliminated: false },
                        { peer_id: 'opp', nick: 'Bob', money: 1500, position: 0, properties: [], inJail: false, eliminated: false },
                    ],
                })}
                myId="me"
                isHost={true}
                onAction={onAction}
                onClose={vi.fn()}
                onHelp={vi.fn()}
            />
        );

        fireEvent.click(screen.getByText(/Start Game/i));
        expect(onAction).toHaveBeenCalledWith({ type: 'begin' });
    });

    it('shows a start button for non-host players once enough players joined', () => {
        const onAction = vi.fn();

        render(
            <MonopolyBoard
                game={makeGame({
                    phase: 'lobby',
                    players: [
                        { peer_id: 'host', nick: 'Alice', money: 1500, position: 0, properties: [], inJail: false, eliminated: false },
                        { peer_id: 'me', nick: 'Bob', money: 1500, position: 0, properties: [], inJail: false, eliminated: false },
                    ],
                })}
                myId="me"
                isHost={false}
                onAction={onAction}
                onClose={vi.fn()}
                onHelp={vi.fn()}
            />
        );

        fireEvent.click(screen.getByText(/Start When Ready/i));
        expect(onAction).toHaveBeenCalledWith({ type: 'begin' });
    });

    it('keeps dice rolling until the authoritative dice result arrives', () => {
        const onAction = vi.fn();
        const { rerender, container } = render(
            <MonopolyBoard
                game={makeGame({ dice: [0, 0] })}
                myId="me"
                onAction={onAction}
                onClose={vi.fn()}
                onHelp={vi.fn()}
            />
        );

        fireEvent.click(screen.getByText(/Roll Dice/i));
        expect(onAction).toHaveBeenCalledWith({ type: 'roll' });
        expect(container.querySelectorAll('.mono-die.rolling').length).toBe(2);

        rerender(
            <MonopolyBoard
                game={makeGame({ dice: [6, 3], diceRolled: true })}
                myId="me"
                onAction={onAction}
                onClose={vi.fn()}
                onHelp={vi.fn()}
            />
        );

        expect(container.querySelectorAll('.mono-die.rolling').length).toBe(2);
        act(() => {
            vi.advanceTimersByTime(600);
        });
        expect(container.querySelectorAll('.mono-die.rolling').length).toBe(0);
    });
});
