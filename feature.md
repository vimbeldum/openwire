# OpenWire — Feature Expansion Technical Specification

**Version 1.0 • March 2026 • CONFIDENTIAL**

Reputation • Dead Drops • Bounties • Staking • Jackpot • Cosmetics • Tambola

---

## 0. Foundational Layer: Anonymous Persistent Identity

Every feature in this spec depends on recognizing a returning user without knowing who they are. This section defines the identity anchor that all other systems bind to.

### 0.1 Device Identity (deviceId)

On first visit, generate a v4 UUID and store it in localStorage under the key `openwire:device-id`. This deviceId is the primary key for all persistent data: wallet, reputation, cosmetics, streaks, mute states. The user never sees this value unless they inspect localStorage.

### 0.2 Storage Architecture

All persistent user data is stored under a single localStorage key to minimize storage calls and ensure atomic reads/writes:

```
Key:   openwire:profile:{deviceId}
Value: JSON object containing all user state
```

### 0.3 Profile Schema

```json
{
  "deviceId": "a1b2c3d4-...",
  "currentNick": "AnonymousUser42",
  "chips": 1000,
  "reputation": { "karma": 0, "tier": "newcomer", "history": [] },
  "cosmetics": { "owned": [], "equipped": {} },
  "vault": { "staked": 0, "stakedAt": null },
  "streak": { "count": 0, "lastLogin": null },
  "mutedAgents": [],
  "transactions": [],
  "createdAt": "2026-03-14T00:00:00Z"
}
```

### 0.4 Backup & Recovery

- **IndexedDB shadow copy** — mirror the profile to IndexedDB on every write as a backup if localStorage is cleared.
- **Optional passphrase export** — user can generate a passphrase (e.g., `mango-thunder-bicycle-seven`) that hashes to their deviceId. Entering the passphrase on a new device restores their profile from the relay server (if relay stores profile backups) or from a peer who has it cached.
- **Canvas/WebGL fingerprint** — optional secondary signal. If localStorage is wiped but fingerprint matches, prompt: "Welcome back? Restore your wallet?" User must opt in.

### 0.5 Relay Server Sync

When a user connects to the relay, their deviceId is sent as part of the handshake (hashed, never raw). The relay maintains a lightweight lookup mapping deviceId hashes to room state, chip balances, and reputation scores. This allows cross-session persistence even if the browser restarts.

The relay never stores the raw deviceId. It stores `SHA-256(deviceId)` as the key. The user's nick is transient and can change every session. Only the deviceId hash is persistent.

### 0.6 Privacy Guarantees

| Property | Guarantee |
|---|---|
| Nick → deviceId mapping | Never exposed to other users or the relay |
| deviceId | Random UUID, no PII, no browser fingerprinting by default |
| Relay storage | Only hashed deviceId, chips, karma, cosmetics. No IP logging beyond session. |
| Cross-room tracking | deviceId is consistent across rooms. Intentional for wallet/reputation portability. |
| Data deletion | User can call a "wipe identity" function that clears localStorage, IndexedDB, and sends a delete request to the relay. |

---

## 1. Reputation System

Anonymous but persistent karma system tied to deviceId. Karma accumulates from positive actions and decays from negative ones. High-karma users get visual flair visible to other room participants.

### 1.1 Karma Sources & Weights

| Event | Karma | Cooldown | Notes |
|---|---|---|---|
| Receive a tip | +2 per 100 chips | None | Scales linearly. Tip of 500 = +10 karma |
| Win a casino game | +3 | 1 per game type per hour | Prevents farming via rapid games |
| Receive emoji reaction | +1 | 1 per unique reactor per message | Same user reacting 5x = still +1 |
| Post upvoted dead drop | +2 per 5 upvotes | None | Threshold-based, not per-vote |
| Win a bounty/challenge | +5 | None | Community-voted, higher trust signal |
| Get kicked by admin | -10 | None | Punitive, immediate |
| Get IP-banned | -50 + tier reset | None | Severe, resets to "newcomer" |
| Daily login streak (7+) | +1 per day | Once per day | Rewards consistency |
| Idle decay | -1 per 7 days inactive | N/A | Prevents abandoned high-karma ghosts |

### 1.2 Karma Tiers & Visual Flair

