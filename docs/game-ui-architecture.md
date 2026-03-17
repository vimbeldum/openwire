# Game UI Architecture — Ratatui TUI Game Panel

## 1. Module Structure

```
src/
  ui/
    mod.rs              -- existing (2352 lines) — add `mod game_ui;` and modify render() + run()
    game_ui.rs          -- NEW (~450 lines) — all game rendering widgets and event handling
  game.rs              -- existing (2032 lines) — no changes, consumed read-only
```

### Changes to existing files

**`src/ui/mod.rs`** (minimal edits):
- Add `mod game_ui;` at top
- Add `ActiveGameView` enum and field to `UiState`
- Modify `run()` to call `crossterm::event::EnableMouseCapture` on startup, `DisableMouseCapture` on teardown
- Modify `run()` event loop to dispatch `Event::Mouse` to `game_ui::handle_mouse_event()`
- Modify `render()` to branch on `self.state.active_game_view`: when `Some`, call `game_ui::render_game_layout()` instead of the default layout

**`src/ui/game_ui.rs`** (new file):
- All game panel widgets, ASCII art, action bar rendering
- Mouse event → game action translation
- No game logic — reads state from game engines, returns `GameUiAction` for `mod.rs` to dispatch

---

## 2. Layout Design

### Default layout (no game active) — unchanged

```
+---------------------------------------------+------------------+
| OpenWire -- nick (peer_id)                   | Peers (3)        |
|                                              | * alice          |
| [12:01] alice: hey                           | * bob            |
| [12:02] bob: /bj start                       | * charlie        |
| [12:02] * Blackjack started!                 |                  |
|                                              |                  |
|                                              +------------------+
|                                              | Rooms (1)        |
|                                              | # lobby (abc..)  |
+---------------------------------------------+------------------+
| Message: _                                                      |
+----------------------------------------------------------------+
```

### Game-active layout (split)

```
+---------------------------+-----------------+------------------+
| OpenWire -- nick          | BLACKJACK       | Peers (3)        |
|                           |                 | * alice          |
| [12:01] alice: hey        | Dealer (17)     | * bob            |
| [12:02] * BJ started      | .------. .----. |                  |
|                           | | K    | | 7   | |                  |
|                           | |  ♠   | |  ♥  | +------------------+
|                           | |    K | |   7 | | Rooms (1)        |
|                           | '------' '----' | # lobby          |
|                           |                 |                  |
|                           | You (19)        +------------------+
|                           | .------. .----.                    |
|                           | | A    | | 8   |  Chips: 850       |
|                           | |  ♣   | |  ♦  |                   |
|                           | |    A | |   8 |                   |
|                           | '------' '----'                    |
|                           |                                    |
|                           | [H]it [S]tand [D]ouble [Q]uit     |
+---------------------------+------------------------------------+
| Message: _                                                     |
+---------------------------------------------------------------+
```

### Roulette layout

```
+---------------------------+------------------------------------+
| Chat (compressed)         |        ROULETTE                    |
|                           |                                    |
|                           |   Phase: BETTING | Bets: 2         |
|                           |                                    |
|                           |   Your bets:                       |
|                           |     Red  100                       |
|                           |     #17   50                       |
|                           |                                    |
|                           |   [R]ed [B]lack [O]dd [E]ven      |
|                           |   [L]ow [H]igh  [S]pin            |
+---------------------------+------------------------------------+
| Message: _                                                     |
+---------------------------------------------------------------+
```

### Tic-Tac-Toe layout

```
+---------------------------+------------------------------------+
| Chat (compressed)         |       TIC-TAC-TOE                  |
|                           |   alice (X) vs bob (O)             |
|                           |                                    |
|                           |      1 | 2 | 3                     |
|                           |     ---+---+---                    |
|                           |      X | 5 | O                     |
|                           |     ---+---+---                    |
|                           |      7 | 8 | 9                     |
|                           |                                    |
|                           |   Click a cell or type /game <N>   |
+---------------------------+------------------------------------+
```

### Slots layout

```
+---------------------------+------------------------------------+
| Chat (compressed)         |          SLOTS                     |
|                           |                                    |
|                           |  +-------+-------+-------+         |
|                           |  | [CHR] | [BEL] | [ 7 ] |         |
|                           |  +-------+-------+-------+         |
|                           |                                    |
|                           |  Bet: 100 | WIN! +900              |
|                           |                                    |
|                           |  [S]pin <amt>   [Q]uit             |
+---------------------------+------------------------------------+
```

