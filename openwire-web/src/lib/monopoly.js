/* ═══════════════════════════════════════════════════════════
   OpenWire — Monopoly Game Engine
   Simplified Monopoly for 2–8 players
   Bounded Context: Monopoly | Shared Core: GameEngine
   Non-financial (no real money) — uses NonFinancialEvent
   ═══════════════════════════════════════════════════════════ */

import { GameEngine, registerGame } from './GameEngine.js';
import { createNonFinancialEvent } from './core/PayoutEvent.js';

/* ── Constants ────────────────────────────────────────────── */

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const STARTING_MONEY = 1500;
export const TURN_TIMEOUT_MS = 60 * 1000; // 60s per turn

/* ── Property Data ───────────────────────────────────────── */

const STREET_GROUPS = {
    brown:    { color: '#8B4513', name: 'Brown' },
    lightBlue:{ color: '#87CEEB', name: 'Light Blue' },
    pink:     { color: '#FF69B4', name: 'Pink' },
    orange:   { color: '#FF8C00', name: 'Orange' },
    red:      { color: '#DC143C', name: 'Red' },
    yellow:   { color: '#FFD700', name: 'Yellow' },
    green:    { color: '#228B22', name: 'Green' },
    darkBlue: { color: '#00008B', name: 'Dark Blue' },
};

const PROPERTIES = [
    // Brown (2)
    { id: 1,  name: 'Mediterranean',    group: 'brown',      price: 60,  rent: [2, 4],        houses: 0, owner: null },
    { id: 2,  name: 'Baltic',          group: 'brown',      price: 60,  rent: [4, 8],         houses: 0, owner: null },
    // Light Blue (3)
    { id: 3,  name: 'Oriental',       group: 'lightBlue',  price: 100, rent: [6, 12],        houses: 0, owner: null },
    { id: 4,  name: 'Vermont',        group: 'lightBlue',  price: 100, rent: [6, 12],        houses: 0, owner: null },
    { id: 5,  name: 'Connecticut',     group: 'lightBlue',  price: 120, rent: [8, 16],        houses: 0, owner: null },
    // Pink (3)
    { id: 6,  name: 'St. Charles',    group: 'pink',       price: 140, rent: [10, 20],       houses: 0, owner: null },
    { id: 7,  name: 'States',         group: 'pink',       price: 140, rent: [10, 20],       houses: 0, owner: null },
    { id: 8,  name: 'Virginia',       group: 'pink',       price: 160, rent: [12, 24],       houses: 0, owner: null },
    // Orange (3)
    { id: 9,  name: 'St. James',      group: 'orange',     price: 180, rent: [14, 28],       houses: 0, owner: null },
    { id: 10, name: 'Tennessee',       group: 'orange',     price: 180, rent: [14, 28],       houses: 0, owner: null },
    { id: 11, name: 'New York',        group: 'orange',     price: 200, rent: [16, 32],       houses: 0, owner: null },
    // Red (3)
    { id: 12, name: 'Kentucky',        group: 'red',        price: 220, rent: [18, 36],       houses: 0, owner: null },
    { id: 13, name: 'Indiana',         group: 'red',        price: 220, rent: [18, 36],       houses: 0, owner: null },
    { id: 14, name: 'Illinois',        group: 'red',        price: 240, rent: [20, 40],       houses: 0, owner: null },
    // Yellow (3)
    { id: 15, name: 'Atlantic',         group: 'yellow',     price: 260, rent: [22, 44],       houses: 0, owner: null },
    { id: 16, name: 'Ventnor',          group: 'yellow',     price: 260, rent: [22, 44],       houses: 0, owner: null },
    { id: 17, name: 'Marvin Gardens',  group: 'yellow',     price: 280, rent: [24, 48],       houses: 0, owner: null },
    // Green (3)
    { id: 18, name: 'Pacific',          group: 'green',      price: 300, rent: [26, 52],       houses: 0, owner: null },
    { id: 19, name: 'North Carolina',  group: 'green',      price: 300, rent: [26, 52],       houses: 0, owner: null },
    { id: 20, name: 'Pennsylvania',     group: 'green',      price: 320, rent: [28, 56],       houses: 0, owner: null },
    // Dark Blue (2)
    { id: 21, name: 'Park Place',      group: 'darkBlue',   price: 350, rent: [35, 70],       houses: 0, owner: null },
    { id: 22, name: 'Boardwalk',        group: 'darkBlue',   price: 400, rent: [50, 100],      houses: 0, owner: null },
    // Railways (4)
    { id: 23, name: 'Reading Railroad', group: 'railroad',  price: 200, rent: [25],          houses: 0, owner: null },
    { id: 24, name: 'Pennsylvania RR', group: 'railroad',  price: 200, rent: [25],          houses: 0, owner: null },
    { id: 25, name: 'B&O Railroad',    group: 'railroad',  price: 200, rent: [25],          houses: 0, owner: null },
    { id: 26, name: 'Short Line',      group: 'railroad',  price: 200, rent: [25],          houses: 0, owner: null },
    // Utilities (2)
    { id: 27, name: 'Electric Company', group: 'utility',   price: 150, rent: [4],           houses: 0, owner: null },
    { id: 28, name: 'Water Works',      group: 'utility',   price: 150, rent: [4],           houses: 0, owner: null },
];

