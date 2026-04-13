import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import '../styles/cluedo.css';

const SUSPECTS = ['Miss Scarlet', 'Colonel Mustard', 'Mrs. White', 'Mr. Green', 'Mrs. Peacock', 'Professor Plum'];
const WEAPONS = ['Candlestick', 'Dagger', 'Lead Pipe', 'Revolver', 'Rope', 'Wrench'];
const ROOMS = ['Hall', 'Lounge', 'Dining Room', 'Kitchen', 'Ballroom', 'Conservatory', 'Billiard Room', 'Library', 'Study'];

// Character token colors
const SUSPECT_TOKENS = {
  'Miss Scarlet':   { color: '#E74C3C', bg: 'rgba(231,76,60,0.15)',  border: '#E74C3C', icon: '🔴' },
  'Colonel Mustard':{ color: '#F39C12', bg: 'rgba(243,156,18,0.15)', border: '#F39C12', icon: '🟡' },
  'Mrs. White':     { color: '#ECF0F1', bg: 'rgba(236,240,241,0.15)',border: '#BDC3C7', icon: '⚪' },
  'Mr. Green':      { color: '#27AE60', bg: 'rgba(39,174,96,0.15)',  border: '#27AE60', icon: '🟢' },
  'Mrs. Peacock':   { color: '#3498DB', bg: 'rgba(52,152,219,0.15)', border: '#3498DB', icon: '🔵' },
  'Professor Plum': { color: '#9B59B6', bg: 'rgba(155,89,182,0.15)',border: '#9B59B6', icon: '🟣' },
};

// Weapon icons/emojis
const WEAPON_DISPLAY = {
  'Candlestick': { icon: '🕯️', color: '#F5B041' },
  'Dagger':      { icon: '🗡️', color: '#A0A0A0' },
  'Lead Pipe':   { icon: '🔧', color: '#7F8C8D' },
  'Revolver':    { icon: '🔫', color: '#2C3E50' },
  'Rope':        { icon: '🪢', color: '#8B4513' },
  'Wrench':      { icon: '🔩', color: '#5D6D7E' },
};

