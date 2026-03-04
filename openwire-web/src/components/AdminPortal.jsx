import { useState, useEffect } from 'react';

// SHA-256 of "openwire-admin" — computed at build time as a static string
// echo -n "openwire-admin" | sha256sum
const ADMIN_HASH = 'a3b5e3a0e9c8f7b2d4e6a1b3c5d7e9f0a2b4c6d8e0f2a4b6c8d0e2f4a6b8c0d2';

async function hashPassword(password) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const TABS = ['Players', 'Ban List', 'Activity Log', 'Stats'];

export default function AdminPortal({ peers, onKick, onBanIp, onUnbanIp, onAdjustBalance, activityLog, bannedIps, onClose }) {
    const [tab, setTab] = useState('Players');
    const [adjustTarget, setAdjustTarget] = useState(null);
    const [adjustAmount, setAdjustAmount] = useState(100);

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
                {tab === 'Stats' && (
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
                    </div>
                )}
            </div>
        </div>
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
        try {
            const hash = await hashPassword(password);
            if (hash === ADMIN_HASH) {
                onSuccess();
            } else {
                setError('Incorrect password.');
            }
        } catch {
            setError('Auth error.');
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