---

## 3. Widget Architecture

### Core types in `game_ui.rs`

```rust
use ratatui::layout::Rect;
use ratatui::Frame;
use crate::game::*;

/// Which game UI is currently shown in the game panel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActiveGameView {
    Blackjack,
    Roulette,
    AndarBahar,
    Slots,
    TicTacToe,
}

/// An action the game UI wants the main loop to execute.
/// Returned from mouse/keyboard handling — mod.rs dispatches it.
#[derive(Debug, Clone)]
pub enum GameUiAction {
    BlackjackHit,
    BlackjackStand,
    BlackjackDouble,
    BlackjackSplit,
    BlackjackInsurance,
    RouletteBet(RouletteBetType, u32),
    RouletteSpin,
    AndarBaharBet(AndarBaharSide, u32),
    AndarBaharDeal,
    SlotsSpin(u32),
    TicTacToeMove(u8),       // position 1-9
    ExitGameView,
}

/// Clickable region on screen, tracked per frame for mouse hit-testing.
#[derive(Debug, Clone)]
pub struct HitBox {
    pub rect: Rect,
    pub action: GameUiAction,
    pub label: String,          // display text for the button
    pub hotkey: Option<char>,   // keyboard shortcut shown as [X]
}
```

### Rendering entry point

```rust
/// Render the split game layout. Called from UiApp::render() when
/// state.active_game_view is Some.
///
/// Returns the list of clickable hit-boxes for mouse event handling.
pub fn render_game_layout(
    f: &mut Frame,
    area: Rect,
    state: &UiState,
    view: &ActiveGameView,
) -> Vec<HitBox> {
    // Split area horizontally: chat (40%) | game panel (60%)
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(35), Constraint::Percentage(65)])
        .split(area);

    // Render compressed chat in chunks[0] — reuse existing message rendering
    render_compressed_chat(f, chunks[0], state);

    // Render game panel in chunks[1]
    match view {
        ActiveGameView::Blackjack => render_blackjack_panel(f, chunks[1], state),
        ActiveGameView::Roulette => render_roulette_panel(f, chunks[1], state),
        ActiveGameView::AndarBahar => render_andarbahar_panel(f, chunks[1], state),
        ActiveGameView::Slots => render_slots_panel(f, chunks[1], state),
        ActiveGameView::TicTacToe => render_tictactoe_panel(f, chunks[1], state),
    }
}
```

### Per-game render functions

Each returns `Vec<HitBox>` and takes `(f: &mut Frame, area: Rect, state: &UiState)`.

```rust
fn render_blackjack_panel(f: &mut Frame, area: Rect, state: &UiState) -> Vec<HitBox> {
    let bj = match &state.blackjack_game { Some(g) => g, None => return vec![] };

    // Vertical split: title(1) | dealer area | player area | action bar(3) | wallet(1)
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(2),   // title
            Constraint::Min(7),      // dealer cards
            Constraint::Min(7),      // player cards
            Constraint::Length(3),   // action bar
            Constraint::Length(1),   // wallet
        ])
        .split(area);

    // Title
    let title = Paragraph::new("BLACKJACK")
        .alignment(Alignment::Center)
        .style(Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD));
    f.render_widget(title, chunks[0]);

    // Dealer cards — render_card_row()
    render_card_row(f, chunks[1], "Dealer", &bj.dealer_hand, !bj.dealer_revealed);

    // Player cards — find local player, render their hand
    // ... (finds player by state.local_peer_id)
    render_card_row(f, chunks[2], "You", &player_hand, false);

    // Action bar with hit-boxes
    render_action_bar(f, chunks[3], &blackjack_actions(bj))
}
```

### Card widget — ASCII art rendering

