/* ═══════════════════════════════════════════════════════════
   OpenWire — Presentation: Agent Control Panel
   100vh x 100vw overlay. Three tabs:
     1. Swarm Controls — toggle chars, override models
     2. Manage Entities — CRUD for groups & characters
     3. Model Tester — test ping, whitelist/blacklist
   ═══════════════════════════════════════════════════════════ */

import { useState, useEffect, useRef, memo } from 'react';
import {
    loadStore, saveStore, addGroup, removeGroup,
    addCharacter, removeCharacter, getGroupCharacters,
    addToWhitelist, addToBlacklist,
    removeFromWhitelist, removeFromBlacklist,
    getCharactersDict, getGroupsDict, resetStore,
} from '../lib/agents/agentStore.js';
import { formatModelLabel, generateMessage, fetchAllFreeModels } from '../lib/agents/openrouter.js';

const PANEL_TABS = ['Swarm Controls', 'Manage Entities', 'Model Tester'];

function AgentControlPanel({ swarm, onClose }) {
    const [activeTab, setActiveTab] = useState('Swarm Controls');
    const [store, setStore] = useState(loadStore);

    // Derived dicts for rendering
    const characters = getCharactersDict(store);
    const groups = getGroupsDict(store);

    // ── Swarm Controls state ──────────────────────────────────
    const [running, setRunning]         = useState(swarm?.running ?? false);
    const [models, setModels]           = useState(swarm?.freeModels ?? []);
    const [charEnabled, setCharEnabled] = useState(() => {
        const init = {};
        Object.keys(characters).forEach(id => { init[id] = swarm?.isCharacterEnabled(id) ?? true; });
        return init;
    });
    const [groupEnabled, setGroupEnabled] = useState(() => {
        const init = {};
        Object.keys(groups).forEach(id => { init[id] = swarm?.isShowEnabled(id) ?? true; });
        return init;
    });
    const [overrides, setOverrides] = useState({});
    const [assigned, setAssigned]   = useState({});
    const [loading, setLoading]     = useState(false);
    const [error, setError]         = useState(null);
    const [guardrails, setGuardrails] = useState(store.guardrails !== false);

    // ── Model Tester state ────────────────────────────────────
    const [allModels, setAllModels]     = useState([]);
    const [testModel, setTestModel]     = useState('');
    const [testResult, setTestResult]   = useState(null);
    const [testLoading, setTestLoading] = useState(false);
    const [testerLoaded, setTesterLoaded] = useState(false);

    // ── Manage Entities state ─────────────────────────────────
    const [newGroupId, setNewGroupId]     = useState('');
    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupEmoji, setNewGroupEmoji] = useState('');
    const [newCharName, setNewCharName]     = useState('');
    const [newCharAvatar, setNewCharAvatar] = useState('');
    const [newCharGroup, setNewCharGroup]   = useState('');
    const [newCharPrompt, setNewCharPrompt] = useState('');
    const [newCharWeight, setNewCharWeight] = useState(5);
    const [newCharMin, setNewCharMin]       = useState(3);
    const [newCharMax, setNewCharMax]       = useState(8);
    const [newCharTags, setNewCharTags]     = useState('');

    useEffect(() => {
        if (!swarm) return;
        const map = {};
        Object.keys(characters).forEach(id => { map[id] = swarm.getAssignedModel(id); });
        setAssigned(map);
        setModels(swarm.freeModels);
        setRunning(swarm.running);
    }, [swarm]);

    // Helper: persist store and hot-reload swarm
    const persistAndReload = (next) => {
        saveStore(next);
        setStore(next);
        swarm?.loadConfig();
    };

    // ── Swarm Controls handlers ───────────────────────────────
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
                Object.keys(swarm.characters).forEach(id => { map[id] = swarm.getAssignedModel(id); });
                setAssigned(map);
            } catch (e) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        }
    };

    const handleToggleGuardrails = (val) => {
        const next = { ...store, guardrails: val };
        persistAndReload(next);
        setGuardrails(val);
    };

    const handleToggleGroup = (gid, val) => {
        swarm?.setShowEnabled(gid, val);
        setGroupEnabled(prev => ({ ...prev, [gid]: val }));
    };

    const handleToggleChar = (cid, val) => {
        swarm?.setCharacterEnabled(cid, val);
        setCharEnabled(prev => ({ ...prev, [cid]: val }));
    };

    const handleModelChange = (cid, modelId) => {
        const val = modelId || null;
        swarm?.setModelOverride(cid, val);
        setOverrides(prev => ({ ...prev, [cid]: val }));
    };

    // ── Model Tester handlers ─────────────────────────────────
    const loadTesterModels = async () => {
        if (testerLoaded) return;
        try {
            const all = await fetchAllFreeModels();
            setAllModels(all);
            setTesterLoaded(true);
            if (all.length > 0) setTestModel(all[0].id);
        } catch (_) { /* ignore */ }
    };

    const handleTestPing = async () => {
        if (!testModel) return;
        setTestLoading(true);
        setTestResult(null);
        try {
            const text = await generateMessage(
                testModel,
                'You are a test assistant.',
                [{ role: 'user', content: 'Respond with exactly one word: Hello.' }],
                20
            );
            setTestResult({ ok: true, text: text || '(empty response)' });
        } catch (e) {
            setTestResult({ ok: false, text: e.message });
        }
        setTestLoading(false);
    };

    const handleWhitelist = (modelId) => {
        const next = addToWhitelist(store, modelId);
        persistAndReload(next);
        swarm?.refreshModels();
    };

    const handleBlacklist = (modelId) => {
        const next = addToBlacklist(store, modelId);
        persistAndReload(next);
        swarm?.refreshModels();
    };

    // ── Manage Entities handlers ──────────────────────────────
    const handleAddGroup = () => {
        const id = newGroupId.trim().toLowerCase().replace(/\s+/g, '_');
        if (!id || !newGroupName.trim()) return;
        const next = addGroup(store, { id, name: newGroupName.trim(), emoji: newGroupEmoji || '🎭' });
        persistAndReload(next);
        setNewGroupId(''); setNewGroupName(''); setNewGroupEmoji('');
    };

    const handleRemoveGroup = (gid) => {
        if (!window.confirm(`Delete group "${groups[gid]?.name}" and all its characters?`)) return;
        const next = removeGroup(store, gid);
        persistAndReload(next);
    };

    const handleAddChar = () => {
        const name = newCharName.trim();
        if (!name || !newCharGroup) return;
        const id = name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now().toString(36);
        const char = {
            id,
            name,
            groupId: newCharGroup,
            avatar: newCharAvatar || '🤖',
            systemPrompt: newCharPrompt || `You are ${name}. Write ONE short in-character chat message (1-2 sentences). No quotes, no stage directions.`,
            frequencyWeight: newCharWeight,
            minInterval: newCharMin * 60 * 1000,
            maxInterval: newCharMax * 60 * 1000,
            reactive_tags: newCharTags.split(',').map(t => t.trim()).filter(Boolean),
            agent_triggers: [],
            moods: { normal: '' },
        };
        const next = addCharacter(store, char);
        persistAndReload(next);
        setNewCharName(''); setNewCharAvatar(''); setNewCharPrompt(''); setNewCharTags('');
    };

    const handleRemoveChar = (cid) => {
        if (!window.confirm(`Delete character "${characters[cid]?.name}"?`)) return;
        const next = removeCharacter(store, cid);
        persistAndReload(next);
    };

    const handleResetDefaults = () => {
        if (!window.confirm('Reset all characters and groups to defaults? Custom entities will be lost.')) return;
        const next = resetStore();
        persistAndReload(next);
    };

    // ── Render ────────────────────────────────────────────────
    const currentGroups = store.groups;
    const currentChars = store.characters;
    const wl = store.modelFilters?.whitelist || [];
    const bl = store.modelFilters?.blacklist || [];

    return (
        <div className="acp-overlay" onClick={onClose}>
            <div className="acp-panel" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="acp-header">
                    <div className="acp-title">
                        <span>🤖</span>
                        <span>Agent Swarm</span>
                        {models.length > 0 && (
                            <span className="acp-model-count">{models.length} models</span>
                        )}
                    </div>
                    <div className="acp-header-actions">
                        <button
                            className={`acp-toggle-swarm ${running ? 'active' : ''}`}
                            onClick={handleToggleSwarm}
                            disabled={loading}
                        >
                            {loading ? '⏳ Loading…' : running ? '⏸ Stop' : '▶ Start'}
                        </button>
                        <button className="acp-close" onClick={onClose}>✕</button>
                    </div>
                </div>

                {error && <div className="acp-error">⚠ {error}</div>}

                {/* Tab bar */}
                <div className="acp-tab-bar">
                    {PANEL_TABS.map(t => (
                        <button
                            key={t}
                            className={`acp-tab-btn ${activeTab === t ? 'active' : ''}`}
                            onClick={() => {
                                setActiveTab(t);
                                if (t === 'Model Tester') loadTesterModels();
                            }}
                        >{t}</button>
                    ))}
                </div>

                {/* ═══ TAB 1: Swarm Controls ═══ */}
                {activeTab === 'Swarm Controls' && (
                    <div className="acp-body">
                        {!running && !loading && (
                            <div className="acp-idle-notice">
                                Start the swarm to activate agents.
                            </div>
                        )}

                        {/* Guardrails toggle */}
                        <div className="acp-guardrails-row">
                            <div className="acp-guardrails-info">
                                <span className="acp-guardrails-label">
                                    {guardrails ? 'SFW Mode' : 'Unfiltered Mode'}
                                </span>
                                <span className="acp-guardrails-desc">
                                    {guardrails
                                        ? 'Family-friendly, no profanity, polite drama'
                                        : 'Raw, unfiltered, savage roasts & crude humor'}
                                </span>
                            </div>
                            <label className="acp-show-toggle" title="Toggle guardrails">
                                <input type="checkbox"
                                    checked={guardrails}
                                    onChange={e => handleToggleGuardrails(e.target.checked)}
                                />
                                <span className="acp-toggle-track" />
                            </label>
                        </div>

                        {currentGroups.map(group => {
                            const chars = getGroupCharacters(store, group.id);
                            const allOn = chars.every(c => charEnabled[c.id]);
                            return (
                                <div key={group.id} className="acp-show-section">
                                    <div className="acp-show-header">
                                        <span className="acp-show-emoji">{group.emoji}</span>
                                        <span className="acp-show-name">{group.name}</span>
                                        <label className="acp-show-toggle" title="Toggle group">
                                            <input type="checkbox"
                                                checked={groupEnabled[group.id] ?? true}
                                                onChange={e => handleToggleGroup(group.id, e.target.checked)}
                                            />
                                            <span className="acp-toggle-track" />
                                        </label>
                                        <button className="acp-all-btn"
                                            onClick={() => chars.forEach(c => handleToggleChar(c.id, !allOn))}
                                        >{allOn ? 'Disable all' : 'Enable all'}</button>
                                    </div>

                                    {chars.map(char => {
                                        const modelId = overrides[char.id] || assigned[char.id] || '';
                                        const modelObj = models.find(m => m.id === modelId);
                                        const interval = `${Math.round(char.minInterval / 60000)}–${Math.round(char.maxInterval / 60000)} min`;
                                        return (
                                            <div key={char.id}
                                                className={`acp-char-row ${!charEnabled[char.id] || !groupEnabled[group.id] ? 'disabled' : ''}`}
                                            >
                                                <span className="acp-char-avatar">{char.avatar}</span>
                                                <div className="acp-char-info">
                                                    <span className="acp-char-name">{char.name}</span>
                                                    <span className="acp-char-meta">
                                                        ⏱ {interval} · wt {char.frequencyWeight}/10
                                                        {modelObj && <> · <em>{formatModelLabel(modelObj)}</em></>}
                                                    </span>
                                                </div>
                                                <select className="acp-model-select"
                                                    value={overrides[char.id] || ''}
                                                    onChange={e => handleModelChange(char.id, e.target.value)}
                                                    disabled={models.length === 0}
                                                >
                                                    <option value="">— Auto —</option>
                                                    {models.map(m => (
                                                        <option key={m.id} value={m.id}>{formatModelLabel(m)}</option>
                                                    ))}
                                                </select>
                                                <label className="acp-char-toggle">
                                                    <input type="checkbox"
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
                )}

                {/* ═══ TAB 2: Manage Entities ═══ */}
                {activeTab === 'Manage Entities' && (
                    <div className="acp-body">
                        {/* Group Management */}
                        <div className="acp-section-title">Groups</div>
                        <div className="acp-entity-list">
                            {currentGroups.map(g => (
                                <div key={g.id} className="acp-entity-row">
                                    <span>{g.emoji} {g.name}</span>
                                    <span className="acp-entity-id">{g.id}</span>
                                    <span className="acp-entity-count">{getGroupCharacters(store, g.id).length} chars</span>
                                    <button className="acp-entity-del" onClick={() => handleRemoveGroup(g.id)}>✕</button>
                                </div>
                            ))}
                        </div>
                        <div className="acp-add-form">
                            <input placeholder="ID (e.g. sitcom_xyz)" value={newGroupId} onChange={e => setNewGroupId(e.target.value)} />
                            <input placeholder="Name" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
                            <input placeholder="Emoji" value={newGroupEmoji} onChange={e => setNewGroupEmoji(e.target.value)} style={{ width: 50 }} />
                            <button className="acp-add-btn" onClick={handleAddGroup}>+ Add Group</button>
                        </div>

                        {/* Character Management */}
                        <div className="acp-section-title" style={{ marginTop: 16 }}>Characters</div>
                        <div className="acp-entity-list">
                            {currentChars.map(c => (
                                <div key={c.id} className="acp-entity-row">
                                    <span>{c.avatar} {c.name}</span>
                                    <span className="acp-entity-id">{groups[c.groupId]?.name || c.groupId}</span>
                                    <span className="acp-entity-count">wt {c.frequencyWeight}</span>
                                    <button className="acp-entity-del" onClick={() => handleRemoveChar(c.id)}>✕</button>
                                </div>
                            ))}
                        </div>
                        <div className="acp-add-form acp-char-form">
                            <div className="acp-form-row">
                                <input placeholder="Name" value={newCharName} onChange={e => setNewCharName(e.target.value)} />
                                <input placeholder="Avatar emoji" value={newCharAvatar} onChange={e => setNewCharAvatar(e.target.value)} style={{ width: 60 }} />
                                <select value={newCharGroup} onChange={e => setNewCharGroup(e.target.value)}>
                                    <option value="">Group…</option>
                                    {currentGroups.map(g => <option key={g.id} value={g.id}>{g.emoji} {g.name}</option>)}
                                </select>
                            </div>
                            <textarea
                                placeholder="System prompt / personality context"
                                value={newCharPrompt}
                                onChange={e => setNewCharPrompt(e.target.value)}
                                rows={3}
                            />
                            <div className="acp-form-row">
                                <label>Weight: <strong>{newCharWeight}</strong>
                                    <input type="range" min={1} max={10} value={newCharWeight} onChange={e => setNewCharWeight(+e.target.value)} />
                                </label>
                                <label>Min:
                                    <input type="number" min={1} max={30} value={newCharMin} onChange={e => setNewCharMin(+e.target.value)} style={{ width: 50 }} />m
                                </label>
                                <label>Max:
                                    <input type="number" min={1} max={60} value={newCharMax} onChange={e => setNewCharMax(+e.target.value)} style={{ width: 50 }} />m
                                </label>
                            </div>
                            <input
                                placeholder="Reactive tags (comma-separated)"
                                value={newCharTags}
                                onChange={e => setNewCharTags(e.target.value)}
                            />
                            <button className="acp-add-btn" onClick={handleAddChar}>+ Add Character</button>
                        </div>
                        <button className="acp-reset-btn" onClick={handleResetDefaults}>Reset to Defaults</button>
                    </div>
                )}

                {/* ═══ TAB 3: Model Tester ═══ */}
                {activeTab === 'Model Tester' && (
                    <div className="acp-body">
                        <div className="acp-section-title">Test a Free Model</div>
                        <div className="acp-tester-row">
                            <select
                                className="acp-model-select"
                                value={testModel}
                                onChange={e => setTestModel(e.target.value)}
                                style={{ flex: 1 }}
                            >
                                {allModels.map(m => (
                                    <option key={m.id} value={m.id}>{formatModelLabel(m)}</option>
                                ))}
                            </select>
                            <button
                                className="acp-add-btn"
                                onClick={handleTestPing}
                                disabled={testLoading || !testModel}
                            >
                                {testLoading ? '⏳ Testing…' : '🔍 Test Ping'}
                            </button>
                        </div>

                        {testResult && (
                            <div className={`acp-test-result ${testResult.ok ? 'ok' : 'fail'}`}>
                                <div className="acp-test-label">{testResult.ok ? '✅ Response:' : '❌ Error:'}</div>
                                <div className="acp-test-text">{testResult.text}</div>
                                {testResult.ok && (
                                    <div className="acp-test-actions">
                                        <button className="acp-wl-btn" onClick={() => handleWhitelist(testModel)}>
                                            ✅ Add to Whitelist
                                        </button>
                                        <button className="acp-bl-btn" onClick={() => handleBlacklist(testModel)}>
                                            🚫 Add to Blacklist
                                        </button>
                                    </div>
                                )}
                                {!testResult.ok && (
                                    <div className="acp-test-actions">
                                        <button className="acp-bl-btn" onClick={() => handleBlacklist(testModel)}>
                                            🚫 Blacklist this model
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Current whitelist */}
                        {wl.length > 0 && (
                            <>
                                <div className="acp-section-title" style={{ marginTop: 12 }}>Whitelist ({wl.length})</div>
                                <div className="acp-filter-list">
                                    {wl.map(id => {
                                        const m = allModels.find(x => x.id === id);
                                        return (
                                            <div key={id} className="acp-filter-row wl">
                                                <span>{m ? formatModelLabel(m) : id}</span>
                                                <button onClick={() => {
                                                    const next = removeFromWhitelist(store, id);
                                                    persistAndReload(next);
                                                    swarm?.refreshModels();
                                                }}>✕</button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </>
                        )}

                        {/* Current blacklist */}
                        {bl.length > 0 && (
                            <>
                                <div className="acp-section-title" style={{ marginTop: 12 }}>Blacklist ({bl.length})</div>
                                <div className="acp-filter-list">
                                    {bl.map(id => {
                                        const m = allModels.find(x => x.id === id);
                                        return (
                                            <div key={id} className="acp-filter-row bl">
                                                <span>{m ? formatModelLabel(m) : id}</span>
                                                <button onClick={() => {
                                                    const next = removeFromBlacklist(store, id);
                                                    persistAndReload(next);
                                                    swarm?.refreshModels();
                                                }}>✕</button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </>
                        )}

                        <div className="acp-tester-hint">
                            Whitelist mode: only whitelisted models are used. If empty, all free models except blacklisted are used.
                        </div>
                    </div>
                )}

                <div className="acp-footer">
                    Agent messages appear in General Chat. Smart @mention tagging is automatic.
                </div>
            </div>
        </div>
    );
}

export default memo(AgentControlPanel);
