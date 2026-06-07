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

const GROUP_SIZES = {
    brown: 2,
    lightBlue: 3,
    pink: 3,
    orange: 3,
    red: 3,
    yellow: 3,
    green: 3,
    darkBlue: 2,
};

const HOUSE_COSTS = {
    brown: 50,
    lightBlue: 50,
    pink: 100,
    orange: 100,
    red: 150,
    yellow: 150,
    green: 200,
    darkBlue: 200,
};

const HOUSE_RENT_MULTIPLIERS = [1, 5, 15, 45, 80, 125];

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
    if (railroadsOwned === 0) return 0;
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
        phase: 'lobby', // 'lobby' | 'rolling' | 'property' | 'auction' | 'jail' | 'card' | 'trade' | 'ended'
        players: [],
        currentPlayer: 0,
        deck: {
            communityChest: shuffle(COMMUNITY_CHEST),
            chance: shuffle(CHANCE),
        },
        dice: [0, 0],
        diceRolled: false,
        doublesCount: 0,
        turnNumber: 1,
        phaseTimeout: null,
        winner: null,
        properties: PROPERTIES.map(p => ({ ...p })),
        pendingCardChoice: null,
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
            { peer_id, nick, money: STARTING_MONEY, position: 0, properties: [], inJail: false, jailTurns: 0, jailFreeCards: 0, bankrupt: false, eliminated: false },
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
        log: [...game.log, `Monopoly started with ${game.players.length} players.`],
    };
}

function getPlayerById(game, peerId) {
    return game.players.find((player) => player.peer_id === peerId) || null;
}

function ownsFullSet(game, peerId, group) {
    const groupSize = GROUP_SIZES[group];
    if (!groupSize) return false;
    return game.properties.filter((property) => property.group === group && property.owner === peerId).length === groupSize;
}

function getStreetRent(game, prop) {
    const owner = prop.owner ? getPlayerById(game, prop.owner) : null;
    if (!owner) return prop.rent[0];
    const baseRent = prop.rent[0];
    if ((prop.houses || 0) > 0) {
        return baseRent * HOUSE_RENT_MULTIPLIERS[Math.min(prop.houses, 5)];
    }
    return ownsFullSet(game, owner.peer_id, prop.group) ? baseRent * 2 : baseRent;
}

function getImprovementCount(game, peerId) {
    const owned = game.properties.filter((property) => property.owner === peerId);
    return owned.reduce((total, property) => total + Math.min(property.houses || 0, 4), 0);
}

function getHotelCount(game, peerId) {
    return game.properties.filter((property) => property.owner === peerId && (property.houses || 0) >= 5).length;
}

function rotateDeckWithChoice(deck, cardsShown, selectedIndex) {
    const remaining = deck.slice(cardsShown.length);
    return [...remaining, ...cardsShown.slice(0, selectedIndex), ...cardsShown.slice(selectedIndex + 1), cardsShown[selectedIndex]];
}

function getCardChoices(game, deckKey) {
    const deck = game.deck[deckKey] || [];
    return deck.slice(0, Math.min(3, deck.length));
}

function openCardChoice(game, kind, player, spaceId) {
    const deckKey = kind === 'chance' ? 'chance' : 'communityChest';
    const options = getCardChoices(game, deckKey);
    if (options.length === 0) return { ...game, phase: 'rolling', diceRolled: true };
    return {
        ...game,
        phase: 'card',
        pendingCardChoice: {
            kind,
            deckKey,
            forPeerId: player.peer_id,
            forNick: player.nick,
            options,
            sourceSpaceId: spaceId,
        },
        log: [...game.log, `${player.nick} can pick 1 of ${options.length} ${kind === 'chance' ? 'Chance' : 'Community Chest'} cards.`],
    };
}

