import { test, expect } from '@playwright/test';
import { mockWebSocket, loginAs, clearSession, setWallet, setupRuntimeGuard, expectNoRuntimeErrors } from './helpers.js';

// ---------------------------------------------------------------------------
// Admin Portal Access
// ---------------------------------------------------------------------------
test.describe('Admin Portal Access', () => {
    test.beforeEach(async ({ page }) => {
        await clearSession(page);
        await mockWebSocket(page);
        await setupRuntimeGuard(page);
    });

    test.afterEach(async ({ page }) => {
        await expectNoRuntimeErrors(page);
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
        await page.waitForSelector('.chat-header');

        // The 🤖 agent panel button only renders when isAdmin is true
        const agentBtn = page.locator('.btn-agent-panel');
        await expect(agentBtn).toBeVisible();
    });

    test('non-admin does NOT see agent panel button', async ({ page }) => {
        await loginAs(page, 'RegularUser', false);
        await page.goto('/');
        await page.waitForSelector('.chat-header');

        // The 🤖 agent panel button should not exist for regular users
        const agentBtn = page.locator('.btn-agent-panel');
        await expect(agentBtn).not.toBeVisible();
    });

    test('admin sidebar shows admin portal button', async ({ page }) => {
        await loginAs(page, 'SidebarAdmin', true);
        await page.goto('/');
        await page.waitForSelector('.chat-header');

        // The sidebar admin button only renders when initialIsAdmin is true
        const adminSidebarBtn = page.locator('.admin-btn-sidebar');
        // It may be inside a sidebar that needs to be visible; check it exists in DOM
        await expect(adminSidebarBtn).toHaveCount(1);
    });

    test('admin gate shows error on incorrect password', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.landing');

        // Open admin gate
        await page.locator('.admin-access-link').click();
        await expect(page.locator('.admin-overlay')).toBeVisible();

        // Verify dialog has the repaired accessible name
        await expect(page.getByRole('dialog', { name: 'Unlock admin access' })).toBeVisible();

        // Enter wrong password and submit
        await page.locator('.admin-gate-card input[type="password"]').fill('wrong-password');
        await page.locator('.admin-gate-actions button[type="submit"]').click();

        // Error message should appear
        await expect(page.locator('.ui-field__error')).toHaveText('Incorrect password.');

        // Dialog should remain visible (user can retry)
        await expect(page.locator('.admin-overlay')).toBeVisible();
    });

    test('admin gate accepts correct password and joins as admin', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.landing');

        // Fill in a nickname before opening admin gate
        await page.locator('input[placeholder="Enter your nickname..."]').fill('GateAdmin');

        // Open admin gate
        await page.locator('.admin-access-link').click();
        await expect(page.locator('.admin-overlay')).toBeVisible();

        // Verify dialog has the repaired accessible name
        await expect(page.getByRole('dialog', { name: 'Unlock admin access' })).toBeVisible();

        // Enter correct password and unlock
        await page.locator('.admin-gate-card input[type="password"]').fill('openwire-admin');
        await page.locator('.admin-gate-actions button[type="submit"]').click();

        // Dialog should close
        await expect(page.locator('.admin-overlay')).not.toBeVisible();

        // Should join as admin -- ChatRoom visible with nickname
        await expect(page.locator('.chat-header')).toBeVisible();
        await expect(page.locator('.header-nick')).toContainText('GateAdmin');

        // Admin-specific UI should be visible
        await expect(page.locator('.btn-agent-panel')).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Session Persistence
// ---------------------------------------------------------------------------
test.describe('Session Persistence', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await setupRuntimeGuard(page);
    });

    test.afterEach(async ({ page }) => {
        await expectNoRuntimeErrors(page);
    });

    test('session stored in localStorage after login', async ({ page }) => {
        await clearSession(page);
        await page.goto('/');
        await page.waitForSelector('.landing');

        // Fill nickname and submit
        await page.locator('input[placeholder="Enter your nickname..."]').fill('PersistTest');
        await page.locator('.landing-card button[type="submit"]').click();
        await page.waitForSelector('.chat-header');

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
        await page.waitForSelector('.chat-header');

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
        await page.waitForSelector('.chat-header');

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
        await page.waitForSelector('.chat-header');

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
        await setupRuntimeGuard(page);
    });

    test.afterEach(async ({ page }) => {
        await expectNoRuntimeErrors(page);
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
        await expect(page.locator('.landing-kicker')).toContainText('OpenWire');
    });
});
