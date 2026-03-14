import { useState, useEffect, useRef, memo } from 'react';
import '../styles/admin.css';
import { getTotalHousePnl } from '../lib/casinoState.js';
import { getMinKarmaToPost, setMinKarmaToPost } from '../lib/deaddrops.js';
import { loadStore, getCharactersDict, getGroupsDict, getGroupCharacters } from '../lib/agents/agentStore.js';
import { formatModelLabel } from '../lib/agents/openrouter.js';
import { formatGeminiLabel } from '../lib/agents/gemini.js';
import { formatQwenLabel } from '../lib/agents/qwen.js';
import { formatHaimakerLabel } from '../lib/agents/haimaker.js';

const TABS = ['Players', 'Ban List', 'Activity Log', 'Stats', 'Agents'];

// Country code → flag emoji (e.g. "US" → "🇺🇸")
function countryFlag(code) {
    if (!code || code.length !== 2) return '';
    return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

// Extract short browser name from User-Agent
function parseBrowser(ua) {
    if (!ua) return '';
    if (ua.includes('Firefox/')) return 'Firefox';
    if (ua.includes('Edg/')) return 'Edge';
    if (ua.includes('OPR/') || ua.includes('Opera')) return 'Opera';
    if (ua.includes('Chrome/')) return 'Chrome';
    if (ua.includes('Safari/') && !ua.includes('Chrome')) return 'Safari';
    return '';
}
const CHATTER_LABELS = { 0.25: 'Quiet', 0.5: 'Calm', 1: 'Normal', 1.5: 'Active', 2: 'Chaotic' };
const GAME_LABELS = { roulette: '🎰 Roulette', blackjack: '🃏 Blackjack', andarbahar: '🎴 Andar Bahar', slots: '🎲 Slots' };

function AdminPortal({ peers, onKick, onBanIp, onUnbanIp, onAdjustBalance, onAdjustKarma, activityLog, bannedIps, bankLedger, casinoState, swarm, swarmLogs, onProviderChange, onSettingChange, onClose }) {
    const [tab, setTab] = useState('Players');
    const [ddMinKarma, setDdMinKarma] = useState(getMinKarmaToPost);
    const [adjustTarget, setAdjustTarget] = useState(null);
    const [adjustAmount, setAdjustAmount] = useState(100);
    const [adjustKarmaAmount, setAdjustKarmaAmount] = useState(10);
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
    const [defaultModel, setDefaultModel] = useState(swarm?.defaultModel ?? 'openrouter/auto');
    const [perCharCooldown, setPerCharCooldown] = useState(swarm?.perCharCooldown ?? 10);
    const [globalCooldown, setGlobalCooldown] = useState(swarm?.globalCooldown ?? 5);
    const [provider, setProvider] = useState(swarm?.provider ?? 'openrouter');
    const [geminiModels, setGeminiModels] = useState(swarm?.geminiModels ?? []);
    const [geminiLoading, setGeminiLoading] = useState(false);
    const [qwenModels, setQwenModels] = useState(swarm?.qwenModels ?? []);
    const [qwenLoading, setQwenLoading] = useState(false);
    const [haimakerModels, setHaimakerModels] = useState(swarm?.haimakerModels ?? []);
    const [haimakerLoading, setHaimakerLoading] = useState(false);
    const [mentionOnlyMode, setMentionOnlyMode] = useState(swarm?.mentionOnlyMode ?? false);
    const [statsDebug, setStatsDebug] = useState(swarm?.statsDebug ?? false);
    const [aiStats, setAiStats] = useState(null);
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

    // Poll AI stats when debug is enabled
    useEffect(() => {
        if (!statsDebug || !swarm) { setAiStats(null); return; }
        const tick = () => setAiStats({ ...swarm.stats, queueLength: swarm.queueLength, queue: swarm.queueContents || [] });
        tick();
        const id = setInterval(tick, 2000);
        return () => clearInterval(id);
    }, [statsDebug, swarm]);

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
                                    <th>Location</th>
                                    <th>Network</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {peers.length === 0 && (
                                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No players online</td></tr>
                                )}
                                {peers.map(p => {
                                    const geo = p.geo || {};
                                    const flag = geo.country ? countryFlag(geo.country) : '';
                                    const loc = [geo.city, geo.region, geo.country].filter(Boolean).join(', ') || '—';
                                    const isMobile = /Mobile|Android|iPhone/i.test(geo.userAgent || '');
                                    const browser = parseBrowser(geo.userAgent || '');
                                    return (
                                    <tr key={p.peer_id}>
                                        <td>
                                            <span className="peer-dot" style={{ marginRight: 6 }} />
                                            {p.nick}
                                            {p.is_admin && <span className="admin-badge-sm" title="Admin">A</span>}
                                            <span className="admin-device-icon" title={isMobile ? 'Mobile' : 'Desktop'}>{isMobile ? '📱' : '💻'}</span>
                                        </td>
                                        <td>
                                            <span className="admin-chips">{(p.balance || 0).toLocaleString()} 💰</span>
                                        </td>
                                        <td>
                                            <div className="admin-geo">
                                                <span className="admin-geo-flag">{flag}</span>
                                                <span className="admin-geo-loc">{loc}</span>
                                                {geo.timezone && <span className="admin-geo-tz">{geo.timezone}</span>}
                                            </div>
                                        </td>
                                        <td>
                                            <div className="admin-net">
                                                <span className="admin-ip">{p.ip || '—'}</span>
                                                {geo.asOrganization && <span className="admin-isp">{geo.asOrganization}</span>}
                                                {browser && <span className="admin-browser">{browser}</span>}
                                            </div>
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
                                    );
                                })}
                            </tbody>
                        </table>

                        {/* Adjust balance modal */}
                        {adjustTarget && (
                            <div className="admin-adjust-modal">
                                <div className="admin-adjust-card">
                                    <h3>Adjust — {adjustTarget.nick}</h3>
                                    <p>Chips: <strong>{(adjustTarget.balance || 0).toLocaleString()}</strong></p>
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
                                            + Chips
                                        </button>
                                        <button className="admin-btn kick"
                                            onClick={() => { onAdjustBalance(adjustTarget.peer_id, adjustTarget.nick, -adjustAmount); setAdjustTarget(null); }}>
                                            − Chips
                                        </button>
                                    </div>
                                    <div className="admin-adjust-row" style={{ marginTop: '0.5rem' }}>
                                        <input
                                            type="number"
                                            value={adjustKarmaAmount}
                                            onChange={(e) => setAdjustKarmaAmount(Number(e.target.value))}
                                            min={1}
                                            max={1000}
                                        />
                                        <button className="admin-btn adjust"
                                            onClick={() => { onAdjustKarma?.(adjustTarget.peer_id, adjustTarget.nick, adjustKarmaAmount); setAdjustTarget(null); }}>
                                            ⭐ + Karma
                                        </button>
                                        <button className="admin-btn kick"
                                            onClick={() => { onAdjustKarma?.(adjustTarget.peer_id, adjustTarget.nick, -adjustKarmaAmount); setAdjustTarget(null); }}>
                                            ⭐ − Karma
                                        </button>
                                    </div>
                                    <button className="admin-btn" style={{ marginTop: '0.5rem' }} onClick={() => setAdjustTarget(null)}>Cancel</button>
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
                            {/* ── Settings ── */}
                            <h3 className="admin-section-title">Settings</h3>
                            <div className="admin-settings-row">
                                <label className="admin-setting-label">
                                    Dead Drops — Min Karma to Post
                                </label>
                                <div className="admin-setting-control">
                                    <input
                                        type="range" min={0} max={100} step={5}
                                        value={ddMinKarma}
                                        onChange={(e) => {
                                            const val = Number(e.target.value);
                                            setDdMinKarma(val);
                                            setMinKarmaToPost(val);
                                            onSettingChange?.('dead_drop_min_karma', val);
                                        }}
                                    />
                                    <span className="admin-setting-value">{ddMinKarma}</span>
                                </div>
                            </div>

                            <h3 className="admin-section-title" style={{ marginTop: '1.5rem' }}>Dashboard</h3>
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
                                <label>Max msg/min:</label>
                                <input
                                    type="number" min="1" max="999"
                                    value={maxMsgPerMin}
                                    onChange={e => {
                                        const v = Math.max(1, parseInt(e.target.value) || 1);
                                        setMaxMsgPerMin(v);
                                        swarm?.setMaxMsgPerMin(v);
                                    }}
                                    style={{ width: 70, padding: '4px 8px', background: 'var(--bg-primary, #111)', color: 'var(--text, #ccc)', border: '1px solid var(--border, #333)', borderRadius: 4 }}
                                />
                            </div>
                        </div>

                        {/* AI Cooldown controls */}
                        <div className="admin-agents-controls" style={{ marginTop: 0 }}>
                            <div className="admin-slider-group">
                                <label>Per-character cooldown (s):</label>
                                <input
                                    type="number" min="1" max="120"
                                    value={perCharCooldown}
                                    onChange={e => {
                                        const v = Math.max(1, parseInt(e.target.value) || 1);
                                        setPerCharCooldown(v);
                                        swarm?.setPerCharCooldown(v);
                                    }}
                                    style={{ width: 70, padding: '4px 8px', background: 'var(--bg-primary, #111)', color: 'var(--text, #ccc)', border: '1px solid var(--border, #333)', borderRadius: 4 }}
                                />
                            </div>
                            <div className="admin-slider-group">
                                <label>Global AI cooldown (s):</label>
                                <input
                                    type="number" min="1" max="120"
                                    value={globalCooldown}
                                    onChange={e => {
                                        const v = Math.max(1, parseInt(e.target.value) || 1);
                                        setGlobalCooldown(v);
                                        swarm?.setGlobalCooldown(v);
                                    }}
                                    style={{ width: 70, padding: '4px 8px', background: 'var(--bg-primary, #111)', color: 'var(--text, #ccc)', border: '1px solid var(--border, #333)', borderRadius: 4 }}
                                />
                            </div>
                        </div>

                        {/* Mention-only mode toggle */}
                        <div className="admin-agents-controls" style={{ marginTop: 0 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
                                <input
                                    type="checkbox"
                                    checked={mentionOnlyMode}
                                    onChange={e => {
                                        const on = e.target.checked;
                                        setMentionOnlyMode(on);
                                        swarm?.setMentionOnlyMode(on);
                                    }}
                                />
                                Mention-only mode (AI speaks only when @tagged, active 4 min)
                            </label>
                        </div>

                        {/* AI Stats debug toggle */}
                        <div className="admin-agents-controls" style={{ marginTop: 0 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
                                <input
                                    type="checkbox"
                                    checked={statsDebug}
                                    onChange={e => {
                                        const on = e.target.checked;
                                        setStatsDebug(on);
                                        swarm?.setStatsDebug(on);
                                    }}
                                />
                                AI Stats (debug — tracks generation timing, queue, TPS)
                            </label>
                        </div>

                        {/* AI Stats panel (only when debug enabled) */}
                        {statsDebug && aiStats && (() => {
                            const avgMs = aiStats.totalGenerations > 0
                                ? Math.round(aiStats.totalTimeMs / aiStats.totalGenerations) : 0;
                            const avgTps = aiStats.totalGenerations > 0 && aiStats.totalTimeMs > 0
                                ? +(aiStats.totalTokensEstimated / (aiStats.totalTimeMs / 1000)).toFixed(1) : 0;
                            const recent = aiStats.generations || [];
                            const last5 = recent.slice(-5).reverse();
                            const byChar = Object.values(aiStats.byCharacter || {})
                                .sort((a, b) => b.count - a.count).slice(0, 10);
                            const queueNames = (aiStats.queue || []).map(id => CHARACTERS[id]?.name || id);
                            return (
                                <div style={{ background: 'var(--bg-secondary, #1a1a2e)', border: '1px solid var(--border, #333)', borderRadius: 8, padding: 12, marginBottom: 8 }}>
                                    <div style={{ fontSize: '0.9em', fontWeight: 600, marginBottom: 8, color: 'var(--text, #ccc)' }}>AI Generation Stats</div>
                                    <div className="admin-stats-grid">
                                        <div className="admin-stat-card">
                                            <div className="admin-stat-label">Total Generations</div>
                                            <div className="admin-stat-value">{aiStats.totalGenerations}</div>
                                        </div>
                                        <div className="admin-stat-card">
                                            <div className="admin-stat-label">Avg Time</div>
                                            <div className="admin-stat-value">{avgMs > 1000 ? `${(avgMs/1000).toFixed(1)}s` : `${avgMs}ms`}</div>
                                        </div>
                                        <div className="admin-stat-card">
                                            <div className="admin-stat-label">Avg TPS</div>
                                            <div className="admin-stat-value">{avgTps}</div>
                                        </div>
                                        <div className="admin-stat-card">
                                            <div className="admin-stat-label">Queue</div>
                                            <div className="admin-stat-value">{aiStats.queueLength || 0}</div>
                                        </div>
                                        <div className="admin-stat-card">
                                            <div className="admin-stat-label">Est. Tokens</div>
                                            <div className="admin-stat-value">{aiStats.totalTokensEstimated}</div>
                                        </div>
                                        <div className="admin-stat-card">
                                            <div className="admin-stat-label">429s / Errors</div>
                                            <div className="admin-stat-value" style={{ color: (aiStats.rateLimitHits + aiStats.errors) > 0 ? '#f44336' : '#4caf50' }}>
                                                {aiStats.rateLimitHits} / {aiStats.errors}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Queue contents */}
                                    {queueNames.length > 0 && (
                                        <div style={{ marginTop: 8, fontSize: '0.8em', color: 'var(--text-muted)' }}>
                                            <strong>Queue:</strong> {queueNames.join(' → ')}
                                        </div>
                                    )}

                                    {/* Recent generations */}
                                    {last5.length > 0 && (
                                        <div style={{ marginTop: 8 }}>
                                            <div style={{ fontSize: '0.8em', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Recent Generations</div>
                                            <table className="admin-table" style={{ fontSize: '0.75em' }}>
                                                <thead><tr><th>Character</th><th>Time</th><th>Tokens</th><th>TPS</th><th>Model</th></tr></thead>
                                                <tbody>
                                                    {last5.map((g, i) => (
                                                        <tr key={i} style={{ opacity: g.success ? 1 : 0.4 }}>
                                                            <td>{g.character}</td>
                                                            <td>{g.timeMs > 1000 ? `${(g.timeMs/1000).toFixed(1)}s` : `${g.timeMs}ms`}</td>
                                                            <td>{g.outputTokens}</td>
                                                            <td>{g.tps}</td>
                                                            <td style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.model?.split('/').pop()}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}

                                    {/* Per-character breakdown */}
                                    {byChar.length > 0 && (
                                        <div style={{ marginTop: 8 }}>
                                            <div style={{ fontSize: '0.8em', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Per Character</div>
                                            <table className="admin-table" style={{ fontSize: '0.75em' }}>
                                                <thead><tr><th>Character</th><th>Count</th><th>Avg Time</th></tr></thead>
                                                <tbody>
                                                    {byChar.map((cs, i) => (
                                                        <tr key={i}>
                                                            <td>{cs.name}</td>
                                                            <td>{cs.count}</td>
                                                            <td>{cs.avgTimeMs > 1000 ? `${(cs.avgTimeMs/1000).toFixed(1)}s` : `${cs.avgTimeMs}ms`}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        {/* Flush AI context */}
                        <div className="admin-agents-controls" style={{ marginTop: 0 }}>
                            <button
                                className="admin-btn"
                                style={{ background: '#c0392b', color: '#fff', width: '100%' }}
                                onClick={() => {
                                    if (!swarm) return;
                                    swarm.flushContext();
                                    alert('AI context and session memory cleared.');
                                }}
                            >
                                Flush AI Context
                            </button>
                        </div>

                        {/* AI Provider toggle */}
                        <div className="admin-agents-controls" style={{ marginTop: 0 }}>
                            <div className="admin-slider-group" style={{ flex: 1 }}>
                                <label>AI Provider:</label>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button
                                        className={`admin-btn ${provider === 'openrouter' ? 'adjust' : ''}`}
                                        onClick={async () => {
                                            setProvider('openrouter');
                                            await swarm?.setProvider('openrouter');
                                            const model = swarm?.defaultModel ?? 'openrouter/auto';
                                            setDefaultModel(model);
                                            setOverrides({});
                                            Object.keys(CHARACTERS).forEach(id => swarm?.setModelOverride(id, null));
                                            onProviderChange?.('openrouter', model);
                                        }}
                                    >
                                        OpenRouter
                                    </button>
                                    <button
                                        className={`admin-btn ${provider === 'gemini' ? 'adjust' : ''}`}
                                        disabled={geminiLoading}
                                        onClick={async () => {
                                            setProvider('gemini');
                                            setGeminiLoading(true);
                                            try {
                                                await swarm?.setProvider('gemini');
                                                setGeminiModels(swarm?.geminiModels ?? []);
                                                const model = swarm?.defaultModel ?? '';
                                                setDefaultModel(model);
                                                setOverrides({});
                                                Object.keys(CHARACTERS).forEach(id => swarm?.setModelOverride(id, null));
                                                onProviderChange?.('gemini', model);
                                            } catch (_) {}
                                            setGeminiLoading(false);
                                        }}
                                    >
                                        {geminiLoading ? 'Loading...' : 'Gemini'}
                                    </button>
                                    <button
                                        className={`admin-btn ${provider === 'qwen' ? 'adjust' : ''}`}
                                        disabled={qwenLoading}
                                        onClick={async () => {
                                            setProvider('qwen');
                                            setQwenLoading(true);
                                            try {
                                                await swarm?.setProvider('qwen');
                                                setQwenModels(swarm?.qwenModels ?? []);
                                                const model = swarm?.defaultModel ?? '';
                                                setDefaultModel(model);
                                                setOverrides({});
                                                Object.keys(CHARACTERS).forEach(id => swarm?.setModelOverride(id, null));
                                                onProviderChange?.('qwen', model);
                                            } catch (_) {}
                                            setQwenLoading(false);
                                        }}
                                    >
                                        {qwenLoading ? 'Loading...' : 'Qwen'}
                                    </button>
                                    <button
                                        className={`admin-btn ${provider === 'haimaker' ? 'adjust' : ''}`}
                                        disabled={haimakerLoading}
                                        onClick={async () => {
                                            setProvider('haimaker');
                                            setHaimakerLoading(true);
                                            try {
                                                await swarm?.setProvider('haimaker');
                                                setHaimakerModels(swarm?.haimakerModels ?? []);
                                                const model = swarm?.defaultModel ?? '';
                                                setDefaultModel(model);
                                                setOverrides({});
                                                Object.keys(CHARACTERS).forEach(id => swarm?.setModelOverride(id, null));
                                                onProviderChange?.('haimaker', model);
                                            } catch (_) {}
                                            setHaimakerLoading(false);
                                        }}
                                    >
                                        {haimakerLoading ? 'Loading...' : 'Haimaker'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Default model for all characters */}
                        <div className="admin-agents-controls" style={{ marginTop: 0 }}>
                            <div className="admin-slider-group" style={{ flex: 1 }}>
                                <label>Default Model for All:</label>
                                <select
                                    className="admin-model-select"
                                    value={defaultModel}
                                    onChange={e => {
                                        const val = e.target.value;
                                        setDefaultModel(val);
                                        swarm?.setDefaultModel(val);
                                        setOverrides({});
                                        Object.keys(CHARACTERS).forEach(id => swarm?.setModelOverride(id, null));
                                    }}
                                    disabled={(provider === 'openrouter' ? swarmModels : provider === 'qwen' ? qwenModels : provider === 'haimaker' ? haimakerModels : geminiModels).length === 0}
                                    style={{ width: '100%' }}
                                >
                                    {(provider === 'openrouter'
                                        ? swarmModels.map(m => (
                                            <option key={m.id} value={m.id}>
                                                {formatModelLabel(m)}
                                            </option>
                                        ))
                                        : provider === 'qwen'
                                        ? qwenModels.map(m => (
                                            <option key={m.id} value={m.id}>
                                                {formatQwenLabel(m)}
                                            </option>
                                        ))
                                        : provider === 'haimaker'
                                        ? haimakerModels.map(m => (
                                            <option key={m.id} value={m.id}>
                                                {formatHaimakerLabel(m)}
                                            </option>
                                        ))
                                        : geminiModels.map(m => (
                                            <option key={m.id} value={m.id}>
                                                {formatGeminiLabel(m)}
                                            </option>
                                        ))
                                    )}
                                </select>
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
                                                                disabled={(provider === 'openrouter' ? swarmModels : provider === 'qwen' ? qwenModels : provider === 'haimaker' ? haimakerModels : geminiModels).length === 0}
                                                            >
                                                                <option value="">
                                                                    {`— Use Default —`}
                                                                </option>
                                                                {(provider === 'openrouter' ? swarmModels : provider === 'qwen' ? qwenModels : provider === 'haimaker' ? haimakerModels : geminiModels).map(m => (
                                                                    <option key={m.id} value={m.id}>
                                                                        {provider === 'openrouter' ? formatModelLabel(m) : provider === 'qwen' ? formatQwenLabel(m) : provider === 'haimaker' ? formatHaimakerLabel(m) : formatGeminiLabel(m)}
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

export default memo(AdminPortal);
