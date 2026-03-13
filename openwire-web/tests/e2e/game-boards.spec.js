/**
 * Game Board E2E Tests
 *
 * Tests game board opening (via chat commands), rendering, interaction
 * elements, closing, and overlay viewport constraints for all game types:
 * Roulette, Blackjack, Andar Bahar, and Tic-Tac-Toe.
 */
import { test, expect } from '@playwright/test';
import { mockWebSocket, loginAs, setWallet } from './helpers.js';

// ── Shared setup ─────────────────────────────────────────────
// Every game command requires a room. We inject a fake room_created
// WebSocket message so the app has a currentRoom set.

async function setupWithRoom(page) {
    await mockWebSocket(page);
    await loginAs(page, 'TestUser');
    await setWallet(page, 5000);
    await page.goto('/');
    await page.waitForSelector('.chat-layout');

    // Inject a room so game commands don't bail with "Create a room first"
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
    // Wait for room to appear in sidebar
    await page.waitForSelector('.room-item.active', { timeout: 3000 });
}

async function typeCommand(page, command) {
    const input = page.locator('.chat-input input[type="text"]');
    await expect(input).toBeVisible();
    await input.fill(command);
    await input.press('Enter');
}

// ═══════════════════════════════════════════════════════════════
//  1. Game Board Opening
// ═══════════════════════════════════════════════════════════════

test.describe('Game Board Opening', () => {
    test.beforeEach(async ({ page }) => {
        await setupWithRoom(page);
    });

    test('/roulette command opens roulette game overlay', async ({ page }) => {
        await typeCommand(page, '/roulette');
        const overlay = page.locator('.game-overlay');
        await expect(overlay).toBeVisible({ timeout: 5000 });
        // Roulette table container should be present
        await expect(page.locator('.rl-table')).toBeVisible();
    });

    test('/blackjack command opens blackjack game overlay', async ({ page }) => {
        await typeCommand(page, '/blackjack');
        const overlay = page.locator('.game-overlay');
        await expect(overlay).toBeVisible({ timeout: 5000 });
        // Blackjack table container should be present
        await expect(page.locator('.bj-table')).toBeVisible();
    });

    test('/andarbahar command opens andar bahar game overlay', async ({ page }) => {
        await typeCommand(page, '/andarbahar');
        const overlay = page.locator('.game-overlay');
        await expect(overlay).toBeVisible({ timeout: 5000 });
        // Andar Bahar table container should be present
        await expect(page.locator('.ab-table')).toBeVisible();
    });

    test('/game tictactoe sends challenge and overlay appears on accept', async ({ page }) => {
        await typeCommand(page, '/game tictactoe');

        // The command sends a Challenge via WebSocket. Simulate an
        // opponent accepting so the GameBoard renders.
        // Game messages use the GAME: prefix (see lib/game.js serializeGameAction)
        await page.evaluate(() => {
            const ws = window.__wsMock?.active;
            if (ws) {
                ws._injectMessage(JSON.stringify({
                    type: 'room_message',
                    room_id: 'test-room-001',
                    peer_id: 'opponent-peer-id',
                    data: 'GAME:' + JSON.stringify({
                        type: 'Accept',
                        accepter: 'opponent-peer-id',
                        accepter_nick: 'Opponent',
                        room_id: 'test-room-001',
                    }),
                }));
            }
        });

        const overlay = page.locator('.game-overlay');
        await expect(overlay).toBeVisible({ timeout: 5000 });
        // Tic-Tac-Toe game card should be present
        await expect(page.locator('.game-card')).toBeVisible();
    });

    test('game overlay has a close button', async ({ page }) => {
        await typeCommand(page, '/roulette');
        await expect(page.locator('.game-overlay')).toBeVisible({ timeout: 5000 });
        const closeBtn = page.locator('.btn-icon-close');
        await expect(closeBtn).toBeVisible();
    });
});

// ═══════════════════════════════════════════════════════════════
//  2. Game Board Closing
// ═══════════════════════════════════════════════════════════════

