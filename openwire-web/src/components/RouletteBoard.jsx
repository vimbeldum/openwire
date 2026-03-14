import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import '../styles/roulette.css';
import * as rl from '../lib/roulette';

/* ── Constants ──────────────────────────────────── */
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// European roulette wheel order
const WHEEL_ORDER = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
    24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

function getColor(n) {
    if (n === 0) return 'green';
    return RED_NUMBERS.has(n) ? 'red' : 'black';
}

const COLORS = { red: '#CC1111', black: '#111', green: '#1A6B3C' };

/* ── Animated Roulette Wheel (CSS + SVG) ────────── */
function RouletteWheel({ spinning, result }) {
    const wheelRef = useRef(null);
    const [rotation, setRotation] = useState(0);
    const prevRotation = useRef(0);
    const lastAnimatedResult = useRef(null);

    useEffect(() => {
        if (!spinning || result === null || result === undefined) return;
        if (lastAnimatedResult.current === result) return;
        lastAnimatedResult.current = result;

        const idx = WHEEL_ORDER.indexOf(result);
        const sectorAngle = 360 / 37;
        const centerAngle = (idx + 0.5) * sectorAngle;
        const targetAngle = 360 - centerAngle;
        const spins = 5 + Math.floor(Math.random() * 3);
        const baseRot = prevRotation.current;
        const currentMod = baseRot % 360;
        let delta = targetAngle - currentMod;
        if (delta < 0) delta += 360;
        const targetRot = baseRot + (spins * 360) + delta;
        prevRotation.current = targetRot;
        setRotation(targetRot);
    }, [spinning, result]);

    const n = 37;
    const R = 48;
    const cx = 50, cy = 50;
    const angle = 360 / n;

    // Memoize sectors — 37 SVG elements with trig calculations, static data that never changes
    const sectors = useMemo(() => WHEEL_ORDER.map((num, i) => {
        const startAngle = i * angle - 90;
        const endAngle = (i + 1) * angle - 90;
        const toRad = (d) => (d * Math.PI) / 180;
        const x1 = cx + R * Math.cos(toRad(startAngle));
        const y1 = cy + R * Math.sin(toRad(startAngle));
        const x2 = cx + R * Math.cos(toRad(endAngle));
        const y2 = cy + R * Math.sin(toRad(endAngle));
        const largeArc = angle > 180 ? 1 : 0;
        const color = COLORS[getColor(num)];
        const midAngle = startAngle + angle / 2;
        const lr = R * 0.82;
        const lx = cx + lr * Math.cos(toRad(midAngle));
        const ly = cy + lr * Math.sin(toRad(midAngle));
        const textRot = midAngle + 90;

        return (
            <g key={num}>
                <path
                    d={`M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`}
                    fill={color}
                    stroke="rgba(0,0,0,0.4)"
                    strokeWidth="0.3"
                />
                <text
                    x={lx} y={ly}
                    textAnchor="middle"
                    dominantBaseline="central"
                    transform={`rotate(${textRot},${lx},${ly})`}
                    fill="white"
                    fontSize="4.5"
                    fontWeight="900"
                    fontFamily="Arial, sans-serif"
                >
                    {num}
                </text>
            </g>
        );
    }), []); // Empty deps — wheel sectors are static

    return (
        <div className={`rl-wheel-container ${spinning ? 'is-spinning' : ''}`} style={{
            transition: spinning ? 'transform 9s cubic-bezier(0.15, 0.85, 0.3, 1.0)' : 'transform 0.8s ease',
            transform: spinning ? 'scale(1.1) translateY(4px)' : 'scale(1) translateY(0)'
        }}>
            <div className="rl-pointer">▼</div>
            <div className="rl-outer-ring" />
            <svg
                ref={wheelRef}
                viewBox="0 0 100 100"
                className="rl-wheel-svg"
                style={{
                    transform: `rotate(${rotation}deg)`,
                    transition: spinning
                        ? 'transform 9s cubic-bezier(0.05, 0.9, 0.3, 1.0)'
                        : 'none',
                }}
            >
                {sectors}
                <circle cx={cx} cy={cy} r="7" fill="#1A1A1A" stroke="#FFD700" strokeWidth="1.2" />
                <circle cx={cx} cy={cy} r="3.5" fill="#FFD700" />
            </svg>
            {(spinning || game?.phase === 'results') && (
                <div className={`rl-ball${!spinning ? ' rl-ball-stopped' : ''}`} />
            )}
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
        <div className="rl-history" ref={ref}>
            {history.map((n, i) => (
                <span key={i} className={`rl-hist-chip rl-hist-${getColor(n)}`}>{n}</span>
            ))}
        </div>
    );
}

