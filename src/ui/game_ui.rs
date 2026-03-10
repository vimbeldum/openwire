#![allow(dead_code)]
//! Game overlay UI for OpenWire TUI — renders casino games as centered overlays.

use crossterm::event::{KeyCode, KeyEvent, MouseButton, MouseEvent, MouseEventKind};
use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph},
    Frame,
};
use crate::game::{
    AndarBaharEngine, AndarBaharPhase, Blackjack, BlackjackPhase, Card, Cell, GameResult,
    RouletteEngine, RoulettePhase, SlotsEngine, TicTacToe,
};

const ROULETTE_REDS: &[u8] = &[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];

#[derive(Clone, PartialEq)]
pub enum ActiveGameView { None, Blackjack, Roulette, AndarBahar, Slots, TicTacToe }

pub enum GameKeyResult {
    Consumed,
    ExitOverlay,
    BroadcastAction(Vec<u8>),
    Ignored,
}

pub struct GameOverlay {
    pub view: ActiveGameView,
    pub visible: bool,
    pub button_areas: Vec<(String, Rect, char)>,
    pub bet_input: String,
    pub entering_bet: bool,
    pub anim_frame: u16,
    pub animating: bool,
}

impl GameOverlay {
    pub fn new() -> Self {
        Self {
            view: ActiveGameView::None, visible: false, button_areas: Vec::new(),
            bet_input: String::new(), entering_bet: false, anim_frame: 0, animating: false,
        }
    }
}

pub fn centered_rect(px: u16, py: u16, area: Rect) -> Rect {
    let v = Layout::default().direction(Direction::Vertical).constraints([
        Constraint::Percentage((100 - py) / 2), Constraint::Percentage(py),
        Constraint::Percentage((100 - py) / 2),
    ]).split(area);
    Layout::default().direction(Direction::Horizontal).constraints([
        Constraint::Percentage((100 - px) / 2), Constraint::Percentage(px),
        Constraint::Percentage((100 - px) / 2),
    ]).split(v[1])[1]
}

fn s(text: &str, color: Color) -> Span<'static> {
    Span::styled(text.to_string(), Style::default().fg(color))
}
fn sb(text: &str, color: Color) -> Span<'static> {
    Span::styled(text.to_string(), Style::default().fg(color).add_modifier(Modifier::BOLD))
}

/// Main entry point: render the game overlay on top of the chat
pub fn render_game_overlay(
    frame: &mut Frame, area: Rect, state: &crate::ui::UiState, overlay: &mut GameOverlay,
) {
    if !overlay.visible || overlay.view == ActiveGameView::None { return; }
    let popup = centered_rect(75, 85, area);
    frame.render_widget(Clear, popup);
    let title = match overlay.view {
        ActiveGameView::Blackjack => " BLACKJACK ", ActiveGameView::Roulette => " ROULETTE ",
        ActiveGameView::AndarBahar => " ANDAR BAHAR ", ActiveGameView::Slots => " SLOTS ",
        ActiveGameView::TicTacToe => " TIC-TAC-TOE ", ActiveGameView::None => "",
    };
    let outer = Block::default().title(title)
        .title_style(Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD))
        .borders(Borders::ALL).border_type(ratatui::widgets::BorderType::Double)
        .border_style(Style::default().fg(Color::Yellow));
    let inner = outer.inner(popup);
    frame.render_widget(outer, popup);
    let chunks = Layout::default().direction(Direction::Vertical)
        .constraints([Constraint::Min(3), Constraint::Length(3)]).split(inner);
    let bal = state.wallet.balance;
    overlay.button_areas.clear();
    match &overlay.view {
        ActiveGameView::Blackjack => { if let Some(g) = &state.blackjack_game { render_bj(frame, chunks[0], g, &state.local_peer_id, bal, overlay); } }
        ActiveGameView::Roulette => { if let Some(g) = &state.roulette_game { render_rl(frame, chunks[0], g, bal, overlay); } }
        ActiveGameView::AndarBahar => { if let Some(g) = &state.andarbahar_game { render_ab(frame, chunks[0], g, bal, overlay); } }
        ActiveGameView::Slots => { if let Some(g) = &state.slots_engine { render_sl(frame, chunks[0], g, bal, overlay); } }
        ActiveGameView::TicTacToe => { if let Some(g) = &state.active_game { render_ttt(frame, chunks[0], g, &state.local_peer_id, overlay); } }
        ActiveGameView::None => {}
    }
    render_action_bar(frame, chunks[1], overlay);
}

