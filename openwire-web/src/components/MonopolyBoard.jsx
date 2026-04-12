import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import '../styles/monopoly.css';

const BOARD_SPACES = [
    { id: 0,  type: 'go',         name: 'GO' },
    { id: 1,  type: 'property',   name: 'Mediterranean' },
    { id: 2,  type: 'community',  name: 'Community' },
    { id: 3,  type: 'property',   name: 'Baltic' },
    { id: 4,  type: 'tax',        name: 'Tax' },
    { id: 5,  type: 'railroad',   name: 'Reading' },
    { id: 6,  type: 'property',   name: 'Oriental' },
    { id: 7,  type: 'chance',     name: 'Chance' },
    { id: 8,  type: 'property',   name: 'Vermont' },
    { id: 9,  type: 'property',   name: 'Connecticut' },
    { id: 10, type: 'jail',       name: 'Jail' },
    { id: 11, type: 'property',   name: 'St. Charles' },
    { id: 12, type: 'utility',    name: 'Electric' },
    { id: 13, type: 'property',   name: 'States' },
    { id: 14, type: 'property',   name: 'Virginia' },
    { id: 15, type: 'railroad',   name: 'Penn RR' },
    { id: 16, type: 'property',   name: 'St. James' },
    { id: 17, type: 'community',  name: 'Community' },
    { id: 18, type: 'property',   name: 'Tennessee' },
    { id: 19, type: 'property',   name: 'New York' },
    { id: 20, type: 'free',       name: 'Free Park' },
    { id: 21, type: 'property',   name: 'Kentucky' },
    { id: 22, type: 'chance',     name: 'Chance' },
    { id: 23, type: 'property',   name: 'Indiana' },
    { id: 24, type: 'property',   name: 'Illinois' },
    { id: 25, type: 'railroad',   name: 'B&O' },
    { id: 26, type: 'property',   name: 'Atlantic' },
    { id: 27, type: 'property',   name: 'Ventnor' },
    { id: 28, type: 'utility',    name: 'Water' },
    { id: 29, type: 'property',   name: 'Marvin' },
    { id: 30, type: 'gotojail',  name: 'Go Jail' },
    { id: 31, type: 'property',   name: 'Pacific' },
    { id: 32, type: 'property',   name: 'N. Carol' },
    { id: 33, type: 'community',  name: 'Community' },
    { id: 34, type: 'property',   name: 'Penn' },
    { id: 35, type: 'railroad',   name: 'Short' },
    { id: 36, type: 'chance',     name: 'Chance' },
    { id: 37, type: 'property',   name: 'Park' },
    { id: 38, type: 'tax',        name: 'Luxury' },
    { id: 39, type: 'property',   name: 'Boardwalk' },
];

const SPACE_COLORS = {
    brown: '#8B4513',
    lightBlue: '#87CEEB',
    pink: '#FF69B4',
    orange: '#FF8C00',
    red: '#DC143C',
    yellow: '#FFD700',
    green: '#228B22',
    darkBlue: '#00008B',
    railroad: '#666',
    utility: '#999',
    go: '#228B22',
    jail: '#FFA500',
    community: '#9370DB',
    chance: '#FF4500',
    tax: '#DC143C',
    free: '#87CEEB',
    gotojail: '#8B0000',
};

function getSpaceColor(space, game) {
    if (space.type === 'property' || space.type === 'railroad' || space.type === 'utility') {
        const prop = game.properties?.find(p => p.id === space.propId || p.name?.toLowerCase().includes(space.name?.toLowerCase()));
        if (prop) {
            if (prop.group === 'railroad') return SPACE_COLORS.railroad;
            if (prop.group === 'utility') return SPACE_COLORS.utility;
            return SPACE_COLORS[prop.group] || '#ccc';
        }
    }
    return SPACE_COLORS[space.type] || '#ccc';
}