// Board positions (0-39)
const BOARD_SPACES = [
    { id: 0,  type: 'go',         name: 'GO' },
    { id: 1,  type: 'property',   propId: 1 },
    { id: 2,  type: 'community',  name: 'Community Chest' },
    { id: 3,  type: 'property',   propId: 2 },
    { id: 4,  type: 'tax',        name: 'Income Tax', amount: 200 },
    { id: 5,  type: 'railroad',   propId: 23 },
    { id: 6,  type: 'property',   propId: 3 },
    { id: 7,  type: 'chance',     name: 'Chance' },
    { id: 8,  type: 'property',   propId: 4 },
    { id: 9,  type: 'property',   propId: 5 },
    { id: 10, type: 'jail',       name: 'Jail' },
    { id: 11, type: 'property',   propId: 6 },
    { id: 12, type: 'utility',    propId: 27 },
    { id: 13, type: 'property',   propId: 7 },
    { id: 14, type: 'property',   propId: 8 },
    { id: 15, type: 'railroad',   propId: 24 },
    { id: 16, type: 'property',   propId: 9 },
    { id: 17, type: 'community',  name: 'Community Chest' },
    { id: 18, type: 'property',   propId: 10 },
    { id: 19, type: 'property',   propId: 11 },
    { id: 20, type: 'free',       name: 'Free Parking' },
    { id: 21, type: 'property',   propId: 12 },
    { id: 22, type: 'chance',     name: 'Chance' },
    { id: 23, type: 'property',   propId: 13 },
    { id: 24, type: 'property',   propId: 14 },
    { id: 25, type: 'railroad',   propId: 25 },
    { id: 26, type: 'property',   propId: 15 },
    { id: 27, type: 'property',   propId: 16 },
    { id: 28, type: 'utility',    propId: 28 },
    { id: 29, type: 'property',   propId: 17 },
    { id: 30, type: 'gotojail',  name: 'Go To Jail' },
    { id: 31, type: 'property',   propId: 18 },
    { id: 32, type: 'property',   propId: 19 },
    { id: 33, type: 'community',  name: 'Community Chest' },
    { id: 34, type: 'property',   propId: 20 },
    { id: 35, type: 'railroad',   propId: 26 },
    { id: 36, type: 'chance',     name: 'Chance' },
    { id: 37, type: 'property',   propId: 21 },
    { id: 38, type: 'tax',        name: 'Luxury Tax', amount: 100 },
    { id: 39, type: 'property',   propId: 22 },
];

const COMMUNITY_CHEST = [
    'Bank error in your favor', 'Doctor fee', 'From sale of stock', 'Get out of jail free',
    'Go to jail', 'Holiday fund matures', 'Income tax refund', 'Life insurance matures',
    'Hospital fee', 'Inheritance', 'School fee', 'Receive $25 consultancy fee',
    'You inherit $100', 'Tax refund', 'You won second place', 'Birthday gift $50',
];
const CHANCE = [
    'Advance to GO', 'Bank pays dividend', 'Go to jail', 'General repairs',
    'Speeding fine', 'Go back 3 spaces', 'Advance to nearest utility', 'Advance to nearest railroad',
    'Elected chairman', 'Loan matures',
];

/* ── Helpers ──────────────────────────────────────────────── */

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function rollDice() {
    return [Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1];
}

function getPropertyById(propId) {
    return PROPERTIES.find(p => p.id === propId);
}

