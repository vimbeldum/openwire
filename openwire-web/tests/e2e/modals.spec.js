/**
 * Modals E2E Tests
 *
 * Validates open/close interactions for every modal and popup overlay
 * in the application: GIF Picker, Account History, HowToPlay (Rules),
 * Admin Portal, Agent Control Panel, Admin Password Gate, and
 * general modal viewport constraints.
 */
import { test, expect } from '@playwright/test';
import { mockWebSocket, loginAs, clearSession, setWallet } from './helpers.js';

/* ── Helpers ────────────────────────────────────────────────────── */

/**
 * Intercept Giphy API calls so GifPicker renders without real network.
 * Returns a minimal valid response so the component exits loading state.
 */
async function mockGiphyApi(page) {
    await page.route('**/api.giphy.com/**', (route) => {
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                data: [
                    {
                        id: 'test-gif-1',
                        title: 'Test GIF',
                        images: {
                            fixed_height_small: { url: 'https://example.com/small.gif' },
                            fixed_height: { url: 'https://example.com/full.gif' },
                        },
                    },
                ],
            }),
        });
    });
}

/**
 * Assert that the page has no horizontal or vertical scrollbar.
 */
async function expectNoPageScroll(page) {
    const scroll = await page.evaluate(() => ({
        hScroll: document.documentElement.scrollWidth > window.innerWidth,
        vScroll: document.documentElement.scrollHeight > window.innerHeight,
    }));
    expect(scroll.hScroll).toBe(false);
    expect(scroll.vScroll).toBe(false);
}

/* ══════════════════════════════════════════════════════════════════
   1. GIF PICKER
   ══════════════════════════════════════════════════════════════════ */
test.describe('GIF Picker', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await mockGiphyApi(page);
        await page.goto('/');
        await page.waitForSelector('.chat-layout');
    });

    test('clicking GIF button opens the GIF picker', async ({ page }) => {
        const gifBtn = page.locator('.gif-btn');
        await expect(gifBtn).toBeVisible();
        await gifBtn.click();

        await expect(page.locator('.gif-picker')).toBeVisible();
    });

    test('GIF picker has search input and close button', async ({ page }) => {
        await page.locator('.gif-btn').click();
        await page.waitForSelector('.gif-picker');

        await expect(page.locator('.gif-search')).toBeVisible();
        await expect(page.locator('.gif-close')).toBeVisible();
    });

    test('close button hides the GIF picker', async ({ page }) => {
        await page.locator('.gif-btn').click();
        await page.waitForSelector('.gif-picker');

        await page.locator('.gif-close').click();
        await expect(page.locator('.gif-picker')).not.toBeVisible();
    });

    test('search input accepts text', async ({ page }) => {
        await page.locator('.gif-btn').click();
        await page.waitForSelector('.gif-picker');

        const searchInput = page.locator('.gif-search');
        await searchInput.fill('funny cats');
        await expect(searchInput).toHaveValue('funny cats');
    });

    test('toggling GIF button again closes the picker', async ({ page }) => {
        const gifBtn = page.locator('.gif-btn');
        await gifBtn.click();
        await page.waitForSelector('.gif-picker');

        // Click the GIF button again to toggle off
        await gifBtn.click();
        await expect(page.locator('.gif-picker')).not.toBeVisible();
    });
});

/* ══════════════════════════════════════════════════════════════════
   2. ACCOUNT HISTORY MODAL
   ══════════════════════════════════════════════════════════════════ */