test.describe('Game Board Closing', () => {
    test.beforeEach(async ({ page }) => {
        await setupWithRoom(page);
    });

    test('clicking close button dismisses roulette overlay', async ({ page }) => {
        await typeCommand(page, '/roulette');
        await expect(page.locator('.game-overlay')).toBeVisible({ timeout: 5000 });

        await page.locator('.btn-icon-close').click();
        await expect(page.locator('.game-overlay')).not.toBeVisible();
    });

    test('clicking close button dismisses blackjack overlay', async ({ page }) => {
        await typeCommand(page, '/blackjack');
        await expect(page.locator('.game-overlay')).toBeVisible({ timeout: 5000 });

        await page.locator('.btn-icon-close').click();
        await expect(page.locator('.game-overlay')).not.toBeVisible();
    });

    test('clicking close button dismisses andar bahar overlay', async ({ page }) => {
        await typeCommand(page, '/andarbahar');
        await expect(page.locator('.game-overlay')).toBeVisible({ timeout: 5000 });

        await page.locator('.btn-icon-close').click();
        await expect(page.locator('.game-overlay')).not.toBeVisible();
    });

    test('chat layout is still visible after closing a game', async ({ page }) => {
        await typeCommand(page, '/roulette');
        await expect(page.locator('.game-overlay')).toBeVisible({ timeout: 5000 });

        await page.locator('.btn-icon-close').click();
        await expect(page.locator('.game-overlay')).not.toBeVisible();

        // Chat layout should still be intact
        await expect(page.locator('.chat-layout')).toBeVisible();
        await expect(page.locator('.chat-header')).toBeVisible();
        await expect(page.locator('.chat-input')).toBeVisible();
    });

    test('opening and closing a game does not cause scroll overflow', async ({ page }) => {
        await typeCommand(page, '/blackjack');
        await expect(page.locator('.game-overlay')).toBeVisible({ timeout: 5000 });

        await page.locator('.btn-icon-close').click();
        await expect(page.locator('.game-overlay')).not.toBeVisible();

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
//  3. Roulette Board Interactions
// ═══════════════════════════════════════════════════════════════

test.describe('Roulette Board Interactions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWithRoom(page);
        await typeCommand(page, '/roulette');
        await expect(page.locator('.game-overlay')).toBeVisible({ timeout: 5000 });
    });

    test('renders wheel area with SVG', async ({ page }) => {
        // The wheel section contains the animated SVG wheel
        await expect(page.locator('.rl-wheel-section')).toBeVisible();
        await expect(page.locator('.rl-wheel-container')).toBeVisible();
        await expect(page.locator('.rl-wheel-svg')).toBeVisible();
    });

    test('bet buttons are visible during betting phase', async ({ page }) => {
        // Roulette starts in betting phase. Chip selector and number grid
        // should be visible.
        await expect(page.locator('.chip-selector')).toBeVisible();
        // At least some chip buttons should exist
        const chipBtns = page.locator('.chip-btn');
        await expect(chipBtns.first()).toBeVisible();
        const chipCount = await chipBtns.count();
        expect(chipCount).toBeGreaterThanOrEqual(4);

        // Number grid should have cells
        await expect(page.locator('.rl-grid-vertical')).toBeVisible();
        const cells = page.locator('.rl-cell');
        await expect(cells.first()).toBeVisible();
    });

    test('outside bet buttons are visible', async ({ page }) => {
        // Outside bet buttons (Red, Black, Even, Odd, 1-18, 19-36, dozens, columns)
        const outsideBtns = page.locator('.rl-outside-btn');
        const count = await outsideBtns.count();
        expect(count).toBeGreaterThanOrEqual(6);
    });

    test('countdown timer area is present', async ({ page }) => {
        // Countdown renders during betting phase
        await expect(page.locator('.rl-countdown-wrap')).toBeVisible();
        await expect(page.locator('.rl-countdown-text')).toBeVisible();
        await expect(page.locator('.rl-countdown-track')).toBeVisible();
    });

    test('header shows game title and balance', async ({ page }) => {
        const header = page.locator('.game-table-header');
        await expect(header).toBeVisible();
        await expect(header.locator('.game-table-title')).toContainText('Roulette');
        await expect(header.locator('.chip-display')).toBeVisible();
    });
});

// ═══════════════════════════════════════════════════════════════
//  4. Blackjack Board Interactions
// ═══════════════════════════════════════════════════════════════

test.describe('Blackjack Board Interactions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWithRoom(page);
        await typeCommand(page, '/blackjack');
        await expect(page.locator('.game-overlay')).toBeVisible({ timeout: 5000 });
    });

    test('blackjack board renders with table', async ({ page }) => {
        await expect(page.locator('.bj-table')).toBeVisible();
    });

    test('dealer area is present', async ({ page }) => {
        await expect(page.locator('.bj-dealer-area')).toBeVisible();
        // Dealer hand zone should exist
        await expect(page.locator('.bj-dealer-area .bj-hand-zone')).toBeVisible();
    });

    test('players area is present', async ({ page }) => {
        await expect(page.locator('.bj-players-area')).toBeVisible();
        // The host auto-joins, so a player hand should exist
        const playerHands = page.locator('.bj-players-area .bj-hand-zone');
        await expect(playerHands.first()).toBeVisible();
    });

    test('action bar with bet controls is present during betting phase', async ({ page }) => {
        // Blackjack starts in betting phase
        await expect(page.locator('.bj-action-bar')).toBeVisible();
        await expect(page.locator('.bj-bet-controls')).toBeVisible();
    });

    test('status bar shows phase message', async ({ page }) => {
        await expect(page.locator('.bj-status-bar')).toBeVisible();
        // Should show "Place your bets!" during betting phase
        await expect(page.locator('.bj-phase-msg')).toContainText('Place your bets');
    });

    test('header shows game title', async ({ page }) => {
        const header = page.locator('.game-table-header');
        await expect(header).toBeVisible();
        await expect(header.locator('.game-table-title')).toContainText('Blackjack');
    });
});

