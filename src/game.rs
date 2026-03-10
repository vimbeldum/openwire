//! In-room mini-games for OpenWire
//!
//! Currently supports Tic-Tac-Toe and Blackjack played between peers in a room.
//! Game actions are sent as JSON-encoded room messages.

#![allow(dead_code)]

use rand::RngExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
    Win(Cell), // X or O won
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
    Decline { room_id: String },
    /// Make a move (position 1-9)
    Move {
        position: u8, // 1-9
        room_id: String,
        player: String, // peer_id of the player
    },
    /// Resign/forfeit
    Resign { room_id: String, player: String },
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
    pub fn new(player_x: (String, String), player_o: (String, String), room_id: String) -> Self {
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

        let cell = self
            .player_cell(peer_id)
            .ok_or_else(|| "You are not a player in this game".to_string())?;

        if cell != self.current_turn {
            return Err(format!(
                "Not your turn! Waiting for {}",
                self.nick_for(self.current_turn)
            ));
        }

        if !(1..=9).contains(&position) {
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
            [0, 1, 2],
            [3, 4, 5],
            [6, 7, 8], // rows
            [0, 3, 6],
            [1, 4, 7],
            [2, 5, 8], // cols
            [0, 4, 8],
            [2, 4, 6], // diagonals
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
            format!("  {} (X)  vs  {} (O)", self.player_x.1, self.player_o.1),
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

// ═══════════════════════════════════════════════════════════════════════════════
// BLACKJACK
// ═══════════════════════════════════════════════════════════════════════════════

const SUITS: &[&str] = &["♠", "♥", "♦", "♣"];
const VALUES: &[&str] = &[
    "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K",
];

/// A playing card
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Card {
    pub suit: String,
    pub value: String,
    pub id: String,
}

impl Card {
    pub fn new(suit: &str, value: &str) -> Self {
        Self {
            suit: suit.to_string(),
            value: value.to_string(),
            id: format!("{}{}", value, suit),
        }
    }

    pub fn symbol(&self) -> String {
        format!("{}{}", self.value, self.suit)
    }

    pub fn is_red(&self) -> bool {
        self.suit == "♥" || self.suit == "♦"
    }
}

/// Player status in Blackjack
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PlayerStatus {
    Waiting,
    Ready,
    Playing,
    Stand,
    Bust,
    Blackjack,
    Win,
    Lose,
    Push,
    BlackjackWin,
}

impl PlayerStatus {
    pub fn display(&self) -> &'static str {
        match self {
            PlayerStatus::Waiting => "waiting",
            PlayerStatus::Ready => "ready",
            PlayerStatus::Playing => "playing",
            PlayerStatus::Stand => "STAND",
            PlayerStatus::Bust => "BUST!",
            PlayerStatus::Blackjack => "BLACKJACK!",
            PlayerStatus::Win => "WIN!",
            PlayerStatus::Lose => "LOSE",
            PlayerStatus::Push => "PUSH",
            PlayerStatus::BlackjackWin => "BLACKJACK WIN!",
        }
    }
}

/// A Blackjack player
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlackjackPlayer {
    pub peer_id: String,
    pub nick: String,
    pub hand: Vec<Card>,
    pub status: PlayerStatus,
    pub bet: u32,
    pub split_hand: Vec<Card>,        // second hand if split
    pub doubled_down: bool,           // whether player doubled
    pub insurance_bet: u32,           // insurance side-bet amount (0 = no insurance)
    pub insurance_resolved: bool,     // has insurance been resolved
}

impl BlackjackPlayer {
    pub fn new(peer_id: String, nick: String) -> Self {
        Self {
            peer_id,
            nick,
            hand: Vec::new(),
            status: PlayerStatus::Waiting,
            bet: 0,
            split_hand: Vec::new(),
            doubled_down: false,
            insurance_bet: 0,
            insurance_resolved: false,
        }
    }
}

/// Game phase
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BlackjackPhase {
    Betting,
    Dealing,
    Playing,
    Dealer,
    Settlement,
    Ended,
}

/// Blackjack action for network transmission
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BlackjackAction {
    /// Start a new game
    Start {
        room_id: String,
        host: String,
        host_nick: String,
    },
    /// Full game state sync
    State { state_json: String },
    /// Player joins
    Join { peer_id: String, nick: String },
    /// Player places bet
    Bet { peer_id: String, amount: u32 },
    /// Deal cards
    Deal,
    /// Player hits
    Hit { peer_id: String },
    /// Player stands
    Stand { peer_id: String },
    /// Dealer plays
    DealerPlay,
    /// New round
    NewRound,
    /// Player doubles down (doubles bet, takes exactly one more card then stands)
    DoubleDown { peer_id: String },
    /// Player splits their pair into two hands
    Split { peer_id: String },
    /// Player buys insurance (half bet that dealer has blackjack)
    Insurance { peer_id: String },
    /// Insurance resolved
    InsuranceResolved { won: bool },
}

impl BlackjackAction {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut data = b"BJ:".to_vec();
        data.extend_from_slice(&serde_json::to_vec(self).unwrap_or_default());
        data
    }

    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        let data_str = std::str::from_utf8(data).ok()?;
        let json_str = data_str.strip_prefix("BJ:")?;
        serde_json::from_str(json_str).ok()
    }

    pub fn is_blackjack_message(data: &[u8]) -> bool {
        data.starts_with(b"BJ:")
    }
}

/// Blackjack game state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Blackjack {
    pub room_id: String,
    pub deck: Vec<Card>,
    pub dealer_hand: Vec<Card>,
    pub dealer_revealed: bool,
    pub players: Vec<BlackjackPlayer>,
    pub current_player_index: i32,
    pub phase: BlackjackPhase,
}