/* ── Countdown ──────────────────────────────────── */
function Countdown({ nextSpinAt, phase }) {
    const [timeLeft, setTimeLeft] = useState('');
    const [pct, setPct] = useState(100);
    const totalMs = rl.SPIN_INTERVAL_MS || 120000;

    useEffect(() => {
        if (phase !== 'betting') { setTimeLeft(''); setPct(100); return; }
        const update = () => {
            const ms = Math.max(0, nextSpinAt - Date.now());
            const s = Math.floor(ms / 1000);
            setTimeLeft(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
            setPct(Math.max(0, Math.min(100, (ms / totalMs) * 100)));
        };
        update();
        const t = setInterval(update, 500);
        return () => clearInterval(t);
    }, [nextSpinAt, phase, totalMs]);

    if (!timeLeft) return null;
    return (
        <div className="rl-countdown-wrap">
            <div className="rl-countdown-text">Next spin in <strong>{timeLeft}</strong></div>
            <div className="rl-countdown-track">
                <div className="rl-countdown-fill" style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

/* ── Number Grid Cell ───────────────────────────── */
function NumberCell({ n, selected, onBet, disabled }) {
    const color = getColor(n);
    return (
        <button
            className={`rl-cell rl-cell-${color} ${selected ? 'selected' : ''}`}
            onClick={() => !disabled && onBet('single', n)}
            disabled={disabled}
            title={`Bet on ${n}`}
        >
            {n}
        </button>
    );
}

/* ── Outside Bet Button ─────────────────────────── */
function OutsideBtn({ label, type, target, myBets, onBet, disabled, className = '' }) {
    const active = myBets.some(b => b.betType === type && b.betTarget === target);
    return (
        <button
            className={`rl-outside-btn ${active ? 'selected' : ''} ${className}`}
            onClick={() => onBet(type, target)}
            disabled={disabled}
        >
            {label}
        </button>
    );
}

const BET_AMOUNTS = [5, 10, 25, 50, 100, 250];

/* ── Main Board ─────────────────────────────────── */
export default memo(function RouletteBoard({ game, myId, myNick, wallet, onAction, onClose, onHelp, isHost, onReady, onNewRound, readyCount, totalBettors, isReady }) {
    const [betAmount, setBetAmount] = useState(25);
    const [spinning, setSpinning] = useState(false);
    const [lastMyBets, setLastMyBets] = useState([]);
    // Queued bets to place at start of next betting round (set from results phase)
    const queuedBetsRef = useRef([]);
    const [betAgainQueued, setBetAgainQueued] = useState(false);
    const onActionRef = useRef(onAction);
    const onReadyRef = useRef(onReady);
    useEffect(() => { onActionRef.current = onAction; }, [onAction]);
    useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

    const prevPhaseRef = useRef(null);
    useEffect(() => {
        if (!game) return;
        const prev = prevPhaseRef.current;
        prevPhaseRef.current = game.phase;

        if (game.phase === 'spinning' && prev !== 'spinning') {
            setSpinning(true);
            // Capture my bets before they're cleared on new round
            const myBetsNow = game.bets?.filter(b => b.peer_id === myId) || [];
            if (myBetsNow.length > 0) {
                setLastMyBets(myBetsNow);
                queuedBetsRef.current = []; // fresh bets captured, discard any stale queue
                setBetAgainQueued(false);
            }
        } else if (game.phase === 'results' && prev !== 'results') {
            setSpinning(false);
        } else if (game.phase === 'betting' && prev !== 'betting') {
            setSpinning(false);
            // Apply queued bets from results phase
            const queued = queuedBetsRef.current;
            if (queued.length > 0) {
                queuedBetsRef.current = [];
                setBetAgainQueued(false);
                setTimeout(() => {
                    onActionRef.current({ type: 'bulkBet', bets: queued.map(b => ({ betType: b.betType, betTarget: b.betTarget, amount: b.amount })) });
                    onReadyRef.current?.();
                }, 50);
            }
        }
    }, [game?.phase, myId]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!game) return null;

    const myBets = game.bets?.filter(b => b.peer_id === myId) || [];
    const totalMyBet = myBets.reduce((s, b) => s + b.amount, 0);
    const canBet = game.phase === 'betting' && wallet;
    const balance = wallet ? (wallet.baseBalance + wallet.adminBonus) : 0;
    const myPayout = game.payouts?.[myId];

    const handleBet = (type, target) => {
        if (!canBet) return;
        if (betAmount > balance - totalMyBet) return;
        onAction({ type: 'bet', betType: type, betTarget: target, amount: betAmount });
    };

    // Bet Again in betting phase: place all bets atomically + auto-ready
    const handleBetAgain = () => {
        if (!lastMyBets.length) return;
        const total = lastMyBets.reduce((s, b) => s + b.amount, 0);
        if (total > balance) return;
        onAction({ type: 'bulkBet', bets: lastMyBets.map(b => ({ betType: b.betType, betTarget: b.betTarget, amount: b.amount })) });
        if (!isReady) onReady?.();
    };

    // Double in betting phase: place doubled bets atomically + auto-ready
    const handleDouble = () => {
        if (!lastMyBets.length) return;
        const total = lastMyBets.reduce((s, b) => s + b.amount * 2, 0);
        if (total > balance) return;
        onAction({ type: 'bulkBet', bets: lastMyBets.map(b => ({ betType: b.betType, betTarget: b.betTarget, amount: b.amount * 2 })) });
        if (!isReady) onReady?.();
    };

    // Queue bets to be placed when next betting round starts (called from results phase)
    const handleQueueBetAgain = (multiplier = 1) => {
        if (!lastMyBets.length) return;
        const total = lastMyBets.reduce((s, b) => s + b.amount * multiplier, 0);
        if (total > balance) return;
        queuedBetsRef.current = lastMyBets.map(b => ({ ...b, amount: b.amount * multiplier }));
        setBetAgainQueued(true);
    };

    const resultColor = game.result === null || game.result === undefined
        ? '' : getColor(game.result);

    // 12 rows × 3 columns: each row is [col1, col2, col3]
    const rows = Array.from({ length: 12 }, (_, i) => [
        i * 3 + 1,
        i * 3 + 2,
        i * 3 + 3,
    ]);

    return (
        <div className="game-overlay" onClick={(e) => e.target === e.currentTarget && game?.phase === 'betting' && onClose?.()}>
            <div className="rl-table">

                {/* ── Header ── */}
                <div className="game-table-header">
                    <div className="game-table-title">
                        🎰 <span>Roulette</span>
                        {isHost && <span className="host-crown" title="You are driving the wheel">👑</span>}
                    </div>
                    <div className="game-table-meta">
                        {wallet && <span className="chip-display">💰 {balance.toLocaleString()}</span>}
                        <Countdown nextSpinAt={game.nextSpinAt} phase={game.phase} />
                    </div>
                    {onHelp && <button className="btn-icon-help" onClick={onHelp} title="How to Play">?</button>}
                    <button className="btn-icon-close" onClick={onClose}>✕</button>
                </div>

                {/* ── Two-Column Body ── */}
                <div className="rl-body">

                    {/* Left Column: Wheel + Info + History + Live Bets + Payouts */}
                    <div className="rl-left-col">
                        <div className="rl-wheel-section">
                            <RouletteWheel spinning={spinning} result={game.result} />
                            <div className="rl-wheel-info">
                                {game.phase === 'spinning' && (
                                    <div className="rl-spinning-text">Spinning…</div>
                                )}
                                {game.phase === 'results' && game.result !== null && (
                                    <div className={`rl-result-badge rl-result-${getColor(game.result)}`}>
                                        <span className="rl-result-num">{game.result}</span>
                                        <span className="rl-result-label">
                                            {resultColor === 'green' ? '🟢 Zero' : resultColor === 'red' ? '🔴 Red' : '⚫ Black'}
                                            {game.result > 0 ? (game.result % 2 === 0 ? ' · Even' : ' · Odd') : ''}
                                        </span>
                                    </div>
                                )}
                                {game.phase === 'results' && myPayout !== undefined && (
                                    <div className={`rl-payout-result ${myPayout >= 0 ? 'win' : 'lose'}`}>
                                        {myPayout > 0 ? `+${myPayout}` : myPayout} chips
                                    </div>
                                )}
                            </div>
                        </div>

                        <HistoryStrip history={game.spinHistory} />

                        {game.bets?.length > 0 && (
                            <div className="rl-all-bets">
                                <div className="section-mini-title">Live bets</div>
                                <div className="rl-bets-list">
                                    {game.bets.map((b, i) => (
                                        <span key={i} className="rl-bet-tag">
                                            {b.nick}: {b.betType === 'single' ? `#${b.betTarget}` : b.betTarget} — {b.amount}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {game.phase === 'results' && game.payouts && (
                            <div className="rl-results">
                                <div className="rl-payouts-list">
                                    {Object.entries(game.payouts).map(([pid, net]) => {
                                        const player = game.bets.find(b => b.peer_id === pid);
                                        return (
                                            <div key={pid} className={`rl-payout-row ${net >= 0 ? 'win' : 'lose'}`}>
                                                <span>{player?.nick || pid.slice(0, 8)}</span>
                                                <span>{net >= 0 ? `+${net}` : net} chips</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right Column: Betting Area */}
                    <div className="rl-right-col">
                        <div className="rl-betting-area">

                            {/* Bet Again / Double from last round */}
                            {game.phase === 'betting' && lastMyBets.length > 0 && myBets.length === 0 && (
                                <div className="quick-bet-row">
                                    <button className="quick-bet-btn repeat" onClick={handleBetAgain} disabled={lastMyBets.reduce((s,b) => s+b.amount,0) > balance}>
                                        <span className="quick-bet-icon">↺</span>
                                        <span className="quick-bet-label">Bet Again</span>
                                        <span className="quick-bet-amount">{lastMyBets.reduce((s,b) => s+b.amount,0)} chips</span>
                                    </button>
                                    <button className="quick-bet-btn double" onClick={handleDouble} disabled={lastMyBets.reduce((s,b) => s+b.amount*2,0) > balance}>
                                        <span className="quick-bet-icon">×2</span>
                                        <span className="quick-bet-label">Double</span>
                                        <span className="quick-bet-amount">{lastMyBets.reduce((s,b) => s+b.amount*2,0)} chips</span>
                                    </button>
                                </div>
                            )}

                            {/* Chip selector */}
                            <div className="chip-selector">
                                {BET_AMOUNTS.map(a => (
                                    <button
                                        key={a}
                                        className={`chip-btn ${betAmount === a ? 'active' : ''}`}
                                        onClick={() => setBetAmount(a)}
                                        disabled={a > balance}
                                    >
                                        {a}
                                    </button>
                                ))}
                            </div>

                            {/* Number grid */}
                            <div className="rl-grid-vertical">

                                {/* Zero */}
                                <div className="rl-zero-row">
                                    <button
                                        className={`rl-zero-vert ${myBets.some(b => b.betType === 'single' && b.betTarget === 0) ? 'selected' : ''}`}
                                        onClick={() => handleBet('single', 0)}
                                        disabled={!canBet}
                                    >
                                        0
                                    </button>
                                </div>

                                {/* Numbers 1–36 */}
                                <div className="rl-numbers-grid">
                                    {rows.map((row, ri) => (
                                        <div key={ri} className="rl-grid-row">
                                            {row.map(n => (
                                                <NumberCell
                                                    key={n} n={n}
                                                    selected={myBets.some(b => b.betType === 'single' && b.betTarget === n)}
                                                    onBet={handleBet}
                                                    disabled={!canBet}
                                                />
                                            ))}
                                        </div>
                                    ))}
                                </div>

                                {/* Column 2:1 */}
                                <div className="rl-col-bets-row">
                                    {[1, 2, 3].map(c => (
                                        <OutsideBtn key={c} label="2:1" type="column" target={c} myBets={myBets} onBet={handleBet} disabled={!canBet} className="sm" />
                                    ))}
                                </div>

                                {/* Dozens */}
                                <div className="rl-grid-row">
                                    <OutsideBtn label="1st 12" type="dozen" target={1} myBets={myBets} onBet={handleBet} disabled={!canBet} className="sm" />
                                    <OutsideBtn label="2nd 12" type="dozen" target={2} myBets={myBets} onBet={handleBet} disabled={!canBet} className="sm" />
                                    <OutsideBtn label="3rd 12" type="dozen" target={3} myBets={myBets} onBet={handleBet} disabled={!canBet} className="sm" />
                                </div>

                                {/* Low / Even / Red */}
                                <div className="rl-grid-row">
                                    <OutsideBtn label="1–18" type="half" target="low" myBets={myBets} onBet={handleBet} disabled={!canBet} />
                                    <OutsideBtn label="Even" type="parity" target="even" myBets={myBets} onBet={handleBet} disabled={!canBet} />
                                    <OutsideBtn label="🔴 Red" type="color" target="red" myBets={myBets} onBet={handleBet} disabled={!canBet} className="red" />
                                </div>

                                {/* Black / Odd / High */}
                                <div className="rl-grid-row">
                                    <OutsideBtn label="⚫ Black" type="color" target="black" myBets={myBets} onBet={handleBet} disabled={!canBet} className="black" />
                                    <OutsideBtn label="Odd" type="parity" target="odd" myBets={myBets} onBet={handleBet} disabled={!canBet} />
                                    <OutsideBtn label="19–36" type="half" target="high" myBets={myBets} onBet={handleBet} disabled={!canBet} />
                                </div>

                            </div>

                            {/* My bets summary */}
                            {myBets.length > 0 && (
                                <div className="rl-my-bets">
                                    <span>{myBets.length} bet{myBets.length > 1 ? 's' : ''} · {totalMyBet} chips</span>
                                    {canBet && <button className="rl-clear-btn" onClick={() => onAction({ type: 'clearBets' })}>Clear</button>}
                                    {canBet && !isReady && (
                                        <button className="ready-btn" onClick={onReady}>Ready</button>
                                    )}
                                    {canBet && isReady && (
                                        <span className="ready-badge">Ready</span>
                                    )}
                                </div>
                            )}
                            {totalBettors > 0 && game.phase === 'betting' && (
                                <div className="ready-counter">{readyCount}/{totalBettors} Ready</div>
                            )}
                            {game.phase === 'results' && (
                                <div className="rl-new-round-row">
                                    {betAgainQueued && <span className="rl-queued-badge">Bets queued ✓</span>}
                                    <button className="ready-btn" onClick={onNewRound}>Next Round</button>
                                </div>
                            )}

                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
});
