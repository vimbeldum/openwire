import { useEffect, useRef, useState, useMemo, memo } from 'react';
import '../styles/monopoly.css';

/* ═══════════════════════════════════════════════════════════
   Monopoly Board — Complete 10x10 with All 40 Spaces
   ═══════════════════════════════════════════════════════════ */

// Full board data matching src/lib/monopoly.js
const BOARD_SPACES = [
    { id: 0,  type: 'go',         name: 'GO',             group: 'go',       price: null },
    { id: 1,  type: 'property',   name: 'Mediterranean',   group: 'brown',     propId: 1,  price: 60 },
    { id: 2,  type: 'community',  name: 'Community Chest',  group: 'community', price: null },
    { id: 3,  type: 'property',   name: 'Baltic',          group: 'brown',     propId: 2,  price: 60 },
    { id: 4,  type: 'tax',        name: 'Income Tax',      group: 'tax',       price: 200 },
    { id: 5,  type: 'railroad',   name: 'Reading R.R.',     group: 'railroad',  propId: 23, price: 200 },
    { id: 6,  type: 'property',   name: 'Oriental',        group: 'lightBlue', propId: 3,  price: 100 },
    { id: 7,  type: 'chance',     name: 'Chance',          group: 'chance',    price: null },
    { id: 8,  type: 'property',   name: 'Vermont',          group: 'lightBlue', propId: 4,  price: 100 },
    { id: 9,  type: 'property',   name: 'Connecticut',     group: 'lightBlue', propId: 5,  price: 120 },
    { id: 10, type: 'jail',        name: 'Jail',            group: 'jail',      price: null },
    { id: 11, type: 'property',   name: 'St. Charles',     group: 'pink',      propId: 6,  price: 140 },
    { id: 12, type: 'utility',    name: 'Electric Co.',    group: 'utility',   propId: 27, price: 150 },
    { id: 13, type: 'property',   name: 'States',           group: 'pink',      propId: 7,  price: 140 },
    { id: 14, type: 'property',   name: 'Virginia',        group: 'pink',      propId: 8,  price: 160 },
    { id: 15, type: 'railroad',   name: 'Pennsylvania R.R.',group: 'railroad',  propId: 24, price: 200 },
    { id: 16, type: 'property',   name: 'St. James',       group: 'orange',    propId: 9,  price: 180 },
    { id: 17, type: 'community',  name: 'Community Chest',  group: 'community', price: null },
    { id: 18, type: 'property',   name: 'Tennessee',        group: 'orange',    propId: 10, price: 180 },
    { id: 19, type: 'property',   name: 'New York',         group: 'orange',    propId: 11, price: 200 },
    { id: 20, type: 'free',       name: 'Free Parking',    group: 'free',      price: null },
    { id: 21, type: 'property',   name: 'Kentucky',         group: 'red',       propId: 12, price: 220 },
    { id: 22, type: 'chance',     name: 'Chance',           group: 'chance',    price: null },
    { id: 23, type: 'property',   name: 'Indiana',          group: 'red',       propId: 13, price: 220 },
    { id: 24, type: 'property',   name: 'Illinois',         group: 'red',       propId: 14, price: 240 },
    { id: 25, type: 'railroad',   name: 'B&O R.R.',          group: 'railroad',  propId: 25, price: 200 },
    { id: 26, type: 'property',   name: 'Atlantic',          group: 'yellow',    propId: 15, price: 260 },
    { id: 27, type: 'property',   name: 'Ventnor',           group: 'yellow',    propId: 16, price: 260 },
    { id: 28, type: 'utility',    name: 'Water Works',       group: 'utility',   propId: 28, price: 150 },
    { id: 29, type: 'property',   name: 'Marvin Gardens',    group: 'yellow',    propId: 17, price: 280 },
    { id: 30, type: 'gotojail',   name: 'Go To Jail',       group: 'gotojail',   price: null },
    { id: 31, type: 'property',   name: 'Pacific',           group: 'green',     propId: 18, price: 300 },
    { id: 32, type: 'property',   name: 'N. Carolina',      group: 'green',     propId: 19, price: 300 },
    { id: 33, type: 'community',  name: 'Community Chest',  group: 'community', price: null },
    { id: 34, type: 'property',   name: 'Pennsylvania',      group: 'green',     propId: 20, price: 320 },
    { id: 35, type: 'railroad',   name: 'Short Line',       group: 'railroad',  propId: 26, price: 200 },
    { id: 36, type: 'chance',     name: 'Chance',             group: 'chance',    price: null },
    { id: 37, type: 'property',   name: 'Park Place',        group: 'darkBlue',  propId: 21, price: 350 },
    { id: 38, type: 'tax',        name: 'Luxury Tax',        group: 'tax',       price: 100 },
    { id: 39, type: 'property',   name: 'Boardwalk',         group: 'darkBlue',  propId: 22, price: 400 },
];

