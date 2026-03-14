/**
 * Functional Features E2E Tests
 *
 * Validates peer list management, GIF picker, typing indicators,
 * live ticker, overlay dismissal, message persistence, and
 * connection indicator.
 * All tests run WITHOUT a real backend using the mock WebSocket.
 */
import { test, expect } from '@playwright/test';
import { mockWebSocket, loginAs, setWallet, injectPeers } from './helpers.js';

/**
 * Inject a welcome message from the mock relay so the app considers itself
 * connected and renders the full ChatRoom UI.
 */
async function injectWelcome(page, peerId = 'test-peer-001', peers = [], rooms = []) {
    await page.evaluate(({ pid, peers, rooms }) => {
        const ws = window.__wsMock?.active;
        if (ws) {
            ws._injectMessage(JSON.stringify({
                type: 'welcome',
                peer_id: pid,
                nick: 'TestUser',
                peers,
                rooms,
            }));
        }
    }, { pid: peerId, peers, rooms });
    await page.waitForTimeout(200);
}

/**
 * Wait for the chat layout to be visible.
 */
async function waitForChat(page) {
    await page.waitForSelector('.chat-layout', { state: 'visible', timeout: 5000 });
}

/**
 * Inject a room-level custom action (typing, casino_ticker, etc.)
 * via the WebSocket mock. Simulates a peer sending a room message
 * containing a JSON payload with the given action type.
 */
