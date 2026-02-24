//! Terminal User Interface for OpenWire
//!
//! Uses Ratatui + Crossterm to provide a rich terminal-based messaging experience
//! with a 3-pane layout: messages, peers, and input.

use anyhow::Result;
use crossterm::{
    event::{self, Event, KeyCode, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{
        Block, Borders, List, ListItem, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState,
        Wrap,
    },
    Terminal,
};
use std::io;
use tokio::sync::mpsc;

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
}

impl UiState {
    pub fn new(nick: String, local_peer_id: String) -> Self {
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
        };
        state.add_system_message("Welcome to OpenWire! End-to-end encrypted P2P messenger.");
        state.add_system_message("Peers on the same LAN are discovered automatically via mDNS.");
        state.add_system_message("Type a message and press Enter to chat. /help for commands.");
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
}

impl UiApp {
    pub fn new(
        nick: String,
        local_peer_id: String,
        command_sender: mpsc::Sender<NetworkCommand>,
        event_receiver: mpsc::Receiver<NetworkEvent>,
    ) -> Result<Self> {
        enable_raw_mode()?;
        let mut stdout = io::stdout();
        execute!(stdout, EnterAlternateScreen)?;
        let backend = CrosstermBackend::new(stdout);
        let terminal = Terminal::new(backend)?;

        Ok(Self {
            terminal,
            state: UiState::new(nick, local_peer_id),
            command_sender,
            event_receiver,
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

            // Poll for keyboard events with a small timeout
            if event::poll(std::time::Duration::from_millis(50))? {
                if let Event::Key(key) = event::read()? {
                    match (key.code, key.modifiers) {
                        (KeyCode::Char('c'), KeyModifiers::CONTROL) => {
                            let _ = self.command_sender.send(NetworkCommand::Shutdown).await;
                            break;
                        }
                        (KeyCode::Esc, _) => {
                            let _ = self.command_sender.send(NetworkCommand::Shutdown).await;
                            break;
                        }
                        (KeyCode::Enter, _) => {
                            if self.handle_submit().await {
                                break;
                            }
                        }
                        (KeyCode::Char(c), _) => {
                            self.state.input.insert(self.state.cursor_pos, c);
                            self.state.cursor_pos += 1;
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
                            // Scroll up (towards older messages)
                            self.state.auto_scroll = false;
                            let max_scroll = self.state.messages.len().saturating_sub(1);
                            if self.state.scroll_offset < max_scroll {
                                self.state.scroll_offset += 1;
                            }
                        }
                        (KeyCode::Down, _) => {
                            // Scroll down (towards newer messages)
                            if self.state.scroll_offset > 0 {
                                self.state.scroll_offset -= 1;
                            }
                            if self.state.scroll_offset == 0 {
                                self.state.auto_scroll = true;
                            }
                        }
                        (KeyCode::PageUp, _) => {
                            // Scroll up by 10 messages
                            self.state.auto_scroll = false;
                            let max_scroll = self.state.messages.len().saturating_sub(1);
                            self.state.scroll_offset =
                                (self.state.scroll_offset + 10).min(max_scroll);
                        }
                        (KeyCode::PageDown, _) => {
                            // Scroll down by 10 messages
                            self.state.scroll_offset = self.state.scroll_offset.saturating_sub(10);
                            if self.state.scroll_offset == 0 {
                                self.state.auto_scroll = true;
                            }
                        }
                        _ => {}
                    }
                }
            }
        }

        Ok(())
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
        } else {
            // Regular chat message
            self.state
                .add_chat_message(&self.state.nick.clone(), &input);
            let _ = self
                .command_sender
                .send(NetworkCommand::Broadcast {
                    data: input.into_bytes(),
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

    /// Handle incoming network events
    fn handle_network_event(&mut self, event: NetworkEvent) {
        match event {
            NetworkEvent::MessageReceived { from, data, .. } => {
                let content = String::from_utf8_lossy(&data).to_string();
                let short_id = format!("{}…", &from.to_string()[..8]);
                self.state.add_chat_message(&short_id, &content);
            }
            NetworkEvent::FileReceived { from, filename, .. } => {
                let short_id = format!("{}…", &from.to_string()[..8]);
                self.state.add_file_message(&short_id, &filename);
                self.state
                    .add_system_message(&format!("File saved to ~/openwire-received/{}", filename));
            }
            NetworkEvent::PeerDiscovered(peer_id) | NetworkEvent::PeerConnected(peer_id) => {
                let id_str = peer_id.to_string();
                if !self.state.peers.contains(&id_str) {
                    self.state.peers.push(id_str.clone());
                    let short = format!("{}…", &id_str[..8]);
                    self.state
                        .add_system_message(&format!("Peer joined: {}", short));
                }
            }
            NetworkEvent::PeerDisconnected(peer_id) => {
                let id_str = peer_id.to_string();
                self.state.peers.retain(|p| p != &id_str);
                let short = format!("{}…", &id_str[..8]);
                self.state
                    .add_system_message(&format!("Peer left: {}", short));
            }
            NetworkEvent::KeysExchanged(peer_id) => {
                let short = format!("{}…", &peer_id.to_string()[..8]);
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
                let content_str = String::from_utf8_lossy(&content).to_string();
                self.state
                    .add_chat_message(&format!("[{}] {}", room_id, sender_nick), &content_str);
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
            let peer_items: Vec<ListItem> = self
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
        })?;
        Ok(())
    }
}

impl Drop for UiApp {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let _ = execute!(self.terminal.backend_mut(), LeaveAlternateScreen);
        let _ = self.terminal.show_cursor();
    }
}
