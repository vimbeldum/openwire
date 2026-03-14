/* ═══════════════════════════════════════════════════════════
   OpenWire — Presentation Domain: Tambola Board
   Standalone full-screen overlay, local single-player game.
   No WebSocket. Fits strictly within 100vh × 100vw.
   ═══════════════════════════════════════════════════════════ */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
    createInitialState,
    buyTicket,
    startGame,
    drawNumber,
    claimPrize,
    PRIZES,
} from '../lib/tambola.js';

const TICKET_PRICE = 100;
const DRAW_INTERVAL_MS = 10000;

const PRIZE_KEYS = ['earlyFive', 'topLine', 'middleLine', 'bottomLine', 'fullHouse'];

/* ── Small helpers ─────────────────────────────────────── */

// markedSet = Set of numbers the user has manually clicked to mark
function TicketGrid({ ticket, calledSet, markedSet, onMark, interactive }) {
    return (
        <table style={styles.ticketTable}>
            <tbody>
                {ticket.map((row, rIdx) => (
                    <tr key={rIdx}>
                        {row.map((cell, cIdx) => {
                            const blank = cell === 0;
                            const called = !blank && calledSet.has(cell);
                            const marked = !blank && markedSet && markedSet.has(cell);
                            return (
                                <td
                                    key={cIdx}
                                    onClick={() => interactive && called && !blank && onMark && onMark(cell)}
                                    style={{
                                        ...styles.ticketCell,
                                        background: blank
                                            ? 'rgba(255,255,255,0.04)'
                                            : marked
                                            ? 'rgba(74,222,128,0.25)'
                                            : called
                                            ? 'rgba(251,191,36,0.18)'
                                            : 'rgba(255,255,255,0.08)',
                                        color: blank ? 'transparent' : marked ? '#4ade80' : called ? '#fbbf24' : 'var(--text-primary, #e2e8f0)',
                                        fontWeight: marked || called ? '700' : '500',
                                        border: marked ? '1px solid rgba(74,222,128,0.5)' : called ? '1px solid rgba(251,191,36,0.4)' : '1px solid rgba(255,255,255,0.1)',
                                        cursor: interactive && called && !blank ? 'pointer' : 'default',
                                        position: 'relative',
                                    }}
                                    title={interactive && called && !blank ? 'Click to mark' : undefined}
                                >
                                    {blank ? '' : cell}
                                    {marked && <span style={{ position: 'absolute', top: 0, right: 2, fontSize: '0.55rem', color: '#4ade80' }}>✓</span>}
                                </td>
                            );
                        })}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function CalledBoard({ calledNumbers }) {
    const calledSet = new Set(calledNumbers);
    return (
        <div style={styles.calledBoard}>
            {Array.from({ length: 90 }, (_, i) => i + 1).map(n => (
                <div
                    key={n}
                    style={{
                        ...styles.calledCell,
                        background: calledSet.has(n)
                            ? 'rgba(251,191,36,0.3)'
                            : 'rgba(255,255,255,0.05)',
                        color: calledSet.has(n) ? '#fbbf24' : 'rgba(255,255,255,0.35)',
                        fontWeight: calledSet.has(n) ? '700' : '400',
                        border: calledSet.has(n)
                            ? '1px solid rgba(251,191,36,0.6)'
                            : '1px solid rgba(255,255,255,0.07)',
                    }}
                >
                    {n}
                </div>
            ))}
        </div>
    );
}

function Toast({ message, type }) {
    if (!message) return null;
    const bg = type === 'win'
        ? 'rgba(74,222,128,0.9)'
        : type === 'error'
        ? 'rgba(248,113,113,0.9)'
        : 'rgba(100,116,139,0.9)';
    return (
        <div style={{ ...styles.toast, background: bg }}>
            {message}
        </div>
    );
}

/* ── Main Component ────────────────────────────────────── */

export default function TambolaBoard({ myId, myNick, wallet, onClose, onWalletUpdate }) {
    const [gameState, setGameState] = useState(() => createInitialState({ ticketPrice: TICKET_PRICE }));
    const [myTickets, setMyTickets] = useState([]);
    const [phase, setPhase] = useState('lobby'); // 'lobby' | 'playing' | 'ended'
    const [lastNumber, setLastNumber] = useState(null);
    const [toast, setToast] = useState({ message: '', type: '' });
    const [claimedPrizes, setClaimedPrizes] = useState(new Set());
    const [markedNumbers, setMarkedNumbers] = useState(new Set());

    const drawRef = useRef(null);
    const toastRef = useRef(null);

    /* ── Toast helper ──────────────────────────────────── */
    const showToast = useCallback((message, type = 'info') => {
        setToast({ message, type });
        clearTimeout(toastRef.current);
        toastRef.current = setTimeout(() => setToast({ message: '', type: '' }), 2800);
    }, []);

    /* ── Auto-draw loop ────────────────────────────────── */
    useEffect(() => {
        if (phase !== 'playing') return;

        drawRef.current = setInterval(() => {
            setGameState(prev => {
                if (prev.status !== 'drawing') return prev;
                const result = drawNumber(prev, Date.now());
                if (!result.success) {
                    // All 90 drawn — end game
                    clearInterval(drawRef.current);
                    setPhase('ended');
                    return { ...result.state, status: 'ended' };
                }
                setLastNumber(result.number);
                return result.state;
            });
        }, DRAW_INTERVAL_MS);

        return () => clearInterval(drawRef.current);
    }, [phase]);

    /* ── Cleanup on unmount ────────────────────────────── */
    useEffect(() => {
        return () => {
            clearInterval(drawRef.current);
            clearTimeout(toastRef.current);
        };
    }, []);

    /* ── Actions ───────────────────────────────────────── */
    const totalChips = (wallet?.baseBalance ?? 0) + (wallet?.adminBonus ?? 0);

    function handleBuyTicket() {
        if (totalChips < TICKET_PRICE) {
            showToast('Not enough chips!', 'error');
            return;
        }
        const result = buyTicket(gameState, myId, 1);
        if (!result.success) {
            showToast(result.reason, 'error');
            return;
        }
        setGameState(result.state);
        setMyTickets(prev => [...prev, ...result.tickets]);
        onWalletUpdate(totalChips - TICKET_PRICE);
        showToast('Ticket purchased!', 'info');
    }

    function handleMark(num) {
        if (!calledSet.has(num)) return;
        setMarkedNumbers(prev => {
            const next = new Set(prev);
            next.add(num);
            return next;
        });
    }

    function handleStartGame() {
        if (myTickets.length === 0) {
            showToast('Buy at least one ticket first.', 'error');
            return;
        }
        const updated = startGame(gameState);
        setGameState(updated);
        setPhase('playing');
    }

    function handleClaim(prizeKey, ticketIdx) {
        const result = claimPrize(gameState, myId, prizeKey, ticketIdx);
        if (result.success) {
            setGameState(result.state);
            setClaimedPrizes(prev => new Set(prev).add(prizeKey));
            onWalletUpdate(totalChips + result.amount);
            showToast(`${PRIZES[prizeKey].name} — Won ${result.amount} chips!`, 'win');
            if (result.state.status === 'ended') {
                clearInterval(drawRef.current);
                setPhase('ended');
            }
        } else {
            showToast(result.reason === 'Claim pattern not complete'
                ? 'Bogus Claim!'
                : result.reason, 'error');
        }
    }

    /* ── Derived ───────────────────────────────────────── */
    const calledSet = new Set(gameState.calledNumbers);
    const allPrizesClaimed = PRIZE_KEYS.every(k => gameState.prizes[k].winner !== null);

    /* ── Render ────────────────────────────────────────── */
    return (
        <div className="game-overlay" style={styles.overlay}>
            <div className="game-card" style={styles.panel}>

                {/* Header */}
                <div style={styles.header}>
                    <span style={styles.title}>Tambola</span>
                    <div style={styles.headerRight}>
                        <span style={styles.walletBadge}>{((wallet?.baseBalance ?? 0) + (wallet?.adminBonus ?? 0)).toLocaleString()} chips</span>
                        <button
                            className="btn-icon-close"
                            onClick={() => { clearInterval(drawRef.current); onClose(); }}
                            style={styles.closeBtn}
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* Toast */}
                <Toast message={toast.message} type={toast.type} />

                {/* Scrollable content */}
                <div style={styles.body}>

                    {/* ── LOBBY ─────────────────────────── */}
                    {phase === 'lobby' && (
                        <div style={styles.section}>
                            <p style={styles.rules}>
                                90-ball Housie. Each ticket costs <strong>{TICKET_PRICE} chips</strong>.
                                Mark off numbers as they are called. Claim prizes: Early Five (5 marks),
                                Top/Middle/Bottom Line (full row), or Full House (all 15 numbers).
                            </p>

                            <div style={styles.lobbyActions}>
                                <button
                                    className="btn-primary"
                                    onClick={handleBuyTicket}
                                    disabled={totalChips < TICKET_PRICE}
                                    style={styles.actionBtn}
                                >
                                    Buy Ticket ({TICKET_PRICE} chips)
                                </button>

                                {myTickets.length > 0 && (
                                    <button
                                        className="btn-primary"
                                        onClick={handleStartGame}
                                        style={{ ...styles.actionBtn, marginTop: '0.5rem' }}
                                    >
                                        Start Game
                                    </button>
                                )}
                            </div>

                            {myTickets.length > 0 && (
                                <div style={styles.ticketSection}>
                                    <p style={styles.subheading}>Your Ticket</p>
                                    <TicketGrid ticket={myTickets[0]} calledSet={new Set()} />
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── PLAYING ───────────────────────── */}
                    {phase === 'playing' && (
                        <div style={styles.section}>
                            {/* Last called number */}
                            <div style={styles.lastNumWrapper}>
                                <span style={styles.lastNumLabel}>Last Called</span>
                                <span
                                    key={lastNumber}
                                    style={styles.lastNum}
                                    className="tambola-pop"
                                >
                                    {lastNumber ?? '—'}
                                </span>
                                <span style={styles.calledCount}>
                                    {gameState.calledNumbers.length} / 90 called
                                </span>
                            </div>

                            {/* Called numbers board — only shown once all prizes are claimed */}
                            {allPrizesClaimed && (
                                <>
                                    <p style={styles.subheading}>Called Numbers</p>
                                    <CalledBoard calledNumbers={gameState.calledNumbers} />
                                </>
                            )}

                            {/* Tickets */}
                            {myTickets.map((ticket, tIdx) => (
                                <div key={tIdx} style={styles.ticketSection}>
                                    <p style={styles.subheading}>
                                        Ticket {myTickets.length > 1 ? tIdx + 1 : ''}
                                        <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                                            — tap a yellow number to mark it
                                        </span>
                                    </p>
                                    <TicketGrid
                                        ticket={ticket}
                                        calledSet={calledSet}
                                        markedSet={markedNumbers}
                                        onMark={handleMark}
                                        interactive={true}
                                    />
                                </div>
                            ))}

                            {/* Prize claim buttons */}
                            <p style={styles.subheading}>Claim Prizes</p>
                            <div style={styles.prizeRow}>
                                {PRIZE_KEYS.map(key => {
                                    const alreadyClaimed = gameState.prizes[key].winner !== null;
                                    const mine = claimedPrizes.has(key);
                                    return (
                                        <button
                                            key={key}
                                            onClick={() => !alreadyClaimed && handleClaim(key, 0)}
                                            disabled={alreadyClaimed}
                                            style={{
                                                ...styles.prizeBtn,
                                                background: alreadyClaimed
                                                    ? mine
                                                        ? 'rgba(74,222,128,0.25)'
                                                        : 'rgba(255,255,255,0.05)'
                                                    : 'rgba(251,191,36,0.15)',
                                                borderColor: alreadyClaimed
                                                    ? mine ? '#4ade80' : 'rgba(255,255,255,0.1)'
                                                    : '#fbbf24',
                                                color: alreadyClaimed
                                                    ? mine ? '#4ade80' : 'rgba(255,255,255,0.3)'
                                                    : '#fbbf24',
                                                cursor: alreadyClaimed ? 'default' : 'pointer',
                                            }}
                                        >
                                            {PRIZES[key].name}
                                            {alreadyClaimed && (mine ? ' ✓' : ' ✗')}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* ── ENDED ─────────────────────────── */}
                    {phase === 'ended' && (
                        <div style={styles.section}>
                            <p style={styles.endTitle}>Game Over</p>
                            <p style={styles.rules}>
                                {gameState.calledNumbers.length} numbers were called.
                                Prize pool: <strong>{gameState.prizePool} chips</strong>.
                            </p>

                            <div style={styles.resultsTable}>
                                {PRIZE_KEYS.map(key => {
                                    const p = gameState.prizes[key];
                                    const won = claimedPrizes.has(key);
                                    return (
                                        <div key={key} style={styles.resultRow}>
                                            <span style={styles.resultPrize}>{PRIZES[key].name}</span>
                                            <span style={{
                                                ...styles.resultStatus,
                                                color: won ? '#4ade80' : p.winner ? '#f87171' : 'rgba(255,255,255,0.4)',
                                            }}>
                                                {won
                                                    ? `You won ${p.amount} chips`
                                                    : p.winner
                                                    ? 'Claimed by another player'
                                                    : 'Unclaimed'}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>

                            <button
                                className="btn-primary"
                                onClick={() => { clearInterval(drawRef.current); onClose(); }}
                                style={{ ...styles.actionBtn, marginTop: '1rem' }}
                            >
                                Close
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Inline keyframe for number pop animation */}
            <style>{`
                @keyframes tambola-pop {
                    0%   { transform: scale(0.6); opacity: 0.4; }
                    60%  { transform: scale(1.15); opacity: 1; }
                    100% { transform: scale(1); opacity: 1; }
                }
                .tambola-pop { animation: tambola-pop 0.45s cubic-bezier(.17,.67,.35,1.2) both; }
            `}</style>
        </div>
    );
}

/* ── Inline styles ─────────────────────────────────────── */

const styles = {
    overlay: {
        overflow: 'hidden',
    },
    panel: {
        width: 'min(560px, 96vw)',
        maxHeight: '94dvh',
        padding: '0',
        display: 'flex',
        flexDirection: 'column',
        textAlign: 'left',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.9rem 1.2rem',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
    },
    title: {
        fontSize: '1.1rem',
        fontWeight: '700',
        background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
    },
    headerRight: {
        display: 'flex',
        alignItems: 'center',
        gap: '0.6rem',
    },
    walletBadge: {
        fontSize: '0.8rem',
        color: 'rgba(255,255,255,0.55)',
        background: 'rgba(255,255,255,0.07)',
        padding: '0.2rem 0.55rem',
        borderRadius: '999px',
    },
    closeBtn: {
        background: 'none',
        border: 'none',
        color: 'rgba(255,255,255,0.5)',
        fontSize: '1rem',
        cursor: 'pointer',
        lineHeight: 1,
        padding: '0.2rem 0.4rem',
    },
    body: {
        overflowY: 'auto',
        flex: 1,
        padding: '1rem 1.2rem',
    },
    section: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
    },
    rules: {
        fontSize: '0.83rem',
        color: 'rgba(255,255,255,0.55)',
        lineHeight: 1.5,
        margin: 0,
    },
    lobbyActions: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
    },
    actionBtn: {
        width: '100%',
        padding: '0.6rem 1rem',
        fontSize: '0.9rem',
    },
    subheading: {
        fontSize: '0.75rem',
        fontWeight: '600',
        color: 'rgba(255,255,255,0.4)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        margin: '0.25rem 0 0',
    },
    ticketSection: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
    },
    ticketTable: {
        borderCollapse: 'collapse',
        width: '100%',
        tableLayout: 'fixed',
    },
    ticketCell: {
        textAlign: 'center',
        padding: '0.35rem 0',
        fontSize: '0.82rem',
        borderRadius: '3px',
        transition: 'background 0.3s, color 0.3s',
        userSelect: 'none',
    },
    lastNumWrapper: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.2rem',
        padding: '0.5rem 0',
    },
    lastNumLabel: {
        fontSize: '0.7rem',
        color: 'rgba(255,255,255,0.4)',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
    },
    lastNum: {
        fontSize: '3rem',
        fontWeight: '800',
        color: '#fbbf24',
        lineHeight: 1,
        display: 'inline-block',
    },
    calledCount: {
        fontSize: '0.75rem',
        color: 'rgba(255,255,255,0.4)',
    },
    calledBoard: {
        display: 'grid',
        gridTemplateColumns: 'repeat(10, 1fr)',
        gap: '3px',
    },
    calledCell: {
        textAlign: 'center',
        padding: '0.22rem 0',
        fontSize: '0.72rem',
        borderRadius: '3px',
        transition: 'background 0.25s, color 0.25s',
        userSelect: 'none',
    },
    prizeRow: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.5rem',
    },
    prizeBtn: {
        padding: '0.35rem 0.75rem',
        fontSize: '0.78rem',
        fontWeight: '600',
        borderRadius: '6px',
        border: '1px solid',
        background: 'none',
        transition: 'opacity 0.2s',
        letterSpacing: '0.02em',
    },
    toast: {
        position: 'sticky',
        top: 0,
        zIndex: 10,
        textAlign: 'center',
        padding: '0.45rem 1rem',
        fontSize: '0.85rem',
        fontWeight: '600',
        color: '#0f172a',
        borderRadius: '6px',
        margin: '0 -1.2rem',
        flexShrink: 0,
        pointerEvents: 'none',
    },
    endTitle: {
        fontSize: '1.3rem',
        fontWeight: '800',
        color: '#fbbf24',
        textAlign: 'center',
        margin: '0.5rem 0 0',
    },
    resultsTable: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        padding: '0.5rem 0',
    },
    resultRow: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0.35rem 0.6rem',
        background: 'rgba(255,255,255,0.04)',
        borderRadius: '6px',
    },
    resultPrize: {
        fontSize: '0.85rem',
        color: 'rgba(255,255,255,0.75)',
        fontWeight: '600',
    },
    resultStatus: {
        fontSize: '0.8rem',
        fontWeight: '500',
    },
};
