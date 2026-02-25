/* ═══════════════════════════════════════════════════════════
   OpenWire Web — Tic-Tac-Toe game engine (JS port of game.rs)
   ═══════════════════════════════════════════════════════════ */

const EMPTY = 0, X = 1, O = 2;
const WINS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
    [0, 4, 8], [2, 4, 6],         // diagonals
];

export function createGame(playerX, playerO, roomId) {
    return {
        board: Array(9).fill(EMPTY),
        turn: X,
        playerX, // { peer_id, nick }
        playerO, // { peer_id, nick }
        roomId,
        result: null, // null = in progress, 'X', 'O', 'draw'
        score: { x: 0, o: 0, draws: 0 },
    };
}

export function newRound(game) {
    return {
        ...game,
        board: Array(9).fill(EMPTY),
        turn: X,
        result: null,
    };
}

export function makeMove(game, position, peerId) {
    if (game.result) return { error: 'Game is over' };
    if (position < 0 || position > 8) return { error: 'Invalid position' };
    if (game.board[position] !== EMPTY) return { error: 'Cell taken' };

    const cell = peerId === game.playerX.peer_id ? X :
        peerId === game.playerO.peer_id ? O : null;
    if (!cell) return { error: 'Not a player' };
    if (cell !== game.turn) return { error: 'Not your turn' };

    const newBoard = [...game.board];
    newBoard[position] = cell;

    const result = checkResult(newBoard);
    const newScore = { ...game.score };
    if (result === 'X') newScore.x++;
    else if (result === 'O') newScore.o++;
    else if (result === 'draw') newScore.draws++;

    return {
        game: {
            ...game,
            board: newBoard,
            turn: cell === X ? O : X,
            result,
            score: newScore,
        }
    };
}

function checkResult(board) {
    for (const [a, b, c] of WINS) {
        if (board[a] && board[a] === board[b] && board[b] === board[c]) {
            return board[a] === X ? 'X' : 'O';
        }
    }
    if (board.every(c => c !== EMPTY)) return 'draw';
    return null;
}

export function cellSymbol(cell) {
    return cell === X ? '✕' : cell === O ? '○' : '';
}

export function isMyTurn(game, peerId) {
    if (game.result) return false;
    const myCell = peerId === game.playerX.peer_id ? X :
        peerId === game.playerO.peer_id ? O : null;
    return myCell === game.turn;
}

export function turnNick(game) {
    return game.turn === X ? game.playerX.nick : game.playerO.nick;
}

export function turnSymbol(game) {
    return game.turn === X ? '✕' : '○';
}

export const CELL = { EMPTY, X, O };

// Game action helpers (match the Rust format)
export function isGameMessage(data) {
    return typeof data === 'string' && data.startsWith('GAME:');
}

export function parseGameAction(data) {
    if (!isGameMessage(data)) return null;
    try { return JSON.parse(data.slice(5)); } catch { return null; }
}

export function serializeGameAction(action) {
    return 'GAME:' + JSON.stringify(action);
}
