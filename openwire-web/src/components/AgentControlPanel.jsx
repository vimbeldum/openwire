/* ═══════════════════════════════════════════════════════════
   OpenWire — Presentation: Pop-Culture Agent Control Panel
   100vh × 100vw overlay. Character list scrolls internally.
   Admins can toggle shows/characters, override models per-char.
   ═══════════════════════════════════════════════════════════ */

import { useState, useEffect } from 'react';
import { CHARACTERS, SHOWS, getShowCharacters } from '../lib/agents/characters.js';
import { formatModelLabel } from '../lib/agents/openrouter.js';

const DEFAULT_LABEL = '— Random (auto) —';

export default function AgentControlPanel({ swarm, onClose }) {
    // Local mirror of swarm state for re-renders
    const [running, setRunning]           = useState(swarm?.running ?? false);
    const [models, setModels]             = useState(swarm?.freeModels ?? []);
    const [charEnabled, setCharEnabled]   = useState(() => {
        const init = {};
        Object.keys(CHARACTERS).forEach(id => { init[id] = swarm?.isCharacterEnabled(id) ?? true; });
        return init;
    });
    const [showEnabled, setShowEnabled]   = useState(() => {
        const init = {};
        Object.keys(SHOWS).forEach(id => { init[id] = swarm?.isShowEnabled(id) ?? true; });
        return init;
    });
    const [overrides, setOverrides]       = useState({});
    const [assigned, setAssigned]         = useState({});
    const [loading, setLoading]           = useState(false);
    const [error, setError]               = useState(null);

    // Refresh assigned model display on open
    useEffect(() => {
        if (!swarm) return;
        const map = {};
        Object.keys(CHARACTERS).forEach(id => {
            map[id] = swarm.getAssignedModel(id);
        });
        setAssigned(map);
        setModels(swarm.freeModels);
    }, [swarm]);

    const handleToggleSwarm = async () => {
        if (!swarm) return;
        if (running) {
            swarm.stop();
            setRunning(false);
        } else {
            setLoading(true);
            setError(null);
            try {
                await swarm.start();
                setRunning(true);
                setModels(swarm.freeModels);
                const map = {};
                Object.keys(CHARACTERS).forEach(id => { map[id] = swarm.getAssignedModel(id); });
                setAssigned(map);
            } catch (e) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        }
    };

    const handleToggleShow = (showId, val) => {
        swarm?.setShowEnabled(showId, val);
        setShowEnabled(prev => ({ ...prev, [showId]: val }));
    };

    const handleToggleChar = (charId, val) => {
        swarm?.setCharacterEnabled(charId, val);
        setCharEnabled(prev => ({ ...prev, [charId]: val }));
    };

    const handleModelChange = (charId, modelId) => {
        const val = modelId || null;
        swarm?.setModelOverride(charId, val);
        setOverrides(prev => ({ ...prev, [charId]: val }));
    };

    return (
        <div className="acp-overlay" onClick={onClose}>
            <div className="acp-panel" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="acp-header">
                    <div className="acp-title">
                        <span>🤖</span>
                        <span>Pop-Culture Agent Swarm</span>
                        {models.length > 0 && (
                            <span className="acp-model-count">{models.length} free models</span>
                        )}
                    </div>
                    <div className="acp-header-actions">
                        <button
                            className={`acp-toggle-swarm ${running ? 'active' : ''}`}
                            onClick={handleToggleSwarm}
                            disabled={loading}
                        >
                            {loading ? '⏳ Loading…' : running ? '⏸ Stop Swarm' : '▶ Start Swarm'}
                        </button>
                        <button className="acp-close" onClick={onClose}>✕</button>
                    </div>
                </div>

                {error && <div className="acp-error">⚠ {error}</div>}

                {!running && !loading && (
                    <div className="acp-idle-notice">
                        Start the swarm to activate agents. Characters will message at random intervals.
                    </div>
                )}

                {/* Scrollable character list */}
                <div className="acp-body">
                    {Object.values(SHOWS).map(show => {
                        const chars = getShowCharacters(show.id);
                        const allOn = chars.every(c => charEnabled[c.id]);
                        return (
                            <div key={show.id} className="acp-show-section">
                                <div className="acp-show-header">
                                    <span className="acp-show-emoji">{show.emoji}</span>
                                    <span className="acp-show-name">{show.name}</span>
                                    <label className="acp-show-toggle" title="Toggle entire show">
                                        <input
                                            type="checkbox"
                                            checked={showEnabled[show.id] ?? true}
                                            onChange={e => handleToggleShow(show.id, e.target.checked)}
                                        />
                                        <span className="acp-toggle-track" />
                                    </label>
                                    <button
                                        className="acp-all-btn"
                                        onClick={() => chars.forEach(c => handleToggleChar(c.id, !allOn))}
                                    >
                                        {allOn ? 'Disable all' : 'Enable all'}
                                    </button>
                                </div>

                                {chars.map(char => {
                                    const modelId = overrides[char.id] || assigned[char.id] || '';
                                    const modelObj = models.find(m => m.id === modelId);
                                    const interval = `${Math.round(char.minInterval / 60000)}–${Math.round(char.maxInterval / 60000)} min`;
                                    return (
                                        <div
                                            key={char.id}
                                            className={`acp-char-row ${!charEnabled[char.id] || !showEnabled[show.id] ? 'disabled' : ''}`}
                                        >
                                            <span className="acp-char-avatar">{char.avatar}</span>
                                            <div className="acp-char-info">
                                                <span className="acp-char-name">{char.name}</span>
                                                <span className="acp-char-meta">
                                                    ⏱ {interval} · weight {char.frequencyWeight}/10
                                                    {modelObj && (
                                                        <> · <em>{formatModelLabel(modelObj)}</em></>
                                                    )}
                                                </span>
                                            </div>

                                            {/* Model override dropdown */}
                                            <select
                                                className="acp-model-select"
                                                value={overrides[char.id] || ''}
                                                onChange={e => handleModelChange(char.id, e.target.value)}
                                                disabled={models.length === 0}
                                            >
                                                <option value="">{DEFAULT_LABEL}</option>
                                                {models.map(m => (
                                                    <option key={m.id} value={m.id}>
                                                        {formatModelLabel(m)}
                                                    </option>
                                                ))}
                                            </select>

                                            {/* Character toggle */}
                                            <label className="acp-char-toggle">
                                                <input
                                                    type="checkbox"
                                                    checked={charEnabled[char.id] ?? true}
                                                    onChange={e => handleToggleChar(char.id, e.target.checked)}
                                                />
                                                <span className="acp-toggle-track" />
                                            </label>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>

                <div className="acp-footer">
                    Agent messages appear in chat. Only the room host's swarm broadcasts to the room.
                </div>
            </div>
        </div>
    );
}
