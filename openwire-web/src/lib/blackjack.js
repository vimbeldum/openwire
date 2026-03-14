/* ═══════════════════════════════════════════════════════════
   OpenWire Web — Blackjack game engine
   Multiplayer blackjack with shared dealer
   Bounded Context: Blackjack | Shared Core: GameEngine + payouts
   ═══════════════════════════════════════════════════════════ */

import { GameEngine, registerGame } from './GameEngine.js';
import { settleBets } from './core/payouts.js';
import { createPayoutEvent } from './core/PayoutEvent.js';

const SUITS = ['♠', '♥', '♦', '♣'];
const VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const BETTING_DURATION_MS = 60 * 1000;  // 60s betting window
export const DEALER_PLAY_MS = 3 * 1000;        // 3s delay before round ends
export const DEAL_CARD_DELAY_MS = 600;         // delay between each dealt card
export const DEALER_REVEAL_DELAY_MS = 1500;    // delay before showing dealer result
export const MIN_DECK_CARDS = 15;              // reshuffle threshold

// Create a fresh deck
export function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const value of VALUES) {
            deck.push({ suit, value, id: `${value}${suit}` });
        }
    }
    return shuffleDeck(deck);
}

// Fisher-Yates shuffle using cryptographically secure RNG
export function shuffleDeck(deck) {
    const shuffled = [...deck];
    const buf = new Uint32Array(shuffled.length);
    crypto.getRandomValues(buf);
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = buf[i] % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Calculate hand value (Aces can be 1 or 11)
export function calculateHand(cards) {
    let total = 0;
    let aces = 0;

    for (const card of cards) {
        if (card.value === 'A') {
            aces++;
            total += 11;
        } else if (['K', 'Q', 'J'].includes(card.value)) {
            total += 10;
        } else {
            total += parseInt(card.value);
        }
    }

    // Adjust for aces
    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }

    return total;
}

// Check for blackjack (21 with 2 cards)
export function isBlackjack(cards) {
    return cards.length === 2 && calculateHand(cards) === 21;
}

// Check for bust
export function isBust(cards) {
    return calculateHand(cards) > 21;
}

// Create a new game state
export function createGame(roomId, dealerId) {
    return {
        type: 'blackjack',
        roomId,
        hostPeerId: dealerId,
        deck: createDeck(),
        dealer: {
            peer_id: dealerId,
            nick: 'Dealer',
            hand: [],
            revealed: false, // dealer's second card is hidden
        },
        players: [], // { peer_id, nick, hand, status: 'waiting'|'playing'|'stand'|'bust'|'blackjack'|'win'|'lose'|'push', bet }
        currentPlayerIndex: -1, // -1 means betting phase
        phase: 'betting', // 'betting' | 'dealing' | 'playing' | 'dealer' | 'settlement' | 'ended'
        nextDealAt: Date.now() + BETTING_DURATION_MS,
        createdAt: Date.now(),
    };
}

// Add a player to the game
export function addPlayer(game, peer_id, nick) {
    if (game.players.find(p => p.peer_id === peer_id)) {
        return game; // already in game
    }
    return {
        ...game,
        players: [...game.players, {
            peer_id,
            nick,
            hand: [],
            status: 'waiting',
            bet: 0,
        }],
    };
}

// Remove a player
export function removePlayer(game, peer_id) {
    return {
        ...game,
        players: game.players.filter(p => p.peer_id !== peer_id),
    };
}

// Player places bet
export function placeBet(game, peer_id, bet) {
    if (!bet || typeof bet !== 'number' || bet <= 0 || !isFinite(bet)) return game;
    return {
        ...game,
        players: game.players.map(p =>
            p.peer_id === peer_id ? { ...p, bet, status: 'ready' } : p
        ),
    };
}