function getRailroadRent(ownerId, players) {
    const railroadsOwned = players.flatMap(p => p.properties || []).filter(pid => {
        const prop = getPropertyById(pid);
        return prop?.group === 'railroad';
    }).length;
    return 25 * Math.pow(2, railroadsOwned - 1);
}

function getUtilityRent(ownerId, diceSum, players) {
    const utilsOwned = players.flatMap(p => p.properties || []).filter(pid => {
        const prop = getPropertyById(pid);
        return prop?.group === 'utility';
    }).length;
    return utilsOwned === 2 ? diceSum * 10 : diceSum * 4;
}

/* ── Create Game ──────────────────────────────────────────── */

export function createMonopoly(roomId) {
    return {
        type: 'monopoly',
        roomId,
        phase: 'lobby', // 'lobby' | 'rolling' | 'property' | 'auction' | 'jail' | 'trade' | 'ended'
        players: [],
        currentPlayer: 0,
        deck: {
            communityChest: shuffle(COMMUNITY_CHEST),
            chance: shuffle(CHANCE),
        },
        dice: [0, 0],
        diceRolled: false,
        turnNumber: 1,
        phaseTimeout: null,
        winner: null,
        properties: PROPERTIES.map(p => ({ ...p })),
        log: [],
    };
}

/* ── Player Management ────────────────────────────────────── */

export function addPlayer(game, peer_id, nick) {
    if (game.phase !== 'lobby') return game;
    if (game.players.find(p => p.peer_id === peer_id)) return game;
    if (game.players.length >= MAX_PLAYERS) return game;

    return {
        ...game,
        players: [
            ...game.players,
            { peer_id, nick, money: STARTING_MONEY, position: 0, properties: [], inJail: false, jailTurns: 0, bankrupt: false, eliminated: false },
        ],
    };
}

export function removePlayer(game, peer_id) {
    return {
        ...game,
        players: game.players.map(p =>
            p.peer_id === peer_id ? { ...p, eliminated: true } : p
        ),
    };
}

/* ── Game Actions ─────────────────────────────────────────── */

export function startGame(game) {
    if (game.phase !== 'lobby') return game;
    if (game.players.length < MIN_PLAYERS) return game;

    return {
        ...game,
        phase: 'rolling',
        currentPlayer: 0,
        turnNumber: 1,
    };
}

export function roll(game) {
    const player = game.players[game.currentPlayer];
    if (!player || player.eliminated || player.bankrupt) return game;
    if (game.phase !== 'rolling') return game;
    if (game.diceRolled) return game;

    const dice = rollDice();
    const isDouble = dice[0] === dice[1];
    let newPosition = (player.position + dice[0] + dice[1]) % 40;
    let money = player.money;

    // Pass GO
    if (newPosition < player.position) {
        money += 200;
    }

    let newGame = {
        ...game,
        players: game.players.map((p, i) =>
            i === game.currentPlayer
                ? { ...p, position: newPosition, money, diceRolled: true, inJail: false }
                : p
        ),
        dice,
        diceRolled: true,
    };

    const space = BOARD_SPACES[newPosition];
    newGame = handleSpace(newGame, space, dice[0] + dice[1]);

    return newGame;
}

