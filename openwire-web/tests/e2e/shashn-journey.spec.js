/**
 * Shashn Journey E2E Tests
 *
 * End-to-end WebSocket-mocked tests covering the Shashn game lifecycle:
 *   board opening via sidebar, deal-phase waiting labels, floating chat,
 *   board close and chat continuity.
 *
 * M004/S01/T01: Add deterministic SHASN journey proof coverage
 */
import { test, expect } from '@playwright/test';
import {
    mockWebSocket,
    loginAs,
    setWallet,
    injectWelcome,
    injectShashnStart,
    injectShashnState,
    injectShashnJoin,
    makeShashnGame,
} from './helpers.js';

// ── Shared setup ─────────────────────────────────────────────

async function setupWithRoom(page) {
    await mockWebSocket(page);
    await loginAs(page, 'TestUser');
    await setWallet(page, 5000);
    await page.goto('/');
    await page.waitForSelector('.chat-layout');

    // Inject a welcome message so myIdRef and nickRef are populated
    await injectWelcome(page);

    // Inject a room so the Shashn button has a room_id to use
    await page.evaluate(() => {
        const ws = window.__wsMock?.active;
        if (ws) {
            ws._injectMessage(JSON.stringify({
                type: 'room_created',
                room_id: 'test-room-001',
                name: 'TestRoom',
            }));
        }
    });
    // Wait for the room to be active in the sidebar
    await page.waitForSelector('.room-item.active', { timeout: 3000 });
}

// ═══════════════════════════════════════════════════════════════
//  1. Shashn Board Opening via Sidebar
// ═══════════════════════════════════════════════════════════════

test.describe('Shashn Board Opening', () => {
    test.beforeEach(async ({ page }) => {
        await setupWithRoom(page);
    });

    test('Shashn button exists in sidebar games section', async ({ page }) => {
        const shashnBtn = page.locator('.sidebar-btn', { hasText: 'Shashn' });
        await expect(shashnBtn).toBeVisible();
    });

    test('clicking Shashn button opens the board with deal phase', async ({ page }) => {
        // Click the Shashn button in the sidebar
        const shashnBtn = page.locator('.sidebar-btn', { hasText: 'Shashn' });
        await expect(shashnBtn).toBeVisible();
        await shashnBtn.click();

        // ShashnBoard should render (not wrapped in .game-overlay — it renders directly)
        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 5000 });

        // Should show the title
        await expect(page.locator('.shashn-title')).toContainText('Shashn');

        // Phase should show "Waiting for players..."
        await expect(page.locator('.shashn-phase')).toContainText('Waiting for players');
    });

    test('board shows "Waiting for second player..." when only host joined', async ({ page }) => {
        const shashnBtn = page.locator('.sidebar-btn', { hasText: 'Shashn' });
        await shashnBtn.click();

        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 5000 });

        // Only the host (TestUser) has joined, so show second-player waiting text
        await expect(page.locator('.shashn-waiting-text')).toContainText('Waiting for second player');
    });

    test('board renders player slots with join status', async ({ page }) => {
        const shashnBtn = page.locator('.sidebar-btn', { hasText: 'Shashn' });
        await shashnBtn.click();

        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 5000 });

        // Two player slots should be present
        const playerSlots = page.locator('.shashn-player');
        const count = await playerSlots.count();
        expect(count).toBe(2);

        // First slot has our nick (active)
        const firstPlayer = playerSlots.nth(0);
        await expect(firstPlayer).toContainText('TestUser');

        // Second slot should say "Waiting..."
        const secondPlayer = playerSlots.nth(1);
        await expect(secondPlayer).toContainText('Waiting...');
    });

    test('board shows Close and Help buttons', async ({ page }) => {
        const shashnBtn = page.locator('.sidebar-btn', { hasText: 'Shashn' });
        await shashnBtn.click();

        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 5000 });

        // Footer buttons
        const footer = page.locator('.shashn-footer');
        await expect(footer).toBeVisible();

        // Help button
        await expect(footer.locator('.shashn-btn-help')).toBeVisible();
        await expect(footer.locator('.shashn-btn-help')).toContainText('Help');

        // Close button
        await expect(footer.locator('.shashn-btn-close')).toBeVisible();
        await expect(footer.locator('.shashn-btn-close')).toContainText('✕');
    });
});

