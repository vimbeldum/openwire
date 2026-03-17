/**
 * message-row.test.jsx
 *
 * Vitest + RTL tests for MessageRow chat component.
 * Covers: regular messages, GIFs, game invites, reactions, cosmetics, whispers.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import MessageRow from '../../components/chat/MessageRow.jsx';

/* ── Helpers ─────────────────────────────────────── */

const renderContent = (text) => text;

function makeMsg(overrides = {}) {
    return {
        id: 'msg-1',
        type: 'peer',
        sender: 'Bob',
        content: 'Hello world',
        time: '12:00',
        reactions: {},
        ...overrides,
    };
}

function renderRow(msgOverrides = {}, props = {}) {
    const defaults = {
        msg: makeMsg(msgOverrides),
        renderContent,
        onReact: vi.fn(),
        onJoinInvite: vi.fn(),
        onDismissInvite: vi.fn(),
        myCosmetics: null,
    };
    return render(<MessageRow {...defaults} {...props} />);
}

/* ── Tests ──────────────────────────────────────── */

describe('MessageRow', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

    describe('regular messages', () => {
        it('renders sender name', () => {
            renderRow({ sender: 'Alice' });
            expect(screen.getByText(/Alice/)).toBeInTheDocument();
        });

        it('renders message content', () => {
            renderRow({ content: 'Test message' });
            expect(screen.getByText(/Test message/)).toBeInTheDocument();
        });

        it('renders timestamp', () => {
            renderRow({ time: '14:30' });
            expect(screen.getByText('[14:30]')).toBeInTheDocument();
        });

        it('shows "You" for self messages', () => {
            renderRow({ type: 'self', sender: 'Me' });
            expect(screen.getByText(/You:/)).toBeInTheDocument();
        });

        it('renders whisper with whisper class', () => {
            const { container } = renderRow({ type: 'whisper' });
            expect(container.querySelector('.whisper')).toBeInTheDocument();
        });
    });

    describe('GIF messages', () => {
        it('renders GIF image when msg.gif is set', () => {
            renderRow({ gif: 'https://example.com/cat.gif', content: '' });
            const img = screen.getByAltText('GIF');
            expect(img).toBeInTheDocument();
            expect(img.src).toBe('https://example.com/cat.gif');
        });
    });

    describe('game invites', () => {
        it('renders active invite with Join button', () => {
            renderRow({
                type: 'game_invite',
                inviteUsed: false,
                sender: 'Alice',
                content: 'Join my Roulette table!',
                ts: Date.now(),
            });
            expect(screen.getByText('Join Table')).toBeInTheDocument();
        });

        it('clicking Join calls onJoinInvite', () => {
            const onJoinInvite = vi.fn();
            const msg = makeMsg({
                type: 'game_invite',
                inviteUsed: false,
                content: 'Join roulette!',
                ts: Date.now(),
            });
            render(
                <MessageRow msg={msg} renderContent={renderContent}
                    onReact={vi.fn()} onJoinInvite={onJoinInvite}
                    onDismissInvite={vi.fn()} myCosmetics={null} />
            );
            fireEvent.click(screen.getByText('Join Table'));
            expect(onJoinInvite).toHaveBeenCalledWith(msg);
        });

        it('clicking dismiss calls onDismissInvite', () => {
            const onDismissInvite = vi.fn();
            renderRow({
                type: 'game_invite',
                inviteUsed: false,
                content: 'Join!',
                ts: Date.now(),
            }, { onDismissInvite });
            fireEvent.click(screen.getByText('✕'));
            expect(onDismissInvite).toHaveBeenCalledWith('msg-1');
        });

        it('shows expired text when invite has expired', () => {
            renderRow({
                type: 'game_invite',
                inviteUsed: false,
                content: 'Join!',
                ts: Date.now() - 120000, // 2 min ago, past 60s expiry
            });
            expect(screen.getByText(/expired/)).toBeInTheDocument();
        });

        it('shows joined text when invite is used', () => {
            renderRow({
                type: 'game_invite',
                inviteUsed: true,
                content: 'Join roulette!',
            });
            expect(screen.getByText(/joined/)).toBeInTheDocument();
        });
    });

    describe('reactions', () => {
        it('renders reaction badges when reactions exist', () => {
            const { container } = renderRow({
                reactions: { '🔥': ['peer-1', 'peer-2'], '👏': ['peer-3'] },
            });
            const badges = container.querySelectorAll('.reaction-badge');
            expect(badges).toHaveLength(2);
        });

        it('clicking a reaction badge calls onReact', () => {
            const onReact = vi.fn();
            const { container } = renderRow({
                reactions: { '🔥': ['peer-1'] },
            }, { onReact });
            fireEvent.click(container.querySelector('.reaction-badge'));
            expect(onReact).toHaveBeenCalledWith('msg-1', '🔥');
        });

        it('shows reaction bar with emoji buttons for peer messages', () => {
            const { container } = renderRow({ type: 'peer' });
            const reactBtns = container.querySelectorAll('.react-btn');
            expect(reactBtns.length).toBeGreaterThan(0);
        });

        it('clicking react button calls onReact', () => {
            const onReact = vi.fn();
            const { container } = renderRow({ type: 'peer' }, { onReact });
            const reactBtns = container.querySelectorAll('.react-btn');
            fireEvent.click(reactBtns[0]);
            expect(onReact).toHaveBeenCalled();
        });

        it('shows reaction bar for self messages', () => {
            const { container } = renderRow({ type: 'self' });
            expect(container.querySelectorAll('.react-btn').length).toBeGreaterThan(0);
        });
    });

    describe('cosmetics', () => {
        it('applies bubble style class from myCosmetics for self messages', () => {
            const { container } = renderRow(
                { type: 'self', content: 'styled msg' },
                { myCosmetics: { bubbleStyle: 'neon-glow', nameColor: 'gold-name', chatFlair: 'sparkle' } }
            );
            const content = container.querySelector('.msg-content');
            expect(content.className).toContain('neon-glow');
            expect(content.className).toContain('sparkle');
        });

        it('applies name color class from myCosmetics for self messages', () => {
            const { container } = renderRow(
                { type: 'self', content: 'hi' },
                { myCosmetics: { nameColor: 'gold-name' } }
            );
            const sender = container.querySelector('.msg-sender');
            expect(sender.className).toContain('gold-name');
        });

        it('applies peer cosmetics from msg.peerCosmetics', () => {
            const { container } = renderRow({
                type: 'peer',
                content: 'peer msg',
                peerCosmetics: { bubbleStyle: 'fire-bubble', nameColor: 'red-name' },
            });
            const content = container.querySelector('.msg-content');
            expect(content.className).toContain('fire-bubble');
        });
    });
});