// ─── Card rendering ─────────────────────────────────────────────────────────

fn render_card_row(cards: &[Card], hidden: &[usize]) -> Vec<Line<'static>> {
    if cards.is_empty() { return vec![Line::from(""), Line::from("  (no cards)"), Line::from("")]; }
    let (mut ts, mut ms, mut bs): (Vec<Span>, Vec<Span>, Vec<Span>) = (vec![], vec![], vec![]);
    for (i, card) in cards.iter().enumerate() {
        if i > 0 { ts.push(Span::raw(" ")); ms.push(Span::raw(" ")); bs.push(Span::raw(" ")); }
        ts.push(Span::raw("┌──┐"));
        bs.push(Span::raw("└──┘"));
        if hidden.contains(&i) {
            ms.push(Span::styled("│░░│", Style::default().fg(Color::DarkGray)));
        } else {
            let col = if card.is_red() { Color::Red } else { Color::White };
            let v = if card.value == "10" { "T" } else { &card.value };
            ms.push(Span::styled(format!("│{}{}│", v, card.suit), Style::default().fg(col)));
        }
    }
    vec![Line::from(ts), Line::from(ms), Line::from(bs)]
}

fn prefix_card_lines(lines: &mut Vec<Line<'static>>, cards: &[Card], hidden: &[usize], pad: &str) {
    for cl in render_card_row(cards, hidden) {
        let mut v: Vec<Span<'static>> = vec![Span::raw(pad.to_string())];
        v.extend(cl.spans); lines.push(Line::from(v));
    }
}

// ─── Blackjack ──────────────────────────────────────────────────────────────

fn render_bj(f: &mut Frame, area: Rect, game: &Blackjack, my_id: &str, bal: u32, ov: &mut GameOverlay) {
    let mut l: Vec<Line<'static>> = vec![Line::from("")];
    let dh: Vec<usize> = if !game.dealer_revealed && game.dealer_hand.len() > 1 { vec![1] } else { vec![] };
    let dv = if game.dealer_revealed { format!("{}", Blackjack::calculate_hand(&game.dealer_hand)) }
        else if !game.dealer_hand.is_empty() { "?".into() } else { "-".into() };
    l.push(Line::from(vec![sb("  Dealer: ", Color::White), s(&format!("({})", dv), Color::DarkGray)]));
    prefix_card_lines(&mut l, &game.dealer_hand, &dh, "          ");
    l.push(Line::from(s("  ─────────────────────────────────────────", Color::DarkGray)));
    let me = game.players.iter().find(|p| p.peer_id == my_id);
    if let Some(p) = me {
        let hv = Blackjack::calculate_hand(&p.hand);
        l.push(Line::from(vec![
            sb("  You:    ", Color::Cyan), s(&format!("({})  ", hv), Color::White),
            s(&format!("Bet: ${}  ", p.bet), Color::Yellow), s(&format!("Bal: ${}", bal), Color::Green),
        ]));
        prefix_card_lines(&mut l, &p.hand, &[], "          ");
        if !p.split_hand.is_empty() {
            l.push(Line::from(s("  Split hand:", Color::Cyan)));
            prefix_card_lines(&mut l, &p.split_hand, &[], "          ");
        }
        l.push(Line::from(vec![Span::raw("  Status: "), s(p.status.display(), Color::Yellow)]));
    }
    l.push(Line::from(""));
    let pt = match &game.phase {
        BlackjackPhase::Betting => "Phase: BETTING", BlackjackPhase::Dealing => "Phase: DEALING",
        BlackjackPhase::Playing => "Phase: PLAYING", BlackjackPhase::Dealer => "Phase: DEALER",
        BlackjackPhase::Settlement => "Phase: SETTLEMENT", BlackjackPhase::Ended => "Round complete!",
    };
    l.push(Line::from(s(&format!("  {}", pt), Color::Magenta)));
    f.render_widget(Paragraph::new(l), area);
    let acts: Vec<(&str, char)> = match &game.phase {
        BlackjackPhase::Betting => if ov.entering_bet { vec![("Enter=Confirm",'\n'),("Esc=Cancel",'\x1b')] }
            else { vec![("Bet",'b'),("Deal",'d')] },
        BlackjackPhase::Playing => {
            let mut a = vec![("Hit",'h'),("Stand",'s')];
            if me.is_some_and(|p| p.hand.len() == 2 && !p.doubled_down) { a.push(("Double",'d')); }
            if me.is_some_and(|p| p.hand.len() == 2 && p.split_hand.is_empty() && p.hand[0].value == p.hand[1].value) { a.push(("sPlit",'p')); }
            a
        }
        BlackjackPhase::Ended => vec![("New round",'n')],
        _ => vec![],
    };
    register_actions(ov, &acts);
}