// ═══════════════════════════════════════════════════════════════
//  2. Floating Chat While Board Is Open
// ═══════════════════════════════════════════════════════════════

test.describe('Floating Chat During Shashn', () => {
    test.beforeEach(async ({ page }) => {
        await setupWithRoom(page);

        // Open Shashn board first
        const shashnBtn = page.locator('.sidebar-btn', { hasText: 'Shashn' });
        await shashnBtn.click();
        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 5000 });
    });

    test('floating chat button appears when board is open', async ({ page }) => {
        const floatBtn = page.locator('.floating-chat-btn');
        await expect(floatBtn).toBeVisible();
        await expect(floatBtn).toHaveAttribute('aria-label', 'Toggle floating chat');
    });

    test('clicking floating chat button opens the chat panel', async ({ page }) => {
        // Floating chat panel should not be visible initially
        await expect(page.locator('.floating-chat-panel')).not.toBeVisible();

        // Toggle chat on
        const floatBtn = page.locator('.floating-chat-btn');
        await floatBtn.click();

        // Chat panel should now be visible
        await expect(page.locator('.floating-chat-panel')).toBeVisible();
        await expect(page.locator('.floating-chat-header')).toContainText('Chat');
    });

    test('floating chat includes close button and input', async ({ page }) => {
        // Open the floating chat
        await page.locator('.floating-chat-btn').click();
        await expect(page.locator('.floating-chat-panel')).toBeVisible();

        // Close button in floating chat header
        const closeBtn = page.locator('.floating-chat-header button');
        await expect(closeBtn).toBeVisible();
        await expect(closeBtn).toHaveAttribute('aria-label', 'Close floating chat');

        // Chat input inside floating chat
        await expect(page.locator('.floating-chat-input input[type="text"]')).toBeVisible();
    });

    test('closing floating chat hides the panel', async ({ page }) => {
        // Open then close
        await page.locator('.floating-chat-btn').click();
        await expect(page.locator('.floating-chat-panel')).toBeVisible();

        await page.locator('.floating-chat-header button').click();
        await expect(page.locator('.floating-chat-panel')).not.toBeVisible();
    });

    test('floating chat badge is visible when there are unread messages', async ({ page }) => {
        // After welcome, the system adds messages which should appear in floating chat
        await page.evaluate(() => {
            const ws = window.__wsMock?.active;
            if (ws) {
                ws._injectMessage(JSON.stringify({
                    type: 'welcome',
                    peer_id: 'test-peer-001',
                    nick: 'TestUser',
                    peers: [],
                    rooms: [{ room_id: 'test-room-001', name: 'TestRoom' }],
                }));
            }
        });
        await page.waitForTimeout(300);

        // Badge should appear on the floating chat button
        const badge = page.locator('.floating-chat-badge');
        await expect(badge).toBeVisible();
    });
});

// ═══════════════════════════════════════════════════════════════
//  3. Board Closing and Chat Continuity
// ═══════════════════════════════════════════════════════════════

