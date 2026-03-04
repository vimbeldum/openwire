import { useState, useEffect, useRef, useCallback } from 'react';
import * as rl from '../lib/roulette';

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const ALL_NUMBERS = Array.from({ length: 37 }, (_, i) => i);

function NumberCell({ n, selected, onBet, disabled }) {
    const color = n === 0 ? 'green' : RED_NUMBERS.has(n) ? 'red' : 'black';
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

function HistoryStrip({ history }) {
    const ref = useRef(null);
    useEffect(() => {
        if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth;
    }, [history]);

    if (!history || history.length === 0) return null;
    return (
        <div className="rl-history" ref={ref}>
            {history.map((n, i) => {
                const color = n === 0 ? 'green' : RED_NUMBERS.has(n) ? 'red' : 'black';
                return (
                    <span key={i} className={`rl-hist-chip rl-hist-${color}`}>{n}</span>
                );
            })}
        </div>
    );
}

function Countdown({ nextSpinAt, phase }) {
    const [timeLeft, setTimeLeft] = useState('');

    useEffect(() => {
        if (phase !== 'betting') { setTimeLeft(''); return; }
        const update = () => {
            const ms = Math.max(0, nextSpinAt - Date.now());
            const s = Math.floor(ms / 1000);
            setTimeLeft(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
        };
        update();
        const t = setInterval(update, 500);
        return () => clearInterval(t);
    }, [nextSpinAt, phase]);

    if (!timeLeft) return null;
    return <div className="rl-countdown">⏱ Next spin in <strong>{timeLeft}</strong></div>;
}

export default function RouletteBoard({ game, myId, myNick, wallet, onAction, onClose, isHost }) {
    const [selectedBetType, setSelectedBetType] = useState('color');
    const [selectedTarget, setSelectedTarget] = useState('red');
    const [betAmount, setBetAmount] = useState(25);
    const [spinning, setSpinning] = useState(false);
    const [lastResult, setLastResult] = useState(null);
    const wheelRef = useRef(null);

    useEffect(() => {
        if (game?.phase === 'spinning' || (game?.phase === 'results' && game.result !== null)) {
            setSpinning(true);
            setLastResult(game.result);
            const t = setTimeout(() => setSpinning(false), 3000);
            return () => clearTimeout(t);
        }
    }, [game?.phase, game?.result]);

    if (!game) return null;

    const myBets = game.bets?.filter(b => b.peer_id === myId) || [];
    const totalMyBet = myBets.reduce((s, b) => s + b.amount, 0);
    const canBet = game.phase === 'betting' && wallet;
    const balance = wallet ? (wallet.baseBalance + wallet.adminBonus) : 0;

    const handleBet = (type, target) => {
        if (!canBet) return;
        if (betAmount > balance - totalMyBet) return;
        onAction({ type: 'bet', betType: type, betTarget: target, amount: betAmount });
    };

    const handleClearBets = () => onAction({ type: 'clearBets' });

    const resultColor = lastResult === null ? '' : lastResult === 0 ? 'green' : RED_NUMBERS.has(lastResult) ? 'red' : 'black';
    const myPayout = game.payouts?.[myId];

    // Column layout for the 3-column betting grid
    const col1 = [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36];
    const col2 = [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35];
    const col3 = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34];

    return (
        <div className="game-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
            <div className="rl-table">
                <div className="rl-header">
                    <div className="rl-header-left">
                        <h2>🎰 Roulette</h2>
                        {isHost && <span className="rl-host-badge">Host</span>}
                    </div>
                    <div className="rl-header-center">
                        {wallet && (
                            <span className="rl-balance">
                                💰 {balance.toLocaleString()} chips
                            </span>
                        )}
                    </div>
                    <button className="bj-close" onClick={onClose}>✕</button>
                </div>

                {/* Wheel + countdown */}
                <div className="rl-wheel-section">
                    <div className={`rl-wheel ${spinning ? 'spinning' : ''}`} ref={wheelRef}>
                        <div className="rl-wheel-inner">
                            {game.phase === 'results' && lastResult !== null ? (
                                <div className={`rl-result-number rl-result-${resultColor}`}>
                                    {lastResult}
                                </div>
                            ) : (
                                <div className="rl-wheel-idle">🎰</div>
                            )}
                        </div>
                    </div>
                    <div className="rl-wheel-info">
                        <Countdown nextSpinAt={game.nextSpinAt} phase={game.phase} />
                        {game.phase === 'spinning' && <div className="rl-spinning-text">Spinning…</div>}
                        {game.phase === 'results' && myPayout !== undefined && (
                            <div className={`rl-payout-result ${myPayout >= 0 ? 'win' : 'lose'}`}>
                                {myPayout >= 0 ? `+${myPayout}` : myPayout} chips
                            </div>
                        )}
                    </div>
                </div>

                {/* History strip */}
                <HistoryStrip history={game.spinHistory} />

                {/* Betting area */}
                <div className="rl-betting-area">
                    {/* Number grid */}
                    <div className="rl-grid-wrap">
                        <button
                            className={`rl-zero ${myBets.some(b => b.betType === 'single' && b.betTarget === 0) ? 'selected' : ''}`}
                            onClick={() => handleBet('single', 0)}
                            disabled={!canBet}
                        >0</button>
                        <div className="rl-grid">
                            {col1.map(n => (
                                <NumberCell key={n} n={n}
                                    selected={myBets.some(b => b.betType === 'single' && b.betTarget === n)}
                                    onBet={handleBet} disabled={!canBet} />
                            ))}
                            {col2.map(n => (
                                <NumberCell key={n} n={n}
                                    selected={myBets.some(b => b.betType === 'single' && b.betTarget === n)}
                                    onBet={handleBet} disabled={!canBet} />
                            ))}
                            {col3.map(n => (
                                <NumberCell key={n} n={n}
                                    selected={myBets.some(b => b.betType === 'single' && b.betTarget === n)}
                                    onBet={handleBet} disabled={!canBet} />
                            ))}
                        </div>

                        {/* Column bets */}
                        <div className="rl-col-bets">
                            {[1, 2, 3].map(c => (
                                <button key={c} className={`rl-outside-btn sm ${myBets.some(b => b.betType === 'column' && b.betTarget === c) ? 'selected' : ''}`}
                                    onClick={() => handleBet('column', c)} disabled={!canBet}>
                                    Col {c} (2:1)
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Outside bets */}
                    <div className="rl-outside-bets">
                        <div className="rl-outside-row">
                            {['low', 'high'].map(h => (
                                <button key={h} className={`rl-outside-btn ${myBets.some(b => b.betType === 'half' && b.betTarget === h) ? 'selected' : ''}`}
                                    onClick={() => handleBet('half', h)} disabled={!canBet}>
                                    {h === 'low' ? '1–18' : '19–36'}
                                </button>
                            ))}
                        </div>
                        <div className="rl-outside-row">
                            {['even', 'odd'].map(p => (
                                <button key={p} className={`rl-outside-btn ${myBets.some(b => b.betType === 'parity' && b.betTarget === p) ? 'selected' : ''}`}
                                    onClick={() => handleBet('parity', p)} disabled={!canBet}>
                                    {p.charAt(0).toUpperCase() + p.slice(1)}
                                </button>
                            ))}
                        </div>
                        <div className="rl-outside-row">
                            <button className={`rl-outside-btn red ${myBets.some(b => b.betType === 'color' && b.betTarget === 'red') ? 'selected' : ''}`}
                                onClick={() => handleBet('color', 'red')} disabled={!canBet}>
                                🔴 Red
                            </button>
                            <button className={`rl-outside-btn black ${myBets.some(b => b.betType === 'color' && b.betTarget === 'black') ? 'selected' : ''}`}
                                onClick={() => handleBet('color', 'black')} disabled={!canBet}>
                                ⚫ Black
                            </button>
                        </div>
                        <div className="rl-outside-row">
                            {[1, 2, 3].map(d => (
                                <button key={d} className={`rl-outside-btn sm ${myBets.some(b => b.betType === 'dozen' && b.betTarget === d) ? 'selected' : ''}`}
                                    onClick={() => handleBet('dozen', d)} disabled={!canBet}>
                                    {d}st 12 (2:1)
                                </button>
                            ))}
                        </div>

                        {/* Bet amount selector */}
                        <div className="rl-bet-amounts">
                            {[5, 10, 25, 50, 100, 250].map(a => (
                                <button key={a} className={`rl-chip-btn ${betAmount === a ? 'active' : ''}`}
                                    onClick={() => setBetAmount(a)}>
                                    {a}
                                </button>
                            ))}
                        </div>

                        {/* Current bets summary */}
                        {myBets.length > 0 && (
                            <div className="rl-my-bets">
                                <span>Your bets: {myBets.length} (total: {totalMyBet} chips)</span>
                                {canBet && (
                                    <button className="rl-clear-btn" onClick={handleClearBets}>Clear</button>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* All players bets */}
                {game.bets?.length > 0 && game.phase === 'betting' && (
                    <div className="rl-all-bets">
                        <div className="rl-section-title">Live Bets</div>
                        <div className="rl-bets-list">
                            {game.bets.map((b, i) => (
                                <span key={i} className="rl-bet-tag">
                                    {b.nick}: {b.betType === 'single' ? `#${b.betTarget}` : b.betTarget} — {b.amount}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Results breakdown */}
                {game.phase === 'results' && game.payouts && (
                    <div className="rl-results">
                        <div className={`rl-result-display rl-result-${resultColor}`}>
                            🎯 Result: <strong>{game.result}</strong>
                            <span className="rl-result-label">
                                {resultColor === 'green' ? '🟢 Zero' : resultColor === 'red' ? '🔴 Red' : '⚫ Black'}
                                {game.result > 0 ? (game.result % 2 === 0 ? ' · Even' : ' · Odd') : ''}
                            </span>
                        </div>
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
        </div>
    );
}
