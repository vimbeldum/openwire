import { useState, useEffect, useMemo, memo, useRef } from 'react';
import '../styles/shashn.css';

/* ── Constants ────────────────────────────────────────────── */
const SUIT_SYMBOLS = {
    Hearts: '♥',
    Diamonds: '♦',
    Clubs: '♣',
    Spades: '♠',
};

const SUIT_COLORS = {
    Hearts: '#c0392b',
    Diamonds: '#c0392b',
    Clubs: '#1a1a2e',
    Spades: '#1a1a2e',
};

const RANK_ORDER = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/* ── Card Component ───────────────────────────────────────── */
const Card = memo(function Card({ card, onClick, disabled, selected, style }) {
    if (!card) {
        return <div className="shashn-card-placeholder" style={style} />;
    }

    const symbol = SUIT_SYMBOLS[card.suit] || '?';
    const colorClass = SUIT_COLORS[card.suit] === '#c0392b' ? 'red' : 'black';
    const color = SUIT_COLORS[card.suit];

    return (
        <div
            className={`shashn-card ${colorClass} ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
            onClick={disabled ? undefined : onClick}
            style={{ ...style, color }}
        >
            {/* Top-left corner */}
            <div className="shashn-card-corner top-left">
                <span className="corner-rank">{card.rank}</span>
                <span className="corner-suit">{symbol}</span>
            </div>

            {/* Center suit */}
            <div className="shashn-card-suit-large">{symbol}</div>

            {/* Bottom-right corner (rotated) */}
            <div className="shashn-card-corner bottom-right">
                <span className="corner-rank">{card.rank}</span>
                <span className="corner-suit">{symbol}</span>
            </div>
        </div>
    );
});

/* ── Trump Indicator Component ────────────────────────────── */
const TrumpIndicator = memo(function TrumpIndicator({ suit }) {
    if (!suit) return null;

    const symbol = SUIT_SYMBOLS[suit];
    const colorClass = suit.toLowerCase();

    return (
        <div className="shashn-trump-indicator">
            <span className="shashn-trump-label">Trump</span>
            <span className={`shashn-trump-suit ${colorClass}`}>{symbol}</span>
            <span className="shashn-trump-name">{suit}</span>
        </div>
    );
});

/* ── Player Card Stack (mini cards representation) ──────── */
const PlayerCardStack = memo(function PlayerCardStack({ count }) {
    const visible = Math.min(count, 5);
    return (
        <div className="shashn-card-stack">
            {Array.from({ length: visible }).map((_, i) => (
                <div key={i} className="shashn-card-mini" style={{ marginLeft: i > 0 ? '-8px' : 0 }} />
            ))}
            {count > 5 && <span style={{ fontSize: '0.7rem', marginLeft: '4px' }}>+{count - 5}</span>}
        </div>
    );
});

/* ── Main Component ──────────────────────────────────────── */
export default memo(function ShashnBoard({
    game,
    myId,
    myNick,
    wallet,
    onAction,
    onClose,
    onHelp,
    isHost,
    onReady,
    readyCount,
    totalBettors,
    isReady
}) {
    const [selectedCard, setSelectedCard] = useState(null);
    const handRef = useRef(null);

    /* ── Derived State ─────────────────────────────────────── */
    const currentPlayerIdx = game?.currentPlayer ?? -1;
    const currentPlayer = game?.players?.[currentPlayerIdx];
    const isMyTurn = currentPlayer?.peer_id === myId;
    const myPlayerIdx = game?.players?.findIndex(p => p.peer_id === myId) ?? -1;
    const myHand = game?.players?.[myPlayerIdx]?.hand || [];
    const otherPlayerIdx = myPlayerIdx === 0 ? 1 : 0;
    const otherPlayer = game?.players?.[otherPlayerIdx];

    const canPlay = isMyTurn && game?.phase === 'play';
    const leadSuit = game?.currentTrick?.leadSuit;
    const trickCards = game?.currentTrick?.cards || [];
    const trickWinner = game?.currentTrick?.winner;
    const trumpSuit = game?.trumpSuit;
    const phase = game?.phase;

    /* ── Sort hand by suit then rank ─────────────────────── */
    const sortedHand = useMemo(() => {
        return [...myHand].sort((a, b) => {
            if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
            return RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);
        });
    }, [myHand]);

    /* ── Helpers ──────────────────────────────────────────── */
    const handleCardClick = (cardId) => {
        if (!canPlay) return;
        setSelectedCard(prev => prev === cardId ? null : cardId);
    };

    const handlePlayCard = () => {
        if (!selectedCard) return;
        onAction({ type: 'play', cardId: selectedCard });
        setSelectedCard(null);
    };

    const handleCollectTrick = () => {
        onAction({ type: 'collect' });
    };

    const handleNewRound = () => {
        onAction({ type: 'newround' });
    };

    /* ── Phase Labels ─────────────────────────────────────── */
    const phaseLabels = {
        deal: 'Waiting for players...',
        play: isMyTurn ? 'Your turn — play a card!' : 'Opponent\'s turn...',
        trick_end: 'Trick complete!',
        round_end: 'Round over!',
        game_end: 'Game Over!',
    };

    /* ── Empty / Loading State ───────────────────────────── */
    if (!game) {
        return (
            <div className="shashn-container">
                <div className="shashn-waiting">
                    <div className="shashn-waiting-icon">🎴</div>
                    <div className="shashn-waiting-text">Loading game...</div>
                </div>
            </div>
        );
    }

    /* ── Waiting for Players ─────────────────────────────── */
    if (phase === 'deal') {
        const hasPlayer1 = game.players[0]?.peer_id;
        const hasPlayer2 = game.players[1]?.peer_id;
        return (
            <div className="shashn-container">
                <div className="shashn-header">
                    <div className="shashn-title">
                        <span className="shashn-title-icon">🎴</span>
                        Shashn
                    </div>
                    <div className="shashn-phase">Waiting for players...</div>
                </div>

                <div className="shashn-players">
                    <div className={`shashn-player ${hasPlayer1 ? 'active' : ''}`}>
                        <div className="shashn-player-header">
                            <span className="shashn-player-name">
                                {game.players[0]?.nick || 'Waiting...'}
                            </span>
                            {hasPlayer1 && <span className="shashn-turn-indicator">✓</span>}
                        </div>
                    </div>
                    <div className={`shashn-player ${hasPlayer2 ? 'active' : ''}`}>
                        <div className="shashn-player-header">
                            <span className="shashn-player-name">
                                {game.players[1]?.nick || 'Waiting...'}
                            </span>
                            {hasPlayer2 && <span className="shashn-turn-indicator">✓</span>}
                        </div>
                    </div>
                </div>

                <div className="shashn-waiting">
                    <div className="shashn-waiting-icon">⏳</div>
                    <div className="shashn-waiting-text">
                        {!hasPlayer1 && !hasPlayer2 && 'Waiting for both players to join...'}
                        {hasPlayer1 && !hasPlayer2 && 'Waiting for second player...'}
                        {hasPlayer2 && !hasPlayer1 && 'Waiting for first player...'}
                    </div>
                </div>

                <div className="shashn-footer">
                    <button className="shashn-footer-btn shashn-btn-help" onClick={() => onHelp?.('shashn')}>
                        ❓ Help
                    </button>
                    <button className="shashn-footer-btn shashn-btn-close" onClick={onClose}>
                        ✕ Close
                    </button>
                </div>
            </div>
        );
    }

    /* ── Main Game UI ────────────────────────────────────── */
    return (
        <div className="shashn-container">
            {/* Header */}
            <div className="shashn-header">
                <div className="shashn-title">
                    <span className="shashn-title-icon">🎴</span>
                    Shashn
                </div>
                <div className="shashn-phase">{phaseLabels[phase] || phase}</div>
                
                <div className="shashn-round-info">
                    <span>Round {game.round}</span>
                    <span>Trick {game.trickNumber}/6</span>
                    <span>Target: 150</span>
                </div>

                <TrumpIndicator suit={trumpSuit} />
            </div>

            {/* Players Row */}
            <div className="shashn-players">
                {/* Player 1 */}
                <div className={`shashn-player ${currentPlayerIdx === 0 ? 'active' : ''}`}>
                    <div className="shashn-player-header">
                        <span className="shashn-player-name">
                            {game.players[0]?.nick || `Player 1`}
                            {myPlayerIdx === 0 && ' (You)'}
                        </span>
                        {currentPlayerIdx === 0 && phase === 'play' && (
                            <span className="shashn-turn-indicator">▶</span>
                        )}
                    </div>
                    <div className="shashn-player-cards-count">
                        <PlayerCardStack count={game.players[0]?.hand?.length || 0} />
                    </div>
                    <div className="shashn-player-stats">
                        <div className="shashn-stat">
                            <span className="shashn-stat-label">Score</span>
                            <span className="shashn-stat-value score">{game.players[0]?.score || 0}</span>
                        </div>
                        <div className="shashn-stat">
                            <span className="shashn-stat-label">Tricks</span>
                            <span className="shashn-stat-value tricks">{game.players[0]?.tricksWon || 0}</span>
                        </div>
                    </div>
                </div>

                {/* Player 2 */}
                <div className={`shashn-player ${currentPlayerIdx === 1 ? 'active' : ''}`}>
                    <div className="shashn-player-header">
                        <span className="shashn-player-name">
                            {game.players[1]?.nick || `Player 2`}
                            {myPlayerIdx === 1 && ' (You)'}
                        </span>
                        {currentPlayerIdx === 1 && phase === 'play' && (
                            <span className="shashn-turn-indicator">▶</span>
                        )}
                    </div>
                    <div className="shashn-player-cards-count">
                        <PlayerCardStack count={game.players[1]?.hand?.length || 0} />
                    </div>
                    <div className="shashn-player-stats">
                        <div className="shashn-stat">
                            <span className="shashn-stat-label">Score</span>
                            <span className="shashn-stat-value score">{game.players[1]?.score || 0}</span>
                        </div>
                        <div className="shashn-stat">
                            <span className="shashn-stat-label">Tricks</span>
                            <span className="shashn-stat-value tricks">{game.players[1]?.tricksWon || 0}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Trick Area */}
            <div className="shashn-trick-area">
                <div className="shashn-trick-header">
                    <span className="shashn-trick-label">Current Trick</span>
                    {leadSuit && (
                        <div className="shashn-lead-suit-badge">
                            <span>Lead:</span>
                            <span className="suit-symbol" style={{ color: SUIT_COLORS[leadSuit] }}>
                                {SUIT_SYMBOLS[leadSuit]}
                            </span>
                            <span>{leadSuit}</span>
                        </div>
                    )}
                </div>

                <div className="shashn-trick-cards">
                    {/* Player 0's trick slot */}
                    <div className="shashn-trick-slot">
                        {trickCards.find(c => c.player === 0) ? (
                            <div className="shashn-trick-card" style={{ position: 'relative' }}>
                                <div className="shashn-trick-player-name">
                                    {game.players[0]?.nick || 'P1'}
                                </div>
                                <Card
                                    card={trickCards.find(c => c.player === 0)?.card}
                                    disabled={true}
                                />
                                {trickWinner === 0 && phase === 'trick_end' && (
                                    <div className="shashn-trick-winner-badge">✓</div>
                                )}
                            </div>
                        ) : (
                            <>
                                <div className="shashn-trick-player-name">
                                    {game.players[0]?.nick || 'P1'}
                                </div>
                                <div className="shashn-trick-empty">
                                    {trickCards.length === 0 ? 'No cards' : 'Waiting...'}
                                </div>
                            </>
                        )}
                    </div>

                    <div className="shashn-trick-vs">vs</div>

                    {/* Player 1's trick slot */}
                    <div className="shashn-trick-slot">
                        {trickCards.find(c => c.player === 1) ? (
                            <div className="shashn-trick-card" style={{ position: 'relative' }}>
                                <div className="shashn-trick-player-name">
                                    {game.players[1]?.nick || 'P2'}
                                </div>
                                <Card
                                    card={trickCards.find(c => c.player === 1)?.card}
                                    disabled={true}
                                />
                                {trickWinner === 1 && phase === 'trick_end' && (
                                    <div className="shashn-trick-winner-badge">✓</div>
                                )}
                            </div>
                        ) : (
                            <>
                                <div className="shashn-trick-player-name">
                                    {game.players[1]?.nick || 'P2'}
                                </div>
                                <div className="shashn-trick-empty">
                                    {trickCards.length === 1 ? 'Waiting...' : 'No cards'}
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {phase === 'trick_end' && (
                    <div className="shashn-trick-actions">
                        <button className="shashn-btn shashn-btn-success" onClick={handleCollectTrick}>
                            Collect Trick
                        </button>
                    </div>
                )}
            </div>

            {/* Score Panel */}
            <div className="shashn-score-panel">
                <div className="shashn-score-panel-title">Score Board</div>
                <div className="shashn-score-comparison">
                    <div className="shashn-score-player">
                        <span className="shashn-score-player-name">
                            {game.players[0]?.nick || 'P1'}
                        </span>
                        <span className="shashn-score-player-value">
                            {game.players[0]?.score || 0}
                        </span>
                    </div>
                    <div className="shashn-score-vs">vs</div>
                    <div className="shashn-score-player">
                        <span className="shashn-score-player-name">
                            {game.players[1]?.nick || 'P2'}
                        </span>
                        <span className="shashn-score-player-value">
                            {game.players[1]?.score || 0}
                        </span>
                    </div>
                </div>
                <div className="shashn-score-progress">
                    <div className="shashn-progress-bar">
                        <div
                            className="shashn-progress-fill"
                            style={{ width: `${Math.min(100, ((game.players[0]?.score || 0) / 150) * 100)}%` }}
                        />
                    </div>
                    <span className="shashn-target-score">Target: 150</span>
                    <div className="shashn-progress-bar">
                        <div
                            className="shashn-progress-fill"
                            style={{ width: `${Math.min(100, ((game.players[1]?.score || 0) / 150) * 100)}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* My Hand */}
            <div className="shashn-hand-section">
                <div className="shashn-hand-header">
                    <span className="shashn-section-title">
                        Your Hand {isMyTurn ? '(Your Turn!)' : ''}
                    </span>
                    <span className="shashn-hand-count">{myHand.length} cards</span>
                </div>

                <div className="shashn-hand" ref={handRef}>
                    {sortedHand.length === 0 ? (
                        <div className="shashn-waiting-text" style={{ color: 'rgba(255,255,255,0.5)' }}>
                            No cards in hand
                        </div>
                    ) : (
                        sortedHand.map(card => (
                            <Card
                                key={card.id}
                                card={card}
                                selected={selectedCard === card.id}
                                disabled={!canPlay}
                                onClick={() => handleCardClick(card.id)}
                            />
                        ))
                    )}
                </div>

                {canPlay && selectedCard && (
                    <div className="shashn-play-area">
                        <button className="shashn-btn shashn-btn-primary" onClick={handlePlayCard}>
                            Play {selectedCard}
                        </button>
                        <button
                            className="shashn-btn"
                            style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}
                            onClick={() => setSelectedCard(null)}
                        >
                            Cancel
                        </button>
                    </div>
                )}
            </div>

            {/* Game Log */}
            {game.log?.length > 0 && (
                <div className="shashn-log">
                    {game.log.slice(-6).map((entry, i) => (
                        <div key={i} className="shashn-log-entry">{entry}</div>
                    ))}
                </div>
            )}

            {/* Winner Banner */}
            {phase === 'game_end' && game.winner && (
                <div className="shashn-winner">
                    🏆 {game.players.find(p => p.peer_id === game.winner)?.nick} Wins!
                </div>
            )}

            {/* New Round Button */}
            {(phase === 'round_end' || (phase === 'game_end' && game.round < 10)) && (
                <div className="shashn-play-area">
                    <button className="shashn-btn shashn-btn-primary" onClick={handleNewRound}>
                        New Round
                    </button>
                </div>
            )}

            {/* Footer */}
            <div className="shashn-footer">
                <button className="shashn-footer-btn shashn-btn-help" onClick={() => onHelp?.('shashn')}>
                    ❓ Help
                </button>
                <button className="shashn-footer-btn shashn-btn-close" onClick={onClose}>
                    ✕ Close
                </button>
            </div>
        </div>
    );
});
