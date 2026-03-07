import { useState, useEffect, useRef } from 'react';
import { getTotalHousePnl } from '../lib/casinoState.js';
import { loadStore, getCharactersDict, getGroupsDict, getGroupCharacters } from '../lib/agents/agentStore.js';
import { formatModelLabel } from '../lib/agents/openrouter.js';

const TABS = ['Players', 'Ban List', 'Activity Log', 'Stats', 'Agents'];
const CHATTER_LABELS = { 0.25: 'Quiet', 0.5: 'Calm', 1: 'Normal', 1.5: 'Active', 2: 'Chaotic' };
const GAME_LABELS = { roulette: '🎰 Roulette', blackjack: '🃏 Blackjack', andarbahar: '🎴 Andar Bahar', slots: '🎲 Slots' };

export default function AdminPortal({ peers, onKick, onBanIp, onUnbanIp, onAdjustBalance, activityLog, bannedIps, bankLedger, casinoState, swarm, swarmLogs, onClose }) {
    const [tab, setTab] = useState('Players');
    const [adjustTarget, setAdjustTarget] = useState(null);
    const [adjustAmount, setAdjustAmount] = useState(100);
    const [pnlFilter, setPnlFilter] = useState('all');

    // Dynamic store
    const [agentStore] = useState(loadStore);
    const CHARACTERS = getCharactersDict(agentStore);
    const SHOWS = getGroupsDict(agentStore);

    // Agent swarm state
    const [swarmRunning, setSwarmRunning] = useState(swarm?.running ?? false);
    const [swarmModels, setSwarmModels] = useState(swarm?.freeModels ?? []);
    const [charEnabled, setCharEnabled] = useState(() => {
        const init = {};
        Object.keys(CHARACTERS).forEach(id => { init[id] = swarm?.isCharacterEnabled(id) ?? true; });
        return init;
    });
    const [showEnabled, setShowEnabled] = useState(() => {
        const init = {};
        Object.keys(SHOWS).forEach(id => { init[id] = swarm?.isShowEnabled(id) ?? true; });
        return init;
    });
    const [overrides, setOverrides] = useState({});
    const [swarmLoading, setSwarmLoading] = useState(false);
    const [assigned, setAssigned] = useState({});
    const [chatterLevel, setChatterLevel] = useState(swarm?.chatterLevel ?? 1.0);
    const [maxMsgPerMin, setMaxMsgPerMin] = useState(swarm?.maxMsgPerMin ?? 8);
    const [showLog, setShowLog] = useState(false);
    const [charMoods, setCharMoods] = useState(() => {
        const init = {};
        Object.keys(CHARACTERS).forEach(id => { init[id] = swarm?.getMood(id) ?? 'normal'; });
        return init;
    });
    const logEndRef = useRef(null);

    useEffect(() => {
        if (!swarm) return;
        setSwarmRunning(swarm.running);
        setSwarmModels(swarm.freeModels);
        const map = {};
        Object.keys(CHARACTERS).forEach(id => { map[id] = swarm.getAssignedModel(id); });
        setAssigned(map);
        setChatterLevel(swarm.chatterLevel ?? 1.0);
        setMaxMsgPerMin(swarm.maxMsgPerMin ?? 8);
    }, [swarm]);

    // Auto-scroll log panel
    useEffect(() => {
        if (showLog && logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [swarmLogs, showLog]);

    const totalChips = peers.reduce((s, p) => s + (p.balance || 0), 0);
    const richest = peers.reduce((best, p) => (!best || (p.balance || 0) > (best.balance || 0)) ? p : best, null);

    return (
        <div className="admin-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="admin-portal">
                <div className="admin-header">
                    <div className="admin-title">
                        <span className="admin-badge">🔐 ADMIN</span>
                        <h2>OpenWire Admin Portal</h2>
                    </div>
                    <button className="bj-close" onClick={onClose}>✕</button>
                </div>

                {/* Tab bar */}
                <div className="admin-tabs">
                    {TABS.map(t => (
                        <button key={t} className={`admin-tab ${tab === t ? 'active' : ''}`}
                            onClick={() => setTab(t)}>
                            {t === 'Ban List' && bannedIps?.length > 0
                                ? `${t} (${bannedIps.length})`
                                : t}
                        </button>
                    ))}
                </div>

                {/* Players tab */}
                {tab === 'Players' && (
                    <div className="admin-content">
                        <table className="admin-table">
                            <thead>
                                <tr>
                                    <th>Nick</th>
                                    <th>Balance</th>
                                    <th>IP</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {peers.length === 0 && (
                                    <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No players online</td></tr>
                                )}
                                {peers.map(p => (
                                    <tr key={p.peer_id}>
                                        <td>
                                            <span className="peer-dot" style={{ marginRight: 6 }} />
                                            {p.nick}
                                        </td>
                                        <td>
                                            <span className="admin-chips">{(p.balance || 0).toLocaleString()} 💰</span>
                                        </td>
                                        <td>
                                            <span className="admin-ip">{p.ip || 'unknown'}</span>
                                        </td>
                                        <td className="admin-actions-cell">
                                            <button className="admin-btn kick"
                                                onClick={() => onKick(p.peer_id)}>
                                                ⚡ Kick
                                            </button>
                                            <button className="admin-btn ban"
                                                onClick={() => { if (window.confirm(`IP-ban ${p.nick}? They cannot rejoin from same IP.`)) onBanIp(p.peer_id); }}>
                                                🚫 IP Ban
                                            </button>
                                            <button className="admin-btn adjust"
                                                onClick={() => setAdjustTarget(p)}>
                                                💰 Adjust
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {/* Adjust balance modal */}
                        {adjustTarget && (
                            <div className="admin-adjust-modal">
                                <div className="admin-adjust-card">
                                    <h3>Adjust Balance — {adjustTarget.nick}</h3>
                                    <p>Current: <strong>{(adjustTarget.balance || 0).toLocaleString()}</strong> chips</p>
                                    <div className="admin-adjust-row">
                                        <input
                                            type="number"
                                            value={adjustAmount}
                                            onChange={(e) => setAdjustAmount(Number(e.target.value))}
                                            min={1}
                                            max={100000}
                                        />
                                        <button className="admin-btn adjust"
                                            onClick={() => { onAdjustBalance(adjustTarget.peer_id, adjustTarget.nick, adjustAmount); setAdjustTarget(null); }}>
                                            + Add
                                        </button>
                                        <button className="admin-btn kick"
                                            onClick={() => { onAdjustBalance(adjustTarget.peer_id, adjustTarget.nick, -adjustAmount); setAdjustTarget(null); }}>
                                            − Deduct
                                        </button>
                                        <button className="admin-btn" onClick={() => setAdjustTarget(null)}>Cancel</button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Ban List tab */}
                {tab === 'Ban List' && (
                    <div className="admin-content">
                        {bannedIps?.length === 0 && (
                            <div className="admin-empty">No banned IPs. Clean house! 🎉</div>
                        )}
                        <div className="admin-ban-list">
                            {bannedIps?.map((ip, i) => (
                                <div key={i} className="admin-ban-row">
                                    <span className="admin-ip banned">{ip}</span>
                                    <button className="admin-btn adjust"
                                        onClick={() => { if (window.confirm(`Unban ${ip}?`)) onUnbanIp(ip); }}>
                                        ✅ Unban
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Activity Log tab */}
                {tab === 'Activity Log' && (
                    <div className="admin-content">
                        <div className="admin-log">
                            {(activityLog || []).length === 0 && (
                                <div className="admin-empty">No activity yet.</div>
                            )}
                            {[...(activityLog || [])].reverse().map((entry, i) => (
                                <div key={i} className="admin-log-row">
                                    <span className="admin-log-time">{entry.time}</span>
                                    <span className="admin-log-msg">{entry.message}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Stats tab */}
                {tab === 'Stats' && (() => {
                    // Prefer casinoState.housePnl; fall back to legacy bankLedger prop
                    const pnl = casinoState?.housePnl ?? {
                        roulette: bankLedger?.roulette ?? 0,
                        blackjack: bankLedger?.blackjack ?? 0,
                        andarbahar: bankLedger?.andarbahar ?? 0,
                        slots: 0,
                    };
                    const totalPnl = casinoState
                        ? getTotalHousePnl(casinoState)
                        : Object.entries(pnl).filter(([k]) => k !== '_ts').reduce((s, [, v]) => s + v, 0);

                    const gameKeys = Object.keys(GAME_LABELS);
                    const filteredGames = pnlFilter === 'all' ? gameKeys : [pnlFilter];

                    return (
                        <div className="admin-content">
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card">
                                    <div className="admin-stat-label">Players Online</div>
                                    <div className="admin-stat-value">{peers.length}</div>
                                </div>
                                <div className="admin-stat-card">
                                    <div className="admin-stat-label">Total Chips in Play</div>
                                    <div className="admin-stat-value">{totalChips.toLocaleString()}</div>
                                </div>
                                <div className="admin-stat-card">
                                    <div className="admin-stat-label">Richest Player</div>
                                    <div className="admin-stat-value">{richest ? `${richest.nick} (${(richest.balance || 0).toLocaleString()})` : '—'}</div>
                                </div>
                                <div className="admin-stat-card">
                                    <div className="admin-stat-label">Active Bans</div>
                                    <div className="admin-stat-value">{bannedIps?.length || 0}</div>
                                </div>
                            </div>

                            {/* House P&L section */}
                            <div className="admin-pnl-header">
                                <h3 className="admin-pnl-title">🏦 House P&amp;L</h3>
                                <div className="admin-pnl-total" style={{ color: totalPnl >= 0 ? '#4caf50' : '#f44336' }}>
                                    Total: {totalPnl >= 0 ? '+' : ''}{totalPnl.toLocaleString()} chips
                                </div>
                            </div>

                            {/* Game filter */}
                            <div className="admin-pnl-filters">
                                <button
                                    className={`admin-filter-btn ${pnlFilter === 'all' ? 'active' : ''}`}
                                    onClick={() => setPnlFilter('all')}
                                >All Games</button>
                                {gameKeys.map(k => (
                                    <button
                                        key={k}
                                        className={`admin-filter-btn ${pnlFilter === k ? 'active' : ''}`}
                                        onClick={() => setPnlFilter(k)}
                                    >{GAME_LABELS[k]}</button>
                                ))}
                            </div>

                            {/* Per-game breakdown */}
                            <div className="admin-stats-grid">
                                {filteredGames.map(k => {
                                    const val = pnl[k] ?? 0;
                                    return (
                                        <div key={k} className="admin-stat-card">
                                            <div className="admin-stat-label">{GAME_LABELS[k]} Net</div>
                                            <div className="admin-stat-value" style={{ color: val >= 0 ? '#4caf50' : '#f44336' }}>
                                                {val > 0 ? '+' : ''}{val.toLocaleString()}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })()}

                {/* Agents tab */}
                {tab === 'Agents' && (
                    <div className="admin-content">
                        {/* Controls row */}
                        <div className="admin-agents-header">
                            <button
                                className={`admin-btn ${swarmRunning ? 'ban' : 'adjust'}`}
                                onClick={async () => {
                                    if (!swarm) return;
                                    if (swarmRunning) {
                                        swarm.stop();
                                        setSwarmRunning(false);
                                    } else {
                                        setSwarmLoading(true);
                                        try {
                                            await swarm.start();
                                            setSwarmRunning(true);
                                            setSwarmModels(swarm.freeModels);
                                            const map = {};
                                            Object.keys(CHARACTERS).forEach(id => { map[id] = swarm.getAssignedModel(id); });
                                            setAssigned(map);
                                        } catch (_) { /* handled by swarm onError */ }
                                        setSwarmLoading(false);
                                    }
                                }}
                                disabled={swarmLoading}
                            >
                                {swarmLoading ? '⏳ Loading…' : swarmRunning ? '⏸ Stop Swarm' : '▶ Start Swarm'}
                            </button>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>
                                {swarmModels.length > 0 ? `${swarmModels.length} free models` : 'Start swarm to load'}
                            </span>
                            <button
                                className={`admin-btn ${showLog ? 'kick' : ''}`}
                                onClick={() => setShowLog(v => !v)}
                                style={{ marginLeft: 'auto' }}
                            >
                                {showLog ? '✕ Close Log' : '🛠 God Mode'}
                            </button>
                        </div>

                        {/* Feature 5: Chatter level slider + throttle */}
                        <div className="admin-agents-controls">
                            <div className="admin-slider-group">
                                <label>Chatter Level: <strong>{
                                    Object.entries(CHATTER_LABELS).reduce((best, [k, v]) =>
                                        Math.abs(k - chatterLevel) < Math.abs(best[0] - chatterLevel) ? [k, v] : best,
                                    [1, 'Normal'])[1]
                                }</strong> ({chatterLevel.toFixed(2)}x)</label>
                                <input
                                    type="range" min="0.25" max="2" step="0.25"
                                    value={chatterLevel}
                                    onChange={e => {
                                        const v = parseFloat(e.target.value);
                                        setChatterLevel(v);
                                        swarm?.setChatterLevel(v);
                                    }}
                                />
                            </div>
                            <div className="admin-slider-group">
                                <label>Max msg/min: <strong>{maxMsgPerMin}</strong></label>
                                <input
                                    type="range" min="1" max="20" step="1"
                                    value={maxMsgPerMin}
                                    onChange={e => {
                                        const v = parseInt(e.target.value);
                                        setMaxMsgPerMin(v);
                                        swarm?.setMaxMsgPerMin(v);
                                    }}
                                />
                            </div>
                        </div>

                        {/* Feature 3: God Mode log panel */}
                        {showLog && (
                            <div className="admin-log-panel">
                                <div className="admin-log-panel-inner">
                                    {(swarmLogs || []).length === 0 && (
                                        <div style={{ color: 'var(--text-muted)', padding: '0.5rem' }}>No logs yet. Start the swarm to see activity.</div>
                                    )}
                                    {(swarmLogs || []).map((line, i) => (
                                        <div key={i} className={`admin-log-line ${
                                            line.includes('[Error]') ? 'error' :
                                            line.includes('[Throttle]') ? 'warn' :
                                            line.includes('[Message]') ? 'success' :
                                            line.includes('[CrossOver]') ? 'crossover' :
                                            line.includes('[Mood]') ? 'mood' :
                                            line.includes('[Reactivity]') ? 'reactive' : ''
                                        }`}>{line}</div>
                                    ))}
                                    <div ref={logEndRef} />
                                </div>
                            </div>
                        )}

                        {/* Character table per show */}
                        {Object.values(SHOWS).map(show => {
                            const chars = getGroupCharacters(agentStore, show.id);
                            return (
                                <div key={show.id} className="admin-agents-show">
                                    <div className="admin-agents-show-header">
                                        <span>{show.emoji} {show.name}</span>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                                            <input
                                                type="checkbox"
                                                checked={showEnabled[show.id] ?? true}
                                                onChange={e => {
                                                    swarm?.setShowEnabled(show.id, e.target.checked);
                                                    setShowEnabled(prev => ({ ...prev, [show.id]: e.target.checked }));
                                                }}
                                            />
                                            Enabled
                                        </label>
                                    </div>
                                    <table className="admin-table" style={{ marginBottom: 12 }}>
                                        <thead>
                                            <tr>
                                                <th></th>
                                                <th>Character</th>
                                                <th>Model</th>
                                                <th>Mood</th>
                                                <th>Wt</th>
                                                <th>On</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {chars.map(c => {
                                                const modelId = assigned[c.id] || '';
                                                const modelObj = swarmModels.find(m => m.id === modelId);
                                                const moods = Object.keys(c.moods || {});
                                                return (
                                                    <tr key={c.id} style={{ opacity: (charEnabled[c.id] && showEnabled[show.id]) ? 1 : 0.4 }}>
                                                        <td>{c.avatar}</td>
                                                        <td>{c.name}</td>
                                                        <td>
                                                            <select
                                                                className="admin-model-select"
                                                                value={overrides[c.id] || ''}
                                                                onChange={e => {
                                                                    const val = e.target.value || null;
                                                                    swarm?.setModelOverride(c.id, val);
                                                                    setOverrides(prev => ({ ...prev, [c.id]: val }));
                                                                }}
                                                                disabled={swarmModels.length === 0}
                                                            >
                                                                <option value="">
                                                                    {modelObj ? `Auto: ${formatModelLabel(modelObj)}` : '— Auto —'}
                                                                </option>
                                                                {swarmModels.map(m => (
                                                                    <option key={m.id} value={m.id}>
                                                                        {formatModelLabel(m)}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </td>
                                                        <td>
                                                            <select
                                                                className="admin-model-select"
                                                                value={charMoods[c.id] || 'normal'}
                                                                onChange={e => {
                                                                    swarm?.setMood(c.id, e.target.value);
                                                                    setCharMoods(prev => ({ ...prev, [c.id]: e.target.value }));
                                                                }}
                                                            >
                                                                {moods.map(m => (
                                                                    <option key={m} value={m}>{m}</option>
                                                                ))}
                                                            </select>
                                                        </td>
                                                        <td>{c.frequencyWeight}/10</td>
                                                        <td>
                                                            <input
                                                                type="checkbox"
                                                                checked={charEnabled[c.id] ?? true}
                                                                onChange={e => {
                                                                    swarm?.setCharacterEnabled(c.id, e.target.checked);
                                                                    setCharEnabled(prev => ({ ...prev, [c.id]: e.target.checked }));
                                                                }}
                                                            />
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            );
                        })}
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8em', marginTop: 8 }}>
                            Agent messages appear in General Chat only. Cross-overs and moods shift automatically based on chat context.
                        </div>
                    </div>
                )}
            </div>
        </div >
    );
}

// --- Admin Password Gate ---
export function AdminPasswordGate({ onSuccess, onCancel }) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        // Simulate slight delay for UX
        await new Promise(r => setTimeout(r, 400));

        // Use environment variable, fallback to openwire-admin for local dev if not set
        const correctPassword = import.meta.env.VITE_ADMIN_PASSWORD || 'openwire-admin';

        if (password === correctPassword) {
            onSuccess();
        } else {
            setError('Incorrect password.');
        }
        setLoading(false);
    };

    return (
        <div className="admin-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
            <div className="admin-gate-card">
                <div className="admin-gate-icon">🔐</div>
                <h2>Admin Access</h2>
                <form onSubmit={handleSubmit}>
                    <input
                        type="password"
                        placeholder="Admin password"
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); setError(''); }}
                        autoFocus
                    />
                    {error && <div className="admin-gate-error">{error}</div>}
                    <div className="admin-gate-actions">
                        <button type="submit" className="bj-btn-primary" disabled={loading}>
                            {loading ? 'Checking…' : 'Unlock'}
                        </button>
                        <button type="button" className="admin-btn" onClick={onCancel}>Cancel</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
