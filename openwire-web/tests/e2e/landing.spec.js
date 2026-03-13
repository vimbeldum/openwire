import { test, expect } from '@playwright/test';
import { mockWebSocket, loginAs, clearSession } from './helpers.js';

test.describe('Landing Page', () => {
    test.beforeEach(async ({ page }) => {
        await clearSession(page);
        await mockWebSocket(page);
    });

    test('renders landing page with logo and form', async ({ page }) => {
        await page.goto('/');

        await expect(page.locator('.landing-logo')).toContainText('OpenWire');
        await expect(page.locator('.landing-card h2')).toContainText('Join the Network');
        await expect(page.locator('input[placeholder="Enter your nickname..."]')).toBeVisible();
        await expect(page.locator('.landing-card button[type="submit"]')).toContainText('Connect');
    });

    test('renders subtitle text', async ({ page }) => {
        await page.goto('/');

        await expect(page.locator('.landing-sub')).toContainText('Decentralized encrypted messenger');
        await expect(page.locator('.landing-sub')).toContainText('No sign-up');
    });

    test('nickname input accepts text and enforces maxLength', async ({ page }) => {
        await page.goto('/');

        const input = page.locator('input[placeholder="Enter your nickname..."]');
        const longName = 'A'.repeat(30);
        await input.fill(longName);

        const value = await input.inputValue();
        expect(value.length).toBeLessThanOrEqual(24);
    });

    test('connect with relay mode (default)', async ({ page }) => {
        await page.goto('/');

        const nickInput = page.locator('input[placeholder="Enter your nickname..."]');
        await nickInput.fill('RelayUser');
        await page.locator('.landing-card button[type="submit"]').click();

        // Landing should disappear, ChatRoom header should appear
        await expect(page.locator('.landing')).not.toBeVisible();
        await expect(page.locator('.global-header')).toBeVisible();
        await expect(page.locator('.global-header strong')).toContainText('RelayUser');
    });

    test('relay radio is checked by default', async ({ page }) => {
        await page.goto('/');

        const relayRadio = page.locator('input[name="connectMode"][value="relay"]');
        const cliRadio = page.locator('input[name="connectMode"][value="cli-node"]');

        await expect(relayRadio).toBeChecked();
        await expect(cliRadio).not.toBeChecked();
    });

    test('CLI URL input hidden by default', async ({ page }) => {
        await page.goto('/');

        await expect(page.locator('.landing-cli-url-input')).not.toBeVisible();
    });

    test('CLI URL input shows when CLI mode selected', async ({ page }) => {
        await page.goto('/');

        await page.locator('input[name="connectMode"][value="cli-node"]').check();

        await expect(page.locator('.landing-cli-url-input')).toBeVisible();
    });

    test('switching back to relay hides CLI URL input', async ({ page }) => {
        await page.goto('/');

        // Select CLI mode -- URL input should appear
        await page.locator('input[name="connectMode"][value="cli-node"]').check();
        await expect(page.locator('.landing-cli-url-input')).toBeVisible();

        // Switch back to relay -- URL input should disappear
        await page.locator('input[name="connectMode"][value="relay"]').check();
        await expect(page.locator('.landing-cli-url-input')).not.toBeVisible();
    });

    test('connect with CLI node mode shows CLI badge', async ({ page }) => {
        await page.goto('/');

        const nickInput = page.locator('input[placeholder="Enter your nickname..."]');
        await nickInput.fill('CliUser');

        // Select CLI mode and set a custom URL
        await page.locator('input[name="connectMode"][value="cli-node"]').check();
        const cliInput = page.locator('.landing-cli-url-input');
        await cliInput.clear();
        await cliInput.fill('ws://192.168.1.50:18080');

        await page.locator('.landing-card button[type="submit"]').click();

        // Verify ChatRoom appears with CLI Node badge
        await expect(page.locator('.global-header')).toBeVisible();
        await expect(page.locator('.global-header strong')).toContainText('CliUser');
        await expect(page.locator('.connection-mode-badge')).toContainText('CLI Node');
    });

    test('nickname sanitization trims whitespace', async ({ page }) => {
        await page.goto('/');

        const nickInput = page.locator('input[placeholder="Enter your nickname..."]');
        await nickInput.fill('  SpaceyUser  ');
        await page.locator('.landing-card button[type="submit"]').click();

        await expect(page.locator('.global-header strong')).toContainText('SpaceyUser');
        // Verify the trimmed value has no leading/trailing spaces
        const nickText = await page.locator('.global-header strong').textContent();
        expect(nickText).toBe('SpaceyUser');
    });

    test('empty nickname defaults to Anonymous', async ({ page }) => {
        await page.goto('/');

        // Leave nickname empty, just click submit
        await page.locator('.landing-card button[type="submit"]').click();

        await expect(page.locator('.global-header')).toBeVisible();
        await expect(page.locator('.global-header strong')).toContainText('Anonymous');
    });

    test('admin access button opens admin gate', async ({ page }) => {
        await page.goto('/');

        await page.locator('.admin-access-link').click();

        // Admin gate overlay should appear
        await expect(page.locator('.admin-overlay')).toBeVisible();
        await expect(page.locator('.admin-gate-card h2')).toContainText('Admin Access');
        await expect(page.locator('.admin-gate-card input[type="password"]')).toBeVisible();
    });

    test('session persists across reload', async ({ context }) => {
        // Use a fresh page without clearSession so init scripts don't
        // wipe localStorage on reload. loginAs re-sets the session on
        // every navigation, faithfully simulating browser persistence.
        const page = await context.newPage();
        await mockWebSocket(page);
        await loginAs(page, 'PersistUser');
        await page.goto('/');

        await expect(page.locator('.global-header strong')).toContainText('PersistUser');

        // Reload -- loginAs init script re-applies, simulating persistence
        await page.reload();
        await expect(page.locator('.global-header')).toBeVisible();
        await expect(page.locator('.global-header strong')).toContainText('PersistUser');
        await expect(page.locator('.landing')).not.toBeVisible();
    });

    test('logout returns to landing', async ({ page }) => {
        await page.goto('/');

        // Login
        const nickInput = page.locator('input[placeholder="Enter your nickname..."]');
        await nickInput.fill('LogoutUser');
        await page.locator('.landing-card button[type="submit"]').click();
        await expect(page.locator('.global-header')).toBeVisible();

        // Click logout
        await page.locator('.btn-logout').click();

        // Should be back on Landing
        await expect(page.locator('.landing')).toBeVisible();
        await expect(page.locator('.landing-logo')).toContainText('OpenWire');
        await expect(page.locator('.global-header')).not.toBeVisible();
    });

    test('logout clears session from localStorage', async ({ page }) => {
        await page.goto('/');

        // Login
        const nickInput = page.locator('input[placeholder="Enter your nickname..."]');
        await nickInput.fill('ClearUser');
        await page.locator('.landing-card button[type="submit"]').click();
        await expect(page.locator('.global-header')).toBeVisible();

        // Logout
        await page.locator('.btn-logout').click();
        await expect(page.locator('.landing')).toBeVisible();

        // Verify localStorage is cleared
        const sessionValue = await page.evaluate(() =>
            localStorage.getItem('openwire_session')
        );
        expect(sessionValue).toBeNull();

        // Reload to confirm session is truly gone
        await page.reload();
        await expect(page.locator('.landing')).toBeVisible();
    });

    test('loginAs helper sets session and skips Landing', async ({ page }) => {
        // Use the loginAs helper before navigating
        await loginAs(page, 'HelperUser');
        await page.goto('/');

        // Should go straight to ChatRoom
        await expect(page.locator('.global-header')).toBeVisible();
        await expect(page.locator('.global-header strong')).toContainText('HelperUser');
        await expect(page.locator('.landing')).not.toBeVisible();
    });
});