function resolveFinancialCard(game, amount, label) {
    const player = game.players[game.currentPlayer];
    const money = player.money + amount;
    if (money < 0) {
        return handleBankruptcy({
            ...game,
            players: game.players.map((p, i) => i === game.currentPlayer ? { ...p, money } : p),
            log: [...game.log, `${player.nick} ${label}`],
        }, game.currentPlayer);
    }
    return {
        ...game,
        players: game.players.map((p, i) => i === game.currentPlayer ? { ...p, money } : p),
        log: [...game.log, `${player.nick} ${label}`],
    };
}

function applySelectedCard(game, kind, card) {
    const player = game.players[game.currentPlayer];
    if (!player) return game;

    if (kind === 'community') {
        switch (card) {
            case 'Bank error in your favor': return resolveFinancialCard(game, 200, 'received $200 from a bank error in their favor.');
            case 'Doctor fee': return resolveFinancialCard(game, -50, 'paid a $50 doctor fee.');
            case 'From sale of stock': return resolveFinancialCard(game, 50, 'received $50 from the sale of stock.');
            case 'Get out of jail free':
                return {
                    ...game,
                    players: game.players.map((p, i) =>
                        i === game.currentPlayer ? { ...p, jailFreeCards: (p.jailFreeCards || 0) + 1 } : p
                    ),
                    log: [...game.log, `${player.nick} received a Get Out of Jail Free card.`],
                };
            case 'Go to jail':
                return {
                    ...game,
                    players: game.players.map((p, i) => i === game.currentPlayer ? { ...p, position: 10, inJail: true, jailTurns: 0 } : p),
                    phase: 'jail',
                    log: [...game.log, `${player.nick} drew Community Chest and went to jail.`],
                };
            case 'Holiday fund matures': return resolveFinancialCard(game, 100, 'received $100 from a holiday fund.');
            case 'Income tax refund': return resolveFinancialCard(game, 20, 'received a $20 income tax refund.');
            case 'Life insurance matures': return resolveFinancialCard(game, 100, 'received $100 from life insurance.');
            case 'Hospital fee': return resolveFinancialCard(game, -100, 'paid a $100 hospital fee.');
            case 'Inheritance': return resolveFinancialCard(game, 100, 'received a $100 inheritance.');
            case 'School fee': return resolveFinancialCard(game, -50, 'paid a $50 school fee.');
            case 'Receive $25 consultancy fee': return resolveFinancialCard(game, 25, 'received a $25 consultancy fee.');
            case 'You inherit $100': return resolveFinancialCard(game, 100, 'inherited $100.');
            case 'Tax refund': return resolveFinancialCard(game, 50, 'received a $50 tax refund.');
            case 'You won second place': return resolveFinancialCard(game, 10, 'won $10 for second place.');
            case 'Birthday gift $50': return resolveFinancialCard(game, 50, 'received a $50 birthday gift.');
            default:
                return game;
        }
    }

    switch (card) {
        case 'Advance to GO':
            return {
                ...game,
                players: game.players.map((p, i) =>
                    i === game.currentPlayer ? { ...p, position: 0, money: p.money + 200 } : p
                ),
                log: [...game.log, `${player.nick} advanced to GO and collected $200.`],
            };
        case 'Bank pays dividend':
            return resolveFinancialCard(game, 50, 'received a $50 bank dividend.');
        case 'Go to jail':
            return {
                ...game,
                players: game.players.map((p, i) => i === game.currentPlayer ? { ...p, position: 10, inJail: true, jailTurns: 0 } : p),
                phase: 'jail',
                log: [...game.log, `${player.nick} drew Chance and went to jail.`],
            };
        case 'General repairs': {
            const charge = getImprovementCount(game, player.peer_id) * 25 + getHotelCount(game, player.peer_id) * 100;
            return resolveFinancialCard(game, -charge, charge > 0 ? `paid $${charge} for general repairs.` : 'had no repair costs.');
        }
        case 'Speeding fine':
            return resolveFinancialCard(game, -15, 'paid a $15 speeding fine.');
        case 'Go back 3 spaces': {
            const newPos = (player.position - 3 + 40) % 40;
            const moved = {
                ...game,
                players: game.players.map((p, i) => i === game.currentPlayer ? { ...p, position: newPos } : p),
                log: [...game.log, `${player.nick} went back 3 spaces.`],
            };
            return handleSpace(moved, BOARD_SPACES[newPos], game.dice[0] + game.dice[1]);
        }
        case 'Advance to nearest utility': {
            const targetPos = player.position < 12 ? 12 : (player.position < 28 ? 28 : 12);
            const bonus = targetPos < player.position ? 200 : 0;
            const moved = {
                ...game,
                players: game.players.map((p, i) =>
                    i === game.currentPlayer ? { ...p, position: targetPos, money: p.money + bonus } : p
                ),
                log: [...game.log, `${player.nick} advanced to the nearest utility.`],
            };
            return handleSpace(moved, BOARD_SPACES[targetPos], game.dice[0] + game.dice[1]);
        }
        case 'Advance to nearest railroad': {
            const railroads = [5, 15, 25, 35];
            const targetPos = railroads.find((rr) => rr > player.position) ?? 5;
            const bonus = targetPos < player.position ? 200 : 0;
            const moved = {
                ...game,
                players: game.players.map((p, i) =>
                    i === game.currentPlayer ? { ...p, position: targetPos, money: p.money + bonus } : p
                ),
                log: [...game.log, `${player.nick} advanced to the nearest railroad.`],
            };
            return handleSpace(moved, BOARD_SPACES[targetPos], game.dice[0] + game.dice[1]);
        }
        case 'Elected chairman': {
            const others = game.players.filter((p, i) => i !== game.currentPlayer && !p.eliminated && !p.bankrupt);
            const payout = others.length * 25;
            if (player.money < payout) {
                return handleBankruptcy({
                    ...game,
                    players: game.players.map((p, i) => {
                        if (i === game.currentPlayer) return { ...p, money: p.money - payout };
                        if (!p.eliminated && !p.bankrupt) return { ...p, money: p.money + 25 };
                        return p;
                    }),
                    log: [...game.log, `${player.nick} was elected chairman and owes the table $${payout}.`],
                }, game.currentPlayer);
            }
            return {
                ...game,
                players: game.players.map((p, i) => {
                    if (i === game.currentPlayer) return { ...p, money: p.money - payout };
                    if (!p.eliminated && !p.bankrupt) return { ...p, money: p.money + 25 };
                    return p;
                }),
                log: [...game.log, `${player.nick} paid $25 to each player as elected chairman.`],
            };
        }
        case 'Loan matures':
            return resolveFinancialCard(game, 150, 'received $150 from a matured loan.');
        default:
            return game;
    }
}

