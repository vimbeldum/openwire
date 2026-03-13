/**
 * Security E2E Test Suite
 *
 * Comprehensive security tests covering XSS prevention, session tampering,
 * WebSocket message injection, input validation, and admin gate security.
 *
 * React's JSX escaping is the primary XSS defence — these tests verify
 * that malicious payloads render as inert text rather than executing.
 */
import { test, expect } from '@playwright/test';
import { mockWebSocket, loginAs, clearSession, setWallet } from './helpers.js';

// ── Helper: wait for the mock WebSocket to become active ───────────
async function waitForWs(page, timeoutMs = 3000) {
    await page.waitForFunction(
        () => window.__wsMock?.active?.readyState === 1,
        { timeout: timeoutMs },
    );
}

// ── Helper: inject a message into the active mock WebSocket ────────
async function injectMessage(page, data) {
    await page.evaluate((payload) => {
        const ws = window.__wsMock?.active;
        if (ws) ws._injectMessage(JSON.stringify(payload));
    }, data);
}

// ── Helper: small sleep for React to reconcile ─────────────────────
function tick(ms = 300) {
    return new Promise((r) => setTimeout(r, ms));
}

// ═══════════════════════════════════════════════════════════════════
// 1. XSS Prevention (React JSX escaping verification)
// ═══════════════════════════════════════════════════════════════════

test.describe('XSS Prevention', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'XSSTarget');
        await setWallet(page, 1000);
        await page.goto('/');
        await waitForWs(page);
    });

    test('script tag renders as inert text, not executed', async ({ page }) => {
        // Set a sentinel that would be flipped if script executed
        await page.evaluate(() => { window.__xss_fired = false; });

        await injectMessage(page, {
            type: 'message',
            nick: 'Attacker',
            data: '<script>window.__xss_fired=true</script>',
        });
        await tick();

        // The text should appear literally in the DOM
        const msgArea = page.locator('.messages-area');
        await expect(msgArea).toContainText('<script>window.__xss_fired=true</script>');

        // Sentinel must not have been flipped
        const fired = await page.evaluate(() => window.__xss_fired);
        expect(fired).toBe(false);
    });

    test('SVG-based XSS payload renders as text', async ({ page }) => {
        await page.evaluate(() => { window.__svg_xss = false; });

        await injectMessage(page, {
            type: 'message',
            nick: 'Attacker',
            data: '<svg/onload=window.__svg_xss=true>',
        });
        await tick();

        const msgArea = page.locator('.messages-area');
        await expect(msgArea).toContainText('<svg/onload=');

        const fired = await page.evaluate(() => window.__svg_xss);
        expect(fired).toBe(false);
    });

    test('img onerror XSS payload renders as text', async ({ page }) => {
        await page.evaluate(() => { window.__img_xss = false; });

        await injectMessage(page, {
            type: 'message',
            nick: 'Attacker',
            data: '<img src=x onerror=window.__img_xss=true>',
        });
        await tick();

        const msgArea = page.locator('.messages-area');
        await expect(msgArea).toContainText('<img src=x onerror=');

        const fired = await page.evaluate(() => window.__img_xss);
        expect(fired).toBe(false);
    });

    test('CSS injection payload renders as text, not applied', async ({ page }) => {
        await injectMessage(page, {
            type: 'message',
            nick: 'Attacker',
            data: '<style>body{display:none}</style>',
        });
        await tick();

        // Body must still be visible (CSS not injected)
        const bodyVisible = await page.evaluate(() => {
            return getComputedStyle(document.body).display !== 'none';
        });
        expect(bodyVisible).toBe(true);

        const msgArea = page.locator('.messages-area');
        await expect(msgArea).toContainText('<style>body{display:none}</style>');
    });

    test('nickname-based XSS renders as text in sender field', async ({ page }) => {
        await page.evaluate(() => { window.__nick_xss = false; });

        await injectMessage(page, {
            type: 'message',
            nick: '<img src=x onerror=window.__nick_xss=true>',
            data: 'Hello there',
        });
        await tick();

        // The malicious nick should appear as literal text in the sender span
        const senderSpan = page.locator('.msg-sender').filter({ hasText: '<img' });
        await expect(senderSpan).toBeVisible();

        const fired = await page.evaluate(() => window.__nick_xss);
        expect(fired).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Session Tampering
// ═══════════════════════════════════════════════════════════════════

test.describe('Session Tampering', () => {
    test('manually setting isAdmin: true in localStorage shows admin UI', async ({ page }) => {
        // This is expected client-side behaviour — admin is localStorage gated.
        // Document it: anyone who sets isAdmin=true locally gets the admin button.
        await mockWebSocket(page);
        await loginAs(page, 'Tamperer', true); // isAdmin = true
        await setWallet(page, 1000);
        await page.goto('/');

        // Admin Portal button should appear in the sidebar
        const adminBtn = page.locator('.admin-btn-sidebar');
        await expect(adminBtn).toBeVisible();
        await expect(adminBtn).toContainText('Admin Portal');
    });

    test('invalid JSON in wallet key does not crash the app', async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'BadWallet');
        // Inject malformed wallet JSON
        await page.addInitScript(() => {
            const deviceId = 'test-device-e2e';
            localStorage.setItem('openwire_device_id', deviceId);
            localStorage.setItem(`openwire_wallet_dev_${deviceId}`, '{not valid json!!!');
        });
        await page.goto('/');

        // App should still render — ChatRoom or Landing, no white screen
        const hasContent = await page.evaluate(() => document.body.innerText.length > 0);
        expect(hasContent).toBe(true);

        // No uncaught exception crash — the page should have meaningful UI
        const hasUI = await page.locator('.chat-layout, .landing').first().isVisible();
        expect(hasUI).toBe(true);
    });

    test('negative wallet baseBalance does not crash the app', async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'NegativeWallet');
        await page.addInitScript(() => {
            const deviceId = 'test-device-e2e';
            localStorage.setItem('openwire_device_id', deviceId);
            const today = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Kolkata',
                year: 'numeric', month: '2-digit', day: '2-digit',
            }).format(new Date());
            localStorage.setItem(`openwire_wallet_dev_${deviceId}`, JSON.stringify({
                deviceId,
                nick: 'NegativeWallet',
                baseBalance: -9999,
                adminBonus: 0,
                lastRefreshDate: today,
                history: [],
            }));
        });
        await page.goto('/');

        // App renders without crash
        const hasUI = await page.locator('.chat-layout').isVisible();
        expect(hasUI).toBe(true);
    });

    test('clearing device ID while wallet exists is handled gracefully', async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'NoDevice');
        await setWallet(page, 500);
        // Remove device ID after wallet was set
        await page.addInitScript(() => {
            localStorage.removeItem('openwire_device_id');
        });
        await page.goto('/');

        // App should still render without crashing
        const hasUI = await page.locator('.chat-layout, .landing').first().isVisible();
        expect(hasUI).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════
