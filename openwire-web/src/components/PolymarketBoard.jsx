import { useState } from 'react';

/* ── Outcome Bar ───────────────────────────────── */
function OutcomeBar({ name, price, isLeading, isWinner, isResolved, dimmed }) {
    const width = Math.max(2, Math.min(100, price));
    const barClass = isResolved
        ? (isWinner ? 'pm-outcome-fill winner' : 'pm-outcome-fill dimmed')
        : (isLeading ? 'pm-outcome-fill leading' : 'pm-outcome-fill');

    return (
        <div className={`pm-outcome-bar ${dimmed ? 'dimmed' : ''}`}>
            <span className="pm-outcome-name">{name}</span>
            <div className="pm-outcome-track">
                <div className={barClass} style={{ width: `${width}%` }}>
                    <span className="pm-outcome-pct">{Math.round(price)}%</span>
                </div>
            </div>
            <span className="pm-outcome-price">{Math.round(price)}\u00A2</span>
        </div>
    );
}

/* ── Trade Panel ───────────────────────────────── */
function TradePanel({ outcomes, prices, balance, onAction }) {
    const [tab, setTab] = useState('buy');
    const [outcomeIdx, setOutcomeIdx] = useState(0);
    const [shares, setShares] = useState(10);

    const price = prices[outcomeIdx] || 50;
    const estCost = Math.round(shares * price / 100);
    const estRevenue = Math.round(shares * price / 100);
    const canAfford = tab === 'buy' ? estCost <= balance : true;

    const handleConfirm = () => {
        if (tab === 'buy' && !canAfford) return;
        onAction({ type: tab, outcomeIdx, shares });
    };

    const adjustShares = (delta) => {
        setShares(prev => Math.max(1, prev + delta));
    };

    const PRESETS = [1, 5, 10, 25];

    return (
        <div className="pm-trade-panel">
            <div className="pm-trade-tabs">
                <button
                    className={`pm-tab ${tab === 'buy' ? 'active buy' : ''}`}
                    onClick={() => setTab('buy')}
                >Buy</button>
                <button
                    className={`pm-tab ${tab === 'sell' ? 'active sell' : ''}`}
                    onClick={() => setTab('sell')}
                >Sell</button>
            </div>

            <div className="pm-trade-row">
                <label className="pm-trade-label">Outcome:</label>
                {outcomes.length <= 3 ? (
                    <div className="pm-outcome-btns">
                        {outcomes.map((o, i) => (
                            <button
                                key={i}
                                className={`pm-outcome-btn ${outcomeIdx === i ? 'active' : ''}`}
                                onClick={() => setOutcomeIdx(i)}
                            >{o}</button>
                        ))}
                    </div>
                ) : (
                    <select
                        className="pm-outcome-select"
                        value={outcomeIdx}
                        onChange={(e) => setOutcomeIdx(Number(e.target.value))}
                    >
                        {outcomes.map((o, i) => (
                            <option key={i} value={i}>{o} ({Math.round(prices[i])}\u00A2)</option>
                        ))}
                    </select>
                )}
            </div>

            <div className="pm-trade-row">
                <label className="pm-trade-label">Shares:</label>
                <div className="pm-share-input">
                    <button className="pm-adj-btn" onClick={() => adjustShares(-1)}>-</button>
                    <span className="pm-share-value">{shares}</span>
                    <button className="pm-adj-btn" onClick={() => adjustShares(1)}>+</button>
                </div>
                <div className="pm-presets">
                    {PRESETS.map(p => (
                        <button
                            key={p}
                            className={`pm-preset-btn ${shares === p ? 'active' : ''}`}
                            onClick={() => setShares(p)}
                        >{p}</button>
                    ))}
                </div>
            </div>

            <div className="pm-cost-estimate">
                {tab === 'buy'
                    ? <span>Est. Cost: <strong>{estCost.toLocaleString()}</strong> chips</span>
                    : <span>Est. Revenue: <strong>{estRevenue.toLocaleString()}</strong> chips</span>
                }
            </div>

            <button
                className={`pm-confirm-btn ${tab}`}
                onClick={handleConfirm}
                disabled={tab === 'buy' && !canAfford}
            >
                {tab === 'buy' && !canAfford
                    ? 'Insufficient Balance'
                    : `Confirm ${tab === 'buy' ? 'Buy' : 'Sell'}`
                }
            </button>
        </div>
    );
}

