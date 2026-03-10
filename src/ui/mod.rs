//! Terminal User Interface for OpenWire
//!
//! Uses Ratatui + Crossterm to provide a rich terminal-based messaging experience
//! with a 3-pane layout: messages, peers, and input.

use anyhow::Result;
pub mod game_ui;

use crossterm::{
    event::{self, EnableMouseCapture, DisableMouseCapture, Event, KeyCode, KeyModifiers},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use ratatui::{
    Terminal,
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{
        Block, Borders, List, ListItem, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState,
        Wrap,
    },
};
use std::io;
use tokio::sync::mpsc;

use crate::game::{
    AndarBaharAction, AndarBaharBet, AndarBaharCountRange, AndarBaharEngine, AndarBaharSide,
    Blackjack, BlackjackAction, BlackjackPhase, CasinoState, GameAction, RouletteAction, RouletteBet,
    RouletteBetType, RouletteEngine, SlotsEngine, TicTacToe, TransactionLedger, Wallet,
};
use crate::network::{NetworkCommand, NetworkEvent};

/// A chat message for display
#[derive(Clone)]
pub struct ChatMessage {
    pub time: String,
    pub sender: String,
    pub content: String,
    pub is_system: bool,
    pub is_file: bool,
}

/// UI State management
pub struct UiState {
    /// Current input buffer
    pub input: String,
    /// Cursor position in input
    pub cursor_pos: usize,
    /// Chat messages
    pub messages: Vec<ChatMessage>,
    /// Connected peer IDs
    pub peers: Vec<String>,
    /// Joined rooms (room_id, room_name)
    pub rooms: Vec<(String, String)>,
    /// Pending invites (room_id, room_name, inviter_short_id) - for future use
    #[allow(dead_code)]
    pub invited_rooms: Vec<(String, String, String)>,
    /// Local nickname
    pub nick: String,
    /// Local peer ID (short form)
    pub local_peer_id: String,
    /// Scroll offset for messages (0 = show newest)
    pub scroll_offset: usize,
    /// Auto-scroll to bottom when new messages arrive
    pub auto_scroll: bool,
    /// Active tic-tac-toe game (room_id -> game)
    pub active_game: Option<TicTacToe>,
    /// Active blackjack game
    pub blackjack_game: Option<Blackjack>,
    /// Active roulette game
    pub roulette_game: Option<RouletteEngine>,
    /// Active Andar Bahar game
    pub andarbahar_game: Option<AndarBaharEngine>,
    /// Active slots engine
    pub slots_engine: Option<SlotsEngine>,
    /// Player chip wallet
    pub wallet: Wallet,
    /// Casino house P&L tracker
    pub casino_state: CasinoState,
    /// Peers currently typing: (peer_short_id -> last_typing_time)
    pub typing_peers: std::collections::HashMap<String, std::time::Instant>,
    /// Path to persist chat history
    pub message_history_path: std::path::PathBuf,
    /// Game overlay state (visual game UI on top of chat)
    pub game_overlay: game_ui::GameOverlay,
}

impl UiState {
    pub fn new(nick: String, local_peer_id: String, web_port: Option<u16>, relay: bool) -> Self {
        let mut state = Self {
            input: String::new(),
            cursor_pos: 0,
            messages: Vec::new(),
            peers: Vec::new(),
            rooms: Vec::new(),
            invited_rooms: Vec::new(),
            nick,
            local_peer_id,
            scroll_offset: 0,
            auto_scroll: true,
            active_game: None,
            blackjack_game: None,
            roulette_game: None,
            andarbahar_game: None,
            slots_engine: None,
            wallet: Wallet::load(),
            casino_state: CasinoState::new(),
            typing_peers: std::collections::HashMap::new(),
            message_history_path: dirs_next::home_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join(".openwire")
                .join("chat_history.json"),
            game_overlay: game_ui::GameOverlay::new(),
        };
        state.add_system_message("Welcome to OpenWire! End-to-end encrypted P2P messenger.");
        state.add_system_message("Peers on the same LAN are discovered automatically via mDNS.");
        state.add_system_message("Type a message and press Enter to chat. /help for commands.");
        if let Some(port) = web_port {
            state.add_system_message(&format!(
                "🌐 Web bridge active → open http://localhost:{port} in a browser, or point the openwire-web app at ws://localhost:{port}/ws"
            ));
        }
        if relay {
            state.add_system_message(
                "☁ Relay bridge active → you are visible to openwire-web users on Vercel",
            );
        }
        state
    }

    pub fn add_system_message(&mut self, msg: &str) {
        self.messages.push(ChatMessage {
            time: Self::now(),
            sender: "★".to_string(),
            content: msg.to_string(),
            is_system: true,
            is_file: false,
        });
        // Reset scroll to bottom if auto-scroll is enabled
        if self.auto_scroll {
            self.scroll_offset = 0;
        }
    }

    pub fn add_chat_message(&mut self, sender: &str, content: &str) {
        self.messages.push(ChatMessage {
            time: Self::now(),
            sender: sender.to_string(),
            content: content.to_string(),
            is_system: false,
            is_file: false,
        });
        // Reset scroll to bottom if auto-scroll is enabled
        if self.auto_scroll {
            self.scroll_offset = 0;
        }
        if self.messages.len() % 10 == 0 {
            self.save_message_history();
        }
    }

    fn save_message_history(&self) {
        let filtered: Vec<_> = self.messages.iter().filter(|m| !m.is_system).collect();
        let start = filtered.len().saturating_sub(200);
        let to_save: Vec<serde_json::Value> = filtered[start..]
            .iter()
            .map(|m| {
                serde_json::json!({
                    "time": m.time,
                    "sender": m.sender,
                    "content": m.content,
                })
            })
            .collect();
        if let Ok(json) = serde_json::to_string_pretty(&to_save) {
            if let Some(parent) = self.message_history_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(&self.message_history_path, json);
        }
    }

    pub fn add_file_message(&mut self, sender: &str, filename: &str) {
        self.messages.push(ChatMessage {
            time: Self::now(),
            sender: sender.to_string(),
            content: format!("📎 File: {}", filename),
            is_system: false,
            is_file: true,
        });
        // Reset scroll to bottom if auto-scroll is enabled
        if self.auto_scroll {
            self.scroll_offset = 0;
        }
    }

    fn now() -> String {
        chrono::Local::now().format("%H:%M").to_string()
    }
}

/// The UI Application
pub struct UiApp {
    terminal: Terminal<CrosstermBackend<io::Stdout>>,
    state: UiState,
    command_sender: mpsc::Sender<NetworkCommand>,
    event_receiver: mpsc::Receiver<NetworkEvent>,
    /// Throttle typing broadcasts to once per 2 seconds
    last_typing_broadcast: std::time::Instant,
}

impl UiApp {
    pub fn new(
        nick: String,
        local_peer_id: String,
        command_sender: mpsc::Sender<NetworkCommand>,
        event_receiver: mpsc::Receiver<NetworkEvent>,
        web_port: Option<u16>,
        relay: bool,
    ) -> Result<Self> {
        enable_raw_mode()?;
        let mut stdout = io::stdout();
        execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
        let backend = CrosstermBackend::new(stdout);
        let terminal = Terminal::new(backend)?;

        Ok(Self {
            terminal,
            state: UiState::new(nick, local_peer_id, web_port, relay),
            command_sender,
            event_receiver,
            last_typing_broadcast: std::time::Instant::now()
                - std::time::Duration::from_secs(10),
        })
    }

    /// Run the UI event loop
    pub async fn run(&mut self) -> Result<()> {
        loop {
            self.render()?;

            // Process any pending network events (non-blocking)
            while let Ok(event) = self.event_receiver.try_recv() {
                self.handle_network_event(event);
            }

            // Poll for input events with a small timeout
            if event::poll(std::time::Duration::from_millis(50))? {
                let ev = event::read()?;

                // ── Mouse events (game overlay buttons) ─────────────────
                if let Event::Mouse(mouse) = &ev {
                    if self.state.game_overlay.visible {
                        if let Some(action_key) = game_ui::handle_game_mouse(*mouse, &self.state.game_overlay) {
                            self.handle_overlay_action_key(action_key).await;
                        }
                    }
                    continue; // don't fall through to key handling
                }

                // ── Key events ──────────────────────────────────────────
                if let Event::Key(key) = ev {
                    // Ctrl+C always quits
                    if key.code == KeyCode::Char('c') && key.modifiers == KeyModifiers::CONTROL {
                        let _ = self.command_sender.send(NetworkCommand::Shutdown).await;
                        break;
                    }

                    // If game overlay is visible, route keys there first
                    if self.state.game_overlay.visible {
                        let result = game_ui::handle_game_key(key, &mut self.state.game_overlay);
                        match result {
                            game_ui::GameKeyResult::ExitOverlay => {
                                self.state.game_overlay.visible = false;
                            }
                            game_ui::GameKeyResult::Consumed => {
                                // Dispatch the game action based on key
                                if let KeyCode::Char(c) = key.code {
                                    self.handle_overlay_action_key(c).await;
                                } else if key.code == KeyCode::Enter && !self.state.game_overlay.bet_input.is_empty() {
                                    self.handle_overlay_bet_confirm().await;
                                }
                            }
                            game_ui::GameKeyResult::BroadcastAction(_data) => {}
                            game_ui::GameKeyResult::Ignored => {
                                // Fall through to normal key handling below
                                self.handle_normal_key(key).await;
                            }
                        }
                        continue;
                    }

                    // Normal (non-overlay) key handling
                    if self.handle_normal_key(key).await {
                        break;
                    }
                }
            }
        }

        Ok(())
    }

    /// Handle a normal (non-overlay) key event. Returns true if should quit.
    async fn handle_normal_key(&mut self, key: crossterm::event::KeyEvent) -> bool {
        match (key.code, key.modifiers) {
            (KeyCode::Esc, _) => {
                let _ = self.command_sender.send(NetworkCommand::Shutdown).await;
                return true;
            }
            (KeyCode::Enter, _) => {
                return self.handle_submit().await;
            }
            (KeyCode::Char(c), _) => {
                self.state.input.insert(self.state.cursor_pos, c);
                self.state.cursor_pos += 1;
                // Throttled typing indicator broadcast
                let now = std::time::Instant::now();
                if now.duration_since(self.last_typing_broadcast)
                    > std::time::Duration::from_secs(2)
                {
                    self.last_typing_broadcast = now;
                    let typing_msg = format!("TYPING:{}", self.state.nick);
                    let nick = self.state.nick.clone();
                    let _ = self
                        .command_sender
                        .send(NetworkCommand::Broadcast {
                            data: typing_msg.into_bytes(),
                            nick,
                        })
                        .await;
                }
            }
            (KeyCode::Backspace, _) => {
                if self.state.cursor_pos > 0 {
                    self.state.cursor_pos -= 1;
                    self.state.input.remove(self.state.cursor_pos);
                }
            }
            (KeyCode::Delete, _) => {
                if self.state.cursor_pos < self.state.input.len() {
                    self.state.input.remove(self.state.cursor_pos);
                }
            }
            (KeyCode::Left, _) => {
                if self.state.cursor_pos > 0 {
                    self.state.cursor_pos -= 1;
                }
            }
            (KeyCode::Right, _) => {
                if self.state.cursor_pos < self.state.input.len() {
                    self.state.cursor_pos += 1;
                }
            }
            (KeyCode::Home, _) => {
                self.state.cursor_pos = 0;
            }
            (KeyCode::End, _) => {
                self.state.cursor_pos = self.state.input.len();
            }
            (KeyCode::Up, _) => {
                self.state.auto_scroll = false;
                let max_scroll = self.state.messages.len().saturating_sub(1);
                if self.state.scroll_offset < max_scroll {
                    self.state.scroll_offset += 1;
                }
            }
            (KeyCode::Down, _) => {
                if self.state.scroll_offset > 0 {
                    self.state.scroll_offset -= 1;
                }
                if self.state.scroll_offset == 0 {
                    self.state.auto_scroll = true;
                }
            }
            (KeyCode::PageUp, _) => {
                self.state.auto_scroll = false;
                let max_scroll = self.state.messages.len().saturating_sub(1);
                self.state.scroll_offset = (self.state.scroll_offset + 10).min(max_scroll);
            }
            (KeyCode::PageDown, _) => {
                self.state.scroll_offset = self.state.scroll_offset.saturating_sub(10);
                if self.state.scroll_offset == 0 {
                    self.state.auto_scroll = true;
                }
            }
            _ => {}
        }
        false
    }

    /// Handle an overlay action key (from keyboard shortcut or mouse click)
    async fn handle_overlay_action_key(&mut self, c: char) {
        match &self.state.game_overlay.view {
            game_ui::ActiveGameView::Blackjack => match c {
                'h' => self.handle_blackjack_command("/bj hit").await,
                's' => self.handle_blackjack_command("/bj stand").await,
                'd' if !self.state.game_overlay.entering_bet => {
                    if self.state.blackjack_game.as_ref().map(|g| &g.phase) == Some(&BlackjackPhase::Betting) {
                        self.handle_blackjack_command("/bj deal").await;
                    } else {
                        self.handle_blackjack_command("/bj double").await;
                    }
                }
                'p' => self.handle_blackjack_command("/bj split").await,
                'i' => self.handle_blackjack_command("/bj insurance").await,
                'n' => self.handle_blackjack_command("/bj newround").await,
                'b' => { /* entering_bet mode activated by handle_game_key */ }
                _ => {}
            },
            game_ui::ActiveGameView::Roulette => match c {
                ' ' => self.handle_roulette_command("/roulette spin").await,
                _ => { /* bet entry handled separately */ }
            },
            game_ui::ActiveGameView::Slots => match c {
                ' ' => self.handle_slots_command("/slots spin 10").await,
                '1' => self.handle_slots_command("/slots spin 10").await,
                '2' => self.handle_slots_command("/slots spin 25").await,
                '3' => self.handle_slots_command("/slots spin 50").await,
                '4' => self.handle_slots_command("/slots spin 100").await,
                '5' => self.handle_slots_command("/slots spin 500").await,
                _ => {}
            },
            game_ui::ActiveGameView::TicTacToe => match c {
                '1'..='9' => {
                    let pos = c.to_string();
                    self.handle_game_move(&pos).await;
                }
                'r' => {
                    // Rematch
                    if let Some(ref game) = self.state.active_game {
                        let room_id = game.room_id.clone();
                        let mut new_game = game.clone();
                        new_game.new_round();
                        self.state.active_game = Some(new_game);
                        // Broadcast challenge for rematch
                        let action = GameAction::Challenge {
                            challenger: self.state.local_peer_id.clone(),
                            challenger_nick: self.state.nick.clone(),
                            room_id,
                        };
                        let _ = self
                            .command_sender
                            .send(NetworkCommand::SendRoomMessage {
                                room_id: self.state.active_game.as_ref().unwrap().room_id.clone(),
                                data: action.to_bytes(),
                            })
                            .await;
                    }
                }
                _ => {}
            },
            game_ui::ActiveGameView::AndarBahar => match c {
                'd' => self.handle_andarbahar_command("/ab deal").await,
                _ => { /* bet entry handled separately */ }
            },
            game_ui::ActiveGameView::None => {}
        }
    }

    /// Handle bet confirmation after entering digits in the overlay
    async fn handle_overlay_bet_confirm(&mut self) {
        let amount_str = self.state.game_overlay.bet_input.clone();
        if amount_str.is_empty() {
            return;
        }
        match &self.state.game_overlay.view {
            game_ui::ActiveGameView::Blackjack => {
                let cmd = format!("/bj bet {}", amount_str);
                self.handle_blackjack_command(&cmd).await;
            }
            game_ui::ActiveGameView::Roulette => {
                // For roulette, bet type was stored when user pressed r/k/o/e/#
                // Default to red if unclear
                let cmd = format!("/roulette bet red {}", amount_str);
                self.handle_roulette_command(&cmd).await;
            }
            game_ui::ActiveGameView::AndarBahar => {
                // Default to andar
                let cmd = format!("/ab bet andar {}", amount_str);
                self.handle_andarbahar_command(&cmd).await;
            }
            _ => {}
        }
        self.state.game_overlay.bet_input.clear();
    }

    /// Handle submit (Enter key). Returns true if should quit.
    async fn handle_submit(&mut self) -> bool {
        let input = self.state.input.trim().to_string();
        if input.is_empty() {
            return false;
        }

        self.state.input.clear();
        self.state.cursor_pos = 0;

        if let Some(path) = input.strip_prefix("/send ") {
            // File transfer command
            let path = path.trim();
            if path.is_empty() {
                self.state.add_system_message("Usage: /send <file_path>");
                return false;
            }
            self.state
                .add_system_message(&format!("Sending file: {}", path));
            let _ = self
                .command_sender
                .send(NetworkCommand::SendFile {
                    path: path.to_string(),
                })
                .await;
            false
        } else if input == "/quit" || input == "/q" {
            let _ = self.command_sender.send(NetworkCommand::Shutdown).await;
            true
        } else if let Some(addr) = input.strip_prefix("/connect ") {
            let addr = addr.trim();
            if addr.is_empty() {
                self.state
                    .add_system_message("Usage: /connect <multiaddress>");
                return false;
            }
            self.state
                .add_system_message(&format!("Connecting to {}", addr));
            let _ = self
                .command_sender
                .send(NetworkCommand::Connect(addr.to_string()))
                .await;
            false
        } else if input == "/help" {
            self.state
                .add_system_message("═══════════════════════════════════════════");
            self.state
                .add_system_message("               OPENWIRE HELP               ");
            self.state
                .add_system_message("═══════════════════════════════════════════");
            self.state.add_system_message("");
            self.state.add_system_message("MESSAGING COMMANDS:");
            self.state
                .add_system_message("  /send <file>     - Send a file to peers");
            self.state
                .add_system_message("  /image <file>    - Send an image to peers");
            self.state
                .add_system_message("  /gif <search>    - Search and send GIF");
            self.state
                .add_system_message("  /connect <addr>  - Connect to peer by address");
            self.state
                .add_system_message("  /quit or /q      - Exit the application");
            self.state.add_system_message("");
            self.state.add_system_message("PRIVATE ROOMS:");
            self.state
                .add_system_message("  /room create <name>         - Create room");
            self.state
                .add_system_message("  /room invite <peer> <room>  - Invite peer");
            self.state
                .add_system_message("  /room join <room_id>        - Join room");
            self.state
                .add_system_message("  /room list                  - List rooms");
            self.state
                .add_system_message("  /room leave <room>          - Leave room");
            self.state.add_system_message("");
            self.state.add_system_message("GAMES:");
            self.state
                .add_system_message("  /game tictactoe <room_id>   - Start a game");
            self.state
                .add_system_message("  /game rematch               - Play again");
            self.state
                .add_system_message("  /move <1-9>                 - Make a move");
            self.state.add_system_message("");
            self.state.add_system_message("BLACKJACK:");
            self.state
                .add_system_message("  /blackjack                  - Start game in first room");
            self.state
                .add_system_message("  /bj bet <amount>            - Place your bet");
            self.state
                .add_system_message("  /bj deal                    - Deal cards (host only)");
            self.state
                .add_system_message("  /bj hit                     - Take a card");
            self.state
                .add_system_message("  /bj stand                   - End your turn");
            self.state
                .add_system_message("  /bj newround                - Start new round");
            self.state.add_system_message("");
            self.state.add_system_message("ROULETTE:");
            self.state
                .add_system_message("  /roulette                   - Show roulette table");
            self.state
                .add_system_message("  /roulette bet <type> <amt>  - Place bet");
            self.state
                .add_system_message("  /roulette spin              - Spin the wheel");
            self.state.add_system_message("");
            self.state.add_system_message("ANDAR BAHAR:");
            self.state
                .add_system_message("  /ab andar <amount>          - Bet on Andar");
            self.state
                .add_system_message("  /ab bahar <amount>          - Bet on Bahar");
            self.state
                .add_system_message("  /ab deal                    - Deal cards");
            self.state.add_system_message("");
            self.state.add_system_message("SLOTS:");
            self.state
                .add_system_message("  /slots spin <amount>        - Spin the reels");
            self.state.add_system_message("");
            self.state.add_system_message("WALLET:");
            self.state
                .add_system_message("  /wallet  or  /chips         - Show chip balance");
            self.state.add_system_message("");
            self.state.add_system_message("HELP:");
            self.state
                .add_system_message("  /rules <game>  - Show how to play a game");
            self.state
                .add_system_message("  /history       - Show recent game history");
            self.state
                .add_system_message("  /whisper <id> <msg>  - Send private message");
            self.state.add_system_message("");
            self.state.add_system_message("MESSAGE SCROLLING:");
            self.state
                .add_system_message("  Up / Down        - Scroll one line");
            self.state
                .add_system_message("  PageUp/PageDown  - Scroll ten lines");
            self.state.add_system_message("");
            self.state.add_system_message("NETWORK INFO:");
            self.state
                .add_system_message("  LAN peers discovered via mDNS automatically");
            self.state
                .add_system_message("  Remote peers: share your multiaddress");
            false
        } else if let Some(path) = input.strip_prefix("/image ") {
            // Image transfer command
            let path = path.trim();
            if path.is_empty() {
                self.state.add_system_message("Usage: /image <file_path>");
                return false;
            }
            // Images are sent as files with a marker
            self.state
                .add_system_message(&format!("🖼️ Sending image: {}", path));
            let _ = self
                .command_sender
                .send(NetworkCommand::SendFile {
                    path: path.to_string(),
                })
                .await;
            false
        } else if let Some(query) = input.strip_prefix("/gif ") {
            // GIF search command via Klipy
            let query = query.trim();
            if query.is_empty() {
                self.state.add_system_message("Usage: /gif <search term>");
                return false;
            }
            self.state
                .add_system_message(&format!("🔍 Searching GIFs for: {}", query));
            let _ = self
                .command_sender
                .send(NetworkCommand::SearchGif {
                    query: query.to_string(),
                })
                .await;
            false
        } else if let Some(room_cmd) = input.strip_prefix("/room ") {
            self.handle_room_command(room_cmd.trim()).await;
            false
        } else if let Some(game_cmd) = input.strip_prefix("/game ") {
            self.handle_game_command(game_cmd.trim()).await;
            false
        } else if let Some(pos_str) = input.strip_prefix("/move ") {
            self.handle_game_move(pos_str.trim()).await;
            false
        } else if input == "/blackjack" || input.starts_with("/bj ") {
            self.handle_blackjack_command(input.trim()).await;
            false
        } else if input == "/roulette" || input.starts_with("/roulette ") {
            self.handle_roulette_command(input.trim()).await;
            false
        } else if input == "/ab" || input.starts_with("/ab ") {
            self.handle_andarbahar_command(input.trim()).await;
            false
        } else if input == "/slots" || input.starts_with("/slots ") {
            self.handle_slots_command(input.trim()).await;
            false
        } else if input == "/wallet" || input == "/chips" {
            self.handle_wallet_command().await;
            false
        } else if let Some(rest) = input
            .strip_prefix("/whisper ")
            .or_else(|| input.strip_prefix("/w "))
        {
            let parts: Vec<&str> = rest.splitn(2, ' ').collect();
            if parts.len() < 2 {
                self.state
                    .add_system_message("Usage: /whisper <nick_or_peer_id> <message>");
                return false;
            }
            let target = parts[0];
            let msg = parts[1];
            let found_peer = self
                .state
                .peers
                .iter()
                .find(|p| {
                    let short = Self::short_id(p, 8);
                    short.starts_with(target) || p.starts_with(target)
                })
                .cloned();
            if let Some(peer_id) = found_peer {
                self.state.add_chat_message(
                    &format!(
                        "{}->{}",
                        self.state.nick.clone(),
                        Self::short_id(&peer_id, 8)
                    ),
                    &format!("[whisper] {}", msg),
                );
                let whisper_payload =
                    format!("[whisper from {}] {}", self.state.nick, msg);
                let _ = self
                    .command_sender
                    .send(NetworkCommand::SendToPeer {
                        peer_id,
                        data: whisper_payload.into_bytes(),
                    })
                    .await;
            } else {
                self.state.add_system_message(&format!(
                    "Peer '{}' not found. Check the Peers panel.",
                    target
                ));
            }
            false
        } else if let Some(game_name) = input.strip_prefix("/rules").map(|s| s.trim()) {
            self.show_how_to_play(game_name);
            false
        } else if input == "/history" || input.starts_with("/history ") {
            self.handle_history_command().await;
            false
        } else {
            // Regular chat message
            self.state
                .add_chat_message(&self.state.nick.clone(), &input);
            let nick = self.state.nick.clone();
            let _ = self
                .command_sender
                .send(NetworkCommand::Broadcast {
                    data: input.into_bytes(),
                    nick,
                })
                .await;
            false
        }
    }

    /// Handle room commands
    async fn handle_room_command(&mut self, cmd: &str) {
        if let Some(name) = cmd.strip_prefix("create ") {
            let name = name.trim();
            if name.is_empty() {
                self.state.add_system_message("Usage: /room create <name>");
                return;
            }
            let _ = self
                .command_sender
                .send(NetworkCommand::CreateRoom {
                    name: name.to_string(),
                })
                .await;
        } else if let Some(args) = cmd.strip_prefix("invite ") {
            let parts: Vec<&str> = args.split_whitespace().collect();
            if parts.len() < 2 {
                self.state
                    .add_system_message("Usage: /room invite <peer_id> <room_id>");
                self.state
                    .add_system_message("  Use the short peer ID shown in the Peers panel");
                return;
            }
            let short_peer_id = parts[0];
            let room_id = parts[1].to_string();

            // Find full peer ID by matching short ID prefix
            let full_peer_id = self
                .state
                .peers
                .iter()
                .find(|p| p.starts_with(short_peer_id))
                .cloned();

            if let Some(peer_id) = full_peer_id {
                self.state.add_system_message(&format!(
                    "🏠 Inviting {} to room {}",
                    short_peer_id, room_id
                ));
                let _ = self
                    .command_sender
                    .send(NetworkCommand::InviteToRoom { room_id, peer_id })
                    .await;
            } else {
                self.state.add_system_message(&format!(
                    "⚠ Peer '{}' not found. Check the Peers panel.",
                    short_peer_id
                ));
            }
        } else if cmd == "list" {
            let _ = self.command_sender.send(NetworkCommand::ListRooms).await;
        } else if let Some(room_id) = cmd.strip_prefix("join ") {
            let room_id = room_id.trim();
            if room_id.is_empty() {
                self.state.add_system_message("Usage: /room join <room_id>");
                return;
            }
            let _ = self
                .command_sender
                .send(NetworkCommand::JoinRoom {
                    room_id: room_id.to_string(),
                })
                .await;
        } else if let Some(room_id) = cmd.strip_prefix("leave ") {
            let room_id = room_id.trim();
            if room_id.is_empty() {
                self.state
                    .add_system_message("Usage: /room leave <room_id>");
                return;
            }
            let _ = self
                .command_sender
                .send(NetworkCommand::LeaveRoom {
                    room_id: room_id.to_string(),
                })
                .await;
            self.state
                .add_system_message(&format!("🏠 Left room: {}", room_id));
        } else {
            self.state
                .add_system_message("Room commands: create, invite, join, list, leave");
        }
    }

    /// Handle /game commands
    async fn handle_game_command(&mut self, cmd: &str) {
        if let Some(room_arg) = cmd.strip_prefix("tictactoe") {
            let room_id = room_arg.trim();
            if room_id.is_empty() {
                // Use first joined room, or "local" for solo play
                let room_id = self
                    .state
                    .rooms
                    .first()
                    .map(|(id, _)| id.clone())
                    .unwrap_or_else(|| "local".to_string());
                self.start_game_challenge(&room_id).await;
            } else {
                self.start_game_challenge(room_id).await;
            }
        } else if cmd == "rematch" {
            if let Some(ref mut game) = self.state.active_game {
                let room_id = game.room_id.clone();
                game.new_round();
                // Show the new board
                for line in game.render_status() {
                    self.state.add_system_message(&line);
                }
                // Notify the room
                let action = GameAction::Challenge {
                    challenger: self.state.local_peer_id.clone(),
                    challenger_nick: self.state.nick.clone(),
                    room_id: room_id.clone(),
                };
                let _ = self
                    .command_sender
                    .send(NetworkCommand::SendRoomMessage {
                        room_id,
                        data: action.to_bytes(),
                    })
                    .await;
            } else {
                self.state
                    .add_system_message("No active game. Start one with /game tictactoe <room_id>");
            }
        } else {
            self.state.add_system_message("Game commands:");
            self.state
                .add_system_message("  /game tictactoe <room_id>  - Start a game");
            self.state
                .add_system_message("  /game rematch              - Play again");
            self.state
                .add_system_message("  /move <1-9>                - Make a move");
        }
    }

    /// Start a tic-tac-toe challenge in a room
    async fn start_game_challenge(&mut self, room_id: &str) {
        self.state
            .add_system_message("🎮 Starting Tic-Tac-Toe! Waiting for opponent...");

        // Send challenge to the room
        let action = GameAction::Challenge {
            challenger: self.state.local_peer_id.clone(),
            challenger_nick: self.state.nick.clone(),
            room_id: room_id.to_string(),
        };
        let _ = self
            .command_sender
            .send(NetworkCommand::SendRoomMessage {
                room_id: room_id.to_string(),
                data: action.to_bytes(),
            })
            .await;
    }

    /// Handle /move command
    async fn handle_game_move(&mut self, pos_str: &str) {
        let position: u8 = match pos_str.parse() {
            Ok(p) => p,
            Err(_) => {
                self.state.add_system_message("Usage: /move <1-9>");
                return;
            }
        };

        let (room_id, result_lines) = {
            // First check if there's a game and if it's our turn
            let turn_err = {
                if let Some(ref game) = self.state.active_game {
                    if !game.is_my_turn(&self.state.local_peer_id) {
                        Some(format!(
                            "Not your turn! Waiting for {}",
                            game.nick_for(game.current_turn)
                        ))
                    } else {
                        None
                    }
                } else {
                    Some("No active game. Start one with /game tictactoe <room_id>".to_string())
                }
            };

            if let Some(err) = turn_err {
                self.state.add_system_message(&err);
                return;
            }

            let game = self.state.active_game.as_mut().unwrap();
            let peer_id = self.state.local_peer_id.clone();
            match game.make_move(position, &peer_id) {
                Ok(_result) => {
                    let lines = game.render_status();
                    (game.room_id.clone(), lines)
                }
                Err(e) => {
                    self.state.add_system_message(&format!("⚠ {}", e));
                    return;
                }
            }
        };

        // Show updated board
        for line in &result_lines {
            self.state.add_system_message(line);
        }

        // Send the move to the room
        let action = GameAction::Move {
            position,
            room_id: room_id.clone(),
            player: self.state.local_peer_id.clone(),
        };
        let _ = self
            .command_sender
            .send(NetworkCommand::SendRoomMessage {
                room_id,
                data: action.to_bytes(),
            })
            .await;
    }

    /// Handle blackjack commands
    async fn handle_blackjack_command(&mut self, cmd: &str) {
        let cmd = cmd
            .strip_prefix("/bj")
            .unwrap_or(cmd.strip_prefix("/blackjack").unwrap_or(cmd));

        // Start new game
        if cmd.is_empty() || cmd.trim() == "" {
            if self.state.blackjack_game.is_some() {
                // Show overlay for existing game
                self.state.game_overlay.view = game_ui::ActiveGameView::Blackjack;
                self.state.game_overlay.visible = true;
                return;
            }
            // Use first joined room, or "local" for solo play
            let room_id = self
                .state
                .rooms
                .first()
                .map(|(id, _)| id.clone())
                .unwrap_or_else(|| "local".to_string());
            let mut game = Blackjack::new(room_id.clone());
            game.add_player(self.state.local_peer_id.clone(), self.state.nick.clone());

            self.state.blackjack_game = Some(game);
            self.state.game_overlay.view = game_ui::ActiveGameView::Blackjack;
            self.state.game_overlay.visible = true;
            self.state
                .add_system_message("🃏 Blackjack started! /bj bet <amount> to place your bet.");

            // Broadcast start (no-op if solo — room publish silently skipped)
            let action = BlackjackAction::Start {
                room_id: room_id.clone(),
                host: self.state.local_peer_id.clone(),
                host_nick: self.state.nick.clone(),
            };
            let _ = self
                .command_sender
                .send(NetworkCommand::SendRoomMessage {
                    room_id,
                    data: action.to_bytes(),
                })
                .await;
            return;
        }

        // Other commands need an active game
        if self.state.blackjack_game.is_none() {
            self.state
                .add_system_message("No blackjack game. Use /blackjack to start one.");
            return;
        }

        let cmd = cmd.trim();

        if let Some(amount_str) = cmd.strip_prefix("bet ") {
            let amount: u32 = match amount_str.trim().parse() {
                Ok(a) => a,
                Err(_) => {
                    self.state.add_system_message("Usage: /bj bet <amount>");
                    return;
                }
            };
            if let Some(ref mut game) = self.state.blackjack_game {
                game.place_bet(&self.state.local_peer_id, amount);
            }
            self.state
                .add_system_message(&format!("Bet placed: ${}", amount));
            self.broadcast_bj_state().await;
        } else if cmd == "deal" {
            let can_deal = {
                if let Some(ref game) = self.state.blackjack_game {
                    game.players.iter().any(|p| p.bet > 0)
                } else {
                    false
                }
            };
            if !can_deal {
                self.state
                    .add_system_message("No one has placed a bet yet!");
                return;
            }
            if let Some(ref mut game) = self.state.blackjack_game {
                game.deal_initial_cards();
            }
            self.render_blackjack();
            self.broadcast_bj_state().await;
            self.maybe_run_dealer().await;
        } else if cmd == "hit" {
            let is_turn = {
                if let Some(ref game) = self.state.blackjack_game {
                    game.is_player_turn(&self.state.local_peer_id)
                } else {
                    false
                }
            };
            if !is_turn {
                self.state.add_system_message("It's not your turn!");
                return;
            }
            if let Some(ref mut game) = self.state.blackjack_game {
                game.hit(&self.state.local_peer_id);
            }
            self.render_blackjack();
            self.broadcast_bj_state().await;
            self.maybe_run_dealer().await;
        } else if cmd == "stand" {
            let is_turn = {
                if let Some(ref game) = self.state.blackjack_game {
                    game.is_player_turn(&self.state.local_peer_id)
                } else {
                    false
                }
            };
            if !is_turn {
                self.state.add_system_message("It's not your turn!");
                return;
            }
            if let Some(ref mut game) = self.state.blackjack_game {
                game.stand(&self.state.local_peer_id);
            }
            self.render_blackjack();
            self.broadcast_bj_state().await;
            self.maybe_run_dealer().await;
        } else if cmd == "newround" || cmd == "new" {
            if let Some(ref mut game) = self.state.blackjack_game {
                game.new_round();
            }
            self.state
                .add_system_message("New round! /bj bet <amount> to place your bet.");
            self.broadcast_bj_state().await;
        } else {
            self.state
                .add_system_message("Blackjack commands: bet <amount>, deal, hit, stand, newround");
        }
    }

    async fn maybe_run_dealer(&mut self) {
        let needs_dealer = {
            if let Some(ref game) = self.state.blackjack_game {
                game.phase == crate::game::BlackjackPhase::Dealer
            } else {
                false
            }
        };
        if needs_dealer {
            let room_id = {
                self.state
                    .blackjack_game
                    .as_ref()
                    .map(|game| game.room_id.clone())
            };
            if let Some(ref mut game) = self.state.blackjack_game {
                game.run_dealer_turn();
            }
            self.render_blackjack();
            if let Some(rid) = room_id {
                self.broadcast_bj_state_to_room(&rid).await;
            }
        }
    }

    fn render_blackjack(&mut self) {
        if let Some(ref game) = self.state.blackjack_game {
            for line in game.render_status(&self.state.local_peer_id) {
                self.state.add_system_message(&line);
            }
        }
    }

    async fn broadcast_bj_state(&mut self) {
        if let Some(ref game) = self.state.blackjack_game {
            let room_id = game.room_id.clone();
            let state_json = serde_json::to_string(game).unwrap_or_default();
            let action = BlackjackAction::State { state_json };
            let _ = self
                .command_sender
                .send(NetworkCommand::SendRoomMessage {
                    room_id,
                    data: action.to_bytes(),
                })
                .await;
        }
    }

    async fn broadcast_bj_state_to_room(&mut self, room_id: &str) {
        if let Some(ref game) = self.state.blackjack_game {
            let state_json = serde_json::to_string(game).unwrap_or_default();
            let action = BlackjackAction::State { state_json };
            let _ = self
                .command_sender
                .send(NetworkCommand::SendRoomMessage {
                    room_id: room_id.to_string(),
                    data: action.to_bytes(),
                })
                .await;
        }
    }

    /// Handle an incoming game action from another player
    fn handle_incoming_game_action(
        &mut self,
        room_id: &str,
        sender_nick: &str,
        action: GameAction,
    ) {
        match action {
            GameAction::Challenge {
                challenger,
                challenger_nick,
                room_id: action_room,
            } => {
                // Check if we already have an active game in this room
                if let Some(ref game) = self.state.active_game
                    && game.room_id == action_room
                {
                    // This is a rematch notification — reset our board
                    let mut new_game = game.clone();
                    new_game.new_round();
                    self.state.active_game = Some(new_game);
                    for line in self.state.active_game.as_ref().unwrap().render_status() {
                        self.state.add_system_message(&line);
                    }
                    return;
                }

                // Auto-accept: create a new game (challenger is X, we are O)
                let game = TicTacToe::new(
                    (challenger.clone(), challenger_nick.clone()),
                    (self.state.local_peer_id.clone(), self.state.nick.clone()),
                    action_room.clone(),
                );

                self.state.add_system_message(&format!(
                    "🎮 {} challenged you to Tic-Tac-Toe!",
                    challenger_nick
                ));
                for line in game.render_status() {
                    self.state.add_system_message(&line);
                }

                // If we're X (shouldn't happen since challenger is X), note it
                self.state
                    .add_system_message("You are O — use /move <1-9> when it's your turn");
                self.state.active_game = Some(game);
                self.state.game_overlay.view = game_ui::ActiveGameView::TicTacToe;
                self.state.game_overlay.visible = true;

                // Send accept
                let accept = GameAction::Accept {
                    accepter: self.state.local_peer_id.clone(),
                    accepter_nick: self.state.nick.clone(),
                    room_id: action_room,
                };
                let nick = self.state.nick.clone();
                // We can't await here (non-async fn), so use try_send
                let _ = self
                    .command_sender
                    .try_send(NetworkCommand::SendRoomMessage {
                        room_id: room_id.to_string(),
                        data: accept.to_bytes(),
                    });
                let _ = nick; // suppress warning
            }
            GameAction::Accept {
                accepter,
                accepter_nick,
                room_id: action_room,
            } => {
                // Someone accepted our challenge — create the game if we don't have one
                if self.state.active_game.is_none() {
                    let game = TicTacToe::new(
                        (self.state.local_peer_id.clone(), self.state.nick.clone()),
                        (accepter.clone(), accepter_nick.clone()),
                        action_room,
                    );
                    self.state.active_game = Some(game);
                    self.state.game_overlay.view = game_ui::ActiveGameView::TicTacToe;
                    self.state.game_overlay.visible = true;
                }

                self.state
                    .add_system_message(&format!("🎮 {} accepted! Game on!", accepter_nick));
                self.state
                    .add_system_message("You are X — you go first! Use /move <1-9>");
                if let Some(ref game) = self.state.active_game {
                    for line in game.render_status() {
                        self.state.add_system_message(&line);
                    }
                }
            }
            GameAction::Move {
                position,
                room_id: _,
                player,
            } => {
                // Apply the opponent's move to our local game
                if let Some(ref mut game) = self.state.active_game {
                    match game.make_move(position, &player) {
                        Ok(_) => {
                            for line in game.render_status() {
                                self.state.add_system_message(&line);
                            }
                        }
                        Err(e) => {
                            self.state.add_system_message(&format!(
                                "⚠ Invalid move from {}: {}",
                                sender_nick, e
                            ));
                        }
                    }
                }
            }
            GameAction::Resign {
                room_id: _,
                player: _,
            } => {
                self.state
                    .add_system_message(&format!("🏳️ {} resigned!", sender_nick));
                self.state.active_game = None;
            }
            GameAction::Decline { .. } => {
                self.state
                    .add_system_message(&format!("{} declined the game.", sender_nick));
            }
        }
    }

    /// Safely truncate a string to at most `n` chars, appending "…"
    fn short_id(s: &str, n: usize) -> String {
        if s.len() > n {
            format!(
                "{}…",
                &s[..s.char_indices().nth(n).map(|(i, _)| i).unwrap_or(s.len())]
            )
        } else {
            s.to_string()
        }
    }

    /// Handle incoming network events
    fn handle_network_event(&mut self, event: NetworkEvent) {
        match event {
            NetworkEvent::MessageReceived { from, data, .. } => {
                let content = String::from_utf8_lossy(&data).to_string();
                let short = Self::short_id(&from.to_string(), 8);
                // Handle typing indicator
                if content.starts_with("TYPING:") {
                    let typer_nick = content
                        .strip_prefix("TYPING:")
                        .unwrap_or("")
                        .to_string();
                    let _ = typer_nick; // nick stored under short peer ID key
                    self.state
                        .typing_peers
                        .insert(short, std::time::Instant::now());
                    return;
                }
                // Handle casino ticker
                if content.starts_with("TICKER:") {
                    let ticker_msg = content
                        .strip_prefix("TICKER:")
                        .unwrap_or(&content)
                        .to_string();
                    self.state
                        .add_system_message(&format!("[ticker] {}", ticker_msg));
                    return;
                }
                // Handle incoming whisper
                let display_content = if content.starts_with("[whisper from ") {
                    format!("[PM] {}", content)
                } else {
                    // Check for @mention of our nick
                    let mention_marker = if content
                        .to_lowercase()
                        .contains(&format!("@{}", self.state.nick.to_lowercase()))
                    {
                        "[@] "
                    } else {
                        ""
                    };
                    format!("{}{}", mention_marker, content)
                };
                self.state.add_chat_message(&short, &display_content);
            }
            NetworkEvent::FileReceived { from, filename, .. } => {
                let short = Self::short_id(&from.to_string(), 8);
                self.state.add_file_message(&short, &filename);
                self.state
                    .add_system_message(&format!("File saved to ~/openwire-received/{}", filename));
            }
            NetworkEvent::PeerDiscovered(peer_id) | NetworkEvent::PeerConnected(peer_id) => {
                let id_str = peer_id.to_string();
                if !self.state.peers.contains(&id_str) {
                    self.state.peers.push(id_str.clone());
                    let short = Self::short_id(&id_str, 8);
                    self.state
                        .add_system_message(&format!("Peer joined: {}", short));
                }
            }
            NetworkEvent::PeerDisconnected(peer_id) => {
                let id_str = peer_id.to_string();
                self.state.peers.retain(|p| p != &id_str);
                let short = Self::short_id(&id_str, 8);
                self.state
                    .add_system_message(&format!("Peer left: {}", short));
            }
            NetworkEvent::KeysExchanged(peer_id) => {
                let short = Self::short_id(&peer_id.to_string(), 8);
                self.state
                    .add_system_message(&format!("🔐 Keys exchanged with {}", short));
            }
            NetworkEvent::ListenAddress(addr) => {
                self.state
                    .add_system_message(&format!("📡 Listening on: {}", addr));
            }
            NetworkEvent::Error(e) => {
                self.state.add_system_message(&format!("⚠ Error: {}", e));
            }
            NetworkEvent::RoomInviteReceived {
                from,
                room_id,
                room_name,
            } => {
                let short = format!("{}…", &from.to_string()[..8.min(from.to_string().len())]);

                // Add room to UI state when invited
                if !self.state.rooms.iter().any(|(id, _)| id == &room_id) {
                    self.state.rooms.push((room_id.clone(), room_name.clone()));
                }

                // Show clear invite message
                self.state
                    .add_system_message("╔══════════════════════════════════════════╗");
                self.state
                    .add_system_message(&format!("║ 🏠 ROOM INVITE from {}", short));
                self.state
                    .add_system_message(&format!("║ Room: {}", room_name));
                self.state.add_system_message(&format!("║ ID: {}", room_id));
                self.state
                    .add_system_message("║ You have joined this room automatically!");
                self.state
                    .add_system_message("╚══════════════════════════════════════════╝");
            }
            NetworkEvent::RoomMessageReceived {
                from: _,
                room_id,
                sender_nick,
                content,
            } => {
                // Check if this is a game action
                if GameAction::is_game_message(&content) {
                    if let Some(action) = GameAction::from_bytes(&content) {
                        self.handle_incoming_game_action(&room_id, &sender_nick, action);
                    }
                } else if BlackjackAction::is_blackjack_message(&content) {
                    if let Some(action) = BlackjackAction::from_bytes(&content) {
                        self.handle_incoming_blackjack_action(&room_id, action);
                    }
                } else if RouletteAction::is_roulette_message(&content) {
                    if let Some(action) = RouletteAction::from_bytes(&content) {
                        self.handle_incoming_roulette_action(&room_id, action);
                    }
                } else if AndarBaharAction::is_andarbahar_message(&content) {
                    if let Some(action) = AndarBaharAction::from_bytes(&content) {
                        self.handle_incoming_andarbahar_action(&room_id, action);
                    }
                } else {
                    let content_str = String::from_utf8_lossy(&content).to_string();
                    self.state
                        .add_chat_message(&format!("[{}] {}", room_id, sender_nick), &content_str);
                }
            }
            NetworkEvent::RoomCreated { room_id, room_name } => {
                // Add room to UI state
                self.state.rooms.push((room_id.clone(), room_name.clone()));
                self.state.add_system_message(&format!(
                    "🏠 Room '{}' created! ID: {}",
                    room_name, room_id
                ));
            }
            NetworkEvent::RoomList { rooms } => {
                // Update UI state with rooms
                self.state.rooms = rooms.clone();
                if rooms.is_empty() {
                    self.state.add_system_message("🏠 No rooms joined");
                } else {
                    self.state.add_system_message("🏠 Your rooms:");
                    for (id, name) in rooms {
                        self.state
                            .add_system_message(&format!("  • {} ({})", name, id));
                    }
                }
            }
            NetworkEvent::ImageReceived {
                from,
                filename,
                data: _,
            } => {
                let short = format!("{}…", &from.to_string()[..8.min(from.to_string().len())]);
                self.state.add_system_message(&format!(
                    "🖼️ Image '{}' received from {}",
                    filename, short
                ));
                self.state
                    .add_system_message("Saved to ~/openwire-received/");
            }
            NetworkEvent::GifSearchResult { query, gifs } => {
                if gifs.is_empty() {
                    self.state
                        .add_system_message(&format!("No GIFs found for: {}", query));
                } else {
                    self.state.add_system_message(&format!(
                        "🎬 Found {} GIFs for '{}':",
                        gifs.len(),
                        query
                    ));
                    for (i, gif) in gifs.iter().enumerate().take(3) {
                        self.state.add_system_message(&format!(
                            "  {}. {} - {}",
                            i + 1,
                            gif.title,
                            gif.url
                        ));
                    }
                    // Send the first GIF to peers (already done in network layer)
                    if let Some(first) = gifs.first() {
                        self.state.add_chat_message(
                            &self.state.nick.clone(),
                            &format!("[GIF] {} - {}", first.title, first.url),
                        );
                    }
                }
            }
            NetworkEvent::GifReceived {
                from,
                url,
                preview_url: _,
            } => {
                let short = format!("{}…", &from.to_string()[..8.min(from.to_string().len())]);
                self.state
                    .add_chat_message(&short, &format!("[GIF] {}", url));
            }
        }
    }

    /// Render the current state
    fn render(&mut self) -> Result<()> {
        // Temporarily take the overlay out to avoid borrow conflicts in the draw closure
        let mut overlay = std::mem::replace(&mut self.state.game_overlay, game_ui::GameOverlay::new());

        let nick = self.state.nick.clone();
        let peer_id_short = if self.state.local_peer_id.len() > 8 {
            format!("{}…", &self.state.local_peer_id[..8])
        } else {
            self.state.local_peer_id.clone()
        };

        self.terminal.draw(|f| {
            let size = f.area();

            // Main layout: messages+input (left) | peers (right)
            let main_chunks = Layout::default()
                .direction(Direction::Horizontal)
                .constraints([Constraint::Min(40), Constraint::Length(22)])
                .split(size);

            // Left: messages (top) | input (bottom)
            let left_chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([Constraint::Min(5), Constraint::Length(3)])
                .split(main_chunks[0]);

            // -- Messages Panel --
            let msg_area_height = left_chunks[0].height.saturating_sub(2) as usize; // Subtract borders

            // Calculate which messages to show based on scroll offset
            let total_messages = self.state.messages.len();
            let start_idx = if total_messages > msg_area_height {
                total_messages.saturating_sub(msg_area_height + self.state.scroll_offset)
            } else {
                0
            };
            let end_idx = total_messages
                .saturating_sub(self.state.scroll_offset)
                .min(total_messages);

            let msg_items: Vec<ListItem> = self.state.messages[start_idx..end_idx]
                .iter()
                .map(|m| {
                    let style = if m.is_system {
                        Style::default().fg(Color::Yellow)
                    } else if m.is_file {
                        Style::default().fg(Color::Cyan)
                    } else {
                        Style::default().fg(Color::White)
                    };

                    let sender_style = if m.is_system {
                        Style::default()
                            .fg(Color::Yellow)
                            .add_modifier(Modifier::BOLD)
                    } else {
                        Style::default()
                            .fg(Color::Green)
                            .add_modifier(Modifier::BOLD)
                    };

                    ListItem::new(Line::from(vec![
                        Span::styled(
                            format!("[{}] ", m.time),
                            Style::default().fg(Color::DarkGray),
                        ),
                        Span::styled(format!("{}: ", m.sender), sender_style),
                        Span::styled(&m.content, style),
                    ]))
                })
                .collect();

            let messages_block = Block::default()
                .title(format!(" OpenWire — {} ({}) ", nick, peer_id_short))
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Blue));

            let messages = List::new(msg_items).block(messages_block);
            f.render_widget(messages, left_chunks[0]);

            // Render scrollbar for messages
            if total_messages > msg_area_height {
                let scrollbar = Scrollbar::new(ScrollbarOrientation::VerticalRight)
                    .begin_symbol(Some("▲"))
                    .end_symbol(Some("▼"))
                    .track_symbol(Some("│"))
                    .thumb_symbol("█");

                let mut scrollbar_state = ScrollbarState::new(total_messages)
                    .position(total_messages.saturating_sub(end_idx));

                f.render_stateful_widget(
                    scrollbar,
                    left_chunks[0].inner(ratatui::layout::Margin {
                        vertical: 1,
                        horizontal: 0,
                    }),
                    &mut scrollbar_state,
                );
            }

            // -- Input Panel --
            let input_text = if self.state.input.is_empty() {
                "Type a message or /help for commands...".to_string()
            } else {
                self.state.input.clone()
            };

            let input_style = if self.state.input.is_empty() {
                Style::default().fg(Color::DarkGray)
            } else {
                Style::default().fg(Color::White)
            };

            let input = Paragraph::new(input_text)
                .style(input_style)
                .block(
                    Block::default()
                        .title(" Message ")
                        .borders(Borders::ALL)
                        .border_style(Style::default().fg(Color::Cyan)),
                )
                .wrap(Wrap { trim: false });
            f.render_widget(input, left_chunks[1]);

            // Set cursor position
            if !self.state.input.is_empty() {
                f.set_cursor_position((
                    left_chunks[1].x + self.state.cursor_pos as u16 + 1,
                    left_chunks[1].y + 1,
                ));
            }

            // -- Right Panel: Peers + Rooms --
            let right_chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([Constraint::Min(5), Constraint::Length(8)])
                .split(main_chunks[1]);

            // -- Peers Panel --
            let now_typing = std::time::Instant::now();
            let typing_items: Vec<ListItem> = self
                .state
                .typing_peers
                .iter()
                .filter(|(_, t)| {
                    now_typing.duration_since(**t) < std::time::Duration::from_secs(3)
                })
                .map(|(nick, _)| {
                    ListItem::new(Line::from(vec![Span::styled(
                        format!("{} is typing...", nick),
                        Style::default().fg(Color::DarkGray),
                    )]))
                })
                .collect();

            let mut peer_items: Vec<ListItem> = self
                .state
                .peers
                .iter()
                .map(|p| {
                    let short = if p.len() > 12 {
                        format!("{}…", &p[..12])
                    } else {
                        p.clone()
                    };
                    ListItem::new(Line::from(vec![
                        Span::styled("● ", Style::default().fg(Color::Green)),
                        Span::styled(short, Style::default().fg(Color::White)),
                    ]))
                })
                .collect();
            peer_items.extend(typing_items);

            let peers_block = Block::default()
                .title(format!(" Peers ({}) ", self.state.peers.len()))
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Magenta));

            let peers = List::new(peer_items).block(peers_block);
            f.render_widget(peers, right_chunks[0]);

            // -- Rooms Panel --
            let room_items: Vec<ListItem> = self
                .state
                .rooms
                .iter()
                .map(|(id, name)| {
                    let short_id = if id.len() > 8 {
                        format!("{}…", &id[..8])
                    } else {
                        id.clone()
                    };
                    ListItem::new(Line::from(vec![
                        Span::styled("🏠 ", Style::default().fg(Color::Yellow)),
                        Span::styled(name, Style::default().fg(Color::White)),
                        Span::styled(
                            format!(" ({})", short_id),
                            Style::default().fg(Color::DarkGray),
                        ),
                    ]))
                })
                .collect();

            let rooms_block = Block::default()
                .title(format!(" Rooms ({}) ", self.state.rooms.len()))
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Yellow));

            let rooms = List::new(room_items).block(rooms_block);
            f.render_widget(rooms, right_chunks[1]);

            // ── Game overlay (renders on top of everything) ─────────
            game_ui::render_game_overlay(f, size, &self.state, &mut overlay);
        })?;
        self.state.game_overlay = overlay;
        Ok(())
    }

    // ─── Blackjack incoming (Bug 1 fix) ──────────────────────────────────────

    fn handle_incoming_blackjack_action(&mut self, _room_id: &str, action: BlackjackAction) {
        match action {
            BlackjackAction::State { state_json } => {
                if let Ok(game) = serde_json::from_str::<Blackjack>(&state_json) {
                    // Only update if we are a participant (already have a local game)
                    if self.state.blackjack_game.is_some() {
                        self.state.blackjack_game = Some(game);
                        self.render_blackjack();
                    }
                }
            }
            BlackjackAction::Start {
                room_id,
                host,
                host_nick,
            } => {
                if self.state.blackjack_game.is_none() {
                    let mut game = Blackjack::new(room_id);
                    game.add_player(host, host_nick);
                    game.add_player(self.state.local_peer_id.clone(), self.state.nick.clone());
                    self.state.blackjack_game = Some(game);
                    self.state
                        .add_system_message("Blackjack game started by host! /bj bet <amount>");
                }
            }
            BlackjackAction::Join { peer_id, nick } => {
                if let Some(ref mut game) = self.state.blackjack_game {
                    game.add_player(peer_id, nick);
                }
            }
            BlackjackAction::Bet { peer_id, amount } => {
                if let Some(ref mut game) = self.state.blackjack_game {
                    game.place_bet(&peer_id, amount);
                }
            }
            BlackjackAction::Hit { peer_id } => {
                if let Some(ref mut game) = self.state.blackjack_game {
                    game.hit(&peer_id);
                    self.render_blackjack();
                }
            }
            BlackjackAction::Stand { peer_id } => {
                if let Some(ref mut game) = self.state.blackjack_game {
                    game.stand(&peer_id);
                    self.render_blackjack();
                }
            }
            BlackjackAction::Deal => {
                if let Some(ref mut game) = self.state.blackjack_game {
                    game.deal_initial_cards();
                    self.render_blackjack();
                }
            }
            BlackjackAction::DealerPlay => {
                if let Some(ref mut game) = self.state.blackjack_game {
                    game.run_dealer_turn();
                    self.render_blackjack();
                }
            }
            BlackjackAction::NewRound => {
                if let Some(ref mut game) = self.state.blackjack_game {
                    game.new_round();
                }
                self.state
                    .add_system_message("New blackjack round! /bj bet <amount>");
            }
            BlackjackAction::DoubleDown { peer_id } => {
                if let Some(ref mut game) = self.state.blackjack_game {
                    let _ = game.double_down(&peer_id);
                    self.render_blackjack();
                }
            }
            BlackjackAction::Split { peer_id } => {
                if let Some(ref mut game) = self.state.blackjack_game {
                    let _ = game.split(&peer_id);
                    self.render_blackjack();
                }
            }
            BlackjackAction::Insurance { peer_id } => {
                if let Some(ref mut game) = self.state.blackjack_game {
                    let _ = game.buy_insurance(&peer_id);
                }
            }
            BlackjackAction::InsuranceResolved { .. } => {
                // Insurance resolution is handled during settlement
            }
        }
    }

    // ─── Roulette command handler ─────────────────────────────────────────────

    async fn handle_roulette_command(&mut self, cmd: &str) {
        let cmd = cmd.strip_prefix("/roulette").unwrap_or(cmd).trim();

        // Ensure a game exists
        if self.state.roulette_game.is_none() {
            let room_id = self
                .state
                .rooms
                .first()
                .map(|(id, _)| id.clone())
                .unwrap_or_else(|| "local".to_string());
            self.state.roulette_game = Some(RouletteEngine::new(room_id));
            self.state.game_overlay.view = game_ui::ActiveGameView::Roulette;
            self.state.game_overlay.visible = true;
        }

        if cmd.is_empty() {
            // Show visual overlay instead of text dump
            self.state.game_overlay.view = game_ui::ActiveGameView::Roulette;
            self.state.game_overlay.visible = true;
            return;
        }

        if let Some(rest) = cmd.strip_prefix("bet ") {
            // /roulette bet <type> <amount>
            let parts: Vec<&str> = rest.trim().splitn(3, ' ').collect();
            if parts.len() < 2 {
                self.state
                    .add_system_message("Usage: /roulette bet <type> <amount>");
                self.state.add_system_message(
                    "Types: red, black, odd, even, low, high, straight <n>, dozen <1-3>, column <1-3>",
                );
                return;
            }

            let amount: u32 = match parts.last().unwrap().parse() {
                Ok(a) if a > 0 => a,
                _ => {
                    self.state
                        .add_system_message("Bet amount must be a positive integer.");
                    return;
                }
            };

            let bet_type = match parts[0] {
                "red" => Some(RouletteBetType::Red),
                "black" => Some(RouletteBetType::Black),
                "odd" => Some(RouletteBetType::Odd),
                "even" => Some(RouletteBetType::Even),
                "low" => Some(RouletteBetType::Low),
                "high" => Some(RouletteBetType::High),
                "straight" if parts.len() >= 2 => parts[1]
                    .parse::<u8>()
                    .ok()
                    .filter(|&n| n <= 36)
                    .map(RouletteBetType::Straight),
                "dozen" if parts.len() >= 2 => parts[1]
                    .parse::<u8>()
                    .ok()
                    .filter(|&d| (1..=3).contains(&d))
                    .map(RouletteBetType::Dozen),
                "column" if parts.len() >= 2 => parts[1]
                    .parse::<u8>()
                    .ok()
                    .filter(|&c| (1..=3).contains(&c))
                    .map(RouletteBetType::Column),
                _ => None,
            };

            let bet_type = match bet_type {
                Some(t) => t,
                None => {
                    self.state
                        .add_system_message("Unknown bet type. See /help for options.");
                    return;
                }
            };

            // Debit wallet
            let mut wallet = self.state.wallet.clone();
            wallet.refresh_if_needed();
            if let Err(e) = wallet.debit(amount) {
                self.state.add_system_message(&format!("Wallet: {}", e));
                return;
            }
            self.state.wallet = wallet;

            let bet = RouletteBet {
                peer_id: self.state.local_peer_id.clone(),
                nick: self.state.nick.clone(),
                bet_type,
                amount,
            };
            let room_id = if let Some(ref mut game) = self.state.roulette_game {
                game.place_bet(bet.clone());
                Some(game.room_id.clone())
            } else {
                None
            };
            if let Some(rid) = room_id {
                self.state.add_system_message(&format!(
                    "Bet placed: {} chips. Balance: {}",
                    amount, self.state.wallet.balance
                ));
                let action = RouletteAction::Bet { bet };
                let _ = self
                    .command_sender
                    .send(NetworkCommand::SendRoomMessage {
                        room_id: rid,
                        data: action.to_bytes(),
                    })
                    .await;
            }
        } else if cmd == "spin" {
            let (payouts, room_id) = {
                let game = match self.state.roulette_game.as_mut() {
                    Some(g) => g,
                    None => return,
                };
                let p = game.spin();
                let rid = game.room_id.clone();
                (p, rid)
            };

            let result = self.state.roulette_game.as_ref().and_then(|g| g.result);
            if let Some(n) = result {
                let color = if n == 0 {
                    "green"
                } else if crate::game::roulette_is_red(n) {
                    "red"
                } else {
                    "black"
                };
                self.state
                    .add_system_message(&format!("Roulette result: {} ({})", n, color));
            }

            let mut total_net: i64 = 0;
            for (peer, net) in &payouts {
                if peer == &self.state.local_peer_id {
                    total_net = *net;
                    if *net > 0 {
                        self.state.wallet.credit(*net as u32);
                        self.state.add_system_message(&format!(
                            "You won {}! Balance: {}",
                            net, self.state.wallet.balance
                        ));
                        let ticker = format!(
                            "TICKER:{} won {} chips on Roulette!",
                            self.state.nick, net
                        );
                        let nick = self.state.nick.clone();
                        let _ = self
                            .command_sender
                            .send(NetworkCommand::Broadcast {
                                data: ticker.into_bytes(),
                                nick,
                            })
                            .await;
                    } else {
                        self.state.add_system_message(&format!(
                            "You lost {}. Balance: {}",
                            net.abs(),
                            self.state.wallet.balance
                        ));
                    }
                }
            }
            self.state.casino_state.record_payout("roulette", total_net);

            if let Some(ref mut game) = self.state.roulette_game {
                game.new_round();
            }

            let action = RouletteAction::Spin;
            let _ = self
                .command_sender
                .send(NetworkCommand::SendRoomMessage {
                    room_id,
                    data: action.to_bytes(),
                })
                .await;
        } else {
            self.state.add_system_message(
                "Roulette: /roulette  /roulette bet <type> <amount>  /roulette spin",
            );
        }
    }

    fn handle_incoming_roulette_action(&mut self, _room_id: &str, action: RouletteAction) {
        match action {
            RouletteAction::State { state_json } => {
                if let Ok(game) = serde_json::from_str::<RouletteEngine>(&state_json) {
                    self.state.roulette_game = Some(game);
                }
            }
            RouletteAction::Bet { bet } => {
                if let Some(ref mut game) = self.state.roulette_game {
                    game.place_bet(bet);
                }
            }
            RouletteAction::Spin => {
                // Remote spin result handled via State sync; just notify
                self.state
                    .add_system_message("Roulette: wheel spun by host.");
            }
        }
    }

    // ─── Andar Bahar command handler ──────────────────────────────────────────

    async fn handle_andarbahar_command(&mut self, cmd: &str) {
        let cmd = cmd.strip_prefix("/ab").unwrap_or(cmd).trim();

        // Ensure a game exists
        if self.state.andarbahar_game.is_none() {
            let room_id = self
                .state
                .rooms
                .first()
                .map(|(id, _)| id.clone())
                .unwrap_or_else(|| "local".to_string());
            self.state.andarbahar_game = Some(AndarBaharEngine::new(room_id));
            self.state.game_overlay.view = game_ui::ActiveGameView::AndarBahar;
            self.state.game_overlay.visible = true;
        }

        if cmd.is_empty() {
            // Show visual overlay
            self.state.game_overlay.view = game_ui::ActiveGameView::AndarBahar;
            self.state.game_overlay.visible = true;
            return;
        }

        let place_bet = |state: &mut crate::ui::UiState,
                         side: AndarBaharSide,
                         amount_str: &str|
         -> Option<(AndarBaharBet, String)> {
            let amount: u32 = match amount_str.parse() {
                Ok(a) if a > 0 => a,
                _ => {
                    state.add_system_message("Bet amount must be a positive integer.");
                    return None;
                }
            };
            let mut wallet = state.wallet.clone();
            wallet.refresh_if_needed();
            if let Err(e) = wallet.debit(amount) {
                state.add_system_message(&format!("Wallet: {}", e));
                return None;
            }
            state.wallet = wallet;
            let bet = AndarBaharBet {
                peer_id: state.local_peer_id.clone(),
                nick: state.nick.clone(),
                side,
                amount,
                count_side_bet: None,
            };
            let room_id = state
                .andarbahar_game
                .as_ref()
                .map(|g| g.room_id.clone())
                .unwrap_or_default();
            state.add_system_message(&format!(
                "Bet placed: {} chips. Balance: {}",
                amount, state.wallet.balance
            ));
            Some((bet, room_id))
        };

        if let Some(amount_str) = cmd.strip_prefix("andar ") {
            if let Some((bet, room_id)) =
                place_bet(&mut self.state, AndarBaharSide::Andar, amount_str.trim())
            {
                if let Some(ref mut game) = self.state.andarbahar_game {
                    game.place_bet(bet.clone());
                }
                let action = AndarBaharAction::Bet { bet };
                let _ = self
                    .command_sender
                    .send(NetworkCommand::SendRoomMessage {
                        room_id,
                        data: action.to_bytes(),
                    })
                    .await;
            }
        } else if let Some(amount_str) = cmd.strip_prefix("bahar ") {
            if let Some((bet, room_id)) =
                place_bet(&mut self.state, AndarBaharSide::Bahar, amount_str.trim())
            {
                if let Some(ref mut game) = self.state.andarbahar_game {
                    game.place_bet(bet.clone());
                }
                let action = AndarBaharAction::Bet { bet };
                let _ = self
                    .command_sender
                    .send(NetworkCommand::SendRoomMessage {
                        room_id,
                        data: action.to_bytes(),
                    })
                    .await;
            }
        } else if cmd == "deal" {
            let room_id = {
                let game = match self.state.andarbahar_game.as_mut() {
                    Some(g) => g,
                    None => return,
                };
                game.deal_all();
                game.room_id.clone()
            };

            // Credit/debit wallet from payouts
            let payouts = self
                .state
                .andarbahar_game
                .as_ref()
                .map(|g| g.calculate_payouts())
                .unwrap_or_default();

            let mut total_net: i64 = 0;
            for (peer, net) in &payouts {
                if peer == &self.state.local_peer_id {
                    total_net = *net;
                    if *net > 0 {
                        self.state.wallet.credit(*net as u32);
                        self.state.add_system_message(&format!(
                            "Andar Bahar: you won {}! Balance: {}",
                            net, self.state.wallet.balance
                        ));
                    } else {
                        self.state.add_system_message(&format!(
                            "Andar Bahar: you lost {}. Balance: {}",
                            net.abs(),
                            self.state.wallet.balance
                        ));
                    }
                }
            }
            self.state
                .casino_state
                .record_payout("andarbahar", total_net);

            let lines: Vec<String> = self
                .state
                .andarbahar_game
                .as_ref()
                .map(|g| g.render_status())
                .unwrap_or_default();
            for l in lines {
                self.state.add_system_message(&l);
            }

            if let Some(ref mut game) = self.state.andarbahar_game {
                game.new_round();
            }

            let action = AndarBaharAction::Deal;
            let _ = self
                .command_sender
                .send(NetworkCommand::SendRoomMessage {
                    room_id,
                    data: action.to_bytes(),
                })
                .await;
        } else if let Some(rest) = cmd.strip_prefix("count ") {
            let parts: Vec<&str> = rest.split_whitespace().collect();
            if parts.len() < 2 {
                self.state.add_system_message(
                    "Usage: /ab count <1-5|6-10|11-15|16-25|26+> <amount>",
                );
                return;
            }
            let range_str = parts[0];
            let amount_str = parts[1];
            let range = match range_str {
                "1-5" => AndarBaharCountRange::Cards1To5,
                "6-10" => AndarBaharCountRange::Cards6To10,
                "11-15" => AndarBaharCountRange::Cards11To15,
                "16-25" => AndarBaharCountRange::Cards16To25,
                "26+" => AndarBaharCountRange::Cards26Plus,
                _ => {
                    self.state
                        .add_system_message("Valid ranges: 1-5, 6-10, 11-15, 16-25, 26+");
                    return;
                }
            };
            let amount: u32 = match amount_str.parse() {
                Ok(a) if a > 0 => a,
                _ => {
                    self.state
                        .add_system_message("Amount must be a positive number.");
                    return;
                }
            };
            let mut wallet = self.state.wallet.clone();
            wallet.refresh_if_needed();
            if let Err(e) = wallet.debit(amount) {
                self.state.add_system_message(&format!("Wallet: {}", e));
                return;
            }
            self.state.wallet = wallet;
            self.state.add_system_message(&format!(
                "Count side-bet: {} chips on {}. Balance: {}",
                amount,
                range.label(),
                self.state.wallet.balance
            ));
        } else {
            self.state.add_system_message(
                "Usage: /ab andar <amount> | /ab bahar <amount> | /ab deal | /ab count <range> <amount>",
            );
        }
    }

    fn handle_incoming_andarbahar_action(&mut self, _room_id: &str, action: AndarBaharAction) {
        match action {
            AndarBaharAction::State { state_json } => {
                if let Ok(game) = serde_json::from_str::<AndarBaharEngine>(&state_json) {
                    self.state.andarbahar_game = Some(game);
                }
            }
            AndarBaharAction::Bet { bet } => {
                if let Some(ref mut game) = self.state.andarbahar_game {
                    game.place_bet(bet);
                }
            }
            AndarBaharAction::Deal => {
                self.state
                    .add_system_message("Andar Bahar: host is dealing...");
            }
        }
    }

    // ─── Slots command handler ────────────────────────────────────────────────

    async fn handle_slots_command(&mut self, cmd: &str) {
        let cmd = cmd.strip_prefix("/slots").unwrap_or(cmd).trim();

        // Ensure engine exists
        if self.state.slots_engine.is_none() {
            let room_id = self
                .state
                .rooms
                .first()
                .map(|(id, _)| id.clone())
                .unwrap_or_else(|| "local".to_string());
            self.state.slots_engine = Some(SlotsEngine::new(room_id));
            self.state.game_overlay.view = game_ui::ActiveGameView::Slots;
            self.state.game_overlay.visible = true;
        }

        if let Some(amount_str) = cmd.strip_prefix("spin ") {
            let amount: u32 = match amount_str.trim().parse() {
                Ok(a) if a > 0 => a,
                _ => {
                    self.state.add_system_message("Usage: /slots spin <amount>");
                    return;
                }
            };

            // Debit wallet
            let mut wallet = self.state.wallet.clone();
            wallet.refresh_if_needed();
            if let Err(e) = wallet.debit(amount) {
                self.state.add_system_message(&format!("Wallet: {}", e));
                return;
            }
            self.state.wallet = wallet;

            let payout = {
                let engine = self.state.slots_engine.as_mut().unwrap();
                engine.spin(amount)
            };

            if payout > 0 {
                self.state.wallet.credit(amount + payout as u32);
                self.state.casino_state.record_payout("slots", payout);
                let ticker = format!(
                    "TICKER:{} won {} chips on Slots!",
                    self.state.nick, payout
                );
                let nick = self.state.nick.clone();
                let _ = self
                    .command_sender
                    .send(NetworkCommand::Broadcast {
                        data: ticker.into_bytes(),
                        nick,
                    })
                    .await;
            } else {
                self.state.casino_state.record_payout("slots", payout);
            }

            let lines: Vec<String> = self
                .state
                .slots_engine
                .as_ref()
                .map(|e| e.render_result())
                .unwrap_or_default();
            for l in lines {
                self.state.add_system_message(&l);
            }
            self.state
                .add_system_message(&format!("Balance: {} chips", self.state.wallet.balance));
        } else {
            self.state.add_system_message("Usage: /slots spin <amount>");
        }
    }

    // ─── Wallet command handler ───────────────────────────────────────────────

    async fn handle_wallet_command(&mut self) {
        let mut wallet = self.state.wallet.clone();
        wallet.refresh_if_needed();
        self.state.wallet = wallet;
        self.state.add_system_message(&format!(
            "Chip balance: {}  (daily refresh: +{} chips at UTC midnight)",
            self.state.wallet.balance,
            crate::game::Wallet::DAILY_CHIPS
        ));
        // Show house P&L
        if !self.state.casino_state.house_pnl.is_empty() {
            self.state.add_system_message("House P&L this session:");
            let pnl: Vec<String> = self
                .state
                .casino_state
                .house_pnl
                .iter()
                .map(|(game, net)| format!("  {}: {}", game, net))
                .collect();
            for l in pnl {
                self.state.add_system_message(&l);
            }
        }
    }

    fn show_how_to_play(&mut self, game: &str) {
        match game {
            "blackjack" | "bj" => {
                self.state.add_system_message("== BLACKJACK RULES ==");
                self.state
                    .add_system_message("Goal: Get closer to 21 than the dealer without going over.");
                self.state
                    .add_system_message("Cards: 2-10 = face value. J/Q/K = 10. A = 1 or 11.");
                self.state.add_system_message("Commands:");
                self.state
                    .add_system_message("  /bj bet <amount>  - Place bet before deal");
                self.state
                    .add_system_message("  /bj deal          - Deal cards (host only)");
                self.state.add_system_message("  /bj hit           - Take another card");
                self.state.add_system_message("  /bj stand         - End your turn");
                self.state
                    .add_system_message("  /bj double        - Double bet, take 1 card");
                self.state
                    .add_system_message("  /bj split         - Split a pair into 2 hands");
                self.state.add_system_message(
                    "  /bj insurance     - Buy insurance vs dealer BJ (half bet)",
                );
                self.state
                    .add_system_message("  /bj newround      - Start new round");
                self.state
                    .add_system_message("Payouts: Win=1:1, Blackjack=3:2, Insurance=2:1");
            }
            "roulette" => {
                self.state.add_system_message("== ROULETTE RULES ==");
                self.state
                    .add_system_message("Spin a wheel with 37 pockets (0-36). Bet on outcome.");
                self.state.add_system_message("Bet types:");
                self.state
                    .add_system_message("  number <0-36>  -> 35:1 payout");
                self.state.add_system_message("  red / black    -> 1:1 payout");
                self.state.add_system_message("  even / odd     -> 1:1 payout");
                self.state
                    .add_system_message("  low (1-18) / high (19-36) -> 1:1");
                self.state.add_system_message(
                    "Commands: /roulette bet <type> <amount>  /roulette spin",
                );
            }
            "andarbahar" | "ab" => {
                self.state.add_system_message("== ANDAR BAHAR RULES ==");
                self.state.add_system_message(
                    "A joker card is revealed. Cards are dealt alternately to Andar and Bahar.",
                );
                self.state.add_system_message(
                    "The side that gets a card matching the joker's value wins.",
                );
                self.state.add_system_message("Commands:");
                self.state
                    .add_system_message("  /ab andar <amount>  - Bet on Andar side");
                self.state
                    .add_system_message("  /ab bahar <amount>  - Bet on Bahar side");
                self.state.add_system_message(
                    "  /ab count <range> <amount>  - Side bet on card count",
                );
                self.state.add_system_message(
                    "     Ranges: 1-5(3.5x) 6-10(4.5x) 11-15(5.5x) 16-25(6.5x) 26+(8x)",
                );
                self.state.add_system_message("  /ab deal   - Deal all cards");
                self.state.add_system_message(
                    "Payout: Main bet pays 0.9:1 (Andar) or 1:1 (Bahar)",
                );
            }
            "slots" => {
                self.state.add_system_message("== SLOTS RULES ==");
                self.state.add_system_message("Spin 3 reels. Match symbols to win.");
                self.state.add_system_message(
                    "Symbols: 7(50x), Diamond(20x), Crown(10x), Cherry(5x), Bell(3x), Bar(2x)",
                );
                self.state.add_system_message("Command: /slots spin <amount>");
            }
            "tictactoe" | "ttt" => {
                self.state.add_system_message("== TIC TAC TOE RULES ==");
                self.state.add_system_message(
                    "3x3 grid. Get 3 in a row (horizontal, vertical, diagonal) to win.",
                );
                self.state.add_system_message("Commands:");
                self.state
                    .add_system_message("  /game tictactoe <room_id>  - Start a game");
                self.state
                    .add_system_message("  /move <1-9>                - Place your mark");
                self.state.add_system_message("     1|2|3");
                self.state.add_system_message("     4|5|6");
                self.state.add_system_message("     7|8|9");
            }
            _ => {
                self.state.add_system_message(
                    "Available games: blackjack (bj), roulette, andarbahar (ab), slots, tictactoe (ttt)",
                );
                self.state.add_system_message("Usage: /rules <game>");
            }
        }
    }

    async fn handle_history_command(&mut self) {
        let ledger = TransactionLedger::load();
        let recent = ledger.recent(20);
        if recent.is_empty() {
            self.state
                .add_system_message("No game history yet. Play some games!");
            return;
        }
        self.state
            .add_system_message("== RECENT GAME HISTORY (last 20) ==");
        for t in recent {
            let sign = if t.amount >= 0 { "+" } else { "" };
            let time = chrono::DateTime::from_timestamp(t.timestamp as i64, 0)
                .map(|dt: chrono::DateTime<chrono::Utc>| dt.format("%m/%d %H:%M").to_string())
                .unwrap_or_else(|| "??:??".to_string());
            self.state.add_system_message(&format!(
                "  [{}] {} {}{}  (bal: {})",
                time, t.game, sign, t.amount, t.balance_after
            ));
        }
    }
}

impl Drop for UiApp {
    fn drop(&mut self) {
        self.state.save_message_history();
        let _ = disable_raw_mode();
        let _ = execute!(self.terminal.backend_mut(), DisableMouseCapture, LeaveAlternateScreen);
        let _ = self.terminal.show_cursor();
    }
}