test.describe('Account History Modal', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await page.waitForSelector('.chat-layout');
    });

    test('clicking account history button opens the overlay', async ({ page }) => {
        const historyBtn = page.locator('.btn-account-history');
        await expect(historyBtn).toBeVisible();
        await historyBtn.click();

        await expect(page.locator('.ah-overlay')).toBeVisible();
        await expect(page.locator('.ah-panel')).toBeVisible();
    });

    test('header shows Account History title', async ({ page }) => {
        await page.locator('.btn-account-history').click();
        await page.waitForSelector('.ah-overlay');

        await expect(page.locator('.ah-title')).toContainText('Account History');
    });

    test('filter tab buttons are visible', async ({ page }) => {
        await page.locator('.btn-account-history').click();
        await page.waitForSelector('.ah-overlay');

        const filters = page.locator('.ah-filter-btn');
        // Expected filters: All, Roulette, Blackjack, Andar Bahar, Tic-Tac-Toe
        await expect(filters).toHaveCount(5);
        await expect(filters.nth(0)).toContainText('All');
    });

    test('clicking each filter tab makes it active', async ({ page }) => {
        await page.locator('.btn-account-history').click();
        await page.waitForSelector('.ah-overlay');

        const filters = page.locator('.ah-filter-btn');
        const count = await filters.count();

        for (let i = 0; i < count; i++) {
            await filters.nth(i).click();
            await expect(filters.nth(i)).toHaveClass(/active/);
        }
    });

    test('close button dismisses the modal', async ({ page }) => {
        await page.locator('.btn-account-history').click();
        await page.waitForSelector('.ah-overlay');

        await page.locator('.ah-panel .btn-icon-close').click();
        await expect(page.locator('.ah-overlay')).not.toBeVisible();
    });

    test('empty state message visible when no history', async ({ page }) => {
        await page.locator('.btn-account-history').click();
        await page.waitForSelector('.ah-overlay');

        await expect(page.locator('.ah-empty')).toBeVisible();
        await expect(page.locator('.ah-empty')).toContainText('No history yet');
    });

    test('clicking overlay backdrop closes the modal', async ({ page }) => {
        await page.locator('.btn-account-history').click();
        await page.waitForSelector('.ah-overlay');

        // Click the overlay backdrop (outside the panel)
        await page.locator('.ah-overlay').click({ position: { x: 5, y: 5 } });
        await expect(page.locator('.ah-overlay')).not.toBeVisible();
    });

    test('modal does not cause viewport overflow', async ({ page }) => {
        await page.locator('.btn-account-history').click();
        await page.waitForSelector('.ah-overlay');
        await expectNoPageScroll(page);
    });
});

/* ══════════════════════════════════════════════════════════════════
   3. HOW TO PLAY (RULES) MODAL
   ══════════════════════════════════════════════════════════════════ */
test.describe('HowToPlay Modal', () => {
    /**
     * HowToPlay is rendered from game board overlays (e.g. RouletteBoard onHelp).
     * The game sidebar buttons only appear when rooms.length > 0, so we inject
     * a welcome with rooms and join one. Then we click the Roulette sidebar button
     * to start a game, which renders the RouletteBoard with its "?" help button.
     */
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await page.waitForSelector('.chat-layout');

        // Inject a welcome with a room so game sidebar buttons render
        await page.evaluate(() => {
            const ws = window.__wsMock?.active;
            if (!ws) return;
            ws._injectMessage(JSON.stringify({
                type: 'welcome',
                peer_id: 'test-peer-001',
                nick: 'TestUser',
                peers: [{ peer_id: 'test-peer-001', nick: 'TestUser' }],
                rooms: [{ room_id: 'room-htp', name: 'HelpRoom' }],
            }));
        });

        // Join the room so currentRoom is set and game start works
        await page.evaluate(() => {
            const ws = window.__wsMock?.active;
            if (!ws) return;
            ws._injectMessage(JSON.stringify({
                type: 'room_joined',
                room_id: 'room-htp',
                name: 'HelpRoom',
            }));
        });

        // Wait for the sidebar buttons to appear
        await page.locator('.sidebar-btn:has-text("Roulette")').waitFor({ state: 'visible', timeout: 5000 });

        // Start a roulette game to get the RouletteBoard with its help button
        await page.locator('.sidebar-btn:has-text("Roulette")').click();
        await page.locator('.btn-icon-help, [title="How to Play"]').waitFor({ state: 'visible', timeout: 5000 });
    });

    test('HowToPlay renders with tabs and content when opened', async ({ page }) => {
        await page.locator('.btn-icon-help, [title="How to Play"]').click();
        await expect(page.locator('.howtoplay-panel')).toBeVisible();
    });

    test('HowToPlay tab switching changes content', async ({ page }) => {
        await page.locator('.btn-icon-help, [title="How to Play"]').click();
        await page.waitForSelector('.howtoplay-panel');

        // Verify tabs exist
        const tabs = page.locator('.howtoplay-tab');
        const count = await tabs.count();
        expect(count).toBeGreaterThanOrEqual(3);

        // Click each tab and verify the active class switches
        for (let i = 0; i < count; i++) {
            await tabs.nth(i).click();
            await expect(tabs.nth(i)).toHaveClass(/active/);
        }

        // Verify content area is present
        await expect(page.locator('.howtoplay-content')).toBeVisible();
    });

    test('HowToPlay close button dismisses the overlay', async ({ page }) => {
        await page.locator('.btn-icon-help, [title="How to Play"]').click();
        await page.waitForSelector('.howtoplay-panel');

        await page.locator('.howtoplay-panel .btn-icon-close').click();
        await expect(page.locator('.howtoplay-panel')).not.toBeVisible();
    });

    test('HowToPlay backdrop click closes the overlay', async ({ page }) => {
        await page.locator('.btn-icon-help, [title="How to Play"]').click();
        await page.waitForSelector('.howtoplay-panel');

        // Target the specific game-overlay that contains the howtoplay-panel,
        // since the underlying roulette board also renders its own .game-overlay
        const htpOverlay = page.locator('.game-overlay:has(.howtoplay-panel)');
        await htpOverlay.click({ position: { x: 5, y: 5 } });
        await expect(page.locator('.howtoplay-panel')).not.toBeVisible();
    });
});