// Deal initial cards (2 to each player, 2 to dealer)
export function dealInitialCards(game) {
    let deck = [...game.deck];
    let players = game.players.map(p => ({ ...p, hand: [], status: 'playing' }));
    let dealer = { ...game.dealer, hand: [], revealed: false };

    // Reshuffle if not enough cards for initial deal
    const cardsNeeded = (players.length + 1) * 2;
    if (deck.length < cardsNeeded) deck = [...createDeck()];

    // Deal 2 cards to each player and dealer
    for (let round = 0; round < 2; round++) {
        for (let i = 0; i < players.length; i++) {
            players[i].hand.push(deck.pop());
        }
        dealer.hand.push(deck.pop());
    }

    // Check for blackjacks
    players = players.map(p => {
        if (isBlackjack(p.hand)) {
            return { ...p, status: 'blackjack' };
        }
        return p;
    });

    // Find first player who is still playing
    let currentPlayerIndex = players.findIndex(p => p.status === 'playing');
    let phase = 'playing';

    // If all players have blackjack or bust, go to dealer
    if (currentPlayerIndex === -1) {
        phase = 'dealer';
        dealer.revealed = true;
    }

    return {
        ...game,
        deck,
        players,
        dealer,
        currentPlayerIndex,
        phase,
    };
}

// Player hits (takes a card) — handles split hands
export function hit(game, peer_id) {
    const playerIndex = game.players.findIndex(p => p.peer_id === peer_id);
    if (playerIndex === -1 || game.phase !== 'playing') return game;
    if (game.currentPlayerIndex !== playerIndex) return game;

    // Reshuffle a fresh deck if exhausted mid-round
    let deck = [...(game.deck.length > 0 ? game.deck : createDeck())];
    const card = deck.pop();

    let players = [...game.players];
    const player = { ...players[playerIndex] };

    // Determine which hand is active (main or split)
    if (player.playingSplit && player.splitHand) {
        // Guard: can't hit a split hand that's already done
        if (player.splitStatus !== 'playing') return game;
        player.splitHand = [...player.splitHand, card];
        if (isBust(player.splitHand)) {
            player.splitStatus = 'bust';
        } else if (calculateHand(player.splitHand) === 21) {
            player.splitStatus = 'stand';
        }
    } else {
        player.hand = [...player.hand, card];
        if (isBust(player.hand)) {
            player.status = 'bust';
        } else if (calculateHand(player.hand) === 21) {
            player.status = 'stand'; // auto-stand on 21
        }
        // If bust/stand on main hand and has split hand pending, switch to it
        if ((player.status === 'bust' || player.status === 'stand') && player.splitHand && player.splitStatus === 'playing') {
            player.playingSplit = true;
            players[playerIndex] = player;
            return { ...game, deck, players };
        }
    }

    players[playerIndex] = player;

    // Move to next player if all hands done
    let currentPlayerIndex = game.currentPlayerIndex;
    let phase = game.phase;
    let dealer = { ...game.dealer };

    const mainDone = player.status === 'bust' || player.status === 'stand' || player.status === 'blackjack';
    const splitDone = !player.splitHand || player.splitStatus !== 'playing';
    if (mainDone && splitDone) {
        let nextIndex = players.findIndex((p, i) => i > currentPlayerIndex && p.status === 'playing');
        if (nextIndex === -1) {
            nextIndex = players.findIndex(p => p.status === 'playing');
        }
        currentPlayerIndex = nextIndex;

        if (currentPlayerIndex === -1) {
            phase = 'dealer';
            dealer.revealed = true;
        }
    }

    return {
        ...game,
        deck,
        players,
        currentPlayerIndex,
        phase,
        dealer,
    };
}

// Player stands (ends turn) — handles split hands
export function stand(game, peer_id) {
    const playerIndex = game.players.findIndex(p => p.peer_id === peer_id);
    if (playerIndex === -1 || game.phase !== 'playing') return game;
    if (game.currentPlayerIndex !== playerIndex) return game;

    let players = [...game.players];
    const player = { ...players[playerIndex] };

    // If playing split hand, stand on split (only if still playing)
    if (player.playingSplit && player.splitHand) {
        if (player.splitStatus === 'playing') {
            player.splitStatus = 'stand';
        }
    } else {
        player.status = 'stand';
        // If has split hand pending, switch to it
        if (player.splitHand && player.splitStatus === 'playing') {
            player.playingSplit = true;
            players[playerIndex] = player;
            return { ...game, players };
        }
    }

    players[playerIndex] = player;

    // Find next playing player
    let currentPlayerIndex = players.findIndex((p, i) => i > playerIndex && p.status === 'playing');
    if (currentPlayerIndex === -1) {
        currentPlayerIndex = players.findIndex(p => p.status === 'playing');
    }

    let phase = game.phase;
    let dealer = { ...game.dealer };

    if (currentPlayerIndex === -1) {
        phase = 'dealer';
        dealer.revealed = true;
    }

    return {
        ...game,
        players,
        currentPlayerIndex,
        phase,
        dealer,
    };
}

