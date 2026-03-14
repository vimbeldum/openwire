/* ═══════════════════════════════════════════════════════════
   OpenWire Web — Tambola (Housie/Bingo) game engine
   Standard 90-ball Tambola: 3×9 ticket, 5 numbers per row.
   Prizes: Early Five, Top/Middle/Bottom Line, Full House.
   Bounded Context: Tambola | Shared Core: GameEngine
   ═══════════════════════════════════════════════════════════ */

import { GameEngine, registerGame } from './GameEngine.js';

/* ── Column ranges ────────────────────────────────────────── */

/** col 0→1-9, col 1→10-19, ..., col 7→70-79, col 8→80-90 */
export const COL_RANGES = [
    [1, 9],
    [10, 19],
    [20, 29],
    [30, 39],
    [40, 49],
    [50, 59],
    [60, 69],
    [70, 79],
    [80, 90],
];

/* ── Prize definitions ────────────────────────────────────── */

export const PRIZES = {
    earlyFive:  { name: 'Early Five',   pct: 0.10 },
    topLine:    { name: 'Top Line',     pct: 0.15 },
    middleLine: { name: 'Middle Line',  pct: 0.15 },
    bottomLine: { name: 'Bottom Line',  pct: 0.15 },
    fullHouse:  { name: 'Full House',   pct: 0.45 },
};

const RAKE = 0.05;

/* ── Internal helpers ─────────────────────────────────────── */

function hashDeviceId(deviceId) {
    let hash = 5381;
    for (let i = 0; i < deviceId.length; i++) {
        hash = ((hash << 5) + hash) + deviceId.charCodeAt(i);
        hash |= 0;
    }
    return hash.toString(16);
}

/** Crypto-safe random integer in [min, max] inclusive. */
function randInt(min, max) {
    const range = max - min + 1;
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return min + (buf[0] % range);
}

/** Fisher-Yates shuffle (returns new array). */
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = randInt(0, i);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/* ── Ticket generation ────────────────────────────────────── */

/**
 * Generate a standard Tambola ticket: 3 rows × 9 columns, 15 numbers.
 * Each row has exactly 5 numbers; each column has 1–3 numbers sorted ascending.
 * Returns a 3×9 grid where 0 = blank.
 *
 * @returns {number[][]}  Array of 3 rows, each row 9 elements.
 */
export function generateTicket() {
    const MAX_ATTEMPTS = 100;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        // Step 1: decide how many numbers per column (1, 2, or 3) summing to 15
        const colCounts = _pickColCounts();
        if (!colCounts) continue;

        // Step 2: pick the actual numbers for each column
        const colNumbers = colCounts.map((count, col) => {
            const [lo, hi] = COL_RANGES[col];
            const pool = [];
            for (let n = lo; n <= hi; n++) pool.push(n);
            return shuffle(pool).slice(0, count).sort((a, b) => a - b);
        });

        // Step 3: distribute column numbers into rows (each row needs exactly 5)
        const grid = _distributeToRows(colNumbers);
        if (!grid) continue;

        return grid;
    }

    // Should virtually never reach here with retry logic
    throw new Error('generateTicket: could not generate valid ticket after 100 attempts');
}

/**
 * Pick counts per column (0..8) such that each is 1-3 and total = 15.
 * Returns array of 9 counts or null if failed.
 */
function _pickColCounts() {
    // Start with 1 per column = 9. We need to add 6 more, distributed so no column > 3.
    const counts = new Array(9).fill(1);
    let remaining = 6;
    const cols = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    for (const col of cols) {
        if (remaining === 0) break;
        const canAdd = Math.min(2, remaining); // max +2 to reach 3
        const add = randInt(0, canAdd);
        counts[col] += add;
        remaining -= add;
    }
    // If remaining > 0, force distribute
    if (remaining > 0) {
        for (let col = 0; col < 9 && remaining > 0; col++) {
            const space = 3 - counts[col];
            if (space > 0) {
                const add = Math.min(space, remaining);
                counts[col] += add;
                remaining -= add;
            }
        }
    }
    if (remaining !== 0) return null;
    if (counts.reduce((s, c) => s + c, 0) !== 15) return null;
    return counts;
}

/**
 * Given colNumbers (9 arrays of sorted numbers), distribute into a 3×9 grid
 * such that each row has exactly 5 numbers. Returns null on failure.
 *
 * @param {number[][]} colNumbers
 * @returns {number[][] | null}
 */
