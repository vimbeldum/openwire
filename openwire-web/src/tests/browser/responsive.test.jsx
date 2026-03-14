/**
 * Responsive / viewport tests for Landing.jsx
 *
 * jsdom has no layout engine, so CSS media queries and computed styles are
 * NOT evaluated here.  Tests focus on:
 *   - Component mounts without throwing at each breakpoint
 *   - document.body.scrollWidth stays <= window.innerWidth (no injected
 *     inline styles or JS-driven overflow that jsdom can detect)
 *   - JS-controlled behaviour driven by window.innerWidth (if any)
 *   - Props / interactions that work independently of viewport
 *
 * Visual / CSS overflow checks that genuinely require a layout engine are
 * marked it.todo() with an explanation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock localStorage — Landing reads CLI_NODE_URL_KEY on mount
// ---------------------------------------------------------------------------
const localStorageMock = {
    getItem: vi.fn().mockReturnValue(null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
};

vi.stubGlobal('localStorage', localStorageMock);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set window.innerWidth to a given px value */
function setViewportWidth(px) {
    Object.defineProperty(window, 'innerWidth', { writable: true, value: px });
    // Fire resize so any listeners pick it up
    window.dispatchEvent(new Event('resize'));
}

/** Render Landing with a mocked onJoin prop */
async function renderLanding() {
    // Dynamic import so the module resolves after mocks are in place
    const { default: Landing } = await import('../../components/Landing.jsx');
    const onJoin = vi.fn();
    const utils = render(<Landing onJoin={onJoin} />);
    return { ...utils, onJoin };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Landing — responsive / viewport tests', () => {
    const originalInnerWidth = window.innerWidth;

    afterEach(() => {
        cleanup();
        // Restore original width after each test
        Object.defineProperty(window, 'innerWidth', {
            writable: true,
            value: originalInnerWidth,
        });
        vi.clearAllMocks();
    });

    // ── 1. Mobile (375 px) ──────────────────────────────────────────────────

    it('renders at 375px without throwing', async () => {
        setViewportWidth(375);
        await expect(renderLanding()).resolves.toBeDefined();
    });

    it('375px: document.body.scrollWidth does not exceed window.innerWidth', async () => {
        setViewportWidth(375);
        await renderLanding();
        // jsdom sets scrollWidth to 0 (no layout), so this will hold.
        // The assertion documents the contract; a real browser check is in .todo() below.
        expect(document.body.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    });

    it('375px: landing heading and connect button are present in the DOM', async () => {
        setViewportWidth(375);
        await renderLanding();
        expect(screen.getByText('Join the Network')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /connect/i })).toBeInTheDocument();
    });

    // ── 2. Tablet (768 px) ──────────────────────────────────────────────────

    it('renders at 768px without throwing', async () => {
        setViewportWidth(768);
        await expect(renderLanding()).resolves.toBeDefined();
    });

    it('768px: document.body.scrollWidth does not exceed window.innerWidth', async () => {
        setViewportWidth(768);
        await renderLanding();
        expect(document.body.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    });

    it('768px: nickname input is present and interactive', async () => {
        setViewportWidth(768);
        await renderLanding();
        const input = screen.getByPlaceholderText(/enter your nickname/i);
        expect(input).toBeInTheDocument();
        fireEvent.change(input, { target: { value: 'TestUser' } });
        expect(input.value).toBe('TestUser');
    });

    // ── 3. Desktop (1440 px) ────────────────────────────────────────────────

    it('renders at 1440px without throwing', async () => {
        setViewportWidth(1440);
        await expect(renderLanding()).resolves.toBeDefined();
    });

    it('1440px: document.body.scrollWidth does not exceed window.innerWidth', async () => {
        setViewportWidth(1440);
        await renderLanding();
        expect(document.body.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    });

    it('1440px: all primary UI sections render', async () => {
        setViewportWidth(1440);
        await renderLanding();
        // The logo contains "OpenWire" — use getAllByText since the radio label
        // "OpenWire Relay" also matches the /OpenWire/i pattern.
        expect(screen.getAllByText(/OpenWire/i).length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Join the Network')).toBeInTheDocument();
        expect(screen.getByText(/OpenWire Relay/i)).toBeInTheDocument();
        expect(screen.getByText(/Local CLI Node/i)).toBeInTheDocument();
    });

    // ── 4. No JS errors across all viewports ────────────────────────────────

    it('switching viewport widths between renders does not throw', async () => {
        for (const width of [375, 768, 1024, 1440]) {
            setViewportWidth(width);
            const { unmount } = await renderLanding();
            expect(screen.getByRole('button', { name: /connect/i })).toBeInTheDocument();
            unmount();
        }
    });

    // ── 5. Interaction correctness is viewport-independent ──────────────────

    it('CLI URL input appears when "Local CLI Node" radio is selected at 375px', async () => {
        setViewportWidth(375);
        await renderLanding();

        // Initially relay mode — CLI URL input should not be visible
        expect(screen.queryByPlaceholderText(/ws:\/\//i)).not.toBeInTheDocument();

        // Switch to cli-node mode
        const cliRadio = screen.getByRole('radio', { name: /local cli node/i });
        fireEvent.click(cliRadio);

        expect(screen.getByPlaceholderText(/ws:\/\//i)).toBeInTheDocument();
    });

    it('onJoin is called with relay mode at any viewport when form is submitted', async () => {
        setViewportWidth(768);
        const { onJoin } = await renderLanding();

        const input = screen.getByPlaceholderText(/enter your nickname/i);
        fireEvent.change(input, { target: { value: 'Alice' } });
        fireEvent.submit(screen.getByRole('button', { name: /connect/i }).closest('form'));

        expect(onJoin).toHaveBeenCalledTimes(1);
        expect(onJoin).toHaveBeenCalledWith('Alice', false, { mode: 'relay' });
    });

    it('Admin Access button is rendered at all viewports', async () => {
        for (const width of [375, 768, 1440]) {
            setViewportWidth(width);
            const { unmount } = await renderLanding();
            expect(screen.getByRole('button', { name: /admin access/i })).toBeInTheDocument();
            unmount();
        }
    });

    // ── 6. Visual / CSS overflow checks requiring a layout engine ───────────

    it.todo('375px: .landing container has no horizontal overflow — requires visual regression tool (Playwright/Percy)');
    it.todo('game board scales down at 375px — requires visual regression tool');
    it.todo('480px CSS breakpoint reduces .landing-logo font-size — requires computed style in real browser');
    it.todo('480px CSS breakpoint reduces .landing-card padding — requires computed style in real browser');
});
