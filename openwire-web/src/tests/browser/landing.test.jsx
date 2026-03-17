/**
 * landing.test.jsx
 *
 * Vitest + RTL tests for Landing component.
 * Covers: form submission (relay + CLI node), admin gate,
 * connection mode switching, input validation.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

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

/* ── Helpers ─────────────────────────────────────── */

function renderLanding(props = {}) {
    const defaults = { onJoin: vi.fn() };
    return render(<Landing {...defaults} {...props} />);
}

/* ── Tests ──────────────────────────────────────── */

describe('Landing', () => {
    beforeEach(() => vi.clearAllMocks());

    describe('rendering', () => {
        it('renders the OpenWire branding', () => {
            const { container } = renderLanding();
            expect(container.querySelector('.landing-logo')).toBeInTheDocument();
        });

        it('renders the name input field', () => {
            renderLanding();
            expect(screen.getByPlaceholderText(/nickname/i)).toBeInTheDocument();
        });

        it('renders the Connect button', () => {
            renderLanding();
            expect(screen.getByRole('button', { name: /Connect/ })).toBeInTheDocument();
        });

        it('renders connection mode radio buttons', () => {
            renderLanding();
            expect(screen.getByText('OpenWire Relay')).toBeInTheDocument();
            expect(screen.getByText('Local CLI Node')).toBeInTheDocument();
        });

        it('renders admin access link', () => {
            renderLanding();
            expect(screen.getByText(/Admin Access/)).toBeInTheDocument();
        });
    });

    describe('form submission — relay mode', () => {
        it('calls onJoin with sanitized nick and relay config', () => {
            const onJoin = vi.fn();
            renderLanding({ onJoin });
            const input = screen.getByPlaceholderText(/nickname/i);
            fireEvent.change(input, { target: { value: 'Alice' } });
            fireEvent.submit(screen.getByRole('button', { name: /Connect/ }).closest('form'));
            expect(onJoin).toHaveBeenCalledWith('Alice', false, { mode: 'relay' });
        });
    });

    describe('form submission — CLI node mode', () => {
        it('calls onJoin with CLI node config when cli-node selected', () => {
            const onJoin = vi.fn();
            renderLanding({ onJoin });

            // Enter name
            fireEvent.change(screen.getByPlaceholderText(/nickname/i), { target: { value: 'Bob' } });

            // Switch to CLI node mode
            const cliRadio = screen.getByText('Local CLI Node').closest('label').querySelector('input');
            fireEvent.click(cliRadio);

            // Should now show CLI URL input
            const urlInput = screen.getByPlaceholderText(/192\.168/);
            expect(urlInput).toBeInTheDocument();

            // Change the URL
            fireEvent.change(urlInput, { target: { value: 'ws://myhost:9999' } });

            // Submit
            fireEvent.submit(screen.getByRole('button', { name: /Connect/ }).closest('form'));
            expect(onJoin).toHaveBeenCalledWith('Bob', false, { mode: 'cli-node', cliUrl: 'ws://myhost:9999' });
        });

        it('does not show CLI URL input in relay mode', () => {
            renderLanding();
            expect(screen.queryByPlaceholderText(/192\.168/)).not.toBeInTheDocument();
        });
    });

    describe('connection mode switching', () => {
        it('switches to cli-node mode when radio clicked', () => {
            renderLanding();
            const cliRadio = screen.getByText('Local CLI Node').closest('label').querySelector('input');
            fireEvent.click(cliRadio);
            expect(screen.getByPlaceholderText(/192\.168/)).toBeInTheDocument();
        });

        it('switches back to relay mode', () => {
            renderLanding();
            // Switch to CLI
            const cliRadio = screen.getByText('Local CLI Node').closest('label').querySelector('input');
            fireEvent.click(cliRadio);
            expect(screen.getByPlaceholderText(/192\.168/)).toBeInTheDocument();

            // Switch back to relay
            const relayRadio = screen.getByText('OpenWire Relay').closest('label').querySelector('input');
            fireEvent.click(relayRadio);
            expect(screen.queryByPlaceholderText(/192\.168/)).not.toBeInTheDocument();
        });
    });

    describe('admin access', () => {
        it('shows AdminPasswordGate when admin button clicked', () => {
            renderLanding();
            fireEvent.click(screen.getByText(/Admin Access/));
            // AdminPasswordGate should appear (it has a password input)
            expect(screen.getByPlaceholderText(/password/i) || screen.getByText(/admin/i)).toBeTruthy();
        });
    });

    describe('name input', () => {
        it('updates input value on change', () => {
            renderLanding();
            const input = screen.getByPlaceholderText(/nickname/i);
            fireEvent.change(input, { target: { value: 'TestUser' } });
            expect(input.value).toBe('TestUser');
        });
    });
});
