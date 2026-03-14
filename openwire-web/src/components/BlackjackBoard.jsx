import { useEffect, useState, useRef, useMemo, memo } from 'react';
import '../styles/blackjack.css';
import * as bj from '../lib/blackjack';

/* ── Reusable Premium Card ────────────────────────── */
function Card({ card, hidden = false, index = 0, placeholder = false, revealed = false }) {
    const [flipped, setFlipped] = useState(false);

    useEffect(() => {
        if (revealed && !hidden && !placeholder) {
            const timer = setTimeout(() => setFlipped(true), 80);
            return () => clearTimeout(timer);
        }
    }, [revealed, hidden, placeholder]);

    if (placeholder) {
        return <div className="card card-placeholder bj-card-pos" />;
    }

    if (hidden) {
        return (
            <div className="card card-back bj-card-pos" style={{ '--delay': `${index * 0.1}s` }}>
                <div className="card-back-pattern" />
            </div>
        );
    }

    if (!revealed) return null; // not yet dealt in animation

    const { display, isRed } = bj.cardSymbol(card);
    const suitClass = isRed ? 'red' : 'black';

    return (
        <div
            className={`card ${suitClass} bj-card-pos ${flipped ? 'card-flip' : ''}`}
            style={{
                '--delay': '0s',
                transform: flipped ? `rotate(${(index - 1) * 4}deg)` : 'rotateY(90deg)',
                opacity: flipped ? 1 : 0,
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
function Hand({ cards, label, value, hidden = false, status = '', isMyTurn = false, revealCount = 999, splitCards, splitValue, splitStatus, playingSplit }) {
    const hasSplit = splitCards && splitCards.length > 0;
    const mainActive = isMyTurn && hasSplit && !playingSplit;
    const splitActive = isMyTurn && hasSplit && playingSplit;
    // Only show the score after all cards for this hand have been visually revealed
    const allDealt = cards.length === 0 || revealCount >= cards.length;
    return (
        <div className={`bj-hand-zone ${isMyTurn ? 'active-turn' : ''} ${status === 'bust' ? 'bust' : ''}`}>
            <div className="bj-hand-header">
                <span className="bj-hand-name">{label}</span>
                {hasSplit && <span className="bj-hand-label-tag">Main Hand</span>}
                {mainActive && <span className="bj-active-tag">ACTIVE</span>}
                <span className="bj-hand-val">
                    {hidden ? '?' : (allDealt ? value : '…')}
                    {status && allDealt && <span className={`bj-status-badge ${status}`}>{status.replace('-', ' ').toUpperCase()}</span>}
                </span>
            </div>
            <div className={`bj-cards-fan ${mainActive ? 'split-active' : ''}`}>
                {cards.length === 0 ? (
                    <>
                        <Card placeholder index={0} />
                        <Card placeholder index={1} />
                    </>
                ) : (
                    cards.map((card, i) => (
                        <Card
                            key={card.id || i}
                            card={card}
                            hidden={hidden && i === 1}
                            index={i}
                            revealed={i < revealCount}
                        />
                    ))
                )}
            </div>
            {/* Split hand display */}
            {hasSplit && (
                <div className={`bj-split-hand ${splitActive ? 'split-active' : ''}`}>
                    <div className="bj-hand-header">
                        <span className="bj-hand-name">Split Hand</span>
                        {splitActive && <span className="bj-active-tag">ACTIVE</span>}
                        <span className="bj-hand-val">
                            {splitValue}
                            {splitStatus && <span className={`bj-status-badge ${splitStatus}`}>{splitStatus.replace('-', ' ').toUpperCase()}</span>}
                        </span>
                    </div>
                    <div className="bj-cards-fan">
                        {splitCards.map((card, i) => (
                            <Card key={card.id || `s-${i}`} card={card} index={i} revealed />
                        ))}
                    </div>
                </div>
            )}
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

/* ── Progressive deal animation hook ──────────────── */
function useDealAnimation(game) {
    // Total cards to deal across all hands (players + dealer)
    const totalCards = useMemo(() => {
        if (!game || game.phase === 'betting') return 0;
        let count = 0;
        for (const p of game.players) count += p.hand.length;
        count += game.dealer.hand.length;
        return count;
    }, [game]);

    const [revealedCards, setRevealedCards] = useState(0);
    const prevPhaseRef = useRef(game?.phase);
    const dealingRef = useRef(false);

    useEffect(() => {
        const prev = prevPhaseRef.current;
        prevPhaseRef.current = game?.phase;

        // When transitioning from betting to playing/dealer, start deal animation
        if (prev === 'betting' && game?.phase && game.phase !== 'betting') {
            dealingRef.current = true;
            setRevealedCards(0);
            let count = 0;
            const timer = setInterval(() => {
                count++;
                setRevealedCards(count);
                if (count >= totalCards) {
                    clearInterval(timer);
                    dealingRef.current = false;
                }
            }, bj.DEAL_CARD_DELAY_MS);
            return () => clearInterval(timer);
        }

        // For subsequent cards (hit), reveal immediately
        if (!dealingRef.current) {
            setRevealedCards(999);
        }
    }, [game?.phase, totalCards]);

    // Also reveal immediately if we're past the initial deal
    useEffect(() => {
        if (game?.phase === 'playing' && !dealingRef.current) {
            setRevealedCards(999);
        }
    }, [totalCards]);

    return { revealedCards, isDealing: dealingRef.current };
}

/* ── Delayed result display ───────────────────────── */
function useDelayedResults(game) {
    const [showResults, setShowResults] = useState(false);
    const prevPhaseRef = useRef(game?.phase);

    useEffect(() => {
        const prev = prevPhaseRef.current;
        prevPhaseRef.current = game?.phase;

        if (game?.phase === 'ended' && prev !== 'ended') {
            setShowResults(false);
            const timer = setTimeout(() => setShowResults(true), bj.DEALER_REVEAL_DELAY_MS);
            return () => clearTimeout(timer);
        }
        if (game?.phase !== 'ended') {
            setShowResults(false);
        }
    }, [game?.phase]);

    return showResults;
}

/* ── Main Board ───────────────────────────────────── */
export default memo(function BlackjackBoard({ game, myId, myNick, wallet, onAction, onClose, onHelp, isHost, onReady, onNewRound, readyCount, totalBettors, isReady }) {
    const [selectedBet, setSelectedBet] = useState(50);
    const { revealedCards } = useDealAnimation(game);
    const showResults = useDelayedResults(game);

    if (!game) return null;

    const myPlayer = game.players.find(p => p.peer_id === myId);
    const isMyTurn = game.phase === 'playing' && game.players[game.currentPlayerIndex]?.peer_id === myId;
    const dealerValue = bj.calculateHand(game.dealer.hand);
    const balance = wallet ? (wallet.baseBalance + wallet.adminBonus) : 0;
    const deckCount = game.deckCount ?? game.deck?.length ?? 52;

    // Calculate reveal counts per hand for progressive dealing
    // Deal order: player0-card0, player1-card0, ..., dealer-card0, player0-card1, ...
    const getRevealCount = (handIndex, totalHands) => {
        // Simple: distribute revealed cards round-robin
        const perRound = totalHands;
        const fullRounds = Math.floor(revealedCards / perRound);
        const remainder = revealedCards % perRound;
        return fullRounds + (handIndex < remainder ? 1 : 0);
    };

    const totalHands = game.players.length + 1; // +1 for dealer
    const dealerRevealCount = getRevealCount(game.players.length, totalHands);

    const handleBet = () => {
        if (selectedBet > balance) return;
        onAction({ type: 'bet', amount: selectedBet });
    };

    // Split/Insurance/Double checks
    const canSplitNow = isMyTurn && bj.canSplit(game, myId);
    const canInsureNow = isMyTurn && bj.canInsure(game, myId);
    const canDoubleNow = isMyTurn && bj.canDoubleDown(game, myId);

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
                        <span className="chip-display" style={{ opacity: 0.6 }}>🃏 {deckCount}</span>
                        <Countdown game={game} />
                    </div>
                    {onHelp && <button className="btn-icon-help" onClick={onHelp} title="How to Play">?</button>}
                    <button className="btn-icon-close" onClick={onClose}>✕</button>
                </div>

                {/* ── Dealer Area ── */}
                <div className="bj-dealer-area">
                    <Hand
                        cards={game.dealer.hand}
                        label="Dealer"
                        value={dealerValue}
                        hidden={!game.dealer.revealed && game.dealer.hand.length > 0}
                        status={showResults && game.phase === 'ended' && bj.isBust(game.dealer.hand) ? 'bust' : ''}
                        revealCount={dealerRevealCount}
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
                    {game.phase === 'ended' && !showResults && <div className="bj-phase-msg">Revealing...</div>}
                    {game.phase === 'ended' && showResults && <div className="bj-phase-msg">Round complete!</div>}
                </div>

                {/* ── Players Area ── */}
                <div className="bj-players-area">
                    {game.players.map((player, idx) => (
                        <Hand
                            key={player.peer_id}
                            cards={player.hand}
                            label={`${player.nick} ${player.peer_id === myId ? '(You)' : ''}`}
                            value={player.hand.length > 0 ? bj.calculateHand(player.hand) : '-'}
                            status={showResults || game.phase === 'playing' || game.phase === 'dealer' ? player.status : ''}
                            isMyTurn={game.phase === 'playing' && idx === game.currentPlayerIndex}
                            revealCount={getRevealCount(idx, totalHands)}
                            splitCards={player.splitHand}
                            splitValue={player.splitHand ? bj.calculateHand(player.splitHand) : null}
                            splitStatus={showResults ? player.splitStatus : ''}
                            playingSplit={player.playingSplit}
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
                                    {myPlayer.bet > 0 && !isReady && (
                                        <button className="ready-btn" onClick={onReady}>Ready</button>
                                    )}
                                    {myPlayer.bet > 0 && isReady && (
                                        <span className="ready-badge">Ready</span>
                                    )}
                                </div>
                            )}
                            {totalBettors > 0 && (
                                <div className="ready-counter">{readyCount}/{totalBettors} Ready</div>
                            )}
                        </div>
                    )}

                    {game.phase === 'playing' && isMyTurn && (
                        <div className="bj-play-controls">
                            <button className="bj-btn-action hit" onClick={() => onAction({ type: 'hit' })}>Hit</button>
                            <button className="bj-btn-action stand" onClick={() => onAction({ type: 'stand' })}>Stand</button>
                            {canDoubleNow && (
                                <button className="bj-btn-action double" onClick={() => onAction({ type: 'doubleDown' })}>
                                    Double
                                </button>
                            )}
                            {canSplitNow && (
                                <button className="bj-btn-action split" onClick={() => onAction({ type: 'split' })}>
                                    Split
                                </button>
                            )}
                            {canInsureNow && (
                                <button className="bj-btn-action insure" onClick={() => onAction({ type: 'insurance' })}>
                                    Insurance
                                </button>
                            )}
                        </div>
                    )}

                    {game.phase === 'ended' && showResults && (
                        <>
                            {game.payouts && Object.keys(game.payouts).length > 0 && (
                                <div className="bj-payouts-row">
                                    {game.players.filter(p => p.bet > 0).map(p => {
                                        const net = game.payouts?.[p.peer_id] ?? 0;
                                        return (
                                            <div key={p.peer_id} className={`bj-payout-chip ${net > 0 ? 'win' : net < 0 ? 'lose' : 'push'}`}>
                                                <span>{p.nick}{p.peer_id === myId ? ' (You)' : ''}</span>
                                                <span>{net > 0 ? `+${net}` : net === 0 ? '±0' : net}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            <button className="bj-btn-primary deal" onClick={onNewRound}>
                                Next Round
                            </button>
                        </>
                    )}

                    {!myPlayer && game.phase !== 'betting' && (
                        <div className="bj-spectator-msg">Spectating... Wait for next round to join.</div>
                    )}
                </div>
            </div>
        </div>
    );
});
