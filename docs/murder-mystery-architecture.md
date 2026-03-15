# Architecture: Collaborative AI Murder Mystery Game Mode

**Status**: Proposed
**Author**: System Architecture Designer
**Date**: 2026-03-15
**Bounded Context**: MurderMystery (new)
**Shared Core**: GameEngine, PayoutEvent, AgentSwarm integration

---

## 1. System Overview

The Murder Mystery game mode is a multi-player social deduction game where human players interrogate AI-driven suspects to identify a culprit. It integrates two existing subsystems that have never been composed together before: the **GameEngine state machine** (from the casino games) and the **AgentSwarm AI pipeline** (from the pop-culture chat agents). The game engine manages phases, timers, and scoring while a specialized swarm orchestrator manages suspect AI generation with an additional critique-and-revision pipeline layered on top.

### Architectural Decision: Composition over Inheritance

The MurderMystery engine extends `GameEngine` (following the Blackjack/Roulette pattern) but does NOT extend `AgentSwarm`. Instead, it composes a dedicated `MysterySwarm` adapter that wraps the existing generation functions (`generateMessage`, `generateGeminiMessage`, etc.) with mystery-specific prompt construction and the violation-checking pipeline. This keeps the two bounded contexts decoupled -- the game engine owns state transitions and scoring, while the swarm adapter owns AI generation and character consistency.

```
                    +------------------+
                    |   ChatRoom.jsx   |  (Presentation Domain)
                    +--------+---------+
                             |
              +--------------+--------------+
              |                             |
   +----------v---------+       +----------v-----------+
   | useMysteryGame.js  |       | MysteryBoard.jsx     |
   | (React hook)       |       | (UI overlay)         |
   +----------+---------+       +----------+-----------+
              |                             |
   +----------v-----------------------------v-----------+
   |              mystery.js (Game Engine)              |
   |  State machine, phase transitions, scoring,       |
   |  mystery generation, clue distribution            |
   +----------+----------------------------------------+
              |
   +----------v-----------------------------------------+
   |          MysterySwarm (AI Pipeline Adapter)        |
   |  Prompt construction, violation checking,          |
   |  cross-contamination, generation orchestration     |
   +----------+-----------------------------------------+
              |
   +----------v-----------------------------------------+
   |  openrouter.js / gemini.js / qwen.js / haimaker.js|
   |  (Existing LLM generation functions)               |
   +----------------------------------------------------+
```

---

## 2. File Structure

All new files, organized per CLAUDE.md rules (no root folder saves, lib for logic, components for UI, hooks for React state, styles for CSS).

```
openwire-web/src/
  lib/
    mystery.js                    # Game engine (extends GameEngine)
    mystery/
      templates.js                # Procedural mystery templates
      suspects.js                 # Suspect generation & schema
      clues.js                    # Clue distribution algorithm
      scoring.js                  # Player scoring after reveal
    agents/
      mysterySwarm.js             # AI pipeline adapter for suspects
      violationBot.js             # Critique & revision pipeline
  hooks/
    useMysteryGame.js             # React hook (follows useBlackjackGame pattern)
  components/
    MysteryBoard.jsx              # Main game overlay
    mystery/
      SuspectCard.jsx             # Individual suspect visual card
      ClueNotebook.jsx            # Player's local clue notebook
      PhaseTimer.jsx              # Phase countdown display
      VotingPanel.jsx             # Accusation phase voting UI
      RevealOverlay.jsx           # Dramatic truth reveal
      MysteryChat.jsx             # Game chat with @mention targeting
  styles/
    mystery.css                   # All mystery-specific styles
```

**Total new files: 14** (6 lib, 1 hook, 6 components, 1 CSS).

---

## 3. Game Engine Design

### 3.1 State Machine

The `mystery.js` engine follows the exact pattern of `blackjack.js`: pure functions that take a game state object and return a new immutable state object. The host peer runs transitions and broadcasts state to other peers via `socket.sendRoomMessage()`.