/* ══════════════════════════════════════════════════════════════════
   4. ADMIN PORTAL
   ══════════════════════════════════════════════════════════════════ */
test.describe('Admin Portal', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'Admin', true);
        await setWallet(page, 5000);
        await page.goto('/');
        await page.waitForSelector('.chat-layout');
    });

    test('admin sidebar button opens Admin Portal overlay', async ({ page }) => {
        const adminBtn = page.locator('.admin-btn-sidebar');
        await expect(adminBtn).toBeVisible();
        await adminBtn.click();

        await expect(page.locator('.admin-overlay')).toBeVisible();
        await expect(page.locator('.admin-portal')).toBeVisible();
    });

    test('Admin Portal header shows title and badge', async ({ page }) => {
        await page.locator('.admin-btn-sidebar').click();
        await page.waitForSelector('.admin-portal');

        await expect(page.locator('.admin-badge')).toContainText('ADMIN');
        await expect(page.locator('.admin-header h2')).toContainText('OpenWire Admin Portal');
    });

    test('tab buttons are visible (Players, Ban List, Activity Log, Stats, Agents)', async ({ page }) => {
        await page.locator('.admin-btn-sidebar').click();
        await page.waitForSelector('.admin-portal');

        const tabs = page.locator('.admin-tab');
        await expect(tabs).toHaveCount(5);
        await expect(tabs.nth(0)).toContainText('Players');
        await expect(tabs.nth(1)).toContainText('Ban List');
        await expect(tabs.nth(2)).toContainText('Activity Log');
        await expect(tabs.nth(3)).toContainText('Stats');
        await expect(tabs.nth(4)).toContainText('Agents');
    });

    test('clicking each tab changes active state', async ({ page }) => {
        await page.locator('.admin-btn-sidebar').click();
        await page.waitForSelector('.admin-portal');

        const tabs = page.locator('.admin-tab');
        const count = await tabs.count();

        for (let i = 0; i < count; i++) {
            await tabs.nth(i).click();
            await expect(tabs.nth(i)).toHaveClass(/active/);

            // Verify content area exists (admin-content is rendered per tab)
            await expect(page.locator('.admin-content, .admin-agents-content')).toBeVisible();
        }
    });

    test('close button dismisses Admin Portal', async ({ page }) => {
        await page.locator('.admin-btn-sidebar').click();
        await page.waitForSelector('.admin-portal');

        await page.locator('.admin-portal .bj-close').click();
        await expect(page.locator('.admin-overlay')).not.toBeVisible();
    });

    test('clicking overlay backdrop closes Admin Portal', async ({ page }) => {
        await page.locator('.admin-btn-sidebar').click();
        await page.waitForSelector('.admin-overlay');

        // Click the overlay outside the panel
        await page.locator('.admin-overlay').click({ position: { x: 5, y: 5 } });
        await expect(page.locator('.admin-overlay')).not.toBeVisible();
    });

    test('Admin Portal does not cause viewport overflow', async ({ page }) => {
        await page.locator('.admin-btn-sidebar').click();
        await page.waitForSelector('.admin-portal');
        await expectNoPageScroll(page);
    });

    test('admin sidebar button not visible for non-admin users', async ({ page }) => {
        // Navigate as a non-admin user
        const nonAdminPage = page;
        await clearSession(nonAdminPage);
        await mockWebSocket(nonAdminPage);
        await loginAs(nonAdminPage, 'RegularUser', false);
        await setWallet(nonAdminPage, 1000);
        await nonAdminPage.goto('/');
        await nonAdminPage.waitForSelector('.chat-layout');

        await expect(nonAdminPage.locator('.admin-btn-sidebar')).not.toBeVisible();
    });
});