| Tier | Karma Range | Name Color | Badge | Perks |
|---|---|---|---|---|
| Newcomer | 0–49 | Default (white/gray) | None | Base experience |
| Regular | 50–199 | Cyan (`#00D4FF`) | ★ | Access to Dead Drops posting |
| Trusted | 200–499 | Gold (`#FFD700`) | ★★ | Can create bounties, custom emoji slot |
| Legend | 500–999 | Purple (`#A855F7`) | ★★★ + animated glow | Name glow animation, priority in game lobbies |
| Mythic | 1000+ | Rainbow gradient (animated) | 👑 crown | Unique entry animation, AI agents greet them by nick |

### 1.3 Implementation Notes

- Karma and tier are stored in the profile object under `reputation.karma` and `reputation.tier`.
- Tier recalculation runs on every karma change (simple threshold check, no complex logic).
- Visual flair is applied client-side: the message renderer reads the sender's tier from the room's player list and applies the corresponding CSS class.
- The relay broadcasts karma-tier changes to the room so other clients update the sender's name color/badge in real time.
- Karma history (last 50 events) is stored for transparency. Users can view their own karma log.

### 1.4 Anti-Gaming Measures

- **Self-tipping** — blocked. `tip()` rejects `fromId === toId`.
- **Tip cycling** (A tips B, B tips A) — cooldown of 1 tip per pair per 10 minutes.
- **Reaction spam** — only 1 karma per unique reactor per message, regardless of how many reactions.
- **Alt account farming** — since deviceId is per-browser, alts require separate browsers/profiles. Acceptable trade-off for anonymity.

---

## 2. Dead Drops

Anonymous message board within a room. Posts are not attributed to any nick. This is double-anonymous: users are already anonymous in the chat, but Dead Drops strip even the nick, making posts truly untraceable within the room.

### 2.1 Data Model

```json
{
  "id": "dd_abc123",
  "roomId": "room_xyz",
  "body": "I think the AI agents are sentient.",
  "timestamp": "2026-03-14T14:30:00Z",
  "upvotes": 7,
  "downvotes": 2,
  "reactions": { "🔥": 3, "💀": 1 },
  "votedBy": ["hash(deviceId1)", "hash(deviceId2)"],
  "aiReactions": [
    { "characterId": "jethalal", "reaction": "Ae babuchak! Yeh toh sachchi baat hai!", "mood": "excited" }
  ]
}
```

### 2.2 Core Mechanics

- **Posting** — any user with karma >= 50 (Regular tier) can post. This prevents brand-new users from spamming. No nick, no avatar, no deviceId attached to the rendered post.
- **Voting** — each deviceId can upvote OR downvote each post once. The `votedBy` array stores hashed deviceIds to enforce this without revealing who voted.
- **Reactions** — emoji reactions work like regular chat reactions but are also anonymous (no reactor name shown).
- **AI Reactions** — AI agents in the room have a chance to "notice" highly-upvoted dead drops (threshold: 5+ upvotes) and post a character reaction. This is triggered relay-side, not by the posting user.

### 2.3 Persistence Strategy

Dead Drops are room-scoped and session-scoped by default. They persist as long as the room exists on the relay. Once the last user leaves the room and the room is garbage-collected, Dead Drops are destroyed.

- **Relay storage** — Dead Drops are stored in the relay's in-memory room state, same as chat messages.
- **Client cache** — each client caches Dead Drops in sessionStorage under `openwire:deaddrops:{roomId}`. On reconnect, the client merges its cache with the relay's state (relay is authoritative for vote counts).
- **No localStorage persistence** — Dead Drops are intentionally ephemeral. They do not survive room destruction. This aligns with the "anonymous confessions" vibe.

### 2.4 UI Specification

- **Dead Drop panel** — a collapsible sidebar or tab alongside the main chat. Toggle via a button in the chat toolbar.
- **Post rendering** — card-based layout. Each card shows the body text, timestamp (relative, e.g., "12 min ago"), upvote/downvote buttons with counts, emoji reaction bar, and any AI reactions.
- **New post input** — text area at the top of the panel with a "Drop It" button. Max 500 characters.
- **Sorting** — default by "Hot" (upvotes minus downvotes, time-weighted). Option to sort by "New" or "Top".
- **Rate limit** — max 3 Dead Drops per user per room per hour (enforced by hashed deviceId on relay).

