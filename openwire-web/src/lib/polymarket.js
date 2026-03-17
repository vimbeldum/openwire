/* ═══════════════════════════════════════════════════════════
   OpenWire Web — Polymarket prediction market engine
   AMM-powered prediction markets: buy/sell outcome shares
   Constant Product Market Maker for binary, proportional for multi
   Bounded Context: Polymarket | Shared Core: GameEngine + payouts
   ═══════════════════════════════════════════════════════════ */

import { GameEngine, registerGame } from './GameEngine.js';
import { createPayoutEvent } from './core/PayoutEvent.js';

export const MAX_OUTCOMES = 6;
export const DEFAULT_SEED = 1000;
export const MIN_SHARES = 1;
export const MAX_SHARES_PER_TRADE = 100;
export const MAX_TRADE_HISTORY = 50;

/* ── AMM Price Calculations ─────────────────────────────── */

// Prices on 0-100 scale. price[i] = q[i] / total (proportional to demand).
export function calculatePrices(pool) {
    const { quantities } = pool;
    const n = quantities.length;
    if (n < 2) return [100];

    if (n === 2) {
        const total = quantities[0] + quantities[1];
        if (total === 0) return [50, 50];
        // Price of outcome i is proportional to its own quantity share.
        // Buying outcome 0 increases q[0], which increases its price — correct
        // for a prediction market where buying signals increased belief.
        return [
            Math.round((quantities[0] / total) * 100),
            Math.round((quantities[1] / total) * 100),
        ];
    }

    const totalPool = quantities.reduce((s, q) => s + q, 0);
    if (totalPool === 0) return quantities.map(() => Math.round(100 / n));

    // Price of outcome i is proportional to its pool share.
    // Higher qi (more demand) → higher price → correct market signal.
    return quantities.map(qi => {
        const raw = (qi / totalPool) * 100;
        return Math.round(raw);
    });
}

function binaryCostToBuy(pool, idx, shares) {
    const other = 1 - idx;
    const qOther = pool.quantities[other];
    const qSelf = pool.quantities[idx];
    const k = pool.k;
    if (qSelf + shares <= 0) return Infinity;
    const newQOther = k / (qSelf + shares);
    const cost = Math.round(qOther - newQOther);
    return Math.max(cost, 1);
}

function binaryCostToSell(pool, idx, shares) {
    const other = 1 - idx;
    const qOther = pool.quantities[other];
    const qSelf = pool.quantities[idx];
    const k = pool.k;
    if (qSelf - shares < 1) return 0; // can't drain pool below 1
    const newQOther = k / (qSelf - shares);
    const revenue = Math.round(newQOther - qOther);
    return Math.max(revenue, 0);
}

function multiCostToBuy(pool, idx, shares) {
    const prices = calculatePrices(pool);
    const pricePerShare = prices[idx]; // 0-100
    const cost = Math.round((pricePerShare * shares) / 100);
    return Math.max(cost, 1);
}

function multiCostToSell(pool, idx, shares) {
    const prices = calculatePrices(pool);
    const pricePerShare = prices[idx];
    const revenue = Math.round((pricePerShare * shares) / 100);
    return Math.max(revenue, 0);
}

/* ── Game State Functions ───────────────────────────────── */

export function createPolymarket(roomId) {
    return {
        type: 'polymarket',
        roomId,
        phase: 'open',
        marketId: null,
        question: null,
        outcomes: [],
        pool: null,
        prices: [],
        positions: {},
        tradeHistory: [],
        result: null,
        payouts: null,
        volume: 0,
        createdAt: Date.now(),
        resolvedAt: null,
    };
}

export function createMarket(game, question, outcomes, seed = DEFAULT_SEED) {
    if (!question || !outcomes || outcomes.length < 2 || outcomes.length > MAX_OUTCOMES) {
        return game;
    }
    const n = outcomes.length;
    const quantities = new Array(n).fill(seed);
    const k = n === 2 ? seed * seed : 0;
    const pool = { quantities, k, seed };
    const prices = quantities.map(() => Math.round(100 / n));

    return {
        ...game,
        phase: 'open',
        marketId: `${game.roomId}-${Date.now()}`,
        question,
        outcomes: [...outcomes],
        pool,
        prices,
        positions: {},
        tradeHistory: [],
        result: null,
        payouts: null,
        volume: 0,
        createdAt: Date.now(),
        resolvedAt: null,
    };
}

