//! Terminal User Interface for OpenWire
//!
//! Uses Ratatui + Crossterm to provide a rich terminal-based messaging experience.

use anyhow::Result;
use crossterm::{
    event::{self, Event, KeyCode},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    widgets::{Block, Borders},
    Terminal,
};
use std::io;

/// UI State management
pub struct UiState {
    pub input: String,
    pub messages: Vec<String>,
    pub peers: Vec<String>,
}

impl UiState {
    pub fn new() -> Self {
        Self {
            input: String::new(),
            messages: Vec::new(),
            peers: Vec::new(),
        }
    }
}

/// The UI Renderer
pub struct UiApp {
    terminal: Terminal<CrosstermBackend<io::Stdout>>,
    state: UiState,
}

impl UiApp {
    pub fn new() -> Result<Self> {
        // Set up crossterm: raw mode + alternate screen
        enable_raw_mode()?;
        let mut stdout = io::stdout();
        execute!(stdout, EnterAlternateScreen)?;
        let backend = CrosstermBackend::new(stdout);
        let terminal = Terminal::new(backend)?;

        Ok(Self {
            terminal,
            state: UiState::new(),
        })
    }

    /// Run the UI event loop
    pub async fn run(&mut self) -> Result<()> {
        tracing::info!("UI loop started");

        loop {
            self.render()?;

            // Poll for keyboard events with a small timeout
            if event::poll(std::time::Duration::from_millis(100))? {
                if let Event::Key(key) = event::read()? {
                    match key.code {
                        KeyCode::Char('q') => break,
                        KeyCode::Esc => break,
                        _ => {}
                    }
                }
            }
        }

        Ok(())
    }

    /// Render the current state
    fn render(&mut self) -> Result<()> {
        self.terminal.draw(|f| {
            let size = f.area();

            let block = Block::default()
                .title(" OpenWire - P2P Encrypted Messenger [q/Esc to quit] ")
                .borders(Borders::ALL);

            f.render_widget(block, size);
        })?;
        Ok(())
    }
}

impl Drop for UiApp {
    fn drop(&mut self) {
        // Restore terminal state — critical to avoid leaving the terminal broken
        let _ = disable_raw_mode();
        let _ = execute!(self.terminal.backend_mut(), LeaveAlternateScreen);
        let _ = self.terminal.show_cursor();
    }
}