```
Phase Diagram:

  lobby ──[enough players + host starts]──> generating
    |                                            |
    |                                    [mystery built]
    |                                            |
    v                                            v
  lobby <──[not enough players]──         investigation
                                               |
                                    [timer expires OR host advances]
                                               |
                                               v
                                         deliberation
                                               |
                                    [timer expires OR host advances]
                                               |
                                               v
                                          accusation
                                               |
                                    [all players voted OR timer expires]
                                               |
                                               v
                                            reveal
                                               |
                                    [players view results]
                                               |
                                               v
                                            ended
```

### 3.2 Game State Schema

```javascript
{
  type: 'mystery',
  roomId: string,
  hostPeerId: string,
  phase: 'lobby' | 'generating' | 'investigation' | 'deliberation' | 'accusation' | 'reveal' | 'ended',

  // Mystery definition (set during 'generating', immutable after)
  mystery: {
    id: string,                    // unique mystery instance id
    title: string,                 // e.g. "The Vanishing at Vineyard Manor"
    setting: string,               // location description
    victim: {
      name: string,
      role: string,                // e.g. "the host of the party"
      description: string,
    },
    weapon: string,                // e.g. "poisoned wine glass"
    motive: string,                // culprit's motive (hidden until reveal)
    culpritId: string,             // which suspect is the actual murderer
  },

  // AI suspects (4-6)
  suspects: [
    {
      id: string,                  // e.g. 'suspect_chef'
      name: string,                // e.g. "Chef Renard"
      role: string,                // e.g. "the victim's personal chef"
      avatar: string,              // emoji portrait
      personality: string,         // brief personality descriptor
      backstory: string,           // public backstory (shared with players)
      alibi: string,               // what they claim they were doing
      secret: string,              // hidden -- what they are hiding
      relationshipToVictim: string, // how they knew the victim
      isCulprit: boolean,
      // AI-only fields (NOT synced to non-host peers)
      _systemPrompt: string,       // full character card for LLM
      _secretConstraints: string[], // things the suspect must never reveal directly
      _crossClues: string[],       // clues about OTHER suspects planted in this suspect's context
    },
  ],

  // Players
  players: [
    {
      peer_id: string,
      nick: string,
      joinedAt: number,
      score: 0,                    // set during reveal phase
      vote: null | string,         // suspectId they voted for (set during accusation)
    },
  ],

  // Timing
  phaseStartedAt: number,
  phaseDuration: number,           // ms for current phase
  investigationDurationMs: 600000, // 10 min default (configurable 10-20 min)
  deliberationDurationMs: 180000,  // 3 min
  accusationDurationMs: 120000,    // 2 min

  // Interrogation log (game-scoped messages, separate from room chat)
  interrogations: [
    {
      id: string,
      timestamp: number,
      sender: string,              // player nick or suspect name
      senderType: 'player' | 'suspect',
      suspectId: string | null,    // which suspect this is directed at or from
      content: string,
      isRevised: boolean,          // true if violation bot rewrote this
    },
  ],

  // Scores (populated during reveal)
  results: {
    correctVoters: string[],       // peer_ids who guessed correctly
    scores: { [peer_id]: number }, // points per player
    totalQuestions: { [peer_id]: number }, // questions asked per player
  },

  createdAt: number,
}
```

### 3.3 Core Engine Functions (mystery.js)

Following the Blackjack pattern of pure, exported functions:

```
createGame(roomId, hostPeerId, config) -> gameState
addPlayer(game, peer_id, nick) -> gameState
removePlayer(game, peer_id) -> gameState
generateMystery(game) -> gameState              // async -- calls template engine
startInvestigation(game) -> gameState
addInterrogation(game, sender, suspectId, content, senderType) -> gameState
advanceToDeliberation(game) -> gameState
advanceToAccusation(game) -> gameState
castVote(game, peer_id, suspectId) -> gameState
revealTruth(game) -> gameState
calculateScores(game) -> gameState
migrateHost(game, departedPeerId) -> gameState | null
serializeGame(game) -> string                   // strips _systemPrompt, _secretConstraints, _crossClues
deserializeGame(data) -> gameState
isMysteryMessage(data) -> boolean               // prefix: 'MM:'
parseMysteryAction(data) -> object | null
serializeMysteryAction(action) -> string
```