impl Blackjack {
    pub fn new(room_id: String) -> Self {
        Self {
            room_id,
            deck: Self::create_deck(),
            dealer_hand: Vec::new(),
            dealer_revealed: false,
            players: Vec::new(),
            current_player_index: -1,
            phase: BlackjackPhase::Betting,
        }
    }

    fn create_deck() -> Vec<Card> {
        let mut deck = Vec::new();
        for &suit in SUITS {
            for &value in VALUES {
                deck.push(Card::new(suit, value));
            }
        }
        Self::shuffle_deck(&mut deck);
        deck
    }

    fn shuffle_deck(deck: &mut [Card]) {
        use rand::seq::SliceRandom;
        deck.shuffle(&mut rand::rng());
    }

    pub fn add_player(&mut self, peer_id: String, nick: String) {
        if !self.players.iter().any(|p| p.peer_id == peer_id) {
            self.players.push(BlackjackPlayer::new(peer_id, nick));
        }
    }

    pub fn place_bet(&mut self, peer_id: &str, amount: u32) -> Result<(), &'static str> {
        if self.phase != BlackjackPhase::Betting {
            return Err("Bets can only be placed during the betting phase");
        }
        if let Some(player) = self.players.iter_mut().find(|p| p.peer_id == peer_id) {
            player.bet = amount;
            player.status = if amount > 0 {
                PlayerStatus::Ready
            } else {
                PlayerStatus::Waiting
            };
            Ok(())
        } else {
            Err("Player not found")
        }
    }

    pub fn deal_initial_cards(&mut self) {
        if self.phase != BlackjackPhase::Betting {
            return; // Only deal during betting phase
        }
        // Deal 2 cards to each player and dealer
        for _ in 0..2 {
            for player in &mut self.players {
                if player.bet > 0
                    && let Some(card) = self.deck.pop()
                {
                    player.hand.push(card);
                    player.status = PlayerStatus::Playing;
                }
            }
            if let Some(card) = self.deck.pop() {
                self.dealer_hand.push(card);
            }
        }

        // Check for blackjacks
        for player in &mut self.players {
            if Self::calculate_hand(&player.hand) == 21 {
                player.status = PlayerStatus::Blackjack;
            }
        }

        // Find first player
        self.current_player_index = self
            .players
            .iter()
            .position(|p| p.status == PlayerStatus::Playing)
            .map(|i| i as i32)
            .unwrap_or(-1);

        if self.current_player_index == -1 {
            self.phase = BlackjackPhase::Dealer;
            self.dealer_revealed = true;
        } else {
            self.phase = BlackjackPhase::Playing;
        }
    }

    pub fn calculate_hand(cards: &[Card]) -> u32 {
        let mut total = 0u32;
        let mut aces = 0u32;

        for card in cards {
            match card.value.as_str() {
                "A" => {
                    aces += 1;
                    total += 11;
                }
                "K" | "Q" | "J" => {
                    total += 10;
                }
                v => {
                    total += v.parse::<u32>().unwrap_or(0);
                }
            }
        }

        while total > 21 && aces > 0 {
            total -= 10;
            aces -= 1;
        }

        total
    }

    pub fn is_bust(cards: &[Card]) -> bool {
        Self::calculate_hand(cards) > 21
    }

    pub fn is_blackjack(cards: &[Card]) -> bool {
        cards.len() == 2 && Self::calculate_hand(cards) == 21
    }

    pub fn hit(&mut self, peer_id: &str) {
        let idx = match self.players.iter().position(|p| p.peer_id == peer_id) {
            Some(i) if i as i32 == self.current_player_index => i,
            _ => return,
        };

        if let Some(card) = self.deck.pop() {
            self.players[idx].hand.push(card);
        }

        if Self::is_bust(&self.players[idx].hand) {
            self.players[idx].status = PlayerStatus::Bust;
            self.advance_to_next_player();
        } else if Self::calculate_hand(&self.players[idx].hand) == 21 {
            self.players[idx].status = PlayerStatus::Stand;
            self.advance_to_next_player();
        }
    }

    pub fn stand(&mut self, peer_id: &str) {
        let idx = match self.players.iter().position(|p| p.peer_id == peer_id) {
            Some(i) if i as i32 == self.current_player_index => i,
            _ => return,
        };

        self.players[idx].status = PlayerStatus::Stand;
        self.advance_to_next_player();
    }

    pub fn new_round(&mut self) {
        self.deck = Self::create_deck();
        self.dealer_hand.clear();
        self.dealer_revealed = false;
        self.current_player_index = -1;
        self.phase = BlackjackPhase::Betting;

        for player in &mut self.players {
            player.hand.clear();
            player.split_hand.clear();
            player.status = PlayerStatus::Waiting;
            player.bet = 0;
            player.doubled_down = false;
            player.insurance_bet = 0;
            player.insurance_resolved = false;
        }
    }

    fn advance_to_next_player(&mut self) {
        let next = self
            .players
            .iter()
            .enumerate()
            .skip((self.current_player_index + 1) as usize)
            .find(|(_, p)| p.status == PlayerStatus::Playing)
            .map(|(i, _)| i as i32);

        self.current_player_index = next.unwrap_or(-1);

        if self.current_player_index == -1 {
            self.phase = BlackjackPhase::Dealer;
            self.dealer_revealed = true;
        }
    }

    pub fn dealer_play(&mut self) {
        while Self::calculate_hand(&self.dealer_hand) < 17 {
            if let Some(card) = self.deck.pop() {
                self.dealer_hand.push(card);
            } else {
                break;
            }
        }
        self.phase = BlackjackPhase::Settlement;
    }

    pub fn settle(&mut self) {
        let dealer_total = Self::calculate_hand(&self.dealer_hand);
        let dealer_bust = Self::is_bust(&self.dealer_hand);
        let dealer_blackjack = Self::is_blackjack(&self.dealer_hand);

        for player in &mut self.players {
            if player.status == PlayerStatus::Bust {
                player.status = PlayerStatus::Lose;
                // Still evaluate split hand below if it exists
            } else {
                let player_total = Self::calculate_hand(&player.hand);
                let player_blackjack = Self::is_blackjack(&player.hand);

                if player_blackjack && !dealer_blackjack {
                    player.status = PlayerStatus::BlackjackWin;
                } else if dealer_bust || player_total > dealer_total {
                    player.status = PlayerStatus::Win;
                } else if player_total < dealer_total {
                    player.status = PlayerStatus::Lose;
                } else {
                    player.status = PlayerStatus::Push;
                }
            }

            // Evaluate split hand: if it wins, upgrade the main status
            // (split bet equals original bet, so a split win adds another bet's worth)
            if !player.split_hand.is_empty() {
                let split_total = Self::calculate_hand(&player.split_hand);
                let split_bust = Self::is_bust(&player.split_hand);
                if !split_bust {
                    if dealer_bust || split_total > dealer_total {
                        // Split hand wins — if main hand also won, upgrade to Win;
                        // if main hand lost, set to Push (net zero across both hands)
                        if player.status == PlayerStatus::Lose || player.status == PlayerStatus::Bust {
                            player.status = PlayerStatus::Push;
                        }
                        // If main hand already won, the split win adds extra payout
                        // which is handled by the wallet credit logic checking split_hand
                    } else if split_total < dealer_total {
                        // Split hand loses — if main hand won, downgrade to Push
                        if player.status == PlayerStatus::Win || player.status == PlayerStatus::BlackjackWin {
                            player.status = PlayerStatus::Push;
                        }
                    }
                    // split_total == dealer_total: push on split, no change to main status
                } else {
                    // Split hand busted — if main hand won, downgrade to Push
                    if player.status == PlayerStatus::Win || player.status == PlayerStatus::BlackjackWin {
                        player.status = PlayerStatus::Push;
                    }
                }
            }
        }

        self.phase = BlackjackPhase::Ended;
    }

    pub fn double_down(&mut self, peer_id: &str) -> Result<(), &'static str> {
        let player = self.players.iter_mut().find(|p| p.peer_id == peer_id)
            .ok_or("Player not found")?;
        if player.doubled_down { return Err("Already doubled down"); }
        if player.hand.len() != 2 { return Err("Can only double on initial two cards"); }
        player.doubled_down = true;
        player.bet *= 2; // Double the bet for payout calculation
        if let Some(card) = self.deck.pop() {
            player.hand.push(card);
        }
        // Check for bust after the dealt card
        if Self::is_bust(&player.hand) {
            player.status = PlayerStatus::Bust;
        } else {
            // Auto-stand after double down (standard Blackjack rule)
            player.status = PlayerStatus::Stand;
        }
        // Advance to next player
        self.advance_to_next_player();
        Ok(())
    }

    pub fn split(&mut self, peer_id: &str) -> Result<(), &'static str> {
        let player = self.players.iter_mut().find(|p| p.peer_id == peer_id)
            .ok_or("Player not found")?;
        if player.hand.len() != 2 { return Err("Can only split two cards"); }
        if player.hand[0].value != player.hand[1].value { return Err("Cards must be a pair to split"); }
        if !player.split_hand.is_empty() { return Err("Already split"); }
        let second = player.hand.remove(1);
        player.split_hand.push(second);
        // Deal one card to each hand
        if let Some(c) = self.deck.pop() { player.hand.push(c); }
        if let Some(c) = self.deck.pop() { player.split_hand.push(c); }
        Ok(())
    }

    pub fn buy_insurance(&mut self, peer_id: &str) -> Result<(), &'static str> {
        let player = self.players.iter_mut().find(|p| p.peer_id == peer_id)
            .ok_or("Player not found")?;
        if player.insurance_bet > 0 { return Err("Already have insurance"); }
        if player.bet == 0 { return Err("No bet placed"); }
        let ins = player.bet / 2;
        player.insurance_bet = ins;
        Ok(())
    }

    pub fn run_dealer_turn(&mut self) {
        self.dealer_play();
        self.settle();
    }

    pub fn is_player_turn(&self, peer_id: &str) -> bool {
        if self.phase != BlackjackPhase::Playing {
            return false;
        }
        self.players
            .iter()
            .enumerate()
            .find(|(_, p)| p.peer_id == peer_id)
            .map(|(i, _)| i as i32 == self.current_player_index)
            .unwrap_or(false)
    }

    /// Render ASCII card display
    pub fn render_card(card: &Card, hidden: bool) -> String {
        if hidden {
            "┌──┐\n│??│\n└──┘".to_string()
        } else {
            let sym = card.symbol();
            let display: String = sym.chars().take(2).collect();
            format!("┌──┐\n│{}│\n└──┘", display)
        }
    }

    /// Render game status for TUI
    pub fn render_status(&self, my_id: &str) -> Vec<String> {
        let mut lines = vec![
            "════════════════ BLACKJACK ════════════════".to_string(),
            String::new(),
        ];

        // Dealer hand
        let dealer_value = if self.dealer_revealed {
            format!("{}", Self::calculate_hand(&self.dealer_hand))
        } else if !self.dealer_hand.is_empty() {
            "?".to_string()
        } else {
            "-".to_string()
        };

        let dealer_cards: Vec<String> = self
            .dealer_hand
            .iter()
            .enumerate()
            .map(|(i, c)| {
                if i == 1 && !self.dealer_revealed {
                    "[??]".to_string()
                } else {
                    c.symbol()
                }
            })
            .collect();

        lines.push(format!(
            "Dealer: {} | {}",
            dealer_cards.join(" "),
            dealer_value
        ));
        lines.push(String::new());
        lines.push("──────────────────────────────────────────".to_string());
        lines.push(String::new());

        // Players
        for player in &self.players {
            let is_me = player.peer_id == my_id;
            let prefix = if is_me { "► " } else { "  " };
            let cards: Vec<String> = player.hand.iter().map(|c| c.symbol()).collect();
            let value = Self::calculate_hand(&player.hand);
            let me_marker = if is_me { " (You)" } else { "" };

            lines.push(format!(
                "{}{}{}: {} | ${} | {}{}",
                prefix,
                player.nick,
                me_marker,
                cards.join(" "),
                player.bet,
                value,
                if player.status != PlayerStatus::Playing
                    && player.status != PlayerStatus::Waiting
                    && player.status != PlayerStatus::Ready
                {
                    format!(" ({})", player.status.display())
                } else {
                    String::new()
                }
            ));
        }

        lines.push(String::new());

        // Phase info
        match &self.phase {
            BlackjackPhase::Betting => {
                lines.push("Phase: BETTING — /bj bet <amount> to place bet".to_string());
                lines.push("         /bj deal to start (need at least 1 bet)".to_string());
            }
            BlackjackPhase::Playing => {
                if let Some(current) = self.players.get(self.current_player_index as usize) {
                    if current.peer_id == my_id {
                        lines.push("Your turn! /bj hit or /bj stand".to_string());
                    } else {
                        lines.push(format!("Waiting for {}...", current.nick));
                    }
                }
            }
            BlackjackPhase::Dealer => {
                lines.push("Dealer is playing...".to_string());
            }
            BlackjackPhase::Ended => {
                lines.push("Round complete! /bj newround to play again".to_string());
            }
            _ => {}
        }

        lines.push("══════════════════════════════════════════".to_string());
        lines
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROULETTE ENGINE
// Wire prefix: RL:
// European roulette 0-36, single zero.
// ═══════════════════════════════════════════════════════════════════════════════

/// Red numbers in European roulette
pub const ROULETTE_RED: &[u8] = &[
    1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
];

pub fn roulette_is_red(n: u8) -> bool {
    ROULETTE_RED.contains(&n)
}

pub fn roulette_is_black(n: u8) -> bool {
    n > 0 && !roulette_is_red(n)
}

/// Roulette game phase
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RoulettePhase {
    Betting,
    Spinning,
    Ended,
}

/// A single roulette bet — player + bet type + wager
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouletteBet {
    pub peer_id: String,
    pub nick: String,
    pub bet_type: RouletteBetType,
    pub amount: u32,
}

/// All supported roulette bet types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RouletteBetType {
    Straight(u8), // single number 0-36, pays 35:1
    Red,
    Black,
    Odd,
    Even,
    Low,        // 1-18
    High,       // 19-36
    Dozen(u8),  // 1-3
    Column(u8), // 1-3
}