/* ══════════════════════════════════════════════════════════════════
   5. AGENT CONTROL PANEL
   ══════════════════════════════════════════════════════════════════ */
test.describe('Agent Control Panel', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'Admin', true);
        await setWallet(page, 5000);
        await page.goto('/');
        await page.waitForSelector('.chat-layout');
    });

    test('agent panel button opens the panel', async ({ page }) => {
        const agentBtn = page.locator('.btn-agent-panel');
        await expect(agentBtn).toBeVisible();
        await agentBtn.click();

        await expect(page.locator('.acp-overlay')).toBeVisible();
        await expect(page.locator('.acp-panel')).toBeVisible();
    });

    test('Agent Control Panel has header with title', async ({ page }) => {
        await page.locator('.btn-agent-panel').click();
        await page.waitForSelector('.acp-panel');

        await expect(page.locator('.acp-title')).toContainText('Agent Swarm');
    });

    test('panel has tab bar with three tabs', async ({ page }) => {
        await page.locator('.btn-agent-panel').click();
        await page.waitForSelector('.acp-panel');

        const tabs = page.locator('.acp-tab-btn');
        await expect(tabs).toHaveCount(3);
        await expect(tabs.nth(0)).toContainText('Swarm Controls');
        await expect(tabs.nth(1)).toContainText('Manage Entities');
        await expect(tabs.nth(2)).toContainText('Model Tester');
    });

    test('clicking each tab switches active state', async ({ page }) => {
        await page.locator('.btn-agent-panel').click();
        await page.waitForSelector('.acp-panel');

        const tabs = page.locator('.acp-tab-btn');
        const count = await tabs.count();

        for (let i = 0; i < count; i++) {
            await tabs.nth(i).click();
            await expect(tabs.nth(i)).toHaveClass(/active/);
        }
    });

    test('close button dismisses the Agent Control Panel', async ({ page }) => {
        await page.locator('.btn-agent-panel').click();
        await page.waitForSelector('.acp-panel');

        await page.locator('.acp-close').click();
        await expect(page.locator('.acp-overlay')).not.toBeVisible();
    });

    test('clicking overlay backdrop closes the panel', async ({ page }) => {
        await page.locator('.btn-agent-panel').click();
        await page.waitForSelector('.acp-overlay');

        // Click on the overlay backdrop (outside the panel)
        await page.locator('.acp-overlay').click({ position: { x: 5, y: 5 } });
        await expect(page.locator('.acp-overlay')).not.toBeVisible();
    });

    test('Agent Control Panel does not cause viewport overflow', async ({ page }) => {
        await page.locator('.btn-agent-panel').click();
        await page.waitForSelector('.acp-panel');
        await expectNoPageScroll(page);
    });

    test('agent panel button not visible for non-admin users', async ({ page }) => {
        await clearSession(page);
        await mockWebSocket(page);
        await loginAs(page, 'RegularUser', false);
        await setWallet(page, 1000);
        await page.goto('/');
        await page.waitForSelector('.chat-layout');

        await expect(page.locator('.btn-agent-panel')).not.toBeVisible();
    });
});

