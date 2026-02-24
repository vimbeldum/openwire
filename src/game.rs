//! In-room mini-games for OpenWire
//!
//! Currently supports Tic-Tac-Toe played between two peers in a room.
//! Game actions are sent as JSON-encoded room messages.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

/// Tic-Tac-Toe cell state
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Cell {
    Empty,
    X,
    O,
}

impl Cell {
    pub fn symbol(self) -> &'static str {
        match self {
            Cell::Empty => " ",
            Cell::X => "X",
            Cell::O => "O",
        }
    }
}

/// Game outcome
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GameResult {
    Win(Cell),  // X or O won
    Draw,
    InProgress,
}

/// A game action sent over the network
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum GameAction {
    /// Challenge someone to a game
    Challenge {
        /// The challenger's peer ID
        challenger: String,
        /// The challenger's display name
        challenger_nick: String,
        /// Which room this game is in
        room_id: String,
    },
    /// Accept a challenge
    Accept {
        /// The accepter's peer ID
        accepter: String,
        /// The accepter's display name
        accepter_nick: String,
        room_id: String,
    },
    /// Decline a challenge
    Decline {
        room_id: String,
    },
    /// Make a move (position 1-9)
    Move {
        position: u8, // 1-9
        room_id: String,
        player: String, // peer_id of the player
    },
    /// Resign/forfeit
    Resign {
        room_id: String,
        player: String,
    },
}

impl GameAction {
    /// Serialize to bytes for sending as a room message
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut data = b"GAME:".to_vec();
        data.extend_from_slice(&serde_json::to_vec(self).unwrap_or_default());
        data
    }

    /// Try to parse from room message bytes
    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        let data_str = std::str::from_utf8(data).ok()?;
        let json_str = data_str.strip_prefix("GAME:")?;
        serde_json::from_str(json_str).ok()
    }

    /// Check if bytes are a game message
    pub fn is_game_message(data: &[u8]) -> bool {
        data.starts_with(b"GAME:")
    }
}

/// Session score tracker
#[derive(Debug, Clone, Default)]
pub struct GameScore {
    pub player_x_wins: u32,
    pub player_o_wins: u32,
    pub draws: u32,
}

impl GameScore {
    pub fn record(&mut self, result: &GameResult) {
        match result {
            GameResult::Win(Cell::X) => self.player_x_wins += 1,
            GameResult::Win(Cell::O) => self.player_o_wins += 1,
            GameResult::Draw => self.draws += 1,
            _ => {}
        }
    }

    pub fn total_games(&self) -> u32 {
        self.player_x_wins + self.player_o_wins + self.draws
    }
}

/// A Tic-Tac-Toe game instance
#[derive(Debug, Clone)]
pub struct TicTacToe {
    /// The 3x3 board (indices 0-8, displayed as positions 1-9)
    pub board: [Cell; 9],
    /// Whose turn it is
    pub current_turn: Cell,
    /// Player X info (peer_id, nick)
    pub player_x: (String, String),
    /// Player O info (peer_id, nick)
    pub player_o: (String, String),
    /// Room this game is being played in
    pub room_id: String,
    /// Session score
    pub score: GameScore,
    /// Game result
    pub result: GameResult,
}

impl TicTacToe {
    /// Start a new game
    pub fn new(
        player_x: (String, String),
        player_o: (String, String),
        room_id: String,
    ) -> Self {
        Self {
            board: [Cell::Empty; 9],
            current_turn: Cell::X,
            player_x,
            player_o,
            room_id,
            score: GameScore::default(),
            result: GameResult::InProgress,
        }
    }

    /// Start a new round (keep score)
    pub fn new_round(&mut self) {
        self.board = [Cell::Empty; 9];
        self.current_turn = Cell::X;
        self.result = GameResult::InProgress;
    }

    /// Get which Cell a peer ID plays as
    pub fn player_cell(&self, peer_id: &str) -> Option<Cell> {
        if self.player_x.0 == peer_id {
            Some(Cell::X)
        } else if self.player_o.0 == peer_id {
            Some(Cell::O)
        } else {
            None
        }
    }

    /// Get the nick for a cell
    pub fn nick_for(&self, cell: Cell) -> &str {
        match cell {
            Cell::X => &self.player_x.1,
            Cell::O => &self.player_o.1,
            Cell::Empty => "???",
        }
    }

    /// Check if it's this peer's turn
    pub fn is_my_turn(&self, peer_id: &str) -> bool {
        self.player_cell(peer_id) == Some(self.current_turn)
    }

