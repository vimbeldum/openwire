import { afterEach, describe, expect, it, vi } from 'vitest';
import { addPlayer, auctionProperty, createMonopoly, roll, startGame } from '../lib/monopoly.js';

function withRandomSequence(values, fn) {
    const spy = vi.spyOn(Math, 'random');
    values.forEach((value) => spy.mockReturnValueOnce(value));
    try {
        return fn();
    } finally {
        spy.mockRestore();
    }
}

function makeStartedGame() {
    let game = createMonopoly('room-1');
    game = addPlayer(game, 'p1', 'Alice');
    game = addPlayer(game, 'p2', 'Bob');
    return startGame(game);
}

describe('monopoly engine', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('stays in lobby until enough players have joined', () => {
        let game = createMonopoly('room-1');
        game = addPlayer(game, 'p1', 'Alice');

        const result = startGame(game);
        expect(result.phase).toBe('lobby');
    });

    it('starts once two players are present', () => {
        const result = makeStartedGame();
        expect(result.phase).toBe('rolling');
        expect(result.players).toHaveLength(2);
    });

    it('offers purchase actions on an unowned property', () => {
        const game = makeStartedGame();
        const result = withRandomSequence([0, 0.2], () => roll(game));
        expect(result.phase).toBe('property');
        expect(result.players[0].position).toBe(3);
    });

    it('keeps the turn in rolling state after landing on an owned property', () => {
        const base = makeStartedGame();
        const withOwner = {
            ...base,
            properties: base.properties.map((property) =>
                property.id === 2 ? { ...property, owner: 'p2' } : property
            ),
            players: base.players.map((player) =>
                player.peer_id === 'p2'
                    ? { ...player, properties: [...player.properties, 2] }
                    : player
            ),
        };

        const result = withRandomSequence([0, 0.2], () => roll(withOwner));
        expect(result.phase).toBe('rolling');
        expect(result.diceRolled).toBe(true);
        expect(result.players[0].money).toBeLessThan(1500);
    });

    it('treats landing on jail as just visiting', () => {
        const game = makeStartedGame();
        const result = withRandomSequence([0.5, 0.9], () => roll(game));
        expect(result.players[0].position).toBe(10);
        expect(result.phase).toBe('rolling');
        expect(result.players[0].inJail).toBe(false);
    });

    it('auction charges only the winner and advances the turn', () => {
        const started = makeStartedGame();
        const propertyPhase = {
            ...started,
            phase: 'property',
            currentPlayer: 0,
            players: started.players.map((player, index) =>
                index === 0 ? { ...player, position: 1 } : player
            ),
        };

        const result = withRandomSequence([0.9], () => auctionProperty(propertyPhase));
        expect(result.properties.find((property) => property.id === 1)?.owner).toBe('p2');
        expect(result.players.find((player) => player.peer_id === 'p1')?.money).toBe(1500);
        expect(result.players.find((player) => player.peer_id === 'p2')?.money).toBe(1470);
        expect(result.currentPlayer).toBe(1);
    });
});