impl RouletteBetType {
    /// Returns the payout multiplier (total returned including stake) or 0 for a loss.
    pub fn payout_multiplier(&self, result: u8) -> u32 {
        match self {
            RouletteBetType::Straight(n) => {
                if *n == result {
                    36
                } else {
                    0
                }
            }
            RouletteBetType::Red => {
                if roulette_is_red(result) {
                    2
                } else {
                    0
                }
            }
            RouletteBetType::Black => {
                if roulette_is_black(result) {
                    2
                } else {
                    0
                }
            }
            RouletteBetType::Odd => {
                if result > 0 && !result.is_multiple_of(2) {
                    2
                } else {
                    0
                }
            }
            RouletteBetType::Even => {
                if result > 0 && result.is_multiple_of(2) {
                    2
                } else {
                    0
                }
            }
            RouletteBetType::Low => {
                if (1..=18).contains(&result) {
                    2
                } else {
                    0
                }
            }
            RouletteBetType::High => {
                if (19..=36).contains(&result) {
                    2
                } else {
                    0
                }
            }
            RouletteBetType::Dozen(d) => {
                if result == 0 {
                    return 0;
                }
                let hits = match d {
                    1 => (1..=12).contains(&result),
                    2 => (13..=24).contains(&result),
                    3 => (25..=36).contains(&result),
                    _ => false,
                };
                if hits { 3 } else { 0 }
            }
            RouletteBetType::Column(c) => {
                if result == 0 {
                    return 0;
                }
                let hits = match c {
                    1 => result % 3 == 1,
                    2 => result % 3 == 2,
                    3 => result.is_multiple_of(3),
                    _ => false,
                };
                if hits { 3 } else { 0 }
            }
        }
    }
}