    /// Make a move. Position is 1-9 (human-friendly).
    /// Returns the game result after the move.
    pub fn make_move(&mut self, position: u8, peer_id: &str) -> Result<GameResult, String> {
        if self.result != GameResult::InProgress {
            return Err("Game is already over!".to_string());
        }

        let cell = self.player_cell(peer_id)
            .ok_or_else(|| "You are not a player in this game".to_string())?;

        if cell != self.current_turn {
            return Err(format!("Not your turn! Waiting for {}", self.nick_for(self.current_turn)));
        }

        if position < 1 || position > 9 {
            return Err("Position must be 1-9".to_string());
        }

        let idx = (position - 1) as usize;
        if self.board[idx] != Cell::Empty {
            return Err("That cell is already taken!".to_string());
        }

        self.board[idx] = cell;

        // Check for win or draw
        self.result = self.check_result();
        if self.result != GameResult::InProgress {
            self.score.record(&self.result);
        } else {
            // Switch turns
            self.current_turn = match self.current_turn {
                Cell::X => Cell::O,
                Cell::O => Cell::X,
                Cell::Empty => Cell::X,
            };
        }

        Ok(self.result.clone())
    }

    /// Check the board for a winner or draw
    fn check_result(&self) -> GameResult {
        const WINS: [[usize; 3]; 8] = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
            [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
            [0, 4, 8], [2, 4, 6],             // diagonals
        ];

        for line in &WINS {
            let a = self.board[line[0]];
            let b = self.board[line[1]];
            let c = self.board[line[2]];
            if a != Cell::Empty && a == b && b == c {
                return GameResult::Win(a);
            }
        }

        if self.board.iter().all(|c| *c != Cell::Empty) {
            return GameResult::Draw;
        }

        GameResult::InProgress
    }

    /// Render the board as ASCII art lines for display in chat
    pub fn render_board(&self) -> Vec<String> {
        let b = &self.board;
        let cell = |i: usize| -> String {
            match b[i] {
                Cell::Empty => format!("{}", i + 1), // show position number
                Cell::X => "X".to_string(),
                Cell::O => "O".to_string(),
            }
        };

        vec![
            "┌───┬───┬───┐".to_string(),
            format!("│ {} │ {} │ {} │", cell(0), cell(1), cell(2)),
            "├───┼───┼───┤".to_string(),
            format!("│ {} │ {} │ {} │", cell(3), cell(4), cell(5)),
            "├───┼───┼───┤".to_string(),
            format!("│ {} │ {} │ {} │", cell(6), cell(7), cell(8)),
            "└───┴───┴───┘".to_string(),
        ]
    }

    /// Render the score
    pub fn render_score(&self) -> String {
        format!(
            "Score: {} (X) {} - {} - {} (O) {} │ Games: {}",
            self.player_x.1,
            self.score.player_x_wins,
            self.score.draws,
            self.score.player_o_wins,
            self.player_o.1,
            self.score.total_games(),
        )
    }

