/**
 * invite-expiry.test.jsx
 *
 * RTL tests for game invite expiry in MessageRow component.
 * Verifies "Join Table" button, "(expired)" label, "(joined)" label,
 * and absence of action buttons on expired invites.
 */

import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import MessageRow from '../../components/chat/MessageRow.jsx';

/* ── Helpers ───────────────────────────────────────────────────── */

const NOW = 1_700_000_000_000;

function makeInviteMsg(overrides = {}) {
    return {
        id: 'invite-1',
        type: 'game_invite',
        sender: 'Alice',
        content: 'Join my Blackjack table!',
        ts: NOW,
        inviteUsed: false,
        ...overrides,
    };
}

function renderRow(msgOverrides = {}, props = {}) {
    const defaults = {
        msg: makeInviteMsg(msgOverrides),
        renderContent: (c) => c,
        onReact: vi.fn(),
        onJoinInvite: vi.fn(),
        onDismissInvite: vi.fn(),
        myCosmetics: null,
    };
    return render(<MessageRow {...defaults} {...props} />);
}

/* ── Tests ─────────────────────────────────────────────────────── */

describe('MessageRow — game invite expiry', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders "Join Table" button when invite is not expired', () => {
        // ts = NOW, current time = NOW -> not expired (0s elapsed < 60s)
        renderRow({ ts: NOW });

        expect(screen.getByText('Join Table')).toBeInTheDocument();
    });

    it('renders "(expired)" after 60s', () => {
        renderRow({ ts: NOW });

        // Advance time by 61 seconds (past the 60s expiry)
        act(() => {
            vi.advanceTimersByTime(61_000);
        });

        expect(screen.getByText(/\(expired\)/)).toBeInTheDocument();
        expect(screen.queryByText('Join Table')).not.toBeInTheDocument();
    });

    it('renders "(joined)" when inviteUsed is true', () => {
        renderRow({ inviteUsed: true });

        expect(screen.getByText(/\(joined\)/)).toBeInTheDocument();
        expect(screen.queryByText('Join Table')).not.toBeInTheDocument();
    });

    it('expired invite has no action buttons', () => {
        renderRow({ ts: NOW });

        act(() => {
            vi.advanceTimersByTime(61_000);
        });

        // No Join Table button
        expect(screen.queryByText('Join Table')).not.toBeInTheDocument();
        // No dismiss button (the X)
        expect(screen.queryByText('\u2715')).not.toBeInTheDocument();
    });

    it('does not show expired before 60s', () => {
        renderRow({ ts: NOW });

        act(() => {
            vi.advanceTimersByTime(59_000);
        });

        expect(screen.queryByText(/\(expired\)/)).not.toBeInTheDocument();
        expect(screen.getByText('Join Table')).toBeInTheDocument();
    });

    it('shows sender name on invite', () => {
        renderRow({ sender: 'Bob' });
        expect(screen.getByText('Bob')).toBeInTheDocument();
    });

    it('shows content text on invite', () => {
        renderRow({ content: 'Come play roulette!' });
        expect(screen.getByText('Come play roulette!')).toBeInTheDocument();
    });
});
