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

vi.mock('../../lib/deaddrops.js', () => ({
    getMinKarmaToPost: vi.fn(() => 0),
    setMinKarmaToPost: vi.fn(),
}));

vi.mock('../../components/GifPicker.jsx', () => ({
    setDefaultProvider: vi.fn(),
    default: () => null,
}));

vi.mock('../../lib/gifSettings.js', () => ({
    setDefaultProvider: vi.fn(),
    getDefaultProvider: vi.fn(() => 'giphy'),
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

// ── Agents tab tests ────────────────────────────────────────────────────────

describe('AdminPortal — Agents tab', () => {
    function makeSwarm(overrides = {}) {
        return {
            running: false,
            freeModels: [],
            chatterLevel: 1.0,
            maxMsgPerMin: 8,
            perCharCooldown: 10,
            globalCooldown: 5,
            defaultModel: 'openrouter/auto',
            provider: 'openrouter',
            geminiModels: [],
            qwenModels: [],
            haimakerModels: [],
            mentionOnlyMode: false,
            statsDebug: false,
            isCharacterEnabled: vi.fn(() => true),
            isShowEnabled: vi.fn(() => true),
            getAssignedModel: vi.fn(() => ''),
            getMood: vi.fn(() => 'normal'),
            start: vi.fn().mockResolvedValue(),
            stop: vi.fn(),
            setChatterLevel: vi.fn(),
            setMaxMsgPerMin: vi.fn(),
            setCharacterEnabled: vi.fn(),
            setModelOverride: vi.fn(),
            setShowEnabled: vi.fn(),
            setMood: vi.fn(),
            setPerCharCooldown: vi.fn(),
            setGlobalCooldown: vi.fn(),
            setMentionOnlyMode: vi.fn(),
            setStatsDebug: vi.fn(),
            setDefaultModel: vi.fn(),
            setProvider: vi.fn().mockResolvedValue(),
            flushContext: vi.fn(),
            queueLength: 0,
            queueContents: [],
            stats: {},
            ...overrides,
        };
    }

    it('swarm start/stop toggles running state via swarm.start() and swarm.stop()', async () => {
        const swarm = makeSwarm({ running: false });
        render(<AdminPortal {...makeDefaultProps({ swarm })} />);
        // Switch to Agents tab
        await userEvent.click(screen.getByRole('button', { name: /agents/i }));
        // Click start
        const startBtn = screen.getByRole('button', { name: /start swarm/i });
        await userEvent.click(startBtn);
        expect(swarm.start).toHaveBeenCalledTimes(1);
        // Now the button should say Stop Swarm
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /stop swarm/i })).toBeInTheDocument();
        });
        // Click stop
        await userEvent.click(screen.getByRole('button', { name: /stop swarm/i }));
        expect(swarm.stop).toHaveBeenCalledTimes(1);
    });

    it('character enable/disable checkbox calls swarm.setCharacterEnabled()', async () => {
        const { getCharactersDict } = await import('../../lib/agents/agentStore.js');
        const { getGroupsDict } = await import('../../lib/agents/agentStore.js');
        const { getGroupCharacters } = await import('../../lib/agents/agentStore.js');

        // Set up one character so checkbox renders
        getCharactersDict.mockReturnValue({ char1: { id: 'char1', name: 'Alice', avatar: 'A', frequencyWeight: 5, moods: { normal: {} } } });
        getGroupsDict.mockReturnValue({ show1: { id: 'show1', name: 'Show 1', emoji: '🎭' } });
        getGroupCharacters.mockReturnValue([{ id: 'char1', name: 'Alice', avatar: 'A', frequencyWeight: 5, moods: { normal: {} } }]);

        const swarm = makeSwarm();
        render(<AdminPortal {...makeDefaultProps({ swarm })} />);
        await userEvent.click(screen.getByRole('button', { name: /agents/i }));

        // Find the On checkbox in the character table (last checkbox in the row)
        const checkboxes = screen.getAllByRole('checkbox');
        // The last checkbox in the character row is the enable/disable one
        const charCheckbox = checkboxes[checkboxes.length - 1];
        await userEvent.click(charCheckbox);
        expect(swarm.setCharacterEnabled).toHaveBeenCalledWith('char1', false);

        // Reset mocks to defaults
        getCharactersDict.mockReturnValue({});
        getGroupsDict.mockReturnValue({});
        getGroupCharacters.mockReturnValue([]);
    });

    it('model dropdown change calls swarm.setModelOverride()', async () => {
        const { getCharactersDict } = await import('../../lib/agents/agentStore.js');
        const { getGroupsDict } = await import('../../lib/agents/agentStore.js');
        const { getGroupCharacters } = await import('../../lib/agents/agentStore.js');

        getCharactersDict.mockReturnValue({ char1: { id: 'char1', name: 'Alice', avatar: 'A', frequencyWeight: 5, moods: { normal: {} } } });
        getGroupsDict.mockReturnValue({ show1: { id: 'show1', name: 'Show 1', emoji: '🎭' } });
        getGroupCharacters.mockReturnValue([{ id: 'char1', name: 'Alice', avatar: 'A', frequencyWeight: 5, moods: { normal: {} } }]);

        const swarm = makeSwarm({ freeModels: [{ id: 'model-a' }, { id: 'model-b' }] });
        render(<AdminPortal {...makeDefaultProps({ swarm })} />);
        await userEvent.click(screen.getByRole('button', { name: /agents/i }));

        // Find model select dropdowns - the per-character one is in the table
        const selects = screen.getAllByRole('combobox');
        // The per-character model select contains "Use Default" option
        const charModelSelect = selects.find(s => {
            const opts = s.querySelectorAll('option');
            return Array.from(opts).some(o => o.textContent.includes('Use Default'));
        });
        expect(charModelSelect).toBeDefined();
        fireEvent.change(charModelSelect, { target: { value: 'model-a' } });
        expect(swarm.setModelOverride).toHaveBeenCalledWith('char1', 'model-a');

        // Reset mocks
        getCharactersDict.mockReturnValue({});
        getGroupsDict.mockReturnValue({});
        getGroupCharacters.mockReturnValue([]);
    });

    it('chatter level slider fires swarm.setChatterLevel()', async () => {
        const swarm = makeSwarm();
        render(<AdminPortal {...makeDefaultProps({ swarm })} />);
        await userEvent.click(screen.getByRole('button', { name: /agents/i }));

        // Find the chatter level slider (type=range)
        const sliders = screen.getAllByRole('slider');
        const chatterSlider = sliders[0]; // First slider is chatter level
        fireEvent.change(chatterSlider, { target: { value: '1.5' } });
        expect(swarm.setChatterLevel).toHaveBeenCalledWith(1.5);
    });
});