// ═══════════════════════════════════════════════════════════════
//  5. Andar Bahar Board Interactions
// ═══════════════════════════════════════════════════════════════

test.describe('Andar Bahar Board Interactions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWithRoom(page);
        await typeCommand(page, '/andarbahar');
        await expect(page.locator('.game-overlay')).toBeVisible({ timeout: 5000 });
    });

    test('board renders with trump card area', async ({ page }) => {
        await expect(page.locator('.ab-table')).toBeVisible();
        await expect(page.locator('.ab-trump-area')).toBeVisible();
        // Trump card placeholder should show "?"
        await expect(page.locator('.ab-trump-placeholder')).toBeVisible();
    });

    test('Andar and Bahar pile sections are visible', async ({ page }) => {
        await expect(page.locator('.ab-piles-row')).toBeVisible();
        await expect(page.locator('.ab-pile-zone.andar')).toBeVisible();
        await expect(page.locator('.ab-pile-zone.bahar')).toBeVisible();
        // Pile headers should show names
        await expect(page.locator('.ab-pile-name.andar')).toContainText('ANDAR');
        await expect(page.locator('.ab-pile-name.bahar')).toContainText('BAHAR');
    });

    test('bet controls are visible during betting phase', async ({ page }) => {
        await expect(page.locator('.ab-bet-controls')).toBeVisible();
        // Chip selector should be present
        await expect(page.locator('.ab-bet-controls .chip-selector')).toBeVisible();
        // Side buttons for Andar and Bahar should be present
        await expect(page.locator('.ab-side-btn.andar')).toBeVisible();
        await expect(page.locator('.ab-side-btn.bahar')).toBeVisible();
    });

    test('countdown timer is shown during betting', async ({ page }) => {
        await expect(page.locator('.ab-countdown')).toBeVisible();
        await expect(page.locator('.ab-countdown-label')).toContainText('Betting closes in');
    });

    test('header shows game title', async ({ page }) => {
        const header = page.locator('.game-table-header');
        await expect(header).toBeVisible();
        await expect(header.locator('.game-table-title')).toContainText('Andar Bahar');
    });
});

// ═══════════════════════════════════════════════════════════════
//  6. Tic-Tac-Toe Board Interactions
// ═══════════════════════════════════════════════════════════════

