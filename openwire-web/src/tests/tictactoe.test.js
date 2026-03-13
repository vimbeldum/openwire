import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Mock sessionStorage (andarbahar imports it transitively via GameEngine registry) ── */
const mockSessionStorage = {};
vi.stubGlobal('sessionStorage', {
    getItem: vi.fn(k => mockSessionStorage[k] ?? null),
    setItem: vi.fn((k, v) => { mockSessionStorage[k] = v; }),
    removeItem: vi.fn(k => { delete mockSessionStorage[k]; }),
});

import {
    createGame, makeMove, newRound,
    cellSymbol, isMyTurn, turnNick, turnSymbol,
    calculateResults,
    isGameMessage, parseGameAction, serializeGameAction,
    CELL, TICTACTOE_RULES,
} from '../lib/game.js';

const PLAYER_X = { peer_id: 'px', nick: 'Alice' };
const PLAYER_O = { peer_id: 'po', nick: 'Bob' };

/* ═══════════════════════════════════════════════════════════════
   1 -- createGame
   ═══════════════════════════════════════════════════════════════ */

describe('createGame', () => {
    it('creates a board of 9 empty cells', () => {
        const game = createGame(PLAYER_X, PLAYER_O, 'room1');
        expect(game.board).toHaveLength(9);
        expect(game.board.every(c => c === CELL.EMPTY)).toBe(true);
    });

    it('sets turn to X (1)', () => {
        const game = createGame(PLAYER_X, PLAYER_O, 'room1');
        expect(game.turn).toBe(CELL.X);
    });

    it('stores player references and roomId', () => {
        const game = createGame(PLAYER_X, PLAYER_O, 'room1');
        expect(game.playerX).toBe(PLAYER_X);
        expect(game.playerO).toBe(PLAYER_O);
        expect(game.roomId).toBe('room1');
    });

    it('initializes score to all zeros', () => {
        const game = createGame(PLAYER_X, PLAYER_O, 'room1');
        expect(game.score).toEqual({ x: 0, o: 0, draws: 0 });
    });

    it('starts with null result', () => {
        const game = createGame(PLAYER_X, PLAYER_O, 'room1');
        expect(game.result).toBeNull();
    });
});

/* ═══════════════════════════════════════════════════════════════
   2 -- makeMove: validation
   ═══════════════════════════════════════════════════════════════ */

describe('makeMove: validation', () => {
    it('returns error when game is over', () => {
        let game = createGame(PLAYER_X, PLAYER_O, 'room1');
        game = { ...game, result: 'X' };
        expect(makeMove(game, 0, 'px')).toEqual({ error: 'Game is over' });
    });

    it('returns error for invalid position (negative)', () => {
        const game = createGame(PLAYER_X, PLAYER_O, 'room1');
        expect(makeMove(game, -1, 'px')).toEqual({ error: 'Invalid position' });
    });

    it('returns error for invalid position (> 8)', () => {
        const game = createGame(PLAYER_X, PLAYER_O, 'room1');
        expect(makeMove(game, 9, 'px')).toEqual({ error: 'Invalid position' });
    });

    it('returns error when cell is already taken', () => {
        const game = createGame(PLAYER_X, PLAYER_O, 'room1');
        const { game: g1 } = makeMove(game, 0, 'px');
        expect(makeMove(g1, 0, 'po')).toEqual({ error: 'Cell taken' });
    });

    it('returns error for unknown player', () => {
        const game = createGame(PLAYER_X, PLAYER_O, 'room1');
        expect(makeMove(game, 0, 'stranger')).toEqual({ error: 'Not a player' });
    });

    it('returns error when not your turn', () => {
        const game = createGame(PLAYER_X, PLAYER_O, 'room1');
        // X goes first, so O cannot go first
        expect(makeMove(game, 0, 'po')).toEqual({ error: 'Not your turn' });
    });
});

/* ═══════════════════════════════════════════════════════════════
   3 -- makeMove: game play
   ═══════════════════════════════════════════════════════════════ */