// ─── Roulette ───────────────────────────────────────────────────────────────

fn num_color(n: u8) -> Color {
    if n == 0 { Color::Green } else if ROULETTE_REDS.contains(&n) { Color::Red } else { Color::White }
}

fn render_rl(f: &mut Frame, area: Rect, game: &RouletteEngine, bal: u32, ov: &mut GameOverlay) {
    let mut l: Vec<Line<'static>> = vec![Line::from("")];
    l.push(Line::from(vec![Span::raw("    "), sb(" 0 ", Color::Green)]));
    l.push(Line::from(Span::raw("    ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐")));
    for row_offset in [3u8, 2, 1] {
        let mut sp: Vec<Span<'static>> = vec![Span::raw("    ")];
        for i in 0..12u8 {
            let n = i * 3 + row_offset;
            sp.push(Span::raw("│"));
            sp.push(Span::styled(format!("{:>2}", n), Style::default().fg(num_color(n))));
        }
        sp.push(Span::raw("│ ")); sp.push(s("2:1", Color::DarkGray));
        l.push(Line::from(sp));
    }
    l.push(Line::from(Span::raw("    └──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┘")));
    l.push(Line::from(vec![Span::raw("    │"), s(" 1st 12 ", Color::White), Span::raw("│"),
        s(" 2nd 12 ", Color::White), Span::raw("│"), s(" 3rd 12 ", Color::White), Span::raw("│")]));
    l.push(Line::from(vec![Span::raw("    │"), s("1-18", Color::White), Span::raw("│"),
        s("EVEN", Color::White), Span::raw("│"), s(" RED", Color::Red), Span::raw("│"),
        s("BLK ", Color::White), Span::raw("│"), s(" ODD", Color::White), Span::raw("│"),
        s("19-36", Color::White), Span::raw("│")]));
    l.push(Line::from(""));
    let rt = if let Some(n) = game.result {
        let cn = if n == 0 { "Green" } else if ROULETTE_REDS.contains(&n) { "Red" } else { "Black" };
        format!("  Result: * {} ({})  ", n, cn)
    } else { "  No result yet  ".into() };
    l.push(Line::from(vec![s(&format!("  Bets: {}  ", game.bets.len()), Color::White),
        s(&rt, Color::Yellow), s(&format!("Bal: ${}", bal), Color::Green)]));
    f.render_widget(Paragraph::new(l), area);
    let acts: Vec<(&str, char)> = match game.phase {
        RoulettePhase::Betting => if ov.entering_bet { vec![("Enter=Confirm",'\n'),("Esc=Cancel",'\x1b')] }
            else { vec![("Red",'r'),("blacK",'k'),("Odd",'o'),("Even",'e'),("#num",'#'),("Spin",' ')] },
        _ => vec![("Spin (new)", ' ')],
    };
    register_actions(ov, &acts);
}