/// Roulette network action (prefix RL:)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RouletteAction {
    Bet { bet: RouletteBet },
    Spin,
    State { state_json: String },
}

impl RouletteAction {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut data = b"RL:".to_vec();
        data.extend_from_slice(&serde_json::to_vec(self).unwrap_or_default());
        data
    }

    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        let s = std::str::from_utf8(data).ok()?;
        let json = s.strip_prefix("RL:")?;
        serde_json::from_str(json).ok()
    }

    pub fn is_roulette_message(data: &[u8]) -> bool {
        data.starts_with(b"RL:")
    }
}

/// Roulette game state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouletteEngine {
    pub room_id: String,
    pub phase: RoulettePhase,
    pub bets: Vec<RouletteBet>,
    pub result: Option<u8>,
    pub timestamp: u64,
}

impl RouletteEngine {
    pub fn new(room_id: String) -> Self {
        Self {
            room_id,
            phase: RoulettePhase::Betting,
            bets: Vec::new(),
            result: None,
            timestamp: Self::now_secs(),
        }
    }

    fn now_secs() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    /// Place or replace a bet for a player+type combination
    pub fn place_bet(&mut self, bet: RouletteBet) {
        // Remove existing bet of the same type from the same player
        self.bets
            .retain(|b| !(b.peer_id == bet.peer_id && b.bet_type == bet.bet_type));
        if self.bets.len() < 200 {
            self.bets.push(bet);
        }
    }