```rust
/// Render a row of ASCII cards into the given area.
/// Each card is 8 chars wide x 5 lines tall.
///
/// If `hide_first` is true, the first card shows a face-down back.
fn render_card_row(
    f: &mut Frame,
    area: Rect,
    label: &str,
    cards: &[Card],
    hide_first: bool,
) {
    // Card format (5 lines, 8 wide):
    //   .------.
    //   | K    |
    //   |  ♠   |
    //   |    K |
    //   '------'
    //
    // Face-down:
    //   .------.
    //   | ???? |
    //   | ???? |
    //   | ???? |
    //   '------'
    //
    // Cards laid out horizontally with 1-char gap.
    // Total width per card = 8 + 1 = 9 chars.
}

/// Build the 5 lines of text for a single card.
fn card_lines(card: &Card) -> [String; 5] {
    let v = &card.value;
    let s = &card.suit;
    let color = if card.is_red() { Color::Red } else { Color::White };
    [
        ".------. ".to_string(),
        format!("| {:<4} | ", v),
        format!("|  {}   | ", s),
        format!("| {:>4} | ", v),
        "'------' ".to_string(),
    ]
}

fn facedown_lines() -> [String; 5] {
    [
        ".------. ".to_string(),
        "| ???? | ".to_string(),
        "| ???? | ".to_string(),
        "| ???? | ".to_string(),
        "'------' ".to_string(),
    ]
}
```

### Action bar widget

```rust
/// Render a horizontal row of clickable action buttons.
/// Each button shows [H]otkey Label and registers a HitBox.
fn render_action_bar(
    f: &mut Frame,
    area: Rect,
    actions: &[(char, &str, GameUiAction)],
) -> Vec<HitBox> {
    let mut hitboxes = Vec::new();
    let btn_width = area.width / actions.len() as u16;

    for (i, (hotkey, label, action)) in actions.iter().enumerate() {
        let x = area.x + (i as u16 * btn_width);
        let btn_rect = Rect::new(x, area.y, btn_width, area.height);

        let text = format!("[{}]{}", hotkey.to_uppercase(), label);
        let btn = Paragraph::new(text)
            .alignment(Alignment::Center)
            .block(Block::default().borders(Borders::ALL).border_style(
                Style::default().fg(Color::Cyan),
            ));
        f.render_widget(btn, btn_rect);

        hitboxes.push(HitBox {
            rect: btn_rect,
            action: action.clone(),
            label: label.to_string(),
            hotkey: Some(*hotkey),
        });
    }

    hitboxes
}

/// Return the action buttons available for the current Blackjack state.
fn blackjack_actions(bj: &Blackjack) -> Vec<(char, &'static str, GameUiAction)> {
    let mut actions = vec![
        ('h', "it", GameUiAction::BlackjackHit),
        ('s', "tand", GameUiAction::BlackjackStand),
    ];
    // Conditionally add double/split/insurance based on game phase + hand
    if bj.phase == BlackjackPhase::Playing {
        actions.push(('d', "ouble", GameUiAction::BlackjackDouble));
        // split only if two cards of same value
    }
    actions.push(('q', "uit", GameUiAction::ExitGameView));
    actions
}
```

---

## 4. Event Handling

### Mouse integration

```rust
// In src/ui/mod.rs — modifications to UiApp

impl UiApp {
    pub fn new(/* ... */) -> Result<Self> {
        enable_raw_mode()?;
        let mut stdout = io::stdout();
        execute!(
            stdout,
            EnterAlternateScreen,
            crossterm::event::EnableMouseCapture,  // NEW
        )?;
        // ...
    }

    // Drop / cleanup:
    // execute!(stdout, LeaveAlternateScreen, DisableMouseCapture)?;
}
```

### Event loop changes in `run()`

```rust
pub async fn run(&mut self) -> Result<()> {
    let mut hitboxes: Vec<game_ui::HitBox> = Vec::new();

    loop {
        hitboxes = self.render()?;  // render now returns hitboxes

        while let Ok(event) = self.event_receiver.try_recv() {
            self.handle_network_event(event);
        }

        if event::poll(std::time::Duration::from_millis(50))? {
            match event::read()? {
                Event::Key(key) => {
                    // If game view active, check for hotkey actions first
                    if let Some(ref view) = self.state.active_game_view {
                        if let Some(action) = game_ui::match_hotkey(key, &hitboxes) {
                            self.dispatch_game_action(action).await;
                            continue;
                        }
                    }
                    // Fall through to existing keyboard handling
                    match (key.code, key.modifiers) {
                        // ... existing handlers unchanged ...
                    }
                }
                Event::Mouse(mouse) => {
                    if let Some(action) = game_ui::handle_mouse_event(mouse, &hitboxes) {
                        self.dispatch_game_action(action).await;
                    }
                }
                _ => {}
            }
        }
    }
}
```

