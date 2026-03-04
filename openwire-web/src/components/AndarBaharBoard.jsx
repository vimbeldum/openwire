import { useEffect, useRef } from 'react';
import * as ab from '../lib/andarbahar';
import * as bj from '../lib/blackjack';

function Card({ card, index = 0 }) {
    if (!card) return <div className="bj-card bj-card-back"><div className="bj-card-pattern">?</div></div>;
    const { display, isRed } = bj.cardSymbol(card);
    return (
        <div
            className={`bj-card ${isRed ? 'red' : 'black'} flipped`}
            style={{ transform: `rotate(${(index % 3 - 1) * 4}deg) translateX(${index * -8}px)` }}
        >
            <div className="bj-card-corner top">{display}</div>
            <div className="bj-card-center">{card.suit}</div>
            <div className="bj-card-corner bottom">{display}</div>
        </div>
    );
}

function TrumpCard({ card }) {
    if (!card) return <div className="ab-trump-empty"><span>?</span></div>;
    const { display, isRed } = bj.cardSymbol(card);
    return (
        <div className={`ab-trump-card bj-card ${isRed ? 'red' : 'black'} flipped`}>
            <div className="bj-card-corner top">{display}</div>
            <div className="bj-card-center" style={{ fontSize: '2rem' }}>{card.suit}</div>
            <div className="bj-card-corner bottom">{display}</div>
        </div>
    );
}

function HistoryStrip({ history }) {
    const ref = useRef(null);
    useEffect(() => {
        if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth;
    }, [history]);

    if (!history || history.length === 0) return null;
    return (
        <div className="rl-history ab-history" ref={ref}>
            {history.map((card, i) => {
                const isRed = card.suit === '♥' || card.suit === '♦';
                return (
                    <span key={i} className={`rl-hist-chip rl-hist-${isRed ? 'red' : 'black'}`}>
                        {card.value}
                    </span>
                );
            })}
        </div>
    );
}

export default function AndarBaharBoard({ game, myId, myNick, wallet, onAction, onClose, isHost }) {
    if (!game) return null;

    const myBet = game.bets?.find(b => b.peer_id === myId);
    const balance = wallet ? (wallet.baseBalance + wallet.adminBonus) : 0;
    const canBet = game.phase === 'betting' && !myBet;
    const BET_AMOUNTS = [10, 25, 50, 100, 250, 500];

    const handleBet = (side, amount) => {
        if (!canBet || amount > balance) return;
        onAction({ type: 'bet', side, amount });
    };

    const handleDealTrump = () => onAction({ type: 'dealTrump' });
    const handleNewRound = () => onAction({ type: 'newRound' });

    return (
        <div className="game-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
            <div className="ab-table">
                <div className="rl-header">
                    <div className="rl-header-left">
                        <h2>🃏 Andar Bahar</h2>
                        {isHost && <span className="rl-host-badge">Host</span>}
                    </div>
                    <div className="rl-header-center">
                        {wallet && <span className="rl-balance">💰 {balance.toLocaleString()} chips</span>}
                    </div>
                    <button className="bj-close" onClick={onClose}>✕</button>
                </div>

                {/* Trump card + status */}
                <div className="ab-trump-section">
                    <div className="ab-trump-label">Trump Card</div>
                    <TrumpCard card={game.trumpCard} />
                    <div className="ab-phase-label">
                        {game.phase === 'betting' && !game.trumpCard && 'Place bets, then deal trump card'}
                        {game.phase === 'betting' && game.trumpCard && 'Trump revealed — betting open'}
                        {game.phase === 'dealing' && `Dealing… (${game.andar.length + game.bahar.length} cards dealt)`}
                        {game.phase === 'ended' && (
                            <span className="ab-result-label">
                                🏆 {game.result?.toUpperCase()} wins!
                                {game.payouts?.[myId] !== undefined && (
                                    <span className={game.payouts[myId] >= 0 ? 'win' : 'lose'}>
                                        &nbsp;{game.payouts[myId] >= 0 ? `+${game.payouts[myId]}` : game.payouts[myId]} chips
                                    </span>
                                )}
                            </span>
                        )}
                    </div>
                </div>

                {/* Card piles */}
                <div className="ab-piles">
                    <div className={`ab-pile ${game.result === 'andar' ? 'winner' : ''}`}>
                        <div className="ab-pile-label">
                            अंदर (Andar)
                            {myBet?.side === 'andar' && <span className="ab-my-bet-tag">Your bet: {myBet.amount}</span>}
                        </div>
                        <div className="ab-cards">
                            {game.andar.length === 0 && <div className="ab-pile-empty">—</div>}
                            {game.andar.map((card, i) => <Card key={card.id || i} card={card} index={i} />)}
                        </div>
                        <div className="ab-pile-count">{game.andar.length} cards</div>
                    </div>

                    <div className={`ab-pile ${game.result === 'bahar' ? 'winner' : ''}`}>
                        <div className="ab-pile-label">
                            बाहर (Bahar)
                            {myBet?.side === 'bahar' && <span className="ab-my-bet-tag">Your bet: {myBet.amount}</span>}
                        </div>
                        <div className="ab-cards">
                            {game.bahar.length === 0 && <div className="ab-pile-empty">—</div>}
                            {game.bahar.map((card, i) => <Card key={card.id || i} card={card} index={i} />)}
                        </div>
                        <div className="ab-pile-count">{game.bahar.length} cards</div>
                    </div>
                </div>

                {/* All players' bets */}
                {game.bets?.length > 0 && (
                    <div className="rl-all-bets">
                        <div className="rl-section-title">Bets</div>
                        <div className="rl-bets-list">
                            {game.bets.map((b, i) => (
                                <span key={i} className={`rl-bet-tag ${b.side}`}>
                                    {b.nick}: {b.side} — {b.amount}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Action panel */}
                <div className="ab-actions">
                    {game.phase === 'betting' && canBet && (
                        <div className="ab-bet-panel">
                            <div className="ab-bet-row">
                                {BET_AMOUNTS.map(a => (
                                    <div key={a} className="ab-side-bets">
                                        <button
                                            className="ab-bet-btn andar"
                                            onClick={() => handleBet('andar', a)}
                                            disabled={a > balance}
                                        >
                                            अंदर {a}
                                        </button>
                                        <button
                                            className="ab-bet-btn bahar"
                                            onClick={() => handleBet('bahar', a)}
                                            disabled={a > balance}
                                        >
                                            बाहर {a}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {game.phase === 'betting' && myBet && (
                        <div className="ab-bet-placed">
                            ✅ Bet placed: {myBet.amount} chips on <strong>{myBet.side}</strong>
                        </div>
                    )}

                    {game.phase === 'betting' && isHost && (
                        <button className="bj-btn-primary" onClick={handleDealTrump}>
                            Deal Trump Card →
                        </button>
                    )}

                    {game.phase === 'ended' && isHost && (
                        <button className="bj-btn-primary" onClick={handleNewRound}>
                            New Round
                        </button>
                    )}

                    {game.phase === 'dealing' && (
                        <div className="ab-dealing-indicator">
                            <span className="ab-dealing-dot" />
                            Auto-dealing…
                        </div>
                    )}
                </div>

                {/* History */}
                <div className="ab-history-section">
                    <div className="rl-section-title">Last 100 Trump Cards</div>
                    <HistoryStrip history={game.trumpHistory} />
                </div>
            </div>
        </div>
    );
}
