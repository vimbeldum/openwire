import { useEffect, useState } from 'react';
import * as bj from '../lib/blackjack';

function Card({ card, hidden = false, index = 0, animate = true }) {
    const [flipped, setFlipped] = useState(false);
    const { display, isRed } = bj.cardSymbol(card);

    useEffect(() => {
        if (animate && !hidden) {
            const timer = setTimeout(() => setFlipped(true), 100 + index * 150);
            return () => clearTimeout(timer);
        }
    }, [animate, hidden, index]);

    if (hidden) {
        return (
            <div className="bj-card bj-card-back">
                <div className="bj-card-pattern">?</div>
            </div>
        );
    }

    return (
        <div
            className={`bj-card ${isRed ? 'red' : 'black'} ${flipped ? 'flipped' : ''}`}
            style={{
                animationDelay: `${index * 0.1}s`,
                transform: `rotate(${(index - 1) * 3}deg)`,
            }}
        >
            <div className="bj-card-corner top">{display}</div>
            <div className="bj-card-center">{card.suit}</div>
            <div className="bj-card-corner bottom">{display}</div>
        </div>
    );
}

function Hand({ cards, label, value, hidden = false, status = '' }) {
    return (
        <div className={`bj-hand ${status}`}>
            <div className="bj-hand-header">
                <span className="bj-hand-label">{label}</span>
                <span className="bj-hand-value">
                    {hidden ? '?' : value}
                    {status && <span className={`bj-status ${status}`}> — {status.toUpperCase()}</span>}
                </span>
            </div>
            <div className="bj-cards">
                {cards.map((card, i) => (
                    <Card
                        key={card.id || i}
                        card={card}
                        hidden={hidden && i === 1}
                        index={i}
                    />
                ))}
            </div>
        </div>
    );
}

export default function BlackjackBoard({ game, myId, onAction, onClose }) {
    const [animating, setAnimating] = useState(false);

    useEffect(() => {
        setAnimating(true);
        const timer = setTimeout(() => setAnimating(false), 500);
        return () => clearTimeout(timer);
    }, [game?.players?.length, game?.dealer?.hand?.length]);

    if (!game) return null;

    const myPlayer = game.players.find(p => p.peer_id === myId);
    const isMyTurn = bj.isPlayerTurn(game, myId);
    const dealerValue = game.dealer.revealed ? bj.calculateHand(game.dealer.hand) : '?';

    const handleHit = () => {
        if (!isMyTurn || animating) return;
        onAction({ type: 'hit', peer_id: myId });
    };

    const handleStand = () => {
        if (!isMyTurn || animating) return;
        onAction({ type: 'stand', peer_id: myId });
    };

    const handleBet = (amount) => {
        if (game.phase !== 'betting' || animating) return;
        if (myPlayer?.status !== 'waiting' && myPlayer?.status !== 'ready') return;
        onAction({ type: 'bet', peer_id: myId, amount });
    };

    const handleDeal = () => {
        if (game.phase !== 'betting' || animating) return;
        const readyPlayers = game.players.filter(p => p.bet > 0);
        if (readyPlayers.length === 0) return;
        onAction({ type: 'deal' });
    };

    const handleNewRound = () => {
        onAction({ type: 'newRound' });
    };

    return (
        <div className="game-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
            <div className="bj-table">
                <div className="bj-header">
                    <h2>♠ Blackjack ♥</h2>
                    <button className="bj-close" onClick={onClose}>✕</button>
                </div>

                {/* Dealer Section */}
                <div className="bj-dealer-area">
                    <Hand
                        cards={game.dealer.hand}
                        label="Dealer"
                        value={dealerValue}
                        hidden={!game.dealer.revealed && game.dealer.hand.length > 0}
                        status={game.phase === 'ended' ? (bj.isBust(game.dealer.hand) ? 'bust' : '') : ''}
                    />
                </div>

                {/* Game Status */}
                <div className="bj-status-bar">
                    {game.phase === 'betting' && (
                        <span className="bj-phase">Place your bets!</span>
                    )}
                    {game.phase === 'playing' && game.currentPlayerIndex >= 0 && (
                        <span className="bj-phase">
                            {game.players[game.currentPlayerIndex]?.nick}'s turn
                            {isMyTurn && ' (You)'}
                        </span>
                    )}
                    {game.phase === 'dealer' && (
                        <span className="bj-phase">Dealer is playing...</span>
                    )}
                    {game.phase === 'ended' && (
                        <span className="bj-phase">Round complete!</span>
                    )}
                </div>

                {/* Players Section */}
                <div className="bj-players-area">
                    {game.players.map((player, idx) => (
                        <Hand
                            key={player.peer_id}
                            cards={player.hand}
                            label={player.nick + (player.peer_id === myId ? ' (You)' : '')}
                            value={player.hand.length > 0 ? bj.calculateHand(player.hand) : '-'}
                            status={player.status}
                        />
                    ))}
                    {game.players.length === 0 && (
                        <div className="bj-empty">No players yet</div>
                    )}
                </div>

                {/* Action Buttons */}
                <div className="bj-actions">
                    {game.phase === 'betting' && (
                        <>
                            {(!myPlayer || myPlayer.status === 'waiting') && (
                                <div className="bj-bet-buttons">
                                    <button onClick={() => handleBet(10)}>$10</button>
                                    <button onClick={() => handleBet(25)}>$25</button>
                                    <button onClick={() => handleBet(50)}>$50</button>
                                    <button onClick={() => handleBet(100)}>$100</button>
                                </div>
                            )}
                            {myPlayer?.bet > 0 && (
                                <div className="bj-bet-info">
                                    Your bet: ${myPlayer.bet}
                                    <button onClick={() => handleBet(0)}>Clear</button>
                                </div>
                            )}
                            {game.players.some(p => p.bet > 0) && (
                                <button className="bj-btn-primary" onClick={handleDeal}>
                                    Deal Cards
                                </button>
                            )}
                        </>
                    )}

                    {game.phase === 'playing' && isMyTurn && (
                        <>
                            <button className="bj-btn-hit" onClick={handleHit}>
                                Hit
                            </button>
                            <button className="bj-btn-stand" onClick={handleStand}>
                                Stand
                            </button>
                        </>
                    )}

                    {game.phase === 'ended' && (
                        <button className="bj-btn-primary" onClick={handleNewRound}>
                            New Round
                        </button>
                    )}

                    {!myPlayer && game.phase === 'betting' && (
                        <button
                            className="bj-btn-join"
                            onClick={() => onAction({ type: 'join', peer_id: myId })}
                        >
                            Join Game
                        </button>
                    )}
                </div>

                {/* Spectators can join during betting */}
                {!myPlayer && game.phase !== 'betting' && (
                    <div className="bj-spectator">
                        You're spectating. Wait for next round to join.
                    </div>
                )}
            </div>
        </div>
    );
}
