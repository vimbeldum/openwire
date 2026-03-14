/* ═══════════════════════════════════════════════════════════
   OpenWire — Presentation Domain: Slots Board
   Standalone single-player slot machine overlay.
   No WebSocket / P2P needed. Fits strictly within 100vh x 100vw.
   ═══════════════════════════════════════════════════════════ */

import { useState, useRef, useEffect, useCallback, memo } from 'react';
import '../styles/slots.css';
import { spinReels, calculatePayout, SLOT_PAYOUTS } from '../lib/slots.js';
import { debit, credit, getTotalBalance } from '../lib/wallet.js';

const BET_AMOUNTS = [10, 25, 50, 100, 250, 500];
const SPIN_DURATION_MS = 1500;
const INITIAL_REELS = ['🍒', '🍋', '🍊'];

/* ── Payout display rows ──────────────────────────────────── */
const PAYOUT_ROWS = Object.entries(SLOT_PAYOUTS).map(([combo, mult]) => ({
    combo,
    mult: `${mult}x`,
}));

/* ── History pip ──────────────────────────────────────────── */
function HistoryPip({ entry }) {
    const isWin = entry.net > 0;
    return (
        <span className={`slots-history-pip ${isWin ? 'win' : 'lose'}`}>
            {entry.reels.join('')}
        </span>
    );
}

/* ── Main Board ───────────────────────────────────────────── */
export default memo(function SlotsBoard({ wallet, onWalletUpdate, onClose, onHelp }) {
    const [reels, setReels] = useState(INITIAL_REELS);
    const [spinning, setSpinning] = useState(false);
    const [betAmount, setBetAmount] = useState(25);
    const [lastWin, setLastWin] = useState(null); // { net, multiplier } or null
    const [history, setHistory] = useState([]);
    const spinTimerRef = useRef(null);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
        };
    }, []);

    const balance = wallet ? getTotalBalance(wallet) : 0;

    const handleSpin = useCallback(() => {
        if (spinning || !wallet || betAmount > balance) return;

        // 1. Debit chips
        const debited = debit(wallet, betAmount, 'Slots spin');
        if (debited === wallet) return; // insufficient funds
        onWalletUpdate(debited);

        // 2. Start spinning animation
        setSpinning(true);
        setLastWin(null);

        // 3. After animation, resolve result
        spinTimerRef.current = setTimeout(() => {
            const result = spinReels();
            const net = calculatePayout(result, betAmount);

            // 4. Credit winnings if any
            if (net > 0) {
                const credited = credit(debited, net + betAmount, 'Slots win');
                onWalletUpdate(credited);
            }

            // 5. Update UI state
            setReels(result);
            setSpinning(false);
            setLastWin({
                net,
                multiplier: net > 0 ? (net + betAmount) / betAmount : 0,
            });
            setHistory(prev => {
                const next = [{ reels: result, net }, ...prev];
                return next.slice(0, 10);
            });
        }, SPIN_DURATION_MS);
    }, [spinning, wallet, betAmount, balance, onWalletUpdate]);

    // Result message
    let resultClass = 'idle';
    let resultText = 'Place your bet and spin!';
    if (lastWin !== null) {
        if (lastWin.net > 0) {
            resultClass = 'win';
            resultText = `WIN +${lastWin.net + betAmount} chips (${lastWin.multiplier}x)`;
        } else {
            resultClass = 'lose';
            resultText = `No match — ${lastWin.net} chips`;
        }
    }
    if (spinning) {
        resultClass = 'idle';
        resultText = 'Spinning...';
    }

    return (
        <div className="game-overlay" onClick={(e) => e.target === e.currentTarget && !spinning && onClose?.()}>
            <div className="slots-table">
                {/* Header */}
                <div className="game-table-header">
                    <div className="game-table-title">
                        🎰 <span>Lucky Slots</span>
                    </div>
                    <div className="game-table-meta">
                        {wallet && <span className="chip-display">💰 {balance.toLocaleString()}</span>}
                    </div>
                    {onHelp && <button className="btn-icon-help" onClick={onHelp} title="How to Play">?</button>}
                    <button className="btn-icon-close" onClick={() => !spinning && onClose?.()}>✕</button>
                </div>

                {/* Reels */}
                <div className="slots-reels">
                    {reels.map((symbol, i) => (
                        <div
                            key={i}
                            className={`slots-reel ${spinning ? 'spinning' : ''} ${lastWin?.net > 0 && !spinning ? 'win' : ''}`}
                        >
                            {symbol}
                        </div>
                    ))}
                </div>

                {/* Result */}
                <div className={`slots-result ${resultClass}`}>
                    {resultText}
                </div>

                {/* Chip Selector */}
                <div className="chip-selector">
                    {BET_AMOUNTS.map(a => (
                        <button
                            key={a}
                            className={`chip-btn ${betAmount === a ? 'active' : ''}`}
                            onClick={() => !spinning && setBetAmount(a)}
                            disabled={a > balance || spinning}
                        >
                            {a}
                        </button>
                    ))}
                </div>

                {/* Spin Button */}
                <button
                    className={`slots-spin-btn ${spinning ? 'spinning' : ''}`}
                    onClick={handleSpin}
                    disabled={spinning || betAmount > balance}
                >
                    {spinning ? 'SPINNING...' : `SPIN — ${betAmount} chips`}
                </button>

                {/* Payout Table */}
                <div className="slots-section-title">Payouts</div>
                <div className="slots-payout-table">
                    {PAYOUT_ROWS.map(({ combo, mult }) => [
                        <span className="payout-symbol" key={combo}>{combo}</span>,
                        <span className="payout-mult" key={`m-${combo}`}>{mult}</span>,
                    ])}
                </div>

                {/* History */}
                {history.length > 0 && (
                    <>
                        <div className="slots-section-title">Recent Spins</div>
                        <div className="slots-history">
                            {history.map((entry, i) => (
                                <HistoryPip key={i} entry={entry} />
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
});