/* ══════════════════════════════════════════════════════════════════
   6. ADMIN PASSWORD GATE (Landing Page)
   ══════════════════════════════════════════════════════════════════ */
test.describe('Admin Password Gate', () => {
    test.beforeEach(async ({ page }) => {
        await clearSession(page);
        await mockWebSocket(page);
        await page.goto('/');
        await page.waitForSelector('.landing');
    });

    test('clicking Admin Access opens the gate overlay', async ({ page }) => {
        await page.locator('.admin-access-link').click();

        await expect(page.locator('.admin-overlay')).toBeVisible();
        await expect(page.locator('.admin-gate-card')).toBeVisible();
    });

    test('gate has password input and action buttons', async ({ page }) => {
        await page.locator('.admin-access-link').click();
        await page.waitForSelector('.admin-gate-card');

        await expect(page.locator('.admin-gate-card input[type="password"]')).toBeVisible();
        // Cancel button is present
        await expect(page.locator('.admin-gate-actions .admin-btn')).toBeVisible();
        // Unlock/submit button is present
        await expect(page.locator('.admin-gate-actions .bj-btn-primary')).toBeVisible();
    });

    test('cancel button closes the gate', async ({ page }) => {
        await page.locator('.admin-access-link').click();
        await page.waitForSelector('.admin-gate-card');

        await page.locator('.admin-gate-actions .admin-btn').click();
        await expect(page.locator('.admin-overlay')).not.toBeVisible();
    });

    test('clicking overlay backdrop closes the gate', async ({ page }) => {
        await page.locator('.admin-access-link').click();
        await page.waitForSelector('.admin-overlay');

        // Click the overlay outside the card
        await page.locator('.admin-overlay').click({ position: { x: 5, y: 5 } });
        await expect(page.locator('.admin-overlay')).not.toBeVisible();
    });

    test('submitting wrong password shows error', async ({ page }) => {
        await page.locator('.admin-access-link').click();
        await page.waitForSelector('.admin-gate-card');

        const pwInput = page.locator('.admin-gate-card input[type="password"]');
        await pwInput.fill('wrong-password-123');
        await page.locator('.admin-gate-actions .bj-btn-primary').click();

        // Wait for the async check to complete and error to appear
        await expect(page.locator('.admin-gate-error')).toBeVisible();
        await expect(page.locator('.admin-gate-error')).toContainText('Incorrect password');
    });

    test('password input accepts text', async ({ page }) => {
        await page.locator('.admin-access-link').click();
        await page.waitForSelector('.admin-gate-card');

        const pwInput = page.locator('.admin-gate-card input[type="password"]');
        await pwInput.fill('some-password');
        await expect(pwInput).toHaveValue('some-password');
    });

    test('gate icon is visible', async ({ page }) => {
        await page.locator('.admin-access-link').click();
        await page.waitForSelector('.admin-gate-card');

        await expect(page.locator('.admin-gate-icon')).toBeVisible();
    });

    test('gate does not cause viewport overflow', async ({ page }) => {
        await page.locator('.admin-access-link').click();
        await page.waitForSelector('.admin-gate-card');
        await expectNoPageScroll(page);
    });
});

/* ══════════════════════════════════════════════════════════════════
   7. GENERAL MODAL PATTERNS
   ══════════════════════════════════════════════════════════════════ */
