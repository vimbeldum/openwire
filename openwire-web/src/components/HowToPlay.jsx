import { useState } from 'react';
import { ROULETTE_RULES } from '../lib/roulette.js';
import { BLACKJACK_RULES } from '../lib/blackjack.js';
import { ANDARBAHAR_RULES } from '../lib/andarbahar.js';
import { SLOTS_RULES } from '../lib/slots.js';
import { TICTACTOE_RULES } from '../lib/game.js';

/* ── Game Rules Registry (each entry sourced from its bounded context lib) */
const GAME_RULES = {
    roulette:   ROULETTE_RULES,
    blackjack:  BLACKJACK_RULES,
    andarbahar: ANDARBAHAR_RULES,
    slots:      SLOTS_RULES,
    tictactoe:  TICTACTOE_RULES,
};

const GAME_ICONS = {
    roulette:   '🎰',
    blackjack:  '🃏',
    andarbahar: '🎴',
    slots:      '🎲',
    tictactoe:  '✕○',
};

/* ── Shared Presentation Domain: Rules Overlay ──────────────
   Single reusable component for all game rules.
   - Viewport is locked (game-overlay has overflow:hidden)
   - Panel has overflow-y:auto for internal scroll only
   - Defaults to the calling game's rules, tabs let user browse all
   ─────────────────────────────────────────────────────────── */

/**
 * @param {{ activeGame?: string, onClose?: () => void }} props
 *   activeGame — one of 'roulette'|'blackjack'|'andarbahar'|'slots'|'tictactoe'
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

                {/* Rules body — overflows internally, never the viewport */}
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