### Mouse hit-testing

```rust
// In game_ui.rs

use crossterm::event::{MouseEvent, MouseEventKind, MouseButton, KeyEvent, KeyCode};

/// Check if a mouse click hits any registered button.
pub fn handle_mouse_event(
    event: MouseEvent,
    hitboxes: &[HitBox],
) -> Option<GameUiAction> {
    match event.kind {
        MouseEventKind::Down(MouseButton::Left) => {
            let col = event.column;
            let row = event.row;
            hitboxes.iter().find(|hb| {
                col >= hb.rect.x
                    && col < hb.rect.x + hb.rect.width
                    && row >= hb.rect.y
                    && row < hb.rect.y + hb.rect.height
            }).map(|hb| hb.action.clone())
        }
        _ => None,
    }
}

/// Check if a key press matches any hotkey in the current hitboxes.
pub fn match_hotkey(key: KeyEvent, hitboxes: &[HitBox]) -> Option<GameUiAction> {
    if let KeyCode::Char(c) = key.code {
        let lower = c.to_ascii_lowercase();
        hitboxes.iter().find(|hb| hb.hotkey == Some(lower)).map(|hb| hb.action.clone())
    } else {
        None
    }
}
```

---

## 5. State Management

### ActiveGameView in UiState

```rust
// Add to UiState struct:
pub struct UiState {
    // ... existing fields ...

    /// Which game panel to show. None = default chat-only layout.
    pub active_game_view: Option<game_ui::ActiveGameView>,
}
```

### Deriving the view from game state

The view is set explicitly on game start commands and cleared on game end. It is NOT auto-derived from `Option<Blackjack>` being `Some` — this allows the player to toggle the panel off while a game is still running and use slash commands instead.

```rust
impl UiState {
    /// Activate the game panel for the given game type.
    pub fn enter_game_view(&mut self, view: ActiveGameView) {
        self.active_game_view = Some(view);
    }

    /// Return to chat-only layout.
    pub fn exit_game_view(&mut self) {
        self.active_game_view = None;
    }

    /// Called when any game ends — clears the view if it matches.
    pub fn on_game_ended(&mut self, view: &ActiveGameView) {
        if self.active_game_view.as_ref() == Some(view) {
            self.active_game_view = None;
        }
    }
}
```

### Integration points

| Event | Sets view to | Trigger |
|---|---|---|
| `/bj start` or `/bj join` | `Some(Blackjack)` | In `handle_submit()` after creating `Blackjack` |
| `/roulette start` | `Some(Roulette)` | In `handle_submit()` |
| `/ab start` | `Some(AndarBahar)` | In `handle_submit()` |
| `/slots spin` | `Some(Slots)` | In `handle_submit()` |
| `/game challenge` accepted | `Some(TicTacToe)` | On game accept |
| Game settles / ends | `None` | In settlement handlers |
| Press `q` in game panel | `None` | Via `GameUiAction::ExitGameView` |
| `/game close` | `None` | Explicit command |

---

## 6. Rendering Pipeline

```
game.rs (state)       game_ui.rs (widgets)         mod.rs (orchestration)
================      ====================         ======================

Blackjack {           render_blackjack_panel()      render() {
  dealer_hand,    -->   reads bj.dealer_hand     <--   if active_game_view.is_some() {
  players,              builds card Lines              hitboxes = game_ui::render_game_layout(f, area, state, view);
  phase,                builds action bar              } else {
}                       returns Vec<HitBox>              // existing 3-pane layout
                                                       }
                                                     }
                                                     return hitboxes
```

### Data flow per frame (immediate mode, stateless)

1. `UiApp::render()` is called
2. Checks `state.active_game_view`
3. If `Some(view)`:
   - Splits terminal area: `[chat 35% | game 65%]` horizontally, then `[content | input 3]` vertically
   - Calls `game_ui::render_game_layout(f, content_area, &state, &view)` which returns `Vec<HitBox>`
   - Renders compressed chat in left column (same message list, just narrower)
   - Renders input bar spanning full width at bottom
   - Renders peers/rooms in right sidebar as usual (or hides if terminal < 100 cols)