// Grid positions for all 40 spaces in a 10x10 grid
// Format: position -> { gridRow, gridCol } (1-based for CSS Grid)
// Monopoly board layout (counterclockwise from GO at bottom-right):
const GRID_POSITIONS = {
    0:  { row: 11, col: 11 }, // GO (bottom-right corner)
    1:  { row: 11, col: 10 },
    2:  { row: 11, col: 9  },
    3:  { row: 11, col: 8  },
    4:  { row: 11, col: 7  },
    5:  { row: 11, col: 6  },
    6:  { row: 11, col: 5  },
    7:  { row: 11, col: 4  },
    8:  { row: 11, col: 3  },
    9:  { row: 11, col: 2  },
    10: { row: 11, col: 1  }, // Jail (bottom-left corner)
    11: { row: 10, col: 1  },
    12: { row: 9,  col: 1  },
    13: { row: 8,  col: 1  },
    14: { row: 7,  col: 1  },
    15: { row: 6,  col: 1  },
    16: { row: 5,  col: 1  },
    17: { row: 4,  col: 1  },
    18: { row: 3,  col: 1  },
    19: { row: 2,  col: 1  },
    20: { row: 1,  col: 1  }, // Free Parking (top-left corner)
    21: { row: 1,  col: 2  },
    22: { row: 1,  col: 3  },
    23: { row: 1,  col: 4  },
    24: { row: 1,  col: 5  },
    25: { row: 1,  col: 6  },
    26: { row: 1,  col: 7  },
    27: { row: 1,  col: 8  },
    28: { row: 1,  col: 9  },
    29: { row: 1,  col: 10 },
    30: { row: 1,  col: 11 }, // Go To Jail (top-right corner)
    31: { row: 2,  col: 11 },
    32: { row: 3,  col: 11 },
    33: { row: 4,  col: 11 },
    34: { row: 5,  col: 11 },
    35: { row: 6,  col: 11 },
    36: { row: 7,  col: 11 },
    37: { row: 8,  col: 11 },
    38: { row: 9,  col: 11 },
    39: { row: 10, col: 11 },
};

// Property group colors
const GROUP_COLORS = {
    brown:      '#8B4513',
    lightBlue:  '#87CEEB',
    pink:       '#FF69B4',
    orange:     '#FF8C00',
    red:        '#DC143C',
    yellow:     '#FFD700',
    green:      '#228B22',
    darkBlue:   '#00008B',
    railroad:   '#4a4a4a',
    utility:    '#6c6c6c',
    go:         '#27ae60',
    jail:       '#e67e22',
    free:       '#3498db',
    community:  '#9b59b6',
    chance:     '#e74c3c',
    tax:        '#f39c12',
    gotojail:   '#c0392b',
};

// Player token emojis
const TOKEN_EMOJIS = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠', '⚫', '⚪'];

const GROUP_LABELS = {
    brown: 'Brown',
    lightBlue: 'Light Blue',
    pink: 'Pink',
    orange: 'Orange',
    red: 'Red',
    yellow: 'Yellow',
    green: 'Green',
    darkBlue: 'Dark Blue',
    railroad: 'Railroad',
    utility: 'Utility',
    go: 'Start',
    jail: 'Jail',
    free: 'Free Parking',
    community: 'Community Chest',
    chance: 'Chance',
    tax: 'Tax',
    gotojail: 'Go To Jail',
};