### 3.4 MysteryEngine (GameEngine subclass)

```javascript
class MysteryEngine extends GameEngine {
    getGameState()        // returns this._game
    calculatePayout()     // N/A -- returns empty {} (non-financial game)
    getRules()            // returns mystery rules for HowToPlay
    calculateResults()    // returns NonFinancialEvent with player scores
}
registerGame('mystery', MysteryEngine);
```

---

## 4. AI Pipeline Design

### 4.1 MysterySwarm Adapter

The `mysterySwarm.js` module does NOT subclass or modify `AgentSwarm`. It is a standalone orchestrator that reuses the raw generation functions from `openrouter.js` / `gemini.js` / etc. This avoids coupling with the pop-culture character system.

```
Request Flow (single interrogation):

  Player sends: "@Chef Renard where were you at 9pm?"
       |
       v
  [1] MysterySwarm.generateResponse(suspectId, playerMessage, gameState)
       |
       v
  [2] Build suspect-specific system prompt
       - Character card (personality, backstory, alibi)
       - Secret constraints (what NEVER to reveal)
       - Cross-contamination clues (rumors about other suspects)
       - Conversation history (this suspect's interrogation thread)
       - Phase context (how much time remains, how many questions asked)
       |
       v
  [3] Call LLM generation function (provider-agnostic)
       - generateMessage() / generateGeminiMessage() / etc.
       - Model selection: reuse swarm's model pool or mystery-specific override
       |
       v
  [4] ViolationBot.check(suspectResponse, secretConstraints)
       - Hidden LLM call with a focused prompt:
         "Does this response reveal any of these secrets? [list]
          Does this response break character? [constraints]
          Return PASS or VIOLATION with explanation."
       |
       +-- PASS --> [6] Deliver response
       |
       +-- VIOLATION --> [5] RefinementBot.rewrite(...)
                              |
                              v
                         [5a] Second LLM call:
                              "Rewrite this response staying in character
                               while NOT revealing: [violated secrets]
                               Original: [text]
                               Conversation context: [history]"
                              |
                              v
                         [5b] Deliver rewritten response (flagged isRevised=true)
       |
       v
  [6] Response delivered to game state via addInterrogation()
       - Broadcast to all players via room message
```

### 4.2 Violation Bot (violationBot.js)

```javascript
// Core interface
async function checkViolation(response, secretConstraints, characterProfile) -> {
    passed: boolean,
    violations: string[],     // which constraints were violated
    severity: 'none' | 'mild' | 'critical',
}

async function refineResponse(originalResponse, violations, characterProfile, conversationHistory) -> string
```

The violation bot uses a cheaper/faster model (Gemini Flash Lite or the cheapest available free model) since it only needs to do classification, not creative generation. This keeps the per-interrogation cost low.

**Key design constraint**: The violation check is a classification task, not a generation task. The prompt is structured to return a structured JSON response (`{passed: true/false, violations: [...]}`) to minimize token usage and parsing complexity.

### 4.3 Cross-Contamination Algorithm

During mystery generation, the `clues.js` module distributes information asymmetrically:

```
For each suspect S:
  - S knows their own alibi, secret, and backstory (in their system prompt)
  - S has 1-2 "rumors" about OTHER suspects planted as _crossClues
  - These rumors are partial truths that encourage players to ask S about other suspects

Distribution rules:
  - The culprit knows something damning about at least one innocent suspect
    (red herring -- makes an innocent look guilty)
  - Each innocent suspect knows one partial clue about the culprit
    (no single innocent has the full picture)
  - At least one suspect has overheard a conversation between two others
    (encourages triangulation)
  - No suspect has enough information alone to solve the mystery
```

Example cross-contamination for a 5-suspect mystery:

```
Suspect A (culprit):  knows rumor about B's financial troubles
Suspect B (innocent): knows A was seen near the crime scene
Suspect C (innocent): knows B had an argument with the victim
Suspect D (innocent): overheard A and C whispering about something
Suspect E (innocent): knows D was hiding something about the victim's will
```

### 4.4 Emergent Rivalries

When a suspect's response mentions another suspect by name (detected via regex, same as the swarm's `@mention` chain in `swarm.js` lines 1120-1142), the system adds context to both suspects' future prompts:

```
If Chef Renard says: "You should ask the Gardener about what he was burning last night."
  -> Gardener's next prompt gets: "Chef Renard told investigators you were burning something last night. Deny, deflect, or counter-accuse."
```

This creates dynamic, emergent narrative threads without scripting specific interactions.

---

## 5. Data Models

### 5.1 Mystery Template Schema (templates.js)

```javascript
{
  id: string,                    // template identifier
  title: string,                 // mystery title (can include {victim} placeholders)
  setting: string,               // location description
  victimTemplates: [
    { name: string, role: string, description: string },
  ],
  weaponPool: string[],          // possible weapons
  motivePool: string[],          // possible motives
  suspectTemplates: [            // 6+ templates, 4-6 selected per game
    {
      namePool: string[],        // possible names for this archetype
      role: string,              // e.g. "the butler"
      avatar: string,
      personalityTraits: string[],
      alibiTemplates: string[],
      secretTemplates: string[], // parameterized secrets
      relationshipTemplates: string[],
    },
  ],
  clueDistributionRules: object, // how cross-clues are assigned
}
```

### 5.2 Suspect AI Profile (generated at runtime)

```javascript
{
  id: string,
  name: string,
  role: string,
  avatar: string,
  personality: string,
  backstory: string,
  alibi: string,
  secret: string,
  relationshipToVictim: string,
  isCulprit: boolean,

  // AI pipeline fields (host-only, stripped from P2P broadcasts)
  _systemPrompt: string,         // full LLM system prompt
  _secretConstraints: [          // things the violation bot checks
    "Never directly state that you poisoned the wine",
    "Never reveal that you were in the study at 9pm",
    "If asked about your relationship with the victim, deflect to your professional role",
  ],
  _crossClues: [                 // planted knowledge about other suspects
    "You overheard Gardener Marcel arguing with the victim about money two days ago",
    "You noticed Lady Ashworth's hands shaking at dinner -- she seemed nervous",
  ],
  _conversationHistory: [],      // accumulates as players interrogate
}
```

### 5.3 Clue Schema

```javascript
{
  id: string,
  type: 'physical' | 'testimony' | 'rumor' | 'document' | 'observation',
  content: string,               // the clue text
  source: string,                // which suspect or location revealed it
  pointsToward: string,          // suspectId this clue implicates (or 'red_herring')
  revealedTo: string[],          // player peer_ids who have seen this clue
  revealedAt: number,            // timestamp
}
```

### 5.4 Scoring Model

```javascript
// Points awarded during reveal phase
SCORING = {
  correctAccusation: 100,        // voted for the actual culprit
  wrongAccusation: 0,            // voted for an innocent
  questionsAskedBonus: 2,        // per interrogation question asked
  uniqueSuspectsBonus: 10,       // per unique suspect interrogated
  earlyVoteBonus: 25,            // voted correctly with >50% time remaining
  cluesDiscoveredBonus: 5,       // per unique clue uncovered
}
```

---

## 6. UI Component Hierarchy

```
MysteryBoard.jsx (root overlay -- 100vh x 100vw, overflow: hidden)
  |
  +-- PhaseTimer.jsx              (top bar: phase name + countdown)
  |
  +-- [LEFT PANEL: 30% width]
  |     |
  |     +-- SuspectCard.jsx x 4-6 (scrollable card list)
  |     |     - avatar emoji
  |     |     - name + role
  |     |     - "Interrogate" button (sets @mention target)
  |     |     - suspicion meter (local-only, player adjusts)
  |     |
  |     +-- ClueNotebook.jsx      (collapsible local notepad)
  |           - text area for player notes
  |           - auto-collected clue list (from interrogation highlights)
  |           - persisted to localStorage
  |
  +-- [CENTER: 50% width]
  |     |
  |     +-- MysteryChat.jsx       (game-scoped chat, NOT room chat)
  |           - shows interrogation history
  |           - @mention autocomplete for suspects
  |           - player messages + suspect AI responses
  |           - phase-specific UI:
  |               investigation: normal chat
  |               deliberation: "suspects are silent" banner
  |               accusation: voting prompt
  |
  +-- [RIGHT PANEL: 20% width]
        |
        +-- Player list (who is in the game)
        +-- Mystery brief (setting, victim info)
        +-- Phase progress indicator

  [OVERLAY: VotingPanel.jsx]      (shown during accusation phase)
    - suspect cards in a grid
    - click to vote
    - vote confirmation
    - live vote tally (anonymous until reveal)

  [OVERLAY: RevealOverlay.jsx]    (shown during reveal phase)
    - dramatic reveal animation
    - culprit highlighted
    - each suspect's secret revealed
    - score breakdown per player
    - "Play Again" button
```