test.describe('Shashn Board Closing', () => {
    test.beforeEach(async ({ page }) => {
        await setupWithRoom(page);

        // Open Shashn board
        const shashnBtn = page.locator('.sidebar-btn', { hasText: 'Shashn' });
        await shashnBtn.click();
        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 5000 });
    });

    test('clicking close button dismisses board', async ({ page }) => {
        // Close the board
        await page.locator('.shashn-btn-close').click();
        await expect(page.locator('.shashn-container')).not.toBeVisible();
    });

    test('floating chat button disappears when board is closed', async ({ page }) => {
        // Close the board
        await page.locator('.shashn-btn-close').click();
        await expect(page.locator('.shashn-container')).not.toBeVisible();

        // Floating chat button should also be gone since no game is active
        const floatBtn = page.locator('.floating-chat-btn');
        await expect(floatBtn).not.toBeVisible();
    });

    test('chat layout is intact after closing the board', async ({ page }) => {
        await page.locator('.shashn-btn-close').click();
        await expect(page.locator('.shashn-container')).not.toBeVisible();

        // Core chat surface should still be present
        await expect(page.locator('.chat-layout')).toBeVisible();
        await expect(page.locator('.chat-header')).toBeVisible();
        await expect(page.locator('.chat-input')).toBeVisible();
        await expect(page.locator('.messages-area')).toBeVisible();
    });

    test('opening and closing board does not cause scroll overflow', async ({ page }) => {
        await page.locator('.shashn-btn-close').click();
        await expect(page.locator('.shashn-container')).not.toBeVisible();

        const noOverflow = await page.evaluate(() => {
            return (
                document.documentElement.scrollHeight <= window.innerHeight &&
                document.documentElement.scrollWidth <= window.innerWidth
            );
        });
        expect(noOverflow).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════
//  4. Invite from Peer (receiving shashn_start as non-host)
// ═══════════════════════════════════════════════════════════════

test.describe('Shashn Invite Reception', () => {
    test.beforeEach(async ({ page }) => {
        await setupWithRoom(page);
    });

    test('receiving shashn_start shows game_invite message in chat', async ({ page }) => {
        // Inject a shashn_start from a remote host
        await injectShashnStart(page, {
            roomId: 'test-room-001',
            host: 'host-peer-999',
            hostNick: 'HostUser',
        });

        // Wait for the invite inline component to render
        await page.waitForTimeout(500);

        // Should appear as a game_invite message
        await expect(page.locator('.game-invite-inline')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.game-invite-join')).toBeVisible();
        await expect(page.locator('.game-invite-join')).toContainText('Join');
    });

    test('invite message shows host nickname and shashn game type', async ({ page }) => {
        await injectShashnStart(page, {
            roomId: 'test-room-001',
            host: 'host-peer-999',
            hostNick: 'HostUser',
        });

        await page.waitForTimeout(500);

        await expect(page.locator('.game-invite-text')).toContainText('HostUser');
        await expect(page.locator('.game-invite-text')).toContainText('Shashn');
    });

    test('Join Table button appears on invite message', async ({ page }) => {
        await injectShashnStart(page, {
            roomId: 'test-room-001',
            host: 'host-peer-999',
            hostNick: 'HostUser',
        });

        await page.waitForTimeout(500);

        // The game_invite button with Join Table text
        const joinBtn = page.locator('.game-invite-join');
        await expect(joinBtn).toBeVisible();
        await expect(joinBtn).toContainText('Join');
    });
});

// ═══════════════════════════════════════════════════════════════
//  5. Play Phase State (receiving shashn_state as non-host)
// ═══════════════════════════════════════════════════════════════

/**
 * Accept (click Join on) a shashn game_invite message so the guard
 * (!hasJoinedShashn.current && shashnHostRef.current !== myIdRef.current)
 * does not block subsequent shashn_state injections.
 */
async function acceptShashnInvite(page) {
    const joinBtn = page.locator('.game-invite-join');
    await expect(joinBtn).toBeVisible({ timeout: 3000 });
    await joinBtn.click();
    await page.waitForTimeout(200);
}

test.describe('Shashn State Reception', () => {
    test.beforeEach(async ({ page }) => {
        await setupWithRoom(page);

        // First receive an invite so hasJoinedShashn is set up
        await injectShashnStart(page, {
            roomId: 'test-room-001',
            host: 'host-peer-999',
            hostNick: 'HostUser',
        });

        // Accept the invite so the state guard does not block
        await acceptShashnInvite(page);
    });

    test('shashn_state with play phase shows board and turn label', async ({ page }) => {
        // Inject a shashn_state with play phase — the board should render
        await injectShashnState(page, {
            roomId: 'test-room-001',
            peerId: 'host-peer-999',
            state: makeShashnGame({
                phase: 'play',
                trumpSuit: 'Hearts',
                players: [
                    { peer_id: 'test-peer-001', nick: 'TestUser', hand: [{ rank: '7', suit: 'Spades', id: '7S' }, { rank: 'K', suit: 'Diamonds', id: 'KD' }], tricksWon: 0, score: 0 },
                    { peer_id: 'host-peer-999', nick: 'HostUser', hand: [{ rank: 'Q', suit: 'Clubs', id: 'QC' }], tricksWon: 0, score: 0 },
                ],
                currentPlayer: 0, // TestUser's turn
                round: 1,
                trickNumber: 1,
                log: ['🎴 Shashn started! Trump: Hearts'],
            }),
        });

        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 5000 });
        // Phase label should indicate it's TestUser's turn
        await expect(page.locator('.shashn-phase')).toContainText(/Your turn/i);
    });

    test('shashn_state shows opponent turn when currentPlayer is not me', async ({ page }) => {
        await injectShashnState(page, {
            roomId: 'test-room-001',
            peerId: 'host-peer-999',
            state: makeShashnGame({
                phase: 'play',
                trumpSuit: 'Spades',
                players: [
                    { peer_id: 'test-peer-001', nick: 'TestUser', hand: [{ rank: '7', suit: 'Spades', id: '7S' }], tricksWon: 0, score: 0 },
                    { peer_id: 'host-peer-999', nick: 'HostUser', hand: [{ rank: 'A', suit: 'Hearts', id: 'AH' }], tricksWon: 0, score: 0 },
                ],
                currentPlayer: 1, // HostUser's turn
                round: 1,
                trickNumber: 1,
            }),
        });

        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.shashn-phase')).toContainText(/Opponent.*turn/i);
    });

    test('shashn_state in trick_end phase shows Trick complete! label and Collect button', async ({ page }) => {
        await injectShashnState(page, {
            roomId: 'test-room-001',
            peerId: 'host-peer-999',
            state: makeShashnGame({
                phase: 'trick_end',
                trumpSuit: 'Spades',
                players: [
                    { peer_id: 'test-peer-001', nick: 'TestUser', hand: [{ rank: 'K', suit: 'Diamonds', id: 'KD' }], tricksWon: 1, score: 1 },
                    { peer_id: 'host-peer-999', nick: 'HostUser', hand: [{ rank: '7', suit: 'Hearts', id: '7H' }], tricksWon: 0, score: 0 },
                ],
                currentTrick: {
                    cards: [
                        { player: 0, card: { rank: 'A', suit: 'Spades', id: 'AS' } },
                        { player: 1, card: { rank: 'Q', suit: 'Spades', id: 'QS' } },
                    ],
                    leadSuit: 'Spades',
                    winner: 0,
                },
                currentPlayer: 0,
                round: 1,
                trickNumber: 1,
            }),
        });

        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.shashn-phase')).toContainText('Trick complete!');

        // Collect Trick button should be visible (host processes, non-host sees state)
        const collectBtn = page.locator('.shashn-trick-actions button');
        await expect(collectBtn).toBeVisible();
    });
});

// ═══════════════════════════════════════════════════════════════
//  6. Open and Close Continuity
// ═══════════════════════════════════════════════════════════════

test.describe('Open / Close Continuity', () => {
    test.beforeEach(async ({ page }) => {
        await setupWithRoom(page);
    });

    test('close board then reopen via sidebar button restarts fresh', async ({ page }) => {
        // First open
        const shashnBtn = page.locator('.sidebar-btn', { hasText: 'Shashn' });
        await shashnBtn.click();
        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 5000 });

        // Close it
        await page.locator('.shashn-btn-close').click();
        await expect(page.locator('.shashn-container')).not.toBeVisible();

        // Click again — fresh session
        await shashnBtn.click();
        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 5000 });

        // Should be a fresh game in deal phase waiting for second player
        await expect(page.locator('.shashn-waiting-text')).toContainText('Waiting for second player');
    });

    test('opening shashn via sidebar while already open just keeps board open', async ({ page }) => {
        const shashnBtn = page.locator('.sidebar-btn', { hasText: 'Shashn' });
        await shashnBtn.click();
        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 5000 });

        // Click Shashn button again while board is open
        // The onClick handler checks shashnRef.current and does not restart
        await shashnBtn.click();

        // Board should still be visible (not re-created)
        await expect(page.locator('.shashn-container')).toBeVisible();
    });
});

