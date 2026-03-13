import { test, expect } from '@playwright/test';
import { mockWebSocket, loginAs, clearSession, setWallet } from './helpers.js';

// ---------------------------------------------------------------------------
// Viewport Constraints -- Landing
// ---------------------------------------------------------------------------
test.describe('Viewport Constraints -- Landing', () => {
    test.beforeEach(async ({ page }) => {
        await clearSession(page);
        await mockWebSocket(page);
    });

    test('landing page has no vertical scroll', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.landing');

        const hasVScroll = await page.evaluate(() =>
            document.documentElement.scrollHeight > window.innerHeight
        );
        expect(hasVScroll).toBe(false);
    });

    test('landing page has no horizontal scroll', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.landing');

        const hasHScroll = await page.evaluate(() =>
            document.documentElement.scrollWidth > window.innerWidth
        );
        expect(hasHScroll).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Viewport Constraints -- ChatRoom
// ---------------------------------------------------------------------------
test.describe('Viewport Constraints -- ChatRoom', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'ViewportUser');
    });

    test('chatroom has no vertical scroll', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.global-header');

        const hasVScroll = await page.evaluate(() =>
            document.documentElement.scrollHeight > window.innerHeight
        );
        expect(hasVScroll).toBe(false);
    });

    test('chatroom has no horizontal scroll', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.global-header');

        const hasHScroll = await page.evaluate(() =>
            document.documentElement.scrollWidth > window.innerWidth
        );
        expect(hasHScroll).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Viewport Constraints -- Responsive
// ---------------------------------------------------------------------------
test.describe('Viewport Constraints -- Responsive', () => {
    test.beforeEach(async ({ page }) => {
        await clearSession(page);
        await mockWebSocket(page);
    });

    test('landing page at 375x667 (iPhone SE) has no scroll', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/');
        await page.waitForSelector('.landing');

        const overflow = await page.evaluate(() => ({
            vScroll: document.documentElement.scrollHeight > window.innerHeight,
            hScroll: document.documentElement.scrollWidth > window.innerWidth,
        }));
        expect(overflow.vScroll).toBe(false);
        expect(overflow.hScroll).toBe(false);
    });

    test('chatroom at 375x667 (iPhone SE) has no scroll', async ({ page }) => {
        await loginAs(page, 'MobileUser');
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/');
        await page.waitForSelector('.global-header');

        const overflow = await page.evaluate(() => ({
            vScroll: document.documentElement.scrollHeight > window.innerHeight,
            hScroll: document.documentElement.scrollWidth > window.innerWidth,
        }));
        expect(overflow.vScroll).toBe(false);
        expect(overflow.hScroll).toBe(false);
    });

    test('landing page at 1920x1080 (Full HD) has no scroll', async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.goto('/');
        await page.waitForSelector('.landing');

        const overflow = await page.evaluate(() => ({
            vScroll: document.documentElement.scrollHeight > window.innerHeight,
            hScroll: document.documentElement.scrollWidth > window.innerWidth,
        }));
        expect(overflow.vScroll).toBe(false);
        expect(overflow.hScroll).toBe(false);
    });

    test('chatroom at 1920x1080 (Full HD) has no scroll', async ({ page }) => {
        await loginAs(page, 'DesktopUser');
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.goto('/');
        await page.waitForSelector('.global-header');

        const overflow = await page.evaluate(() => ({
            vScroll: document.documentElement.scrollHeight > window.innerHeight,
            hScroll: document.documentElement.scrollWidth > window.innerWidth,
        }));
        expect(overflow.vScroll).toBe(false);
        expect(overflow.hScroll).toBe(false);
    });

    test('landing page at 768x1024 (iPad) has no scroll', async ({ page }) => {
        await page.setViewportSize({ width: 768, height: 1024 });
        await page.goto('/');
        await page.waitForSelector('.landing');

        const overflow = await page.evaluate(() => ({
            vScroll: document.documentElement.scrollHeight > window.innerHeight,
            hScroll: document.documentElement.scrollWidth > window.innerWidth,
        }));
        expect(overflow.vScroll).toBe(false);
        expect(overflow.hScroll).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Admin Portal Access
// ---------------------------------------------------------------------------
test.describe('Admin Portal Access', () => {
    test.beforeEach(async ({ page }) => {
        await clearSession(page);
        await mockWebSocket(page);
    });

    test('admin access button visible on landing', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.landing');

        const adminBtn = page.locator('.admin-access-link');
        await expect(adminBtn).toBeVisible();
        await expect(adminBtn).toContainText('Admin Access');
    });

    test('admin access button opens password gate', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.landing');

        await page.locator('.admin-access-link').click();

        // The AdminPasswordGate modal should appear
        await expect(page.locator('.admin-overlay')).toBeVisible();
        await expect(page.locator('.admin-gate-card h2')).toContainText('Admin Access');
        await expect(page.locator('.admin-gate-card input[type="password"]')).toBeVisible();
    });

    test('admin password gate has cancel button', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.landing');

        await page.locator('.admin-access-link').click();
        await expect(page.locator('.admin-overlay')).toBeVisible();

        // Click cancel
        const cancelBtn = page.locator('.admin-gate-actions button', { hasText: 'Cancel' });
        await expect(cancelBtn).toBeVisible();
        await cancelBtn.click();

        // Overlay should disappear
        await expect(page.locator('.admin-overlay')).not.toBeVisible();
    });

    test('admin logged in sees agent panel button in header', async ({ page }) => {
        await loginAs(page, 'AdminUser', true);
        await page.goto('/');
        await page.waitForSelector('.global-header');

        // The 🤖 agent panel button only renders when isAdmin is true
        const agentBtn = page.locator('.btn-agent-panel');
        await expect(agentBtn).toBeVisible();
    });

    test('non-admin does NOT see agent panel button', async ({ page }) => {
        await loginAs(page, 'RegularUser', false);
        await page.goto('/');
        await page.waitForSelector('.global-header');

        // The 🤖 agent panel button should not exist for regular users
        const agentBtn = page.locator('.btn-agent-panel');
        await expect(agentBtn).not.toBeVisible();
    });

    test('admin sidebar shows admin portal button', async ({ page }) => {
        await loginAs(page, 'SidebarAdmin', true);
        await page.goto('/');
        await page.waitForSelector('.global-header');

        // The sidebar admin button only renders when initialIsAdmin is true
        const adminSidebarBtn = page.locator('.admin-btn-sidebar');
        // It may be inside a sidebar that needs to be visible; check it exists in DOM
        await expect(adminSidebarBtn).toHaveCount(1);
    });
});

