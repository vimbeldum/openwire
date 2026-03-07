/* ═══════════════════════════════════════════════════════════
   OpenWire — Presentation Domain: Post-Session Summary
   Shown after every game round ends.
   • Financial games → detailed payout breakdown
   • Non-financial games (TTT) → simple game-over card
   Fits strictly within 100dvh × 100vw — no external scroll.
   ═══════════════════════════════════════════════════════════ */

const GAME_ICONS = {
    roulette: '🎰',
    blackjack: '♠',
    andarbahar: '🃏',
    tictactoe: '✕',
};

const GAME_LABELS = {
    roulette: 'Roulette',
    blackjack: 'Blackjack',
    andarbahar: 'Andar Bahar',
    tictactoe: 'Tic-Tac-Toe',
};

const OUTCOME_ICONS = { win: '✅', loss: '❌', push: '↩', blackjack: '🃏', draw: '🤝' };

/* ── Tic-Tac-Toe (Non-Financial) Summary ─────────────────── */
function NonFinancialSummary({ event, myId, onClose }) {
    const myStat = event.playerStats?.find(p => p.peer_id === myId);
    const outcome = myStat?.outcome;
    return (
        <div className="pss-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="pss-panel pss-panel-sm">
                <div className="pss-header">
                    <span className="pss-game-badge">
                        {GAME_ICONS.tictactoe} {GAME_LABELS.tictactoe}
                    </span>
                    <button className="btn-icon-close" onClick={onClose}>✕</button>
                </div>

                <div className="pss-result-label">{event.resultLabel}</div>

                {outcome && (
                    <div className={`pss-outcome-banner ${outcome}`}>
                        {outcome === 'win' ? '🏆 You Win!' : outcome === 'draw' ? '🤝 Draw' : '❌ You Lose'}
                    </div>
                )}

                <button className="pss-cta" onClick={onClose}>Continue</button>
            </div>
        </div>
    );
}

/* ── Financial Game Summary ──────────────────────────────── */
function FinancialSummary({ event, myId, onClose }) {
    const myTotal = event.totals?.[myId] ?? 0;
    const myBreakdown = (event.breakdown || []).filter(b => b.peer_id === myId);
    const netClass = myTotal > 0 ? 'win' : myTotal < 0 ? 'loss' : 'push';
    const netLabel = myTotal > 0 ? `+${myTotal}` : `${myTotal}`;

    return (
        <div className="pss-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="pss-panel">
                <div className="pss-header">
                    <span className="pss-game-badge">
                        {GAME_ICONS[event.gameType]} {GAME_LABELS[event.gameType]}
                    </span>
                    <button className="btn-icon-close" onClick={onClose}>✕</button>
                </div>

                <div className="pss-result-label">{event.resultLabel}</div>

                <div className={`pss-net-total ${netClass}`}>
                    {netLabel} chips
                </div>

                {myBreakdown.length > 0 && (
                    <div className="pss-breakdown">
                        <div className="pss-breakdown-title">Your Bets</div>
                        <div className="pss-breakdown-list">
                            {myBreakdown.map((b, i) => (
                                <div key={i} className={`pss-row ${b.outcome}`}>
                                    <span className="pss-row-icon">{OUTCOME_ICONS[b.outcome] || '•'}</span>
                                    <span className="pss-row-label">{b.betLabel}</span>
                                    <span className="pss-row-wager">{b.wager}</span>
                                    <span className={`pss-row-net ${b.net >= 0 ? 'pos' : 'neg'}`}>
                                        {b.net >= 0 ? '+' : ''}{b.net}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {myBreakdown.length === 0 && (
                    <div className="pss-no-bets">You had no bets this round.</div>
                )}

                <button className="pss-cta" onClick={onClose}>Got it</button>
            </div>
        </div>
    );
}

/* ── Main Export ─────────────────────────────────────────── */
export default function PostSessionSummary({ event, myId, onClose }) {
    if (!event) return null;

    if (!event.financial) {
        return <NonFinancialSummary event={event} myId={myId} onClose={onClose} />;
    }

    return <FinancialSummary event={event} myId={myId} onClose={onClose} />;
}