// ═══════════════════════════════════════════════════════════════
//  7. Game State Continuity
// ═══════════════════════════════════════════════════════════════

test.describe('Game State Continuity', () => {
    test.beforeEach(async ({ page }) => {
        await setupWithRoom(page);
    });

    test('board-to-chat-back with invite still visible', async ({ page }) => {
        // Receive a shashn_start invite while board not open
        await injectShashnStart(page, {
            roomId: 'test-room-001',
            host: 'host-peer-999',
            hostNick: 'HostUser',
        });

        // The invite message should appear
        await expect(page.locator('.game-invite-inline')).toBeVisible({ timeout: 5000 });

        // Re-click shashn in sidebar — startShashn triggers as host since we have no ref
        const shashnBtn = page.locator('.sidebar-btn', { hasText: 'Shashn' });
        await shashnBtn.click();
        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 5000 });

        // Close it
        await page.locator('.shashn-btn-close').click();
        await expect(page.locator('.shashn-container')).not.toBeVisible();

        // Chat layout should still be intact
        await expect(page.locator('.chat-layout')).toBeVisible();

        // The invite message should still be in the chat area
        await expect(page.locator('.game-invite-inline')).toBeVisible();
    });
});

// ═══════════════════════════════════════════════════════════════
//  8. Round End and Game End Phase State
// ═══════════════════════════════════════════════════════════════