### 2.5 Content Safety

- Dead Drops pass through the same XSS sanitizer (`stripDangerousTags`) as regular messages.
- Admin can toggle Dead Drops on/off per room from the admin portal.
- Reported drops (if reporting is implemented later) flag the post for admin review without revealing the author.

---

## 3. Challenges / Bounties

Users post chip-backed challenges. Others attempt them. The room votes on the winner. Chips transfer automatically. This creates a community-driven content and engagement loop.

### 3.1 Bounty Data Model

```json
{
  "id": "bounty_001",
  "roomId": "room_xyz",
  "creatorDeviceHash": "sha256(deviceId)",
  "creatorNick": "CoolGuy99",
  "description": "500 chips to whoever makes Jethalal break character",
  "reward": 500,
  "status": "open",
  "createdAt": "2026-03-14T15:00:00Z",
  "expiresAt": "2026-03-14T16:00:00Z",
  "submissions": [
    { "deviceHash": "sha256(...)", "nick": "TricksterX", "messageRef": "msg_abc", "votes": 4 }
  ],
  "votedBy": ["hash1", "hash2"],
  "winnerId": null
}
```

### 3.2 Lifecycle

**Phase 1 — Creation:** A user with karma >= 200 (Trusted tier) creates a bounty. The reward amount (min 100, max 5,000 chips) is immediately escrowed from their wallet. The bounty appears as a pinned announcement in the chat feed and the Dead Drops panel.

**Phase 2 — Submissions:** Any user in the room can submit an attempt by replying to the bounty message with `/submit` or clicking a "Submit Attempt" button. The submission references a specific chat message (the attempt). Max 5 submissions per user per bounty.

**Phase 3 — Voting:** Once at least 2 submissions exist (or the bounty timer hits the last 10 minutes), voting opens. Each deviceId gets 1 vote. Voting period is 10 minutes or until a submission reaches 60% of active room participants' votes (whichever comes first).

**Phase 4 — Resolution:** The submission with the most votes wins. Escrowed chips transfer to the winner. Creator gets +5 karma for running a bounty. Winner gets +5 karma. If no submissions or tied votes, chips return to the creator.

**Expiry:** Bounties expire after 1 hour if no submissions. Escrowed chips return to creator. Expired bounties are archived (not deleted) for the session.

### 3.3 Escrow Mechanism

When a bounty is created, the reward is deducted from the creator's wallet immediately and held in a bounty-specific escrow field on the relay. This prevents the creator from spending the chips elsewhere before resolution.

```
wallet.escrow(creatorDeviceHash, bountyId, amount)
  → deducts from wallet, adds to escrow map

wallet.releaseEscrow(bountyId, winnerDeviceHash)
  → moves escrowed amount to winner's wallet

wallet.refundEscrow(bountyId, creatorDeviceHash)
  → returns escrowed amount to creator (expiry/no winner)
```

### 3.4 Anti-Abuse

- **Self-voting** — blocked. Creator cannot vote on their own bounty's submissions.
- **Self-submission** — allowed (you can attempt your own bounty) but you cannot vote for yourself.
- **Collusion** — difficult to prevent in anonymous context. Mitigated by requiring 60% room vote threshold for early resolution.
- **Spam bounties** — limited to 2 active bounties per deviceId per room. Minimum reward of 100 chips.
- **Vote manipulation** — relay tracks deviceId hashes, not nicks. Changing nick does not grant extra votes.

---

## 4. Chip Staking / Vault

Users can lock chips in a vault to earn interest over time. Creates an incentive to not gamble everything immediately and gives chips a time-value dimension.

### 4.1 Mechanics

| Parameter | Value | Rationale |
|---|---|---|
| Minimum stake | 100 chips | Prevents trivial deposits |
| Interest rate | 2% per 24 hours (compound) | Attractive but not game-breaking |
| Lock period | None (withdraw anytime) | Low friction for anonymous users who might not return |
| Withdrawal penalty | Forfeit accrued interest if < 12 hours | Discourages rapid deposit/withdraw gaming |
| Maximum stake | 10,000 chips per deviceId | Prevents whales from inflating the economy |
| Interest source | Minted by the system (inflationary) | Relay generates chips. Offset by casino rake. |