// Check if player can split (two cards of same value)
export function canSplit(game, peer_id) {
    if (game.phase !== 'playing') return false;
    const playerIndex = game.players.findIndex(p => p.peer_id === peer_id);
    if (playerIndex === -1 || game.currentPlayerIndex !== playerIndex) return false;
    const player = game.players[playerIndex];
    if (player.hand.length !== 2 || player.splitHand) return false; // already split or wrong card count
    const v0 = player.hand[0].value;
    const v1 = player.hand[1].value;
    // Same face value (10, J, Q, K all count as 10)
    const val = (v) => ['10', 'J', 'Q', 'K'].includes(v) ? 10 : v;
    return val(v0) === val(v1);
}

// Player splits hand (requires additional bet equal to original)
export function split(game, peer_id) {
    if (!canSplit(game, peer_id)) return game;
    const playerIndex = game.players.findIndex(p => p.peer_id === peer_id);
    let deck = [...(game.deck.length >= 2 ? game.deck : createDeck())];

    let players = [...game.players];
    const player = { ...players[playerIndex] };
    const card1 = player.hand[0];
    const card2 = player.hand[1];

    // Main hand gets first card + new card
    player.hand = [card1, deck.pop()];
    // Split hand gets second card + new card
    player.splitHand = [card2, deck.pop()];
    player.splitBet = player.bet; // equal bet on split hand
    player.splitStatus = 'playing';
    player.playingSplit = false; // currently playing main hand

    // Check for auto-stand on 21
    if (calculateHand(player.hand) === 21) {
        player.status = 'stand';
        player.playingSplit = true; // move to split hand
        if (calculateHand(player.splitHand) === 21) {
            player.splitStatus = 'stand';
        }
    }

    players[playerIndex] = player;

    // If both hands are done (e.g. both auto-stood at 21), advance to next player
    const mainDone = player.status === 'bust' || player.status === 'stand' || player.status === 'blackjack';
    const splitDone = !player.splitHand || player.splitStatus !== 'playing';
    if (mainDone && splitDone) {
        let currentPlayerIndex = players.findIndex((p, i) => i > playerIndex && p.status === 'playing');
        if (currentPlayerIndex === -1) {
            currentPlayerIndex = players.findIndex(p => p.status === 'playing');
        }
        let phase = game.phase;
        let dealer = { ...game.dealer };
        if (currentPlayerIndex === -1) {
            phase = 'dealer';
            dealer.revealed = true;
        }
        return { ...game, deck, players, currentPlayerIndex, phase, dealer };
    }

    return { ...game, deck, players };
}

// Check if player can take insurance (dealer shows Ace)
export function canInsure(game, peer_id) {
    if (game.phase !== 'playing') return false;
    const player = game.players.find(p => p.peer_id === peer_id);
    if (!player || player.insured) return false;
    // Insurance only on initial deal (all players have 2 cards, dealer's up card is Ace)
    if (game.dealer.hand.length < 2) return false;
    return game.dealer.hand[0].value === 'A';
}

// Player takes insurance (costs half the original bet)
export function takeInsurance(game, peer_id) {
    if (!canInsure(game, peer_id)) return game;
    return {
        ...game,
        players: game.players.map(p =>
            p.peer_id === peer_id
                ? { ...p, insured: true, insuranceBet: Math.floor(p.bet / 2) }
                : p
        ),
    };
}