/* ── Position Display ──────────────────────────── */
function PositionDisplay({ outcomes, prices, position }) {
    if (!position || !position.shares) return null;
    const totalValue = position.shares.reduce((sum, s, i) => sum + Math.round(s * (prices[i] || 0) / 100), 0);
    const pnl = totalValue - (position.totalCost || 0);

    return (
        <div className="pm-position">
            <div className="pm-position-title">My Position</div>
            <div className="pm-position-row">
                {outcomes.map((o, i) => (
                    position.shares[i] > 0 && (
                        <span key={i} className="pm-pos-item">
                            {o}: <strong>{position.shares[i]}</strong> shares
                        </span>
                    )
                ))}
                {position.shares.every(s => s === 0) && (
                    <span className="pm-pos-item dim">No positions</span>
                )}
            </div>
            <div className="pm-position-summary">
                <span>Invested: {(position.totalCost || 0).toLocaleString()}</span>
                <span className={pnl >= 0 ? 'pm-pnl-pos' : 'pm-pnl-neg'}>
                    P&L: {pnl >= 0 ? '+' : ''}{pnl.toLocaleString()}
                </span>
            </div>
        </div>
    );
}

/* ── Trade Feed ────────────────────────────────── */
function TradeFeed({ trades, outcomes }) {
    if (!trades || trades.length === 0) return null;
    const recent = trades.slice(-5).reverse();

    return (
        <div className="pm-trade-feed">
            <div className="pm-feed-title">Recent Trades</div>
            {recent.map((t, i) => (
                <div key={i} className="pm-feed-item">
                    <span className="pm-feed-nick">{t.nick}</span>
                    {' '}{t.side === 'buy' ? 'bought' : 'sold'}{' '}
                    <strong>{t.shares}</strong>{' '}
                    {outcomes[t.outcomeIdx] || '?'}{' '}
                    @ {Math.round(t.price)}{'\u00A2'}
                </div>
            ))}
        </div>
    );
}

/* ── Market Controls (Host Only) ───────────────── */
function MarketControls({ phase, outcomes, onAction }) {
    const [winnerIdx, setWinnerIdx] = useState(0);
    const [confirmResolve, setConfirmResolve] = useState(false);

    if (phase === 'open') {
        return (
            <div className="pm-controls">
                <button className="pm-ctrl-btn lock" onClick={() => onAction({ type: 'lock' })}>
                    Lock Market
                </button>
            </div>
        );
    }

    if (phase === 'locked') {
        return (
            <div className="pm-controls">
                <div className="pm-resolve-row">
                    <select
                        className="pm-outcome-select"
                        value={winnerIdx}
                        onChange={(e) => { setWinnerIdx(Number(e.target.value)); setConfirmResolve(false); }}
                    >
                        {outcomes.map((o, i) => (
                            <option key={i} value={i}>{o}</option>
                        ))}
                    </select>
                    {!confirmResolve ? (
                        <button className="pm-ctrl-btn resolve" onClick={() => setConfirmResolve(true)}>
                            Resolve
                        </button>
                    ) : (
                        <button className="pm-ctrl-btn resolve confirm" onClick={() => {
                            onAction({ type: 'resolve', winnerIdx });
                            setConfirmResolve(false);
                        }}>
                            Confirm: {outcomes[winnerIdx]} wins?
                        </button>
                    )}
                </div>
            </div>
        );
    }

    if (phase === 'resolved') {
        return (
            <div className="pm-controls">
                <button className="pm-ctrl-btn new-market" onClick={() => onAction({ type: 'newMarket' })}>
                    New Market
                </button>
            </div>
        );
    }

    return null;
}

/* ── Create Market Form ────────────────────────── */
function CreateMarketForm({ onAction, balance }) {
    const [question, setQuestion] = useState('');
    const [outcomes, setOutcomes] = useState(['Yes', 'No']);
    const [seed, setSeed] = useState(1000);

    const canCreate = question.trim().length > 0 && outcomes.length >= 2 && outcomes.every(o => o.trim()) && seed > 0 && seed <= balance;

    const updateOutcome = (idx, val) => {
        setOutcomes(prev => prev.map((o, i) => i === idx ? val : o));
    };

    const addOutcome = () => {
        if (outcomes.length < 6) setOutcomes(prev => [...prev, '']);
    };

    const removeOutcome = (idx) => {
        if (outcomes.length > 2) setOutcomes(prev => prev.filter((_, i) => i !== idx));
    };

    const handleCreate = () => {
        if (!canCreate) return;
        onAction({ type: 'create', question: question.trim(), outcomes: outcomes.map(o => o.trim()), seed });
    };

    return (
        <div className="pm-create-form">
            <div className="pm-create-title">Create a New Market</div>

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
                        onChange={(e) => updateOutcome(i, e.target.value)}
                        maxLength={50}
                    />
                    {outcomes.length > 2 && (
                        <button className="pm-remove-btn" onClick={() => removeOutcome(i)}>x</button>
                    )}
                </div>
            ))}
            {outcomes.length < 6 && (
                <button className="pm-add-outcome-btn" onClick={addOutcome}>+ Add Outcome</button>
            )}

            <label className="pm-form-label">Seed Liquidity</label>
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

            <button
                className="pm-confirm-btn buy"
                onClick={handleCreate}
                disabled={!canCreate}
            >
                Create Market
            </button>
        </div>
    );
}