// ─── Slots ──────────────────────────────────────────────────────────────────

fn render_sl(f: &mut Frame, area: Rect, eng: &SlotsEngine, bal: u32, ov: &mut GameOverlay) {
    let (r0, r1, r2) = (eng.reels[0].icon(), eng.reels[1].icon(), eng.reels[2].icon());
    let mut l: Vec<Line<'static>> = vec![Line::from(""), Line::from("")];
    l.push(Line::from(Span::raw("          ╔═══════╦═══════╦═══════╗")));
    l.push(Line::from(Span::raw("          ║       ║       ║       ║")));
    l.push(Line::from(vec![Span::raw("          ║ "), sb(&format!("{:^5}", r0), Color::Yellow),
        Span::raw(" ║ "), sb(&format!("{:^5}", r1), Color::Yellow),
        Span::raw(" ║ "), sb(&format!("{:^5}", r2), Color::Yellow), Span::raw(" ║")]));
    l.push(Line::from(Span::raw("          ║       ║       ║       ║")));
    l.push(Line::from(Span::raw("          ╚═══════╩═══════╩═══════╝")));
    l.push(Line::from(""));
    l.push(Line::from(vec![s(&format!("     Last Bet: ${}     ", eng.last_bet), Color::White),
        s(&format!("Balance: ${}", bal), Color::Green)]));
    if eng.last_bet > 0 {
        let o = if eng.last_payout > 0 { sb(&format!("     WIN! +${}", eng.last_payout), Color::Green) }
            else if eng.last_payout == 0 { s("     PUSH", Color::Yellow) }
            else { s(&format!("     LOSE ${}", -eng.last_payout), Color::Red) };
        l.push(Line::from(o));
    }
    f.render_widget(Paragraph::new(l), area);
    register_actions(ov, &[("$10",'1'),("$25",'2'),("$50",'3'),("$100",'4'),("Spin",' ')]);
}

// ─── Tic-Tac-Toe ────────────────────────────────────────────────────────────

fn render_ttt(f: &mut Frame, area: Rect, game: &TicTacToe, my_id: &str, ov: &mut GameOverlay) {
    let board = game.board;
    let (px, po) = (game.player_x.1.clone(), game.player_o.1.clone());
    let ct = game.current_turn;
    let result = game.result.clone();
    let my_cell = game.player_cell(my_id);
    let ct_nick = game.nick_for(ct).to_string();
    let win_nick = match &result { GameResult::Win(c) => game.nick_for(*c).to_string(), _ => String::new() };
    let (sx, so, sd) = (game.score.player_x_wins, game.score.player_o_wins, game.score.draws);

    let cd = |i: usize| -> Span<'static> { match board[i] {
        Cell::X => sb("  X  ", Color::Cyan), Cell::O => sb("  O  ", Color::Yellow),
        Cell::Empty => s(&format!("  {}  ", i+1), Color::DarkGray),
    }};
    let mut l: Vec<Line<'static>> = vec![Line::from("")];
    l.push(Line::from(vec![Span::raw("     "), sb(&px, Color::Cyan), Span::raw(" (X) vs "),
        sb(&po, Color::Yellow), Span::raw(" (O)")]));
    l.push(Line::from(""));
    l.push(Line::from(Span::raw("         ┌─────┬─────┬─────┐")));
    l.push(Line::from(vec![Span::raw("         │"),cd(0),Span::raw("│"),cd(1),Span::raw("│"),cd(2),Span::raw("│")]));
    l.push(Line::from(Span::raw("         ├─────┼─────┼─────┤")));
    l.push(Line::from(vec![Span::raw("         │"),cd(3),Span::raw("│"),cd(4),Span::raw("│"),cd(5),Span::raw("│")]));
    l.push(Line::from(Span::raw("         ├─────┼─────┼─────┤")));
    l.push(Line::from(vec![Span::raw("         │"),cd(6),Span::raw("│"),cd(7),Span::raw("│"),cd(8),Span::raw("│")]));
    l.push(Line::from(Span::raw("         └─────┴─────┴─────┘")));
    l.push(Line::from(""));
    let status = match &result {
        GameResult::InProgress => if my_cell == Some(ct) { format!("     Your turn ({}) -- press 1-9", ct.symbol()) }
            else { format!("     Waiting for {}...", ct_nick) },
        GameResult::Win(_) => format!("     {} wins!", win_nick),
        GameResult::Draw => "     Draw!".into(),
    };
    l.push(Line::from(s(&status, Color::Magenta)));
    l.push(Line::from(vec![Span::raw("     Score: "), s(&format!("X:{}", sx), Color::Cyan),
        Span::raw("  "), s(&format!("O:{}", so), Color::Yellow),
        Span::raw("  "), s(&format!("D:{}", sd), Color::DarkGray)]));
    f.render_widget(Paragraph::new(l), area);
    let mut acts: Vec<(&str, char)> = vec![("1-9 Move", '0')];
    if result != GameResult::InProgress { acts.push(("Rematch", 'r')); }
    register_actions(ov, &acts);
}

