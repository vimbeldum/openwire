/**
 * landing.test.jsx
 *
 * Vitest + RTL tests for Landing component.
 * Covers: form submission (relay + CLI node), admin gate,
 * connection mode switching, input validation.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

/* ── Storage stubs ─────────────────────────────────── */
const _ls = new Map();
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage?.getItem) {
    vi.stubGlobal('localStorage', {
        getItem: (k) => _ls.get(k) ?? null,
        setItem: (k, v) => _ls.set(k, String(v)),
        removeItem: (k) => _ls.delete(k),
        clear: () => _ls.clear(),
    });
}

import Landing from '../../components/Landing.jsx';

function renderLanding(props = {}) {
    const defaults = { onJoin: vi.fn() };
    return render(<Landing {...defaults} {...props} />);
}

describe('Landing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        _ls.clear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('rendering', () => {
        it('renders the landing headline and shared copy', () => {
            renderLanding();
            expect(screen.getByRole('heading', { name: /join a room fast, keep the conversation primary/i })).toBeInTheDocument();
            expect(screen.getByText(/browser-first encrypted chat/i)).toBeInTheDocument();
        });

        it('renders the name input field', () => {
            renderLanding();
            expect(screen.getByLabelText('Nickname')).toBeInTheDocument();
            expect(screen.getByPlaceholderText(/nickname/i)).toBeInTheDocument();
        });

        it('renders the primary join action', () => {
            renderLanding();
            expect(screen.getByRole('button', { name: /join openwire/i })).toBeInTheDocument();
        });

        it('renders connection mode radio buttons with helper copy', () => {
            renderLanding();
            expect(screen.getByRole('radio', { name: /openwire relay/i })).toBeInTheDocument();
            expect(screen.getByRole('radio', { name: /local cli node/i })).toBeInTheDocument();
            expect(screen.getByText(/choose the relay for the default hosted path/i)).toBeInTheDocument();
        });

        it('renders admin access link', () => {
            renderLanding();
            expect(screen.getByRole('button', { name: /admin access/i })).toBeInTheDocument();
        });
    });

    describe('form submission — relay mode', () => {
        it('calls onJoin with sanitized nick and relay config', () => {
            const onJoin = vi.fn();
            renderLanding({ onJoin });
            fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: 'Alice' } });
            fireEvent.submit(screen.getByRole('button', { name: /join openwire/i }).closest('form'));
            expect(onJoin).toHaveBeenCalledWith('Alice', false, { mode: 'relay' });
        });

        it('falls back to Anonymous when nickname is blank', () => {
            const onJoin = vi.fn();
            renderLanding({ onJoin });
            fireEvent.submit(screen.getByRole('button', { name: /join openwire/i }).closest('form'));
            expect(onJoin).toHaveBeenCalledWith('Anonymous', false, { mode: 'relay' });
        });
    });

    describe('form submission — CLI node mode', () => {
        it('calls onJoin with CLI node config when cli-node selected', () => {
            const onJoin = vi.fn();
            renderLanding({ onJoin });

            fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: 'Bob' } });
            fireEvent.click(screen.getByRole('radio', { name: /local cli node/i }));

            const urlInput = screen.getByLabelText('Node WebSocket URL');
            expect(urlInput).toBeInTheDocument();

            fireEvent.change(urlInput, { target: { value: 'ws://myhost:9999' } });
            fireEvent.submit(screen.getByRole('button', { name: /join openwire/i }).closest('form'));

            expect(onJoin).toHaveBeenCalledWith('Bob', false, { mode: 'cli-node', cliUrl: 'ws://myhost:9999' });
        });

        it('does not show CLI URL input in relay mode', () => {
            renderLanding();
            expect(screen.queryByLabelText('Node WebSocket URL')).not.toBeInTheDocument();
        });

        it('falls back to the default cli url when the field is blank', () => {
            const onJoin = vi.fn();
            renderLanding({ onJoin });

            fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: 'Bob' } });
            fireEvent.click(screen.getByRole('radio', { name: /local cli node/i }));
            fireEvent.change(screen.getByLabelText('Node WebSocket URL'), { target: { value: '   ' } });
            fireEvent.submit(screen.getByRole('button', { name: /join openwire/i }).closest('form'));

            expect(onJoin).toHaveBeenCalledWith('Bob', false, { mode: 'cli-node', cliUrl: 'ws://localhost:18080' });
            expect(globalThis.localStorage.getItem('openwire_cli_node_url')).toBe('ws://localhost:18080');
        });

        it('hydrates the stored cli url when local storage already has one', () => {
            globalThis.localStorage.setItem('openwire_cli_node_url', 'ws://persisted:18080');
            renderLanding();

            fireEvent.click(screen.getByRole('radio', { name: /local cli node/i }));
            expect(screen.getByLabelText('Node WebSocket URL')).toHaveValue('ws://persisted:18080');
        });
    });

    describe('connection mode switching', () => {
        it('switches to cli-node mode when radio clicked', () => {
            renderLanding();
            fireEvent.click(screen.getByRole('radio', { name: /local cli node/i }));
            expect(screen.getByLabelText('Node WebSocket URL')).toBeInTheDocument();
            expect(screen.getByText('CLI node selected')).toBeInTheDocument();
        });

        it('switches back to relay mode', () => {
            renderLanding();
            fireEvent.click(screen.getByRole('radio', { name: /local cli node/i }));
            expect(screen.getByLabelText('Node WebSocket URL')).toBeInTheDocument();

            fireEvent.click(screen.getByRole('radio', { name: /openwire relay/i }));
            expect(screen.queryByLabelText('Node WebSocket URL')).not.toBeInTheDocument();
            expect(screen.getByText('Relay default')).toBeInTheDocument();
        });
    });

    describe('admin access', () => {
        it('shows AdminPasswordGate when admin button clicked', () => {
            renderLanding();
            fireEvent.click(screen.getByRole('button', { name: /admin access/i }));
            expect(screen.getByLabelText('Password')).toBeInTheDocument();
        });

        it('shows an inline error for an incorrect admin password', async () => {
            renderLanding();

            fireEvent.click(screen.getByRole('button', { name: /admin access/i }));
            fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-pass' } });
            fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

            expect(await screen.findByText('Incorrect password.')).toBeInTheDocument();
            expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
        });

        it('joins as Admin after a successful admin unlock when nickname is blank', async () => {
            renderLanding();
            fireEvent.click(screen.getByRole('button', { name: /admin access/i }));
            fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'openwire-admin' } });
            fireEvent.click(screen.getByRole('button', { name: /unlock/i }));
            expect(await screen.findByText(/join the network/i)).toBeInTheDocument();
        });
    });

    describe('name input', () => {
        it('updates input value on change', () => {
            renderLanding();
            const input = screen.getByLabelText('Nickname');
            fireEvent.change(input, { target: { value: 'TestUser' } });
            expect(input.value).toBe('TestUser');
        });
    });
});