// Check if player can double down (first two cards only)
export function canDoubleDown(game, peer_id) {
    if (game.phase !== 'playing') return false;
    const playerIndex = game.players.findIndex(p => p.peer_id === peer_id);
    if (playerIndex === -1 || game.currentPlayerIndex !== playerIndex) return false;
    const player = game.players[playerIndex];
    const hand = player.playingSplit ? player.splitHand : player.hand;
    return hand && hand.length === 2;
}

// Player doubles down (doubles bet, takes exactly one card, then stands)
export function doubleDown(game, peer_id) {
    if (!canDoubleDown(game, peer_id)) return game;
    const playerIndex = game.players.findIndex(p => p.peer_id === peer_id);
    let deck = [...(game.deck.length > 0 ? game.deck : createDeck())];
    const card = deck.pop();

    let players = [...game.players];
    const player = { ...players[playerIndex] };

    if (player.playingSplit && player.splitHand) {
        player.splitHand = [...player.splitHand, card];
        player.splitBet = (player.splitBet || player.bet) * 2;
        player.splitStatus = isBust(player.splitHand) ? 'bust' : 'stand';
    } else {
        player.hand = [...player.hand, card];
        player.bet *= 2;
        if (isBust(player.hand)) {
            player.status = 'bust';
        } else {
            player.status = 'stand';
        }
        // If has split hand, move to it
        if (player.splitHand && player.splitStatus === 'playing') {
            player.playingSplit = true;
        }
    }

    players[playerIndex] = player;

    // Check if we need to advance to next player or dealer
    let currentPlayerIndex = game.currentPlayerIndex;
    let phase = game.phase;
    let dealer = { ...game.dealer };

    const isDone = player.status !== 'playing' && (!player.splitHand || player.splitStatus !== 'playing');
    if (isDone) {
        let nextIndex = players.findIndex((p, i) => i > currentPlayerIndex && p.status === 'playing');
        if (nextIndex === -1) nextIndex = players.findIndex(p => p.status === 'playing');
        currentPlayerIndex = nextIndex;
        if (currentPlayerIndex === -1) {
            phase = 'dealer';
            dealer.revealed = true;
        }
    }

    return { ...game, deck, players, currentPlayerIndex, phase, dealer };
}

// Dealer plays (hits until 17 or higher)
export function dealerPlay(game) {
    if (game.phase !== 'dealer') return game;

    let deck = [...game.deck];
    let dealer = { ...game.dealer, revealed: true };

    // Dealer hits on 16 or less, stands on 17+
    while (calculateHand(dealer.hand) < 17) {
        if (deck.length === 0) deck = [...createDeck()]; // reshuffle if exhausted
        dealer.hand.push(deck.pop());
    }

    return {
        ...game,
        deck,
        dealer,
        phase: 'settlement',
    };
}

// Settle a single hand against dealer
function settleHand(hand, handStatus, dealerTotal, dealerBust, dealerBlackjack) {
    if (handStatus === 'bust') return 'lose';
    const playerTotal = calculateHand(hand);
    const playerBj = isBlackjack(hand);
    if (playerBj && !dealerBlackjack) return 'blackjack-win';
    if (dealerBust) return 'win';
    if (playerTotal > dealerTotal) return 'win';
    if (playerTotal < dealerTotal) return 'lose';
    return 'push';
}

// Settle bets (determine winners/losers) — handles split + insurance
export function settle(game) {
    if (game.phase !== 'settlement') return game;

    const dealerTotal = calculateHand(game.dealer.hand);
    const dealerBust = isBust(game.dealer.hand);
    const dealerBlackjack = isBlackjack(game.dealer.hand);

    let players = game.players.map(p => {
        const mainResult = settleHand(p.hand, p.status, dealerTotal, dealerBust, dealerBlackjack);
        let updated = { ...p, status: mainResult };

        // Settle split hand if it exists
        if (p.splitHand) {
            updated.splitStatus = settleHand(p.splitHand, p.splitStatus, dealerTotal, dealerBust, dealerBlackjack);
        }

        // Settle insurance: pays 2:1 if dealer has blackjack
        if (p.insured) {
            updated.insuranceWon = dealerBlackjack;
        }

        return updated;
    });

    return {
        ...game,
        players,
        phase: 'ended',
    };
}

// Full dealer turn (play + settle)
export function runDealerTurn(game) {
    return settle(dealerPlay(game));
}

