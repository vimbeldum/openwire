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
        // Chat header shows the logged-in nick
        const header = page.locator('.chat-header');
        await expect(header).toBeVisible();
        await expect(header.locator('.header-nick')).toHaveText('TestUser');

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

/* ══════════════════════════════════════════════════════════════════
   11. RESPONSIVE BREAKPOINTS
   ══════════════════════════════════════════════════════════════════ */
test.describe('ChatRoom — responsive breakpoints', () => {
    const BREAKPOINTS = [390, 768, 1024, 1280];

    for (const width of BREAKPOINTS) {
        test(`no horizontal scroll at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await mockWebSocket(page);
            await loginAs(page, 'TestUser');
            await setWallet(page, 1000);
            await page.goto('/');
            await page.waitForSelector('.chat-layout');

            const noHScroll = await page.evaluate(() =>
                document.documentElement.scrollWidth <= window.innerWidth
            );
            expect(noHScroll).toBe(true);
        });

        test(`chat header is visible at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await mockWebSocket(page);
            await loginAs(page, 'TestUser');
            await setWallet(page, 1000);
            await page.goto('/');
            await page.waitForSelector('.chat-header');

            await expect(page.locator('.chat-header')).toBeVisible();
            await expect(page.locator('.header-nick')).toHaveText('TestUser');
        });

        test(`chat input is usable at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await mockWebSocket(page);
            await loginAs(page, 'TestUser');
            await setWallet(page, 1000);
            await page.goto('/');
            await page.waitForSelector('.chat-layout');

            const input = page.locator('.chat-input input[type="text"]');
            await expect(input).toBeVisible();
            await input.fill('Hi from breakpoint');
            await expect(input).toHaveValue('Hi from breakpoint');
        });

        test(`wallet balance visible at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await mockWebSocket(page);
            await loginAs(page, 'TestUser');
            await setWallet(page, 1000);
            await page.goto('/');
            await page.waitForSelector('.chat-header');

            await expect(page.locator('.header-chips')).toBeVisible();
            await expect(page.locator('.header-chips')).toHaveText(/1[,.]?000/);
        });
    }

    // ── Sidebar drawer reachability ────────────────────────────────

    test('hamburger button has accessible aria-label', async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await page.waitForSelector('.chat-header');

        const hamburger = page.locator('.hamburger-btn');
        await expect(hamburger).toBeVisible();
        await expect(hamburger).toHaveAttribute('aria-label', 'Open sidebar');
        await expect(hamburger).toHaveAttribute('aria-expanded', 'false');
        await expect(hamburger).toHaveAttribute('aria-controls', 'chat-sidebar');
    });

    test('clicking hamburger toggles sidebar visibility', async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await page.waitForSelector('.chat-header');

        const hamburger = page.locator('.hamburger-btn');

        // Click to open sidebar
        await hamburger.click();
        // Verify aria-expanded changes to true
        await expect(hamburger).toHaveAttribute('aria-expanded', 'true');
        await expect(hamburger).toHaveAttribute('aria-label', 'Close sidebar');

        // Click again to close
        await hamburger.click();
        await expect(hamburger).toHaveAttribute('aria-expanded', 'false');
        await expect(hamburger).toHaveAttribute('aria-label', 'Open sidebar');
    });

    test('sidebar is reachable at 390px via hamburger', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 900 });
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await page.waitForSelector('.chat-header');

        // Hamburger is visible on mobile
        const hamburger = page.locator('.hamburger-btn');
        await expect(hamburger).toBeVisible();

        // Open sidebar
        await hamburger.click();
        // Sidebar content should be accessible
        await expect(page.locator('.sidebar')).toBeVisible();
        await expect(page.locator('text=My Wallet')).toBeVisible();
        await expect(page.locator('text=General Chat')).toBeVisible();
    });

    // ── Accessibility label verification ───────────────────────────

    test('icon-only buttons in header have accessible labels', async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await page.waitForSelector('.chat-header');

        // Account history button
        const historyBtn = page.locator('.btn-account-history');
        await expect(historyBtn).toHaveAttribute('aria-label', 'Account History');

        // Hamburger button
        await expect(page.locator('.hamburger-btn')).toHaveAttribute('aria-label', 'Open sidebar');
    });

    test('admin user sees agent panel button with accessible label', async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'Admin', true);
        await setWallet(page, 5000);
        await page.goto('/');
        await page.waitForSelector('.chat-header');

        const agentBtn = page.locator('.btn-agent-panel');
        await expect(agentBtn).toBeVisible();
        await expect(agentBtn).toHaveAttribute('aria-label', 'Toggle AI agent panel');

        // Mute agents button
        const muteBtn = page.locator('.btn-mute-agents');
        await expect(muteBtn).toBeVisible();
        await expect(muteBtn).toHaveAttribute('aria-label', /mute/i);
    });

    test('header uses correct aria landmarks', async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await page.waitForSelector('.chat-header');

        // Header context has aria-label
        await expect(page.locator('.header-context')).toHaveAttribute('aria-label', 'Conversation context');
        // Session status has aria-label
        await expect(page.locator('.header-status')).toHaveAttribute('aria-label', 'Session status');
        // Compact context has aria-label
        await expect(page.locator('.header-context-compact')).toHaveAttribute('aria-label', 'Room and session summary');
    });
});
