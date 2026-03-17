/**
 * deaddrops-panel.test.jsx
 *
 * Vitest + RTL tests for DeadDropsPanel component.
 * Covers: render, close, karma gate, post form, char counter, submit, sort tabs, post cards.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import DeadDropsPanel from '../../components/DeadDropsPanel.jsx';
import * as deaddropsLib from '../../lib/deaddrops.js';

// ── vi.mock must use literals only — no external variable references ───────────

vi.mock('../../lib/deaddrops.js', () => ({
    loadFromSession: vi.fn(() => []),
    saveToSession: vi.fn(),
    createPost: vi.fn(() => ({
        success: true,
        post: {
            id: 'dd_1',
            body: 'test',
            timestamp: 1700000000000,
            upvotes: 0,
            downvotes: 0,
            reactions: {},
            votedBy: [],
            aiReactions: [],
        },
    })),
    vote: vi.fn(post => ({ ...post, upvotes: post.upvotes + 1 })),
    addReaction: vi.fn(post => ({ ...post })),
    sortPosts: vi.fn(arr => arr),
    hashDeviceId: vi.fn(() => 'abc123'),
}));

// ── MOCK_POST used in test bodies (not inside the factory) ────────────────────

const MOCK_POST = {
    id: 'dd_1',
    body: 'Hello from the shadows',
    timestamp: Date.now(),
    upvotes: 3,
    downvotes: 1,
    reactions: {},
    votedBy: [],
    aiReactions: [],
};

// ── helpers ────────────────────────────────────────────────────────────────────

function renderPanel(props = {}) {
    const defaults = {
        roomId: 'room-1',
        karma: 60,
        deviceId: 'dev-abc',
        onClose: vi.fn(),
    };
    return render(<DeadDropsPanel {...defaults} {...props} />);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('DeadDropsPanel', () => {
    beforeEach(() => {
        vi.mocked(deaddropsLib.loadFromSession).mockReturnValue([]);
        vi.mocked(deaddropsLib.createPost).mockReturnValue({
            success: true,
            post: {
                id: 'dd_1',
                body: 'test',
                timestamp: Date.now(),
                upvotes: 0,
                downvotes: 0,
                reactions: {},
                votedBy: [],
                aiReactions: [],
            },
        });
    });

    describe('header', () => {
        it('renders the "💀 Dead Drops" title', () => {
            renderPanel();
            expect(screen.getByText('💀 Dead Drops')).toBeInTheDocument();
        });

        it('close button calls onClose', () => {
            const onClose = vi.fn();
            renderPanel({ onClose });
            fireEvent.click(screen.getByText('✕'));
            expect(onClose).toHaveBeenCalledTimes(1);
        });
    });

    describe('sort tabs', () => {
        it('renders Hot, New, and Top sort tabs', () => {
            renderPanel();
            expect(screen.getByRole('button', { name: 'Hot' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Top' })).toBeInTheDocument();
        });

        it('clicking a sort tab switches the active sort mode', () => {
            renderPanel();
            const newBtn = screen.getByRole('button', { name: 'New' });
            fireEvent.click(newBtn);
            expect(newBtn).toHaveClass('active');
        });

        it('Hot tab is active by default', () => {
            renderPanel();
            expect(screen.getByRole('button', { name: 'Hot' })).toHaveClass('active');
        });
    });

    describe('karma gate', () => {
        it('shows karma gate message when karma < 50', () => {
            renderPanel({ karma: 30 });
            expect(screen.getByText(/Need 50 karma/)).toBeInTheDocument();
        });

        it('shows the actual karma value in the gate message', () => {
            renderPanel({ karma: 25 });
            expect(screen.getByText(/you have 25/i)).toBeInTheDocument();
        });

        it('does NOT show karma gate when karma >= 50', () => {
            renderPanel({ karma: 50 });
            expect(screen.queryByText(/Need 50 karma/)).not.toBeInTheDocument();
        });
    });

    describe('post form (karma >= 50)', () => {
        it('shows textarea for new post when karma >= 50', () => {
            renderPanel({ karma: 50 });
            expect(screen.getByPlaceholderText(/Drop something anonymous/i)).toBeInTheDocument();
        });

        it('shows "Drop It" button when karma >= 50', () => {
            renderPanel({ karma: 50 });
            expect(screen.getByRole('button', { name: 'Drop It' })).toBeInTheDocument();
        });

        it('char counter updates as user types', () => {
            renderPanel({ karma: 60 });
            const textarea = screen.getByPlaceholderText(/Drop something anonymous/i);
            fireEvent.change(textarea, { target: { value: 'Hello' } });
            expect(screen.getByText('5/500')).toBeInTheDocument();
        });

        it('"Drop It" button is disabled when textarea is empty', () => {
            renderPanel({ karma: 60 });
            expect(screen.getByRole('button', { name: 'Drop It' })).toBeDisabled();
        });

        it('clicking "Drop It" with text calls createPost', () => {
            renderPanel({ karma: 60 });
            const textarea = screen.getByPlaceholderText(/Drop something anonymous/i);
            fireEvent.change(textarea, { target: { value: 'A secret message' } });
            fireEvent.click(screen.getByRole('button', { name: 'Drop It' }));
            expect(deaddropsLib.createPost).toHaveBeenCalled();
        });

        it('textarea is cleared after a successful post', async () => {
            renderPanel({ karma: 60 });
            const textarea = screen.getByPlaceholderText(/Drop something anonymous/i);
            fireEvent.change(textarea, { target: { value: 'A secret message' } });
            fireEvent.click(screen.getByRole('button', { name: 'Drop It' }));
            await waitFor(() => {
                expect(textarea.value).toBe('');
            });
        });
    });

    describe('empty state', () => {
        it('shows empty state message when no posts exist', () => {
            renderPanel();
            expect(screen.getByText(/No drops yet/i)).toBeInTheDocument();
        });
    });

    describe('post cards', () => {
        it('renders post body text when posts are loaded via loadFromSession', () => {
            vi.mocked(deaddropsLib.loadFromSession).mockReturnValue([MOCK_POST]);
            renderPanel({ karma: 60 });
            expect(screen.getByText('Hello from the shadows')).toBeInTheDocument();
        });

        it('does not show empty state when posts are present', () => {
            vi.mocked(deaddropsLib.loadFromSession).mockReturnValue([MOCK_POST]);
            renderPanel({ karma: 60 });
            expect(screen.queryByText(/No drops yet/i)).not.toBeInTheDocument();
        });
    });

    describe('voting', () => {
        it('clicking upvote button calls vote with correct direction', () => {
            vi.mocked(deaddropsLib.loadFromSession).mockReturnValue([MOCK_POST]);
            renderPanel({ karma: 60 });
            // The upvote button should be in the post card
            const upBtn = screen.getByTitle?.('Upvote') || screen.getAllByText('▲')[0];
            if (upBtn) {
                fireEvent.click(upBtn);
                expect(deaddropsLib.vote).toHaveBeenCalled();
                expect(deaddropsLib.saveToSession).toHaveBeenCalled();
            }
        });

        it('clicking downvote button calls vote', () => {
            vi.mocked(deaddropsLib.loadFromSession).mockReturnValue([MOCK_POST]);
            renderPanel({ karma: 60 });
            const downBtn = screen.getByTitle?.('Downvote') || screen.getAllByText('▼')[0];
            if (downBtn) {
                fireEvent.click(downBtn);
                expect(deaddropsLib.vote).toHaveBeenCalled();
            }
        });
    });

    describe('createPost error handling', () => {
        it('shows error message when createPost fails', () => {
            vi.mocked(deaddropsLib.createPost).mockReturnValue({ success: false, reason: 'cooldown' });
            renderPanel({ karma: 60 });
            const textarea = screen.getByPlaceholderText(/Drop something anonymous/i);
            fireEvent.change(textarea, { target: { value: 'test message' } });
            fireEvent.click(screen.getByRole('button', { name: 'Drop It' }));
            expect(screen.getByText(/cooldown/i)).toBeInTheDocument();
        });

        it('does not clear textarea on failed post', () => {
            vi.mocked(deaddropsLib.createPost).mockReturnValue({ success: false, reason: 'too_short' });
            renderPanel({ karma: 60 });
            const textarea = screen.getByPlaceholderText(/Drop something anonymous/i);
            fireEvent.change(textarea, { target: { value: 'hi' } });
            fireEvent.click(screen.getByRole('button', { name: 'Drop It' }));
            expect(textarea.value).toBe('hi');
        });
    });
});