    /// Spin: generate a result 0-36 and compute net payouts per player
    pub fn spin(&mut self) -> HashMap<String, i64> {
        let result = rand::rng().random::<u8>() % 37;
        self.result = Some(result);
        self.phase = RoulettePhase::Spinning;
        self.timestamp = Self::now_secs();
        self.calculate_payouts(result)
    }

    /// Calculate net payouts for a given result
    pub fn calculate_payouts(&self, result: u8) -> HashMap<String, i64> {
        let mut payouts: HashMap<String, i64> = HashMap::new();
        for bet in &self.bets {
            let multiplier = bet.bet_type.payout_multiplier(result);
            let net = if multiplier > 0 {
                (bet.amount as i64) * (multiplier as i64 - 1)
            } else {
                -(bet.amount as i64)
            };
            *payouts.entry(bet.peer_id.clone()).or_insert(0) += net;
        }
        payouts
    }

    pub fn end_round(&mut self) {
        self.phase = RoulettePhase::Ended;
    }

    pub fn new_round(&mut self) {
        self.bets.clear();
        self.result = None;
        self.phase = RoulettePhase::Betting;
        self.timestamp = Self::now_secs();
    }

    /// Render a summary of the current state
    pub fn render_status(&self) -> Vec<String> {
        let mut lines = vec!["══════════════ ROULETTE ══════════════".to_string()];
        match &self.phase {
            RoulettePhase::Betting => {
                lines.push(format!(
                    "Phase: BETTING  |  Bets placed: {}",
                    self.bets.len()
                ));
                lines.push("  /roulette bet <type> <amount>".to_string());
                lines.push("  Types: red, black, odd, even, low, high".to_string());
                lines.push("         straight <0-36>, dozen <1-3>, column <1-3>".to_string());
                lines.push("  /roulette spin  — spin the wheel".to_string());
            }
            RoulettePhase::Spinning => {
                if let Some(n) = self.result {
                    let color = if n == 0 {
                        "green"
                    } else if roulette_is_red(n) {
                        "red"
                    } else {
                        "black"
                    };
                    lines.push(format!("RESULT: {} ({})", n, color));
                }
            }
            RoulettePhase::Ended => {
                if let Some(n) = self.result {
                    let color = if n == 0 {
                        "green"
                    } else if roulette_is_red(n) {
                        "red"
                    } else {
                        "black"
                    };
                    lines.push(format!("ENDED — result was: {} ({})", n, color));
                }
                lines.push("  /roulette spin  — new round".to_string());
            }
        }
        lines.push("══════════════════════════════════════".to_string());
        lines
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANDAR BAHAR ENGINE
// Wire prefix: AB:
// Classic Indian card game.
// ═══════════════════════════════════════════════════════════════════════════════

/// Andar Bahar phase
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AndarBaharPhase {
    Betting,
    Dealing,
    Ended,
}

/// Which side won
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AndarBaharSide {
    Andar,
    Bahar,
}

impl std::fmt::Display for AndarBaharSide {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AndarBaharSide::Andar => write!(f, "Andar"),
            AndarBaharSide::Bahar => write!(f, "Bahar"),
        }
    }
}

/// Side bet on how many cards are dealt before match
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AndarBaharCountRange {
    Cards1To5,   // 3.5x payout
    Cards6To10,  // 4.5x payout
    Cards11To15, // 5.5x payout
    Cards16To25, // 6.5x payout
    Cards26Plus, // 8.0x payout
}

impl AndarBaharCountRange {
    pub fn payout_multiplier(&self) -> f64 {
        match self {
            Self::Cards1To5 => 3.5,
            Self::Cards6To10 => 4.5,
            Self::Cards11To15 => 5.5,
            Self::Cards16To25 => 6.5,
            Self::Cards26Plus => 8.0,
        }
    }
    pub fn matches(&self, count: usize) -> bool {
        match self {
            Self::Cards1To5 => count <= 5,
            Self::Cards6To10 => (6..=10).contains(&count),
            Self::Cards11To15 => (11..=15).contains(&count),
            Self::Cards16To25 => (16..=25).contains(&count),
            Self::Cards26Plus => count >= 26,
        }
    }
    pub fn label(&self) -> &'static str {
        match self {
            Self::Cards1To5 => "1-5 cards (3.5x)",
            Self::Cards6To10 => "6-10 cards (4.5x)",
            Self::Cards11To15 => "11-15 cards (5.5x)",
            Self::Cards16To25 => "16-25 cards (6.5x)",
            Self::Cards26Plus => "26+ cards (8.0x)",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AndarBaharCountBet {
    pub range: AndarBaharCountRange,
    pub amount: u32,
}

/// A single Andar Bahar bet
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AndarBaharBet {
    pub peer_id: String,
    pub nick: String,
    pub side: AndarBaharSide,
    pub amount: u32,
    /// Optional side-bet on number of cards dealt (None = no side bet)
    pub count_side_bet: Option<AndarBaharCountBet>,
}

/// Andar Bahar network action
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AndarBaharAction {
    Bet { bet: AndarBaharBet },
    Deal,
    State { state_json: String },
}

impl AndarBaharAction {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut data = b"AB:".to_vec();
        data.extend_from_slice(&serde_json::to_vec(self).unwrap_or_default());
        data
    }

    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        let s = std::str::from_utf8(data).ok()?;
        let json = s.strip_prefix("AB:")?;
        serde_json::from_str(json).ok()
    }