test.describe('Shashn Round End / Game End Phase State', () => {
    test.beforeEach(async ({ page }) => {
        await setupWithRoom(page);

        // Receive invite so hasJoinedShashn is set up
        await injectShashnStart(page, {
            roomId: 'test-room-001',
            host: 'host-peer-999',
            hostNick: 'HostUser',
        });

        // Accept the invite so the state guard does not block
        await acceptShashnInvite(page);
    });

    test('shashn_state in round_end phase shows "Round over!" label', async ({ page }) => {
        await injectShashnState(page, {
            roomId: 'test-room-001',
            peerId: 'host-peer-999',
            state: makeShashnGame({
                phase: 'round_end',
                trumpSuit: 'Spades',
                players: [
                    { peer_id: 'test-peer-001', nick: 'TestUser', hand: [], tricksWon: 3, score: 42 },
                    { peer_id: 'host-peer-999', nick: 'HostUser', hand: [], tricksWon: 2, score: 38 },
                ],
                currentPlayer: 0,
                round: 2,
                trickNumber: 0,
            }),
        });

        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 5000 });
        // Phase label should indicate round over
        await expect(page.locator('.shashn-phase')).toContainText('Round over');
    });

    test('shashn_state in game_end phase shows "Game Over!" label and winner banner', async ({ page }) => {
        await injectShashnState(page, {
            roomId: 'test-room-001',
            peerId: 'host-peer-999',
            state: makeShashnGame({
                phase: 'game_end',
                trumpSuit: 'Clubs',
                winner: 'test-peer-001',
                players: [
                    { peer_id: 'test-peer-001', nick: 'TestUser', hand: [], tricksWon: 6, score: 150 },
                    { peer_id: 'host-peer-999', nick: 'HostUser', hand: [], tricksWon: 0, score: 80 },
                ],
                currentPlayer: 0,
                round: 5,
                trickNumber: 6,
            }),
        });

        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 5000 });
        // Phase label should show Game Over!
        await expect(page.locator('.shashn-phase')).toContainText('Game Over');

        // Winner banner should show the winner's nick
        await expect(page.locator('.shashn-winner')).toBeVisible();
        await expect(page.locator('.shashn-winner')).toContainText('TestUser');
        await expect(page.locator('.shashn-winner')).toContainText('Wins');
    });

    test('game_end phase shows New Round button when below max rounds', async ({ page }) => {
        await injectShashnState(page, {
            roomId: 'test-room-001',
            peerId: 'host-peer-999',
            state: makeShashnGame({
                phase: 'game_end',
                trumpSuit: 'Hearts',
                winner: 'test-peer-001',
                players: [
                    { peer_id: 'test-peer-001', nick: 'TestUser', hand: [], tricksWon: 6, score: 150 },
                    { peer_id: 'host-peer-999', nick: 'HostUser', hand: [], tricksWon: 0, score: 80 },
                ],
                round: 3,
                trickNumber: 6,
            }),
        });

        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 5000 });
        // New Round button should appear when game.round < 10
        const newRoundBtn = page.locator('.shashn-play-area button', { hasText: 'New Round' });
        await expect(newRoundBtn).toBeVisible();
    });
});