test.describe('General Modal Patterns', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'Admin', true);
        await setWallet(page, 5000);
        await mockGiphyApi(page);
        await page.goto('/');
        await page.waitForSelector('.chat-layout');
    });

    test('Account History overlay renders above chat content (z-index check)', async ({ page }) => {
        await page.locator('.btn-account-history').click();
        await page.waitForSelector('.ah-overlay');

        const zIndex = await page.evaluate(() => {
            const overlay = document.querySelector('.ah-overlay');
            if (!overlay) return null;
            const style = getComputedStyle(overlay);
            return parseInt(style.zIndex, 10);
        });

        // z-index should be a positive number, greater than the chat content
        expect(zIndex).toBeGreaterThanOrEqual(1);
    });

    test('Admin Portal overlay renders above chat content (z-index check)', async ({ page }) => {
        await page.locator('.admin-btn-sidebar').click();
        await page.waitForSelector('.admin-overlay');

        const zIndex = await page.evaluate(() => {
            const overlay = document.querySelector('.admin-overlay');
            if (!overlay) return null;
            const style = getComputedStyle(overlay);
            return parseInt(style.zIndex, 10);
        });

        expect(zIndex).toBeGreaterThanOrEqual(1);
    });

    test('Agent Control Panel overlay renders above chat content (z-index check)', async ({ page }) => {
        await page.locator('.btn-agent-panel').click();
        await page.waitForSelector('.acp-overlay');

        const zIndex = await page.evaluate(() => {
            const overlay = document.querySelector('.acp-overlay');
            if (!overlay) return null;
            const style = getComputedStyle(overlay);
            return parseInt(style.zIndex, 10);
        });

        expect(zIndex).toBeGreaterThanOrEqual(1);
    });

    test('opening and closing Account History does not leave stale DOM', async ({ page }) => {
        // Open
        await page.locator('.btn-account-history').click();
        await page.waitForSelector('.ah-overlay');

        // Close
        await page.locator('.ah-panel .btn-icon-close').click();
        await expect(page.locator('.ah-overlay')).not.toBeVisible();

        // Reopen to verify no stale state
        await page.locator('.btn-account-history').click();
        await expect(page.locator('.ah-overlay')).toBeVisible();
        await expect(page.locator('.ah-panel')).toBeVisible();
    });

    test('opening and closing Admin Portal does not leave stale DOM', async ({ page }) => {
        // Open
        await page.locator('.admin-btn-sidebar').click();
        await page.waitForSelector('.admin-portal');

        // Close
        await page.locator('.admin-portal .bj-close').click();
        await expect(page.locator('.admin-overlay')).not.toBeVisible();

        // Reopen
        await page.locator('.admin-btn-sidebar').click();
        await expect(page.locator('.admin-overlay')).toBeVisible();
        await expect(page.locator('.admin-portal')).toBeVisible();
    });

    test('opening and closing Agent Control Panel does not leave stale DOM', async ({ page }) => {
        // Open
        await page.locator('.btn-agent-panel').click();
        await page.waitForSelector('.acp-panel');

        // Close
        await page.locator('.acp-close').click();
        await expect(page.locator('.acp-overlay')).not.toBeVisible();

        // Reopen
        await page.locator('.btn-agent-panel').click();
        await expect(page.locator('.acp-overlay')).toBeVisible();
        await expect(page.locator('.acp-panel')).toBeVisible();
    });

    test('multiple modals: close one, open another without overlap', async ({ page }) => {
        // Open Account History
        await page.locator('.btn-account-history').click();
        await page.waitForSelector('.ah-overlay');

        // Close it
        await page.locator('.ah-panel .btn-icon-close').click();
        await expect(page.locator('.ah-overlay')).not.toBeVisible();

        // Open Admin Portal
        await page.locator('.admin-btn-sidebar').click();
        await page.waitForSelector('.admin-overlay');

        // Account History should not be visible
        await expect(page.locator('.ah-overlay')).not.toBeVisible();
        // Admin Portal should be visible
        await expect(page.locator('.admin-portal')).toBeVisible();

        // Close Admin Portal
        await page.locator('.admin-portal .bj-close').click();
        await expect(page.locator('.admin-overlay')).not.toBeVisible();

        // Open Agent Control Panel
        await page.locator('.btn-agent-panel').click();
        await page.waitForSelector('.acp-overlay');
        await expect(page.locator('.acp-panel')).toBeVisible();
        // Clean up
        await page.locator('.acp-close').click();
        await expect(page.locator('.acp-overlay')).not.toBeVisible();
    });

    test('GIF picker does not add scrollbar to the page', async ({ page }) => {
        await page.locator('.gif-btn').click();
        await page.waitForSelector('.gif-picker');
        await expectNoPageScroll(page);
    });
});