### 6.1 Viewport Constraint

Per the project's global UI constraint (MEMORY.md), the MysteryBoard MUST fit within 100vh x 100vw with NO scrolling. The layout uses CSS Grid with fractional units:

```css
.mystery-board {
  display: grid;
  grid-template-columns: 30fr 50fr 20fr;
  grid-template-rows: auto 1fr;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}
```

The suspect card list and chat panel use internal scrolling (`overflow-y: auto` within their bounded containers), while the overall game frame never exceeds the viewport.

---

## 7. Message Protocol

### 7.1 Wire Format

Following the established pattern (Blackjack uses `BJ:` prefix, Tic-Tac-Toe uses `TTT:` prefix), Murder Mystery uses `MM:` prefix:

```javascript
// Sent via socket.sendRoomMessage(roomId, serializeMysteryAction(action))
function serializeMysteryAction(action) {
    return 'MM:' + JSON.stringify(action);
}

function isMysteryMessage(data) {
    return typeof data === 'string' && data.startsWith('MM:');
}

function parseMysteryAction(data) {
    if (!isMysteryMessage(data)) return null;
    try { return JSON.parse(data.slice(3)); } catch { return null; }
}
```

### 7.2 Action Types

```javascript
// Host -> All: Full state sync (sent after every state transition)
{ type: 'mm_state', state: serializedGameState }

// Player -> Host: Join the game
{ type: 'mm_join', peer_id, nick }

// Player -> Host: Leave the game
{ type: 'mm_leave', peer_id }

// Host -> All: Mystery generated, investigation begins
{ type: 'mm_start', state: serializedGameState }

// Player -> Host: Interrogation question
{ type: 'mm_question', peer_id, nick, suspectId, content }

// Host -> All: Suspect AI response
{ type: 'mm_response', suspectId, content, isRevised }

// Host -> All: Phase transition
{ type: 'mm_phase', phase, phaseStartedAt, phaseDuration }

// Player -> Host: Vote during accusation
{ type: 'mm_vote', peer_id, suspectId }

// Host -> All: Reveal results
{ type: 'mm_reveal', state: serializedGameState }

// Host -> All: Suspect typing indicator
{ type: 'mm_typing', suspectId, isTyping }
```

### 7.3 Security: State Serialization

When the host broadcasts game state, sensitive AI fields are stripped:

```javascript
function serializeGame(game) {
    return JSON.stringify({
        ...game,
        suspects: game.suspects.map(s => {
            const { _systemPrompt, _secretConstraints, _crossClues, _conversationHistory, ...safe } = s;
            return safe;
        }),
    });
}
```

Only the host peer retains the full suspect profiles (including system prompts and secrets). This prevents players from inspecting browser DevTools to see the answers.

---

## 8. Integration Points with Existing Systems

### 8.1 ChatRoom.jsx Integration

The mystery game follows the exact pattern of Blackjack/Roulette/Andar Bahar:

1. **Slash command**: `/mystery` launches the game (added to command handler around line 2008 of ChatRoom.jsx)
2. **React hook**: `useMysteryGame(gameDeps)` provides state and handlers (plugged in alongside `useBlackjackGame` at line 626)
3. **Lazy-loaded board**: `const MysteryBoard = lazyRetry(() => import('./MysteryBoard'))` (added alongside other board imports at line 36)
4. **Message routing**: `handleMysteryAction` called from the room message handler when `isMysteryMessage(data)` is true
5. **Game cleanup**: Added to `cleanupGameState()` (line 360) to reset mystery state on room switch
6. **State snapshots**: Added to the 5-second snapshot interval (line 733) for host migration

