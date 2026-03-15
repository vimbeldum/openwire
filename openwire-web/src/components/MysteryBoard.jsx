import { useState, useEffect, useRef, useCallback, memo } from 'react';
import '../styles/mystery.css';

/* ── Phase Timer ──────────────────────────────────── */
function PhaseTimer({ phaseStartedAt, phaseDuration }) {
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        if (!phaseStartedAt || !phaseDuration) return;
        const id = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(id);
    }, [phaseStartedAt, phaseDuration]);

    if (!phaseStartedAt || !phaseDuration) return null;

    const elapsed = now - phaseStartedAt;
    const remaining = Math.max(0, phaseDuration - elapsed);
    const secs = Math.ceil(remaining / 1000);
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    const urgent = secs <= 30;

    return (
        <span className={`mystery-timer ${urgent ? 'urgent' : ''}`}>
            {mins}:{String(s).padStart(2, '0')}
        </span>
    );
}

/* ── Suspect Card ─────────────────────────────────── */
function SuspectCard({ suspect, isActive, isReveal, onClick }) {
    const isCulprit = isReveal && suspect.isCulprit;
    let cls = 'suspect-card';
    if (isActive) cls += ' active';
    if (isCulprit) cls += ' culprit';

    return (
        <div className={cls} onClick={onClick} role="button" tabIndex={0}>
            <span className="suspect-avatar">{suspect.avatar || '?'}</span>
            <div className="suspect-info">
                <div className="suspect-name">{suspect.name}</div>
                <div className="suspect-role">{suspect.role}</div>
            </div>
            {isCulprit && (
                <span className="suspect-badge culprit-badge">Culprit</span>
            )}
        </div>
    );
}

/* ── Clue Notebook ────────────────────────────────── */
function ClueNotebook({ gameId }) {
    const storageKey = `mystery_notes_${gameId || 'default'}`;
    const [notes, setNotes] = useState(() => {
        try { return localStorage.getItem(storageKey) || ''; } catch { return ''; }
    });

    useEffect(() => {
        try { localStorage.setItem(storageKey, notes); } catch { /* quota */ }
    }, [notes, storageKey]);

    return (
        <div className="mystery-notebook">
            <div className="mystery-sidebar-title">Clue Notebook</div>
            <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Jot down clues, suspicions, and observations..."
                spellCheck={false}
            />
        </div>
    );
}