export function roll(game) {
    const player = game.players[game.currentPlayer];
    if (!player || player.eliminated || player.bankrupt) return game;
    if (game.phase !== 'rolling') return game;
    if (game.diceRolled) return game;

    // Check if already rolled doubles this turn (shouldn't happen but safety check)
    const dice = rollDice();
    const isDouble = dice[0] === dice[1];
    const currentDoubles = game.doublesCount || 0;

    // Three doubles in a row = go to jail
    if (isDouble && currentDoubles >= 2) {
        const newGame = {
            ...game,
            players: game.players.map((p, i) =>
                i === game.currentPlayer
                    ? { ...p, position: 10, inJail: true, diceRolled: true }
                    : p
            ),
            dice,
            diceRolled: true,
            doublesCount: 0,
            phase: 'jail',
            log: [...game.log, `${player.nick} rolled 3 doubles and must go to jail!`],
        };
        return newGame;
    }

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
        doublesCount: isDouble ? currentDoubles + 1 : 0,
    };

    const space = BOARD_SPACES[newPosition];
    newGame = handleSpace(newGame, space, dice[0] + dice[1]);

    // If doubles were rolled, allow another roll instead of ending turn
    if (isDouble && newGame.phase === 'rolling' && !newGame.players[newGame.currentPlayer].inJail) {
        newGame.diceRolled = false;
        newGame.log = [...newGame.log, `${player.nick} rolled a double! Roll again.`];
    }

    return newGame;
}