### 8.2 AgentSwarm Integration

The mystery game does NOT use the main `AgentSwarm` instance (which manages pop-culture characters). Instead:

- During a mystery game, the main swarm is **paused** in the game room (suspects replace regular agents)
- `MysterySwarm` is instantiated per-game by the host, using the same LLM provider and model pool that the main swarm has configured
- Provider selection (`openrouter` / `gemini` / `qwen` / `haimaker`) is read from the main swarm's current setting via `swarmRef.current.provider` and `swarmRef.current.defaultModel`
- When the mystery ends, the main swarm resumes

### 8.3 Wallet / Ledger Integration

The mystery game is **non-financial** (like Tic-Tac-Toe). It uses `createNonFinancialEvent()` from `PayoutEvent.js`:

```javascript
calculateResults(gameState) {
    return createNonFinancialEvent({
        gameType: 'mystery',
        roundId: gameState.mystery.id,
        resultLabel: `Mystery: ${gameState.mystery.title}`,
        playerStats: gameState.players.map(p => ({
            peer_id: p.peer_id,
            nick: p.nick,
            outcome: gameState.results.correctVoters.includes(p.peer_id) ? 'win' : 'loss',
        })),
    });
}
```

### 8.4 Host Election & Migration

Same deterministic election as other games: lowest `peer_id` alphabetically becomes host. The `migrateHost()` function follows the Blackjack pattern. Critical difference: the new host must regenerate suspect AI profiles (system prompts) since these are host-only state. The mystery template and suspect definitions are serialized in the broadcast state, so the new host can reconstruct `_systemPrompt` and `_secretConstraints` from the template data.

---

## 9. Phase-by-Phase Implementation Sequence

### Phase 1: Foundation (Engine + Templates)

**Files**: `mystery.js`, `mystery/templates.js`, `mystery/suspects.js`, `mystery/clues.js`, `mystery/scoring.js`

1. Implement game state schema and all pure state-transition functions
2. Build 3-5 mystery templates with parameterized suspects
3. Implement clue distribution algorithm
4. Implement scoring calculation
5. Register `MysteryEngine` with `GameEngine` registry
6. Write unit tests for all state transitions and scoring

**Acceptance**: All engine functions are pure, tested, and the state machine transitions are verified. No UI, no AI.

### Phase 2: AI Pipeline

**Files**: `agents/mysterySwarm.js`, `agents/violationBot.js`

1. Implement `MysterySwarm` adapter with suspect prompt construction
2. Implement violation checking (classification prompt + JSON parsing)
3. Implement response refinement (rewrite on violation)
4. Implement cross-contamination injection into suspect contexts
5. Implement emergent rivalry detection and context updates
6. Write integration tests with mocked LLM responses

**Acceptance**: Given a mystery state and a player question, the pipeline produces an in-character response that passes violation checks. Cross-contamination clues appear in suspect responses when relevant.

### Phase 3: React Hook + Message Protocol

**Files**: `hooks/useMysteryGame.js`

1. Implement `useMysteryGame` hook following `useBlackjackGame` pattern
2. Implement all message serialization/deserialization
3. Implement host-side state management (timers, phase transitions)
4. Implement non-host state sync (receive and apply `mm_state` broadcasts)
5. Wire into ChatRoom.jsx (slash command, message routing, cleanup)
6. Implement host migration

**Acceptance**: Two browser tabs can join a room, one hosts a mystery, state syncs correctly between them, phase transitions fire on time.

### Phase 4: UI Components

**Files**: `MysteryBoard.jsx`, `mystery/*.jsx`, `styles/mystery.css`

1. Build `MysteryBoard` with CSS Grid layout (100vh x 100vw, no scroll)
2. Build `SuspectCard` with avatar, name, role, interrogation button
3. Build `MysteryChat` with @mention autocomplete for suspects
4. Build `PhaseTimer` with countdown display
5. Build `ClueNotebook` with localStorage persistence
6. Build `VotingPanel` for accusation phase
7. Build `RevealOverlay` with dramatic reveal animation (CSS transforms only, no reflow)

