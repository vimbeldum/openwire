import { useEffect, useRef, useState, memo } from 'react';
import * as ab from '../lib/andarbahar';
import * as bj from '../lib/blackjack';

/* ── Card Component ─────────────────────────────── */
function Card({ card, index = 0, faceDown = false, small = false }) {
    if (!card || faceDown) {
        return (
            <div className={`card card-back ${small ? 'card-sm' : ''}`}>
                <div className="card-back-pattern" />
            </div>
        );
    }
    const { display, isRed } = bj.cardSymbol(card);
    const suitClass = isRed ? 'red' : 'black';
    return (
        <div
            className={`card ${suitClass} ${small ? 'card-sm' : ''} card-flip`}
            style={{ '--delay': `${Math.min(index, 8) * 0.05}s` }}
        >
            <div className="card-corner tl">
                <div className="card-rank">{display}</div>
                <div className="card-suit-sm">{card.suit}</div>
            </div>
            <div className="card-center-suit">{card.suit}</div>
            <div className="card-corner br">
                <div className="card-rank">{display}</div>
                <div className="card-suit-sm">{card.suit}</div>
            </div>
        </div>
    );
}

function TrumpCard({ card }) {
    if (!card) {
        return (
            <div className="ab-trump-slot">
                <div className="ab-trump-placeholder">?</div>
            </div>
        );
    }
    const { display, isRed } = bj.cardSymbol(card);
    return (
        <div className={`card ab-trump ${isRed ? 'red' : 'black'} card-flip`}>
            <div className="card-corner tl">
                <div className="card-rank">{display}</div>
                <div className="card-suit-sm">{card.suit}</div>
            </div>
            <div className="card-center-suit" style={{ fontSize: '3rem' }}>{card.suit}</div>
            <div className="card-corner br">
                <div className="card-rank">{display}</div>
                <div className="card-suit-sm">{card.suit}</div>
            </div>
        </div>
    );
}