test.describe('Tic-Tac-Toe Board Interactions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWithRoom(page);
        await typeCommand(page, '/game tictactoe');

        // Inject opponent Accept so the game board renders
        // Game messages use the GAME: prefix (see lib/game.js serializeGameAction)
        await page.evaluate(() => {
            const ws = window.__wsMock?.active;
            if (ws) {
                ws._injectMessage(JSON.stringify({
                    type: 'room_message',
                    room_id: 'test-room-001',
                    peer_id: 'opponent-peer-id',
                    data: 'GAME:' + JSON.stringify({
                        type: 'Accept',
                        accepter: 'opponent-peer-id',
                        accepter_nick: 'Opponent',
                        room_id: 'test-room-001',
                    }),
                }));
            }
        });

        await expect(page.locator('.game-overlay')).toBeVisible({ timeout: 5000 });
    });

    test('board renders with 3x3 grid', async ({ page }) => {
        await expect(page.locator('.game-board')).toBeVisible();
        const cells = page.locator('.game-cell');
        const count = await cells.count();
        expect(count).toBe(9);
    });

    test('cells are clickable (not disabled for current player turn)', async ({ page }) => {
        // At least one cell should be enabled (not taken)
        const cells = page.locator('.game-cell:not([disabled])');
        const enabledCount = await cells.count();
        expect(enabledCount).toBeGreaterThan(0);
    });

    test('score display is visible', async ({ page }) => {
        await expect(page.locator('.game-score')).toBeVisible();
    });

    test('player names are visible', async ({ page }) => {
        const players = page.locator('.game-players');
        await expect(players).toBeVisible();
        // Should show both player names
        await expect(players).toContainText('TestUser');
        await expect(players).toContainText('Opponent');
    });

    test('game status text is visible', async ({ page }) => {
        await expect(page.locator('.game-status')).toBeVisible();
    });

    test('close button dismisses the overlay', async ({ page }) => {
        // GameBoard has a "Close" text button in .game-actions, not .btn-icon-close
        const closeBtn = page.locator('.game-actions button', { hasText: 'Close' });
        await expect(closeBtn).toBeVisible();
        await closeBtn.click();
        await expect(page.locator('.game-overlay')).not.toBeVisible();
    });
});

// ═══════════════════════════════════════════════════════════════
//  7. Game Overlay Constraints
// ═══════════════════════════════════════════════════════════════

test.describe('Game Overlay Constraints', () => {
    test.beforeEach(async ({ page }) => {
        await setupWithRoom(page);
    });

    test('game overlay covers viewport with position fixed and inset 0', async ({ page }) => {
        await typeCommand(page, '/roulette');
        await expect(page.locator('.game-overlay')).toBeVisible({ timeout: 5000 });

        const styles = await page.evaluate(() => {
            const overlay = document.querySelector('.game-overlay');
            if (!overlay) return null;
            const cs = getComputedStyle(overlay);
            const rect = overlay.getBoundingClientRect();
            return {
                position: cs.position,
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
            };
        });

        expect(styles).not.toBeNull();
        expect(styles.position).toBe('fixed');
        expect(styles.top).toBe(0);
        expect(styles.left).toBe(0);
        // Overlay should span the full viewport
        expect(styles.width).toBe(styles.viewportWidth);
        expect(styles.height).toBe(styles.viewportHeight);
    });

    test('game overlay has z-index above chat elements', async ({ page }) => {
        await typeCommand(page, '/blackjack');
        await expect(page.locator('.game-overlay')).toBeVisible({ timeout: 5000 });

        const zIndex = await page.evaluate(() => {
            const overlay = document.querySelector('.game-overlay');
            if (!overlay) return null;
            const cs = getComputedStyle(overlay);
            return parseInt(cs.zIndex, 10);
        });

        expect(zIndex).not.toBeNull();
        // z-index should be at least 100 (per CSS: z-index: 100)
        expect(zIndex).toBeGreaterThanOrEqual(100);
    });

    test('game overlay has overflow hidden (no scrollbars)', async ({ page }) => {
        await typeCommand(page, '/andarbahar');
        await expect(page.locator('.game-overlay')).toBeVisible({ timeout: 5000 });

        const overflow = await page.evaluate(() => {
            const overlay = document.querySelector('.game-overlay');
            if (!overlay) return null;
            return getComputedStyle(overlay).overflow;
        });

        expect(overflow).toBe('hidden');
    });

    test('game overlay does not exceed viewport bounds', async ({ page }) => {
        await typeCommand(page, '/roulette');
        await expect(page.locator('.game-overlay')).toBeVisible({ timeout: 5000 });

        const withinBounds = await page.evaluate(() => {
            return (
                document.documentElement.scrollHeight <= window.innerHeight &&
                document.documentElement.scrollWidth <= window.innerWidth
            );
        });

        expect(withinBounds).toBe(true);
    });

    test('game overlay does not cause scroll on mobile viewport', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });

        await typeCommand(page, '/blackjack');
        await expect(page.locator('.game-overlay')).toBeVisible({ timeout: 5000 });

        const noScroll = await page.evaluate(() => {
            return (
                document.documentElement.scrollHeight <= window.innerHeight &&
                document.documentElement.scrollWidth <= window.innerWidth
            );
        });

        expect(noScroll).toBe(true);
    });
});