export default memo(function CluedoBoard({ game, myId, myNick, wallet, onAction, onClose, onHelp, isHost, onReady, onNewRound, readyCount, totalBettors, isReady }) {
    const [showSuggestModal, setShowSuggestModal] = useState(false);
    const [showAccuseModal, setShowAccuseModal] = useState(false);
    const [showNotes, setShowNotes] = useState(false);
    const [suggestSuspect, setSuggestSuspect] = useState('');
    const [suggestWeapon, setSuggestWeapon] = useState('');
    const [accuseSuspect, setAccuseSuspect] = useState('');
    const [accuseWeapon, setAccuseWeapon] = useState('');
    const [accuseRoom, setAccuseRoom] = useState('');
    const [myNotes, setMyNotes] = useState('');

    const currentPlayer = game?.players?.[game.currentPlayer];
    const isMyTurn = currentPlayer?.peer_id === myId;
    const myHand = game?.hands?.[myId] || [];
    const myPlayer = game?.players?.find(p => p.peer_id === myId);

    if (!game) return null;

    const phaseLabels = {
        lobby: 'Waiting for players...',
        roll: 'Roll the dice!',
        move: 'Choose a room',
        suggest: 'Make a suggestion',
        accuse: 'Make an accusation',
        ended: 'Game Over!',
    };

    const handleSuggestion = () => {
        if (!suggestSuspect || !suggestWeapon) return;
        onAction({ type: 'suggest', suspect: suggestSuspect, weapon: suggestWeapon, room: currentPlayer?.position });
        setShowSuggestModal(false);
        setSuggestSuspect('');
        setSuggestWeapon('');
    };

    const handleAccusation = () => {
        if (!accuseSuspect || !accuseWeapon || !accuseRoom) return;
        onAction({ type: 'accuse', suspect: accuseSuspect, weapon: accuseWeapon, room: accuseRoom });
        setShowAccuseModal(false);
        setAccuseSuspect('');
        setAccuseWeapon('');
        setAccuseRoom('');
    };

    // Get adjacent rooms for movement
    const ROOM_ADJACENCY = {
        'Hall': ['Lounge', 'Dining Room', 'Study'],
        'Lounge': ['Hall', 'Dining Room'],
        'Dining Room': ['Lounge', 'Hall', 'Kitchen'],
        'Kitchen': ['Dining Room', 'Ballroom'],
        'Ballroom': ['Kitchen', 'Conservatory', 'Billiard Room'],
        'Conservatory': ['Ballroom', 'Billiard Room', 'Library'],
        'Billiard Room': ['Ballroom', 'Conservatory', 'Library'],
        'Library': ['Conservatory', 'Billiard Room', 'Study'],
        'Study': ['Library', 'Hall'],
    };

    const adjacentRooms = ROOM_ADJACENCY[currentPlayer?.position] || [];

    return (
        <div className="clue-container">
            {/* Header */}
            <div className="clue-header">
                <div className="clue-title-row">
                    <span className="clue-title-icon">🔍</span>
                    <h1 className="clue-title">CLUEDO</h1>
                    <span className="clue-title-icon">🔍</span>
                </div>
                <div className="clue-status-row">
                    <span className="clue-phase-badge">{phaseLabels[game.phase] || game.phase}</span>
                    {currentPlayer?.position && (
                        <span className="clue-room-badge">
                            <span className="clue-room-icon">📍</span>
                            {currentPlayer.position}
                        </span>
                    )}
                </div>
            </div>

            {/* Dice Display */}
            {game.dice[0] > 0 && (
                <div className="clue-dice-panel">
                    <div className="clue-dice">
                        <div className="clue-die">{game.dice[0]}</div>
                        <div className="clue-die">{game.dice[1]}</div>
                    </div>
                    <div className="clue-dice-total">
                        <span className="clue-dice-sum">Total: {game.dice[0] + game.dice[1]}</span>
                    </div>
                </div>
            )}

            {/* Main Layout: 3 columns on desktop */}
            <div className="clue-layout">
                {/* Left Panel: Players */}
                <div className="clue-panel clue-players-panel">
                    <div className="clue-panel-title">
                        <span className="clue-panel-icon">👥</span>
                        Detectives
                    </div>
                    <div className="clue-players-list">
                        {game.players.map((p, i) => {
                            const token = SUSPECT_TOKENS[SUSPECTS[i % SUSPECTS.length]] || SUSPECT_TOKENS['Miss Scarlet'];
                            const isActive = i === game.currentPlayer;
                            return (
                                <div key={p.peer_id} className={`clue-player-card ${isActive ? 'active' : ''} ${p.eliminated ? 'eliminated' : ''}`}>
                                    <div className="clue-player-token" style={{ background: token.bg, borderColor: token.color }}>
                                        {token.icon}
                                    </div>
                                    <div className="clue-player-info">
                                        <div className="clue-player-name">{p.nick}</div>
                                        <div className="clue-player-status">
                                            {p.eliminated ? (
                                                <span className="clue-eliminated-tag">💀 Eliminated</span>
                                            ) : (
                                                <span className="clue-player-room-label">📍 {p.position || 'Lobby'}</span>
                                            )}
                                        </div>
                                    </div>
                                    {isActive && !p.eliminated && (
                                        <div className="clue-turn-badge">▶</div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Center Panel: Game Board */}
                <div className="clue-panel clue-center-panel">
                    {/* Room Navigation */}
                    {game.phase === 'move' && isMyTurn && (
                        <div className="clue-room-nav">
                            <div className="clue-nav-title">🚪 Move to Room</div>
                            <div className="clue-nav-rooms">
                                {adjacentRooms.map(room => (
                                    <button key={room} className="clue-room-btn" onClick={() => onAction({ type: 'move', room })}>
                                        {room}
                                    </button>
                                ))}
                                <button className="clue-stay-btn" onClick={() => onAction({ type: 'stay' })}>
                                    Stay Here
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Room Display */}
                    <div className="clue-room-grid">
                        {ROOMS.map(room => {
                            const playersInRoom = game.players.filter(p => p.position === room && !p.eliminated);
                            const isCurrentRoom = currentPlayer?.position === room;
                            return (
                                <div key={room} className={`clue-room-cell ${isCurrentRoom ? 'current' : ''} ${playersInRoom.length > 0 ? 'occupied' : ''}`}>
                                    <div className="clue-room-name">{room}</div>
                                    {playersInRoom.length > 0 && (
                                        <div className="clue-room-players">
                                            {playersInRoom.slice(0, 3).map((p, i) => {
                                                const token = SUSPECT_TOKENS[SUSPECTS[game.players.indexOf(p) % SUSPECTS.length]];
                                                return (
                                                    <span key={p.peer_id} className="clue-room-token" title={p.nick}>
                                                        {token?.icon}
                                                    </span>
                                                );
                                            })}
                                            {playersInRoom.length > 3 && <span className="clue-room-more">+{playersInRoom.length - 3}</span>}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Weapons Display */}
                    <div className="clue-weapons-section">
                        <div className="clue-section-header">
                            <span className="clue-section-icon">⚔️</span>
                            <span>Weapons</span>
                        </div>
                        <div className="clue-weapons-grid">
                            {WEAPONS.map(w => {
                                const weapon = WEAPON_DISPLAY[w];
                                return (
                                    <div key={w} className="clue-weapon-card">
                                        <span className="clue-weapon-icon">{weapon?.icon}</span>
                                        <span className="clue-weapon-name">{w}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Suspects Grid */}
                    <div className="clue-suspects-section">
                        <div className="clue-section-header">
                            <span className="clue-section-icon">🎭</span>
                            <span>Suspects</span>
                        </div>
                        <div className="clue-suspects-grid">
                            {SUSPECTS.map((s, i) => {
                                const token = SUSPECT_TOKENS[s];
                                const inEnvelope = game.envelope?.suspect === s && game.phase === 'ended';
                                return (
                                    <div key={s} className={`clue-suspect-card ${inEnvelope ? 'revealed' : ''}`}
                                         style={{ '--token-color': token.color, '--token-bg': token.bg }}>
                                        <span className="clue-suspect-token">{token.icon}</span>
                                        <span className="clue-suspect-name">{s}</span>
                                        {inEnvelope && <span className="clue-suspect-guilty">GUILTY</span>}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="clue-actions-area">
                        {game.phase === 'roll' && isMyTurn && !game.diceRolled && (
                            <button className="clue-btn clue-roll-btn" onClick={() => onAction({ type: 'roll' })}>
                                🎲 Roll Dice
                            </button>
                        )}
                        {game.phase === 'suggest' && isMyTurn && (
                            <div className="clue-action-row">
                                <button className="clue-btn clue-suggest-btn" onClick={() => setShowSuggestModal(true)}>
                                    💭 Suggest
                                </button>
                                <button className="clue-btn clue-accuse-btn" onClick={() => setShowAccuseModal(true)}>
                                    ⚖️ Accuse
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Winner Banner */}
                    {game.phase === 'ended' && game.winner && (
                        <div className="clue-winner-banner">
                            <div className="clue-winner-crown">👑</div>
                            <div className="clue-winner-name">{game.players.find(p => p.peer_id === game.winner)?.nick}</div>
                            <div className="clue-winner-label">WINS!</div>
                            {game.envelope && (
                                <div className="clue-envelope-reveal">
                                    <div className="clue-reveal-item">🎭 {game.envelope.suspect}</div>
                                    <div className="clue-reveal-item">⚔️ {game.envelope.weapon}</div>
                                    <div className="clue-reveal-item">🚪 {game.envelope.room}</div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Right Panel: Notes & Cards */}
                <div className="clue-panel clue-notes-panel">
                    {/* My Cards */}
                    <div className="clue-my-cards">
                        <div className="clue-panel-title">
                            <span className="clue-panel-icon">🃏</span>
                            My Cards
                            <span className="clue-card-count">{myHand.length}</span>
                        </div>
                        <div className="clue-hand-grid">
                            {myHand.map(card => {
                                const isSuspect = SUSPECTS.includes(card);
                                const isWeapon = WEAPONS.includes(card);
                                return (
                                    <div key={card} className={`clue-hand-card ${isSuspect ? 'suspect' : ''} ${isWeapon ? 'weapon' : ''}`}>
                                        {card}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Detective Notes Toggle */}
                    <button className="clue-notes-toggle" onClick={() => setShowNotes(!showNotes)}>
                        <span className="clue-notes-toggle-icon">📝</span>
                        <span>Detective Notes</span>
                        <span className="clue-notes-toggle-arrow">{showNotes ? '▲' : '▼'}</span>
                    </button>

                    {showNotes && (
                        <div className="clue-notes-area">
                            <textarea
                                className="clue-notes-input"
                                placeholder="Track your deductions...&#10;&#10;E.g., 'Miss Scarlet + Candlestick not in Hall'"
                                value={myNotes}
                                onChange={e => setMyNotes(e.target.value)}
                            />
                        </div>
                    )}

                    {/* Suggestions History */}
                    {game.suggestions?.length > 0 && (
                        <div className="clue-history-section">
                            <div className="clue-panel-title">
                                <span className="clue-panel-icon">💭</span>
                                Suggestions
                            </div>
                            <div className="clue-history-list">
                                {game.suggestions.slice(-5).map((s, i) => (
                                    <div key={i} className="clue-history-entry">
                                        <span className="clue-history-player">{s.playerNick}:</span>
                                        <span className="clue-history-content">
                                            {s.suspect} + {s.weapon} in {s.room}
                                        </span>
                                        {s.disprovedCard && (
                                            <span className="clue-disproved">→ {s.disprovedCard}</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Accusations History */}
                    {game.accusations?.length > 0 && (
                        <div className="clue-history-section">
                            <div className="clue-panel-title">
                                <span className="clue-panel-icon">⚖️</span>
                                Accusations
                            </div>
                            <div className="clue-history-list">
                                {game.accusations.slice(-5).map((a, i) => (
                                    <div key={i} className={`clue-history-entry ${a.correct ? 'correct' : 'wrong'}`}>
                                        <span className="clue-history-player">{a.playerNick}:</span>
                                        <span className="clue-history-content">
                                            {a.suspect} + {a.weapon} in {a.room}
                                        </span>
                                        <span className="clue-result">{a.correct ? '✅' : '❌'}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="clue-footer">
                <button className="clue-footer-btn" onClick={() => onHelp('cluedo')}>❓ Help</button>
                <button className="clue-footer-btn clue-close-btn" onClick={onClose}>✕ Close</button>
            </div>

            {/* Suggestion Modal */}
            {showSuggestModal && (
                <div className="clue-modal-overlay" onClick={() => setShowSuggestModal(false)}>
                    <div className="clue-modal" onClick={e => e.stopPropagation()}>
                        <div className="clue-modal-header">
                            <span className="clue-modal-icon">💭</span>
                            <h2 className="clue-modal-title">Make a Suggestion</h2>
                        </div>
                        <div className="clue-modal-body">
                            <div className="clue-form-group">
                                <label className="clue-form-label">
                                    <span className="clue-form-icon">🎭</span>
                                    Suspect
                                </label>
                                <select
                                    className="clue-form-select"
                                    value={suggestSuspect}
                                    onChange={e => setSuggestSuspect(e.target.value)}
                                >
                                    <option value="">Select suspect...</option>
                                    {SUSPECTS.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div className="clue-form-group">
                                <label className="clue-form-label">
                                    <span className="clue-form-icon">⚔️</span>
                                    Weapon
                                </label>
                                <select
                                    className="clue-form-select"
                                    value={suggestWeapon}
                                    onChange={e => setSuggestWeapon(e.target.value)}
                                >
                                    <option value="">Select weapon...</option>
                                    {WEAPONS.map(w => <option key={w} value={w}>{w}</option>)}
                                </select>
                            </div>
                            <div className="clue-form-group">
                                <label className="clue-form-label">
                                    <span className="clue-form-icon">🚪</span>
                                    Room
                                </label>
                                <div className="clue-room-current">{currentPlayer?.position}</div>
                            </div>
                        </div>
                        <div className="clue-modal-footer">
                            <button className="clue-btn clue-cancel-btn" onClick={() => setShowSuggestModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="clue-btn clue-suggest-btn"
                                onClick={handleSuggestion}
                                disabled={!suggestSuspect || !suggestWeapon}
                            >
                                💭 Suggest
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Accusation Modal */}
            {showAccuseModal && (
                <div className="clue-modal-overlay" onClick={() => setShowAccuseModal(false)}>
                    <div className="clue-modal clue-accusation-modal" onClick={e => e.stopPropagation()}>
                        <div className="clue-modal-header">
                            <span className="clue-modal-icon">⚖️</span>
                            <h2 className="clue-modal-title">Make an Accusation</h2>
                        </div>
                        <div className="clue-modal-body">
                            <div className="clue-warning-banner">
                                ⚠️ This is final! Wrong accusation = elimination
                            </div>
                            <div className="clue-form-group">
                                <label className="clue-form-label">
                                    <span className="clue-form-icon">🎭</span>
                                    Suspect
                                </label>
                                <select
                                    className="clue-form-select"
                                    value={accuseSuspect}
                                    onChange={e => setAccuseSuspect(e.target.value)}
                                >
                                    <option value="">Select suspect...</option>
                                    {SUSPECTS.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div className="clue-form-group">
                                <label className="clue-form-label">
                                    <span className="clue-form-icon">⚔️</span>
                                    Weapon
                                </label>
                                <select
                                    className="clue-form-select"
                                    value={accuseWeapon}
                                    onChange={e => setAccuseWeapon(e.target.value)}
                                >
                                    <option value="">Select weapon...</option>
                                    {WEAPONS.map(w => <option key={w} value={w}>{w}</option>)}
                                </select>
                            </div>
                            <div className="clue-form-group">
                                <label className="clue-form-label">
                                    <span className="clue-form-icon">🚪</span>
                                    Room
                                </label>
                                <select
                                    className="clue-form-select"
                                    value={accuseRoom}
                                    onChange={e => setAccuseRoom(e.target.value)}
                                >
                                    <option value="">Select room...</option>
                                    {ROOMS.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="clue-modal-footer">
                            <button className="clue-btn clue-cancel-btn" onClick={() => setShowAccuseModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="clue-btn clue-accuse-btn"
                                onClick={handleAccusation}
                                disabled={!accuseSuspect || !accuseWeapon || !accuseRoom}
                            >
                                ⚖️ Accuse!
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});