export function buyShares(game, peer_id, nick, outcomeIdx, shares) {
    if (game.phase !== 'open') return { game, cost: 0 };
    if (!game.pool || !game.outcomes.length) return { game, cost: 0 };
    if (outcomeIdx < 0 || outcomeIdx >= game.outcomes.length) return { game, cost: 0 };
    if (!shares || shares < MIN_SHARES || shares > MAX_SHARES_PER_TRADE) return { game, cost: 0 };
    shares = Math.floor(shares);

    const n = game.pool.quantities.length;
    const isBinary = n === 2;
    const cost = isBinary
        ? binaryCostToBuy(game.pool, outcomeIdx, shares)
        : multiCostToBuy(game.pool, outcomeIdx, shares);

    if (!isFinite(cost) || cost <= 0) return { game, cost: 0 };

    const quantities = [...game.pool.quantities];
    quantities[outcomeIdx] += shares;
    // Maintain CPMM invariant: decrement the other side(s) by the cost paid.
    // For binary markets, k = q0 * q1 must stay constant after the trade.
    // For multi-outcome, distribute the cost reduction proportionally.
    if (isBinary) {
        const other = 1 - outcomeIdx;
        quantities[other] -= cost;
        if (quantities[other] < 1) quantities[other] = 1; // floor at 1 to prevent division by zero
    } else {
        // Spread cost reduction across other outcomes proportionally
        const others = quantities.map((q, i) => i !== outcomeIdx ? i : -1).filter(i => i >= 0);
        const totalOther = others.reduce((s, i) => s + quantities[i], 0);
        let remaining = cost;
        for (const i of others) {
            const share = totalOther > 0 ? Math.round(cost * quantities[i] / totalOther) : Math.round(cost / others.length);
            const deduction = Math.min(share, quantities[i] - 1, remaining);
            quantities[i] -= deduction;
            remaining -= deduction;
        }
        // Sweep any rounding remainder into the first outcome that has room
        for (const i of others) {
            if (remaining <= 0) break;
            const canTake = quantities[i] - 1;
            const take = Math.min(canTake, remaining);
            quantities[i] -= take;
            remaining -= take;
        }
    }
    const pool = { ...game.pool, quantities };

    const prev = game.positions[peer_id] || { nick, shares: new Array(n).fill(0), totalCost: 0 };
    const playerShares = [...prev.shares];
    playerShares[outcomeIdx] += shares;
    const positions = {
        ...game.positions,
        [peer_id]: { nick, shares: playerShares, totalCost: prev.totalCost + cost },
    };

    const trade = {
        peer_id, nick, action: 'buy', outcomeIdx,
        outcome: game.outcomes[outcomeIdx], shares, cost, ts: Date.now(),
    };
    const tradeHistory = [...game.tradeHistory, trade].slice(-MAX_TRADE_HISTORY);
    const prices = calculatePrices(pool);
    const volume = game.volume + cost;

    return {
        game: { ...game, pool, prices, positions, tradeHistory, volume },
        cost,
    };
}

export function sellShares(game, peer_id, nick, outcomeIdx, shares) {
    if (game.phase !== 'open') return { game, revenue: 0 };
    if (!game.pool || !game.outcomes.length) return { game, revenue: 0 };
    if (outcomeIdx < 0 || outcomeIdx >= game.outcomes.length) return { game, revenue: 0 };
    if (!shares || shares < MIN_SHARES || shares > MAX_SHARES_PER_TRADE) return { game, revenue: 0 };
    shares = Math.floor(shares);

    const pos = game.positions[peer_id];
    if (!pos || pos.shares[outcomeIdx] < shares) return { game, revenue: 0 };

    const n = game.pool.quantities.length;
    const isBinary = n === 2;
    if (game.pool.quantities[outcomeIdx] - shares < 1) return { game, revenue: 0 };

    const revenue = isBinary
        ? binaryCostToSell(game.pool, outcomeIdx, shares)
        : multiCostToSell(game.pool, outcomeIdx, shares);

    const quantities = [...game.pool.quantities];
    quantities[outcomeIdx] -= shares;
    // Maintain CPMM invariant: increment the other side(s) by the revenue returned.
    if (isBinary) {
        const other = 1 - outcomeIdx;
        quantities[other] += revenue;
    } else {
        const others = quantities.map((q, i) => i !== outcomeIdx ? i : -1).filter(i => i >= 0);
        const totalOther = others.reduce((s, i) => s + quantities[i], 0);
        let remaining = revenue;
        for (const i of others) {
            const share = totalOther > 0 ? Math.round(revenue * quantities[i] / totalOther) : Math.round(revenue / others.length);
            const addition = Math.min(share, remaining);
            quantities[i] += addition;
            remaining -= addition;
        }
        // Sweep any rounding remainder into the first available outcome
        if (remaining > 0 && others.length > 0) {
            quantities[others[0]] += remaining;
        }
    }
    const pool = { ...game.pool, quantities };
    const playerShares = [...pos.shares];
    playerShares[outcomeIdx] -= shares;
    const newTotalCost = Math.max(0, pos.totalCost - revenue);
    const positions = {
        ...game.positions,
        [peer_id]: { nick, shares: playerShares, totalCost: newTotalCost },
    };

    const trade = {
        peer_id, nick, action: 'sell', outcomeIdx,
        outcome: game.outcomes[outcomeIdx], shares, revenue, ts: Date.now(),
    };
    const tradeHistory = [...game.tradeHistory, trade].slice(-MAX_TRADE_HISTORY);
    const prices = calculatePrices(pool);
    const volume = game.volume + revenue;

    return {
        game: { ...game, pool, prices, positions, tradeHistory, volume },
        revenue,
    };
}

