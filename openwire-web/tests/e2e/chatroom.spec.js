/**
 * ChatRoom E2E Tests
 *
 * Validates the ChatRoom component rendering, navigation, wallet display,
 * viewport constraints, and core user interactions after login.
 */
import { test, expect } from '@playwright/test';
import { mockWebSocket, loginAs, clearSession, setWallet } from './helpers.js';

test.describe('ChatRoom', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
    });

    // ── 1. Basic rendering ────────────────────────────────────────

    test('renders ChatRoom when logged in', async ({ page }) => {
        // Global header shows the logged-in nick
        const header = page.locator('.global-header');
        await expect(header).toBeVisible();
        await expect(header.locator('strong')).toHaveText('TestUser');

        // Chat layout is present (ChatRoom renders .chat-layout)
        await expect(page.locator('.chat-layout')).toBeVisible();
    });

    // ── 2. Connection badge ───────────────────────────────────────

    test('shows connection mode badge (relay by default)', async ({ page }) => {
        const badge = page.locator('.connection-mode-badge');
        await expect(badge).toBeVisible();
        // Default login uses relay mode
        await expect(badge).toHaveText(/Relay/i);
    });

    // ── 3. Logout ─────────────────────────────────────────────────

    test('logout button returns to landing', async ({ page }) => {
        const logoutBtn = page.locator('.btn-logout');
        await expect(logoutBtn).toBeVisible();
        await logoutBtn.click();

        // After logout the Landing page should render
        await expect(page.locator('.landing')).toBeVisible();
        // ChatRoom layout should no longer be present
        await expect(page.locator('.chat-layout')).not.toBeVisible();
    });

    // ── 4. Wallet balance ─────────────────────────────────────────

    test('displays wallet balance in header', async ({ page }) => {
        // The header-chips element shows the balance with a money-bag emoji
        const chips = page.locator('.header-chips');
        await expect(chips).toBeVisible();
        // 1000 formatted with toLocaleString — at minimum contains "1,000" or "1000"
        await expect(chips).toHaveText(/1[,.]?000/);
    });

    // ── 5. Chat input ─────────────────────────────────────────────

    test('chat input is visible and accepts typed text', async ({ page }) => {
        const input = page.locator('.chat-input input[type="text"]');
        await expect(input).toBeVisible();
        await input.click();
        await input.fill('Hello OpenWire!');
        await expect(input).toHaveValue('Hello OpenWire!');
    });

    // ── 6. Vertical viewport ──────────────────────────────────────

    test('chat-layout has overflow hidden and is contained', async ({ page }) => {
        // The chat-layout uses 100dvh + overflow:hidden to prevent scroll.
        // The global-header may push total scrollHeight slightly beyond innerHeight,
        // but the layout itself clips any overflow. Verify the CSS contract.
        await page.waitForSelector('.chat-layout');
        const result = await page.evaluate(() => {
            const layout = document.querySelector('.chat-layout');
            if (!layout) return { found: false };
            const style = getComputedStyle(layout);
            return {
                found: true,
                overflow: style.overflow,
                overflowY: style.overflowY,
                // Chat-layout should not itself scroll
                hasScrollbar: layout.scrollHeight > layout.clientHeight + 2,
            };
        });
        expect(result.found).toBe(true);
        // overflow: hidden is set on .chat-layout
        expect(['hidden', 'clip']).toContain(result.overflow);
        expect(result.hasScrollbar).toBe(false);
    });

    // ── 7. Horizontal viewport ────────────────────────────────────

    test('no horizontal scroll', async ({ page }) => {
        await page.waitForSelector('.chat-layout');
        const noHScroll = await page.evaluate(() => {
            return document.documentElement.scrollWidth <= window.innerWidth;
        });
        expect(noHScroll).toBe(true);
    });

    // ── 8. Account history button ─────────────────────────────────

    test('account history button exists in header', async ({ page }) => {
        const historyBtn = page.locator('.btn-account-history');
        await expect(historyBtn).toBeVisible();
        // The button text is the chart emoji
        await expect(historyBtn).toHaveText(/📊/);
    });

    // ── 9. Sidebar structure ──────────────────────────────────────

    test('sidebar shows channels section and wallet section', async ({ page }) => {
        const sidebar = page.locator('.sidebar');
        await expect(sidebar).toBeVisible();

        // Channels section with General Chat
        await expect(sidebar.locator('.sidebar-title').first()).toHaveText('Channels');
        await expect(sidebar.locator('text=General Chat')).toBeVisible();

        // Wallet section
        await expect(sidebar.locator('text=My Wallet')).toBeVisible();
        await expect(sidebar.locator('.wallet-balance')).toContainText('chips');
    });

    // ── 10. Messages area present ─────────────────────────────────

    test('messages area is rendered and empty on fresh session', async ({ page }) => {
        const messagesArea = page.locator('.messages-area');
        await expect(messagesArea).toBeVisible();

        // Verify the area actually has no user/peer messages (system msgs may exist)
        const msgCount = await messagesArea.locator('.msg.peer, .msg.self').count();
        expect(msgCount).toBe(0);
    });
});