4. If `None`: existing 3-pane render unchanged
5. The returned `Vec<HitBox>` is stored in the event loop for the next mouse/key event

### Render signature change

```rust
// Before:
fn render(&mut self) -> Result<()> { ... }

// After:
fn render(&mut self) -> Result<Vec<game_ui::HitBox>> {
    let mut hitboxes = Vec::new();
    self.terminal.draw(|f| {
        // ...
        if let Some(ref view) = self.state.active_game_view {
            hitboxes = game_ui::render_game_layout(f, content_area, &self.state, view);
        } else {
            // existing layout
        }
    })?;
    Ok(hitboxes)
}
```

---

## 7. ASCII Art Templates

### Playing cards (5-line compact)

```
Standard card:          Face-down:
.------.                .------.
| K    |                |//////|
|  ♠   |                |//////|
|    K |                |//////|
'------'                '------'

10 variant (wider value):
.------.
| 10   |
|  ♥   |
|   10 |
'------'
```

Card color: Red suits (heart/diamond) render with `Color::Red`, black suits with `Color::White`.

### Roulette table (compact)

```
.------------------------------------.
| 0 |  1  2  3 |  4  5  6 |  7  8  9|
|   | 10 11 12 | 13 14 15 | 16 17 18|
|   | 19 20 21 | 22 23 24 | 25 26 27|
|   | 28 29 30 | 31 32 33 | 34 35 36|
|   |  1st 12  |  2nd 12  |  3rd 12 |
|   | RED | BLK | ODD | EVN | LO|HI |
'------------------------------------'
```

Numbers are colored: red numbers in `Color::Red`, black in `Color::White`, 0 in `Color::Green`. When a result is shown, the winning number is highlighted with `Modifier::REVERSED`.

### Slot reels (3-reel display)

```
+=========+=========+=========+
|         |         |         |
| [CHR]   | [BEL]   | [ 7 ]   |
|         |         |         |
+=========+=========+=========+
```

Winning combinations: all three reels highlighted in `Color::Green` with `Modifier::BOLD`.

### Tic-Tac-Toe board

```
     1 | 2 | 3
    ---+---+---
     X | 5 | O
    ---+---+---
     7 | 8 | 9
```

Empty cells show their number (clickable). Filled cells show X or O. X in `Color::Cyan`, O in `Color::Magenta`. Available positions use `Color::DarkGray`.

### Andar Bahar

```
  Joker: [K♠]

  Andar:  A♥  3♦  7♣  2♠
  Bahar:  Q♦  5♥  9♣
```

Card symbols are inline (not full ASCII art) to save vertical space since Andar Bahar can deal many cards.

---

## 8. Action Bar Design

Every game panel reserves a 3-line region at the bottom for the action bar. Buttons are rendered as bordered cells with hotkey highlighting.

### Button rendering

```
+----------+----------+----------+----------+
| [H]it    | [S]tand  | [D]ouble | [Q]uit   |
+----------+----------+----------+----------+
```

- The hotkey character is rendered in `Color::Yellow` + `Modifier::BOLD`
- The rest of the label in `Color::White`
- Border in `Color::Cyan`
- On mouse hover (future): border changes to `Color::Yellow` (not in v1)

### Dual input model

Players can interact via either:

1. **Mouse click** on action bar buttons (hit-tested via `HitBox` rects)
2. **Hotkey press** (e.g., `h` for Hit) — matched by `match_hotkey()`
3. **Slash command** in the input bar (e.g., `/bj hit`) — existing flow unchanged

All three paths converge into `dispatch_game_action()`:

```rust
impl UiApp {
    async fn dispatch_game_action(&mut self, action: GameUiAction) {
        match action {
            GameUiAction::BlackjackHit => {
                // Same logic as handle_submit() for "/bj hit"
                if let Some(ref mut bj) = self.state.blackjack_game {
                    bj.player_hit(&self.state.local_peer_id);
                    // broadcast state, add system messages, etc.
                }
            }
            GameUiAction::ExitGameView => {
                self.state.exit_game_view();
            }
            // ... other actions
        }
    }
}
```

### Per-game action buttons

