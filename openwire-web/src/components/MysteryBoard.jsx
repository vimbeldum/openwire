import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { SCORING } from '../lib/mystery/scoring.js';
import '../styles/mystery.css';

/* ── Phase Timer ──────────────────────────────────── */
const PhaseTimer = memo(function PhaseTimer({ phaseStartedAt, phaseDuration }) {
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
});

/* ── Suspect Card ─────────────────────────────────── */
const SuspectCard = memo(function SuspectCard({ suspect, isActive, isReveal, onClick }) {
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
});

/* ── Clue Notebook ────────────────────────────────── */
function ClueNotebook({ gameId }) {
    const storageKey = `mystery_notes_${gameId || 'default'}`;
    const [notes, setNotes] = useState(() => {
        try { return localStorage.getItem(storageKey) || ''; } catch { return ''; }
    });

    useEffect(() => {
        const timer = setTimeout(() => {
            try { localStorage.setItem(storageKey, notes); } catch { /* quota */ }
        }, 500);
        return () => clearTimeout(timer);
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
    const culpritId = game.mystery?.culpritId ?? null;
    const interrogations = game.interrogations || [];

    // Compute per-player score breakdown
    function getBreakdown(player) {
        const parts = [];
        const isCorrect = player.vote && player.vote === culpritId;
        if (isCorrect) {
            parts.push(`+${SCORING.correctAccusation} Correct accusation`);
        } else if (player.vote) {
            parts.push('+0 Wrong accusation');
        }

        const playerQuestions = interrogations.filter(
            m => m.senderType === 'player' && m.sender === player.nick,
        );
        const uniqueSuspects = new Set(
            playerQuestions.map(m => m.suspectId).filter(Boolean),
        );
        if (uniqueSuspects.size > 0) {
            parts.push(`+${SCORING.uniqueSuspectsBonus} x ${uniqueSuspects.size} suspects interrogated`);
        }
        if (playerQuestions.length > 0) {
            parts.push(`+${SCORING.questionsAskedBonus} x ${playerQuestions.length} questions asked`);
        }

        // Early vote bonus
        if (isCorrect && game.accusationDurationMs && game.phaseStartedAt) {
            const elapsed = (player.votedAt || Date.now()) - game.phaseStartedAt;
            const halfDuration = game.accusationDurationMs / 2;
            if (elapsed < halfDuration) {
                parts.push(`+${SCORING.earlyVoteBonus} Early vote bonus`);
            }
        }

        return parts;
    }

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
                    {(game.players || []).map(p => {
                        const breakdown = getBreakdown(p);
                        return (
                            <div
                                key={p.peer_id}
                                className={`reveal-score-chip ${correctVoters.includes(p.peer_id) ? 'correct' : ''}`}
                            >
                                <span className="score-nick">{p.nick}</span>
                                <span className="score-val">{scores[p.peer_id] ?? 0} pts</span>
                                {breakdown.length > 0 && (
                                    <div className="score-breakdown">
                                        {breakdown.map((line, i) => (
                                            <div key={i} className="score-breakdown-line">{line}</div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
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

/* ── How to Play Guide ────────────────────────────── */
function HowToPlay() {
    const [open, setOpen] = useState(true);

    return (
        <div className="mystery-howto">
            <button
                className="mystery-howto-toggle"
                onClick={() => setOpen(o => !o)}
            >
                {open ? 'Hide' : 'Show'} How to Play
            </button>
            {open && (
                <div className="mystery-howto-body">
                    <div className="mystery-howto-tip">Use <strong>@SuspectName</strong> to ask a suspect questions</div>
                    <div className="mystery-howto-tip">Ask about their <strong>alibi, motive, relationships</strong></div>
                    <div className="mystery-howto-tip"><strong>Cross-reference</strong> -- ask suspects about each other</div>
                    <div className="mystery-howto-tip">Take notes in the <strong>Clue Notebook</strong> on the right</div>
                    <div className="mystery-howto-phases">
                        <span className="mystery-howto-phase">Investigation</span>
                        <span className="mystery-howto-arrow">&rarr;</span>
                        <span className="mystery-howto-phase">Deliberation</span>
                        <span className="mystery-howto-arrow">&rarr;</span>
                        <span className="mystery-howto-phase">Accusation</span>
                        <span className="mystery-howto-arrow">&rarr;</span>
                        <span className="mystery-howto-phase">Reveal</span>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ── AI model options (module-scope constant) ────── */
const AI_MODELS = [
    { id: 'gemini', model: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', provider: 'gemini' },
    { id: 'haimaker', model: 'minimax/minimax-m2.5', label: 'Minimax M2.5', provider: 'haimaker' },
    { id: 'none', model: '', label: 'No AI (template responses)', provider: '' },
];

/* ── Main Board ───────────────────────────────────── */
export default memo(function MysteryBoard({ game, myId, myNick, onAction, onClose, isHost, aiError, onClearAIError }) {
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
            // Clear any lingering AI error when player sends a new interrogation
            if (onClearAIError) onClearAIError();
        } else if (phase === 'deliberation') {
            onAction({ type: 'deliberate', content: text });
        }

        setInputVal('');
        setTargetSuspect(null);
    }, [inputVal, targetSuspect, suspects, phase, onAction, onClearAIError]);

    const handleVote = useCallback((suspectId) => {
        onAction({ type: 'vote', suspectId });
    }, [onAction]);

    const handleStart = useCallback(() => {
        onAction({ type: 'start' });
    }, [onAction]);

    // ── Lobby phase ──────────────────────────────────
    const [selectedAI, setSelectedAI] = useState('gemini');
    const [showCustom, setShowCustom] = useState(false);
    const [customSetting, setCustomSetting] = useState('');
    const [customVictim, setCustomVictim] = useState('');
    const [customTheme, setCustomTheme] = useState('');

    if (phase === 'lobby') {
        return (
            <div className="game-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
                <div className="mystery-table">
                    <Header game={game} onClose={onClose} isHost={isHost} onAction={onAction} />
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
                                <div className="mystery-custom-section">
                                    <button
                                        className="mystery-custom-toggle"
                                        onClick={() => setShowCustom(!showCustom)}
                                    >
                                        {showCustom ? 'Use Template' : 'Create Custom Scenario'}
                                    </button>
                                    {showCustom && (
                                        <div className="mystery-custom-form">
                                            <input
                                                placeholder="Setting (e.g., 'Bollywood party in Mumbai')"
                                                value={customSetting}
                                                onChange={e => setCustomSetting(e.target.value)}
                                            />
                                            <input
                                                placeholder="Victim name & role (e.g., 'Director Sharma')"
                                                value={customVictim}
                                                onChange={e => setCustomVictim(e.target.value)}
                                            />
                                            <input
                                                placeholder="Theme/mood (e.g., 'dark comedy', 'noir', 'Hinglish')"
                                                value={customTheme}
                                                onChange={e => setCustomTheme(e.target.value)}
                                            />
                                        </div>
                                    )}
                                </div>
                                <button
                                    className="mystery-start-btn"
                                    disabled={players.length < 1 || (showCustom && selectedAI === 'none')}
                                    onClick={() => {
                                        const aiConfig = AI_MODELS.find(m => m.id === selectedAI);
                                        if (showCustom) {
                                            onAction({
                                                type: 'start',
                                                aiProvider: aiConfig?.provider,
                                                aiModel: aiConfig?.model,
                                                custom: true,
                                                customSetting,
                                                customVictim,
                                                customTheme,
                                            });
                                        } else {
                                            onAction({
                                                type: 'start',
                                                aiProvider: aiConfig?.provider,
                                                aiModel: aiConfig?.model,
                                            });
                                        }
                                    }}
                                >
                                    {showCustom ? 'Generate Custom Mystery' : 'Start Mystery'}
                                </button>
                                {showCustom && selectedAI === 'none' && (
                                    <div className="mystery-lobby-sub">
                                        Custom scenarios require an AI model
                                    </div>
                                )}
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
                    <Header game={game} onClose={onClose} isHost={isHost} onAction={onAction} />
                    <div className="mystery-generating">
                        <div className="mystery-spinner" />
                        <div className="mystery-generating-text">
                            {game._customGenerating
                                ? 'AI is crafting your custom mystery...'
                                : 'Generating mystery...'}
                        </div>
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
                <Header game={game} onClose={onClose} isHost={isHost} onAction={onAction} />

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

                        {aiError && (
                            <div className="mystery-ai-error">
                                <span className="mystery-ai-error-icon">&#9888;</span>
                                <span className="mystery-ai-error-text">{aiError}</span>
                                <button
                                    className="mystery-ai-error-dismiss"
                                    onClick={onClearAIError}
                                    aria-label="Dismiss AI error"
                                >&#10005;</button>
                            </div>
                        )}

                        {showVoting ? (
                            <VotingPanel
                                suspects={suspects}
                                players={players}
                                myId={myId}
                                onVote={handleVote}
                            />
                        ) : (
                            <div className="mystery-messages">
                                {phase === 'investigation' && interrogations.length === 0 && (
                                    <HowToPlay />
                                )}
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
function Header({ game, onClose, isHost, onAction }) {
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
                    <>
                        <PhaseTimer
                            phaseStartedAt={game.phaseStartedAt}
                            phaseDuration={game.phaseDuration}
                        />
                        {isHost && (
                            <button className="mystery-advance-btn" onClick={() => onAction({ type: 'advancePhase' })}>
                                Skip
                            </button>
                        )}
                    </>
                )}
            </div>
            <button className="btn-icon-close" onClick={onClose}>X</button>
        </div>
    );
}