async function injectCustomAction(page, action, peerId = 'remote-peer-1', roomId = null) {
    await page.evaluate(({ action, peerId, roomId }) => {
        const ws = window.__wsMock?.active;
        if (ws) {
            ws._injectMessage(JSON.stringify({
                type: 'room_message',
                peer_id: peerId,
                room_id: roomId,
                data: JSON.stringify(action),
            }));
        }
    }, { action, peerId, roomId });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. PEER LIST MANAGEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Peer List Management', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await waitForChat(page);
        await injectWelcome(page);
    });

    test('shows "No peers yet" when peer list is empty', async ({ page }) => {
        // With only ourselves (filtered out), the sidebar shows the empty message
        const sidebar = page.locator('.sidebar');
        await expect(sidebar).toBeVisible();
        await expect(sidebar.locator('text=No peers yet')).toBeVisible();
    });

    test('injectPeers adds peers to the sidebar', async ({ page }) => {
        await injectPeers(page, [
            { peer_id: 'peer-a', nick: 'Alice', balance: 500 },
            { peer_id: 'peer-b', nick: 'Bob', balance: 300 },
        ]);

        // Wait for peers to render
        const peerItems = page.locator('.peer-item');
        await expect(peerItems).toHaveCount(2, { timeout: 3000 });

        // Verify names
        await expect(page.locator('.peer-nick').nth(0)).toHaveText('Alice');
        await expect(page.locator('.peer-nick').nth(1)).toHaveText('Bob');
    });

    test('Online (N) count updates with peer list size', async ({ page }) => {
        // Initially 0 peers (only self, which is filtered)
        const onlineTitle = page.locator('.sidebar-title', { hasText: /^Online/ });
        await expect(onlineTitle).toBeVisible();

        // Inject 3 peers
        await injectPeers(page, [
            { peer_id: 'peer-a', nick: 'Alice', balance: 0 },
            { peer_id: 'peer-b', nick: 'Bob', balance: 0 },
            { peer_id: 'peer-c', nick: 'Carol', balance: 0 },
        ]);

        await expect(onlineTitle).toHaveText(/Online \(3\)/, { timeout: 3000 });
    });

    test('"No peers yet" disappears after peers are injected', async ({ page }) => {
        // Confirm empty state first
        await expect(page.locator('text=No peers yet')).toBeVisible();

        await injectPeers(page, [
            { peer_id: 'peer-x', nick: 'Xander', balance: 100 },
        ]);

        // Empty state should be gone, peer should be visible
        await expect(page.locator('text=No peers yet')).not.toBeVisible({ timeout: 3000 });
        await expect(page.locator('.peer-nick', { hasText: 'Xander' })).toBeVisible();
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. GIF PICKER FLOW
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('GIF Picker Flow', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        // Intercept Giphy API calls so they do not make real network requests
        await page.route('**/api.giphy.com/**', route => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ data: [] }),
            });
        });
        await page.goto('/');
        await waitForChat(page);
        await injectWelcome(page);
    });

    test('GIF button opens the GIF picker', async ({ page }) => {
        const gifBtn = page.locator('.gif-btn');
        await expect(gifBtn).toBeVisible();
        await gifBtn.click();

        // The gif-picker panel should now be visible
        await expect(page.locator('.gif-picker')).toBeVisible({ timeout: 3000 });
    });

    test('GIF picker search input accepts text', async ({ page }) => {
        await page.locator('.gif-btn').click();
        await expect(page.locator('.gif-picker')).toBeVisible({ timeout: 3000 });

        const searchInput = page.locator('.gif-search');
        await expect(searchInput).toBeVisible();
        await searchInput.fill('cats');
        await expect(searchInput).toHaveValue('cats');
    });

    test('close button dismisses the GIF picker', async ({ page }) => {
        await page.locator('.gif-btn').click();
        await expect(page.locator('.gif-picker')).toBeVisible({ timeout: 3000 });

        // Click the close button inside the GIF picker
        await page.locator('.gif-close').click();
        await expect(page.locator('.gif-picker')).not.toBeVisible({ timeout: 3000 });
    });

    test('toggling GIF button opens and closes picker', async ({ page }) => {
        const gifBtn = page.locator('.gif-btn');

        // Open
        await gifBtn.click();
        await expect(page.locator('.gif-picker')).toBeVisible({ timeout: 3000 });

        // Close by clicking GIF button again
        await gifBtn.click();
        await expect(page.locator('.gif-picker')).not.toBeVisible({ timeout: 3000 });
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. TYPING INDICATOR LIFECYCLE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Typing Indicator Lifecycle', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await waitForChat(page);
        // Need to be in a room for typing indicators (they come via room_message)
        await injectWelcome(page, 'test-peer-001', [], [{ room_id: 'room-1', name: 'Test Room' }]);
    });

    test('shows typing indicator when peer is typing', async ({ page }) => {
        // Join the room first
        await page.locator('.room-item', { hasText: 'Test Room' }).click();
        await page.waitForTimeout(100);

        // Inject a typing action from a remote peer
        await injectCustomAction(page, { type: 'typing', nick: 'Alice' }, 'remote-peer-alice', 'room-1');

        // The typing bar should show "Alice is typing"
        const typingBar = page.locator('.typing-bar');
        await expect(typingBar.locator('.typing-text')).toContainText('Alice is typing', { timeout: 3000 });
    });

    test('shows multiple peer typing indicators', async ({ page }) => {
        await page.locator('.room-item', { hasText: 'Test Room' }).click();
        await page.waitForTimeout(100);

        // Inject typing from two peers
        await injectCustomAction(page, { type: 'typing', nick: 'Alice' }, 'remote-peer-alice', 'room-1');
        await injectCustomAction(page, { type: 'typing', nick: 'Bob' }, 'remote-peer-bob', 'room-1');

        const typingText = page.locator('.typing-bar .typing-text');
        // Should show both names or "and N others"
        await expect(typingText).toContainText(/typing/, { timeout: 3000 });
        // Verify the typing bar has dots visible (active indicator)
        await expect(page.locator('.typing-bar .typing-dots')).toBeVisible();
    });

    test('typing indicator clears after 3+ seconds of inactivity', async ({ page }) => {
        await page.locator('.room-item', { hasText: 'Test Room' }).click();
        await page.waitForTimeout(100);

        // Inject typing event
        await injectCustomAction(page, { type: 'typing', nick: 'Alice' }, 'remote-peer-alice', 'room-1');

        // Confirm it appears
        const typingText = page.locator('.typing-bar .typing-text');
        await expect(typingText).toContainText('Alice is typing', { timeout: 3000 });

        // Wait for the cleanup interval to clear stale typing (3s + buffer for the 1s interval)
        await page.waitForTimeout(4500);

        // Typing bar should be empty now (the component renders typing-bar-empty with no text)
        await expect(page.locator('.typing-bar.typing-bar-empty')).toBeVisible({ timeout: 3000 });
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. LIVE TICKER EVENTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Live Ticker Events', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await waitForChat(page);
        await injectWelcome(page, 'test-peer-001', [], [{ room_id: 'room-1', name: 'Ticker Room' }]);
    });

    test('shows idle state when no ticker events exist', async ({ page }) => {
        // The LiveTicker component renders the idle state by default
        await expect(page.locator('.ticker-idle')).toBeVisible();
        await expect(page.locator('.ticker-idle')).toHaveText(/Waiting for game activity/);
    });

    test('casino_ticker events appear in the live ticker', async ({ page }) => {
        // Join the room first
        await page.locator('.room-item', { hasText: 'Ticker Room' }).click();
        await page.waitForTimeout(100);

        // Inject a casino ticker event
        await injectCustomAction(page, {
            type: 'casino_ticker',
            text: 'Alice won 500 chips!',
            gameType: 'roulette',
        }, 'remote-peer-alice', 'room-1');

        // The ticker item should appear
        const tickerItem = page.locator('.ticker-item');
        await expect(tickerItem.first()).toContainText('Alice won 500 chips!', { timeout: 3000 });
    });

    test('multiple ticker items render', async ({ page }) => {
        await page.locator('.room-item', { hasText: 'Ticker Room' }).click();
        await page.waitForTimeout(100);

        // Inject two ticker events
        await injectCustomAction(page, {
            type: 'casino_ticker',
            text: 'Bob hit Blackjack!',
            gameType: 'blackjack',
        }, 'remote-peer-bob', 'room-1');

        await injectCustomAction(page, {
            type: 'casino_ticker',
            text: 'Carol won Andar Bahar!',
            gameType: 'andarbahar',
        }, 'remote-peer-carol', 'room-1');

        const tickerItems = page.locator('.ticker-item');
        await expect(tickerItems).toHaveCount(2, { timeout: 3000 });
        await expect(tickerItems.nth(0)).toContainText('Bob hit Blackjack!');
        await expect(tickerItems.nth(1)).toContainText('Carol won Andar Bahar!');
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. OVERLAY DISMISSAL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Overlay Dismissal', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await waitForChat(page);
        await injectWelcome(page);
    });

    test('Account History opens and closes via close button', async ({ page }) => {
        // The Account History button is the chart icon in the header
        const historyBtn = page.locator('.btn-account-history');
        await expect(historyBtn).toBeVisible();
        await historyBtn.click();

        // The ah-overlay should appear
        await expect(page.locator('.ah-overlay')).toBeVisible({ timeout: 3000 });

        // Close via the close button
        await page.locator('.ah-overlay .btn-icon-close').click();
        await expect(page.locator('.ah-overlay')).not.toBeVisible({ timeout: 3000 });
    });

    test('Account History closes by clicking the backdrop', async ({ page }) => {
        await page.locator('.btn-account-history').click();
        await expect(page.locator('.ah-overlay')).toBeVisible({ timeout: 3000 });

        // Click the overlay backdrop (click at the edge, not on the panel)
        await page.locator('.ah-overlay').click({ position: { x: 5, y: 5 } });
        await expect(page.locator('.ah-overlay')).not.toBeVisible({ timeout: 3000 });
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. MESSAGE PERSISTENCE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Message Persistence', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await waitForChat(page);
        await injectWelcome(page);
    });

    test('messages are saved to sessionStorage under openwire_messages', async ({ page }) => {
        // Send a chat message so there is at least one message beyond system ones
        const input = page.locator('.chat-input input[type="text"]');
        await input.fill('Persistence test msg');
        await page.locator('.chat-input button[type="submit"]').click();
        await page.waitForTimeout(200);

        // The app saves messages on a 5s interval. Trigger a manual save by
        // waiting or force-invoking the save. We wait for the interval.
        await page.waitForTimeout(5500);

        const stored = await page.evaluate(() => {
            return sessionStorage.getItem('openwire_messages');
        });

        expect(stored).not.toBeNull();
        const parsed = JSON.parse(stored);
        expect(parsed).toHaveProperty('messages');
        expect(parsed).toHaveProperty('savedAt');
        expect(Array.isArray(parsed.messages)).toBe(true);
        expect(parsed.messages.length).toBeGreaterThan(0);
    });

    test('sessionStorage contains correct message data structure', async ({ page }) => {
        // Inject a peer message and a self message
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            ws._injectMessage(JSON.stringify({
                type: 'message',
                peer_id: 'remote-peer-1',
                nick: 'Alice',
                data: 'Hello from Alice!',
            }));
        });
        await page.waitForTimeout(200);

        const input = page.locator('.chat-input input[type="text"]');
        await input.fill('Hello from me!');
        await page.locator('.chat-input button[type="submit"]').click();
        await page.waitForTimeout(200);

        // Wait for the save interval
        await page.waitForTimeout(5500);

        const stored = await page.evaluate(() => {
            const raw = sessionStorage.getItem('openwire_messages');
            return raw ? JSON.parse(raw) : null;
        });

        expect(stored).not.toBeNull();

        // Messages should have required fields: time, sender, content, type
        const msgs = stored.messages;
        const hasRequiredFields = msgs.every(m =>
            m.time !== undefined &&
            m.content !== undefined &&
            m.type !== undefined
        );
        expect(hasRequiredFields).toBe(true);

        // Verify our specific messages are present
        const aliceMsg = msgs.find(m => m.content === 'Hello from Alice!');
        expect(aliceMsg).toBeDefined();
        expect(aliceMsg.type).toBe('peer');

        const selfMsg = msgs.find(m => m.content === 'Hello from me!');
        expect(selfMsg).toBeDefined();
        expect(selfMsg.type).toBe('self');
    });

    test('saved messages are capped at MAX_STORED_MESSAGES (500)', async ({ page }) => {
        // Flood the app with many messages
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            for (let i = 0; i < 520; i++) {
                ws._injectMessage(JSON.stringify({
                    type: 'message',
                    peer_id: 'remote-peer-flood',
                    nick: 'FloodBot',
                    data: `Flood message ${i}`,
                }));
            }
        });

        // Wait for messages to process and the save interval to fire
        await page.waitForTimeout(6000);

        const stored = await page.evaluate(() => {
            const raw = sessionStorage.getItem('openwire_messages');
            return raw ? JSON.parse(raw) : null;
        });

        expect(stored).not.toBeNull();
        // Should be capped at 500
        expect(stored.messages.length).toBeLessThanOrEqual(500);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. CONNECTION INDICATOR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Connection Indicator', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await waitForChat(page);
    });

    test('shows "Connecting..." before welcome message', async ({ page }) => {
        // Before injecting a welcome message, the status should indicate connecting
        const headerStatus = page.locator('.header-status');
        await expect(headerStatus).toContainText('Connecting', { timeout: 3000 });

        // Status dot should have the offline class
        await expect(page.locator('.status-dot.offline')).toBeVisible();
    });

    test('shows connected state with peer count after welcome', async ({ page }) => {
        await injectWelcome(page, 'test-peer-001', [
            { peer_id: 'peer-a', nick: 'Alice', balance: 0 },
        ]);

        const headerStatus = page.locator('.header-status');
        // Should show nick and online count
        await expect(headerStatus).toContainText('TestUser', { timeout: 3000 });
        await expect(headerStatus).toContainText('online', { timeout: 3000 });

        // Status dot should NOT have the offline class
        const statusDot = page.locator('.status-dot');
        await expect(statusDot).toBeVisible();
        await expect(statusDot).not.toHaveClass(/offline/);
    });
});
