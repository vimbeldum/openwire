/**
 * chatroom-shashn-journey.test.jsx
 *
 * Vitest + RTL tests for ShashnBoard rendering in different game phases.
 * Verifies phase labels, card rendering, and board open/close continuity.
 *
 * M004/S01/T01: Add deterministic SHASN journey proof coverage
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import ShashnBoard from '../../components/ShashnBoard.jsx';
import ShashnStateSummary from '../../components/chat/ShashnStateSummary.jsx';
import * as shashn from '../../lib/shashn.js';

/* ── Fixtures ──────────────────────────────────────────────── */

function makeCard(rank = 'A', suit = 'Spades', id) {
    return { rank, suit, id: id ?? `${rank}${suit[0]}` };
}

function makePlayer(peer_id, nick, hand = [], overrides = {}) {
    return { peer_id, nick, hand, tricksWon: 0, score: 0, ...overrides };
}

const WALLET = { baseBalance: 1000, adminBonus: 0 };

/**
 * Create a deterministic Shashn game state for testing.
 * Override only what the test needs to change.
 */
function makeGame(overrides = {}) {
    return {
        type: 'shashn',
        roomId: 'test-room-001',
        phase: 'deal',
        players: [
            makePlayer('me', 'Alice', []),
            makePlayer(null, null, []),
        ],
        currentPlayer: 0,
        currentTrick: { cards: [], leadSuit: null, winner: null },
        deck: null,
        trumpSuit: null,
        round: 1,
        trickNumber: 1,
        log: [],
        winner: null,
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
        isHost: true,
        onReady: vi.fn(),
        readyCount: 0,
        totalBettors: 1,
        isReady: false,
    };
    return render(<ShashnBoard {...defaults} {...props} />);
}

/* ── Tests ─────────────────────────────────────────────────── */

describe('ShashnBoard phase labels', () => {
    afterEach(() => { vi.clearAllMocks(); });

    it('renders loading state when game is null', () => {
        render(<ShashnBoard
            game={null}
            myId="me"
            myNick="Alice"
            wallet={WALLET}
            onAction={vi.fn()}
            onClose={vi.fn()}
            onHelp={vi.fn()}
            isHost={false}
        />);
        expect(screen.getByText('Loading game...')).toBeInTheDocument();
    });

    it('shows "Waiting for players..." in deal phase', () => {
        renderBoard({ phase: 'deal' });
        // The phase label in .shashn-phase
        const phaseEls = screen.getAllByText(/Waiting for players/i);
        expect(phaseEls.length).toBeGreaterThanOrEqual(1);
    });

    it('shows specific waiting message when only one player has joined', () => {
        renderBoard({
            phase: 'deal',
            players: [
                makePlayer('me', 'Alice', []),
                makePlayer(null, null, []),
            ],
        });
        // Second player slot shows "Waiting..."
        expect(screen.getByText('Waiting for second player...')).toBeInTheDocument();
        // First player slot shows ✓ indicator
        expect(screen.getByText('Waiting...')).toBeInTheDocument(); // player name for empty slot
    });

    it('shows waiting text when both slots are empty', () => {
        renderBoard({
            phase: 'deal',
            players: [
                makePlayer(null, null, []),
                makePlayer(null, null, []),
            ],
        });
        expect(screen.getByText('Waiting for both players to join...')).toBeInTheDocument();
    });

    it('shows "Your turn — play a card!" when it is my turn in play phase', () => {
        renderBoard({
            phase: 'play',
            currentPlayer: 0,
            players: [
                makePlayer('me', 'Alice', [makeCard('A'), makeCard('K')]),
                makePlayer('peer-2', 'Bob', [makeCard('Q')]),
            ],
        });
        expect(screen.getByText(/Your turn.*play a card/i)).toBeInTheDocument();
    });

    it('shows "Opponent\'s turn..." when it is not my turn in play phase', () => {
        renderBoard({
            phase: 'play',
            currentPlayer: 1,
            players: [
                makePlayer('me', 'Alice', [makeCard('A')]),
                makePlayer('peer-2', 'Bob', [makeCard('Q')]),
            ],
        });
        expect(screen.getByText(/Opponent.*turn/i)).toBeInTheDocument();
    });

    it('shows "Trick complete!" in trick_end phase', () => {
        renderBoard({
            phase: 'trick_end',
            players: [
                makePlayer('me', 'Alice', [makeCard('A')]),
                makePlayer('peer-2', 'Bob', [makeCard('Q')]),
            ],
            currentTrick: {
                cards: [
                    { player: 0, card: makeCard('A') },
                    { player: 1, card: makeCard('Q') },
                ],
                leadSuit: 'Spades',
                winner: 0,
            },
        });
        expect(screen.getByText('Trick complete!')).toBeInTheDocument();
    });

    it('shows "Game Over!" in game_end phase', () => {
        renderBoard({
            phase: 'game_end',
            winner: 'me',
            players: [
                makePlayer('me', 'Alice', [], { score: 150 }),
                makePlayer('peer-2', 'Bob', [], { score: 20 }),
            ],
        });
        expect(screen.getByText('Game Over!')).toBeInTheDocument();
    });

    it('shows winner name when game is over', () => {
        renderBoard({
            phase: 'game_end',
            winner: 'me',
            players: [
                makePlayer('me', 'Alice', [], { score: 150 }),
                makePlayer('peer-2', 'Bob', [], { score: 20 }),
            ],
        });
        expect(screen.getByText(/Alice Wins/i)).toBeInTheDocument();
    });
});