// 3. WebSocket Message Injection
// ═══════════════════════════════════════════════════════════════════

test.describe('WebSocket Message Injection', () => {
    let errors;

    test.beforeEach(async ({ page }) => {
        errors = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') errors.push(msg.text());
        });
        await mockWebSocket(page);
        await loginAs(page, 'Defender');
        await setWallet(page, 1000);
        await page.goto('/');
        await waitForWs(page);
    });

    test('prototype pollution payload does not crash the app', async ({ page }) => {
        await injectMessage(page, {
            type: 'message',
            nick: 'Polluter',
            data: '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}',
        });
        await tick();

        // Object.prototype must not be tainted
        const polluted = await page.evaluate(() => ({}).polluted);
        expect(polluted).toBeUndefined();

        // App still functional
        await expect(page.locator('.chat-layout')).toBeVisible();
    });

    test('very long message (10KB+) does not crash the app', async ({ page }) => {
        const longData = 'A'.repeat(12000);
        await injectMessage(page, {
            type: 'message',
            nick: 'Spammer',
            data: longData,
        });
        await tick();

        // App must still be alive
        await expect(page.locator('.chat-layout')).toBeVisible();

        // The message area should contain part of the long string
        const msgArea = page.locator('.messages-area');
        await expect(msgArea).toContainText('AAAA');
    });

    test('message with missing required fields does not crash', async ({ page }) => {
        // Missing nick and data
        await injectMessage(page, { type: 'message' });
        await tick();

        // Missing type entirely
        await page.evaluate(() => {
            const ws = window.__wsMock?.active;
            if (ws) ws._injectMessage(JSON.stringify({ random: 'stuff' }));
        });
        await tick();

        // App still alive
        await expect(page.locator('.chat-layout')).toBeVisible();
    });

    test('message with unexpected type field does not crash', async ({ page }) => {
        await injectMessage(page, {
            type: 'nonexistent_evil_type',
            nick: 'Unknown',
            data: 'surprise',
        });
        await tick();

        await expect(page.locator('.chat-layout')).toBeVisible();
    });

    test('message with numeric type instead of string does not crash', async ({ page }) => {
        await injectMessage(page, {
            type: 99999,
            nick: 'NumType',
            data: 'numeric type attack',
        });
        await tick();

        await expect(page.locator('.chat-layout')).toBeVisible();
    });

    test('no console errors from injection attacks', async ({ page }) => {
        // Inject a series of odd payloads
        await injectMessage(page, { type: 'message', nick: null, data: null });
        await injectMessage(page, { type: 'message', nick: 123, data: [] });
        await injectMessage(page, { type: 'message', nick: 'OK', data: { nested: true } });
        await tick(500);

        // Filter out known benign warnings (e.g. WebSocket security warning)
        const realErrors = errors.filter(
            (e) => !e.includes('Security warning') && !e.includes('favicon'),
        );
        expect(realErrors).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Input Validation
// ═══════════════════════════════════════════════════════════════════

test.describe('Input Validation', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'Validator');
        await setWallet(page, 1000);
        await page.goto('/');
        await waitForWs(page);
    });

    test('very long chat message (10000 chars) renders without layout overflow', async ({ page }) => {
        const longMsg = 'X'.repeat(10000);
        await injectMessage(page, {
            type: 'message',
            nick: 'LongWriter',
            data: longMsg,
        });
        await tick();

        // Message area must still be visible
        await expect(page.locator('.messages-area')).toBeVisible();

        // No horizontal scrollbar on the document
        const noHScroll = await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
        );
        expect(noHScroll).toBe(true);
    });

    test('Unicode control characters in messages do not crash rendering', async ({ page }) => {
        const controlChars = 'Hello\x00\x01\x02\x03\x04\x05\x06\x07\x08World';
        await injectMessage(page, {
            type: 'message',
            nick: 'ControlChar',
            data: controlChars,
        });
        await tick();

        // App alive and the message is visible (control chars stripped or harmless)
        await expect(page.locator('.messages-area')).toContainText(/Hello.*World/);
    });

    test('RTL override characters do not break layout', async ({ page }) => {
        const rtlPayload = 'Normal text \u202E\u0627\u0644\u0639\u0631\u0628\u064A\u0629 reversed \u202C back';
        await injectMessage(page, {
            type: 'message',
            nick: 'RTLUser',
            data: rtlPayload,
        });
        await tick();

        // App still renders
        await expect(page.locator('.chat-layout')).toBeVisible();

        // Chat layout overflow must still be hidden (no layout break)
        const contained = await page.evaluate(() => {
            const layout = document.querySelector('.chat-layout');
            if (!layout) return true;
            return layout.scrollWidth <= layout.clientWidth + 2;
        });
        expect(contained).toBe(true);
    });

    test('emoji-heavy messages render without crash', async ({ page }) => {
        const emojiFlood = '\uD83D\uDE00\uD83D\uDE02\uD83E\uDD23\uD83D\uDE0D\uD83E\uDD70\uD83D\uDE18\uD83D\uDE09\uD83D\uDE0B\uD83E\uDD2A\uD83D\uDE1C'.repeat(50);
        await injectMessage(page, {
            type: 'message',
            nick: 'EmojiKing',
            data: emojiFlood,
        });
        await tick();

        await expect(page.locator('.messages-area')).toBeVisible();
    });

    test('NULL bytes in messages do not crash rendering', async ({ page }) => {
        await injectMessage(page, {
            type: 'message',
            nick: 'NullByte',
            data: 'before\x00after\x00end',
        });
        await tick();

        // The message content should be present (null bytes may be stripped or kept)
        await expect(page.locator('.messages-area')).toContainText(/before/);
        await expect(page.locator('.chat-layout')).toBeVisible();
    });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Admin Gate Security