**Acceptance**: Full visual game loop works in a single browser tab with mocked AI responses. Layout fits viewport on desktop and tablet. No scrollbars.

### Phase 5: Integration & Polish

1. Connect real LLM generation through `MysterySwarm`
2. Test multi-player scenarios (3+ players interrogating simultaneously)
3. Tune violation bot accuracy (adjust classification prompt)
4. Tune suspect personality distinctness (system prompt quality)
5. Add mystery to `/help` command list
6. Add to `anyGameActive` check in ChatRoom.jsx
7. Add typing indicators for suspects (`mm_typing` messages)
8. Performance audit: ensure AI pipeline does not block UI (all generation is async)

---

## 10. Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Suspect accidentally confesses** | High | Violation bot pipeline (Section 4.2). Two-pass generation: generate -> check -> refine if needed. |
| **AI response latency disrupts game flow** | Medium | Show typing indicators per-suspect. Queue questions and process serially. Use faster models (Gemini Flash Lite) for violation checks. |
| **Players inspect DevTools for answers** | Medium | Host-only retention of `_systemPrompt` and `_secretConstraints`. `serializeGame()` strips all AI fields before broadcast. |
| **Mystery too easy / too hard** | Medium | Tunable difficulty via template design: number of suspects, clue density, red herring count. Expose difficulty selector in lobby. |
| **Host migration loses AI state** | Medium | Store enough template data in broadcast state that new host can reconstruct system prompts. AI conversation history is in `interrogations[]` which IS synced. |
| **Token costs for violation checking** | Low | Violation bot uses cheapest available model. Classification prompt is ~200 tokens. Refinement only triggers on violations (~10% of responses based on prompt design). |
| **Emergent rivalry creates contradictions** | Low | Each suspect's _conversationHistory is maintained independently. Contradictions between suspects are a feature (creates investigative opportunities), not a bug. |

---

## 11. Technology Evaluation

| Concern | Decision | Rationale |
|---------|----------|-----------|
| **State management** | Pure functions + immutable state (Blackjack pattern) | Proven in codebase, enables host migration, testable |
| **AI generation** | Reuse existing `generateMessage()` family | No new dependencies, provider-agnostic, already handles rate limits |
| **Violation checking** | Separate LLM call (not regex/rules) | Natural language secrets require semantic understanding; regex would miss paraphrased confessions |
| **Real-time sync** | Room-scoped WebSocket messages (existing `socket.sendRoomMessage`) | Proven P2P-via-relay pattern, no new infrastructure |
| **Mystery generation** | Template + randomization (not fully LLM-generated) | Deterministic templates ensure solvability; LLM-generated mysteries risk unsolvable or incoherent puzzles |
| **UI framework** | React + CSS Grid (no new libraries) | Consistent with all other game boards in the codebase |

---

## 12. ADR: Why Template-Based Mysteries (Not Fully AI-Generated)

**Context**: We could either (A) use handcrafted templates with parameterized suspects and randomized selection, or (B) have an LLM generate the entire mystery on the fly.

**Decision**: Option A -- template-based with randomization.

**Rationale**:
1. **Solvability guarantee**: A template-designed mystery is guaranteed to have exactly one correct solution with a provably reachable deduction path. LLM-generated mysteries may create logical contradictions or unsolvable scenarios.
2. **Clue distribution control**: Cross-contamination requires precise control over which suspect knows what. Templates let us design this as a graph with guaranteed coverage. LLM generation would require a verification pass that is itself error-prone.
3. **Latency**: Template selection and parameterization takes <10ms. LLM mystery generation would take 5-15 seconds and require a "generating..." loading state.
4. **Cost**: Zero LLM cost for mystery generation. LLM costs are reserved for the interactive interrogation phase where they provide the most value.
5. **Extensibility**: New templates can be added as JSON objects without changing any logic. Community-contributed templates are possible.

**Trade-off accepted**: Less variety than fully generative mysteries. Mitigated by designing 10+ templates with high parameterization (name pools, weapon pools, motive pools, randomized clue distribution) giving thousands of effective combinations.