    pub fn is_andarbahar_message(data: &[u8]) -> bool {
        data.starts_with(b"AB:")
    }
}

/// Andar Bahar game state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AndarBaharEngine {
    pub room_id: String,
    pub phase: AndarBaharPhase,
    pub joker: Option<Card>,
    pub andar: Vec<Card>,
    pub bahar: Vec<Card>,
    pub bets: Vec<AndarBaharBet>,
    pub result: Option<AndarBaharSide>,
    pub deck: Vec<Card>,
    /// Which side received the first dealt card (Bahar by tradition)
    pub trump_first: Option<AndarBaharSide>,
}

impl AndarBaharEngine {
    pub fn new(room_id: String) -> Self {
        Self {
            room_id,
            phase: AndarBaharPhase::Betting,
            joker: None,
            andar: Vec::new(),
            bahar: Vec::new(),
            bets: Vec::new(),
            result: None,
            deck: Self::make_deck(),
            trump_first: None,
        }
    }

    fn make_deck() -> Vec<Card> {
        let mut deck = Vec::new();
        for &suit in SUITS {
            for &value in VALUES {
                deck.push(Card::new(suit, value));
            }
        }
        use rand::seq::SliceRandom;
        deck.shuffle(&mut rand::rng());
        deck
    }

    /// Place or replace a side bet for a player
    pub fn place_bet(&mut self, bet: AndarBaharBet) {
        self.bets
            .retain(|b| !(b.peer_id == bet.peer_id && b.side == bet.side));
        if self.bets.len() < 200 {
            self.bets.push(bet);
        }
    }

    /// Deal the joker (trump) card — transitions to Dealing phase
    pub fn deal_joker(&mut self) {
        if self.phase != AndarBaharPhase::Betting {
            return;
        }
        if let Some(card) = self.deck.pop() {
            self.joker = Some(card);
            self.phase = AndarBaharPhase::Dealing;
        }
    }

    /// Deal one card, alternating Bahar then Andar.
    /// Returns true if the game ended.
    pub fn deal_next(&mut self) -> bool {
        if self.phase != AndarBaharPhase::Dealing {
            return false;
        }
        let joker_value = match &self.joker {
            Some(j) => j.value.clone(),
            None => return false,
        };

        let card = match self.deck.pop() {
            Some(c) => c,
            None => {
                self.phase = AndarBaharPhase::Ended;
                return true;
            }
        };

        // Bahar receives the first card (deal_count starts at 0)
        let total_dealt = self.andar.len() + self.bahar.len();
        let side = if total_dealt.is_multiple_of(2) {
            AndarBaharSide::Bahar
        } else {
            AndarBaharSide::Andar
        };

        // Record which side got the first card
        if self.trump_first.is_none() {
            self.trump_first = Some(side.clone());
        }

        let is_match = card.value == joker_value;
        match &side {
            AndarBaharSide::Andar => self.andar.push(card),
            AndarBaharSide::Bahar => self.bahar.push(card),
        }

        if is_match {
            self.result = Some(side);
            self.phase = AndarBaharPhase::Ended;
            return true;
        }

        false
    }

    /// Deal all remaining cards until a match is found
    pub fn deal_all(&mut self) {
        self.deal_joker();
        while self.phase == AndarBaharPhase::Dealing {
            if self.deal_next() {
                break;
            }
        }
    }

    /// Calculate net payouts for all bets
    pub fn calculate_payouts(&self) -> HashMap<String, i64> {
        let mut payouts: HashMap<String, i64> = HashMap::new();
        let winning_side = match &self.result {
            Some(s) => s,
            None => return payouts,
        };
        let trump_first_is_bahar = matches!(&self.trump_first, Some(AndarBaharSide::Bahar));
        let total_cards = self.andar.len() + self.bahar.len();

        for bet in &self.bets {
            let net: i64 = if bet.side == *winning_side {
                // Andar pays 0.9:1 when trump appeared first on Bahar side (standard rule)
                let multiplier =
                    if matches!(winning_side, AndarBaharSide::Andar) && trump_first_is_bahar {
                        0.9_f64
                    } else {
                        1.0_f64
                    };
                (bet.amount as f64 * multiplier) as i64
            } else {
                -(bet.amount as i64)
            };
            *payouts.entry(bet.peer_id.clone()).or_insert(0) += net;

            // Count side bet payout
            if let Some(csb) = &bet.count_side_bet {
                let side_net: i64 = if csb.range.matches(total_cards) {
                    (csb.amount as f64 * csb.range.payout_multiplier()) as i64
                } else {
                    -(csb.amount as i64)
                };
                *payouts.entry(bet.peer_id.clone()).or_insert(0) += side_net;
            }
        }
        payouts
    }

    pub fn new_round(&mut self) {
        // Reuse deck if enough cards remain
        if self.deck.len() < 10 {
            self.deck = Self::make_deck();
        }
        self.joker = None;
        self.andar.clear();
        self.bahar.clear();
        self.bets.clear();
        self.result = None;
        self.trump_first = None;
        self.phase = AndarBaharPhase::Betting;
    }