// Start a new round (keep players, always fresh deck)
export function newRound(game) {
    return {
        ...createGame(game.roomId, game.dealer.peer_id),
        hostPeerId: game.hostPeerId ?? game.dealer.peer_id,
        deck: createDeck(),
        players: game.players.map(p => ({
            peer_id: p.peer_id,
            nick: p.nick,
            hand: [],
            status: 'waiting',
            bet: 0,
        })),
    };
}

// Migrate host when a peer departs.
// - Removes departed player from players array.
// - If departed peer was not the host, returns updated game (host unchanged).
// - If departed peer was the host, promotes the next remaining player (by index)
//   as the new host. Returns null if no players remain after removal.
// Pure function — never mutates the input game.
export function migrateHost(game, departedPeerId) {
    const remainingPlayers = game.players.filter(p => p.peer_id !== departedPeerId);
    const wasHost = game.hostPeerId === departedPeerId;

    if (!wasHost) {
        // Non-host departure: just remove the player
        return { ...game, players: remainingPlayers };
    }

    // Host departed
    if (remainingPlayers.length === 0) {
        return null; // no players left — game destroyed
    }

    // Promote the first remaining player (lowest original index) to host
    const newHostPeerId = remainingPlayers[0].peer_id;
    return {
        ...game,
        hostPeerId: newHostPeerId,
        players: remainingPlayers,
    };
}

// Get card display symbol
export function cardSymbol(card) {
    if (!card) return '';
    const isRed = card.suit === '♥' || card.suit === '♦';
    return { display: `${card.value}${card.suit}`, isRed };
}

// Check if it's a player's turn
export function isPlayerTurn(game, peer_id) {
    if (game.phase !== 'playing') return false;
    const playerIndex = game.players.findIndex(p => p.peer_id === peer_id);
    return playerIndex === game.currentPlayerIndex;
}

// Game message helpers (same pattern as tictactoe)
export function isBlackjackMessage(data) {
    return typeof data === 'string' && data.startsWith('BJ:');
}

export function parseBlackjackAction(data) {
    if (!isBlackjackMessage(data)) return null;
    try { return JSON.parse(data.slice(3)); } catch { return null; }
}

export function serializeBlackjackAction(action) {
    return 'BJ:' + JSON.stringify(action);
}

// Serialize game state for transmission (strip deck for security)
export function serializeGame(game) {
    const { deck, ...rest } = game;
    return JSON.stringify({ ...rest, deckCount: deck?.length || 0 });
}

export function deserializeGame(data) {
    try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        // When deserializing, deck is not available (security) — set empty
        if (parsed && !parsed.deck) parsed.deck = [];
        return parsed;
    } catch {
        return null;
    }
}

// Net for a single hand result
function handNet(status, bet) {
    if (status === 'win') return Math.floor(bet);
    if (status === 'blackjack-win') return Math.floor(bet * 1.5);
    if (status === 'push') return 0;
    return -bet;
}

// Returns { peer_id → net chip change } for a settled game (phase === 'ended')
// Handles main hand, split hand, and insurance
export function getPayouts(game) {
    if (game.phase !== 'ended') return {};
    const payouts = {};
    for (const p of game.players) {
        if (!p.bet) continue;
        let net = handNet(p.status, p.bet);
        // Split hand payout
        if (p.splitHand && p.splitStatus) {
            net += handNet(p.splitStatus, p.splitBet || p.bet);
        }
        // Insurance payout: wins 2:1 if dealer has blackjack
        if (p.insured && p.insuranceBet) {
            net += p.insuranceWon ? p.insuranceBet * 2 : -p.insuranceBet;
        }
        payouts[p.peer_id] = (payouts[p.peer_id] || 0) + net;
    }
    return payouts;
}

/* ── Rules (used by HowToPlay) ────────────────────────────── */

