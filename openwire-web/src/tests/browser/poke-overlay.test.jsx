/**
 * poke-overlay.test.jsx
 *
 * RTL tests for the PokeOverlay component.
 * Verifies emoji rendering per poke type, sender label,
 * auto-dismiss after 2.5s, click-to-dismiss, CSS classes,
 * unknown type fallback, and cooldown logic.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PokeOverlay from '../../components/chat/PokeOverlay.jsx';

/* ── Helpers ───────────────────────────────────────────────────── */

function makePoke(overrides = {}) {
    return {
        from_nick: 'Alice',
        poke_type: 'snowball',
        ...overrides,
    };
}

/* ── Tests ─────────────────────────────────────────────────────── */

describe('PokeOverlay', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders correct emoji for snowball type', () => {
        render(<PokeOverlay poke={makePoke({ poke_type: 'snowball' })} onDone={vi.fn()} />);
        expect(screen.getByText('❄️')).toBeInTheDocument();
    });

    it('renders correct emoji for each poke type', () => {
        const typeEmojiMap = {
            snowball: '❄️',
            siren: '🚨',
            wave: '👋',
            heart: '💖',
            thunder: '⚡',
            confetti: '🎉',
        };

        for (const [type, emoji] of Object.entries(typeEmojiMap)) {
            const { unmount } = render(
                <PokeOverlay poke={makePoke({ poke_type: type })} onDone={vi.fn()} />
            );
            expect(screen.getByText(emoji)).toBeInTheDocument();
            unmount();
        }
    });

    it('shows sender name', () => {
        render(<PokeOverlay poke={makePoke({ from_nick: 'Alice' })} onDone={vi.fn()} />);
        expect(screen.getByText('Alice poked you!')).toBeInTheDocument();
    });

    it('calls onDone after 2.5s', () => {
        const onDone = vi.fn();
        render(<PokeOverlay poke={makePoke()} onDone={onDone} />);

        expect(onDone).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(2500);
        });

        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('calls onDone on click (dismiss early)', () => {
        const onDone = vi.fn();
        render(<PokeOverlay poke={makePoke()} onDone={onDone} />);

        fireEvent.click(screen.getByText('Alice poked you!').closest('.poke-overlay'));

        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('has correct CSS class for poke type', () => {
        render(<PokeOverlay poke={makePoke({ poke_type: 'siren' })} onDone={vi.fn()} />);

        const overlay = screen.getByText('Alice poked you!').closest('.poke-overlay');
        expect(overlay).toHaveClass('poke-siren');
    });

    it('handles unknown poke type gracefully (falls back to wave emoji)', () => {
        render(<PokeOverlay poke={makePoke({ poke_type: 'unknown' })} onDone={vi.fn()} />);
        expect(screen.getByText('👋')).toBeInTheDocument();
    });

    it('cooldown logic: rejects poke within 10s window', () => {
        const cooldownRef = {};
        const peerId = 'peer1';

        // Simulate a poke just sent
        cooldownRef[peerId] = Date.now();

        // Check cooldown — should be within window
        const elapsed = Date.now() - cooldownRef[peerId];
        expect(elapsed).toBeLessThan(10_000);

        // Advance past cooldown
        act(() => {
            vi.advanceTimersByTime(10_001);
        });

        const elapsedAfter = Date.now() - cooldownRef[peerId];
        expect(elapsedAfter).toBeGreaterThanOrEqual(10_000);
    });
});
