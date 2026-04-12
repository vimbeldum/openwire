import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import '../styles/cluedo.css';

const SUSPECTS = ['Miss Scarlet', 'Colonel Mustard', 'Mrs. White', 'Mr. Green', 'Mrs. Peacock', 'Professor Plum'];
const WEAPONS = ['Candlestick', 'Dagger', 'Lead Pipe', 'Revolver', 'Rope', 'Wrench'];
const ROOMS = ['Hall', 'Lounge', 'Dining Room', 'Kitchen', 'Ballroom', 'Conservatory', 'Billiard Room', 'Library', 'Study'];

export default memo(function CluedoBoard({ game, myId, myNick, wallet, onAction, onClose, onHelp, isHost, onReady, onNewRound, readyCount, totalBettors, isReady }) {
    const [showSuggestModal, setShowSuggestModal] = useState(false);
    const [showAccuseModal, setShowAccuseModal] = useState(false);
    const [suggestSuspect, setSuggestSuspect] = useState('');
    const [suggestWeapon, setSuggestWeapon] = useState('');
    const [accuseSuspect, setAccuseSuspect] = useState('');
    const [accuseWeapon, setAccuseWeapon] = useState('');
    const [accuseRoom, setAccuseRoom] = useState('');

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
    };

    return (
        <div className="clue-container">
            <div className="clue-header">
                <div className="clue-title">🔍 Cluedo</div>
                <div className="clue-phase">{phaseLabels[game.phase] || game.phase}</div>
                <div className="clue-current-room">📍 {currentPlayer?.position || 'Lobby'}</div>
            </div>

            {/* Dice Display */}
            {game.dice[0] > 0 && (
                <div className="clue-dice">
                    <span className="clue-die">{game.dice[0]}</span>
                    <span className="clue-die">{game.dice[1]}</span>
                    <span className="clue-dice-sum">= {game.dice[0] + game.dice[1]}</span>
                </div>
            )}

            {/* Player List */}
            <div className="clue-players">
                {game.players.map((p, i) => (
                    <div key={p.peer_id} className={`clue-player ${i === game.currentPlayer ? 'active' : ''} ${p.eliminated ? 'eliminated' : ''}`}>
                        <div className="clue-player-avatar">{['🧥', '🎖️', '👵', '💚', '🦚', '🍆'][i % 6]}</div>
                        <div className="clue-player-info">
                            <div className="clue-player-name">{p.nick}</div>
                            <div className="clue-player-room">📍 {p.position || '-'}</div>
                        </div>
                        {i === game.currentPlayer && <div className="clue-turn-indicator">▶</div>}
                        {p.eliminated && <div className="clue-eliminated">💀</div>}
                    </div>
                ))}
            </div>

            {/* Suspects */}
            <div className="clue-section">
                <div className="clue-section-title">🎭 Suspects</div>
                <div className="clue-card-grid">
                    {SUSPECTS.map(s => (
                        <div key={s} className={`clue-card clue-suspect ${s === game.envelope?.suspect && game.phase === 'ended' ? 'revealed' : ''}`}>
                            {s}
                        </div>
                    ))}
                </div>
            </div>

            {/* Weapons */}
            <div className="clue-section">
                <div className="clue-section-title">⚔️ Weapons</div>
                <div className="clue-card-grid">
                    {WEAPONS.map(w => (
                        <div key={w} className={`clue-card clue-weapon ${w === game.envelope?.weapon && game.phase === 'ended' ? 'revealed' : ''}`}>
                            {w}
                        </div>
                    ))}
                </div>
            </div>

            {/* Rooms */}
            <div className="clue-section">
                <div className="clue-section-title">🚪 Rooms</div>
                <div className="clue-room-grid">
                    {ROOMS.map(r => (
                        <div key={r} className={`clue-room ${r === game.envelope?.room && game.phase === 'ended' ? 'revealed' : ''}`}>
                            {r}
                        </div>
                    ))}
                </div>
            </div>

            {/* My Hand */}
            <div className="clue-section">
                <div className="clue-section-title">🃏 My Cards ({myHand.length})</div>
                <div className="clue-hand">
                    {myHand.map(card => (
                        <div key={card} className="clue-hand-card">{card}</div>
                    ))}
                </div>
            </div>

            {/* Suggestions History */}
            {game.suggestions?.length > 0 && (
                <div className="clue-section">
                    <div className="clue-section-title">💭 Suggestions</div>
                    <div className="clue-history">
                        {game.suggestions.slice(-3).map((s, i) => (
                            <div key={i} className="clue-history-entry">
                                <span className="clue-history-player">{s.playerNick}:</span>
                                <span>{s.suspect} + {s.weapon} in {s.room}</span>
                                {s.disprovedCard && <span className="clue-disproved"> → {s.disprovedCard}</span>}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Accusations History */}
            {game.accusations?.length > 0 && (
                <div className="clue-section">
                    <div className="clue-section-title">⚖️ Accusations</div>
                    <div className="clue-history">
                        {game.accusations.slice(-3).map((a, i) => (
                            <div key={i} className={`clue-history-entry ${a.correct ? 'clue-correct' : 'clue-wrong'}`}>
                                <span className="clue-history-player">{a.playerNick}:</span>
                                <span>{a.suspect} + {a.weapon} in {a.room}</span>
                                <span className="clue-result">{a.correct ? ' ✅' : ' ❌'}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Action Buttons */}
            <div className="clue-actions">
                {game.phase === 'roll' && isMyTurn && !game.diceRolled && (
                    <button className="clue-btn clue-roll-btn" onClick={() => onAction({ type: 'roll' })}>
                        🎲 Roll Dice
                    </button>
                )}

                {game.phase === 'move' && isMyTurn && (
                    <div className="clue-move-options">
                        <button className="clue-btn" onClick={() => onAction({ type: 'stay' })}>Stay Here</button>
                    </div>
                )}

                {game.phase === 'suggest' && isMyTurn && (
                    <div className="clue-action-row">
                        <button className="clue-btn clue-suggest-btn" onClick={() => setShowSuggestModal(true)}>
                            💭 Make Suggestion
                        </button>
                        <button className="clue-btn clue-accuse-btn" onClick={() => setShowAccuseModal(true)}>
                            ⚖️ Make Accusation
                        </button>
                    </div>
                )}
            </div>

            {/* Winner */}
            {game.phase === 'ended' && game.winner && (
                <div className="clue-winner">
                    🏆 {game.players.find(p => p.peer_id === game.winner)?.nick} Wins!
                </div>
            )}

            {/* Suggestion Modal */}
            {showSuggestModal && (
                <div className="clue-modal-overlay">
                    <div className="clue-modal">
                        <div className="clue-modal-title">💭 Make a Suggestion</div>
                        <div className="clue-modal-content">
                            <div className="clue-form-group">
                                <label>Suspect:</label>
                                <select value={suggestSuspect} onChange={e => setSuggestSuspect(e.target.value)}>
                                    <option value="">Select...</option>
                                    {SUSPECTS.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div className="clue-form-group">
                                <label>Weapon:</label>
                                <select value={suggestWeapon} onChange={e => setSuggestWeapon(e.target.value)}>
                                    <option value="">Select...</option>
                                    {WEAPONS.map(w => <option key={w} value={w}>{w}</option>)}
                                </select>
                            </div>
                            <div className="clue-form-group">
                                <label>Room: <em>{currentPlayer?.position}</em></label>
                            </div>
                        </div>
                        <div className="clue-modal-actions">
                            <button className="clue-btn" onClick={() => setShowSuggestModal(false)}>Cancel</button>
                            <button className="clue-btn clue-suggest-btn" onClick={handleSuggestion} disabled={!suggestSuspect || !suggestWeapon}>Submit</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Accusation Modal */}
            {showAccuseModal && (
                <div className="clue-modal-overlay">
                    <div className="clue-modal">
                        <div className="clue-modal-title">⚖️ Make an Accusation</div>
                        <div className="clue-modal-content">
                            <div className="clue-form-group">
                                <label>Suspect:</label>
                                <select value={accuseSuspect} onChange={e => setAccuseSuspect(e.target.value)}>
                                    <option value="">Select...</option>
                                    {SUSPECTS.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div className="clue-form-group">
                                <label>Weapon:</label>
                                <select value={accuseWeapon} onChange={e => setAccuseWeapon(e.target.value)}>
                                    <option value="">Select...</option>
                                    {WEAPONS.map(w => <option key={w} value={w}>{w}</option>)}
                                </select>
                            </div>
                            <div className="clue-form-group">
                                <label>Room:</label>
                                <select value={accuseRoom} onChange={e => setAccuseRoom(e.target.value)}>
                                    <option value="">Select...</option>
                                    {ROOMS.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                            </div>
                            <div className="clue-warning">⚠️ This is final! Wrong accusation = elimination</div>
                        </div>
                        <div className="clue-modal-actions">
                            <button className="clue-btn" onClick={() => setShowAccuseModal(false)}>Cancel</button>
                            <button className="clue-btn clue-accuse-btn" onClick={handleAccusation} disabled={!accuseSuspect || !accuseWeapon || !accuseRoom}>Accuse!</button>
                        </div>
                    </div>
                </div>
            )}

            <div className="clue-footer">
                <button className="clue-help-btn" onClick={() => onHelp('cluedo')}>❓ Help</button>
                <button className="clue-close-btn" onClick={onClose}>✕ Close</button>
            </div>
        </div>
    );
});