// ─── Andar Bahar ────────────────────────────────────────────────────────────

fn render_ab(f: &mut Frame, area: Rect, game: &AndarBaharEngine, bal: u32, ov: &mut GameOverlay) {
    let mut l: Vec<Line<'static>> = vec![Line::from("")];
    if let Some(j) = &game.joker {
        l.push(Line::from(sb("           Joker:", Color::White)));
        prefix_card_lines(&mut l, std::slice::from_ref(j), &[], "                  ");
    } else { l.push(Line::from(s("           Joker: (not dealt)", Color::DarkGray))); }
    l.push(Line::from(""));
    let as_: String = game.andar.iter().map(|c| format!("{} ", c.symbol())).collect();
    l.push(Line::from(vec![sb("  Andar:  ", Color::Cyan), s(&as_, Color::White)]));
    let bs_: String = game.bahar.iter().map(|c| format!("{} ", c.symbol())).collect();
    l.push(Line::from(vec![sb("  Bahar:  ", Color::Yellow), s(&bs_, Color::White)]));
    l.push(Line::from(""));
    l.push(Line::from(vec![s(&format!("  Cards dealt: {}     ", game.andar.len()+game.bahar.len()), Color::White),
        s(&format!("Bal: ${}", bal), Color::Green)]));
    if !game.bets.is_empty() {
        let bs: String = game.bets.iter().map(|b| format!("${} on {}", b.amount, b.side)).collect::<Vec<_>>().join(", ");
        l.push(Line::from(vec![s("  Bets: ", Color::Yellow), s(&bs, Color::White)]));
    }
    if let Some(w) = &game.result {
        l.push(Line::from(sb(&format!("  RESULT: {} wins!", w), Color::Green)));
    }
    f.render_widget(Paragraph::new(l), area);
    let acts: Vec<(&str, char)> = match game.phase {
        AndarBaharPhase::Betting => if ov.entering_bet { vec![("Enter=Confirm",'\n'),("Esc=Cancel",'\x1b')] }
            else { vec![("Andar",'a'),("Bahar",'b'),("Deal",'d')] },
        AndarBaharPhase::Dealing => vec![],
        AndarBaharPhase::Ended => vec![("Deal (new)",'d')],
    };
    register_actions(ov, &acts);
}

// ─── Action bar ─────────────────────────────────────────────────────────────

fn register_actions(ov: &mut GameOverlay, actions: &[(&str, char)]) {
    for (l, k) in actions { ov.button_areas.push((l.to_string(), Rect::default(), *k)); }
    ov.button_areas.push(("Esc=Chat".into(), Rect::default(), '\x1b'));
}