/* ── Countdown Timer ────────────────────────────── */
function BettingCountdown({ bettingEndsAt }) {
    const [timeLeft, setTimeLeft] = useState('');
    const [pct, setPct] = useState(100);
    useEffect(() => {
        const update = () => {
            const ms = Math.max(0, bettingEndsAt - Date.now());
            const s = Math.ceil(ms / 1000);
            setTimeLeft(s > 0 ? `${s}s` : '0s');
            setPct(Math.max(0, Math.min(100, (ms / ab.BETTING_DURATION_MS) * 100)));
        };
        update();
        const t = setInterval(update, 250);
        return () => clearInterval(t);
    }, [bettingEndsAt]);

    return (
        <div className="ab-countdown">
            <div className="ab-countdown-label">Betting closes in <strong>{timeLeft}</strong></div>
            <div className="ab-countdown-bar">
                <div className="ab-countdown-fill" style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

/* ── History Strip ──────────────────────────────── */
function HistoryStrip({ history }) {
    const ref = useRef(null);
    useEffect(() => {
        if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth;
    }, [history?.length]);
    if (!history?.length) return null;
    return (
        <div className="game-history-strip" ref={ref}>
            {history.map((entry, i) => {
                // History entries can be strings ('andar'/'bahar') or card objects
                if (typeof entry === 'string') {
                    const label = entry === 'andar' ? 'A' : 'B';
                    const cls = entry === 'andar' ? 'blue' : 'orange';
                    return (
                        <span key={i} className={`history-pip ${cls}`}>
                            {label}
                        </span>
                    );
                }
                const isRed = entry.suit === '\u2665' || entry.suit === '\u2666';
                return (
                    <span key={i} className={`history-pip ${isRed ? 'red' : 'black'}`}>
                        {entry.value}{entry.suit}
                    </span>
                );
            })}
        </div>
    );
}

const BET_AMOUNTS = [10, 25, 50, 100, 250, 500];

/* ── Main Board ─────────────────────────────────── */
export default memo(function AndarBaharBoard({ game, myId, myNick, wallet, onAction, onClose, onHelp, isHost, onReady, onNewRound, readyCount, totalBettors, isReady }) {
    const [selectedAmount, setSelectedAmount] = useState(50);

    if (!game) return null;

    const balance = wallet ? (wallet.baseBalance + wallet.adminBonus) : 0;
    const bets = game.bets || [];
    const myBets = bets.filter(b => b.peer_id === myId);
    const myAndarBet = myBets.find(b => b.side === 'andar');
    const myBaharBet = myBets.find(b => b.side === 'bahar');
    const totalMyBet = myBets.reduce((s, b) => s + b.amount, 0);
    const canBet = game.phase === 'betting'; // allow multiple bets
    const bettingOpen = game.phase === 'betting' && Date.now() < game.bettingEndsAt;

    const handleBet = (side) => {
        if (!canBet || !bettingOpen || selectedAmount > balance - totalMyBet) return;
        onAction({ type: 'bet', side, amount: selectedAmount });
    };

    const handleClearBets = () => {
        onAction({ type: 'clearBets' });
    };

    const myPayout = game.payouts?.[myId];
    const resultColor = game.result === 'andar' ? 'blue' : 'orange';

    // Pile card slice — show last 6 only to avoid overflow
    const andarVisible = game.andar.slice(-8);
    const baharVisible = game.bahar.slice(-8);

    return (
        <div className="game-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
            <div className="ab-table">
                {/* Header */}
                <div className="game-table-header">
                    <div className="game-table-title">
                        🃏 <span>Andar Bahar</span>
                        {isHost && <span className="host-crown" title="You are the host">👑</span>}
                    </div>
                    <div className="game-table-meta">
                        {wallet && <span className="chip-display">💰 {balance.toLocaleString()}</span>}
                        {game.phase === 'betting' && <BettingCountdown bettingEndsAt={game.bettingEndsAt} />}
                    </div>
                    {onHelp && <button className="btn-icon-help" onClick={onHelp} title="How to Play">?</button>}
                    <button className="btn-icon-close" onClick={onClose}>✕</button>
                </div>

                {/* Trump card area */}
                <div className="ab-trump-area">
                    <div className="ab-trump-col">
                        <div className="ab-trump-label-text">TRUMP CARD</div>
                        <TrumpCard card={game.trumpCard} />
                        {game.trumpCard && (
                            <div className="ab-trump-rank-label">
                                Match: <strong>{game.trumpCard.value}</strong>
                            </div>
                        )}
                    </div>

                    {/* Phase badge */}
                    <div className="ab-phase-badge-col">
                        {game.phase === 'betting' && !game.trumpCard && (
                            <div className="ab-phase-badge betting">PLACE BETS</div>
                        )}
                        {game.phase === 'betting' && game.trumpCard && (
                            <div className="ab-phase-badge betting">BETTING OPEN</div>
                        )}
                        {game.phase === 'dealing' && (
                            <div className="ab-phase-badge dealing">DEALING <span className="deal-dot" /></div>
                        )}
                        {game.phase === 'ended' && (
                            <div className={`ab-phase-badge result ${resultColor}`}>
                                        {game.result === 'draw' ? 'DRAW' : `${game.result?.toUpperCase()} WINS!`}
                            </div>
                        )}
                        {myPayout !== undefined && game.phase === 'ended' && (
                            <div className={`ab-my-result ${myPayout >= 0 ? 'win' : 'lose'}`}>
                                {myPayout >= 0 ? `+${myPayout}` : myPayout} chips
                            </div>
                        )}
                    </div>
                </div>

                {/* Card piles */}
                <div className="ab-piles-row">
                    {/* Andar (Inside) */}
                    <div className={`ab-pile-zone andar ${game.result === 'andar' ? 'winner-glow' : ''}`}>
                        <div className="ab-pile-header">
                            <span className="ab-pile-name andar">ANDAR (Inside)</span>
                            {myAndarBet && (
                                <span className="ab-bet-indicator">{myAndarBet.amount} chips</span>
                            )}
                            <span className="ab-pile-count">{game.andar.length} cards</span>
                        </div>
                        <div className="ab-cards-fan">
                            {game.andar.length === 0
                                ? <div className="ab-pile-empty-msg">—</div>
                                : andarVisible.map((card, i) => (
                                    <Card key={`a-${card.id}-${i}`} card={card} index={i} small />
                                ))
                            }
                        </div>
                    </div>

                    {/* Bahar (Outside) */}
                    <div className={`ab-pile-zone bahar ${game.result === 'bahar' ? 'winner-glow' : ''}`}>
                        <div className="ab-pile-header">
                            <span className="ab-pile-name bahar">BAHAR (Outside)</span>
                            {myBaharBet && (
                                <span className="ab-bet-indicator">{myBaharBet.amount} chips</span>
                            )}
                            <span className="ab-pile-count">{game.bahar.length} cards</span>
                        </div>
                        <div className="ab-cards-fan">
                            {game.bahar.length === 0
                                ? <div className="ab-pile-empty-msg">—</div>
                                : baharVisible.map((card, i) => (
                                    <Card key={`b-${card.id}-${i}`} card={card} index={i} small />
                                ))
                            }
                        </div>
                    </div>
                </div>

                {/* All bets */}
                {bets.length > 0 && (
                    <div className="ab-bets-bar">
                        {bets.map((b, i) => (
                            <span key={i} className={`ab-bet-pill ${b.side}`}>
                                {b.nick}: {b.amount}
                            </span>
                        ))}
                    </div>
                )}

                {/* Payouts */}
                {game.phase === 'ended' && game.payouts && (
                    <div className="ab-payouts-row">
                        {Object.entries(game.payouts).map(([pid, net]) => {
                            const bet = bets.find(b => b.peer_id === pid);
                            return (
                                <div key={pid} className={`ab-payout-chip ${net >= 0 ? 'win' : 'lose'}`}>
                                    <span>{bet?.nick || pid.slice(0, 6)}</span>
                                    <span>{net >= 0 ? `+${net}` : net}</span>
                                </div>
                            );
                        })}
                    </div>
                )}
                {game.phase === 'ended' && (
                    <div className="ab-new-round-row">
                        <button className="ready-btn" onClick={onNewRound}>Next Round</button>
                    </div>
                )}

                {/* Betting controls */}
                {canBet && bettingOpen && (
                    <div className="ab-bet-controls">
                        {/* Chip selector */}
                        <div className="chip-selector">
                            {BET_AMOUNTS.map(a => (
                                <button
                                    key={a}
                                    className={`chip-btn ${selectedAmount === a ? 'active' : ''}`}
                                    onClick={() => setSelectedAmount(a)}
                                    disabled={a > balance}
                                >
                                    {a}
                                </button>
                            ))}
                        </div>
                        {/* Side buttons */}
                        <div className="ab-side-btns">
                            <button
                                className="ab-side-btn andar"
                                onClick={() => handleBet('andar')}
                                disabled={selectedAmount > balance}
                            >
                                <span className="ab-btn-top">ANDAR</span>
                                <span className="ab-btn-sub">Inside · {selectedAmount} chips</span>
                            </button>
                            <button
                                className="ab-side-btn bahar"
                                onClick={() => handleBet('bahar')}
                                disabled={selectedAmount > balance}
                            >
                                <span className="ab-btn-top">BAHAR</span>
                                <span className="ab-btn-sub">Outside · {selectedAmount} chips</span>
                            </button>
                        </div>
                        <div className="ab-payout-note" style={{ marginTop: '0.75rem' }}>Andar 0.9:1 · Bahar 1:1</div>

                        <div className="ab-side-bets-header">Side Bets: Total Cards Dealt</div>
                        <div className="ab-side-bets-grid">
                            {Object.entries(ab.SIDE_BETS).map(([range, mult]) => (
                                <button
                                    key={range}
                                    className="ab-side-btn-small"
                                    onClick={() => handleBet(range)}
                                    disabled={selectedAmount > balance}
                                >
                                    <div className="ab-btn-top">{range}</div>
                                    <div className="ab-btn-sub">{mult}x</div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {myBets.length > 0 && game.phase === 'betting' && (
                    <div className="ab-bet-placed-msg">
                        {myBets.map((b, i) => (
                            <span key={i}>{b.amount} on <strong>{b.side.toUpperCase()}</strong>{i < myBets.length - 1 ? '  ·  ' : ''}</span>
                        ))}
                        {bettingOpen && <button className="rl-clear-btn" onClick={handleClearBets}>Clear</button>}
                        {bettingOpen && !isReady && (
                            <button className="ready-btn" onClick={onReady}>Ready</button>
                        )}
                        {bettingOpen && isReady && (
                            <span className="ready-badge">Ready</span>
                        )}
                    </div>
                )}
                {totalBettors > 0 && game.phase === 'betting' && (
                    <div className="ready-counter">{readyCount}/{totalBettors} Ready</div>
                )}

                {game.phase === 'dealing' && (
                    <div className="ab-dealing-msg">
                        <span className="deal-dot" /><span className="deal-dot delay1" /><span className="deal-dot delay2" />
                        Auto-dealing…
                    </div>
                )}

                {/* History */}
                <div className="ab-history-section">
                    <div className="section-mini-title">Last 100 Results (A = Andar, B = Bahar)</div>
                    <HistoryStrip history={game.trumpHistory} />
                </div>
            </div>
        </div>
    );
});