export const BLACKJACK_RULES = {
    name: 'Blackjack',
    description: 'Beat the dealer by getting closer to 21 without going over. Dealer hits on 16 or less, stands on 17+. Fresh shuffled deck every round.',
    bets: [
        { name: 'Win', odds: '1:1', description: 'Your hand beats the dealer — you win your bet.' },
        { name: 'Blackjack', odds: '3:2', description: 'Natural 21 on first two cards beats any non-blackjack dealer hand.' },
        { name: 'Push', odds: '0', description: 'Tie with dealer — your bet is returned.' },
        { name: 'Bust / Loss', odds: '-1', description: 'Exceed 21 or dealer scores higher — you lose your bet.' },
        { name: 'Double Down', odds: '1:1', description: 'Double your bet and receive exactly one more card. Available on first two cards only.' },
        { name: 'Split', odds: '1:1 each', description: 'Split matching cards into two hands with equal bets. Each hand plays independently.' },
        { name: 'Insurance', odds: '2:1', description: 'Side bet (half your wager) when dealer shows Ace. Pays 2:1 if dealer has Blackjack.' },
    ],
};

/* ── GameEngine implementation ────────────────────────────── */

export class BlackjackEngine extends GameEngine {
    constructor(game) {
        super();
        this._game = game;
    }

    getGameState() {
        return this._game;
    }

    calculatePayout(players, _result) {
        const payouts = {};
        for (const p of players) {
            if (!p.bet) continue;
            let net = handNet(p.status, p.bet);
            if (p.splitHand && p.splitStatus) net += handNet(p.splitStatus, p.splitBet || p.bet);
            if (p.insured && p.insuranceBet) net += p.insuranceWon ? p.insuranceBet * 2 : -p.insuranceBet;
            payouts[p.peer_id] = (payouts[p.peer_id] || 0) + net;
        }
        return payouts;
    }

    getRules() {
        return BLACKJACK_RULES;
    }

    /**
     * Process a fully-settled Blackjack round and return a financial PayoutEvent.
     * Handles win (1:1), blackjack (3:2), push, bust, and loss scenarios.
     *
     * @param {object} gameState  Settled game state (phase === 'ended')
     * @returns {object}          PayoutEvent
     */
    calculateResults(gameState) {
        const { dealer, players, roomId } = gameState;
        const dealerTotal = calculateHand(dealer.hand);
        const dealerBusted = isBust(dealer.hand);
        const resultLabel = `Dealer ${dealerTotal}${dealerBusted ? ' (Bust)' : ''}`;

        const breakdown = (players || [])
            .filter(p => p.bet > 0)
            .map(p => {
                let mainNet = handNet(p.status, p.bet);
                let totalWager = p.bet;
                let labels = [];

                // Main hand
                if (p.status === 'blackjack-win') labels.push('Blackjack (3:2)');
                else if (p.status === 'win') labels.push('Win (1:1)');
                else if (p.status === 'push') labels.push('Push');
                else labels.push(p.status === 'bust' ? 'Bust' : 'Loss');

                let net = mainNet;

                // Split hand
                if (p.splitHand && p.splitStatus) {
                    const splitNet = handNet(p.splitStatus, p.splitBet || p.bet);
                    net += splitNet;
                    totalWager += p.splitBet || p.bet;
                    labels.push(`Split: ${p.splitStatus === 'win' ? 'Win' : p.splitStatus === 'push' ? 'Push' : 'Loss'}`);
                }

                // Insurance
                if (p.insured && p.insuranceBet) {
                    const insNet = p.insuranceWon ? p.insuranceBet * 2 : -p.insuranceBet;
                    net += insNet;
                    totalWager += p.insuranceBet;
                    labels.push(`Insurance: ${p.insuranceWon ? 'Won' : 'Lost'}`);
                }

                const outcome = net > 0 ? 'win' : net === 0 ? 'push' : 'loss';
                return { peer_id: p.peer_id, nick: p.nick, betLabel: labels.join(' + '), wager: totalWager, net, outcome };
            });

        const totals = {};
        for (const b of breakdown) {
            totals[b.peer_id] = (totals[b.peer_id] ?? 0) + b.net;
        }

        return createPayoutEvent({
            gameType: 'blackjack',
            roundId: `${roomId}-${Date.now()}`,
            resultLabel,
            breakdown,
            totals,
        });
    }
}

registerGame('blackjack', BlackjackEngine);
