import { useEffect, useState } from 'react';
import * as bj from '../lib/blackjack';

/* ── Reusable Premium Card ────────────────────────── */
function Card({ card, hidden = false, index = 0, placeholder = false }) {
    const [flipped, setFlipped] = useState(false);

    useEffect(() => {
        if (!hidden && !placeholder) {
            const timer = setTimeout(() => setFlipped(true), 50 + index * 120);
            return () => clearTimeout(timer);
        }
    }, [hidden, index, placeholder]);

    if (placeholder) {
        return (
            <div className="card card-placeholder bj-card-pos" />
        );
    }

    if (hidden) {
        return (
            <div className="card card-back bj-card-pos" style={{ '--delay': `${index * 0.1}s` }}>
                <div className="card-back-pattern" />
            </div>
        );
    }

    const { display, isRed } = bj.cardSymbol(card);
    const suitClass = isRed ? 'red' : 'black';

    return (
        <div
            className={`card ${suitClass} bj-card-pos ${flipped ? 'card-flip' : ''}`}
            style={{
                '--delay': '0s',
                transform: flipped ? `rotate(${(index - 1) * 4}deg)` : 'rotateY(90deg)',
                opacity: flipped ? 1 : 0
            }}
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

/* ── Player / Dealer Hand ─────────────────────────── */
function Hand({ cards, label, value, hidden = false, status = '', isMyTurn = false }) {
    return (
        <div className={`bj-hand-zone ${isMyTurn ? 'active-turn' : ''} ${status === 'bust' ? 'bust' : ''}`}>
            <div className="bj-hand-header">
                <span className="bj-hand-name">{label}</span>
                <span className="bj-hand-val">
                    {hidden ? '?' : value}
                    {status && <span className={`bj-status-badge ${status}`}>{status.toUpperCase()}</span>}
                </span>
            </div>
            <div className="bj-cards-fan">
                {cards.length === 0 ? (
                    <>
                        <Card placeholder index={0} />
                        <Card placeholder index={1} />
                    </>
                ) : (
                    cards.map((card, i) => (
                        <Card key={card.id || i} card={card} hidden={hidden && i === 1} index={i} />
                    ))
                )}
            </div>
        </div>
    );
}

const BET_AMOUNTS = [10, 25, 50, 100, 250, 500];

function Countdown({ game }) {
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        if (game.phase !== 'betting') return;
        const key = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(key);
    }, [game.phase]);

    if (game.phase !== 'betting') return null;

    const ms = Math.max(0, game.nextDealAt - now);
    const s = Math.floor(ms / 1000);
    const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

    return (
        <div className="game-timer pulse">
            Dealing in {text}
        </div>
    );
}

/* ── Main Board ───────────────────────────────────── */
export default function BlackjackBoard({ game, myId, myNick, wallet, onAction, onClose, isHost }) {
    const [selectedBet, setSelectedBet] = useState(50);

    if (!game) return null;

    const myPlayer = game.players.find(p => p.peer_id === myId);
    const isMyTurn = game.phase === 'playing' && game.players[game.currentPlayerIndex]?.peer_id === myId;
    const dealerValue = bj.calculateHand(game.dealer.hand);
    const balance = wallet ? (wallet.baseBalance + wallet.adminBonus) : 0;

    const handleBet = () => {
        if (selectedBet > balance) return;
        onAction({ type: 'bet', amount: selectedBet });
    };

    return (
        <div className="game-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
            <div className="bj-table">
                {/* ── Header ── */}
                <div className="game-table-header">
                    <div className="game-table-title">
                        ♠ <span>Blackjack</span> ♥
                        {isHost && <span className="host-crown" title="You are the dealer">👑</span>}
                    </div>
                    <div className="game-table-meta">
                        {wallet && <span className="chip-display">💰 {balance.toLocaleString()}</span>}
                        <Countdown game={game} />
                    </div>
                    <button className="btn-icon-close" onClick={onClose}>✕</button>
                </div>

                {/* ── Dealer Area ── */}
                <div className="bj-dealer-area">
                    <Hand
                        cards={game.dealer.hand}
                        label="Dealer"
                        value={dealerValue}
                        hidden={!game.dealer.revealed && game.dealer.hand.length > 0}
                        status={game.phase === 'ended' && bj.isBust(game.dealer.hand) ? 'bust' : ''}
                    />
                </div>

                {/* ── Status Bar ── */}
                <div className="bj-status-bar">
                    {game.phase === 'betting' && <div className="bj-phase-msg">Place your bets!</div>}
                    {game.phase === 'playing' && game.currentPlayerIndex >= 0 && (
                        <div className="bj-phase-msg highlight">
                            {game.players[game.currentPlayerIndex]?.nick}'s turn
                            {isMyTurn && ' (You)'}
                        </div>
                    )}
                    {game.phase === 'dealer' && <div className="bj-phase-msg">Dealer is playing...</div>}
                    {game.phase === 'ended' && <div className="bj-phase-msg">Round complete!</div>}
                </div>

                {/* ── Players Area ── */}
                <div className="bj-players-area">
                    {game.players.map((player, idx) => (
                        <Hand
                            key={player.peer_id}
                            cards={player.hand}
                            label={`${player.nick} ${player.peer_id === myId ? '(You)' : ''}`}
                            value={player.hand.length > 0 ? bj.calculateHand(player.hand) : '-'}
                            status={player.status}
                            isMyTurn={game.phase === 'playing' && idx === game.currentPlayerIndex}
                        />
                    ))}
                    {game.players.length === 0 && <div className="bj-empty-msg">Waiting for players to join...</div>}
                </div>

                {/* ── Action Bar ── */}
                <div className="bj-action-bar">
                    {game.phase === 'betting' && (
                        <div className="bj-bet-controls">
                            {!myPlayer ? (
                                <button className="bj-btn-primary" onClick={() => onAction({ type: 'join', peer_id: myId })}>
                                    Join Table
                                </button>
                            ) : myPlayer.status === 'waiting' ? (
                                <div className="bj-bet-row">
                                    <div className="chip-selector">
                                        {BET_AMOUNTS.map(a => (
                                            <button
                                                key={a}
                                                className={`chip-btn ${selectedBet === a ? 'active' : ''}`}
                                                onClick={() => setSelectedBet(a)}
                                                disabled={a > balance}
                                            >{a}</button>
                                        ))}
                                    </div>
                                    <button className="bj-btn-primary play" onClick={handleBet} disabled={selectedBet > balance}>
                                        Bet {selectedBet}
                                    </button>
                                </div>
                            ) : (
                                <div className="bj-bet-row">
                                    <span className="bj-bet-locked">Bet placed: <strong>{myPlayer.bet}</strong> chips</span>
                                </div>
                            )}
                        </div>
                    )}

                    {game.phase === 'playing' && isMyTurn && (
                        <div className="bj-play-controls">
                            <button className="bj-btn-action hit" onClick={() => onAction({ type: 'hit' })}>Hit (Draw)</button>
                            <button className="bj-btn-action stand" onClick={() => onAction({ type: 'stand' })}>Stand</button>
                        </div>
                    )}

                    {game.phase === 'ended' && isHost && (
                        <button className="bj-btn-primary deal" onClick={() => onAction({ type: 'newRound' })}>
                            Start Next Round
                        </button>
                    )}

                    {!myPlayer && game.phase !== 'betting' && (
                        <div className="bj-spectator-msg">Spectating... Wait for next round to join.</div>
                    )}
                </div>
            </div>
        </div>
    );
}