function _distributeToRows(colNumbers) {
    // Build a flat list of (col, number) assignments then assign to rows
    const assignments = [];
    for (let col = 0; col < 9; col++) {
        for (const num of colNumbers[col]) {
            assignments.push({ col, num });
        }
    }

    // We need a row assignment for each of the 15 numbers (3 rows, 5 per row)
    const grid = [
        new Array(9).fill(0),
        new Array(9).fill(0),
        new Array(9).fill(0),
    ];
    const rowCounts = [0, 0, 0];
    // colAssigned[col] = which rows already have a number in this column
    const colAssigned = Array.from({ length: 9 }, () => new Set());

    // Sort assignments so columns with more numbers come first (harder to place)
    const sorted = [...assignments].sort((a, b) =>
        colNumbers[b.col].length - colNumbers[a.col].length
    );

    function backtrack(idx) {
        if (idx === sorted.length) {
            return rowCounts.every(c => c === 5);
        }
        const { col, num } = sorted[idx];
        const rowOrder = shuffle([0, 1, 2]);
        for (const row of rowOrder) {
            if (rowCounts[row] < 5 && !colAssigned[col].has(row)) {
                grid[row][col] = num;
                rowCounts[row]++;
                colAssigned[col].add(row);
                if (backtrack(idx + 1)) return true;
                grid[row][col] = 0;
                rowCounts[row]--;
                colAssigned[col].delete(row);
            }
        }
        return false;
    }

    if (!backtrack(0)) return null;

    // Sort numbers within each column ascending (smallest number to topmost occupied row)
    for (let col = 0; col < 9; col++) {
        const rowsWithNum = [];
        for (let row = 0; row < 3; row++) {
            if (grid[row][col] !== 0) rowsWithNum.push(row);
        }
        const sortedVals = rowsWithNum.map(r => grid[r][col]).sort((a, b) => a - b);
        rowsWithNum.forEach((row, i) => { grid[row][col] = sortedVals[i]; });
    }

    return grid;
}

/* ── Pure game state helpers ──────────────────────────────── */

/**
 * Returns flat array of all non-zero numbers on a ticket.
 * @param {number[][]} ticket  3×9 grid
 * @returns {number[]}
 */
export function getTicketNumbers(ticket) {
    return ticket.flat().filter(n => n !== 0);
}

/**
 * Validate whether a prize claim is legitimate given calledNumbers.
 *
 * @param {number[][]} ticket       3×9 grid
 * @param {string}     prizeKey     One of the PRIZES keys
 * @param {number[]}   calledNumbers  Numbers drawn so far
 * @returns {boolean}
 */
export function validateClaim(ticket, prizeKey, calledNumbers) {
    const called = new Set(calledNumbers);

    switch (prizeKey) {
        case 'earlyFive': {
            const allNums = getTicketNumbers(ticket);
            const matchCount = allNums.filter(n => called.has(n)).length;
            return matchCount >= 5;
        }
        case 'topLine': {
            const rowNums = ticket[0].filter(n => n !== 0);
            return rowNums.every(n => called.has(n));
        }
        case 'middleLine': {
            const rowNums = ticket[1].filter(n => n !== 0);
            return rowNums.every(n => called.has(n));
        }
        case 'bottomLine': {
            const rowNums = ticket[2].filter(n => n !== 0);
            return rowNums.every(n => called.has(n));
        }
        case 'fullHouse': {
            const allNums = getTicketNumbers(ticket);
            return allNums.every(n => called.has(n));
        }
        default:
            return false;
    }
}

/* ── State factory ────────────────────────────────────────── */

/**
 * Create the initial game state for a new Tambola session.
 * @param {object} config
 * @returns {object}
 */
export function createInitialState(config = {}) {
    return {
        id: 'tambola_' + Date.now(),
        status: 'lobby',       // 'lobby' | 'drawing' | 'ended'
        ticketPrice: config.ticketPrice || 100,
        drawInterval: config.drawInterval || 5000,
        calledNumbers: [],
        tickets: {},           // deviceHash → ticket[]
        prizes: Object.fromEntries(
            Object.keys(PRIZES).map(k => [k, { winner: null, amount: 0 }])
        ),
        prizePool: 0,
    };
}

/* ── Pure game actions ────────────────────────────────────── */

/**
 * Purchase tickets. Only valid during 'lobby' status.
 * Applies a 5% rake per ticket before adding to prizePool.
 *
 * @param {object} state
 * @param {string} deviceId
 * @param {number} count   1-3 tickets
 * @returns {{ success: boolean, state: object, tickets?: number[][][], reason?: string }}
 */
export function buyTicket(state, deviceId, count = 1) {
    if (state.status !== 'lobby') {
        return { success: false, state, reason: 'Game has already started' };
    }
    if (!Number.isInteger(count) || count < 1 || count > 3) {
        return { success: false, state, reason: 'count must be 1, 2, or 3' };
    }

    const hash = hashDeviceId(deviceId);
    const newTickets = Array.from({ length: count }, () => generateTicket());
    const existing = state.tickets[hash] || [];
    const prizeContribution = Math.floor(state.ticketPrice * (1 - RAKE)) * count;

    const newState = {
        ...state,
        tickets: {
            ...state.tickets,
            [hash]: [...existing, ...newTickets],
        },
        prizePool: state.prizePool + prizeContribution,
    };

    return { success: true, state: newState, tickets: newTickets };
}

/**
 * Transition game from 'lobby' to 'drawing'.
 * @param {object} state
 * @returns {object}  Updated state
 */