function handleSpace(game, space, diceSum) {
    const player = game.players[game.currentPlayer];

    switch (space.type) {
        case 'property':
        case 'railroad':
        case 'utility': {
            const prop = game.properties.find((property) => property.id === space.propId);
            if (!prop) return { ...game, phase: 'rolling', diceRolled: false };
            if (prop.owner !== null) {
                // Pay rent
                const owner = game.players.find(p => p.peer_id === prop.owner);
                if (owner && !owner.eliminated && !owner.bankrupt) {
                    let rent = prop.group === 'railroad' || prop.group === 'utility' ? prop.rent[0] : getStreetRent(game, prop);
                    if (prop.group === 'railroad') {
                        rent = getRailroadRent(prop.owner, game.players);
                    } else if (prop.group === 'utility') {
                        rent = getUtilityRent(prop.owner, diceSum, game.players);
                    }
                    const owed = rent;
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
                    if (updatedPlayer.money < 0) {
                        return handleBankruptcy(game, game.currentPlayer);
                    }
                }
                return { ...game, phase: 'rolling', diceRolled: true };
            }
            return { ...game, phase: 'property' };
        }
        case 'chance': {
            return openCardChoice(game, 'chance', player, space.id);
        }
        case 'community': {
            return openCardChoice(game, 'community', player, space.id);
        }
        case 'tax': {
            const owed = space.amount;
            game = {
                ...game,
                players: game.players.map((p, i) =>
                    i === game.currentPlayer ? { ...p, money: p.money - owed } : p
                ),
                log: [...game.log, `${player.nick} paid $${owed} tax`],
            };
            const updatedPlayer = game.players[game.currentPlayer];
            if (updatedPlayer.money < 0) {
                return handleBankruptcy(game, game.currentPlayer);
            }
            return { ...game, phase: 'rolling', diceRolled: true };
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
            return { ...game, phase: 'rolling', diceRolled: true };
        case 'jail':
            return { ...game, phase: 'rolling', diceRolled: true };
        case 'free':
            return { ...game, phase: 'rolling', diceRolled: true };
        default:
            return { ...game, phase: 'rolling', diceRolled: true };
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
        return advanceTurn({
            ...game,
            phase: 'rolling',
            diceRolled: true,
            log: [...game.log, `No one could afford the auction for ${prop.name}.`],
        });
    }
    const winner = bidders[Math.floor(Math.random() * bidders.length)];
    const auctionPrice = Math.floor(prop.price / 2);

    const newGame = {
        ...game,
        players: game.players.map((p) => (
            p.peer_id === winner.peer_id
                ? { ...p, money: p.money - auctionPrice, properties: [...p.properties, prop.id] }
                : p
        )),
        properties: game.properties.map(p =>
            p.id === prop.id ? { ...p, owner: winner.peer_id } : p
        ),
        phase: 'rolling',
        diceRolled: true,
        log: [...game.log, `${winner.nick} won auction for ${prop.name} at $${auctionPrice}`],
    };

    return advanceTurn(newGame);
}

export function chooseCard(game, optionIndex) {
    const choice = game.pendingCardChoice;
    const player = game.players[game.currentPlayer];
    if (!choice || game.phase !== 'card' || !player) return game;
    if (choice.forPeerId !== player.peer_id) return game;
    if (optionIndex < 0 || optionIndex >= choice.options.length) return game;

    const selectedCard = choice.options[optionIndex];
    const rotatedDeck = rotateDeckWithChoice(game.deck[choice.deckKey], choice.options, optionIndex);
    let nextGame = {
        ...game,
        deck: { ...game.deck, [choice.deckKey]: rotatedDeck },
        pendingCardChoice: null,
        phase: 'rolling',
        diceRolled: true,
        log: [...game.log, `${player.nick} picked ${choice.kind === 'chance' ? 'Chance' : 'Community Chest'}: ${selectedCard}`],
    };
    nextGame = applySelectedCard(nextGame, choice.kind, selectedCard);
    return nextGame;
}

export function canBuildImprovement(game, peerId, propId) {
    const prop = game.properties.find((property) => property.id === propId);
    if (!prop || !HOUSE_COSTS[prop.group]) return false;
    if (game.currentPlayer < 0 || game.players[game.currentPlayer]?.peer_id !== peerId) return false;
    if (prop.owner !== peerId) return false;
    if (!ownsFullSet(game, peerId, prop.group)) return false;
    if ((prop.houses || 0) >= 5) return false;
    const player = getPlayerById(game, peerId);
    return !!player && player.money >= HOUSE_COSTS[prop.group];
}

export function buildImprovement(game, propId) {
    const player = game.players[game.currentPlayer];
    if (!player || player.eliminated || player.bankrupt) return game;
    if (game.phase !== 'rolling' && game.phase !== 'property') return game;
    if (!canBuildImprovement(game, player.peer_id, propId)) return game;

    const prop = game.properties.find((property) => property.id === propId);
    const cost = HOUSE_COSTS[prop.group];
    const nextHouses = (prop.houses || 0) + 1;
    const label = nextHouses >= 5 ? 'hotel' : 'house';

    return {
        ...game,
        players: game.players.map((p, i) =>
            i === game.currentPlayer ? { ...p, money: p.money - cost } : p
        ),
        properties: game.properties.map((property) =>
            property.id === propId ? { ...property, houses: nextHouses } : property
        ),
        log: [...game.log, `${player.nick} built a ${label} on ${prop.name} for $${cost}.`],
    };
}

export function endTurn(game) {
    // If in jail phase and not escaped, increment jail turns
    const player = game.players[game.currentPlayer];
    if (player?.inJail && game.phase === 'jail') {
        const jailTurns = (player.jailTurns || 0) + 1;
        game = {
            ...game,
            players: game.players.map((p, i) =>
                i === game.currentPlayer ? { ...p, jailTurns } : p
            ),
        };
        // After 3 turns in jail, must pay $50 to escape
        if (jailTurns >= 3) {
            const money = player.money - 50;
            if (money < 0) {
                return handleBankruptcy(game, game.currentPlayer);
            }
            game = {
                ...game,
                players: game.players.map((p, i) =>
                    i === game.currentPlayer
                        ? { ...p, money, inJail: false, jailTurns: 0 }
                        : p
                ),
                log: [...game.log, `${player.nick} served 3 jail turns and paid $50 to escape`],
            };
        }
    }
    return advanceTurn(game);
}

export function escapeJail(game) {
    const player = game.players[game.currentPlayer];
    if (!player || player.eliminated || player.bankrupt) return game;
    if (!player.inJail || game.phase !== 'jail') return game;

    if ((player.jailFreeCards || 0) > 0) {
        return {
            ...game,
            players: game.players.map((p, i) =>
                i === game.currentPlayer
                    ? { ...p, inJail: false, jailTurns: 0, jailFreeCards: (p.jailFreeCards || 0) - 1 }
                    : p
            ),
            phase: 'rolling',
            diceRolled: false,
            log: [...game.log, `${player.nick} used a Get Out of Jail Free card.`],
        };
    }

    // Pay $50 to escape
    const money = player.money - 50;
    if (money < 0) return handleBankruptcy(game, game.currentPlayer);

    return {
        ...game,
        players: game.players.map((p, i) =>
            i === game.currentPlayer
                ? { ...p, money, inJail: false, jailTurns: 0 }
                : p
        ),
        phase: 'rolling',
        diceRolled: false,
        log: [...game.log, `${player.nick} paid $50 to escape jail`],
    };
}

export function jailRoll(game) {
    const player = game.players[game.currentPlayer];
    if (!player || player.eliminated || player.bankrupt) return game;
    if (!player.inJail || game.phase !== 'jail') return game;

    const dice = rollDice();
    const isDouble = dice[0] === dice[1];

    // Double allows escape from jail
    if (isDouble) {
        let newPosition = (player.position + dice[0] + dice[1]) % 40;
        let money = player.money;
        if (newPosition < player.position) money += 200;

        let newGame = {
            ...game,
            players: game.players.map((p, i) =>
                i === game.currentPlayer
                    ? { ...p, position: newPosition, money, inJail: false, jailTurns: 0 }
                    : p
            ),
            dice,
            diceRolled: true,
            phase: 'rolling',
            log: [...game.log, `${player.nick} rolled double ${dice[0]} and escaped jail!`],
        };

        const space = BOARD_SPACES[newPosition];
        newGame = handleSpace(newGame, space, dice[0] + dice[1]);
        return newGame;
    }

    // Failed to escape - increment jail turns
    const jailTurns = (player.jailTurns || 0) + 1;
    let logMsg = `${player.nick} rolled ${dice[0]}+${dice[1]} but didn't get double. Jail turn ${jailTurns}/3`;

    let newGame = {
        ...game,
        players: game.players.map((p, i) =>
            i === game.currentPlayer
                ? { ...p, jailTurns, dice: [dice[0], dice[1]] }
                : p
        ),
        dice,
        diceRolled: true,
        log: [...game.log, logMsg],
    };

    // After 3 turns, must pay $50 to get out
    if (jailTurns >= 3) {
        const money = player.money - 50;
        if (money < 0) {
            return handleBankruptcy(newGame, game.currentPlayer);
        }
        newGame = {
            ...newGame,
            players: newGame.players.map((p, i) =>
                i === game.currentPlayer
                    ? { ...p, money, inJail: false, jailTurns: 0 }
                    : p
            ),
            phase: 'rolling',
            diceRolled: false,
            log: [...newGame.log, `${player.nick} served 3 jail turns and paid $50 to escape`],
        };
    }

    return advanceTurn(newGame);
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

    if (nextIdx < currentIdx) {
        turnNum++;
    }

    return {
        ...game,
        currentPlayer: nextIdx,
        turnNumber: turnNum,
        phase: 'rolling',
        diceRolled: false,
        doublesCount: 0,
    };
}

/* ── Message Protocol ─────────────────────────────────────── */

export function isMonopolyMessage(data) {
    const action = parseMonopolyAction(data);
    return !!action?.type?.startsWith('mono_');
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
    objective: 'Outlast the table by owning the best properties, collecting rent, and forcing every other player into bankruptcy.',
    howToPlay: [
        'On your turn, roll the dice and move around the 40-space board.',
        'If you land on an unowned property, railroad, or utility, you can buy it or send it to auction.',
        'Chance and Community Chest now show 3 cards; pick 1 card to resolve that event.',
        'If you land on an owned deed, you automatically pay rent to the owner.',
        'Owning a full color set lets you build houses and then a hotel on those streets.',
        'Rolling doubles gives you another roll, but three doubles in one turn sends you to jail.',
        'In jail, either roll doubles to escape, pay $50, or wait up to three turns before the fee is forced.',
    ],
    tips: [
        'Complete color groups early so you control the most valuable lanes of the board.',
        'Keep enough cash on hand for rent spikes, taxes, and jail exits.',
        'Railroads and utilities are lower-maintenance ways to pressure opponents while you build your portfolio.',
    ],
    bets: [],
};

/* ── Register ─────────────────────────────────────────────── */

registerGame('monopoly', MonopolyEngine);