// ═══════════════════════════════════════════════════════════════
//  9. State Summary After Board Close
// ═══════════════════════════════════════════════════════════════

test.describe('Shashn State Summary Continuity', () => {
    test.beforeEach(async ({ page }) => {
        await setupWithRoom(page);

        // Set up game state via sidebar as host
        const shashnBtn = page.locator('.sidebar-btn', { hasText: 'Shashn' });
        await shashnBtn.click();
        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 5000 });
    });

    test('state summary bar appears when board is closed with active game', async ({ page }) => {
        // Close the board
        await page.locator('.shashn-btn-close').click();
        await expect(page.locator('.shashn-container')).not.toBeVisible();

        // State summary should be visible
        await expect(page.locator('.shashn-state-summary')).toBeVisible();
        await expect(page.locator('.shashn-state-summary')).toContainText('Waiting for');
    });

    test('state summary shows Open Board button', async ({ page }) => {
        await page.locator('.shashn-btn-close').click();
        await expect(page.locator('.shashn-container')).not.toBeVisible();

        const openBoardBtn = page.locator('.shashn-open-board-btn');
        await expect(openBoardBtn).toBeVisible();
        await expect(openBoardBtn).toContainText('Open Board');
    });

    test('clicking Open Board in state summary reopens the board', async ({ page }) => {
        await page.locator('.shashn-btn-close').click();
        await expect(page.locator('.shashn-container')).not.toBeVisible();

        // Click Open Board
        await page.locator('.shashn-open-board-btn').click();

        // Board should reopen
        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 3000 });
        // Game state should be preserved (still in deal phase waiting for second player)
        await expect(page.locator('.shashn-waiting-text')).toContainText('Waiting for second player');
    });

    test('state summary shows opponent name and round info in play phase', async ({ page }) => {
        // First need to set up via invite (as non-host) to get a play phase with opponent
        // Close initial board
        await page.locator('.shashn-btn-close').click();
        await expect(page.locator('.shashn-container')).not.toBeVisible();

        // Receive invite from remote host
        await injectShashnStart(page, {
            roomId: 'test-room-001',
            host: 'host-peer-999',
            hostNick: 'HostUser',
        });

        // Inject play phase state — this also opens the board automatically
        await injectShashnState(page, {
            roomId: 'test-room-001',
            peerId: 'host-peer-999',
            state: makeShashnGame({
                phase: 'play',
                trumpSuit: 'Hearts',
                players: [
                    { peer_id: 'test-peer-001', nick: 'TestUser', hand: [{ rank: '7', suit: 'Spades', id: '7S' }, { rank: 'K', suit: 'Diamonds', id: 'KD' }], tricksWon: 0, score: 0 },
                    { peer_id: 'host-peer-999', nick: 'HostUser', hand: [{ rank: 'Q', suit: 'Clubs', id: 'QC' }], tricksWon: 0, score: 0 },
                ],
                currentPlayer: 0,
                round: 1,
                trickNumber: 1,
            }),
        });

        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 5000 });

        // Close the board
        await page.locator('.shashn-btn-close').click();
        await expect(page.locator('.shashn-container')).not.toBeVisible();

        // State summary should show "Your turn!" badge
        await expect(page.locator('.shashn-state-summary')).toBeVisible();
        await expect(page.locator('.shashn-state-summary')).toContainText('Your turn');

        // Should show opponent name
        await expect(page.locator('.shashn-state-summary')).toContainText('HostUser');

        // Open Board button should be present
        await expect(page.locator('.shashn-open-board-btn')).toBeVisible();
    });

    test('state summary shows trick_end status after close', async ({ page }) => {
        // Close initial host board
        await page.locator('.shashn-btn-close').click();
        await expect(page.locator('.shashn-container')).not.toBeVisible();

        // Receive invite + state with trick_end phase
        await injectShashnStart(page, {
            roomId: 'test-room-001',
            host: 'host-peer-999',
            hostNick: 'HostUser',
        });

        await injectShashnState(page, {
            roomId: 'test-room-001',
            peerId: 'host-peer-999',
            state: makeShashnGame({
                phase: 'trick_end',
                trumpSuit: 'Spades',
                players: [
                    { peer_id: 'test-peer-001', nick: 'TestUser', hand: [{ rank: 'K', suit: 'Diamonds', id: 'KD' }], tricksWon: 1, score: 5 },
                    { peer_id: 'host-peer-999', nick: 'HostUser', hand: [{ rank: '7', suit: 'Hearts', id: '7H' }], tricksWon: 0, score: 0 },
                ],
                currentTrick: {
                    cards: [{ player: 0, card: { rank: 'A', suit: 'Spades', id: 'AS' } }, { player: 1, card: { rank: 'Q', suit: 'Spades', id: 'QS' } }],
                    leadSuit: 'Spades',
                    winner: 0,
                },
                currentPlayer: 0,
                round: 1,
                trickNumber: 2,
            }),
        });

        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 5000 });

        // Close and check summary
        await page.locator('.shashn-btn-close').click();
        await expect(page.locator('.shashn-container')).not.toBeVisible();

        await expect(page.locator('.shashn-state-summary')).toBeVisible();
        await expect(page.locator('.shashn-state-summary')).toContainText('Trick complete');
    });

    test('state summary shows game_end status after close', async ({ page }) => {
        // Close initial host board
        await page.locator('.shashn-btn-close').click();
        await expect(page.locator('.shashn-container')).not.toBeVisible();

        // Receive invite + game_end state
        await injectShashnStart(page, {
            roomId: 'test-room-001',
            host: 'host-peer-999',
            hostNick: 'HostUser',
        });

        await injectShashnState(page, {
            roomId: 'test-room-001',
            peerId: 'host-peer-999',
            state: makeShashnGame({
                phase: 'game_end',
                trumpSuit: 'Clubs',
                winner: 'host-peer-999',
                players: [
                    { peer_id: 'test-peer-001', nick: 'TestUser', hand: [], tricksWon: 2, score: 45 },
                    { peer_id: 'host-peer-999', nick: 'HostUser', hand: [], tricksWon: 5, score: 160 },
                ],
                currentPlayer: 1,
                round: 4,
                trickNumber: 6,
            }),
        });

        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 5000 });

        // Close and check summary shows "Game Over!"
        await page.locator('.shashn-btn-close').click();
        await expect(page.locator('.shashn-container')).not.toBeVisible();

        await expect(page.locator('.shashn-state-summary')).toBeVisible();
        await expect(page.locator('.shashn-state-summary')).toContainText('Game Over');
    });

    test('state summary shows round_end status after close', async ({ page }) => {
        // Close initial host board
        await page.locator('.shashn-btn-close').click();
        await expect(page.locator('.shashn-container')).not.toBeVisible();

        // Receive invite + round_end state
        await injectShashnStart(page, {
            roomId: 'test-room-001',
            host: 'host-peer-999',
            hostNick: 'HostUser',
        });

        await injectShashnState(page, {
            roomId: 'test-room-001',
            peerId: 'host-peer-999',
            state: makeShashnGame({
                phase: 'round_end',
                trumpSuit: 'Diamonds',
                winner: 'host-peer-999',
                players: [
                    { peer_id: 'test-peer-001', nick: 'TestUser', hand: [{ rank: '6', suit: 'Hearts', id: '6H' }], tricksWon: 2, score: 30 },
                    { peer_id: 'host-peer-999', nick: 'HostUser', hand: [], tricksWon: 3, score: 45 },
                ],
                currentPlayer: 1,
                round: 2,
                trickNumber: 0,
            }),
        });

        await expect(page.locator('.shashn-container')).toBeVisible({ timeout: 5000 });

        // Close and check summary shows round_end status
        await page.locator('.shashn-btn-close').click();
        await expect(page.locator('.shashn-container')).not.toBeVisible();

        await expect(page.locator('.shashn-state-summary')).toBeVisible();
        await expect(page.locator('.shashn-state-summary')).toContainText('HostUser won the round');
    });
});
