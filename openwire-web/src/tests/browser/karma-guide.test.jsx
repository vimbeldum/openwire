/**
 * karma-guide.test.jsx
 *
 * Vitest + RTL tests for KarmaGuide component.
 * Covers: render, tier display, earn events, lose events,
 *         anti-gaming rules, current-tier highlight, onClose.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import KarmaGuide from '../../components/KarmaGuide.jsx';

function renderGuide(props = {}) {
    const defaults = {
        currentKarma: 0,
        currentTier: 'newcomer',
        onClose: vi.fn(),
    };
    return render(<KarmaGuide {...defaults} {...props} />);
}

describe('KarmaGuide', () => {
    describe('structure', () => {
        it('renders the heading', () => {
            renderGuide();
            expect(screen.getByText(/Karma Guide/i)).toBeInTheDocument();
        });

        it('close button calls onClose', () => {
            const onClose = vi.fn();
            renderGuide({ onClose });
            fireEvent.click(screen.getByRole('button', { name: '✕' }));
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('displays the current karma value', () => {
            renderGuide({ currentKarma: 342 });
            expect(screen.getByText('342')).toBeInTheDocument();
        });

        it('shows "Your Karma" label', () => {
            renderGuide();
            expect(screen.getByText(/Your Karma/i)).toBeInTheDocument();
        });
    });

    describe('tier table', () => {
        it('shows all 5 tier names', () => {
            renderGuide();
            ['newcomer', 'regular', 'trusted', 'legend', 'mythic'].forEach(name => {
                expect(screen.getAllByText(new RegExp(name, 'i')).length).toBeGreaterThan(0);
            });
        });

        it('marks the current tier with "YOU"', () => {
            renderGuide({ currentKarma: 150, currentTier: 'regular' });
            expect(screen.getByText('YOU')).toBeInTheDocument();
        });

        it('shows karma range for regular tier', () => {
            renderGuide();
            expect(screen.getByText(/50 – 199 karma/i)).toBeInTheDocument();
        });

        it('shows "1000+" for mythic tier', () => {
            renderGuide();
            expect(screen.getByText(/1000\+ karma/i)).toBeInTheDocument();
        });
    });

    describe('earn karma section', () => {
        it('shows "How to Earn Karma" heading', () => {
            renderGuide();
            expect(screen.getByText(/How to Earn Karma/i)).toBeInTheDocument();
        });

        it('lists tip received event', () => {
            renderGuide();
            expect(screen.getByText(/Receive a tip/i)).toBeInTheDocument();
        });

        it('lists game win event', () => {
            renderGuide();
            expect(screen.getByText(/Win a game/i)).toBeInTheDocument();
        });

        it('lists reaction received event', () => {
            renderGuide();
            expect(screen.getByText(/Get a reaction/i)).toBeInTheDocument();
        });

        it('lists dead drop upvoted event', () => {
            renderGuide();
            expect(screen.getByText(/Dead Drop upvoted/i)).toBeInTheDocument();
        });

        it('lists bounty won event', () => {
            renderGuide();
            expect(screen.getByText(/Win a bounty/i)).toBeInTheDocument();
        });

        it('lists daily streak event', () => {
            renderGuide();
            expect(screen.getByText(/7-day login streak/i)).toBeInTheDocument();
        });
    });

    describe('lose karma section', () => {
        it('shows "How to Lose Karma" heading', () => {
            renderGuide();
            expect(screen.getByText(/How to Lose Karma/i)).toBeInTheDocument();
        });

        it('lists getting kicked', () => {
            renderGuide();
            expect(screen.getByText(/Getting kicked/i)).toBeInTheDocument();
        });

        it('lists getting banned', () => {
            renderGuide();
            expect(screen.getByText(/Getting banned/i)).toBeInTheDocument();
        });

        it('lists idle decay', () => {
            renderGuide();
            expect(screen.getByText(/Idle decay/i)).toBeInTheDocument();
        });
    });

    describe('anti-gaming rules', () => {
        it('shows "Anti-Gaming Rules" heading', () => {
            renderGuide();
            expect(screen.getByText(/Anti-Gaming Rules/i)).toBeInTheDocument();
        });

        it('mentions self-tipping rule', () => {
            renderGuide();
            expect(screen.getByText(/No self-tipping/i)).toBeInTheDocument();
        });

        it('mentions tip-cycling rule', () => {
            renderGuide();
            expect(screen.getByText(/Tip-cycling blocked/i)).toBeInTheDocument();
        });

        it('mentions game win cooldown', () => {
            renderGuide();
            expect(screen.getByText(/Game win cooldown/i)).toBeInTheDocument();
        });
    });

    describe('footer', () => {
        it('mentions karma never drops below 0', () => {
            renderGuide();
            expect(screen.getByText(/never drops below 0/i)).toBeInTheDocument();
        });

        it('mentions Dead Drops karma gate (50+)', () => {
            renderGuide();
            expect(screen.getByText(/50\+/i)).toBeInTheDocument();
        });

        it('mentions Bounty creation karma gate (200+)', () => {
            renderGuide();
            expect(screen.getByText(/200\+/i)).toBeInTheDocument();
        });
    });
});