// Dice dot patterns
const DICE_PATTERNS = {
    1: [0,0,0,0,1,0,0,0,0],
    2: [1,0,0,0,0,0,0,0,1],
    3: [1,0,0,0,1,0,0,0,1],
    4: [1,0,1,0,0,0,1,0,1],
    5: [1,0,1,0,1,0,1,0,1],
    6: [1,0,1,1,0,1,1,0,1],
};

// Dice Face Component
const DiceFace = memo(function DiceFace({ value, rolling }) {
    const pattern = DICE_PATTERNS[value] || DICE_PATTERNS[1];
    return (
        <div className={`mono-die ${rolling ? 'rolling' : ''}`}>
            <div className="mono-die-face">
                {pattern.map((active, i) => (
                    <div key={i} className={`mono-die-dot ${active ? 'visible' : ''}`} />
                ))}
            </div>
        </div>
    );
});

// Space Component
const Space = memo(function Space({ space, players, onSelect }) {
    const color = GROUP_COLORS[space.group] || '#999';
    const playersHere = players.filter(p => p.position === space.id);
    const isCorner = space.id === 0 || space.id === 10 || space.id === 20 || space.id === 30;

    return (
        <div 
            className={`mono-space ${space.type} ${space.group} ${isCorner ? 'corner' : ''}`}
            onClick={() => onSelect && onSelect(space)}
        >
            {color && (
                <div 
                    className="mono-space-color-bar" 
                    style={{ background: color }}
                />
            )}
            <div className="mono-space-name">{space.name}</div>
            {space.price && (space.type === 'property' || space.type === 'railroad' || space.type === 'utility') && (
                <div className="mono-space-price">${space.price}</div>
            )}
            {space.type === 'tax' && space.price && (
                <div className="mono-space-price">-${space.price}</div>
            )}
            {playersHere.length > 0 && (
                <div className="mono-tokens-on-space">
                    {playersHere.map((p, i) => (
                        <span key={i} className="mono-token-on-board">
                            {TOKEN_EMOJIS[p.playerIndex % 8]}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
});

// Property Card Component
const PropertyCard = memo(function PropertyCard({ prop }) {
    return (
        <div className={`mono-property-card ${prop.group}`}>
            <div className="mono-prop-header">
                <div className="mono-prop-name">{prop.name}</div>
            </div>
            <div className="mono-prop-group">{GROUP_LABELS[prop.group] || prop.group}</div>
            <div className="mono-prop-rent">
                <span className="mono-prop-rent-label">Rent</span>
                ${prop.rent[0]}
            </div>
            {prop.group !== 'railroad' && prop.group !== 'utility' && (
                <div className="mono-prop-houses">
                    {[...Array(prop.houses || 0)].map((_, i) => (
                        <div key={i} className="mono-house" />
                    ))}
                </div>
            )}
        </div>
    );
});

// Main MonopolyBoard Component
export default memo(function MonopolyBoard({ 
    game, 
    myId, 
    wallet, 
    onAction, 
    onClose, 
    onHelp,
    isHost,
}) {
    const [rolling, setRolling] = useState(false);
    const prevDiceRef = useRef(game?.dice || [0, 0]);
    const rollTimerRef = useRef(null);

    const currentPlayer = game?.players?.[game.currentPlayer];
    const myPlayer = useMemo(() => 
        game?.players?.find(p => p.peer_id === myId),
        [game?.players, myId]
    );
    const isMyTurn = currentPlayer?.peer_id === myId;
    const currentSpace = currentPlayer ? BOARD_SPACES[currentPlayer.position] : null;
    const activeProperty = useMemo(() => {
        if (!currentSpace?.propId || !game?.properties) return null;
        return game.properties.find((prop) => prop.id === currentSpace.propId) || null;
    }, [currentSpace?.propId, game?.properties]);

    const playerTokens = useMemo(() => {
        if (!game?.players) return [];
        return game.players
            .filter(p => !p.eliminated)
            .map((p, i) => ({
                ...p,
                playerIndex: i,
                token: TOKEN_EMOJIS[i % 8],
            }));
    }, [game?.players]);

    const myProperties = useMemo(() => {
        if (!game || !myId) return [];
        return game.properties?.filter(p => p.owner === myId) || [];
    }, [game, myId]);

    const handleRoll = () => {
        setRolling(true);
        onAction({ type: 'roll' });
    };

    useEffect(() => {
        const prevDice = prevDiceRef.current || [0, 0];
        const nextDice = game?.dice || [0, 0];
        const diceChanged = prevDice[0] !== nextDice[0] || prevDice[1] !== nextDice[1];

        if (rolling && diceChanged) {
            if (rollTimerRef.current) clearTimeout(rollTimerRef.current);
            rollTimerRef.current = setTimeout(() => {
                setRolling(false);
                rollTimerRef.current = null;
            }, 550);
        }

        prevDiceRef.current = nextDice;
    }, [game?.dice, rolling]);

    useEffect(() => () => {
        if (rollTimerRef.current) clearTimeout(rollTimerRef.current);
    }, []);

    const handleSpaceSelect = (space) => {
        // Could show property details modal here
    };

    const phaseLabels = {
        lobby: 'Waiting for players...',
        rolling: 'Roll the dice!',
        property: 'Buy or Auction?',
        auction: 'Auction in progress',
        jail: 'In Jail',
        trade: 'Trading',
        ended: 'Game Over!',
    };

    const actionHint = useMemo(() => {
        if (!currentPlayer) return 'Waiting for the next turn.';
        if (game.phase === 'jail') return isMyTurn ? 'Roll doubles or pay $50 to get out.' : `${currentPlayer.nick} is trying to escape jail.`;
        if (game.phase === 'property') {
            if (activeProperty?.owner) {
                const owner = game.players.find((player) => player.peer_id === activeProperty.owner);
                return owner ? `${activeProperty.name} is owned by ${owner.nick}. Rent is already settled.` : 'This property is already owned.';
            }
            return isMyTurn
                ? `Decide whether to buy ${activeProperty?.name || 'this space'} or send it to auction.`
                : `${currentPlayer.nick} is deciding whether to buy or auction this property.`;
        }
        if (game.phase === 'rolling') return isMyTurn ? 'Roll, then end your turn unless you hit a purchase decision or a double.' : `Waiting for ${currentPlayer.nick} to roll.`;
        if (game.phase === 'ended') return 'The last remaining player wins the board.';
        return 'Keep the cash flow positive and control complete color sets.';
    }, [activeProperty, currentPlayer, game.phase, game.players, isMyTurn]);

    const centerBadge = currentPlayer?.inJail
        ? 'In Jail'
        : activeProperty?.owner
            ? 'Owned Space'
            : currentSpace?.type === 'property' || currentSpace?.type === 'railroad' || currentSpace?.type === 'utility'
                ? 'Buyable Space'
                : GROUP_LABELS[currentSpace?.group] || 'Board Space';

    if (!game) {
        return (
            <div className="mono-container">
                <div className="mono-loading">Loading Monopoly...</div>
            </div>
        );
    }

    if (game.phase === 'lobby') {
        const canStart = game.players.length >= 2;
        return (
            <div className="mono-container">
                <div className="mono-header">
                    <div className="mono-title">🏠 MONOPOLY</div>
                    <div className="mono-phase">Waiting for players...</div>
                    <div className="mono-turn">Need {Math.max(0, 2 - game.players.length)} more players</div>
                </div>
                <div className="mono-properties-section mono-lobby-panel">
                    <div className="mono-section-title">Lobby</div>
                    <div className="mono-lobby-copy">
                        {isHost
                            ? (game.players.length >= 2
                                ? 'Players are in. Start the game when you are ready.'
                                : 'Invite room members to join this Monopoly table.')
                            : (game.players.length >= 2
                                ? 'Enough players are here. Start will sync through the host.'
                                : 'You are in the lobby. Wait for more players or the host.')}
                    </div>
                    <div className="mono-lobby-copy">Players joined: {game.players.length} / 8</div>
                </div>
                <div className="mono-players">
                    {game.players.map((p, i) => (
                        <div key={p.peer_id} className="mono-player">
                            <div className="mono-token">{TOKEN_EMOJIS[i % 8]}</div>
                            <div className="mono-player-info">
                                <div className="mono-player-name">{p.nick}{p.peer_id === myId ? ' (You)' : ''}</div>
                                <div className="mono-player-money">${p.money?.toLocaleString()}</div>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="mono-footer">
                    <button className="mono-help-btn" onClick={() => onAction({ type: 'begin' })} disabled={!canStart}>
                        {isHost ? '▶ Start Game' : '▶ Start When Ready'}
                    </button>
                    <button className="mono-help-btn" onClick={() => onHelp?.('monopoly')}>❓ Help</button>
                    <button className="mono-close-btn" onClick={onClose}>✕ Close</button>
                </div>
            </div>
        );
    }

    // Build all 40 spaces for the board
    const boardSpaces = BOARD_SPACES.map(space => {
        const pos = GRID_POSITIONS[space.id];
        return { ...space, gridRow: pos.row, gridCol: pos.col };
    });

    return (
        <div className="mono-container">
            {/* Header */}
            <div className="mono-header">
                <div className="mono-title">🏠 MONOPOLY</div>
                <div className="mono-phase">{phaseLabels[game.phase] || game.phase}</div>
                <div className="mono-turn">Turn {game.turnNumber}</div>
            </div>

            {/* Players Bar */}
            <div className="mono-players">
                {game.players.map((p, i) => (
                    <div 
                        key={p.peer_id} 
                        className={`mono-player ${i === game.currentPlayer ? 'active' : ''} ${p.eliminated ? 'eliminated' : ''} ${p.inJail ? 'in-jail' : ''}`}
                    >
                        <div className="mono-token">{TOKEN_EMOJIS[i % 8]}</div>
                        <div className="mono-player-info">
                            <div className="mono-player-name">
                                {p.nick} {p.peer_id === myId && '(You)'}
                            </div>
                            <div className="mono-player-money">${p.money?.toLocaleString()}</div>
                            {p.properties?.length > 0 && (
                                <div className="mono-player-props">{p.properties.length} properties</div>
                            )}
                        </div>
                        {i === game.currentPlayer && <div className="mono-turn-indicator">▶</div>}
                        {p.eliminated && <div className="mono-eliminated">💀</div>}
                        {p.inJail && <div className="mono-eliminated">🔒</div>}
                    </div>
                ))}
            </div>

            {/* Dice Section */}
            {game.phase !== 'lobby' && game.phase !== 'ended' && (
                <div className="mono-dice-section">
                    <div className="mono-dice-container">
                        <DiceFace value={game.dice[0] || 1} rolling={rolling} />
                        <DiceFace value={game.dice[1] || 1} rolling={rolling} />
                    </div>
                    {game.dice[0] === game.dice[1] && game.dice[0] > 0 && (
                        <span className="mono-double">DOUBLE!</span>
                    )}
                </div>
            )}

            {/* Board */}
            <div className="mono-board-wrapper">
                <div className="mono-board">
                    <div className="mono-board-inner">
                        {/* Render all 40 spaces positioned in the grid */}
                        {boardSpaces.map((space) => (
                            <div 
                                key={space.id}
                                className="mono-space-wrapper"
                                style={{ 
                                    gridRow: space.gridRow, 
                                    gridColumn: space.gridCol 
                                }}
                            >
                                <Space 
                                    space={space} 
                                    players={playerTokens}
                                    onSelect={handleSpaceSelect}
                                />
                            </div>
                        ))}
                        
                        {/* Center panel */}
                        <div className="mono-board-center">
                            <div className="mono-center-title">MONOPOLY</div>
                            <div className="mono-center-subtitle">EST. 1935</div>
                            
                            {currentPlayer && (
                                <div className="mono-current-turn">
                                    <span>{currentPlayer.nick}</span>'s turn
                                </div>
                            )}

                            <div className="mono-center-status">
                                <div className="mono-center-badge">{centerBadge}</div>
                                <div className="mono-center-space">
                                    {currentSpace?.name || 'Waiting for players'}
                                </div>
                                <div className="mono-center-meta">
                                    <span>{currentPlayer ? `$${currentPlayer.money?.toLocaleString()}` : 'Cash pending'}</span>
                                    <span>{currentPlayer?.properties?.length || 0} deeds</span>
                                </div>
                                <div className="mono-center-hint">{actionHint}</div>
                            </div>

                            <div className="mono-action-area">
                                {game.phase === 'rolling' && isMyTurn && !game.diceRolled && !currentPlayer?.inJail && (
                                    <button 
                                        className="mono-btn mono-roll-btn" 
                                        onClick={handleRoll}
                                        disabled={rolling}
                                    >
                                        🎲 Roll Dice
                                    </button>
                                )}

                                {game.phase === 'jail' && isMyTurn && (
                                    <>
                                        <button 
                                            className="mono-btn mono-roll-btn" 
                                            onClick={() => onAction({ type: 'jailroll' })}
                                            disabled={rolling}
                                        >
                                            🎲 Roll for Double
                                        </button>
                                        <button 
                                            className="mono-btn mono-buy-btn" 
                                            onClick={() => onAction({ type: 'escapejail' })}
                                            disabled={currentPlayer?.money < 50}
                                        >
                                            Pay $50 to Escape
                                        </button>
                                        <button 
                                            className="mono-btn mono-end-btn" 
                                            onClick={() => onAction({ type: 'endturn' })}
                                        >
                                            End Turn (Stay in Jail)
                                        </button>
                                    </>
                                )}

                                {game.phase === 'property' && isMyTurn && (
                                    <>
                                        <button 
                                            className="mono-btn mono-buy-btn" 
                                            onClick={() => onAction({ type: 'buy' })}
                                        >
                                            Buy Property
                                        </button>
                                        <button 
                                            className="mono-btn mono-auction-btn" 
                                            onClick={() => onAction({ type: 'auction' })}
                                        >
                                            Auction
                                        </button>
                                    </>
                                )}

                                {game.phase === 'rolling' && isMyTurn && game.diceRolled && !currentPlayer?.inJail && (
                                    <button 
                                        className="mono-btn mono-end-btn" 
                                        onClick={() => onAction({ type: 'endturn' })}
                                    >
                                        End Turn
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Properties Section */}
            <div className="mono-properties-section">
                <div className="mono-section-title">
                    My Properties ({myProperties.length})
                </div>
                <div className="mono-property-grid">
                    {myProperties.map(prop => (
                        <PropertyCard key={prop.id} prop={prop} />
                    ))}
                    {myProperties.length === 0 && (
                        <div className="mono-no-props">No properties yet — buy some!</div>
                    )}
                </div>
            </div>

            {/* Winner Banner */}
            {game.phase === 'ended' && game.winner && (
                <div className="mono-winner">
                    <span className="mono-winner-trophy">🏆</span>
                    {game.players.find(p => p.peer_id === game.winner)?.nick} Wins!
                </div>
            )}

            {/* Game Log */}
            {game.log?.length > 0 && (
                <div className="mono-log">
                    {game.log.slice(-5).map((entry, i) => (
                        <div key={i} className="mono-log-entry">{entry}</div>
                    ))}
                </div>
            )}

            {/* Footer */}
            <div className="mono-footer">
                <button className="mono-help-btn" onClick={() => onHelp?.('monopoly')}>❓ Help</button>
                <button className="mono-close-btn" onClick={onClose}>✕ Close</button>
            </div>
        </div>
    );
});
