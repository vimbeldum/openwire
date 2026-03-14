/**
 * admin-portal.test.jsx
 *
 * Unit tests for AdminPortal (default export) and AdminPasswordGate (named export).
 *
 * AdminPortal has no isAdmin prop — it is always rendered when the parent decides
 * to show it (after password gate). So we test:
 *   1. AdminPasswordGate — password input, correct/wrong password, callbacks
 *   2. AdminPortal — players tab renders player rows, kick/ban/adjust handlers
 *   3. AdminPortal — empty players list shows fallback text
 *   4. AdminPortal — balance adjust modal flow
 *   5. AdminPortal — tab navigation
 *   6. AdminPortal — onClose fires when close button clicked
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminPortal, { AdminPasswordGate } from '../../components/AdminPortal';

// ── Mock all external modules that AdminPortal.jsx imports ──────────────────

vi.mock('../../styles/admin.css', () => ({}));

vi.mock('../../lib/casinoState.js', () => ({
    getTotalHousePnl: vi.fn(() => 0),
}));

vi.mock('../../lib/agents/agentStore.js', () => ({
    loadStore: vi.fn(() => ({
        characters: [],
        groups: [],
        modelFilters: { whitelist: [], blacklist: [] },
        guardrails: true,
    })),
    getCharactersDict: vi.fn(() => ({})),
    getGroupsDict: vi.fn(() => ({})),
    getGroupCharacters: vi.fn(() => []),
}));

vi.mock('../../lib/agents/openrouter.js', () => ({
    formatModelLabel: vi.fn((m) => m?.id || 'model'),
}));

vi.mock('../../lib/agents/gemini.js', () => ({
    formatGeminiLabel: vi.fn((m) => m?.id || 'model'),
}));

vi.mock('../../lib/agents/qwen.js', () => ({
    formatQwenLabel: vi.fn((m) => m?.id || 'model'),
}));

vi.mock('../../lib/agents/haimaker.js', () => ({
    formatHaimakerLabel: vi.fn((m) => m?.id || 'model'),
}));

// ── Minimal prop factories ──────────────────────────────────────────────────

function makeDefaultProps(overrides = {}) {
    return {
        peers: [],
        onKick: vi.fn(),
        onBanIp: vi.fn(),
        onUnbanIp: vi.fn(),
        onAdjustBalance: vi.fn(),
        activityLog: [],
        bannedIps: [],
        bankLedger: {},
        casinoState: null,
        swarm: null,
        swarmLogs: [],
        onProviderChange: vi.fn(),
        onClose: vi.fn(),
        ...overrides,
    };
}

function makePeer(overrides = {}) {
    return {
        peer_id: 'peer-abc',
        nick: 'TestPlayer',
        balance: 5000,
        ip: '1.2.3.4',
        ...overrides,
    };
}

// ── AdminPasswordGate tests ─────────────────────────────────────────────────

describe('AdminPasswordGate', () => {
    it('renders a password input and an Unlock button', () => {
        render(<AdminPasswordGate onSuccess={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.getByPlaceholderText('Admin password')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /unlock/i })).toBeInTheDocument();
    });

    it('calls onCancel when Cancel button is clicked', async () => {
        const onCancel = vi.fn();
        render(<AdminPasswordGate onSuccess={vi.fn()} onCancel={onCancel} />);
        await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('shows error message on wrong password', async () => {
        render(<AdminPasswordGate onSuccess={vi.fn()} onCancel={vi.fn()} />);
        await userEvent.type(screen.getByPlaceholderText('Admin password'), 'wrongpass');
        fireEvent.submit(screen.getByRole('button', { name: /unlock/i }).closest('form'));
        await waitFor(() => {
            expect(screen.getByText('Incorrect password.')).toBeInTheDocument();
        });
    });

    it('calls onSuccess when correct password is entered', async () => {
        const onSuccess = vi.fn();
        // VITE_ADMIN_PASSWORD is undefined in test env, so fallback is 'openwire-admin'
        render(<AdminPasswordGate onSuccess={onSuccess} onCancel={vi.fn()} />);
        await userEvent.type(screen.getByPlaceholderText('Admin password'), 'openwire-admin');
        fireEvent.submit(screen.getByRole('button', { name: /unlock/i }).closest('form'));
        await waitFor(() => {
            expect(onSuccess).toHaveBeenCalledTimes(1);
        });
    });

    it('clears error text when user starts typing again', async () => {
        render(<AdminPasswordGate onSuccess={vi.fn()} onCancel={vi.fn()} />);
        await userEvent.type(screen.getByPlaceholderText('Admin password'), 'bad');
        fireEvent.submit(screen.getByRole('button', { name: /unlock/i }).closest('form'));
        await waitFor(() => expect(screen.getByText('Incorrect password.')).toBeInTheDocument());

        await userEvent.type(screen.getByPlaceholderText('Admin password'), 'x');
        expect(screen.queryByText('Incorrect password.')).not.toBeInTheDocument();
    });
});

// ── AdminPortal rendering tests ─────────────────────────────────────────────

describe('AdminPortal — Players tab', () => {
    it('renders "No players online" when peers array is empty', () => {
        render(<AdminPortal {...makeDefaultProps()} />);
        expect(screen.getByText('No players online')).toBeInTheDocument();
    });

    it('renders player nick, balance, and IP for each peer', () => {
        const peer = makePeer();
        render(<AdminPortal {...makeDefaultProps({ peers: [peer] })} />);
        expect(screen.getByText('TestPlayer')).toBeInTheDocument();
        expect(screen.getByText(/5,000/)).toBeInTheDocument();
        expect(screen.getByText('1.2.3.4')).toBeInTheDocument();
    });

    it('calls onKick with the correct peer_id when Kick button is clicked', async () => {
        const onKick = vi.fn();
        const peer = makePeer({ peer_id: 'peer-xyz' });
        render(<AdminPortal {...makeDefaultProps({ peers: [peer], onKick })} />);
        await userEvent.click(screen.getByRole('button', { name: /kick/i }));
        expect(onKick).toHaveBeenCalledWith('peer-xyz');
    });

    it('calls onBanIp with the correct peer_id when IP Ban button is clicked and confirmed', async () => {
        const onBanIp = vi.fn();
        const peer = makePeer({ peer_id: 'peer-xyz' });
        // window.confirm must return true for the ban to proceed
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(<AdminPortal {...makeDefaultProps({ peers: [peer], onBanIp })} />);
        await userEvent.click(screen.getByRole('button', { name: /ip ban/i }));
        expect(onBanIp).toHaveBeenCalledWith('peer-xyz');
        vi.restoreAllMocks();
    });

    it('does NOT call onBanIp when IP Ban is clicked but confirm is cancelled', async () => {
        const onBanIp = vi.fn();
        const peer = makePeer();
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        render(<AdminPortal {...makeDefaultProps({ peers: [peer], onBanIp })} />);
        await userEvent.click(screen.getByRole('button', { name: /ip ban/i }));
        expect(onBanIp).not.toHaveBeenCalled();
        vi.restoreAllMocks();
    });
});

// ── AdminPortal — Balance adjust modal ─────────────────────────────────────

describe('AdminPortal — Balance adjust modal', () => {
    it('shows adjust modal when Adjust button is clicked', async () => {
        const peer = makePeer({ nick: 'Alice', balance: 1000 });
        render(<AdminPortal {...makeDefaultProps({ peers: [peer] })} />);
        await userEvent.click(screen.getByRole('button', { name: /adjust/i }));
        expect(screen.getByText(/Adjust — Alice/)).toBeInTheDocument();
    });

    it('calls onAdjustBalance with positive amount when Add is clicked', async () => {
        const onAdjustBalance = vi.fn();
        const peer = makePeer({ peer_id: 'p1', nick: 'Alice', balance: 500 });
        render(<AdminPortal {...makeDefaultProps({ peers: [peer], onAdjustBalance })} />);

        await userEvent.click(screen.getByRole('button', { name: /adjust/i }));
        // Default adjustAmount is 100 — click + Chips without changing value
        await userEvent.click(screen.getByRole('button', { name: /\+ Chips/i }));
        expect(onAdjustBalance).toHaveBeenCalledWith('p1', 'Alice', 100);
    });

    it('calls onAdjustBalance with negative amount when Deduct is clicked', async () => {
        const onAdjustBalance = vi.fn();
        const peer = makePeer({ peer_id: 'p1', nick: 'Alice', balance: 500 });
        render(<AdminPortal {...makeDefaultProps({ peers: [peer], onAdjustBalance })} />);

        await userEvent.click(screen.getByRole('button', { name: /adjust/i }));
        await userEvent.click(screen.getByRole('button', { name: /− Chips/i }));
        expect(onAdjustBalance).toHaveBeenCalledWith('p1', 'Alice', -100);
    });

    it('dismisses the modal when Cancel is clicked inside the adjust dialog', async () => {
        const peer = makePeer({ nick: 'Alice' });
        render(<AdminPortal {...makeDefaultProps({ peers: [peer] })} />);

        await userEvent.click(screen.getByRole('button', { name: /adjust/i }));
        expect(screen.getByText(/Adjust — Alice/)).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(screen.queryByText(/Adjust — Alice/)).not.toBeInTheDocument();
    });
});

// ── AdminPortal — Tab navigation ───────────────────────────────────────────

describe('AdminPortal — Tab navigation', () => {
    it('renders tab buttons for all expected tabs', () => {
        render(<AdminPortal {...makeDefaultProps()} />);
        for (const tab of ['Players', 'Ban List', 'Activity Log', 'Stats', 'Agents']) {
            expect(screen.getByRole('button', { name: new RegExp(tab, 'i') })).toBeInTheDocument();
        }
    });

    it('switches to Activity Log tab and shows empty state', async () => {
        render(<AdminPortal {...makeDefaultProps({ activityLog: [] })} />);
        await userEvent.click(screen.getByRole('button', { name: /activity log/i }));
        expect(screen.getByText('No activity yet.')).toBeInTheDocument();
    });

    it('renders activity log entries in reverse chronological order', async () => {
        const activityLog = [
            { time: '10:00', message: 'First event' },
            { time: '10:01', message: 'Second event' },
        ];
        render(<AdminPortal {...makeDefaultProps({ activityLog })} />);
        await userEvent.click(screen.getByRole('button', { name: /activity log/i }));
        // Rendered in reverse — Second event should appear before First event in DOM
        const messages = screen.getAllByText(/event/);
        expect(messages[0]).toHaveTextContent('Second event');
        expect(messages[1]).toHaveTextContent('First event');
    });

    it('switches to Ban List tab and shows empty state', async () => {
        render(<AdminPortal {...makeDefaultProps({ bannedIps: [] })} />);
        await userEvent.click(screen.getByRole('button', { name: /ban list/i }));
        expect(screen.getByText(/clean house/i)).toBeInTheDocument();
    });

    it('shows banned IP count in tab label when banned IPs exist', () => {
        render(<AdminPortal {...makeDefaultProps({ bannedIps: ['1.1.1.1', '2.2.2.2'] })} />);
        expect(screen.getByRole('button', { name: /ban list \(2\)/i })).toBeInTheDocument();
    });
});

// ── AdminPortal — Close button ──────────────────────────────────────────────

describe('AdminPortal — Close button', () => {
    it('calls onClose when the close (X) button is clicked', async () => {
        const onClose = vi.fn();
        render(<AdminPortal {...makeDefaultProps({ onClose })} />);
        await userEvent.click(screen.getByRole('button', { name: /✕/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

// ── Complex interaction stubs ───────────────────────────────────────────────

describe('AdminPortal — Browser-only / complex interactions', () => {
    it.todo('Agents tab: swarm start/stop toggles running state via swarm.start() and swarm.stop()');
    it.todo('Agents tab: character enable/disable checkbox calls swarm.setCharacterEnabled()');
    it.todo('Agents tab: model dropdown change calls swarm.setModelOverride()');
    it.todo('Agents tab: chatter level slider fires swarm.setChatterLevel()');
    it.todo('Stats tab: P&L values rendered per game from casinoState.housePnl');
    it.todo('Stats tab: filter dropdown limits displayed games');
    it.todo('Focus management: admin overlay traps focus within modal (requires real browser)');
    it.todo('Keyboard: pressing Escape dismisses the portal (requires real browser focus model)');
});