export function startGame(state) {
    return { ...state, status: 'drawing' };
}

/**
 * Draw the next number. Only valid during 'drawing' status.
 *
 * @param {object} state
 * @param {number} [nowMs]  Current timestamp (for testing)
 * @returns {{ success: boolean, state: object, number?: number, reason?: string }}
 */
export function drawNumber(state, nowMs) {
    if (state.status !== 'drawing') {
        return { success: false, state, reason: 'Game is not in drawing state' };
    }

    const remaining = [];
    for (let n = 1; n <= 90; n++) {
        if (!state.calledNumbers.includes(n)) remaining.push(n);
    }

    if (remaining.length === 0) {
        return { success: false, state, reason: 'All 90 numbers have been called' };
    }

    const idx = randInt(0, remaining.length - 1);
    const number = remaining[idx];

    const newState = {
        ...state,
        calledNumbers: [...state.calledNumbers, number],
    };

    return { success: true, state: newState, number };
}

/**
 * Claim a prize for a ticket held by deviceId.
 * Validates the pattern against calledNumbers before awarding.
 *
 * @param {object} state
 * @param {string} deviceId
 * @param {string} prizeKey    One of the PRIZES keys
 * @param {number} ticketId    Index of the ticket in the player's ticket array
 * @returns {{ success: boolean, state: object, amount?: number, reason?: string }}
 */
export function claimPrize(state, deviceId, prizeKey, ticketId) {
    if (!PRIZES[prizeKey]) {
        return { success: false, state, reason: `Unknown prize: ${prizeKey}` };
    }

    const prize = state.prizes[prizeKey];
    if (prize.winner !== null) {
        return { success: false, state, reason: `${PRIZES[prizeKey].name} already claimed` };
    }

    const hash = hashDeviceId(deviceId);
    const playerTickets = state.tickets[hash];
    if (!playerTickets || !playerTickets[ticketId]) {
        return { success: false, state, reason: 'Ticket not found' };
    }

    const ticket = playerTickets[ticketId];

    if (!validateClaim(ticket, prizeKey, state.calledNumbers)) {
        return { success: false, state, reason: 'Claim pattern not complete' };
    }

    const engine = new TambolaEngine({ prizePool: state.prizePool });
    const amount = engine.calculatePayout(
        { prizePool: state.prizePool, claimed: {} },
        { winner: prizeKey }
    );

    const newPrizes = {
        ...state.prizes,
        [prizeKey]: { winner: hash, amount },
    };

    let newStatus = state.status;
    if (prizeKey === 'fullHouse') {
        newStatus = 'ended';
    }

    const newState = {
        ...state,
        prizes: newPrizes,
        status: newStatus,
    };

    return { success: true, state: newState, amount };
}

/**
 * On game end, roll any unclaimed prize percentages into fullHouse.
 * Returns updated state.
 *
 * @param {object} state
 * @returns {object}
 */
export function redistributeUnclaimed(state) {
    const unclaimedPct = Object.entries(state.prizes)
        .filter(([key, p]) => key !== 'fullHouse' && p.winner === null)
        .reduce((sum, [key]) => sum + PRIZES[key].pct, 0);

    if (unclaimedPct === 0) return state;

    const fullHousePrize = state.prizes.fullHouse;
    const additionalAmount = Math.floor(state.prizePool * unclaimedPct);
    const newFullHouseAmount = fullHousePrize.amount + additionalAmount;

    return {
        ...state,
        prizes: {
            ...state.prizes,
            fullHouse: { ...fullHousePrize, amount: newFullHouseAmount },
        },
    };
}

/* ── GameEngine implementation ────────────────────────────── */

export class TambolaEngine extends GameEngine {
    constructor(config = {}) {
        super();
        this.state = createInitialState(config);
    }

    getGameState() {
        return { ...this.state };
    }

    /**
     * Calculate payout for a single prize claim.
     *
     * @param {{ prizePool: number, claimed: object }} bets
     * @param {{ winner: string }} result  winner = prizeKey
     * @returns {number}  Chip amount awarded
     */
    calculatePayout(bets, result) {
        const prizeConfig = PRIZES[result.winner];
        if (!prizeConfig) return 0;
        return Math.floor(bets.prizePool * prizeConfig.pct);
    }

    getRules() {
        return 'Tambola: 3x9 ticket, 5 per row. Prizes: Early Five, Top/Middle/Bottom Line, Full House.';
    }

    calculateResults(gameState) {
        const { prizes, prizePool } = gameState;
        const breakdown = Object.entries(prizes).map(([key, p]) => ({
            prize: PRIZES[key]?.name || key,
            winner: p.winner || 'unclaimed',
            amount: p.amount,
        }));
        return {
            financial: true,
            gameType: 'tambola',
            roundId: gameState.id,
            resultLabel: 'Tambola round ended',
            prizePool,
            breakdown,
        };
    }
}

registerGame('tambola', TambolaEngine);