// ═══════════════════════════════════════════════════════════════════

test.describe('Admin Gate Security', () => {
    test.beforeEach(async ({ page }) => {
        await clearSession(page);
        await mockWebSocket(page);
        await page.goto('/');
    });

    test('rapid password attempts each show error feedback', async ({ page }) => {
        await page.locator('.admin-access-link').click();
        await expect(page.locator('.admin-gate-card')).toBeVisible();

        const pwInput = page.locator('.admin-gate-card input[type="password"]');
        const submitBtn = page.locator('.admin-gate-card button[type="submit"]');

        // Attempt 5 rapid wrong passwords
        for (let i = 0; i < 5; i++) {
            await pwInput.fill(`wrong-password-${i}`);
            await submitBtn.click();
            // Wait for the 400ms simulated delay in the handler
            await expect(page.locator('.admin-gate-error')).toHaveText('Incorrect password.');
        }

        // The gate should still be open (no lockout mechanism, just error shown)
        await expect(page.locator('.admin-gate-card')).toBeVisible();
    });

    test('SQL injection in password field shows error, no crash', async ({ page }) => {
        await page.locator('.admin-access-link').click();
        await expect(page.locator('.admin-gate-card')).toBeVisible();

        const pwInput = page.locator('.admin-gate-card input[type="password"]');
        await pwInput.fill("' OR '1'='1' --");
        await page.locator('.admin-gate-card button[type="submit"]').click();

        // Should show incorrect password (string comparison, not SQL)
        await expect(page.locator('.admin-gate-error')).toHaveText('Incorrect password.');
    });

    test('empty password submission shows error', async ({ page }) => {
        await page.locator('.admin-access-link').click();
        await expect(page.locator('.admin-gate-card')).toBeVisible();

        // Submit with empty password
        await page.locator('.admin-gate-card button[type="submit"]').click();

        // Should show incorrect password error
        await expect(page.locator('.admin-gate-error')).toHaveText('Incorrect password.');
    });
});