/* ── Resolved Banner ───────────────────────────── */
function ResolvedBanner({ outcomes, result, payouts, myId }) {
    const winnerName = outcomes[result] || '?';
    const myPayout = payouts?.[myId];

    return (
        <div className="pm-resolved-banner">
            <div className="pm-resolved-title">Market Resolved</div>
            <div className="pm-resolved-winner">{winnerName} wins</div>
            {myPayout !== undefined && (
                <div className={`pm-payout-chip ${myPayout >= 0 ? 'win' : 'lose'}`}>
                    {myPayout >= 0 ? `+${myPayout.toLocaleString()}` : myPayout.toLocaleString()} chips
                </div>
            )}
            {payouts && Object.keys(payouts).length > 0 && (
                <div className="pm-payouts-grid">
                    {Object.entries(payouts).map(([pid, net]) => (
                        <span key={pid} className={`pm-payout-chip ${net >= 0 ? 'win' : 'lose'}`}>
                            {pid.slice(0, 8)}: {net >= 0 ? '+' : ''}{net}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ── Main Board ────────────────────────────────── */
export default function PolymarketBoard({ game, myId, myNick, wallet, onAction, onClose, onHelp, isHost }) {
    if (!game) return null;

    const balance = wallet ? (wallet.baseBalance + wallet.adminBonus) : 0;
    const hasMarket = game.question && game.question.trim().length > 0;
    const outcomes = game.outcomes || [];
    const prices = game.prices || [];
    const positions = game.positions || {};
    const myPosition = positions[myId] || null;
    const trades = game.tradeHistory || [];
    const maxPrice = Math.max(...prices, 0);
    const isResolved = game.phase === 'resolved';

    return (
        <div className="game-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
            <div className="pm-table">
                {/* Header */}
                <div className="game-table-header">
                    <div className="game-table-title">
                        {'\uD83D\uDCCA'} <span>Predictions</span>
                        {isHost && <span className="host-crown" title="You are the host">{'\uD83D\uDC51'}</span>}
                    </div>
                    <div className="game-table-meta">
                        {wallet && <span className="chip-display">{'\uD83D\uDCB0'} {balance.toLocaleString()}</span>}
                        {game.volume > 0 && <span className="pm-volume">Vol: {game.volume.toLocaleString()}</span>}
                    </div>
                    {onHelp && <button className="btn-icon-help" onClick={onHelp} title="How to Play">?</button>}
                    <button className="btn-icon-close" onClick={onClose}>{'\u2715'}</button>
                </div>

                {/* No market — show create form (host) or waiting message */}
                {!hasMarket && isHost && (
                    <CreateMarketForm onAction={onAction} balance={balance} />
                )}
                {!hasMarket && !isHost && (
                    <div className="pm-waiting">Waiting for host to create a market...</div>
                )}

                {/* Market exists */}
                {hasMarket && (
                    <>
                        {/* Market Question */}
                        <div className="pm-market-question">{game.question}</div>

                        {/* Phase badge */}
                        <div className="pm-phase-row">
                            {game.phase === 'open' && <span className="pm-phase-badge open">OPEN</span>}
                            {game.phase === 'locked' && <span className="pm-phase-badge locked">LOCKED</span>}
                            {game.phase === 'resolved' && <span className="pm-phase-badge resolved">RESOLVED</span>}
                        </div>

                        {/* Resolved Banner */}
                        {isResolved && game.result !== null && game.result !== undefined && (
                            <ResolvedBanner
                                outcomes={outcomes}
                                result={game.result}
                                payouts={game.payouts}
                                myId={myId}
                            />
                        )}

                        {/* Outcome Bars */}
                        <div className="pm-outcomes">
                            {outcomes.map((o, i) => (
                                <OutcomeBar
                                    key={i}
                                    name={o}
                                    price={prices[i] || 0}
                                    isLeading={prices[i] === maxPrice}
                                    isWinner={isResolved && game.result === i}
                                    isResolved={isResolved}
                                    dimmed={isResolved && game.result !== i}
                                />
                            ))}
                        </div>

                        {/* Trade Panel — only when market is open */}
                        {game.phase === 'open' && (
                            <TradePanel
                                outcomes={outcomes}
                                prices={prices}
                                balance={balance}
                                onAction={onAction}
                            />
                        )}

                        {/* My Position */}
                        <PositionDisplay
                            outcomes={outcomes}
                            prices={prices}
                            position={myPosition}
                        />

                        {/* Recent Trades */}
                        <TradeFeed trades={trades} outcomes={outcomes} />

                        {/* Host Controls */}
                        {isHost && (
                            <MarketControls
                                phase={game.phase}
                                outcomes={outcomes}
                                onAction={onAction}
                            />
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