    pub fn render_status(&self) -> Vec<String> {
        let mut lines = vec!["══════════════ ANDAR BAHAR ═══════════════".to_string()];
        if let Some(j) = &self.joker {
            lines.push(format!("Joker: {}", j.symbol()));
        }
        lines.push(format!(
            "Andar: {}  |  Bahar: {}",
            self.andar
                .iter()
                .map(|c| c.symbol())
                .collect::<Vec<_>>()
                .join(" "),
            self.bahar
                .iter()
                .map(|c| c.symbol())
                .collect::<Vec<_>>()
                .join(" "),
        ));
        match &self.phase {
            AndarBaharPhase::Betting => {
                lines.push(format!("Phase: BETTING  |  Bets: {}", self.bets.len()));
                lines.push("  /ab andar <amount>  — bet on Andar".to_string());
                lines.push("  /ab bahar <amount>  — bet on Bahar".to_string());
                lines.push("  /ab deal            — deal cards (host)".to_string());
            }
            AndarBaharPhase::Dealing => {
                lines.push(format!(
                    "Phase: DEALING  |  Cards dealt: {}",
                    self.andar.len() + self.bahar.len()
                ));
            }
            AndarBaharPhase::Ended => {
                if let Some(winner) = &self.result {
                    lines.push(format!("RESULT: {} wins!", winner));
                }
                lines.push(format!(
                    "Total cards dealt: {}",
                    self.andar.len() + self.bahar.len()
                ));
                lines.push("  /ab deal  — new round".to_string());
            }
        }
        lines.push("══════════════════════════════════════════".to_string());
        lines
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLOTS ENGINE
// Wire prefix: SL:
// 3-reel weighted slot machine.
// Weights: Cherry 30, Lemon 25, Orange 20, Plum 12, Bell 8, Bar 3, Seven 1.5, Diamond 0.5
// ═══════════════════════════════════════════════════════════════════════════════

/// Slot machine symbols
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SlotSymbol {
    Cherry,
    Lemon,
    Orange,
    Plum,
    Bell,
    Bar,
    Seven,
    Diamond,
}

impl SlotSymbol {
    pub fn display(&self) -> &'static str {
        match self {
            SlotSymbol::Cherry => "Cherry",
            SlotSymbol::Lemon => "Lemon",
            SlotSymbol::Orange => "Orange",
            SlotSymbol::Plum => "Plum",
            SlotSymbol::Bell => "Bell",
            SlotSymbol::Bar => "Bar",
            SlotSymbol::Seven => "Seven",
            SlotSymbol::Diamond => "Diamond",
        }
    }

    pub fn icon(&self) -> &'static str {
        match self {
            SlotSymbol::Cherry => "[CHR]",
            SlotSymbol::Lemon => "[LEM]",
            SlotSymbol::Orange => "[ORG]",
            SlotSymbol::Plum => "[PLM]",
            SlotSymbol::Bell => "[BEL]",
            SlotSymbol::Bar => "[BAR]",
            SlotSymbol::Seven => "[ 7 ]",
            SlotSymbol::Diamond => "[DIA]",
        }
    }

    /// Weighted random spin. Weights sum to 1000 to allow half-percent precision.
    pub fn spin() -> Self {
        // Weights × 10 for integer precision: 300, 250, 200, 120, 80, 30, 15, 5 → total 1000
        let r = rand::rng().random::<u32>() % 1000;
        if r < 300 {
            SlotSymbol::Cherry
        } else if r < 550 {
            SlotSymbol::Lemon
        } else if r < 750 {
            SlotSymbol::Orange
        } else if r < 870 {
            SlotSymbol::Plum
        } else if r < 950 {
            SlotSymbol::Bell
        } else if r < 980 {
            SlotSymbol::Bar
        } else if r < 995 {
            SlotSymbol::Seven
        } else {
            SlotSymbol::Diamond
        }
    }

    /// Payout multiplier for three matching reels (total return including stake).
    pub fn triple_multiplier(&self) -> u32 {
        match self {
            SlotSymbol::Cherry => 2,
            SlotSymbol::Lemon => 3,
            SlotSymbol::Orange => 4,
            SlotSymbol::Plum => 5,
            SlotSymbol::Bell => 10,
            SlotSymbol::Bar => 20,
            SlotSymbol::Seven => 50,
            SlotSymbol::Diamond => 100,
        }
    }
}

/// Slots network action
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SlotsAction {
    Spin {
        peer_id: String,
        nick: String,
        amount: u32,
    },
    Result {
        reels: [SlotSymbol; 3],
        payout: i64,
    },
}

impl SlotsAction {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut data = b"SL:".to_vec();
        data.extend_from_slice(&serde_json::to_vec(self).unwrap_or_default());
        data
    }

    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        let s = std::str::from_utf8(data).ok()?;
        let json = s.strip_prefix("SL:")?;
        serde_json::from_str(json).ok()
    }

    pub fn is_slots_message(data: &[u8]) -> bool {
        data.starts_with(b"SL:")
    }
}

/// Slots game state (per-player, single-player machine)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlotsEngine {
    pub room_id: String,
    pub reels: [SlotSymbol; 3],
    pub last_bet: u32,
    pub last_payout: i64,
}

impl SlotsEngine {
    pub fn new(room_id: String) -> Self {
        Self {
            room_id,
            reels: [SlotSymbol::Cherry, SlotSymbol::Cherry, SlotSymbol::Cherry],
            last_bet: 0,
            last_payout: 0,
        }
    }

    /// Spin the reels with a given bet and return the net payout.
    pub fn spin(&mut self, bet: u32) -> i64 {
        self.last_bet = bet;
        self.reels = [SlotSymbol::spin(), SlotSymbol::spin(), SlotSymbol::spin()];
        let payout = Self::calculate_payout(&self.reels, bet);
        self.last_payout = payout;
        payout
    }

    /// Calculate net payout for a reel combination.
    /// Returns positive for wins, negative for losses.
    pub fn calculate_payout(reels: &[SlotSymbol; 3], bet: u32) -> i64 {
        if reels[0] == reels[1] && reels[1] == reels[2] {
            // Triple match
            let multiplier = reels[0].triple_multiplier();
            (bet as i64) * (multiplier as i64 - 1)
        } else if reels[0] == SlotSymbol::Cherry && reels[1] == SlotSymbol::Cherry {
            // Two cherries (any third symbol) — 2x stake back (net +1x)
            bet as i64
        } else {
            -(bet as i64)
        }
    }