### 4.2 Interest Calculation

Interest is calculated on-demand when the user checks their vault or withdraws. No background timer needed.

```javascript
function calculateInterest(principal, stakedAtTimestamp) {
  const hoursElapsed = (Date.now() - stakedAtTimestamp) / 3_600_000;
  const periods = hoursElapsed / 24; // compound every 24h
  const rate = 0.02; // 2% per 24h
  return Math.floor(principal * Math.pow(1 + rate, periods) - principal);
}
```

### 4.3 Data Model

```json
{
  "vault": {
    "staked": 500,
    "stakedAt": "2026-03-13T10:00:00Z",
    "totalInterestEarned": 42
  }
}
```

Stored in the user's profile object (localStorage + relay sync). The relay recalculates interest on every vault query to prevent client-side manipulation.

### 4.4 UI

- **Vault panel** — accessible from the wallet view. Shows staked amount, current interest accrued (live-updating), and time since stake.
- **Stake button** — opens a modal to enter stake amount. Validates against wallet balance and maximum stake limit.
- **Withdraw button** — shows the accrued interest and withdrawal penalty if applicable. Requires confirmation.
- Interest earned feeds into the casino ticker as a "Vault Interest: +X chips" event for the staking user.

### 4.5 Economic Balance

The 2% daily rate sounds aggressive but is balanced by the casino rake (see Section 5), tip economy, and bounty escrow. The maximum stake cap of 10,000 limits the maximum daily minting to 200 chips per user. With a room of 50 users all maxed, that's 10,000 new chips per day entering the economy, offset by an expected casino rake of 5% on all bets.

---

## 5. Jackpot Pool

Every casino game takes a small rake into a room-scoped jackpot pool. The jackpot pays out on specific trigger events. The casino ticker goes wild when it hits.

### 5.1 Rake Structure

| Game | Rake % | Rake Source | Notes |
|---|---|---|---|
| Blackjack | 3% of pot | Deducted from winner's payout | Per-hand, after settlement |
| Roulette | House edge (built-in) | Zero/double-zero slots | No explicit rake needed; jackpot gets 1% of all bets |
| Andar Bahar | 2% of pot | Deducted from winner's payout | Per-round |
| Tambola (new) | 5% of ticket price | Deducted at ticket purchase | Higher rake because prize pool is larger |

### 5.2 Jackpot Triggers

| Trigger | Payout | Odds / Condition |
|---|---|---|
| Royal Flush (if poker added) | 100% of jackpot | Extremely rare. Jackpot reset to 0. |
| Blackjack 21 on first 2 cards, 3x in a row | 50% of jackpot | Tracked per-player, resets on non-blackjack |
| Roulette: hit same number 2 spins in a row | 25% of jackpot | 1/37 chance per attempt |
| Tambola: Full House in under 30 numbers | 75% of jackpot | Skill + luck. Major event. |
| Random trigger | 10% of jackpot | 1 in 500 chance per game action. Keeps hope alive. |

### 5.3 Data Model

```json
{
  "jackpot": {
    "roomId": "room_xyz",
    "pool": 12450,
    "lastPayout": {
      "amount": 3000,
      "trigger": "roulette_repeat",
      "winner": "LuckyDog",
      "at": "2026-03-14T13:45:00Z"
    },
    "contributions": {
      "blackjack": 4200,
      "roulette": 5100,
      "andar_bahar": 1150,
      "tambola": 2000
    }
  }
}
```

### 5.4 Ticker Integration

When the jackpot is won, the casino ticker fires a special event with a distinct animation (gold coins, confetti, flashing text). The ticker message format:

```
🎰 [JACKPOT] LuckyDog hit the jackpot! +3,000 chips from Roulette Repeat! 🎰
```

Non-jackpot rake events are silent (no ticker). The ticker only fires on payouts and when the jackpot crosses round-number thresholds (e.g., "Jackpot pool now at 10,000 chips!").

AI agents in the room react to jackpot events with in-character messages (excitement, jealousy, congratulations depending on their personality and mood).

---

## 6. Cosmetic Shop