describe('ShashnBoard rendering', () => {
    afterEach(() => { vi.clearAllMocks(); });

    it('renders title', () => {
        renderBoard({ phase: 'play' });
        const titles = screen.getAllByText('Shashn');
        expect(titles.length).toBeGreaterThanOrEqual(1);
    });

    it('renders round info in play phase', () => {
        const { container } = renderBoard({
            phase: 'play',
            round: 2,
            trickNumber: 3,
            players: [
                makePlayer('me', 'Alice', [makeCard('7'), makeCard('K')]),
                makePlayer('peer-2', 'Bob', [makeCard('Q')]),
            ],
        });
        expect(screen.getByText(/Round 2/)).toBeInTheDocument();
        expect(screen.getByText(/Trick 3\/6/)).toBeInTheDocument();
        // 'Target: 150' appears in both round-info and score-progress
        const targetEls = screen.getAllByText(/Target: 150/);
        expect(targetEls.length).toBeGreaterThanOrEqual(1);
        // Verify the round-info section specifically has it
        const roundInfo = container.querySelector('.shashn-round-info');
        expect(roundInfo.textContent).toContain('Target: 150');
    });

    it('renders player names on the board', () => {
        const { container } = renderBoard({
            phase: 'play',
            players: [
                makePlayer('me', 'Alice', [makeCard('7')]),
                makePlayer('peer-2', 'Bob', [makeCard('Q')]),
            ],
        });
        // Player names appear in both player slots and score panel
        const aliceEls = screen.getAllByText(/Alice/);
        expect(aliceEls.length).toBeGreaterThanOrEqual(1);
        const bobEls = screen.getAllByText(/Bob/);
        expect(bobEls.length).toBeGreaterThanOrEqual(1);
        // Check the player-header slots specifically
        const playerNames = container.querySelectorAll('.shashn-player-name');
        expect(playerNames[0].textContent).toContain('Alice');
        expect(playerNames[1].textContent).toContain('Bob');
    });

    it('renders score stats for both players', () => {
        renderBoard({
            phase: 'play',
            players: [
                makePlayer('me', 'Alice', [makeCard('7')], { score: 5, tricksWon: 3 }),
                makePlayer('peer-2', 'Bob', [makeCard('Q')], { score: 3, tricksWon: 2 }),
            ],
        });
        // Score values rendered in .shashn-stat-value.score
        const scores = document.querySelectorAll('.shashn-stat-value.score');
        expect(scores.length).toBe(2);
        expect(scores[0].textContent).toBe('5');
        expect(scores[1].textContent).toBe('3');
    });

    it('renders trick count stats for both players', () => {
        renderBoard({
            phase: 'play',
            players: [
                makePlayer('me', 'Alice', [makeCard('7')], { tricksWon: 3 }),
                makePlayer('peer-2', 'Bob', [makeCard('Q')], { tricksWon: 2 }),
            ],
        });
        const trickValues = document.querySelectorAll('.shashn-stat-value.tricks');
        expect(trickValues.length).toBe(2);
        expect(trickValues[0].textContent).toBe('3');
        expect(trickValues[1].textContent).toBe('2');
    });

    it('renders my hand with card elements when in play phase', () => {
        const { container } = renderBoard({
            phase: 'play',
            players: [
                makePlayer('me', 'Alice', [makeCard('7'), makeCard('K', 'Diamonds'), makeCard('A', 'Hearts')]),
                makePlayer('peer-2', 'Bob', [makeCard('Q')]),
            ],
        });
        // Should show hand header
        expect(screen.getByText(/Your Hand/)).toBeInTheDocument();
        // Card ranks appear twice (top-left + bottom-right corner),
        // so check that each rank appears at least once via getAllByText
        const sevenEls = screen.getAllByText('7');
        expect(sevenEls.length).toBeGreaterThanOrEqual(1);
        const kEls = screen.getAllByText('K');
        expect(kEls.length).toBeGreaterThanOrEqual(1);
        const aEls = screen.getAllByText('A');
        expect(aEls.length).toBeGreaterThanOrEqual(1);
        // Should have 3 cards rendered as .shashn-card in the hand
        const cards = container.querySelectorAll('.shashn-hand .shashn-card');
        expect(cards.length).toBe(3);
    });

    it('shows suit symbols for cards in hand', () => {
        const { container } = renderBoard({
            phase: 'play',
            players: [
                makePlayer('me', 'Alice', [makeCard('A', 'Hearts'), makeCard('K', 'Diamonds')]),
                makePlayer('peer-2', 'Bob', [makeCard('Q', 'Clubs')]),
            ],
        });
        // Suit symbols appear in corner-suit and card-suit-large elements
        // Use getAllByText and check at least one occurrence
        const heartEls = screen.getAllByText('♥');
        expect(heartEls.length).toBeGreaterThanOrEqual(1);
        const diamondEls = screen.getAllByText('♦');
        expect(diamondEls.length).toBeGreaterThanOrEqual(1);
        // Hearts card should be in the hand
        const handCards = container.querySelectorAll('.shashn-hand .shashn-card');
        expect(handCards.length).toBe(2);
    });

    it('renders trump suit indicator when trumpSuit is set', () => {
        renderBoard({
            phase: 'play',
            trumpSuit: 'Hearts',
            players: [
                makePlayer('me', 'Alice', [makeCard('7')]),
                makePlayer('peer-2', 'Bob', [makeCard('Q')]),
            ],
        });
        expect(screen.getByText(/Trump/)).toBeInTheDocument();
        expect(screen.getByText('Hearts')).toBeInTheDocument();
    });

    it('shows Collect Trick button in trick_end phase', () => {
        renderBoard({
            phase: 'trick_end',
            players: [
                makePlayer('me', 'Alice', [makeCard('A')]),
                makePlayer('peer-2', 'Bob', [makeCard('Q')]),
            ],
            currentTrick: {
                cards: [
                    { player: 0, card: makeCard('A') },
                    { player: 1, card: makeCard('Q') },
                ],
                leadSuit: 'Spades',
                winner: 0,
            },
        });
        expect(screen.getByRole('button', { name: /Collect Trick/i })).toBeInTheDocument();
    });

    it('shows trick winner badge in trick_end phase', () => {
        renderBoard({
            phase: 'trick_end',
            players: [
                makePlayer('me', 'Alice', [makeCard('A')]),
                makePlayer('peer-2', 'Bob', [makeCard('Q')]),
            ],
            currentTrick: {
                cards: [
                    { player: 0, card: makeCard('A', 'Spades', 'AS') },
                    { player: 1, card: makeCard('Q', 'Spades', 'QS') },
                ],
                leadSuit: 'Spades',
                winner: 0,
            },
        });
        // Winner badge ✓ should appear on the winning card
        const winnerBadges = document.querySelectorAll('.shashn-trick-winner-badge');
        expect(winnerBadges.length).toBeGreaterThanOrEqual(1);
    });

    it('shows New Round button in game_end phase', () => {
        renderBoard({
            phase: 'game_end',
            winner: 'me',
            players: [
                makePlayer('me', 'Alice', [], { score: 150 }),
                makePlayer('peer-2', 'Bob', [], { score: 20 }),
            ],
        });
        expect(screen.getByRole('button', { name: /New Round/i })).toBeInTheDocument();
    });
});