export function lockMarket(game) {
    if (game.phase !== 'open') return game;
    return { ...game, phase: 'locked' };
}

export function resolveMarket(game, winnerIdx) {
    if (game.phase !== 'locked' && game.phase !== 'open') return game;
    if (winnerIdx < 0 || winnerIdx >= game.outcomes.length) return game;

    const payouts = {};
    for (const [peerId, pos] of Object.entries(game.positions)) {
        const winningShares = pos.shares[winnerIdx] || 0;
        const credit = winningShares * 100;
        const net = credit - pos.totalCost;
        payouts[peerId] = net;
    }

    return {
        ...game,
        phase: 'resolved',
        result: winnerIdx,
        payouts,
        resolvedAt: Date.now(),
    };
}

export function newMarket(game) {
    return createPolymarket(game.roomId);
}

/* ── Rules (used by HowToPlay) ──────────────────────────── */

export const POLYMARKET_RULES = {
    name: 'Predictions',
    description: 'Trade shares on the outcomes of questions. Prices move based on demand. Winning shares pay 100 chips each.',
    bets: [
        { name: 'Buy Shares', odds: 'Variable', description: 'Buy shares of an outcome. Price increases as more people buy.' },
        { name: 'Sell Shares', odds: 'Variable', description: 'Sell shares back to the pool. Price decreases as people sell.' },
    ],
};

/* ── GameEngine implementation ──────────────────────────── */

export class PolymarketEngine extends GameEngine {
    constructor(game) {
        super();
        this._game = game;
    }

    getGameState() {
        return this._game;
    }

    // AMM-based; payouts calculated at resolution. Implements interface contract.
    calculatePayout(positions, result) {
        const payouts = {};
        if (!positions || result == null) return payouts;
        for (const [peerId, pos] of Object.entries(positions)) {
            const winningShares = (pos.shares && pos.shares[result]) || 0;
            const credit = winningShares * 100;
            payouts[peerId] = credit - (pos.totalCost || 0);
        }
        return payouts;
    }

    getRules() {
        return POLYMARKET_RULES;
    }

    calculateResults(gameState) {
        const { result, positions, outcomes, roomId, question } = gameState;
        const winLabel = outcomes && outcomes[result] != null ? outcomes[result] : 'Unknown';
        const resultLabel = `${question || 'Market'} — ${winLabel} wins`;

        const breakdown = Object.entries(positions || {}).map(([peerId, pos]) => {
            const winningShares = (pos.shares && pos.shares[result]) || 0;
            const credit = winningShares * 100;
            const net = credit - (pos.totalCost || 0);
            return {
                peer_id: peerId,
                nick: pos.nick || peerId,
                betLabel: `${winningShares} winning share${winningShares !== 1 ? 's' : ''}`,
                wager: pos.totalCost || 0,
                net,
                outcome: net > 0 ? 'win' : net === 0 ? 'push' : 'loss',
            };
        });

        const totals = {};
        for (const b of breakdown) {
            totals[b.peer_id] = (totals[b.peer_id] ?? 0) + b.net;
        }

        return createPayoutEvent({
            gameType: 'polymarket',
            roundId: `${roomId}-${Date.now()}`,
            resultLabel,
            breakdown,
            totals,
        });
    }
}

registerGame('polymarket', PolymarketEngine);

/* ── Message Protocol ───────────────────────────────────── */

export function isPolymarketMessage(data) {
    return typeof data === 'string' && data.startsWith('PM:');
}

export function parsePolymarketAction(data) {
    if (!isPolymarketMessage(data)) return null;
    try { return JSON.parse(data.slice(3)); } catch { return null; }
}

export function serializePolymarketAction(action) {
    return 'PM:' + JSON.stringify(action);
}

export function serializeGame(game) {
    return JSON.stringify({
        ...game,
        tradeHistory: (game.tradeHistory || []).slice(-20),
    });
}

export function deserializeGame(data) {
    try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        if (!parsed) return null;
        if (!parsed.outcomes) parsed.outcomes = [];
        if (!parsed.positions) parsed.positions = {};
        if (!parsed.tradeHistory) parsed.tradeHistory = [];
        if (!parsed.prices) parsed.prices = [];
        if (parsed.pool && !parsed.pool.quantities) parsed.pool.quantities = [];
        return parsed;
    } catch { return null; }
}
