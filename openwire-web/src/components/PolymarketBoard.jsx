import { useState, memo } from 'react';
import '../styles/polymarket.css';

/* ── Outcome Card (Polymarket-style) ──────────── */
function OutcomeCard({ name, price, idx, isOpen, isWinner, isResolved, dimmed, myShares, onBuy, onSell }) {
    const pct = Math.round(price);
    const ringColor = isResolved
        ? (isWinner ? '#22c55e' : 'rgba(255,255,255,0.08)')
        : pct >= 60 ? '#22c55e' : pct >= 40 ? '#3b82f6' : '#ef4444';

    return (
        <div className={`pm-outcome-card ${isWinner ? 'winner' : ''} ${dimmed ? 'dimmed' : ''}`}>
            <div className="pm-oc-top">
                <div className="pm-oc-ring" style={{ '--ring-color': ringColor, '--ring-pct': pct }}>
                    <span className="pm-oc-pct">{pct}<small>%</small></span>
                </div>
                <div className="pm-oc-info">
                    <div className="pm-oc-name">{name}</div>
                    <div className="pm-oc-price">{pct} chips per share</div>
                    {myShares > 0 && (
                        <div className="pm-oc-shares">{myShares} share{myShares !== 1 ? 's' : ''} held</div>
                    )}
                </div>
            </div>
            {isOpen && (
                <div className="pm-oc-actions">
                    <button className="pm-oc-buy" onClick={() => onBuy(idx)}>Buy</button>
                    {myShares > 0 && (
                        <button className="pm-oc-sell" onClick={() => onSell(idx)}>Sell</button>
                    )}
                </div>
            )}
            {isResolved && isWinner && (
                <div className="pm-oc-winner-tag">Winner</div>
            )}
        </div>
    );
}

/* ── Quick Trade Modal ────────────────────────── */
function QuickTrade({ outcome, price, balance, side, onConfirm, onClose }) {
    const [shares, setShares] = useState(10);
    const PRESETS = [1, 5, 10, 25, 50];
    const estCost = Math.round(shares * price / 100);
    const canAfford = side === 'buy' ? estCost <= balance : true;

    return (
        <div className="pm-quick-trade">
            <div className="pm-qt-header">
                <span className="pm-qt-side" data-side={side}>{side === 'buy' ? 'Buy' : 'Sell'}</span>
                <span className="pm-qt-outcome">{outcome}</span>
                <button className="pm-qt-close" onClick={onClose}>&times;</button>
            </div>
            <div className="pm-qt-presets">
                {PRESETS.map(p => (
                    <button
                        key={p}
                        className={`pm-qt-preset ${shares === p ? 'active' : ''}`}
                        onClick={() => setShares(p)}
                    >{p}</button>
                ))}
            </div>
            <div className="pm-qt-custom">
                <button className="pm-qt-adj" onClick={() => setShares(s => Math.max(1, s - 1))}>-</button>
                <span className="pm-qt-val">{shares}</span>
                <button className="pm-qt-adj" onClick={() => setShares(s => s + 1)}>+</button>
                <span className="pm-qt-label">shares</span>
            </div>
            <div className="pm-qt-est">
                {side === 'buy'
                    ? <>Est. cost: <strong>{estCost}</strong> chips</>
                    : <>Est. return: <strong>{estCost}</strong> chips</>
                }
            </div>
            <button
                className={`pm-qt-confirm ${side}`}
                onClick={() => { onConfirm(shares); onClose(); }}
                disabled={side === 'buy' && !canAfford}
            >
                {side === 'buy' && !canAfford ? 'Insufficient chips' : `Confirm ${side === 'buy' ? 'Buy' : 'Sell'}`}
            </button>
        </div>
    );
}

/* ── Position Summary ─────────────────────────── */
function PositionSummary({ outcomes, prices, position }) {
    if (!position || !position.shares || position.shares.every(s => s === 0)) return null;
    const totalValue = position.shares.reduce((sum, s, i) => sum + Math.round(s * (prices[i] || 0) / 100), 0);
    const pnl = totalValue - (position.totalCost || 0);

    return (
        <div className="pm-portfolio">
            <div className="pm-portfolio-header">
                <span className="pm-portfolio-title">Your Portfolio</span>
                <span className={`pm-portfolio-pnl ${pnl >= 0 ? 'pos' : 'neg'}`}>
                    {pnl >= 0 ? '+' : ''}{pnl} P&L
                </span>
            </div>
            <div className="pm-portfolio-items">
                {outcomes.map((o, i) => (
                    position.shares[i] > 0 && (
                        <div key={i} className="pm-portfolio-item">
                            <span className="pm-pi-name">{o}</span>
                            <span className="pm-pi-shares">{position.shares[i]} shares</span>
                            <span className="pm-pi-value">{Math.round(position.shares[i] * (prices[i] || 0) / 100)} chips</span>
                        </div>
                    )
                ))}
            </div>
            <div className="pm-portfolio-footer">
                Invested: {(position.totalCost || 0).toLocaleString()} chips
            </div>
        </div>
    );
}