describe('makeMove: game play', () => {
    it('places X on the board and switches turn to O', () => {
        const game = createGame(PLAYER_X, PLAYER_O, 'room1');
        const { game: g1 } = makeMove(game, 4, 'px');
        expect(g1.board[4]).toBe(CELL.X);
        expect(g1.turn).toBe(CELL.O);
    });

    it('places O on the board and switches turn to X', () => {
        const game = createGame(PLAYER_X, PLAYER_O, 'room1');
        const { game: g1 } = makeMove(game, 0, 'px');
        const { game: g2 } = makeMove(g1, 1, 'po');
        expect(g2.board[1]).toBe(CELL.O);
        expect(g2.turn).toBe(CELL.X);
    });

    it('detects X winning (top row)', () => {
        let game = createGame(PLAYER_X, PLAYER_O, 'room1');
        game = makeMove(game, 0, 'px').game;  // X
        game = makeMove(game, 3, 'po').game;  // O
        game = makeMove(game, 1, 'px').game;  // X
        game = makeMove(game, 4, 'po').game;  // O
        game = makeMove(game, 2, 'px').game;  // X wins row 0,1,2
        expect(game.result).toBe('X');
        expect(game.score.x).toBe(1);
    });

    it('detects O winning (diagonal)', () => {
        let game = createGame(PLAYER_X, PLAYER_O, 'room1');
        game = makeMove(game, 0, 'px').game;  // X
        game = makeMove(game, 2, 'po').game;  // O
        game = makeMove(game, 1, 'px').game;  // X
        game = makeMove(game, 4, 'po').game;  // O
        game = makeMove(game, 7, 'px').game;  // X
        game = makeMove(game, 6, 'po').game;  // O wins diagonal 2,4,6
        expect(game.result).toBe('O');
        expect(game.score.o).toBe(1);
    });

    it('detects draw on full board (alternate sequence)', () => {
        let game = createGame(PLAYER_X, PLAYER_O, 'room1');
        // Board: X X O / O O X / X O X → draw
        game = makeMove(game, 0, 'px').game;
        game = makeMove(game, 4, 'po').game;
        game = makeMove(game, 8, 'px').game;
        game = makeMove(game, 2, 'po').game;
        game = makeMove(game, 6, 'px').game;
        game = makeMove(game, 3, 'po').game;
        game = makeMove(game, 5, 'px').game;
        game = makeMove(game, 7, 'po').game;
        game = makeMove(game, 1, 'px').game;
        expect(game.result).toBe('draw');
        expect(game.score.draws).toBe(1);
    });

    it('detects draw when all cells filled with no winner', () => {
        // Construct a draw directly via forced board
        let game = createGame(PLAYER_X, PLAYER_O, 'room1');
        // Known draw sequence:
        // X O X
        // O X X
        // O X O
        game = makeMove(game, 0, 'px').game; // X(0)
        game = makeMove(game, 1, 'po').game; // O(1)
        game = makeMove(game, 2, 'px').game; // X(2)
        game = makeMove(game, 3, 'po').game; // O(3)
        game = makeMove(game, 4, 'px').game; // X(4)
        game = makeMove(game, 8, 'po').game; // O(8)
        game = makeMove(game, 5, 'px').game; // X(5)
        game = makeMove(game, 6, 'po').game; // O(6)
        game = makeMove(game, 7, 'px').game; // X(7)
        // Board: X O X / O X X / O X O
        expect(game.result).toBe('draw');
        expect(game.score.draws).toBe(1);
    });

    it('does not increment score when no result', () => {
        const game = createGame(PLAYER_X, PLAYER_O, 'room1');
        const { game: g1 } = makeMove(game, 0, 'px');
        expect(g1.score).toEqual({ x: 0, o: 0, draws: 0 });
    });
});

/* ═══════════════════════════════════════════════════════════════
   4 -- newRound
   ═══════════════════════════════════════════════════════════════ */