    /// Render the full game status
    pub fn render_status(&self) -> Vec<String> {
        let mut lines = vec![
            "═══════════ TIC-TAC-TOE ═══════════".to_string(),
            format!(
                "  {} (X)  vs  {} (O)",
                self.player_x.1, self.player_o.1
            ),
            String::new(),
        ];

        lines.extend(self.render_board());

        lines.push(String::new());

        match &self.result {
            GameResult::Win(cell) => {
                lines.push(format!("🏆 {} wins!", self.nick_for(*cell)));
                lines.push(self.render_score());
                lines.push("Type /game rematch for another round!".to_string());
            }
            GameResult::Draw => {
                lines.push("🤝 It's a draw!".to_string());
                lines.push(self.render_score());
                lines.push("Type /game rematch for another round!".to_string());
            }
            GameResult::InProgress => {
                lines.push(format!(
                    "Turn: {} ({}) — type /move <1-9>",
                    self.nick_for(self.current_turn),
                    self.current_turn.symbol()
                ));
            }
        }

        lines.push("════════════════════════════════════".to_string());
        lines
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_game() {
        let game = TicTacToe::new(
            ("peer_x".into(), "Alice".into()),
            ("peer_o".into(), "Bob".into()),
            "room1".into(),
        );
        assert_eq!(game.current_turn, Cell::X);
        assert_eq!(game.result, GameResult::InProgress);
        assert!(game.board.iter().all(|c| *c == Cell::Empty));
    }

    #[test]
    fn test_make_move() {
        let mut game = TicTacToe::new(
            ("peer_x".into(), "Alice".into()),
            ("peer_o".into(), "Bob".into()),
            "room1".into(),
        );

        // X moves to center
        let result = game.make_move(5, "peer_x").unwrap();
        assert_eq!(result, GameResult::InProgress);
        assert_eq!(game.board[4], Cell::X);
        assert_eq!(game.current_turn, Cell::O);
    }

    #[test]
    fn test_wrong_turn() {
        let mut game = TicTacToe::new(
            ("peer_x".into(), "Alice".into()),
            ("peer_o".into(), "Bob".into()),
            "room1".into(),
        );

        // O tries to move first — should fail
        assert!(game.make_move(5, "peer_o").is_err());
    }

    #[test]
    fn test_win_detection_row() {
        let mut game = TicTacToe::new(
            ("peer_x".into(), "Alice".into()),
            ("peer_o".into(), "Bob".into()),
            "room1".into(),
        );

        // X: 1, O: 4, X: 2, O: 5, X: 3 → X wins top row
        game.make_move(1, "peer_x").unwrap();
        game.make_move(4, "peer_o").unwrap();
        game.make_move(2, "peer_x").unwrap();
        game.make_move(5, "peer_o").unwrap();
        let result = game.make_move(3, "peer_x").unwrap();
        assert_eq!(result, GameResult::Win(Cell::X));
        assert_eq!(game.score.player_x_wins, 1);
    }

    #[test]
    fn test_draw() {
        let mut game = TicTacToe::new(
            ("peer_x".into(), "Alice".into()),
            ("peer_o".into(), "Bob".into()),
            "room1".into(),
        );

        // Classic draw: X O X / X X O / O X O
        game.make_move(1, "peer_x").unwrap(); // X top-left
        game.make_move(2, "peer_o").unwrap(); // O top-center
        game.make_move(3, "peer_x").unwrap(); // X top-right
        game.make_move(6, "peer_o").unwrap(); // O mid-right
        game.make_move(4, "peer_x").unwrap(); // X mid-left
        game.make_move(7, "peer_o").unwrap(); // O bot-left
        game.make_move(5, "peer_x").unwrap(); // X mid-center
        game.make_move(9, "peer_o").unwrap(); // O bot-right
        let result = game.make_move(8, "peer_x").unwrap();
        assert_eq!(result, GameResult::Draw);
        assert_eq!(game.score.draws, 1);
    }

    #[test]
    fn test_rematch_keeps_score() {
        let mut game = TicTacToe::new(
            ("peer_x".into(), "Alice".into()),
            ("peer_o".into(), "Bob".into()),
            "room1".into(),
        );

        // X wins
        game.make_move(1, "peer_x").unwrap();
        game.make_move(4, "peer_o").unwrap();
        game.make_move(2, "peer_x").unwrap();
        game.make_move(5, "peer_o").unwrap();
        game.make_move(3, "peer_x").unwrap();

        assert_eq!(game.score.player_x_wins, 1);

        // Rematch
        game.new_round();
        assert_eq!(game.result, GameResult::InProgress);
        assert_eq!(game.score.player_x_wins, 1); // Score preserved
        assert!(game.board.iter().all(|c| *c == Cell::Empty));
    }

    #[test]
    fn test_game_action_serialization() {
        let action = GameAction::Move {
            position: 5,
            room_id: "room1".into(),
            player: "peer_x".into(),
        };

        let bytes = action.to_bytes();
        assert!(GameAction::is_game_message(&bytes));
        let parsed = GameAction::from_bytes(&bytes).unwrap();
        match parsed {
            GameAction::Move { position, .. } => assert_eq!(position, 5),
            _ => panic!("Wrong action type"),
        }
    }

    #[test]
    fn test_cell_already_taken() {
        let mut game = TicTacToe::new(
            ("peer_x".into(), "Alice".into()),
            ("peer_o".into(), "Bob".into()),
            "room1".into(),
        );

        game.make_move(5, "peer_x").unwrap();
        // O tries to take the same cell
        assert!(game.make_move(5, "peer_o").is_err());
    }

    #[test]
    fn test_board_render() {
        let game = TicTacToe::new(
            ("peer_x".into(), "Alice".into()),
            ("peer_o".into(), "Bob".into()),
            "room1".into(),
        );
        let lines = game.render_board();
        assert_eq!(lines.len(), 7);
        assert!(lines[0].contains("┌"));
        assert!(lines[6].contains("┘"));
    }
}
