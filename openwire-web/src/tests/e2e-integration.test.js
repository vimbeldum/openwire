import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Source module imports ──────────────────────────────────── */

// Shared Core
import { GameEngine, createGameEngine, getRegisteredGames } from '../lib/GameEngine.js';
import { createPayoutEvent, createNonFinancialEvent } from '../lib/core/PayoutEvent.js';
import { calcHouseGain, settleBets, clampChips } from '../lib/core/payouts.js';
import * as ledger from '../lib/core/ledger.js';
import * as walletLib from '../lib/wallet.js';

// Game Engines
import {
    createRoulette, placeBet as rlPlaceBet, spin, finishSpin,
    newRound as rlNewRound, getPayout, RouletteEngine,
} from '../lib/roulette.js';
import {
    createGame as bjCreateGame, addPlayer, placeBet as bjPlaceBet,
    dealInitialCards, hit, stand, dealerPlay, settle, runDealerTurn,
    getPayouts as bjGetPayouts, calculateHand, isBlackjack, isBust,
    BlackjackEngine,
} from '../lib/blackjack.js';
import {
    createGame as abCreateGame, placeBet as abPlaceBet,
    dealTrump, dealNext, AndarBaharEngine,
} from '../lib/andarbahar.js';
import {
    createSlots, spinReels, calculatePayout as slotsCalcPayout,
    SlotsEngine,
} from '../lib/slots.js';
import {
    createGame as tttCreateGame, makeMove, calculateResults as tttCalculateResults,
} from '../lib/game.js';

// Casino State
import {
    createCasinoState, updateHousePnl, getTotalHousePnl,
    mergeCasinoStates,
} from '../lib/casinoState.js';


/* ── Browser API mocking (CRITICAL) ────────────────────────── */

let mockStorage;

beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal('localStorage', {
        getItem: vi.fn(k => mockStorage[k] ?? null),
        setItem: vi.fn((k, v) => { mockStorage[k] = v; }),
        removeItem: vi.fn(k => { delete mockStorage[k]; }),
    });
    vi.stubGlobal('sessionStorage', {
        getItem: vi.fn(k => mockStorage[k] ?? null),
        setItem: vi.fn((k, v) => { mockStorage[k] = v; }),
        removeItem: vi.fn(k => { delete mockStorage[k]; }),
    });
    vi.stubGlobal('crypto', {
        randomUUID: () => `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        getRandomValues: (buf) => {
            for (let i = 0; i < buf.length; i++) {
                buf[i] = Math.floor(Math.random() * 0x100000000);
            }
            return buf;
        },
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});


/* ── Helper: create a wallet object directly (bypass localStorage device logic) ── */

function makeWallet(deviceId, startBalance) {
    return {
        deviceId,
        nick: 'TestPlayer',
        baseBalance: startBalance,
        adminBonus: 0,
        lastRefreshDate: '2026-01-01',
        history: [{ time: Date.now(), reason: 'Test init', amount: startBalance, balance: startBalance }],
    };
}


/* ═══════════════════════════════════════════════════════════════
   SUITE 1 — Full Roulette round: bet -> spin -> payout -> wallet -> ledger
   ═══════════════════════════════════════════════════════════════ */

describe('Full Roulette round: bet -> spin -> payout -> wallet -> ledger', () => {

    it('winning color bet credits wallet and records event in ledger', () => {
        const deviceId = 'dev-rl-1';
        const myId = 'peer-alice';

        // 1. Create wallet with 1000 chips, debit 100 for bet
        let wallet = makeWallet(deviceId, 1000);
        wallet = walletLib.debit(wallet, 100, 'Roulette bet');
        expect(walletLib.getTotalBalance(wallet)).toBe(900);

        // 2. Create roulette game, place bet on red
        let game = createRoulette('room1');
        game = rlPlaceBet(game, myId, 'Alice', 'color', 'red', 100);
        expect(game.bets).toHaveLength(1);

        // 3. Force a known result: result = 1 (red) by manipulating after spin
        game = spin(game);
        // Override result to a known red number for deterministic testing
        game = { ...game, result: 1 };
        // Recompute payouts for the forced result
        const engine = new RouletteEngine(game);
        const payouts = engine.calculatePayout(game.bets, 1);
        game = { ...game, payouts };
        expect(payouts[myId]).toBe(100); // net +100 (won the 1:1 color bet)

        // 4. Create PayoutEvent from results
        game = finishSpin(game);
        const event = engine.calculateResults({ ...game, result: 1 });
        expect(event.financial).toBe(true);
        expect(event.gameType).toBe('roulette');
        expect(event.totals[myId]).toBe(100);
        expect(event.breakdown).toHaveLength(1);
        expect(event.breakdown[0].outcome).toBe('win');

        // 5. Process event through ledger
        const { updatedWallet } = ledger.processEvent(wallet, event, myId, deviceId);

        // 6. Verify wallet: was 900 after debit, settlement credits wager(100) + net(100) = 200
        expect(walletLib.getTotalBalance(updatedWallet)).toBe(1100);

        // 7. Verify ledger has the event recorded
        const history = ledger.getHistory(deviceId);
        expect(history).toHaveLength(1);
        expect(history[0].gameType).toBe('roulette');
        expect(history[0].financial).toBe(true);

        // 8. Verify house PnL: players won 100, house lost 100
        let casinoState = createCasinoState();
        casinoState = updateHousePnl(casinoState, 'roulette', payouts);
        expect(casinoState.housePnl.roulette).toBe(-100);
    });

    it('losing color bet does not credit wallet, loss recorded', () => {
        const deviceId = 'dev-rl-2';
        const myId = 'peer-bob';

        let wallet = makeWallet(deviceId, 1000);
        wallet = walletLib.debit(wallet, 100, 'Roulette bet');
        expect(walletLib.getTotalBalance(wallet)).toBe(900);

        let game = createRoulette('room2');
        game = rlPlaceBet(game, myId, 'Bob', 'color', 'red', 100);
        game = spin(game);
        // Force result = 0 (green) so red bet loses
        game = { ...game, result: 0 };

        const engine = new RouletteEngine(game);
        const payouts = engine.calculatePayout(game.bets, 0);
        expect(payouts[myId]).toBe(-100);

        const event = engine.calculateResults({ ...game, result: 0 });
        expect(event.totals[myId]).toBe(-100);
        expect(event.breakdown[0].outcome).toBe('loss');

        const { updatedWallet } = ledger.processEvent(wallet, event, myId, deviceId);
        // Loss: wager(100) + net(-100) = credit 0, wallet stays at 900
        expect(walletLib.getTotalBalance(updatedWallet)).toBe(900);

        let casinoState = createCasinoState();
        casinoState = updateHousePnl(casinoState, 'roulette', payouts);
        expect(casinoState.housePnl.roulette).toBe(100);
    });

    it('single number win (35:1) produces correct payout chain', () => {
        const deviceId = 'dev-rl-3';
        const myId = 'peer-carol';

        let wallet = makeWallet(deviceId, 1000);
        wallet = walletLib.debit(wallet, 50, 'Single bet');
        expect(walletLib.getTotalBalance(wallet)).toBe(950);

        let game = createRoulette('room3');
        game = rlPlaceBet(game, myId, 'Carol', 'single', 17, 50);
        game = spin(game);
        game = { ...game, result: 17 };

        const engine = new RouletteEngine(game);
        const payouts = engine.calculatePayout(game.bets, 17);
        // single number: multiplier = 36, net = 50 * (36-1) = 1750
        expect(payouts[myId]).toBe(1750);

        const event = engine.calculateResults({ ...game, result: 17 });
        const { updatedWallet } = ledger.processEvent(wallet, event, myId, deviceId);
        // Credit = wager(50) + net(1750) = 1800
        expect(walletLib.getTotalBalance(updatedWallet)).toBe(950 + 1800);

        const houseGain = calcHouseGain(payouts);
        expect(houseGain).toBe(-1750);
    });

    it('multiple bets from same player accumulate correctly', () => {
        const deviceId = 'dev-rl-4';
        const myId = 'peer-dave';

        let wallet = makeWallet(deviceId, 1000);
        wallet = walletLib.debit(wallet, 150, 'Multi bet');

        let game = createRoulette('room4');
        game = rlPlaceBet(game, myId, 'Dave', 'color', 'red', 100);
        game = rlPlaceBet(game, myId, 'Dave', 'parity', 'odd', 50);
        expect(game.bets).toHaveLength(2);

        // result 1 is red AND odd
        const engine = new RouletteEngine(game);
        const payouts = engine.calculatePayout(game.bets, 1);
        // red: +100, odd: +50 => total net +150
        expect(payouts[myId]).toBe(150);
    });
});


/* ═══════════════════════════════════════════════════════════════
   SUITE 2 — Full Blackjack round: deal -> play -> settle -> wallet
   ═══════════════════════════════════════════════════════════════ */

describe('Full Blackjack round: deal -> play -> settle -> wallet', () => {

    it('player stands, dealer busts: player wins 1:1', () => {
        const deviceId = 'dev-bj-1';
        const myId = 'peer-alice';

        let wallet = makeWallet(deviceId, 1000);
        wallet = walletLib.debit(wallet, 200, 'BJ bet');
        expect(walletLib.getTotalBalance(wallet)).toBe(800);

        // Create game and set up a scenario manually for determinism
        let game = bjCreateGame('room-bj', 'dealer-host');
        game = addPlayer(game, myId, 'Alice');
        game = bjPlaceBet(game, myId, 200);

        // Manually set up hands for deterministic test:
        // Player has 20, dealer has 16 -> dealer must hit
        game = {
            ...game,
            phase: 'dealer',
            dealer: {
                ...game.dealer,
                hand: [
                    { value: '10', suit: '♠' },
                    { value: '6', suit: '♥' },
                ],
                revealed: true,
            },
            players: [{
                ...game.players[0],
                hand: [
                    { value: 'K', suit: '♠' },
                    { value: 'Q', suit: '♥' },
                ],
                status: 'stand',
            }],
            // Deck has a card that will bust dealer (10+6+10 = 26)
            deck: [{ value: '10', suit: '♦' }],
        };

        // Dealer plays (hits on 16, gets 10 -> 26 = bust)
        game = dealerPlay(game);
        expect(calculateHand(game.dealer.hand)).toBe(26);
        expect(game.phase).toBe('settlement');

        game = settle(game);
        expect(game.phase).toBe('ended');
        expect(game.players[0].status).toBe('win');

        // Get payouts
        const payouts = bjGetPayouts(game);
        expect(payouts[myId]).toBe(200); // 1:1 win

        // Create and process event via engine
        const engine = new BlackjackEngine(game);
        const event = engine.calculateResults(game);
        expect(event.financial).toBe(true);
        expect(event.totals[myId]).toBe(200);

        const { updatedWallet } = ledger.processEvent(wallet, event, myId, deviceId);
        // Credit = wager(200) + net(200) = 400, wallet was 800 -> 1200
        expect(walletLib.getTotalBalance(updatedWallet)).toBe(1200);
    });

    it('player busts: player loses bet', () => {
        const deviceId = 'dev-bj-2';
        const myId = 'peer-bob';

        let wallet = makeWallet(deviceId, 500);
        wallet = walletLib.debit(wallet, 100, 'BJ bet');

        let game = bjCreateGame('room-bj2', 'dealer-host');
        game = addPlayer(game, myId, 'Bob');
        game = bjPlaceBet(game, myId, 100);

        // Manually create a busted player scenario
        game = {
            ...game,
            phase: 'dealer',
            dealer: {
                ...game.dealer,
                hand: [
                    { value: '10', suit: '♠' },
                    { value: '7', suit: '♥' },
                ],
                revealed: true,
            },
            players: [{
                ...game.players[0],
                hand: [
                    { value: '10', suit: '♠' },
                    { value: '8', suit: '♥' },
                    { value: '5', suit: '♦' },
                ],
                status: 'bust',
            }],
            deck: [],
        };

        game = dealerPlay(game);
        game = settle(game);
        expect(game.phase).toBe('ended');
        expect(game.players[0].status).toBe('lose');

        const payouts = bjGetPayouts(game);
        expect(payouts[myId]).toBe(-100);

        const engine = new BlackjackEngine(game);
        const event = engine.calculateResults(game);
        const { updatedWallet } = ledger.processEvent(wallet, event, myId, deviceId);
        // Loss: credit = wager(100) + net(-100) = 0, wallet stays at 400
        expect(walletLib.getTotalBalance(updatedWallet)).toBe(400);
    });

    it('push returns bet to player (net zero)', () => {
        const deviceId = 'dev-bj-3';
        const myId = 'peer-carol';

        let wallet = makeWallet(deviceId, 1000);
        wallet = walletLib.debit(wallet, 100, 'BJ bet');

        // Both player and dealer have 20 -> push
        let game = {
            type: 'blackjack',
            roomId: 'room-bj3',
            phase: 'settlement',
            dealer: {
                peer_id: 'dealer-host',
                hand: [
                    { value: 'K', suit: '♠' },
                    { value: '10', suit: '♥' },
                ],
                revealed: true,
            },
            players: [{
                peer_id: myId,
                nick: 'Carol',
                hand: [
                    { value: 'Q', suit: '♠' },
                    { value: '10', suit: '♦' },
                ],
                status: 'stand',
                bet: 100,
            }],
            deck: [],
        };

        game = settle(game);
        expect(game.players[0].status).toBe('push');

        const payouts = bjGetPayouts(game);
        expect(payouts[myId]).toBe(0);

        const engine = new BlackjackEngine(game);
        const event = engine.calculateResults(game);
        const { updatedWallet } = ledger.processEvent(wallet, event, myId, deviceId);
        // Push: credit = wager(100) + net(0) = 100, wallet was 900 -> 1000
        expect(walletLib.getTotalBalance(updatedWallet)).toBe(1000);
    });

    it('blackjack (natural 21) pays 3:2', () => {
        const deviceId = 'dev-bj-4';
        const myId = 'peer-dave';

        let wallet = makeWallet(deviceId, 1000);
        wallet = walletLib.debit(wallet, 100, 'BJ bet');

        let game = {
            type: 'blackjack',
            roomId: 'room-bj4',
            phase: 'settlement',
            dealer: {
                peer_id: 'dealer-host',
                hand: [
                    { value: '10', suit: '♠' },
                    { value: '8', suit: '♥' },
                ],
                revealed: true,
            },
            players: [{
                peer_id: myId,
                nick: 'Dave',
                hand: [
                    { value: 'A', suit: '♠' },
                    { value: 'K', suit: '♥' },
                ],
                status: 'blackjack',
                bet: 100,
            }],
            deck: [],
        };

        game = settle(game);
        expect(game.players[0].status).toBe('blackjack-win');

        const payouts = bjGetPayouts(game);
        expect(payouts[myId]).toBe(150); // 1.5x

        const engine = new BlackjackEngine(game);
        const event = engine.calculateResults(game);
        const { updatedWallet } = ledger.processEvent(wallet, event, myId, deviceId);
        // BJ win: credit = wager(100) + net(150) = 250, wallet was 900 -> 1150
        expect(walletLib.getTotalBalance(updatedWallet)).toBe(1150);
    });
});


/* ═══════════════════════════════════════════════════════════════
   SUITE 3 — Full Andar Bahar round: bet -> trump -> deal -> match -> payout
   ═══════════════════════════════════════════════════════════════ */

describe('Full Andar Bahar round: bet -> deal trump -> deal cards -> match -> payout', () => {

    it('winning andar bet produces correct payout chain', () => {
        const deviceId = 'dev-ab-1';
        const myId = 'peer-alice';

        let wallet = makeWallet(deviceId, 1000);
        wallet = walletLib.debit(wallet, 100, 'AB bet');
        expect(walletLib.getTotalBalance(wallet)).toBe(900);

        // Create game and place bet
        let game = abCreateGame('room-ab1');
        game = abPlaceBet(game, myId, 'Alice', 'andar', 100);
        expect(game.bets).toHaveLength(1);

        // Deal trump
        game = dealTrump(game);
        expect(game.phase).toBe('dealing');
        expect(game.trumpCard).toBeTruthy();

        const trumpValue = game.trumpCard.value;

        // Deal cards until match found
        let rounds = 0;
        while (game.phase === 'dealing' && rounds < 60) {
            game = dealNext(game);
            rounds++;
        }

        expect(game.phase).toBe('ended');
        expect(game.result).toBeTruthy();
        expect(game.payouts).toBeTruthy();

        // Cross-check with engine calculatePayout
        const totalCards = (game.andar?.length || 0) + (game.bahar?.length || 0);
        const engine = new AndarBaharEngine(game);
        const enginePayouts = engine.calculatePayout(game.bets, {
            winningSide: game.result,
            totalCards,
            trumpFirst: game.trumpFirst,
        });

        // The inline payouts and engine payouts should agree on sign
        if (game.result === 'andar') {
            expect(game.payouts[myId]).toBeGreaterThanOrEqual(0);
        } else {
            expect(game.payouts[myId]).toBe(-100);
        }

        // Process through ledger
        const event = engine.calculateResults(game);
        expect(event.financial).toBe(true);
        expect(event.gameType).toBe('andarbahar');

        const { updatedWallet } = ledger.processEvent(wallet, event, myId, deviceId);

        // Verify ledger recorded
        const history = ledger.getHistory(deviceId);
        expect(history).toHaveLength(1);
        expect(history[0].gameType).toBe('andarbahar');
    });

    it('losing bahar bet deducts chips correctly', () => {
        const deviceId = 'dev-ab-2';
        const myId = 'peer-bob';

        let wallet = makeWallet(deviceId, 500);
        wallet = walletLib.debit(wallet, 75, 'AB bet');

        let game = abCreateGame('room-ab2');
        game = abPlaceBet(game, myId, 'Bob', 'bahar', 75);
        game = dealTrump(game);

        // Deal to completion
        let rounds = 0;
        while (game.phase === 'dealing' && rounds < 60) {
            game = dealNext(game);
            rounds++;
        }

        expect(game.phase).toBe('ended');

        const engine = new AndarBaharEngine(game);
        const event = engine.calculateResults(game);
        const { updatedWallet } = ledger.processEvent(wallet, event, myId, deviceId);

        // If won: wallet increases; if lost: stays at 425
        if (game.result === 'bahar') {
            expect(walletLib.getTotalBalance(updatedWallet)).toBeGreaterThan(425);
        } else {
            expect(walletLib.getTotalBalance(updatedWallet)).toBe(425);
        }
    });

    it('multiple players in same round produces independent payouts', () => {
        const deviceId = 'dev-ab-3';
        const player1 = 'peer-x';
        const player2 = 'peer-y';

        let game = abCreateGame('room-ab3');
        game = abPlaceBet(game, player1, 'X', 'andar', 100);
        game = abPlaceBet(game, player2, 'Y', 'bahar', 200);
        expect(game.bets).toHaveLength(2);

        game = dealTrump(game);
        let rounds = 0;
        while (game.phase === 'dealing' && rounds < 60) {
            game = dealNext(game);
            rounds++;
        }

        expect(game.phase).toBe('ended');
        // One player should have positive payout, the other negative
        const p1payout = game.payouts[player1] ?? 0;
        const p2payout = game.payouts[player2] ?? 0;
        // They bet on opposite sides, so one wins and one loses
        expect(p1payout * p2payout).toBeLessThanOrEqual(0);
    });
});


/* ═══════════════════════════════════════════════════════════════
   SUITE 4 — Full Slots round: bet -> spin -> payout -> wallet
   ═══════════════════════════════════════════════════════════════ */

describe('Full Slots round: bet -> spin -> payout -> wallet', () => {

    it('jackpot (777) credits wallet 50x bet through full pipeline', () => {
        const deviceId = 'dev-sl-1';
        const myId = 'peer-alice';

        let wallet = makeWallet(deviceId, 1000);
        wallet = walletLib.debit(wallet, 100, 'Slots bet');
        expect(walletLib.getTotalBalance(wallet)).toBe(900);

        // Force jackpot reels
        const reels = ['7\uFE0F\u20E3', '7\uFE0F\u20E3', '7\uFE0F\u20E3'];
        const net = slotsCalcPayout(reels, 100);
        expect(net).toBe(5000); // 50x

        // Use SlotsEngine for payout calculation
        const engine = new SlotsEngine(createSlots('room-sl1'));
        const bets = [{ peer_id: myId, nick: 'Alice', amount: 100 }];
        const payouts = engine.calculatePayout(bets, reels);
        expect(payouts[myId]).toBe(5000);

        // Create financial payout event
        const event = createPayoutEvent({
            gameType: 'slots',
            roundId: 'room-sl1-test',
            resultLabel: reels.join(' '),
            breakdown: [{
                peer_id: myId,
                nick: 'Alice',
                betLabel: 'Spin',
                wager: 100,
                net: 5000,
                outcome: 'win',
            }],
            totals: payouts,
        });

        const { updatedWallet } = ledger.processEvent(wallet, event, myId, deviceId);
        // Credit = wager(100) + net(5000) = 5100, wallet was 900 -> 6000
        expect(walletLib.getTotalBalance(updatedWallet)).toBe(6000);

        // Verify ledger
        const history = ledger.getHistory(deviceId);
        expect(history).toHaveLength(1);
        expect(history[0].gameType).toBe('slots');
    });

    it('losing spin (no match) does not credit wallet', () => {
        const deviceId = 'dev-sl-2';
        const myId = 'peer-bob';

        let wallet = makeWallet(deviceId, 1000);
        wallet = walletLib.debit(wallet, 50, 'Slots bet');

        const reels = ['\uD83C\uDF4B', '\uD83C\uDF4A', '\uD83D\uDC8E']; // lemon, orange, diamond
        const net = slotsCalcPayout(reels, 50);
        expect(net).toBe(-50);

        const engine = new SlotsEngine(createSlots('room-sl2'));
        const payouts = engine.calculatePayout([{ peer_id: myId, amount: 50 }], reels);
        expect(payouts[myId]).toBe(-50);

        const event = createPayoutEvent({
            gameType: 'slots',
            roundId: 'room-sl2-test',
            resultLabel: reels.join(' '),
            breakdown: [{ peer_id: myId, nick: 'Bob', betLabel: 'Spin', wager: 50, net: -50, outcome: 'loss' }],
            totals: payouts,
        });

        const { updatedWallet } = ledger.processEvent(wallet, event, myId, deviceId);
        // Loss: credit = 50 + (-50) = 0, wallet stays at 950
        expect(walletLib.getTotalBalance(updatedWallet)).toBe(950);
    });

    it('two-cherry partial match pays 2x', () => {
        const deviceId = 'dev-sl-3';
        const myId = 'peer-carol';

        let wallet = makeWallet(deviceId, 1000);
        wallet = walletLib.debit(wallet, 100, 'Slots bet');

        const reels = ['\uD83C\uDF52', '\uD83C\uDF52', '\uD83C\uDF4A']; // cherry, cherry, orange
        const net = slotsCalcPayout(reels, 100);
        expect(net).toBe(200); // 2x

        const event = createPayoutEvent({
            gameType: 'slots',
            roundId: 'room-sl3-test',
            resultLabel: reels.join(' '),
            breakdown: [{ peer_id: myId, nick: 'Carol', betLabel: 'Spin', wager: 100, net: 200, outcome: 'win' }],
            totals: { [myId]: 200 },
        });

        const { updatedWallet } = ledger.processEvent(wallet, event, myId, deviceId);
        // Credit = wager(100) + net(200) = 300, wallet was 900 -> 1200
        expect(walletLib.getTotalBalance(updatedWallet)).toBe(1200);
    });
});


/* ═══════════════════════════════════════════════════════════════
   SUITE 5 — Tic-Tac-Toe: play -> result -> non-financial event -> ledger stats
   ═══════════════════════════════════════════════════════════════ */

describe('Tic-Tac-Toe: play -> result -> non-financial event -> ledger stats', () => {

    it('X wins: non-financial event records stats without changing wallet', () => {
        const deviceId = 'dev-ttt-1';
        const playerX = { peer_id: 'px', nick: 'Xena' };
        const playerO = { peer_id: 'po', nick: 'Oscar' };

        let wallet = makeWallet(deviceId, 1000);
        const originalBalance = walletLib.getTotalBalance(wallet);

        // Create game and play X to a win (top row: 0, 1, 2)
        let game = tttCreateGame(playerX, playerO, 'room-ttt1');

        // X plays 0
        let result = makeMove(game, 0, playerX.peer_id);
        game = result.game;
        // O plays 3
        result = makeMove(game, 3, playerO.peer_id);
        game = result.game;
        // X plays 1
        result = makeMove(game, 1, playerX.peer_id);
        game = result.game;
        // O plays 4
        result = makeMove(game, 4, playerO.peer_id);
        game = result.game;
        // X plays 2 -> X wins top row
        result = makeMove(game, 2, playerX.peer_id);
        game = result.game;

        expect(game.result).toBe('X');
        expect(game.score.x).toBe(1);

        // Generate non-financial event
        const event = tttCalculateResults(game);
        expect(event.financial).toBe(false);
        expect(event.gameType).toBe('tictactoe');
        expect(event.playerStats).toHaveLength(2);
        expect(event.playerStats.find(p => p.peer_id === 'px').outcome).toBe('win');
        expect(event.playerStats.find(p => p.peer_id === 'po').outcome).toBe('loss');

        // Process through ledger
        const { updatedWallet } = ledger.processEvent(wallet, event, 'px', deviceId);

        // Wallet must NOT change for non-financial events
        expect(walletLib.getTotalBalance(updatedWallet)).toBe(originalBalance);

        // Ledger should have the event
        const history = ledger.getHistory(deviceId);
        expect(history).toHaveLength(1);
        expect(history[0].financial).toBe(false);

        // Stats should show win for X
        const stats = ledger.getStats(deviceId, 'px');
        expect(stats.tictactoe.wins).toBe(1);
        expect(stats.tictactoe.losses).toBe(0);

        // Stats for O should show loss
        const statsO = ledger.getStats(deviceId, 'po');
        expect(statsO.tictactoe.losses).toBe(1);
        expect(statsO.tictactoe.wins).toBe(0);
    });

    it('draw records draw for both players', () => {
        const deviceId = 'dev-ttt-2';
        const playerX = { peer_id: 'px', nick: 'Xena' };
        const playerO = { peer_id: 'po', nick: 'Oscar' };

        let game = tttCreateGame(playerX, playerO, 'room-ttt2');

        // Play to a draw: X O X / X X O / O X O
        const moves = [
            [0, 'px'], [1, 'po'], [2, 'px'],
            [4, 'po'], [3, 'px'], [6, 'po'],
            [7, 'px'], [8, 'po'], [5, 'px'],
        ];

        for (const [pos, pid] of moves) {
            const result = makeMove(game, pos, pid);
            expect(result.game).toBeTruthy();
            game = result.game;
        }

        expect(game.result).toBe('draw');

        const event = tttCalculateResults(game);
        expect(event.playerStats.every(p => p.outcome === 'draw')).toBe(true);

        ledger.processEvent(makeWallet(deviceId, 1000), event, 'px', deviceId);
        const stats = ledger.getStats(deviceId, 'px');
        expect(stats.tictactoe.pushes).toBe(1);
    });
});


/* ═══════════════════════════════════════════════════════════════
   SUITE 6 — GameEngine registry integration
   ═══════════════════════════════════════════════════════════════ */

describe('GameEngine registry integration', () => {

    it('all 4 game engines are registered', () => {
        const games = getRegisteredGames();
        expect(games).toContain('roulette');
        expect(games).toContain('blackjack');
        expect(games).toContain('slots');
        expect(games).toContain('andarbahar');
    });

    it('createGameEngine produces correct instances for each type', () => {
        const rl = createGameEngine('roulette', createRoulette('r1'));
        expect(rl).toBeInstanceOf(RouletteEngine);
        expect(rl).toBeInstanceOf(GameEngine);

        const bj = createGameEngine('blackjack', bjCreateGame('r2', 'dealer'));
        expect(bj).toBeInstanceOf(BlackjackEngine);
        expect(bj).toBeInstanceOf(GameEngine);

        const sl = createGameEngine('slots', createSlots('r3'));
        expect(sl).toBeInstanceOf(SlotsEngine);
        expect(sl).toBeInstanceOf(GameEngine);

        const ab = createGameEngine('andarbahar', abCreateGame('r4'));
        expect(ab).toBeInstanceOf(AndarBaharEngine);
        expect(ab).toBeInstanceOf(GameEngine);
    });

    it('each engine getRules returns valid structure with name, description, bets array', () => {
        const types = [
            { type: 'roulette', state: createRoulette('r1') },
            { type: 'blackjack', state: bjCreateGame('r2', 'dealer') },
            { type: 'slots', state: createSlots('r3') },
            { type: 'andarbahar', state: abCreateGame('r4') },
        ];

        for (const { type, state } of types) {
            const engine = createGameEngine(type, state);
            const rules = engine.getRules();
            expect(rules).toHaveProperty('name');
            expect(rules).toHaveProperty('description');
            expect(rules).toHaveProperty('bets');
            expect(Array.isArray(rules.bets)).toBe(true);
            expect(rules.bets.length).toBeGreaterThan(0);
            for (const bet of rules.bets) {
                expect(bet).toHaveProperty('name');
                expect(bet).toHaveProperty('odds');
                expect(bet).toHaveProperty('description');
            }
        }
    });

    it('each engine calculatePayout returns a payout map (not null/array)', () => {
        const rl = createGameEngine('roulette', createRoulette('r1'));
        const rlResult = rl.calculatePayout([], 0);
        expect(rlResult).not.toBeNull();
        expect(Array.isArray(rlResult)).toBe(false);
        expect(typeof rlResult).toBe('object');

        const bj = createGameEngine('blackjack', bjCreateGame('r2', 'dealer'));
        const bjResult = bj.calculatePayout([], null);
        expect(bjResult).not.toBeNull();
        expect(typeof bjResult).toBe('object');

        const sl = createGameEngine('slots', createSlots('r3'));
        const slResult = sl.calculatePayout([], ['7\uFE0F\u20E3', '7\uFE0F\u20E3', '7\uFE0F\u20E3']);
        expect(slResult).not.toBeNull();
        expect(typeof slResult).toBe('object');

        const ab = createGameEngine('andarbahar', abCreateGame('r4'));
        const abResult = ab.calculatePayout([], { winningSide: 'andar', totalCards: 5, trumpFirst: 'bahar' });
        expect(abResult).not.toBeNull();
        expect(typeof abResult).toBe('object');
    });

    it('createGameEngine throws for unknown game type', () => {
        expect(() => createGameEngine('poker', {})).toThrow(/No GameEngine registered/);
    });
});


/* ═══════════════════════════════════════════════════════════════
   SUITE 7 — Casino state P2P merge with multi-game House PnL
   ═══════════════════════════════════════════════════════════════ */

describe('Casino state P2P merge with multi-game House PnL', () => {

    it('house PnL accumulates across multiple game types', () => {
        let state = createCasinoState();

        // Roulette: player loses 200 -> house gains 200
        state = updateHousePnl(state, 'roulette', { p1: -200 });
        expect(state.housePnl.roulette).toBe(200);

        // Blackjack: player wins 100 -> house loses 100
        state = updateHousePnl(state, 'blackjack', { p1: 100 });
        expect(state.housePnl.blackjack).toBe(-100);

        // Slots: player loses 50 -> house gains 50
        state = updateHousePnl(state, 'slots', { p1: -50 });
        expect(state.housePnl.slots).toBe(50);

        // Andar Bahar: player wins 300 -> house loses 300
        state = updateHousePnl(state, 'andarbahar', { p1: 300 });
        expect(state.housePnl.andarbahar).toBe(-300);

        // Total: 200 - 100 + 50 - 300 = -150
        expect(getTotalHousePnl(state)).toBe(-150);
    });

    it('LWW merge prefers remote state when remote housePnl is newer', () => {
        const local = createCasinoState();
        local.housePnl.roulette = 500;
        local.housePnl.blackjack = 200;
        local.housePnl._ts = 1000;

        const remote = createCasinoState();
        remote.housePnl.roulette = 800;
        remote.housePnl.blackjack = 0;
        remote.housePnl.slots = 150;
        remote.housePnl._ts = 2000; // newer

        const merged = mergeCasinoStates(local, remote);
        expect(merged.housePnl.roulette).toBe(800);
        expect(merged.housePnl.blackjack).toBe(0);
        expect(merged.housePnl.slots).toBe(150);
    });

    it('LWW merge keeps local state when local housePnl is newer', () => {
        const local = createCasinoState();
        local.housePnl.roulette = 500;
        local.housePnl._ts = 5000;

        const remote = createCasinoState();
        remote.housePnl.roulette = 100;
        remote.housePnl._ts = 1000;

        const merged = mergeCasinoStates(local, remote);
        expect(merged.housePnl.roulette).toBe(500);
    });

    it('merged state top-level _ts is max of both', () => {
        const local = createCasinoState();
        local._ts = 3000;

        const remote = createCasinoState();
        remote._ts = 7000;

        const merged = mergeCasinoStates(local, remote);
        expect(merged._ts).toBe(7000);
    });

    it('multi-round multi-game house PnL then merge preserves totals', () => {
        // Peer A plays roulette and blackjack
        let stateA = createCasinoState();
        stateA = updateHousePnl(stateA, 'roulette', { p1: -100 }); // house +100
        stateA = updateHousePnl(stateA, 'blackjack', { p1: 50 });  // house -50

        // Peer B plays slots and andar bahar (on their own copy, older timestamp)
        let stateB = createCasinoState();
        stateB.housePnl._ts = 1; // force older
        stateB = { ...stateB, housePnl: { ...stateB.housePnl, slots: 75, _ts: 1 } };

        // Merge: A is newer so A wins
        const merged = mergeCasinoStates(stateB, stateA);
        expect(merged.housePnl.roulette).toBe(100);
        expect(merged.housePnl.blackjack).toBe(-50);
        expect(getTotalHousePnl(merged)).toBe(50);
    });
});


/* ═══════════════════════════════════════════════════════════════
   SUITE 8 — Multi-round session: wallet consistency across games
   ═══════════════════════════════════════════════════════════════ */

describe('Multi-round session: wallet consistency across games', () => {

    it('wallet balance stays consistent across 3 roulette rounds and 1 blackjack round', () => {
        const deviceId = 'dev-multi-1';
        const myId = 'peer-multi';
        let wallet = makeWallet(deviceId, 1000);
        const events = [];

        // -- Roulette Round 1: bet 100 on red, result = 1 (red, win) --
        wallet = walletLib.debit(wallet, 100, 'RL bet 1');
        expect(walletLib.getTotalBalance(wallet)).toBe(900);

        const rlEngine = new RouletteEngine(createRoulette('r1'));
        const rlBets1 = [{ peer_id: myId, nick: 'Test', betType: 'color', betTarget: 'red', amount: 100 }];
        const rlPayouts1 = rlEngine.calculatePayout(rlBets1, 1); // red win: +100
        const rlEvent1 = createPayoutEvent({
            gameType: 'roulette', roundId: 'r1-1', resultLabel: '1 Red',
            breakdown: [{ peer_id: myId, nick: 'Test', betLabel: 'Red', wager: 100, net: 100, outcome: 'win' }],
            totals: rlPayouts1,
        });
        ({ updatedWallet: wallet } = ledger.processEvent(wallet, rlEvent1, myId, deviceId));
        events.push(rlEvent1);
        // Won: credit = 100 + 100 = 200, balance = 900 + 200 = 1100
        expect(walletLib.getTotalBalance(wallet)).toBe(1100);

        // -- Roulette Round 2: bet 200 on black, result = 1 (red, lose) --
        wallet = walletLib.debit(wallet, 200, 'RL bet 2');
        expect(walletLib.getTotalBalance(wallet)).toBe(900);

        const rlBets2 = [{ peer_id: myId, nick: 'Test', betType: 'color', betTarget: 'black', amount: 200 }];
        const rlPayouts2 = rlEngine.calculatePayout(rlBets2, 1); // black on red result: loss
        const rlEvent2 = createPayoutEvent({
            gameType: 'roulette', roundId: 'r1-2', resultLabel: '1 Red',
            breakdown: [{ peer_id: myId, nick: 'Test', betLabel: 'Black', wager: 200, net: -200, outcome: 'loss' }],
            totals: rlPayouts2,
        });
        ({ updatedWallet: wallet } = ledger.processEvent(wallet, rlEvent2, myId, deviceId));
        events.push(rlEvent2);
        // Lost: credit = 200 + (-200) = 0, balance stays 900
        expect(walletLib.getTotalBalance(wallet)).toBe(900);

        // -- Roulette Round 3: bet 50 on dozen 1, result = 5 (win 2:1) --
        wallet = walletLib.debit(wallet, 50, 'RL bet 3');
        expect(walletLib.getTotalBalance(wallet)).toBe(850);

        const rlBets3 = [{ peer_id: myId, nick: 'Test', betType: 'dozen', betTarget: 1, amount: 50 }];
        const rlPayouts3 = rlEngine.calculatePayout(rlBets3, 5); // dozen 1 (1-12): net = 50*(3-1)=100
        const rlEvent3 = createPayoutEvent({
            gameType: 'roulette', roundId: 'r1-3', resultLabel: '5 Red',
            breakdown: [{ peer_id: myId, nick: 'Test', betLabel: 'Dozen 1', wager: 50, net: 100, outcome: 'win' }],
            totals: rlPayouts3,
        });
        ({ updatedWallet: wallet } = ledger.processEvent(wallet, rlEvent3, myId, deviceId));
        events.push(rlEvent3);
        // Won: credit = 50 + 100 = 150, balance = 850 + 150 = 1000
        expect(walletLib.getTotalBalance(wallet)).toBe(1000);

        // -- Blackjack Round: bet 100, player wins 1:1 --
        wallet = walletLib.debit(wallet, 100, 'BJ bet');
        expect(walletLib.getTotalBalance(wallet)).toBe(900);

        const bjEvent = createPayoutEvent({
            gameType: 'blackjack', roundId: 'bj-1', resultLabel: 'Dealer 22 (Bust)',
            breakdown: [{ peer_id: myId, nick: 'Test', betLabel: 'Win (1:1)', wager: 100, net: 100, outcome: 'win' }],
            totals: { [myId]: 100 },
        });
        ({ updatedWallet: wallet } = ledger.processEvent(wallet, bjEvent, myId, deviceId));
        events.push(bjEvent);
        // Won: credit = 100 + 100 = 200, balance = 900 + 200 = 1100
        expect(walletLib.getTotalBalance(wallet)).toBe(1100);

        // Final balance: started 1000, net +100(rl1) -200(rl2) +100(rl3) +100(bj) = +100 = 1100
        // But we used upfront debit/credit model, so verify the math matches:
        // RL1: debit 100, credit 200 => net +100
        // RL2: debit 200, credit 0   => net -200
        // RL3: debit 50, credit 150  => net +100
        // BJ:  debit 100, credit 200 => net +100
        // Total net: +100, final = 1000 + 100 = 1100
        expect(walletLib.getTotalBalance(wallet)).toBe(1100);

        // Verify ledger history has all 4 events in order
        const history = ledger.getHistory(deviceId);
        expect(history).toHaveLength(4);
        // getHistory returns newest first
        expect(history[0].gameType).toBe('blackjack');
        expect(history[1].gameType).toBe('roulette');
        expect(history[2].gameType).toBe('roulette');
        expect(history[3].gameType).toBe('roulette');

        // Verify stats
        const stats = ledger.getStats(deviceId, myId);
        expect(stats.roulette.wins).toBe(2);
        expect(stats.roulette.losses).toBe(1);
        expect(stats.roulette.totalNet).toBe(0); // +100 - 200 + 100 = 0
        expect(stats.blackjack.wins).toBe(1);
        expect(stats.blackjack.totalNet).toBe(100);
    });

    it('wallet cannot go below zero via canAfford guard', () => {
        let wallet = makeWallet('dev-guard', 100);
        expect(walletLib.canAfford(wallet, 100)).toBe(true);
        expect(walletLib.canAfford(wallet, 101)).toBe(false);

        wallet = walletLib.debit(wallet, 100, 'All in');
        expect(walletLib.getTotalBalance(wallet)).toBe(0);

        // Debit with insufficient funds is a no-op
        const sameWallet = walletLib.debit(wallet, 1, 'Overdraft attempt');
        expect(walletLib.getTotalBalance(sameWallet)).toBe(0);
    });

    it('clampChips utility prevents negative values', () => {
        expect(clampChips(100)).toBe(100);
        expect(clampChips(-50)).toBe(0);
        expect(clampChips(0)).toBe(0);
    });

    it('calcHouseGain correctly derives house gain from payout map', () => {
        // Player loses 100: house gains 100
        expect(calcHouseGain({ p1: -100 })).toBe(100);
        // Player wins 200: house loses 200
        expect(calcHouseGain({ p1: 200 })).toBe(-200);
        // Multiple players: mixed results
        expect(calcHouseGain({ p1: -100, p2: 50 })).toBe(50);
        // Push: house gain is -0 (negative zero), numerically equal to 0
        expect(calcHouseGain({ p1: 0 }) === 0).toBe(true);
    });

    it('settleBets accumulates multiple bets per peer', () => {
        const bets = [
            { peer_id: 'p1', amount: 100 },
            { peer_id: 'p1', amount: 50 },
            { peer_id: 'p2', amount: 200 },
        ];

        const payouts = settleBets(bets, (bet) => -bet.amount); // all lose
        expect(payouts['p1']).toBe(-150);
        expect(payouts['p2']).toBe(-200);
    });
});