    pub fn render_result(&self) -> Vec<String> {
        let reels_str = format!(
            "{} {} {}",
            self.reels[0].icon(),
            self.reels[1].icon(),
            self.reels[2].icon()
        );
        let outcome = if self.last_payout > 0 {
            format!("WIN! +{}", self.last_payout)
        } else if self.last_payout == 0 {
            "PUSH".to_string()
        } else {
            format!("LOSE  {}", self.last_payout)
        };
        vec![
            "══════════ SLOTS ══════════".to_string(),
            format!("  {}", reels_str),
            format!("  Bet: {}  |  {}", self.last_bet, outcome),
            "  /slots spin <amount>".to_string(),
            "══════════════════════════".to_string(),
        ]
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIRTUAL WALLET
// Persists to ~/.openwire/wallet.json
// Daily refresh of 1000 chips at UTC midnight.
// ═══════════════════════════════════════════════════════════════════════════════

/// Chip wallet for casino games
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Wallet {
    pub balance: u32,
    /// Unix day (seconds / 86400) of last refresh
    pub daily_refresh: u64,
}

impl Wallet {
    pub const DAILY_CHIPS: u32 = 1000;

    fn wallet_path() -> std::path::PathBuf {
        let home = dirs_next::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
        home.join(".openwire").join("wallet.json")
    }

    pub fn load() -> Self {
        let path = Self::wallet_path();
        if let Ok(data) = std::fs::read_to_string(&path)
            && let Ok(w) = serde_json::from_str::<Wallet>(&data)
        {
            return w;
        }
        // First run: grant starting chips
        let w = Wallet {
            balance: Self::DAILY_CHIPS,
            daily_refresh: Self::today_day(),
        };
        w.save();
        w
    }

    pub fn save(&self) {
        let path = Self::wallet_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(&path, json);
        }
    }

    fn today_day() -> u64 {
        (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            + 19800) // UTC+5:30 (IST)
            / 86400
    }

    pub fn refresh_if_needed(&mut self) {
        let today = Self::today_day();
        if today > self.daily_refresh {
            self.balance += Self::DAILY_CHIPS;
            self.daily_refresh = today;
            self.save();
        }
    }

    pub fn debit(&mut self, amount: u32) -> Result<(), &'static str> {
        if amount == 0 {
            return Err("Bet must be greater than zero");
        }
        if self.balance < amount {
            return Err("Insufficient chips");
        }
        self.balance -= amount;
        self.save();
        Ok(())
    }

    pub fn credit(&mut self, amount: u32) {
        self.balance = self.balance.saturating_add(amount);
        self.save();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CASINO STATE — LWW CRDT
// Wire prefix: CS:
// Tracks house P&L per game type.
// Merge rule: higher timestamp wins per key.
// ═══════════════════════════════════════════════════════════════════════════════

/// House P&L tracker using LWW (last-write-wins) CRDT semantics
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CasinoState {
    /// game_type -> net P&L (positive = house profit)
    pub house_pnl: HashMap<String, i64>,
    pub last_updated: u64,
}

impl CasinoState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a payout event. Positive net = player won (house lost).
    pub fn record_payout(&mut self, game_type: &str, player_net: i64) {
        *self.house_pnl.entry(game_type.to_string()).or_insert(0) -= player_net;
        self.last_updated = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
    }

    /// Serialize for wire transmission
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut data = b"CS:".to_vec();
        data.extend_from_slice(&serde_json::to_vec(self).unwrap_or_default());
        data
    }

    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        let s = std::str::from_utf8(data).ok()?;
        let json = s.strip_prefix("CS:")?;
        serde_json::from_str(json).ok()
    }

    pub fn is_casino_state_message(data: &[u8]) -> bool {
        data.starts_with(b"CS:")
    }

    /// LWW merge: for each key, keep whichever state has the higher timestamp.
    pub fn merge(&mut self, other: &CasinoState) {
        if other.last_updated > self.last_updated {
            for (game, pnl) in &other.house_pnl {
                self.house_pnl.insert(game.clone(), *pnl);
            }
            self.last_updated = other.last_updated;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTION LEDGER
// Persists to ~/.openwire/history.json
// Tracks wins/losses per game session (last 500 entries).
// ═══════════════════════════════════════════════════════════════════════════════

/// A single game transaction
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub timestamp: u64,
    pub game: String,
    pub amount: i64,  // positive = win, negative = loss
    pub balance_after: u32,
}

/// Persistent transaction ledger
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TransactionLedger {
    pub entries: Vec<Transaction>,
}

impl TransactionLedger {
    fn ledger_path() -> std::path::PathBuf {
        let home = dirs_next::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
        home.join(".openwire").join("history.json")
    }

    pub fn load() -> Self {
        let path = Self::ledger_path();
        if let Ok(data) = std::fs::read_to_string(&path)
            && let Ok(l) = serde_json::from_str::<TransactionLedger>(&data)
        {
            return l;
        }
        Self::default()
    }

    pub fn save(&self) {
        let path = Self::ledger_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(&path, json);
        }
    }

    pub fn record(&mut self, game: &str, amount: i64, balance_after: u32) {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        self.entries.push(Transaction {
            timestamp: ts,
            game: game.to_string(),
            amount,
            balance_after,
        });
        // Keep last 500 entries
        if self.entries.len() > 500 {
            self.entries.drain(0..self.entries.len() - 500);
        }
        self.save();
    }

    pub fn recent(&self, n: usize) -> &[Transaction] {
        let len = self.entries.len();
        if len <= n { &self.entries } else { &self.entries[len - n..] }
    }
}
