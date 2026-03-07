import { useState } from 'react';
import { ROULETTE_RULES } from '../lib/roulette.js';
import { SLOTS_RULES } from '../lib/slots.js';

/* ── Rules for games that live entirely in their lib ────────── */

const BJ_RULES = {
    name: 'Blackjack',
    description: 'Get closer to 21 than the dealer without going over. Ace = 1 or 11. Face cards = 10.',
    bets: [
        { name: 'Bet', odds: '1:1', description: 'Win even money when your hand beats the dealer without busting.' },
        { name: 'Blackjack', odds: '3:2', description: 'Ace + any 10-value card on the first two cards pays 1.5× your bet.' },
        { name: 'Push (Tie)', odds: '0', description: 'Equal totals — your bet is returned, no gain or loss.' },
        { name: 'Bust', odds: '−1×', description: 'Going over 21 means an instant loss regardless of the dealer.' },
    ],
};

const AB_RULES = {
    name: 'Andar Bahar',
    description: 'A Joker card is drawn face-up. Bet on which side — Andar (inside/left) or Bahar (outside/right) — will receive a card matching the Joker\'s rank first.',
    bets: [
        { name: 'Andar', odds: '~1:1', description: 'Bet the matching card appears on the Andar (left) side.' },
        { name: 'Bahar', odds: '~1:1', description: 'Bet the matching card appears on the Bahar (right) side.' },
    ],
};

const GAME_RULES = {
    roulette:   ROULETTE_RULES,
    blackjack:  BJ_RULES,
    andarbahar: AB_RULES,
    slots:      SLOTS_RULES,
};

const GAME_ICONS = {
    roulette:   '🎰',
    blackjack:  '🃏',
    andarbahar: '🎴',
    slots:      '🎲',
};

/* ── Component ──────────────────────────────────────────────── */

/**
 * Dynamic "How to Play" panel.
 * Automatically loads the correct rules based on the activeGame prop.
 * The user can also browse other games via the tab bar.
 *
 * @param {{ activeGame?: string, onClose?: () => void }} props
 */
export default function HowToPlay({ activeGame, onClose }) {
    const initial = activeGame && GAME_RULES[activeGame] ? activeGame : 'roulette';
    const [selected, setSelected] = useState(initial);
    const rules = GAME_RULES[selected];

    return (
        <div className="game-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
            <div className="howtoplay-panel">

                {/* Header */}
                <div className="game-table-header">
                    <div className="game-table-title">
                        <span>📖</span>
                        <span>How to Play</span>
                    </div>
                    <button className="btn-icon-close" onClick={onClose}>✕</button>
                </div>

                {/* Game selector tabs */}
                <div className="howtoplay-tabs">
                    {Object.keys(GAME_RULES).map(type => (
                        <button
                            key={type}
                            className={`howtoplay-tab ${selected === type ? 'active' : ''}`}
                            onClick={() => setSelected(type)}
                        >
                            {GAME_ICONS[type]} {GAME_RULES[type].name}
                        </button>
                    ))}
                </div>

                {/* Rules body */}
                {rules && (
                    <div className="howtoplay-content">
                        <h2 className="howtoplay-title">
                            {GAME_ICONS[selected]} {rules.name}
                        </h2>
                        <p className="howtoplay-desc">{rules.description}</p>

                        <h3 className="howtoplay-section">Bets &amp; Payouts</h3>
                        <div className="howtoplay-bets">
                            {rules.bets.map((bet, i) => (
                                <div key={i} className="howtoplay-bet-row">
                                    <span className="howtoplay-bet-name">{bet.name}</span>
                                    <span className="howtoplay-bet-odds">{bet.odds}</span>
                                    <span className="howtoplay-bet-desc">{bet.description}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