function handleSpace(game, space, diceSum) {
    const player = game.players[game.currentPlayer];

    switch (space.type) {
        case 'property':
        case 'railroad':
        case 'utility': {
            const prop = getPropertyById(space.propId);
            if (!prop) return { ...game, phase: 'rolling', diceRolled: false };
            if (prop.owner !== null) {
                // Pay rent
                const owner = game.players.find(p => p.peer_id === prop.owner);
                if (owner && !owner.eliminated && !owner.bankrupt) {
                    let rent = prop.rent[0];
                    if (prop.group === 'railroad') {
                        rent = getRailroadRent(prop.owner, game.players);
                    } else if (prop.group === 'utility') {
                        rent = getUtilityRent(prop.owner, diceSum, game.players);
                    }
                    const owed = Math.min(rent, player.money);
                    game = {
                        ...game,
                        players: game.players.map((p, i) => {
                            if (i === game.currentPlayer) return { ...p, money: p.money - owed };
                            if (p.peer_id === prop.owner) return { ...p, money: p.money + owed };
                            return p;
                        }),
                        log: [...game.log, `${player.nick} paid $${owed} rent to ${owner.nick}`],
                    };
                    // Check bankruptcy
                    const updatedPlayer = game.players[game.currentPlayer];
                    if (updatedPlayer.money <= 0) {
                        return handleBankruptcy(game, game.currentPlayer);
                    }
                }
            }
            return { ...game, phase: 'property' };
        }
        case 'chance': {
            const card = game.deck.chance[0];
            game = {
                ...game,
                deck: { ...game.deck, chance: [...game.deck.chance.slice(1), card] },
                log: [...game.log, `${player.nick} drew Chance: ${card}`],
            };
            if (card === 'Go to jail') {
                return {
                    ...game,
                    players: game.players.map((p, i) =>
                        i === game.currentPlayer
                            ? { ...p, position: 10, inJail: true }
                            : p
                    ),
                    phase: 'jail',
                };
            }
            if (card === 'Advance to GO') {
                return {
                    ...game,
                    players: game.players.map((p, i) =>
                        i === game.currentPlayer ? { ...p, position: 0, money: p.money + 200 } : p
                    ),
                    phase: 'rolling',
                    diceRolled: false,
                };
            }
            return { ...game, phase: 'rolling', diceRolled: false };
        }
        case 'community': {
            const card = game.deck.communityChest[0];
            game = {
                ...game,
                deck: { ...game.deck, communityChest: [...game.deck.communityChest.slice(1), card] },
                log: [...game.log, `${player.nick} drew Community Chest: ${card}`],
            };
            if (card === 'Go to jail') {
                return {
                    ...game,
                    players: game.players.map((p, i) =>
                        i === game.currentPlayer
                            ? { ...p, position: 10, inJail: true }
                            : p
                    ),
                    phase: 'jail',
                };
            }
            return { ...game, phase: 'rolling', diceRolled: false };
        }
        case 'tax': {
            const owed = space.amount;
            game = {
                ...game,
                players: game.players.map((p, i) =>
                    i === game.currentPlayer ? { ...p, money: Math.max(0, p.money - owed) } : p
                ),
                log: [...game.log, `${player.nick} paid $${owed} tax`],
            };
            const updatedPlayer = game.players[game.currentPlayer];
            if (updatedPlayer.money <= 0) {
                return handleBankruptcy(game, game.currentPlayer);
            }
            return { ...game, phase: 'rolling', diceRolled: false };
        }
        case 'gotojail':
            return {
                ...game,
                players: game.players.map((p, i) =>
                    i === game.currentPlayer
                        ? { ...p, position: 10, inJail: true }
                        : p
                ),
                phase: 'jail',
            };
        case 'go':
            return { ...game, phase: 'rolling', diceRolled: false };
        case 'jail':
            return { ...game, phase: 'jail' };
        case 'free':
            return { ...game, phase: 'rolling', diceRolled: false };
        default:
            return { ...game, phase: 'rolling', diceRolled: false };
    }
}

function handleBankruptcy(game, playerIndex) {
    const player = game.players[playerIndex];
    // Return properties to bank
    let newGame = {
        ...game,
        players: game.players.map((p, i) => {
            if (i === playerIndex) return { ...p, bankrupt: true, eliminated: true, money: 0 };
            return p;
        }),
        properties: game.properties.map(prop => {
            if (prop.owner === player.peer_id) return { ...prop, owner: null };
            return prop;
        }),
        log: [...game.log, `${player.nick} is bankrupt and eliminated!`],
    };

    // Check for winner
    const remaining = newGame.players.filter(p => !p.eliminated);
    if (remaining.length === 1) {
        newGame = { ...newGame, phase: 'ended', winner: remaining[0].peer_id };
    } else {
        newGame = advanceTurn(newGame);
    }
    return newGame;
}

export function buyProperty(game) {
    const player = game.players[game.currentPlayer];
    if (!player || player.eliminated || player.bankrupt) return game;
    if (game.phase !== 'property') return game;

    const space = BOARD_SPACES[player.position];
    if (!space || (space.type !== 'property' && space.type !== 'railroad' && space.type !== 'utility')) return game;

    const prop = game.properties.find(p => p.id === space.propId);
    if (!prop || prop.owner !== null) return game;
    if (player.money < prop.price) return game;

    const newGame = {
        ...game,
        players: game.players.map((p, i) =>
            i === game.currentPlayer
                ? { ...p, money: p.money - prop.price, properties: [...p.properties, prop.id] }
                : p
        ),
        properties: game.properties.map(p =>
            p.id === prop.id ? { ...p, owner: player.peer_id } : p
        ),
        phase: 'rolling',
        diceRolled: false,
        log: [...game.log, `${player.nick} bought ${prop.name} for $${prop.price}`],
    };

    return advanceTurn(newGame);
}

