/* ═══════════════════════════════════════════════════════════
   OpenWire Web — Blackjack game engine
   Multiplayer blackjack with shared dealer
   ═══════════════════════════════════════════════════════════ */

const SUITS = ['♠', '♥', '♦', '♣'];
const VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

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

// Fisher-Yates shuffle
export function shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
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

// Player hits (takes a card)
export function hit(game, peer_id) {
    const playerIndex = game.players.findIndex(p => p.peer_id === peer_id);
    if (playerIndex === -1 || game.phase !== 'playing') return game;
    if (game.currentPlayerIndex !== playerIndex) return game;

    let deck = [...game.deck];
    const card = deck.pop();

    let players = [...game.players];
    const player = { ...players[playerIndex] };
    player.hand = [...player.hand, card];

    if (isBust(player.hand)) {
        player.status = 'bust';
    } else if (calculateHand(player.hand) === 21) {
        player.status = 'stand'; // auto-stand on 21
    }

    players[playerIndex] = player;

    // Move to next player if bust or stand
    let currentPlayerIndex = game.currentPlayerIndex;
    let phase = game.phase;
    let dealer = { ...game.dealer };

    if (player.status === 'bust' || player.status === 'stand') {
        // Find next playing player
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

// Player stands (ends turn)
export function stand(game, peer_id) {
    const playerIndex = game.players.findIndex(p => p.peer_id === peer_id);
    if (playerIndex === -1 || game.phase !== 'playing') return game;
    if (game.currentPlayerIndex !== playerIndex) return game;

    let players = [...game.players];
    players[playerIndex] = { ...players[playerIndex], status: 'stand' };

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

// Dealer plays (hits until 17 or higher)
export function dealerPlay(game) {
    if (game.phase !== 'dealer') return game;

    let deck = [...game.deck];
    let dealer = { ...game.dealer, revealed: true };

    // Dealer hits on 16 or less, stands on 17+
    while (calculateHand(dealer.hand) < 17) {
        dealer.hand.push(deck.pop());
    }

    return {
        ...game,
        deck,
        dealer,
        phase: 'settlement',
    };
}

// Settle bets (determine winners/losers)
export function settle(game) {
    if (game.phase !== 'settlement') return game;

    const dealerTotal = calculateHand(game.dealer.hand);
    const dealerBust = isBust(game.dealer.hand);
    const dealerBlackjack = isBlackjack(game.dealer.hand);

    let players = game.players.map(p => {
        if (p.status === 'bust') {
            return { ...p, status: 'lose' };
        }

        const playerTotal = calculateHand(p.hand);
        const playerBlackjack = isBlackjack(p.hand);

        if (playerBlackjack && !dealerBlackjack) {
            return { ...p, status: 'blackjack-win' };
        }

        if (dealerBust) {
            return { ...p, status: 'win' };
        }

        if (playerTotal > dealerTotal) {
            return { ...p, status: 'win' };
        } else if (playerTotal < dealerTotal) {
            return { ...p, status: 'lose' };
        } else {
            return { ...p, status: 'push' };
        }
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

// Start a new round (keep players, reset cards)
export function newRound(game) {
    return {
        ...createGame(game.roomId, game.dealer.peer_id),
        players: game.players.map(p => ({
            peer_id: p.peer_id,
            nick: p.nick,
            hand: [],
            status: 'waiting',
            bet: 0,
        })),
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

// Serialize game state for transmission
export function serializeGame(game) {
    return JSON.stringify({
        ...game,
        // Don't send full deck to prevent cheating in real implementation
        deckCount: game.deck.length,
    });
}

export function deserializeGame(data) {
    try {
        return JSON.parse(data);
    } catch {
        return null;
    }
}