Purchasable visual customizations. All cosmetic, no gameplay advantage. **Critical design constraint: every item is one-of-one.** Once purchased, it is unavailable to all other users globally.

### 6.1 Item Categories

| Category | Examples | Price Range | Visibility |
|---|---|---|---|
| Bubble Style | Neon Green, Cyberpunk Red, Pastel Pink, Glassmorphism, Terminal Green-on-Black | 200–1,000 chips | Every message the user sends |
| Name Color | Specific hex colors or gradient definitions | 300–800 chips | Username in chat and player list |
| Custom Emoji | Unique reaction emoji only the owner can use (e.g., a custom Jethalal face) | 500–2,000 chips | Reaction bar on any message |
| Entry Animation | Flames, Matrix rain, Confetti burst, Lightning, Glitch effect | 1,000–3,000 chips | Plays when user joins a room |
| Chat Flair | Animated border on messages, sparkle effect, typing animation override | 800–2,500 chips | Persistent visual on all messages |

### 6.2 One-of-One Scarcity Model

Each cosmetic item has a globally unique ID and can only be owned by one deviceId at a time. This is the core differentiator from typical cosmetic shops.

**How It Works:**

- The relay maintains a **global cosmetic registry**: a map of `itemId → ownerDeviceHash` (or `null` if unclaimed).
- When a user purchases an item, the relay atomically checks availability, deducts chips, and assigns ownership.
- The shop UI shows items as "Available" or "Owned by someone" (never reveals the owner's nick or deviceId).
- Purchased items appear in the owner's `profile.cosmetics.owned` array.

**Resale / Trading:**

- Users can list owned cosmetics for resale at a price they set (minimum: 50% of original price).
- Other users can buy the listed item. The seller receives the sale price minus a **10% house cut** (which goes to the jackpot pool).
- This creates a secondary market that adds chip circulation and makes rare items actually valuable.

**Catalog Rotation:**

New cosmetics are added periodically (admin can add items via the admin portal). The catalog is stored on the relay and synced to clients on room join. Limited-edition items can have an `availableUntil` timestamp after which they can no longer be purchased (but remain owned by whoever bought them).

### 6.3 Data Model

```javascript
// Global registry (relay-side)
{
  "cosmetics:neon-green-bubble": {
    "id": "neon-green-bubble",
    "category": "bubbleStyle",
    "name": "Neon Green",
    "price": 500,
    "cssClass": "bubble-neon-green",
    "ownerDeviceHash": "sha256(deviceId)" | null,
    "purchasedAt": "2026-03-14T12:00:00Z" | null,
    "forSale": false,
    "resalePrice": null
  }
}

// User profile (client-side)
"cosmetics": {
  "owned": ["neon-green-bubble", "flames-entry"],
  "equipped": {
    "bubbleStyle": "neon-green-bubble",
    "entryAnimation": "flames-entry",
    "nameColor": null
  }
}
```

### 6.4 Rendering

When a message is broadcast, the sender's equipped cosmetics are included in the message metadata:

```json
"senderCosmetics": { "bubbleStyle": "bubble-neon-green", "nameColor": "#00ff00" }
```

The receiving client's message renderer applies these as CSS classes/inline styles. No lookup needed at render time. This works with the anonymous system because cosmetics travel with the message, not with the identity.

### 6.5 Anonymous Compatibility

- Other users see the visual effects but cannot reverse-engineer who owns what unless they observe the same cosmetics across sessions with the same nick (which is transient anyway).
- The shop UI shows "Owned by someone" not "Owned by CoolGuy99". The owner can flex their cosmetics by using them, not by having their name on it.
- If the user changes nick, their cosmetics still apply (bound to deviceId, not nick).

---

## 7. Tambola (Housie)

Indian-style Tambola (also known as Housie or Bingo). A room-wide multiplayer game where a caller draws numbers and players mark them on their tickets. Multiple prize categories keep everyone engaged even after someone wins early.

### 7.1 Game Rules

- Each ticket is a **3×9 grid** with 15 numbers (5 per row) placed in the standard Tambola distribution: column 1 has 1–9, column 2 has 10–19, ..., column 9 has 80–90.
- A caller (the host or auto-caller) draws numbers 1–90 without replacement.
- Players mark called numbers on their tickets.
- **Prizes:** Early Five (first to mark any 5 numbers), Top Line (first row complete), Middle Line (second row), Bottom Line (third row), Full House (all 15 numbers). Additional optional prizes: Four Corners, Breakfast (top line + number 1 or 90).

### 7.2 Game Flow

**1. Lobby:** Host creates a Tambola game from the game menu. Sets ticket price (50–500 chips) and prize split. Game appears as an in-chat invite.

**2. Ticket Purchase:** Players join by buying 1–3 tickets each. Tickets are auto-generated with valid Tambola distributions. Ticket price goes to the prize pool (minus 5% jackpot rake).

**3. Number Drawing:** Auto-caller draws a number every 5 seconds (configurable by host: 3s, 5s, 8s). The drawn number is broadcast to all players and announced in the chat feed.

**4. Marking:** Players click/tap numbers on their ticket as they are called. Auto-mark option available (marks automatically but the user must still claim prizes manually).

**5. Claims:** When a player completes a prize pattern, they click "Claim". The system validates the claim against the called numbers. If valid, the prize is awarded and announced. If bogus (numbers not yet called), the claim is rejected with a "Bogus Claim!" alert.

**6. End:** Game ends when Full House is claimed or all 90 numbers are drawn. Post-game summary shows all winners and payouts.

### 7.3 Prize Distribution

Default split (configurable by host):

| Prize | % of Pool | Example (10 players × 100 chips = 950 pool after rake) |
|---|---|---|
| Early Five | 10% | 95 chips |
| Top Line | 15% | 143 chips |
| Middle Line | 15% | 143 chips |
| Bottom Line | 15% | 143 chips |
| Full House | 45% | 426 chips |

If a prize is not claimed by the end (e.g., nobody gets Top Line before Full House), the unclaimed portion rolls into Full House.

### 7.4 Data Model

```json
{
  "id": "tambola_001",
  "roomId": "room_xyz",
  "hostDeviceHash": "sha256(...)",
  "status": "drawing",
  "ticketPrice": 100,
  "prizePool": 950,
  "calledNumbers": [42, 7, 88, 13],
  "drawInterval": 5000,
  "tickets": {
    "sha256(deviceId1)": [
      {
        "ticketId": "t_001",
        "grid": [
          [0, 12, 0, 34, 0, 56, 0, 78, 0],
          [1, 0, 23, 0, 45, 0, 67, 0, 89],
          [0, 15, 0, 38, 0, 59, 0, 0, 82]
        ],
        "marked": [12, 34, 78]
      }
    ]
  },
  "prizes": {
    "earlyFive": { "winner": null, "amount": 95 },
    "topLine": { "winner": null, "amount": 143 },
    "middleLine": { "winner": null, "amount": 143 },
    "bottomLine": { "winner": null, "amount": 143 },
    "fullHouse": { "winner": null, "amount": 426 }
  }
}
```

### 7.5 Ticket Generation Algorithm

Standard Tambola ticket rules:

- 3 rows, 9 columns.
- Each row has exactly 5 numbers and 4 blanks.
- Each column has at least 1 and at most 3 numbers.
- Column 1: numbers 1–9. Column 2: 10–19. ... Column 9: 80–90.
- Numbers within each column are sorted ascending top to bottom.

Generation algorithm:

1. For each column, randomly select 1–3 numbers from the column's range.
2. Distribute numbers across rows ensuring each row has exactly 5.
3. If constraints cannot be met, backtrack and regenerate (simple retry, typically succeeds in 1–2 attempts).
4. Sort numbers within each column ascending.
5. Fill remaining cells with 0 (blank).

### 7.6 UI Specification

- **Ticket display** — 3×9 grid with called numbers highlighted (green), uncalled numbers plain, blank cells empty. Each ticket is a compact card.
- **Number board** — a 9×10 grid (1–90) showing all called numbers highlighted. Acts as a reference.
- **Caller display** — large animated number reveal for each draw (like a bingo ball machine).
- **Claim buttons** — one per unclaimed prize, grayed out until the pattern is potentially complete.
- **Floating chat** — same as other games, minimized chat window while playing.
- **Sound effects** — optional call-out sounds for each number, winning jingle for claims.

### 7.7 AI Agent Integration

AI agents can participate as players (buying tickets with system-generated chips, not real economy). This fills games when fewer humans are available and adds personality:

- Jethalal gets excited when his numbers are called and complains loudly when they aren't.
- Agents do NOT have an unfair advantage (they mark numbers at the same rate as the auto-caller, not instantly).
- Agent claims are processed the same as human claims (can lose to a faster human claimer).

---

## 8. Cross-Feature Interaction Matrix

These features do not exist in isolation. This section maps how they interact with each other and with existing systems.

| Feature A | Feature B | Interaction |
|---|---|---|
| Reputation | Cosmetics | Higher-tier users see exclusive items in the shop (Mythic-only cosmetics). Karma tier is itself a cosmetic (name color, badge). |
| Reputation | Dead Drops | Minimum karma to post. Upvoted drops grant karma to the (hidden) author. |
| Reputation | Bounties | Minimum karma to create. Winning grants karma. |
| Reputation | Casino | Game wins grant karma. Getting banned wipes karma. |
| Cosmetics | Casino Ticker | Cosmetic purchases appear in the ticker: "[SHOP] Someone just bought Neon Green Bubble!" |
| Jackpot | Tambola | 5% of Tambola ticket sales go to jackpot. Full House under 30 numbers triggers jackpot. |
| Jackpot | Cosmetics | 10% resale fee goes to jackpot pool instead of house. |
| Staking/Vault | Bounties | Staked chips cannot be used for bounty escrow. Must withdraw first. |
| Dead Drops | AI Swarm | Agents react to popular drops. Drops can reference agents (becomes a bounty-like challenge). |
| Bounties | AI Swarm | "Break character" bounties specifically target AI agents. The swarm's character fidelity is the challenge. |
| Tambola | AI Swarm | Agents play as participants and commentate on the game in character. |
| All Features | Admin Portal | Admin can toggle each feature on/off per room. Admin can view all economy stats. |

---

## 9. Economy Balance Sheet

This section maps all chip sources (inflationary) and sinks (deflationary) to ensure the economy does not spiral.

### 9.1 Chip Sources (Inflation)

| Source | Rate | Cap |
|---|---|---|
| New user starting balance | 1,000 chips (one-time) | Per deviceId |
| Daily login bonus | 50 + (10 × streak_day), max 200 | 1 per day per deviceId |
| Vault interest | 2% per 24h on staked amount | Max 200 chips/day (10k stake cap) |
| System agents in Tambola | Agent ticket purchases are system-minted | Capped at 2 agent players per game |

### 9.2 Chip Sinks (Deflation)

| Sink | Rate | Notes |
|---|---|---|
| Casino rake (to jackpot) | 2–5% per game | Net negative EV for players |
| Cosmetic purchases | 200–3,000 chips (destroyed) | One-time. Chips leave circulation. |
| Cosmetic resale fee | 10% of resale price (to jackpot) | Secondary market tax |
| Bounty unclaimed expiry | 0% (refunded) | Not a sink but chips are frozen for 1hr |
| Staking withdrawal penalty | Forfeit interest if <12h | Minor sink on impatient users |

The primary balance lever is the casino rake. As long as players are actively gambling, chips leave circulation faster than vault interest creates them. The cosmetic shop acts as a secondary sink. Admins can adjust rake percentages and vault interest rates from the admin portal to tune the economy in real time.

---

## 10. Implementation Priority

Recommended build order based on dependency graph and value delivery:

| Phase | Features | Depends On |
|---|---|---|---|
| P0 (Foundation) | Anonymous Identity layer (Section 0), Daily Login Streak | Existing wallet.js |
| P1 (Core Economy) | Chip Staking/Vault, Jackpot Pool + Casino Rake | P0 (deviceId) |
| P2 (Social) | Reputation System, Dead Drops | P0 + P1 (karma from tips/games) |
| P3 (Engagement) | Bounties/Challenges, Cosmetic Shop | P2 (karma tiers gate bounty creation) |
| P4 (Game) | Tambola | P1 (jackpot rake), P0 (wallet) |
| P5 (Polish) | Cosmetic resale market, AI agent Tambola integration, Ticker enhancements | P3 + P4 |