/* ── Activity Feed ────────────────────────────── */
function ActivityFeed({ trades, outcomes }) {
    if (!trades || trades.length === 0) return null;
    const recent = trades.slice(-6).reverse();

    return (
        <div className="pm-activity">
            <div className="pm-activity-title">Activity</div>
            {recent.map((t, i) => (
                <div key={i} className="pm-activity-item">
                    <span className={`pm-act-badge ${t.action || (t.side === 'buy' ? 'buy' : 'sell')}`}>
                        {(t.action || t.side) === 'buy' ? 'B' : 'S'}
                    </span>
                    <span className="pm-act-text">
                        <strong>{t.nick}</strong> {(t.action || t.side) === 'buy' ? 'bought' : 'sold'} {t.shares} {outcomes[t.outcomeIdx] || '?'}
                    </span>
                    <span className="pm-act-cost">{t.cost || t.revenue || 0}</span>
                </div>
            ))}
        </div>
    );
}

/* ── Market Controls (Host Only) ───────────────── */
function MarketControls({ phase, outcomes, onAction }) {
    const [winnerIdx, setWinnerIdx] = useState(0);
    const [confirmResolve, setConfirmResolve] = useState(false);

    return (
        <div className="pm-controls">
            {phase === 'open' && (
                <button className="pm-ctrl-btn lock" onClick={() => onAction({ type: 'lock' })}>
                    Lock Market
                </button>
            )}
            {phase === 'locked' && (
                <div className="pm-resolve-row">
                    <select
                        className="pm-resolve-select"
                        value={winnerIdx}
                        onChange={(e) => { setWinnerIdx(Number(e.target.value)); setConfirmResolve(false); }}
                    >
                        {outcomes.map((o, i) => (
                            <option key={i} value={i}>{o}</option>
                        ))}
                    </select>
                    {!confirmResolve ? (
                        <button className="pm-ctrl-btn resolve" onClick={() => setConfirmResolve(true)}>Resolve</button>
                    ) : (
                        <button className="pm-ctrl-btn resolve confirm" onClick={() => {
                            onAction({ type: 'resolve', winnerIdx });
                            setConfirmResolve(false);
                        }}>
                            Confirm: {outcomes[winnerIdx]}?
                        </button>
                    )}
                </div>
            )}
            {phase === 'resolved' && (
                <button className="pm-ctrl-btn new-market" onClick={() => onAction({ type: 'newMarket' })}>
                    New Market
                </button>
            )}
        </div>
    );
}

/* ── Create Market Form ────────────────────────── */
function CreateMarketForm({ onAction, balance }) {
    const [question, setQuestion] = useState('');
    const [outcomes, setOutcomes] = useState(['Yes', 'No']);
    const [seed, setSeed] = useState(1000);
    const canCreate = question.trim().length > 0 && outcomes.length >= 2 && outcomes.every(o => o.trim()) && seed > 0 && seed <= balance;

    return (
        <div className="pm-create-form">
            <div className="pm-create-icon">?</div>
            <div className="pm-create-title">Create a Prediction Market</div>
            <div className="pm-create-subtitle">Ask a question, set outcomes, and let the crowd decide.</div>

            <label className="pm-form-label">Question</label>
            <input
                className="pm-form-input"
                type="text"
                placeholder="Will it rain tomorrow?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={200}
            />

            <label className="pm-form-label">Outcomes</label>
            {outcomes.map((o, i) => (
                <div key={i} className="pm-outcome-input-row">
                    <input
                        className="pm-form-input"
                        type="text"
                        placeholder={`Outcome ${i + 1}`}
                        value={o}
                        onChange={(e) => {
                            const next = [...outcomes];
                            next[i] = e.target.value;
                            setOutcomes(next);
                        }}
                        maxLength={50}
                    />
                    {outcomes.length > 2 && (
                        <button className="pm-remove-btn" onClick={() => setOutcomes(outcomes.filter((_, j) => j !== i))}>x</button>
                    )}
                </div>
            ))}
            {outcomes.length < 6 && (
                <button className="pm-add-outcome-btn" onClick={() => setOutcomes([...outcomes, ''])}>+ Add Outcome</button>
            )}

            <label className="pm-form-label">Liquidity Pool</label>
            <div className="pm-seed-row">
                <input
                    className="pm-form-input seed"
                    type="number"
                    min={100}
                    max={balance}
                    value={seed}
                    onChange={(e) => setSeed(Math.max(0, Number(e.target.value)))}
                />
                <span className="pm-seed-label">chips</span>
            </div>

            <button className="pm-create-btn" onClick={() => {
                if (!canCreate) return;
                onAction({ type: 'create', question: question.trim(), outcomes: outcomes.map(o => o.trim()), seed });
            }} disabled={!canCreate}>
                Create Market
            </button>
        </div>
    );
}