| Game | Phase | Buttons |
|---|---|---|
| Blackjack | Betting | `[B]et <amt>` `[Q]uit` |
| Blackjack | Playing | `[H]it` `[S]tand` `[D]ouble` `[P]lit`* `[Q]uit` |
| Blackjack | Settlement | `[N]ew round` `[Q]uit` |
| Roulette | Betting | `[R]ed` `[B]lack` `[O]dd` `[E]ven` `[L]ow` `[H]igh` `[S]pin` `[Q]uit` |
| Roulette | Spinning/Ended | `[N]ew round` `[Q]uit` |
| Andar Bahar | Betting | `[A]ndar` `[B]ahar` `[D]eal` `[Q]uit` |
| Slots | Ready | `[S]pin` `[Q]uit` |
| Tic-Tac-Toe | Playing | `[1]-[9]` move `[R]esign` `[Q]uit` |

*Split only shown when hand is splittable.

---

## 9. Transition Design

### Entering game view

```
User types "/bj start"
    |
    v
handle_submit() in mod.rs
    |-- creates Blackjack::new() as before
    |-- NEW: self.state.enter_game_view(ActiveGameView::Blackjack)
    |
    v
Next render() cycle
    |-- sees active_game_view == Some(Blackjack)
    |-- calls game_ui::render_game_layout() instead of default layout
    |-- returns hitboxes for mouse tracking
```

### Exiting game view

Three exit paths:

1. **Explicit exit**: Player presses `q` hotkey or clicks `[Q]uit` button
   - Fires `GameUiAction::ExitGameView`
   - Calls `state.exit_game_view()` — clears `active_game_view` to `None`
   - Game engine state is NOT cleared — game continues, just not shown in panel
   - Player can still use `/bj hit` etc. from the chat input

2. **Game ends naturally**: Settlement/ended phase
   - After displaying results for 1 render cycle, `on_game_ended()` clears the view
   - A system message summarizes the result in chat

3. **Toggle**: A new `/game panel` command toggles the panel on/off
   - If `active_game_view` is `None` and a game is active, it re-enters the view
   - If `active_game_view` is `Some`, it clears it

### Terminal resize handling

Ratatui handles resize automatically via immediate-mode rendering. The layout constraints use percentages and `Min`/`Length`, so the game panel adapts. If terminal width drops below 60 columns, the game panel takes the full width and chat is hidden (priority: game > chat when space is limited).

```rust
fn render_game_layout(f: &mut Frame, area: Rect, state: &UiState, view: &ActiveGameView) -> Vec<HitBox> {
    if area.width < 60 {
        // Full-width game panel, no chat column
        return render_game_panel_only(f, area, state, view);
    }
    // Normal split layout
    // ...
}
```

---

## 10. File Size Budget

| File | Current | After | Notes |
|---|---|---|---|
| `src/ui/mod.rs` | 2352 | ~2400 | +50 lines (mouse events, view branching, dispatch_game_action) |
| `src/ui/game_ui.rs` | 0 | ~450 | New file: all game widgets + action bar + ASCII art |
| `src/game.rs` | 2032 | 2032 | No changes — read-only consumption |

### `game_ui.rs` line budget

| Section | Lines |
|---|---|
| Imports + types (ActiveGameView, GameUiAction, HitBox) | ~40 |
| render_game_layout + render_compressed_chat | ~50 |
| render_blackjack_panel | ~60 |
| render_roulette_panel | ~50 |
| render_andarbahar_panel | ~40 |
| render_slots_panel | ~30 |
| render_tictactoe_panel | ~40 |
| card_lines / facedown_lines / render_card_row | ~60 |
| render_action_bar + per-game action definitions | ~50 |
| handle_mouse_event + match_hotkey | ~25 |
| Total | ~445 |

---

## 11. Key Struct and Trait Definitions (Pseudocode)

