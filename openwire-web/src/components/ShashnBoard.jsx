import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import '../styles/shashn.css';

const SUIT_SYMBOLS = {
    Hearts: '♥',
    Diamonds: '♦',
    Clubs: '♣',
    Spades: '♠',
};

const SUIT_COLORS = {
    Hearts: '#E74C3C',
    Diamonds: '#E74C3C',
    Clubs: '#2C3E50',
    Spades: '#2C3E50',
};

const RANK_ORDER = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function CardDisplay({ card, onClick, disabled, selected, faceDown }) {
    if (!card) return <div className="shashn-card-placeholder">-</div>;

    if (faceDown) {
        return (
            <div className="shashn-card shashn-card-facedown" onClick={disabled ? undefined : onClick}>
                <div className="shashn-card-back">🎴</div>
            </div>
        );
    }

    const symbol = SUIT_SYMBOLS[card.suit] || card.suit[0];
    const color = SUIT_COLORS[card.suit] || '#000';

    return (
        <div
            className={`shashn-card ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
            onClick={disabled ? undefined : onClick}
            style={{ color }}
        >
            <div className="shashn-card-rank">{card.rank}</div>
            <div className="shashn-card-suit">{symbol}</div>
        </div>
    );
}

export default memo(function ShashnBoard({ game, myId, myNick, wallet, onAction, onClose, onHelp, isHost, onReady, onNewRound, readyCount, totalBettors, isReady }) {
    const [selectedCard, setSelectedCard] = useState(null);

    const currentPlayer = game?.players?.[game.currentPlayer];
    const isMyTurn = currentPlayer?.peer_id === myId;
    const myPlayerIdx = game?.players?.findIndex(p => p.peer_id === myId) ?? -1;
    const myHand = game?.players?.[myPlayerIdx]?.hand || [];
    const otherPlayerIdx = myPlayerIdx === 0 ? 1 : 0;
    const otherPlayer = game?.players?.[otherPlayerIdx];

    // Sort hand by suit then rank
    const sortedHand = useMemo(() => {
        return [...myHand].sort((a, b) => {
            if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
            return RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);
        });
    }, [myHand]);

    const canPlay = isMyTurn && game?.phase === 'play' && currentPlayer?.peer_id === myId;
    const leadSuit = game?.currentTrick?.leadSuit;
    const trickCards = game?.currentTrick?.cards || [];
    const trickWinner = game?.currentTrick?.winner;
    const trumpSuit = game?.trumpSuit;

    const handleCardClick = (cardId) => {
        if (!canPlay) return;
        setSelectedCard(cardId);
    };

    const handlePlayCard = () => {
        if (!selectedCard || !canPlay) return;
        onAction({ type: 'play', cardId: selectedCard });
        setSelectedCard(null);
    };

    const handleCollectTrick = () => {
        onAction({ type: 'collect' });
    };

    const handleNewRound = () => {
        onAction({ type: 'newround' });
    };

    if (!game) return null;

    const phaseLabels = {
        deal: 'Waiting for players...',
        play: 'Play a card!',
        trick_end: 'Trick complete!',
        round_end: 'Round over!',
        game_end: 'Game Over!',
    };

    return (
        <div className="shashn-container">
            <div className="shashn-header">
                <div className="shashn-title">🎴 Shashn</div>
                <div className="shashn-phase">{phaseLabels[game.phase] || game.phase}</div>
                <div className="shashn-round">Round {game.round} | Trick {game.trickNumber}/6</div>
                {trumpSuit && (
                    <div className="shashn-trump" style={{ color: SUIT_COLORS[trumpSuit] }}>
                        Trump: {SUIT_SYMBOLS[trumpSuit]} {trumpSuit}
                    </div>
                )}
            </div>

            {/* Players */}
            <div className="shashn-players">
                {game.players.map((p, i) => (
                    <div key={p.peer_id || i} className={`shashn-player ${i === game.currentPlayer ? 'active' : ''}`}>
                        <div className="shashn-player-info">
                            <span className="shashn-player-name">{p.nick || `Player ${i + 1}`}</span>
                            <span className="shashn-player-score">Score: {p.score}</span>
                            <span className="shashn-player-tricks">Tricks: {p.tricksWon}</span>
                        </div>
                        {i === game.currentPlayer && game.phase === 'play' && (
                            <div className="shashn-turn-badge">▶</div>
                        )}
                    </div>
                ))}
            </div>

            {/* Current Trick */}
            <div className="shashn-trick-area">
                <div className="shashn-trick-label">Current Trick</div>
                <div className="shashn-trick-cards">
                    {trickCards.length === 0 && (
                        <div className="shashn-trick-empty">No cards played yet</div>
                    )}
                    {trickCards.map((entry, i) => (
                        <div key={i} className="shashn-trick-card">
                            <div className="shashn-trick-player">{game.players[entry.player]?.nick || 'Player'}</div>
                            <CardDisplay
                                card={entry.card}
                                disabled={true}
                                faceDown={false}
                            />
                            {trickWinner === entry.player && (
                                <div className="shashn-trick-winner">✓</div>
                            )}
                        </div>
                    ))}
                    {trickCards.length < 2 && trickCards.length > 0 && (
                        <div className="shashn-trick-empty-slot">Waiting...</div>
                    )}
                </div>
                {game.phase === 'trick_end' && (
                    <div className="shashn-trick-actions">
                        <button className="shashn-btn" onClick={handleCollectTrick}>
                            Collect Trick
                        </button>
                    </div>
                )}
            </div>

            {/* My Hand */}
            <div className="shashn-hand-section">
                <div className="shashn-section-title">Your Hand ({myHand.length} cards)</div>
                {leadSuit && (
                    <div className="shashn-lead-suit">
                        Lead suit: <span style={{ color: SUIT_COLORS[leadSuit] }}>{SUIT_SYMBOLS[leadSuit]} {leadSuit}</span>
                    </div>
                )}
                <div className="shashn-hand">
                    {sortedHand.map(card => (
                        <CardDisplay
                            key={card.id}
                            card={card}
                            selected={selectedCard === card.id}
                            disabled={!canPlay}
                            onClick={() => handleCardClick(card.id)}
                            faceDown={false}
                        />
                    ))}
                </div>
                {canPlay && selectedCard && (
                    <div className="shashn-play-area">
                        <button className="shashn-btn shashn-play-btn" onClick={handlePlayCard}>
                            Play {selectedCard}
                        </button>
                    </div>
                )}
            </div>

            {/* Game Log */}
            {game.log?.length > 0 && (
                <div className="shashn-log">
                    {game.log.slice(-5).map((entry, i) => (
                        <div key={i} className="shashn-log-entry">{entry}</div>
                    ))}
                </div>
            )}

            {/* Score Display */}
            <div className="shashn-scores">
                <div className="shashn-score-item">
                    <span className="shashn-score-label">{game.players[0]?.nick || 'P1'}:</span>
                    <span className="shashn-score-value">{game.players[0]?.score || 0}</span>
                </div>
                <div className="shashn-score-divider">vs</div>
                <div className="shashn-score-item">
                    <span className="shashn-score-label">{game.players[1]?.nick || 'P2'}:</span>
                    <span className="shashn-score-value">{game.players[1]?.score || 0}</span>
                </div>
            </div>

            {/* Winner */}
            {game.phase === 'game_end' && game.winner && (
                <div className="shashn-winner">
                    🏆 {game.players.find(p => p.peer_id === game.winner)?.nick} Wins!
                </div>
            )}

            {/* New Round Button */}
            {(game.phase === 'round_end' || (game.phase === 'game_end' && game.round < 10)) && (
                <button className="shashn-btn" onClick={handleNewRound}>
                    New Round
                </button>
            )}

            <div className="shashn-footer">
                <button className="shashn-help-btn" onClick={() => onHelp('shashn')}>❓ Help</button>
                <button className="shashn-close-btn" onClick={onClose}>✕ Close</button>
            </div>
        </div>
    );
});