export function auctionProperty(game) {
    const player = game.players[game.currentPlayer];
    if (!player || player.eliminated || player.bankrupt) return game;
    if (game.phase !== 'property') return game;

    const space = BOARD_SPACES[player.position];
    if (!space) return game;
    const prop = game.properties.find(p => p.id === space.propId);
    if (!prop || prop.owner !== null) return game;

    // Simplified auction - random player buys at min(price/2, highest bid)
    const bidders = game.players.filter(p => !p.eliminated && !p.bankrupt && p.money >= Math.floor(prop.price / 2));
    if (bidders.length === 0) {
        return { ...game, phase: 'rolling', diceRolled: false };
    }
    const winner = bidders[Math.floor(Math.random() * bidders.length)];
    const auctionPrice = Math.floor(prop.price / 2);

    const newGame = {
        ...game,
        players: game.players.map((p, i) => {
            if (p.peer_id === winner.peer_id) return { ...p, money: p.money - auctionPrice, properties: [...p.properties, prop.id] };
            if (p.peer_id === player.peer_id) return { ...p, money: p.money + auctionPrice }; // original owner gets nothing
            return p;
        }),
        properties: game.properties.map(p =>
            p.id === prop.id ? { ...p, owner: winner.peer_id } : p
        ),
        phase: 'rolling',
        diceRolled: false,
        log: [...game.log, `${winner.nick} won auction for ${prop.name} at $${auctionPrice}`],
    };

    return advanceTurn(newGame);
}

export function endTurn(game) {
    return advanceTurn(game);
}

function advanceTurn(game) {
    const currentIdx = game.currentPlayer;
    let nextIdx = (currentIdx + 1) % game.players.length;
    let turnNum = game.turnNumber;

    // Skip eliminated/bankrupt players
    let attempts = 0;
    while (game.players[nextIdx].eliminated && attempts < game.players.length) {
        nextIdx = (nextIdx + 1) % game.players.length;
        attempts++;
    }

    if (nextIdx <= currentIdx) {
        turnNum++;
    }

    return {
        ...game,
        currentPlayer: nextIdx,
        turnNumber: turnNum,
        phase: 'rolling',
        diceRolled: false,
    };
}

/* ── Message Protocol ─────────────────────────────────────── */

export function isMonopolyMessage(data) {
    return data?.type?.startsWith('mono_');
}

export function serializeMonopolyAction(action) {
    return JSON.stringify(action);
}

export function parseMonopolyAction(data) {
    try {
        return typeof data === 'string' ? JSON.parse(data) : data;
    } catch {
        return null;
    }
}

/* ── Serialization ────────────────────────────────────────── */

export function serializeGame(game) {
    return JSON.stringify(game);
}

export function deserializeGame(data) {
    try {
        return JSON.parse(data);
    } catch {
        return null;
    }
}

/* ── GameEngine ────────────────────────────────────────────── */

class MonopolyEngine extends GameEngine {
    constructor(gameState) {
        super();
        this._game = gameState;
    }

    getGameState() {
        return this._game;
    }

    calculatePayout(bets, result) {
        // Non-financial game - no payouts
        return {};
    }

    getRules() {
        return MONOPOLY_RULES;
    }

    calculateResults(gameState) {
        const playerStats = gameState.players.map(p => ({
            peer_id: p.peer_id,
            nick: p.nick,
            money: p.money,
            properties: p.properties.length,
            eliminated: p.eliminated,
            winner: p.peer_id === gameState.winner,
        }));

        return createNonFinancialEvent({
            gameType: 'monopoly',
            playerStats,
        });
    }
}

export const MONOPOLY_RULES = {
    name: 'Monopoly',
    description: 'Classic property trading and building game. Roll dice, buy properties, collect rent, and bankrupt your opponents to win!',
    bets: [],
};

/* ── Register ─────────────────────────────────────────────── */

registerGame('monopoly', MonopolyEngine);