describe('ShashnBoard interactions', () => {
    afterEach(() => { vi.clearAllMocks(); });

    it('close button calls onClose', () => {
        const onClose = vi.fn();
        const { container } = renderBoard({ phase: 'deal' }, { onClose });
        // Button text is "✕ Close" — match by class instead
        const closeBtn = container.querySelector('.shashn-btn-close');
        expect(closeBtn).toBeInTheDocument();
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('Help button calls onHelp with "shashn"', () => {
        const onHelp = vi.fn();
        renderBoard({ phase: 'deal' }, { onHelp });
        const helpBtn = screen.getByRole('button', { name: /Help/i });
        fireEvent.click(helpBtn);
        expect(onHelp).toHaveBeenCalledWith('shashn');
    });

    it('clicking a card selects it', () => {
        const { container } = renderBoard({
            phase: 'play',
            currentPlayer: 0,
            players: [
                makePlayer('me', 'Alice', [makeCard('7'), makeCard('K')]),
                makePlayer('peer-2', 'Bob', [makeCard('Q')]),
            ],
        });
        // Find cards in the hand section by class — ranks appear twice per card
        const handCards = container.querySelectorAll('.shashn-hand .shashn-card');
        expect(handCards.length).toBe(2);
        // Click the first card
        fireEvent.click(handCards[0]);
        // Play button should appear with card ID
        expect(screen.getByRole('button', { name: /Play 7S/i })).toBeInTheDocument();
    });

    it('Play button fires onAction after selecting a card', () => {
        const onAction = vi.fn();
        const { container } = renderBoard({
            phase: 'play',
            currentPlayer: 0,
            players: [
                makePlayer('me', 'Alice', [makeCard('7'), makeCard('K')]),
                makePlayer('peer-2', 'Bob', [makeCard('Q')]),
            ],
        }, { onAction });

        // Click the first card in hand
        const handCards = container.querySelectorAll('.shashn-hand .shashn-card');
        fireEvent.click(handCards[0]);
        const playBtn = screen.getByRole('button', { name: /Play 7S/i });
        fireEvent.click(playBtn);
        expect(onAction).toHaveBeenCalledWith({ type: 'play', cardId: '7S' });
    });

    it('Cancel button clears card selection', () => {
        const { container } = renderBoard({
            phase: 'play',
            currentPlayer: 0,
            players: [
                makePlayer('me', 'Alice', [makeCard('7'), makeCard('K')]),
                makePlayer('peer-2', 'Bob', [makeCard('Q')]),
            ],
        });

        // Click first card, then Cancel
        const handCards = container.querySelectorAll('.shashn-hand .shashn-card');
        fireEvent.click(handCards[0]);
        expect(screen.getByRole('button', { name: /Play 7S/i })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
        expect(screen.queryByRole('button', { name: /Play 7S/i })).not.toBeInTheDocument();
    });

    it('Collect Trick fires onAction with type collect', () => {
        const onAction = vi.fn();
        renderBoard({
            phase: 'trick_end',
            players: [
                makePlayer('me', 'Alice', [makeCard('A')]),
                makePlayer('peer-2', 'Bob', [makeCard('Q')]),
            ],
            currentTrick: {
                cards: [
                    { player: 0, card: makeCard('A') },
                    { player: 1, card: makeCard('Q') },
                ],
                leadSuit: 'Spades',
                winner: 0,
            },
        }, { onAction });

        fireEvent.click(screen.getByRole('button', { name: /Collect Trick/i }));
        expect(onAction).toHaveBeenCalledWith({ type: 'collect' });
    });

    it('New Round fires onAction with type newround', () => {
        const onAction = vi.fn();
        renderBoard({
            phase: 'game_end',
            winner: 'me',
            players: [
                makePlayer('me', 'Alice', [], { score: 150 }),
                makePlayer('peer-2', 'Bob', [], { score: 20 }),
            ],
        }, { onAction });

        const newRoundBtn = screen.getByRole('button', { name: /New Round/i });
        fireEvent.click(newRoundBtn);
        expect(onAction).toHaveBeenCalledWith({ type: 'newround' });
    });
});

describe('ShashnBoard game log', () => {
    afterEach(() => { vi.clearAllMocks(); });

    it('renders log entries when present', () => {
        renderBoard({
            phase: 'play',
            players: [
                makePlayer('me', 'Alice', [makeCard('7')]),
                makePlayer('peer-2', 'Bob', [makeCard('Q')]),
            ],
            log: [
                '\u{1F3B4} Shashn started! Trump: Spades',
                'Alice played 7\u2660',
                'Bob played Q\u2660',
            ],
        });
        const logEntries = document.querySelectorAll('.shashn-log-entry');
        expect(logEntries.length).toBeGreaterThanOrEqual(2);
        expect(screen.getByText(/Shashn started/i)).toBeInTheDocument();
    });

    it('shows score line in game log', () => {
        renderBoard({
            phase: 'play',
            players: [
                makePlayer('me', 'Alice', [makeCard('7')]),
                makePlayer('peer-2', 'Bob', [makeCard('Q')]),
            ],
            log: ['Score: Alice 5 | Bob 3'],
        });
        expect(screen.getByText(/Score: Alice 5/)).toBeInTheDocument();
    });
});

describe('ShashnBoard render without crash — edge cases', () => {
    afterEach(() => { vi.clearAllMocks(); });

    it('renders with no log', () => {
        // log can be empty array — should not crash
        const { container } = renderBoard({
            phase: 'play',
            players: [
                makePlayer('me', 'Alice', [makeCard('7')]),
                makePlayer('peer-2', 'Bob', [makeCard('Q')]),
            ],
            log: [],
        });
        // No log section rendered
        expect(container.querySelector('.shashn-log')).toBeNull();
    });

    it('renders with undefined trumpSuit', () => {
        // Should not crash when trumpSuit is null
        renderBoard({ phase: 'deal', trumpSuit: null });
        expect(screen.getByText('Shashn')).toBeInTheDocument();
    });

    it('renders with no cards in hand (empty array)', () => {
        renderBoard({
            phase: 'play',
            players: [
                makePlayer('me', 'Alice', []),
                makePlayer('peer-2', 'Bob', [makeCard('Q')]),
            ],
        });
        expect(screen.getByText('No cards in hand')).toBeInTheDocument();
    });
});

/* ── ShashnStateSummary tests ─────────────────────────────── */

function renderSummary(gameOverrides = {}, props = {}) {
    const defaults = {
        game: makeGame(gameOverrides),
        myId: 'me',
        onOpenBoard: vi.fn(),
    };
    return render(<ShashnStateSummary {...defaults} {...props} />);
}

describe('ShashnStateSummary', () => {
    afterEach(() => { vi.clearAllMocks(); });

    it('renders null when game is null', () => {
        const { container } = render(<ShashnStateSummary game={null} myId="me" onOpenBoard={vi.fn()} />);
        expect(container.innerHTML).toBe('');
    });

    it('shows "Waiting for players..." in deal phase with no players', () => {
        renderSummary({ phase: 'deal', players: [makePlayer(null, null, []), makePlayer(null, null, [])] });
        expect(screen.getByText(/Waiting for players/i)).toBeInTheDocument();
    });

    it('shows "Waiting for opponent to join..." when one player has joined in deal phase', () => {
        renderSummary({
            phase: 'deal',
            players: [makePlayer('me', 'Alice', []), makePlayer(null, null, [])],
        });
        expect(screen.getByText(/Waiting for opponent to join/i)).toBeInTheDocument();
    });

    it('shows "Starting..." when both players are in deal phase', () => {
        renderSummary({
            phase: 'deal',
            players: [makePlayer('me', 'Alice', []), makePlayer('peer-2', 'Bob', [])],
        });
        expect(screen.getByText(/Starting/i)).toBeInTheDocument();
    });

    it('shows "Your turn!" when it is my turn in play phase', () => {
        renderSummary({
            phase: 'play',
            currentPlayer: 0,
            players: [makePlayer('me', 'Alice', [makeCard('7')]), makePlayer('peer-2', 'Bob', [makeCard('Q')])],
        });
        expect(screen.getByText(/Your turn/i)).toBeInTheDocument();
    });

    it('shows opponent waiting text when it is not my turn', () => {
        renderSummary({
            phase: 'play',
            currentPlayer: 1,
            players: [makePlayer('me', 'Alice', [makeCard('7')]), makePlayer('peer-2', 'Bob', [makeCard('Q')])],
        });
        expect(screen.getByText(/Waiting for Bob/i)).toBeInTheDocument();
    });

    it('shows "Trick complete" in trick_end phase', () => {
        renderSummary({
            phase: 'trick_end',
            currentPlayer: 0,
            players: [makePlayer('me', 'Alice', [makeCard('A')]), makePlayer('peer-2', 'Bob', [makeCard('Q')])],
            currentTrick: {
                cards: [{ player: 0, card: makeCard('A') }, { player: 1, card: makeCard('Q') }],
                leadSuit: 'Spades',
                winner: 0,
            },
        });
        expect(screen.getByText(/Trick complete/i)).toBeInTheDocument();
    });

    it('shows "Game over!" in game_end phase', () => {
        renderSummary({
            phase: 'game_end',
            winner: 'me',
            players: [makePlayer('me', 'Alice', []), makePlayer('peer-2', 'Bob', [])],
        });
        expect(screen.getByText(/Game over/i)).toBeInTheDocument();
    });

    it('shows opponent name and round info in play phase', () => {
        renderSummary({
            phase: 'play',
            round: 3,
            currentPlayer: 1,
            players: [makePlayer('me', 'Alice', [makeCard('7')]), makePlayer('peer-2', 'Bob', [makeCard('Q')])],
        });
        expect(screen.getByText(/vs Bob/i)).toBeInTheDocument();
        expect(screen.getByText(/Round 3/i)).toBeInTheDocument();
    });

    it('renders Open Board button that calls onOpenBoard', () => {
        const onOpenBoard = vi.fn();
        renderSummary({
            phase: 'play',
            currentPlayer: 0,
            players: [makePlayer('me', 'Alice', [makeCard('7')]), makePlayer('peer-2', 'Bob', [makeCard('Q')])],
        }, { onOpenBoard });
        const btn = screen.getByRole('button', { name: /Open Board/i });
        expect(btn).toBeInTheDocument();
        fireEvent.click(btn);
        expect(onOpenBoard).toHaveBeenCalledTimes(1);
    });

    it('does not show opponent name in deal phase', () => {
        renderSummary({
            phase: 'deal',
            players: [makePlayer('me', 'Alice', []), makePlayer('peer-2', 'Bob', [])],
        });
        // Should show Starting... but no "vs Bob" label
        expect(screen.getByText(/Starting/i)).toBeInTheDocument();
        expect(screen.queryByText(/vs Bob/i)).toBeNull();
    });
}); 