export default memo(function MonopolyBoard({ game, myId, myNick, wallet, onAction, onClose, onHelp, isHost, onReady, onNewRound, readyCount, totalBettors, isReady }) {
    const [selectedProp, setSelectedProp] = useState(null);

    const currentPlayer = game?.players?.[game.currentPlayer];
    const myPlayer = game?.players?.find(p => p.peer_id === myId);

    const canAct = isHost && currentPlayer?.peer_id === myId;
    const isMyTurn = currentPlayer?.peer_id === myId;

    // Get property info
    const myProperties = useMemo(() => {
        if (!game || !myPlayer) return [];
        return game.properties?.filter(p => p.owner === myId) || [];
    }, [game, myId]);

    // Player positions on board
    const playerTokens = useMemo(() => {
        if (!game?.players) return [];
        return game.players.map((p, i) => ({
            ...p,
            token: ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠', '⚫', '⚪'][i % 8],
        }));
    }, [game?.players]);

    if (!game) return null;

    const phaseLabels = {
        lobby: 'Waiting for players...',
        rolling: 'Roll the dice!',
        property: 'Buy or Auction?',
        auction: 'Auction in progress',
        jail: 'In Jail',
        trade: 'Trading',
        ended: 'Game Over!',
    };

    return (
        <div className="mono-container">
            <div className="mono-header">
                <div className="mono-title">🏠 Monopoly</div>
                <div className="mono-phase">{phaseLabels[game.phase] || game.phase}</div>
                <div className="mono-turn">Turn {game.turnNumber}</div>
            </div>

            {/* Player List */}
            <div className="mono-players">
                {game.players.map((p, i) => (
                    <div key={p.peer_id} className={`mono-player ${i === game.currentPlayer ? 'active' : ''} ${p.eliminated ? 'eliminated' : ''}`}>
                        <div className="mono-token">{['🔴', '🔵', '🟢', '🟡', '🟣', '🟠', '⚫', '⚪'][i % 8]}</div>
                        <div className="mono-player-info">
                            <div className="mono-player-name">{p.nick}</div>
                            <div className="mono-player-money">${p.money?.toLocaleString()}</div>
                            {p.properties?.length > 0 && <div className="mono-player-props">{p.properties.length} props</div>}
                        </div>
                        {i === game.currentPlayer && <div className="mono-turn-indicator">▶</div>}
                        {p.eliminated && <div className="mono-eliminated">💀</div>}
                    </div>
                ))}
            </div>

            {/* Dice Display */}
            {game.dice[0] > 0 && (
                <div className="mono-dice">
                    <span className="mono-die">{game.dice[0]}</span>
                    <span className="mono-die">{game.dice[1]}</span>
                    {game.dice[0] === game.dice[1] && <span className="mono-double">DOUBLE!</span>}
                </div>
            )}

            {/* Board (simplified 10x10 grid with property cards) */}
            <div className="mono-board">
                <div className="mono-board-inner">
                    {BOARD_SPACES.slice(0, 10).map((space, i) => (
                        <div key={space.id} className={`mono-space mono-space-top ${space.type}`}>
                            <div className="mono-space-color" style={{ background: getSpaceColor(space, game) }} />
                            <div className="mono-space-name">{space.name}</div>
                            {playerTokens.filter(p => p.position === i).map((p, j) => (
                                <div key={j} className="mono-token-on-board">{p.token}</div>
                            ))}
                        </div>
                    ))}
                    <div className="mono-board-center">
                        <div className="mono-center-content">
                            <div className="mono-center-title">MONOPOLY</div>
                            {currentPlayer && (
                                <div className="mono-current-turn">
                                    {currentPlayer.nick}'s turn
                                </div>
                            )}
                            {game.phase === 'property' && currentPlayer?.peer_id === myId && (
                                <div className="mono-action-area">
                                    <button className="mono-btn mono-buy-btn" onClick={() => onAction({ type: 'buy' })}>
                                        Buy Property
                                    </button>
                                    <button className="mono-btn mono-auction-btn" onClick={() => onAction({ type: 'auction' })}>
                                        Auction
                                    </button>
                                </div>
                            )}
                            {game.phase === 'rolling' && isMyTurn && (
                                <button className="mono-btn mono-roll-btn" onClick={() => onAction({ type: 'roll' })}>
                                    🎲 Roll Dice
                                </button>
                            )}
                        </div>
                    </div>
                    {BOARD_SPACES.slice(30, 40).reverse().map((space, i) => (
                        <div key={space.id} className={`mono-space mono-space-bottom ${space.type}`}>
                            <div className="mono-space-color" style={{ background: getSpaceColor(space, game) }} />
                            <div className="mono-space-name">{space.name}</div>
                            {playerTokens.filter(p => p.position === 39 - i).map((p, j) => (
                                <div key={j} className="mono-token-on-board">{p.token}</div>
                            ))}
                        </div>
                    ))}
                    {BOARD_SPACES.slice(20, 30).map((space, i) => (
                        <div key={space.id} className={`mono-space mono-space-left ${space.type}`}>
                            <div className="mono-space-color" style={{ background: getSpaceColor(space, game) }} />
                            <div className="mono-space-name">{space.name}</div>
                            {playerTokens.filter(p => p.position === 30 + i).map((p, j) => (
                                <div key={j} className="mono-token-on-board">{p.token}</div>
                            ))}
                        </div>
                    ))}
                    {BOARD_SPACES.slice(10, 20).reverse().map((space, i) => (
                        <div key={space.id} className={`mono-space mono-space-right ${space.type}`}>
                            <div className="mono-space-color" style={{ background: getSpaceColor(space, game) }} />
                            <div className="mono-space-name">{space.name}</div>
                            {playerTokens.filter(p => p.position === 20 - i).map((p, j) => (
                                <div key={j} className="mono-token-on-board">{p.token}</div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>

            {/* Property Cards */}
            <div className="mono-properties-section">
                <div className="mono-section-title">My Properties ({myProperties.length})</div>
                <div className="mono-property-grid">
                    {myProperties.map(prop => (
                        <div key={prop.id} className="mono-property-card" style={{ borderColor: SPACE_COLORS[prop.group] }}>
                            <div className="mono-prop-name">{prop.name}</div>
                            <div className="mono-prop-rent">Rent: ${prop.rent[0]}</div>
                        </div>
                    ))}
                    {myProperties.length === 0 && <div className="mono-no-props">No properties yet</div>}
                </div>
            </div>

            {/* End Turn Button */}
            {game.phase === 'rolling' && isMyTurn && game.diceRolled && (
                <button className="mono-btn mono-end-btn" onClick={() => onAction({ type: 'endturn' })}>
                    End Turn
                </button>
            )}

            {/* Winner */}
            {game.phase === 'ended' && game.winner && (
                <div className="mono-winner">
                    🏆 {game.players.find(p => p.peer_id === game.winner)?.nick} Wins!
                </div>
            )}

            {/* Log */}
            {game.log?.length > 0 && (
                <div className="mono-log">
                    {game.log.slice(-5).map((entry, i) => (
                        <div key={i} className="mono-log-entry">{entry}</div>
                    ))}
                </div>
            )}

            <div className="mono-footer">
                <button className="mono-help-btn" onClick={() => onHelp('monopoly')}>❓ Help</button>
                <button className="mono-close-btn" onClick={onClose}>✕ Close</button>
            </div>
        </div>
    );
});