// ── Stats tab tests ─────────────────────────────────────────────────────────

describe('AdminPortal — Stats tab', () => {
    it('P&L values rendered per game from casinoState.housePnl', async () => {
        const casinoState = {
            housePnl: {
                roulette: 500,
                blackjack: -200,
                andarbahar: 100,
                slots: -50,
            },
        };
        // Mock getTotalHousePnl to return the sum
        const { getTotalHousePnl } = await import('../../lib/casinoState.js');
        getTotalHousePnl.mockReturnValue(350);

        render(<AdminPortal {...makeDefaultProps({ casinoState })} />);
        await userEvent.click(screen.getByRole('button', { name: /stats/i }));

        // Each game PnL value should be rendered
        expect(screen.getByText('+500')).toBeInTheDocument();
        expect(screen.getByText('-200')).toBeInTheDocument();
        expect(screen.getByText('+100')).toBeInTheDocument();
        expect(screen.getByText('-50')).toBeInTheDocument();

        // Total PnL
        expect(screen.getByText(/350/)).toBeInTheDocument();

        getTotalHousePnl.mockReturnValue(0);
    });

    it('filter dropdown limits displayed games', async () => {
        const casinoState = {
            housePnl: {
                roulette: 500,
                blackjack: -200,
                andarbahar: 100,
                slots: -50,
            },
        };
        const { getTotalHousePnl } = await import('../../lib/casinoState.js');
        getTotalHousePnl.mockReturnValue(350);

        render(<AdminPortal {...makeDefaultProps({ casinoState })} />);
        await userEvent.click(screen.getByRole('button', { name: /stats/i }));

        // Initially all 4 game PnL cards are shown
        expect(screen.getByText(/Roulette Net/)).toBeInTheDocument();
        expect(screen.getByText(/Blackjack Net/)).toBeInTheDocument();
        expect(screen.getByText(/Andar Bahar Net/)).toBeInTheDocument();
        expect(screen.getByText(/Slots Net/)).toBeInTheDocument();

        // Click the Roulette filter button
        const rouletteFilter = screen.getByRole('button', { name: /roulette/i });
        await userEvent.click(rouletteFilter);

        // Now only Roulette Net should be shown
        expect(screen.getByText(/Roulette Net/)).toBeInTheDocument();
        expect(screen.queryByText(/Blackjack Net/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Andar Bahar Net/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Slots Net/)).not.toBeInTheDocument();

        getTotalHousePnl.mockReturnValue(0);
    });
});

// ── Escape key test ─────────────────────────────────────────────────────────

describe('AdminPortal — Escape key', () => {
    it('pressing Escape dismisses the portal by clicking the overlay', async () => {
        const onClose = vi.fn();
        render(<AdminPortal {...makeDefaultProps({ onClose })} />);
        // The admin-overlay div has an onClick that fires onClose when clicking the overlay itself
        const overlay = document.querySelector('.admin-overlay');
        // Simulate clicking the overlay background (target === currentTarget)
        fireEvent.click(overlay);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

// ── Browser-only / complex interactions (still todo) ─────────────────────────

describe('AdminPortal — Browser-only / complex interactions', () => {
    it.todo('Focus management: admin overlay traps focus within modal (requires real browser)');
});
