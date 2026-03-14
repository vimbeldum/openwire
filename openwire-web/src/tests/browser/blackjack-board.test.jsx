/**
 * blackjack-board.test.jsx
 *
 * Vitest + RTL tests for BlackjackBoard component.
 * Key focus: score must NOT appear before card animations complete;
 * covers deal-animation gating, score reveal, phase labels, actions.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi } from 'vitest';
import BlackjackBoard from '../../components/BlackjackBoard.jsx';
import * as bj from '../../lib/blackjack.js';

// ── helpers ────────────────────────────────────────────────────────────────────

function makeCard(value, suit = '♠', id = undefined) {
    return { value, suit, id: id ?? `${value}${suit}` };
}

function makePlayer(peer_id, nick, hand = [], opts = {}) {
    return { peer_id, nick, hand, bet: 100, status: '', ...opts };
}

const WALLET = { baseBalance: 1000, adminBonus: 0 };

function makeGame(overrides = {}) {
    return {
        phase: 'playing',
        players: [makePlayer('me', 'Alice', [makeCard('A'), makeCard('7')])],
        dealer: { hand: [makeCard('K'), makeCard('6')], revealed: false },
        currentPlayerIndex: 0,
        nextDealAt: Date.now() + 30000,
        bettingEndsAt: Date.now() + 30000,
        deck: [],
        deckCount: 52,
        bets: [],
        ...overrides,
    };
}

function renderBoard(gameOverrides = {}, props = {}) {
    const defaults = {
        game: makeGame(gameOverrides),
        myId: 'me',
        myNick: 'Alice',
        wallet: WALLET,
        onAction: vi.fn(),
        onClose: vi.fn(),
        onHelp: vi.fn(),
        isHost: false,
        onReady: vi.fn(),
        onNewRound: vi.fn(),
        readyCount: 0,
        totalBettors: 1,
        isReady: false,
    };
    return render(<BlackjackBoard {...defaults} {...props} />);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('BlackjackBoard', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

    describe('score / animation gating', () => {
        it('hides score with "…" while cards are being dealt (revealCount < hand length)', () => {
            // Simulate the board right after transitioning from betting → playing.
            // At that moment revealedCards=0 so no cards are revealed yet.
            // We simulate this by rendering a game that just left 'betting'.
            const bettingGame = makeGame({ phase: 'betting' });
            const { rerender } = render(
                <BlackjackBoard
                    game={bettingGame}
                    myId="me"
                    myNick="Alice"
                    wallet={WALLET}
                    onAction={vi.fn()}
                    onClose={vi.fn()}
                    isHost={false}
                    onReady={vi.fn()}
                    onNewRound={vi.fn()}
                    readyCount={0}
                    totalBettors={1}
                    isReady={false}
                />
            );

            // Transition to playing — deal animation starts, revealedCards = 0
            const playingGame = makeGame({ phase: 'playing' });
            rerender(
                <BlackjackBoard
                    game={playingGame}
                    myId="me"
                    myNick="Alice"
                    wallet={WALLET}
                    onAction={vi.fn()}
                    onClose={vi.fn()}
                    isHost={false}
                    onReady={vi.fn()}
                    onNewRound={vi.fn()}
                    readyCount={0}
                    totalBettors={1}
                    isReady={false}
                />
            );

            // Before any DEAL_CARD_DELAY_MS ticks: score should be hidden
            const handValues = screen.getAllByText('…');
            expect(handValues.length).toBeGreaterThan(0);
        });

        it('shows score after all deal animation intervals have fired', () => {
            const bettingGame = makeGame({ phase: 'betting' });
            const { rerender } = render(
                <BlackjackBoard
                    game={bettingGame}
                    myId="me"
                    myNick="Alice"
                    wallet={WALLET}
                    onAction={vi.fn()}
                    onClose={vi.fn()}
                    isHost={false}
                    onReady={vi.fn()}
                    onNewRound={vi.fn()}
                    readyCount={0}
                    totalBettors={1}
                    isReady={false}
                />
            );

            const playingGame = makeGame({ phase: 'playing' });
            rerender(
                <BlackjackBoard
                    game={playingGame}
                    myId="me"
                    myNick="Alice"
                    wallet={WALLET}
                    onAction={vi.fn()}
                    onClose={vi.fn()}
                    isHost={false}
                    onReady={vi.fn()}
                    onNewRound={vi.fn()}
                    readyCount={0}
                    totalBettors={1}
                    isReady={false}
                />
            );

            // Player has 2 cards + dealer has 2 cards = 4 total — advance 4 deal intervals
            act(() => {
                vi.advanceTimersByTime(bj.DEAL_CARD_DELAY_MS * 5);
            });

            // Score "18" (A+7) should now be visible for Alice
            expect(screen.getByText('18')).toBeInTheDocument();
            // '…' should be gone
            expect(screen.queryByText('…')).not.toBeInTheDocument();
        });

        it('shows score immediately when game is already in playing phase (no deal animation)', () => {
            // Rendering directly into playing without a betting→playing transition
            // means revealedCards starts at 999 (no deal animation triggered)
            renderBoard({ phase: 'playing' });
            expect(screen.getByText('18')).toBeInTheDocument();
        });

        it('shows "?" for dealer hidden card, not the actual value', () => {
            renderBoard({ phase: 'playing' });
            // Dealer has K+6 = 16, but hole card is hidden — score must NOT appear
            expect(screen.queryByText('16')).not.toBeInTheDocument();
            // The bj-hand-val shows '?' — may coexist with the help button '?'
            const questions = screen.getAllByText('?');
            // At least one is the dealer hand value
            expect(questions.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('rendering', () => {
        it('renders without crashing', () => {
            renderBoard();
            expect(screen.getByText(/Blackjack/i)).toBeInTheDocument();
        });

        it('close button calls onClose', () => {
            const onClose = vi.fn();
            renderBoard({}, { onClose });
            fireEvent.click(screen.getByRole('button', { name: '✕' }));
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('shows player name in hand label', () => {
            renderBoard();
            // Appears in the bj-hand-name span inside the player hand zone
            const names = screen.getAllByText(/Alice/i);
            expect(names.length).toBeGreaterThanOrEqual(1);
        });

        it('shows wallet balance', () => {
            renderBoard();
            expect(screen.getByText(/1,000/)).toBeInTheDocument();
        });

        it('shows the player\'s turn message on my turn', () => {
            renderBoard({ phase: 'playing' });
            // Phase bar reads "Alice's turn (You)" — check the phase bar specifically
            const phaseMsgs = document.querySelectorAll('.bj-phase-msg');
            const text = Array.from(phaseMsgs).map(el => el.textContent).join(' ');
            expect(text).toMatch(/turn/i);
            expect(text).toMatch(/You/i);
        });
    });

    describe('phase labels', () => {
        it('shows "Place your bets!" in betting phase', () => {
            renderBoard({ phase: 'betting' });
            expect(screen.getByText(/Place your bets/i)).toBeInTheDocument();
        });

        it('shows "Dealer is playing..." in dealer phase', () => {
            renderBoard({ phase: 'dealer' });
            expect(screen.getByText(/Dealer is playing/i)).toBeInTheDocument();
        });

        it('shows "Revealing..." in ended phase before delay expires', () => {
            renderBoard({ phase: 'ended' });
            // showResults is false immediately after phase change
            expect(screen.getByText(/Revealing/i)).toBeInTheDocument();
        });

        it('shows "Round complete!" after DEALER_REVEAL_DELAY_MS', () => {
            const { rerender } = renderBoard({ phase: 'playing' });
            // Transition to ended
            rerender(
                <BlackjackBoard
                    game={makeGame({ phase: 'ended' })}
                    myId="me"
                    myNick="Alice"
                    wallet={WALLET}
                    onAction={vi.fn()}
                    onClose={vi.fn()}
                    isHost={false}
                    onReady={vi.fn()}
                    onNewRound={vi.fn()}
                    readyCount={0}
                    totalBettors={1}
                    isReady={false}
                />
            );
            act(() => {
                vi.advanceTimersByTime(bj.DEALER_REVEAL_DELAY_MS + 100);
            });
            expect(screen.getByText(/Round complete/i)).toBeInTheDocument();
        });
    });

    describe('betting phase actions', () => {
        it('shows chip-selector buttons when player status is waiting', () => {
            // Player has status 'waiting' → chip selector + Bet button shown
            renderBoard({
                phase: 'betting',
                players: [makePlayer('me', 'Alice', [], { status: 'waiting', bet: 0 })],
            });
            // BET_AMOUNTS = [10, 25, 50, 100, 250, 500]
            expect(screen.getByRole('button', { name: '50' })).toBeInTheDocument();
        });

        it('shows Bet button when player status is waiting', () => {
            renderBoard({
                phase: 'betting',
                players: [makePlayer('me', 'Alice', [], { status: 'waiting', bet: 0 })],
            });
            expect(screen.getByRole('button', { name: /Bet/i })).toBeInTheDocument();
        });

        it('shows "Bet placed" text and Ready button when player already placed a bet', () => {
            // Default makePlayer has no status (not 'waiting') and bet=100 → locked view
            renderBoard({ phase: 'betting' });
            expect(screen.getByText(/Bet placed/i)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /Ready/i })).toBeInTheDocument();
        });
    });

    describe('playing phase actions', () => {
        it('shows Hit and Stand buttons on my turn', () => {
            renderBoard({ phase: 'playing' });
            expect(screen.getByRole('button', { name: /Hit/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /Stand/i })).toBeInTheDocument();
        });

        it('Hit button calls onAction with type "hit"', () => {
            const onAction = vi.fn();
            renderBoard({ phase: 'playing' }, { onAction });
            fireEvent.click(screen.getByRole('button', { name: /Hit/i }));
            expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type: 'hit' }));
        });

        it('Stand button calls onAction with type "stand"', () => {
            const onAction = vi.fn();
            renderBoard({ phase: 'playing' }, { onAction });
            fireEvent.click(screen.getByRole('button', { name: /Stand/i }));
            expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type: 'stand' }));
        });
    });
});