fn render_action_bar(f: &mut Frame, area: Rect, ov: &mut GameOverlay) {
    let blk = Block::default().borders(Borders::TOP).border_style(Style::default().fg(Color::Yellow));
    let inner = blk.inner(area);
    f.render_widget(blk, area);
    let mut spans: Vec<Span<'static>> = vec![Span::raw("  ")];
    let mut xo = inner.x + 2;
    for entry in ov.button_areas.iter_mut() {
        let (label, key) = (&entry.0, entry.2);
        let disp = if key == ' ' { format!("[Space]{}", label) }
            else if key == '\n' || key == '\x1b' { label.clone() }
            else if key == '0' { label.clone() }
            else { format!("[{}]{}", key.to_uppercase(), label) };
        let w = disp.len() as u16;
        entry.1 = Rect::new(xo, inner.y, w, 1);
        xo += w + 2;
        if key != '\n' && key != '\x1b' && key != '0' {
            let ks = if key == ' ' { "[Space]".into() } else { format!("[{}]", key.to_uppercase()) };
            spans.push(sb(&ks, Color::Yellow));
            spans.push(s(label, Color::White));
        } else { spans.push(s(&disp, Color::DarkGray)); }
        spans.push(Span::raw("  "));
    }
    f.render_widget(Paragraph::new(Line::from(spans)), inner);
}

// ─── Key event handler ──────────────────────────────────────────────────────

pub fn handle_game_key(
    key: KeyEvent, overlay: &mut GameOverlay,
) -> GameKeyResult {
    if key.code == KeyCode::Esc {
        if overlay.entering_bet { overlay.entering_bet = false; overlay.bet_input.clear(); return GameKeyResult::Consumed; }
        return GameKeyResult::ExitOverlay;
    }
    if overlay.entering_bet {
        return match key.code {
            KeyCode::Char(c) if c.is_ascii_digit() => { if overlay.bet_input.len() < 7 { overlay.bet_input.push(c); } GameKeyResult::Consumed }
            KeyCode::Backspace => { overlay.bet_input.pop(); GameKeyResult::Consumed }
            KeyCode::Enter => { overlay.entering_bet = false; GameKeyResult::Consumed }
            _ => GameKeyResult::Consumed,
        };
    }
    match key.code {
        KeyCode::Char(c) => match &overlay.view {
            ActiveGameView::Blackjack => match c {
                'h'|'s'|'d'|'p'|'i'|'n' => GameKeyResult::Consumed,
                'b' => { overlay.entering_bet = true; overlay.bet_input.clear(); GameKeyResult::Consumed }
                _ => GameKeyResult::Ignored,
            },
            ActiveGameView::Roulette => match c {
                'r'|'k'|'o'|'e'|'#' => { overlay.entering_bet = true; overlay.bet_input.clear(); GameKeyResult::Consumed }
                ' ' => GameKeyResult::Consumed,
                _ => GameKeyResult::Ignored,
            },
            ActiveGameView::Slots => match c { ' '|'1'..='5' => GameKeyResult::Consumed, _ => GameKeyResult::Ignored },
            ActiveGameView::TicTacToe => match c { '1'..='9'|'r' => GameKeyResult::Consumed, _ => GameKeyResult::Ignored },
            ActiveGameView::AndarBahar => match c {
                'a'|'b' => { overlay.entering_bet = true; overlay.bet_input.clear(); GameKeyResult::Consumed }
                'd' => GameKeyResult::Consumed,
                _ => GameKeyResult::Ignored,
            },
            ActiveGameView::None => GameKeyResult::Ignored,
        },
        _ => GameKeyResult::Ignored,
    }
}

// ─── Mouse event handler ────────────────────────────────────────────────────

pub fn handle_game_mouse(mouse: MouseEvent, overlay: &GameOverlay) -> Option<char> {
    if let MouseEventKind::Down(MouseButton::Left) = mouse.kind {
        let (x, y) = (mouse.column, mouse.row);
        for (_, r, k) in &overlay.button_areas {
            if x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height { return Some(*k); }
        }
    }
    None
}