// ---------------------------------------------------------------------------
// Session Persistence
// ---------------------------------------------------------------------------
test.describe('Session Persistence', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
    });

    test('session stored in localStorage after login', async ({ page }) => {
        await clearSession(page);
        await page.goto('/');
        await page.waitForSelector('.landing');

        // Fill nickname and submit
        await page.locator('input[placeholder="Enter your nickname..."]').fill('PersistTest');
        await page.locator('.landing-card button[type="submit"]').click();
        await page.waitForSelector('.global-header');

        // Verify localStorage contains the session
        const session = await page.evaluate(() =>
            JSON.parse(localStorage.getItem('openwire_session'))
        );
        expect(session).not.toBeNull();
        expect(session.nick).toBe('PersistTest');
    });

    test('session cleared after logout', async ({ page }) => {
        await clearSession(page);
        await page.goto('/');
        await page.waitForSelector('.landing');

        // Login
        await page.locator('input[placeholder="Enter your nickname..."]').fill('LogoutTest');
        await page.locator('.landing-card button[type="submit"]').click();
        await page.waitForSelector('.global-header');

        // Logout
        await page.locator('.btn-logout').click();
        await page.waitForSelector('.landing');

        // Verify localStorage no longer has the session
        const session = await page.evaluate(() =>
            localStorage.getItem('openwire_session')
        );
        expect(session).toBeNull();
    });

    test('wallet balance persists across navigation', async ({ page }) => {
        await clearSession(page);
        await loginAs(page, 'WalletUser');
        await setWallet(page, 5000);
        await page.goto('/');
        await page.waitForSelector('.global-header');

        // Verify wallet data persists in localStorage (reliable regardless of
        // whether the header-chips element has rendered yet)
        const walletData = await page.evaluate(() => {
            const deviceId = localStorage.getItem('openwire_device_id');
            if (!deviceId) return null;
            const raw = localStorage.getItem(`openwire_wallet_dev_${deviceId}`);
            return raw ? JSON.parse(raw) : null;
        });
        expect(walletData).not.toBeNull();
        expect(walletData.baseBalance).toBe(5000);

        // Reload and verify balance persists across navigation
        await page.reload();
        await page.waitForSelector('.global-header');

        const walletAfterReload = await page.evaluate(() => {
            const deviceId = localStorage.getItem('openwire_device_id');
            if (!deviceId) return null;
            const raw = localStorage.getItem(`openwire_wallet_dev_${deviceId}`);
            return raw ? JSON.parse(raw) : null;
        });
        expect(walletAfterReload).not.toBeNull();
        expect(walletAfterReload.baseBalance).toBe(5000);
    });
});

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------
test.describe('Error Handling', () => {
    test.beforeEach(async ({ page }) => {
        await clearSession(page);
        await mockWebSocket(page);
    });

    test('app renders without critical console errors', async ({ page }) => {
        const criticalErrors = [];

        page.on('console', (msg) => {
            if (msg.type() === 'error') {
                const text = msg.text();
                // Ignore expected WebSocket and network-related errors
                const isExpected =
                    text.includes('WebSocket') ||
                    text.includes('ws://') ||
                    text.includes('wss://') ||
                    text.includes('net::ERR') ||
                    text.includes('Failed to fetch') ||
                    text.includes('favicon');
                if (!isExpected) {
                    criticalErrors.push(text);
                }
            }
        });

        await page.goto('/');
        await page.waitForSelector('.landing');

        // Wait for network idle to catch any deferred console errors
        await page.waitForLoadState('networkidle');

        expect(criticalErrors).toEqual([]);
    });

    test('ErrorBoundary wraps the app (no unhandled render crash)', async ({ page }) => {
        // Navigate to the app and verify it renders without the ErrorBoundary
        // fallback UI (which contains "Runtime error")
        await page.goto('/');
        await page.waitForSelector('.landing');

        // The error boundary fallback text should NOT be visible
        const errorFallback = page.locator('text=Runtime error');
        await expect(errorFallback).not.toBeVisible();

        // Confirm the app actually rendered its content
        await expect(page.locator('.landing-logo')).toContainText('OpenWire');
    });
});