/* ── Voting Panel ─────────────────────────────────── */
function VotingPanel({ suspects, players, myId, onVote }) {
    const myPlayer = players?.find(p => p.peer_id === myId);
    const myVote = myPlayer?.vote || null;

    const voteCounts = {};
    (players || []).forEach(p => {
        if (p.vote) voteCounts[p.vote] = (voteCounts[p.vote] || 0) + 1;
    });

    return (
        <div className="voting-panel">
            {(suspects || []).map(s => (
                <div
                    key={s.id}
                    className={`voting-card ${myVote === s.id ? 'selected' : ''}`}
                    onClick={() => !myVote && onVote(s.id)}
                    role="button"
                    tabIndex={0}
                >
                    <div className="voting-card-avatar">{s.avatar || '?'}</div>
                    <div className="voting-card-name">{s.name}</div>
                    {voteCounts[s.id] > 0 && (
                        <div className="voting-card-votes">
                            {voteCounts[s.id]} vote{voteCounts[s.id] !== 1 ? 's' : ''}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

/* ── Reveal Overlay ───────────────────────────────── */
function RevealOverlay({ game, onClose }) {
    const culprit = (game.suspects || []).find(s => s.isCulprit);
    const scores = game.results?.scores || {};
    const correctVoters = game.results?.correctVoters || [];

    return (
        <div className="reveal-overlay">
            <div className="reveal-suspense">The culprit was...</div>
            <div className="reveal-culprit">
                {culprit ? `${culprit.avatar} ${culprit.name}` : 'Unknown'}
            </div>
            {game.mystery?.motive && (
                <div className="reveal-motive">
                    Motive: {game.mystery.motive}
                </div>
            )}
            {Object.keys(scores).length > 0 && (
                <div className="reveal-scores">
                    {(game.players || []).map(p => (
                        <div
                            key={p.peer_id}
                            className={`reveal-score-chip ${correctVoters.includes(p.peer_id) ? 'correct' : ''}`}
                        >
                            <span className="score-nick">{p.nick}</span>
                            <span className="score-val">{scores[p.peer_id] ?? 0} pts</span>
                        </div>
                    ))}
                </div>
            )}
            <button className="reveal-close-btn" onClick={onClose}>Close</button>
        </div>
    );
}

/* ── @mention autocomplete helper ─────────────────── */
function useAutoComplete(suspects, inputValue) {
    const atMatch = inputValue.match(/@(\w*)$/);
    if (!atMatch) return { suggestions: [], prefix: '' };

    const query = atMatch[1].toLowerCase();
    const filtered = (suspects || []).filter(s =>
        s.name.toLowerCase().includes(query)
    );
    return { suggestions: filtered, prefix: atMatch[0] };
}

/* ── Main Board ───────────────────────────────────── */
export default memo(function MysteryBoard({ game, myId, myNick, onAction, onClose, isHost }) {
    const [inputVal, setInputVal] = useState('');
    const [targetSuspect, setTargetSuspect] = useState(null);
    const [acIndex, setAcIndex] = useState(0);
    const messagesEnd = useRef(null);
    const inputRef = useRef(null);

    const suspects = game?.suspects || [];
    const players = game?.players || [];
    const interrogations = game?.interrogations || [];
    const phase = game?.phase || 'lobby';

    // Typing indicator: derived from game._typingSuspect set by ChatRoom
    const typingSuspectId = game?._typingSuspect || null;
    const typingSuspect = typingSuspectId ? suspects.find(s => s.id === typingSuspectId) : null;

    // Scroll chat to bottom on new messages
    useEffect(() => {
        messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
    }, [interrogations.length]);

    // Autocomplete
    const { suggestions, prefix } = useAutoComplete(suspects, inputVal);
    const showAc = suggestions.length > 0 && prefix.length > 0;

    const applyAutoComplete = useCallback((suspect) => {
        const before = inputVal.slice(0, inputVal.length - prefix.length);
        setInputVal(before + '@' + suspect.name + ' ');
        setTargetSuspect(suspect.id);
        setAcIndex(0);
        inputRef.current?.focus();
    }, [inputVal, prefix]);

    const handleInputKey = useCallback((e) => {
        if (!showAc) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setAcIndex(i => Math.min(i + 1, suggestions.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setAcIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Tab' || e.key === 'Enter') {
            if (suggestions[acIndex]) {
                e.preventDefault();
                applyAutoComplete(suggestions[acIndex]);
            }
        }
    }, [showAc, suggestions, acIndex, applyAutoComplete]);

    const handleSend = useCallback((e) => {
        e.preventDefault();
        const text = inputVal.trim();
        if (!text) return;

        // Detect @suspect in the message
        const mentionMatch = text.match(/@([\w\s]+)/);
        let suspectId = targetSuspect;
        if (!suspectId && mentionMatch) {
            const name = mentionMatch[1].trim().toLowerCase();
            const found = suspects.find(s => s.name.toLowerCase().startsWith(name));
            if (found) suspectId = found.id;
        }

        if (phase === 'investigation' && suspectId) {
            onAction({ type: 'interrogate', suspectId, content: text });
        } else if (phase === 'deliberation') {
            onAction({ type: 'deliberate', content: text });
        }

        setInputVal('');
        setTargetSuspect(null);
    }, [inputVal, targetSuspect, suspects, phase, onAction]);

    const handleVote = useCallback((suspectId) => {
        onAction({ type: 'vote', suspectId });
    }, [onAction]);

    const handleStart = useCallback(() => {
        onAction({ type: 'start' });
    }, [onAction]);

    // ── Lobby phase ──────────────────────────────────
    const AI_MODELS = [
        { id: 'gemini', model: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', provider: 'gemini' },
        { id: 'haimaker', model: 'minimax/minimax-m2.5', label: 'Minimax M2.5', provider: 'haimaker' },
        { id: 'none', model: '', label: 'No AI (template responses)', provider: '' },
    ];
    const [selectedAI, setSelectedAI] = useState('gemini');

    if (phase === 'lobby') {
        return (
            <div className="game-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
                <div className="mystery-table">
                    <Header game={game} onClose={onClose} isHost={isHost} />
                    <div className="mystery-lobby">
                        <div className="mystery-lobby-title">Murder Mystery</div>
                        <div className="mystery-lobby-sub">
                            {players.length} player{players.length !== 1 ? 's' : ''} in lobby
                            {players.length < 2 ? ' (need at least 2)' : ''}
                        </div>
                        {players.map(p => (
                            <div key={p.peer_id} className="mystery-player-row">
                                <span className="mystery-player-dot" />
                                <span>{p.nick}{p.peer_id === myId ? ' (You)' : ''}</span>
                            </div>
                        ))}
                        {isHost && (
                            <>
                                <div className="mystery-ai-select">
                                    <div className="mystery-ai-label">AI Suspect Model</div>
                                    <div className="mystery-ai-options">
                                        {AI_MODELS.map(m => (
                                            <button
                                                key={m.id}
                                                className={`mystery-ai-btn ${selectedAI === m.id ? 'active' : ''}`}
                                                onClick={() => setSelectedAI(m.id)}
                                            >
                                                {m.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <button
                                    className="mystery-start-btn"
                                    disabled={players.length < 1}
                                    onClick={() => {
                                        const aiConfig = AI_MODELS.find(m => m.id === selectedAI);
                                        onAction({ type: 'start', aiProvider: aiConfig?.provider, aiModel: aiConfig?.model });
                                    }}
                                >
                                    Start Mystery
                                </button>
                            </>
                        )}
                        {!isHost && (
                            <div className="mystery-lobby-sub">Waiting for host to start...</div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // ── Generating phase ─────────────────────────────
    if (phase === 'generating') {
        return (
            <div className="game-overlay">
                <div className="mystery-table">
                    <Header game={game} onClose={onClose} isHost={isHost} />
                    <div className="mystery-generating">
                        <div className="mystery-spinner" />
                        <div className="mystery-generating-text">Generating mystery...</div>
                    </div>
                </div>
            </div>
        );
    }

    // ── Active phases (investigation, deliberation, accusation, reveal) ──
    const isReveal = phase === 'reveal' || phase === 'ended';
    const canChat = phase === 'investigation' || phase === 'deliberation';
    const showVoting = phase === 'accusation';

    return (
        <div className="game-overlay">
            <div className="mystery-table">
                <Header game={game} onClose={onClose} isHost={isHost} />

                <div className="mystery-layout">
                    {/* ── Left: Suspects ── */}
                    <div className="mystery-suspects">
                        <div className="mystery-suspects-title">Suspects</div>
                        <div className="mystery-suspects-list">
                            {suspects.map(s => (
                                <SuspectCard
                                    key={s.id}
                                    suspect={s}
                                    isActive={targetSuspect === s.id}
                                    isReveal={isReveal}
                                    onClick={() => {
                                        if (phase === 'investigation') {
                                            setTargetSuspect(s.id);
                                            setInputVal(prev => {
                                                const cleaned = prev.replace(/@[\w\s]*$/, '');
                                                return (cleaned ? cleaned + ' ' : '') + '@' + s.name + ' ';
                                            });
                                            inputRef.current?.focus();
                                        }
                                    }}
                                />
                            ))}
                        </div>
                    </div>

                    {/* ── Center: Chat / Voting ── */}
                    <div className="mystery-chat">
                        <div className="mystery-chat-header">
                            {phase === 'investigation' && 'Interrogation'}
                            {phase === 'deliberation' && 'Deliberation'}
                            {phase === 'accusation' && 'Cast Your Vote'}
                            {isReveal && 'The Truth Revealed'}
                        </div>

                        {showVoting ? (
                            <VotingPanel
                                suspects={suspects}
                                players={players}
                                myId={myId}
                                onVote={handleVote}
                            />
                        ) : (
                            <div className="mystery-messages">
                                {phase === 'deliberation' && (
                                    <div className="mystery-banner">
                                        Suspects have gone silent. Discuss with other players.
                                    </div>
                                )}
                                {interrogations.map((msg) => (
                                    <div
                                        key={msg.id}
                                        className={`mystery-msg ${msg.senderType === 'player' ? 'player' : msg.senderType === 'system' ? 'system' : 'suspect'}`}
                                    >
                                        <div className="mystery-msg-sender">{msg.sender}</div>
                                        <span className="mystery-msg-text">{msg.content}</span>
                                    </div>
                                ))}
                                {typingSuspect && (
                                    <div className="mystery-msg suspect typing">
                                        <div className="mystery-msg-sender">{typingSuspect.name}</div>
                                        <span className="mystery-msg-text mystery-typing-indicator">
                                            <span className="mystery-typing-dot" />
                                            <span className="mystery-typing-dot" />
                                            <span className="mystery-typing-dot" />
                                        </span>
                                    </div>
                                )}
                                <div ref={messagesEnd} />
                            </div>
                        )}

                        {canChat && (
                            <form className="mystery-input-area" onSubmit={handleSend}>
                                {showAc && (
                                    <div className="mystery-autocomplete">
                                        {suggestions.map((s, i) => (
                                            <div
                                                key={s.id}
                                                className={`mystery-autocomplete-item ${i === acIndex ? 'highlighted' : ''}`}
                                                onMouseDown={(e) => { e.preventDefault(); applyAutoComplete(s); }}
                                            >
                                                <span>{s.avatar}</span>
                                                <span>{s.name}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <input
                                    ref={inputRef}
                                    className="mystery-input"
                                    value={inputVal}
                                    onChange={(e) => setInputVal(e.target.value)}
                                    onKeyDown={handleInputKey}
                                    placeholder={
                                        phase === 'investigation'
                                            ? '@suspect Ask a question...'
                                            : 'Discuss with other players...'
                                    }
                                    autoComplete="off"
                                />
                                <button
                                    type="submit"
                                    className="mystery-send-btn"
                                    disabled={!inputVal.trim()}
                                >
                                    Send
                                </button>
                            </form>
                        )}
                    </div>

                    {/* ── Right: Sidebar ── */}
                    <div className="mystery-sidebar">
                        {/* Mystery brief */}
                        {game.mystery && (
                            <div className="mystery-sidebar-section">
                                <div className="mystery-sidebar-title">Case Brief</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--noir-muted)', lineHeight: 1.4 }}>
                                    <strong style={{ color: 'var(--noir-text)' }}>{game.mystery.title}</strong>
                                    <br />
                                    {game.mystery.setting}
                                    {game.mystery.victim && (
                                        <>
                                            <br />
                                            Victim: {game.mystery.victim.name} ({game.mystery.victim.role})
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Players */}
                        <div className="mystery-sidebar-section">
                            <div className="mystery-sidebar-title">Detectives</div>
                            {players.map(p => (
                                <div key={p.peer_id} className="mystery-player-row">
                                    <span className="mystery-player-dot" />
                                    <span>{p.nick}{p.peer_id === myId ? ' (You)' : ''}</span>
                                    {p.vote && (
                                        <span className="mystery-player-vote">Voted</span>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Notebook */}
                        <ClueNotebook gameId={game.mystery?.id} />
                    </div>
                </div>

                {/* Reveal overlay */}
                {isReveal && (
                    <RevealOverlay game={game} onClose={onClose} />
                )}
            </div>
        </div>
    );
});

/* ── Header bar ───────────────────────────────────── */
function Header({ game, onClose, isHost }) {
    const phase = game?.phase || 'lobby';
    const phaseLabels = {
        lobby: 'Lobby',
        generating: 'Generating',
        investigation: 'Investigation',
        deliberation: 'Deliberation',
        accusation: 'Accusation',
        reveal: 'Reveal',
        ended: 'Ended',
    };

    return (
        <div className="game-table-header">
            <div className="game-table-title">
                <span>Murder Mystery</span>
                {isHost && <span className="host-crown" title="You are the host">Crown</span>}
            </div>
            <div className="game-table-meta">
                <span className="mystery-phase-badge">{phaseLabels[phase] || phase}</span>
                {(phase === 'investigation' || phase === 'deliberation' || phase === 'accusation') && (
                    <PhaseTimer
                        phaseStartedAt={game.phaseStartedAt}
                        phaseDuration={game.phaseDuration}
                    />
                )}
            </div>
            <button className="btn-icon-close" onClick={onClose}>X</button>
        </div>
    );
}
