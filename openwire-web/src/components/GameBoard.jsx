import * as game from '../lib/game';

export default function GameBoard({ game: g, myId, onMove, onRematch, onClose }) {
    const isOver = g.result !== null;
    const myTurn = game.isMyTurn(g, myId);

    const statusText = (() => {
        if (g.result === 'X') return `🏆 ${g.playerX.nick} wins!`;
        if (g.result === 'O') return `🏆 ${g.playerO.nick} wins!`;
        if (g.result === 'draw') return '🤝 Draw!';
        if (myTurn) return `Your turn (${myId === g.playerX.peer_id ? '✕' : '○'})`;
        return `Waiting for ${game.turnNick(g)}...`;
    })();

    // Find winning cells for highlighting
    const winCells = (() => {
        if (!g.result || g.result === 'draw') return new Set();
        const WINS = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
        for (const [a, b, c] of WINS) {
            if (g.board[a] && g.board[a] === g.board[b] && g.board[b] === g.board[c]) {
                return new Set([a, b, c]);
            }
        }
        return new Set();
    })();

    return (
        <div className="game-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="game-card">
                <h2>Tic-Tac-Toe</h2>
                <div className="game-players">
                    <span style={{ color: 'var(--accent)' }}>{g.playerX.nick} (✕)</span>
                    {' vs '}
                    <span style={{ color: 'var(--purple)' }}>{g.playerO.nick} (○)</span>
                </div>

                <div className="game-board">
                    {g.board.map((cell, i) => {
                        const sym = game.cellSymbol(cell);
                        const taken = cell !== game.CELL.EMPTY;
                        const win = winCells.has(i);
                        return (
                            <button
                                key={i}
                                className={`game-cell ${taken ? 'taken' : ''} ${win ? 'win' : ''}`}
                                onClick={() => !taken && !isOver && myTurn && onMove(i)}
                                disabled={taken || isOver || !myTurn}
                            >
                                {sym && (
                                    <span className={cell === game.CELL.X ? 'x' : 'o'}>{sym}</span>
                                )}
                                {!sym && (
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 400 }}>
                                        {i + 1}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                <div className="game-status" style={{
                    color: g.result ? 'var(--yellow)' : myTurn ? 'var(--green)' : 'var(--text-dim)'
                }}>
                    {statusText}
                </div>

                <div className="game-score">
                    {g.playerX.nick} {g.score.x} — {g.score.draws} — {g.score.o} {g.playerO.nick}
                </div>

                <div className="game-actions">
                    {isOver && (
                        <button className="primary" onClick={onRematch}>Rematch</button>
                    )}
                    <button onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
}