/* ── Resolved Banner ──────────────────────────── */
function ResolvedBanner({ outcomes, result, payouts, myId }) {
    const winnerName = outcomes[result] || '?';
    const myPayout = payouts?.[myId];

    return (
        <div className="pm-resolved-banner">
            <div className="pm-resolved-icon">&#10003;</div>
            <div className="pm-resolved-title">Market Resolved</div>
            <div className="pm-resolved-winner">{winnerName}</div>
            {myPayout !== undefined && (
                <div className={`pm-resolved-payout ${myPayout >= 0 ? 'win' : 'lose'}`}>
                    {myPayout >= 0 ? `+${myPayout.toLocaleString()}` : myPayout.toLocaleString()} chips
                </div>
            )}
        </div>
    );
}

/* ── Main Board ────────────────────────────────── */
export default memo(function PolymarketBoard({ game, myId, myNick, wallet, onAction, onClose, onHelp, isHost }) {
    const [tradeModal, setTradeModal] = useState(null); // { idx, side }

    if (!game) return null;

    const balance = wallet ? (wallet.baseBalance + wallet.adminBonus) : 0;
    const hasMarket = game.question && game.question.trim().length > 0;
    const outcomes = game.outcomes || [];
    const prices = game.prices || [];
    const positions = game.positions || {};
    const myPosition = positions[myId] || null;
    const trades = game.tradeHistory || [];
    const isResolved = game.phase === 'resolved';
    const isOpen = game.phase === 'open';

    const handleTrade = (shares) => {
        if (!tradeModal) return;
        onAction({ type: tradeModal.side, outcomeIdx: tradeModal.idx, shares });
    };

    return (
        <div className="game-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
            <div className="pm-table">
                {/* Header */}
                <div className="pm-header">
                    <div className="pm-header-left">
                        <span className="pm-logo">P</span>
                        <span className="pm-header-title">Predictions</span>
                        {isHost && <span className="pm-host-badge">Host</span>}
                    </div>
                    <div className="pm-header-right">
                        {wallet && <span className="pm-balance">{balance.toLocaleString()} chips</span>}
                        {onHelp && <button className="pm-help-btn" onClick={onHelp}>?</button>}
                        <button className="pm-close-btn" onClick={onClose}>&times;</button>
                    </div>
                </div>

                {/* Scrollable content area */}
                <div className="pm-content">
                    {/* No market */}
                    {!hasMarket && isHost && <CreateMarketForm onAction={onAction} balance={balance} />}
                    {!hasMarket && !isHost && (
                        <div className="pm-waiting">
                            <div className="pm-waiting-icon">...</div>
                            <div>Waiting for host to create a market</div>
                        </div>
                    )}

                    {/* Market exists */}
                    {hasMarket && (
                        <>
                            {/* Question + Meta */}
                            <div className="pm-market-header">
                                <div className="pm-market-question">{game.question}</div>
                                <div className="pm-market-meta">
                                    <span className={`pm-phase-badge ${game.phase}`}>{game.phase.toUpperCase()}</span>
                                    {game.volume > 0 && <span className="pm-volume">{game.volume.toLocaleString()} vol</span>}
                                </div>
                            </div>

                            {/* Resolved Banner */}
                            {isResolved && game.result !== null && game.result !== undefined && (
                                <ResolvedBanner outcomes={outcomes} result={game.result} payouts={game.payouts} myId={myId} />
                            )}

                            {/* Outcome Cards */}
                            <div className="pm-outcomes-grid">
                                {outcomes.map((o, i) => (
                                    <OutcomeCard
                                        key={i}
                                        name={o}
                                        price={prices[i] || 0}
                                        idx={i}
                                        isOpen={isOpen}
                                        isWinner={isResolved && game.result === i}
                                        isResolved={isResolved}
                                        dimmed={isResolved && game.result !== i}
                                        myShares={myPosition?.shares?.[i] || 0}
                                        onBuy={(idx) => setTradeModal({ idx, side: 'buy' })}
                                        onSell={(idx) => setTradeModal({ idx, side: 'sell' })}
                                    />
                                ))}
                            </div>

                            {/* Quick Trade Modal */}
                            {tradeModal && (
                                <QuickTrade
                                    outcome={outcomes[tradeModal.idx]}
                                    price={prices[tradeModal.idx] || 50}
                                    balance={balance}
                                    side={tradeModal.side}
                                    onConfirm={handleTrade}
                                    onClose={() => setTradeModal(null)}
                                />
                            )}

                            {/* Portfolio */}
                            <PositionSummary outcomes={outcomes} prices={prices} position={myPosition} />

                            {/* Activity Feed */}
                            <ActivityFeed trades={trades} outcomes={outcomes} />

                            {/* Host Controls */}
                            {isHost && <MarketControls phase={game.phase} outcomes={outcomes} onAction={onAction} />}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
});