describe('newRound', () => {
    it('resets board and result but preserves score', () => {
        let game = createGame(PLAYER_X, PLAYER_O, 'room1');
        game = makeMove(game, 0, 'px').game;
        game = makeMove(game, 3, 'po').game;
        game = makeMove(game, 1, 'px').game;
        game = makeMove(game, 4, 'po').game;
        game = makeMove(game, 2, 'px').game; // X wins
        expect(game.score.x).toBe(1);

        const fresh = newRound(game);
        expect(fresh.board.every(c => c === CELL.EMPTY)).toBe(true);
        expect(fresh.result).toBeNull();
        expect(fresh.turn).toBe(CELL.X);
        expect(fresh.score.x).toBe(1); // preserved
    });
});

/* ═══════════════════════════════════════════════════════════════
   5 -- cellSymbol
   ═══════════════════════════════════════════════════════════════ */

describe('cellSymbol', () => {
    it('returns cross for X (1)', () => {
        expect(cellSymbol(CELL.X)).toBe('✕');
    });

    it('returns circle for O (2)', () => {
        expect(cellSymbol(CELL.O)).toBe('○');
    });

    it('returns empty string for EMPTY (0)', () => {
        expect(cellSymbol(CELL.EMPTY)).toBe('');
    });
});

/* ═══════════════════════════════════════════════════════════════
   6 -- isMyTurn
   ═══════════════════════════════════════════════════════════════ */

describe('isMyTurn', () => {
    it('returns true for X player when turn is X', () => {
        const game = createGame(PLAYER_X, PLAYER_O, 'room1');
        expect(isMyTurn(game, 'px')).toBe(true);
    });

    it('returns false for O player when turn is X', () => {
        const game = createGame(PLAYER_X, PLAYER_O, 'room1');
        expect(isMyTurn(game, 'po')).toBe(false);
    });

    it('returns false when game is over', () => {
        let game = createGame(PLAYER_X, PLAYER_O, 'room1');
        game = { ...game, result: 'X' };
        expect(isMyTurn(game, 'px')).toBe(false);
    });

    it('returns false for unknown peer', () => {
        const game = createGame(PLAYER_X, PLAYER_O, 'room1');
        expect(isMyTurn(game, 'stranger')).toBe(false);
    });
});

/* ═══════════════════════════════════════════════════════════════
   7 -- turnNick / turnSymbol
   ═══════════════════════════════════════════════════════════════ */

describe('turnNick / turnSymbol', () => {
    it('turnNick returns X player nick when turn is X', () => {
        const game = createGame(PLAYER_X, PLAYER_O, 'room1');
        expect(turnNick(game)).toBe('Alice');
    });

    it('turnNick returns O player nick when turn is O', () => {
        const game = createGame(PLAYER_X, PLAYER_O, 'room1');
        const { game: g1 } = makeMove(game, 0, 'px');
        expect(turnNick(g1)).toBe('Bob');
    });

    it('turnSymbol returns cross when turn is X', () => {
        const game = createGame(PLAYER_X, PLAYER_O, 'room1');
        expect(turnSymbol(game)).toBe('✕');
    });

    it('turnSymbol returns circle when turn is O', () => {
        const game = createGame(PLAYER_X, PLAYER_O, 'room1');
        const { game: g1 } = makeMove(game, 0, 'px');
        expect(turnSymbol(g1)).toBe('○');
    });
});

/* ═══════════════════════════════════════════════════════════════
   8 -- calculateResults
   ═══════════════════════════════════════════════════════════════ */