```rust
// ---- src/ui/game_ui.rs ----

use ratatui::{
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
    Frame,
};
use crossterm::event::{MouseEvent, MouseEventKind, MouseButton, KeyEvent, KeyCode};

use crate::game::*;
use super::UiState;

// --- Core Types ---

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActiveGameView {
    Blackjack,
    Roulette,
    AndarBahar,
    Slots,
    TicTacToe,
}

#[derive(Debug, Clone)]
pub enum GameUiAction {
    BlackjackHit,
    BlackjackStand,
    BlackjackDouble,
    BlackjackSplit,
    BlackjackInsurance,
    BlackjackBet(u32),
    BlackjackNewRound,
    RouletteBet(RouletteBetType, u32),
    RouletteSpin,
    RouletteNewRound,
    AndarBaharBetSide(AndarBaharSide, u32),
    AndarBaharDeal,
    SlotsSpin(u32),
    TicTacToeMove(u8),
    ExitGameView,
}

#[derive(Debug, Clone)]
pub struct HitBox {
    pub rect: Rect,
    pub action: GameUiAction,
    pub label: String,
    pub hotkey: Option<char>,
}

// --- Public API ---

pub fn render_game_layout(
    f: &mut Frame,
    area: Rect,
    state: &UiState,
    view: &ActiveGameView,
) -> Vec<HitBox>;

pub fn handle_mouse_event(
    event: MouseEvent,
    hitboxes: &[HitBox],
) -> Option<GameUiAction>;

pub fn match_hotkey(
    key: KeyEvent,
    hitboxes: &[HitBox],
) -> Option<GameUiAction>;

// --- Internal rendering (not pub) ---

fn render_compressed_chat(f: &mut Frame, area: Rect, state: &UiState);
fn render_blackjack_panel(f: &mut Frame, area: Rect, state: &UiState) -> Vec<HitBox>;
fn render_roulette_panel(f: &mut Frame, area: Rect, state: &UiState) -> Vec<HitBox>;
fn render_andarbahar_panel(f: &mut Frame, area: Rect, state: &UiState) -> Vec<HitBox>;
fn render_slots_panel(f: &mut Frame, area: Rect, state: &UiState) -> Vec<HitBox>;
fn render_tictactoe_panel(f: &mut Frame, area: Rect, state: &UiState) -> Vec<HitBox>;
fn render_card_row(f: &mut Frame, area: Rect, label: &str, cards: &[Card], hide_first: bool);
fn render_action_bar(f: &mut Frame, area: Rect, actions: &[(char, &str, GameUiAction)]) -> Vec<HitBox>;
fn card_lines(card: &Card) -> [String; 5];
fn facedown_lines() -> [String; 5];
```

### Changes to `src/ui/mod.rs`

```rust
// Add at top:
mod game_ui;

// Add to UiState:
pub active_game_view: Option<game_ui::ActiveGameView>,

// Initialize in UiState::new():
active_game_view: None,

// Add to UiApp::new() — enable mouse capture:
execute!(stdout, EnterAlternateScreen, crossterm::event::EnableMouseCapture)?;

// Add cleanup on drop/exit:
execute!(stdout, LeaveAlternateScreen, crossterm::event::DisableMouseCapture)?;

// Modify render() return type:
fn render(&mut self) -> Result<Vec<game_ui::HitBox>>

// Modify run() to store hitboxes and handle Event::Mouse

// Add dispatch_game_action():
async fn dispatch_game_action(&mut self, action: game_ui::GameUiAction)
```

---

## 12. Implementation Order

For coder agents, implement in this sequence:

1. **Phase 1 — Scaffolding**: Create `src/ui/game_ui.rs` with types (`ActiveGameView`, `GameUiAction`, `HitBox`) and stub functions. Add `mod game_ui;` to `mod.rs`. Add `active_game_view` field to `UiState`. Verify it compiles.

2. **Phase 2 — Mouse support**: Add `EnableMouseCapture`/`DisableMouseCapture` to terminal setup/teardown. Add `Event::Mouse` branch to the event loop. Implement `handle_mouse_event()` and `match_hotkey()`.

3. **Phase 3 — Layout split**: Implement `render_game_layout()` and `render_compressed_chat()`. Modify `render()` to branch on `active_game_view`. Wire up the hitbox return path.

4. **Phase 4 — Blackjack panel**: Implement `render_blackjack_panel()`, `render_card_row()`, `card_lines()`, `facedown_lines()`, and `render_action_bar()`. This is the most complex panel and establishes patterns for the others.

5. **Phase 5 — Other game panels**: Implement roulette, andar bahar, slots, and tic-tac-toe panels. Each reuses `render_action_bar()`.

6. **Phase 6 — Action dispatch**: Implement `dispatch_game_action()` in `mod.rs`, wiring hotkeys and mouse clicks to the same logic as existing slash commands.

7. **Phase 7 — Transitions**: Wire game start commands to call `enter_game_view()`, game end handlers to call `on_game_ended()`, and add the `/game panel` toggle command.
