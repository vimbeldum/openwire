/* ═══════════════════════════════════════════════════════════
   OpenWire — Presentation Domain: Account History
   Full ledger view — all PayoutEvents for this device.
   Fits strictly within 100dvh × 100vw.
   Long lists scroll internally (overflow-y: auto on .ah-list).
   ═══════════════════════════════════════════════════════════ */

import { useState } from 'react';
import * as ledger from '../lib/core/ledger.js';

const GAME_ICONS = {
    roulette: '🎰',
    blackjack: '♠',
    andarbahar: '🃏',
    tictactoe: '✕',
};

const GAME_LABELS = {
    roulette: 'Roulette',
    blackjack: 'Blackjack',
    andarbahar: 'Andar Bahar',
    tictactoe: 'Tic-Tac-Toe',
};

const FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'roulette', label: '🎰 Roulette' },
    { key: 'blackjack', label: '♠ Blackjack' },
    { key: 'andarbahar', label: '🃏 Andar Bahar' },
    { key: 'tictactoe', label: '✕ Tic-Tac-Toe' },
];

function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
        ' · ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function HistoryRow({ event, myId }) {
    const icon = GAME_ICONS[event.gameType] || '🎮';
    const label = GAME_LABELS[event.gameType] || event.gameType;

    if (!event.financial) {
        // TTT non-financial row — show outcome badge
        const myStat = event.playerStats?.find(p => p.peer_id === myId);
        const outcome = myStat?.outcome;
        return (
            <div className="ah-row">
                <span className="ah-row-icon">{icon}</span>
                <div className="ah-row-main">
                    <span className="ah-row-game">{label}</span>
                    <span className="ah-row-result">{event.resultLabel}</span>
                </div>
                <div className="ah-row-right">
                    {outcome && (
                        <span className={`ah-outcome-badge ${outcome}`}>
                            {outcome === 'win' ? 'Win' : outcome === 'draw' ? 'Draw' : 'Loss'}
                        </span>
                    )}
                    <span className="ah-row-time">{formatTime(event.timestamp)}</span>
                </div>
            </div>
        );
    }

    const net = event.totals?.[myId] ?? 0;
    const netClass = net > 0 ? 'win' : net < 0 ? 'loss' : 'push';
    const netLabel = net > 0 ? `+${net}` : `${net}`;

    return (
        <div className="ah-row">
            <span className="ah-row-icon">{icon}</span>
            <div className="ah-row-main">
                <span className="ah-row-game">{label}</span>
                <span className="ah-row-result">{event.resultLabel}</span>
            </div>
            <div className="ah-row-right">
                <span className={`ah-row-net ${netClass}`}>{netLabel}</span>
                <span className="ah-row-time">{formatTime(event.timestamp)}</span>
            </div>
        </div>
    );
}

function StatsBar({ deviceId, myId }) {
    const stats = ledger.getStats(deviceId, myId);
    const gameTypes = Object.keys(stats);
    if (gameTypes.length === 0) return null;

    const totalNet = Object.values(stats).reduce((s, g) => s + (g.totalNet || 0), 0);
    const totalWins = Object.values(stats).reduce((s, g) => s + g.wins, 0);
    const totalLosses = Object.values(stats).reduce((s, g) => s + g.losses, 0);

    return (
        <div className="ah-stats-bar">
            <div className="ah-stat">
                <span className="ah-stat-label">Net Chips</span>
                <span className={`ah-stat-val ${totalNet >= 0 ? 'win' : 'loss'}`}>
                    {totalNet >= 0 ? '+' : ''}{totalNet}
                </span>
            </div>
            <div className="ah-stat">
                <span className="ah-stat-label">Wins</span>
                <span className="ah-stat-val win">{totalWins}</span>
            </div>
            <div className="ah-stat">
                <span className="ah-stat-label">Losses</span>
                <span className="ah-stat-val loss">{totalLosses}</span>
            </div>
        </div>
    );
}

export default function AccountHistory({ deviceId, myId, onClose }) {
    const [filter, setFilter] = useState('all');
    const [history, setHistory] = useState(() => ledger.getHistory(deviceId));

    const filtered = filter === 'all'
        ? history
        : history.filter(e => e.gameType === filter);

    const handleClear = () => {
        ledger.clearHistory(deviceId);
        setHistory([]);
    };

    return (
        <div className="ah-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="ah-panel">
                {/* Header */}
                <div className="ah-header">
                    <span className="ah-title">📊 Account History</span>
                    <div className="ah-header-actions">
                        {history.length > 0 && (
                            <button className="ah-clear-btn" onClick={handleClear} title="Clear all history">
                                Clear
                            </button>
                        )}
                        <button className="btn-icon-close" onClick={onClose}>✕</button>
                    </div>
                </div>

                {/* Stats summary */}
                <StatsBar deviceId={deviceId} myId={myId} />

                {/* Game filter tabs */}
                <div className="ah-filters">
                    {FILTERS.map(f => (
                        <button
                            key={f.key}
                            className={`ah-filter-btn ${filter === f.key ? 'active' : ''}`}
                            onClick={() => setFilter(f.key)}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>

                {/* Scrollable list — only this area scrolls */}
                <div className="ah-list">
                    {filtered.length === 0 ? (
                        <div className="ah-empty">
                            {history.length === 0
                                ? 'No history yet — play a game to see results here.'
                                : 'No results for this filter.'}
                        </div>
                    ) : (
                        filtered.map(event => (
                            <HistoryRow key={event.id} event={event} myId={myId} />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