describe('calculateResults', () => {
    it('returns a NonFinancialEvent with financial:false', () => {
        let game = createGame(PLAYER_X, PLAYER_O, 'room1');
        game = makeMove(game, 0, 'px').game;
        game = makeMove(game, 3, 'po').game;
        game = makeMove(game, 1, 'px').game;
        game = makeMove(game, 4, 'po').game;
        game = makeMove(game, 2, 'px').game; // X wins
        const event = calculateResults(game);
        expect(event.financial).toBe(false);
        expect(event.gameType).toBe('tictactoe');
    });

    it('sets correct resultLabel for X win', () => {
        let game = createGame(PLAYER_X, PLAYER_O, 'room1');
        game = makeMove(game, 0, 'px').game;
        game = makeMove(game, 3, 'po').game;
        game = makeMove(game, 1, 'px').game;
        game = makeMove(game, 4, 'po').game;
        game = makeMove(game, 2, 'px').game;
        const event = calculateResults(game);
        expect(event.resultLabel).toBe('Alice wins');
    });

    it('sets correct playerStats with win/loss outcomes', () => {
        let game = createGame(PLAYER_X, PLAYER_O, 'room1');
        game = makeMove(game, 0, 'px').game;
        game = makeMove(game, 3, 'po').game;
        game = makeMove(game, 1, 'px').game;
        game = makeMove(game, 4, 'po').game;
        game = makeMove(game, 2, 'px').game;
        const event = calculateResults(game);
        expect(event.playerStats).toHaveLength(2);
        expect(event.playerStats[0].outcome).toBe('win');
        expect(event.playerStats[1].outcome).toBe('loss');
    });

    it('sets draw outcome for both players on draw', () => {
        let game = createGame(PLAYER_X, PLAYER_O, 'room1');
        game = makeMove(game, 0, 'px').game;
        game = makeMove(game, 1, 'po').game;
        game = makeMove(game, 2, 'px').game;
        game = makeMove(game, 3, 'po').game;
        game = makeMove(game, 4, 'px').game;
        game = makeMove(game, 8, 'po').game;
        game = makeMove(game, 5, 'px').game;
        game = makeMove(game, 6, 'po').game;
        game = makeMove(game, 7, 'px').game;
        const event = calculateResults(game);
        expect(event.resultLabel).toBe('Draw');
        expect(event.playerStats[0].outcome).toBe('draw');
        expect(event.playerStats[1].outcome).toBe('draw');
    });

    it('has empty breakdown and totals', () => {
        let game = createGame(PLAYER_X, PLAYER_O, 'room1');
        game = { ...game, result: 'X' };
        const event = calculateResults(game);
        expect(event.breakdown).toEqual([]);
        expect(event.totals).toEqual({});
    });
});

/* ═══════════════════════════════════════════════════════════════
   9 -- Message protocol
   ═══════════════════════════════════════════════════════════════ */

describe('Message protocol', () => {
    it('isGameMessage returns true for GAME: prefix', () => {
        expect(isGameMessage('GAME:{"action":"move"}')).toBe(true);
    });

    it('isGameMessage returns false for other prefixes', () => {
        expect(isGameMessage('AB:{"action":"bet"}')).toBe(false);
        expect(isGameMessage('')).toBe(false);
        expect(isGameMessage(null)).toBe(false);
        expect(isGameMessage(42)).toBe(false);
    });

    it('serializeGameAction produces valid GAME: prefixed JSON', () => {
        const action = { type: 'move', position: 4 };
        const serialized = serializeGameAction(action);
        expect(serialized).toBe('GAME:{"type":"move","position":4}');
    });

    it('parseGameAction parses valid GAME: messages', () => {
        const result = parseGameAction('GAME:{"type":"move","position":4}');
        expect(result).toEqual({ type: 'move', position: 4 });
    });

    it('parseGameAction returns null for non-GAME messages', () => {
        expect(parseGameAction('AB:{"foo":1}')).toBeNull();
    });

    it('parseGameAction returns null for malformed JSON', () => {
        expect(parseGameAction('GAME:broken')).toBeNull();
    });
});

/* ═══════════════════════════════════════════════════════════════
   10 -- CELL constants
   ═══════════════════════════════════════════════════════════════ */

describe('CELL constants', () => {
    it('EMPTY is 0, X is 1, O is 2', () => {
        expect(CELL.EMPTY).toBe(0);
        expect(CELL.X).toBe(1);
        expect(CELL.O).toBe(2);
    });
});
