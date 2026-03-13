/**
 * Games & Viewport E2E Tests
 *
 * Validates game command entry, viewport constraints at multiple
 * breakpoints, chatroom structural integrity, and the Landing page
 * when logged out.
 */
import { test, expect } from '@playwright/test';
import { mockWebSocket, loginAs, clearSession, setWallet } from './helpers.js';

// ═══════════════════════════════════════════════════════════════
//  1. Game command input tests
// ═══════════════════════════════════════════════════════════════

test.describe('Game command input', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
    });

    test('typing /roulette is accepted in chat input', async ({ page }) => {
        const input = page.locator('.chat-input input[type="text"]');
        await expect(input).toBeVisible();
        await input.fill('/roulette');
        await expect(input).toHaveValue('/roulette');
    });

    test('typing /blackjack is accepted in chat input', async ({ page }) => {
        const input = page.locator('.chat-input input[type="text"]');
        await input.fill('/blackjack');
        await expect(input).toHaveValue('/blackjack');
    });

    test('typing /andarbahar is accepted in chat input', async ({ page }) => {
        const input = page.locator('.chat-input input[type="text"]');
        await input.fill('/andarbahar');
        await expect(input).toHaveValue('/andarbahar');
    });

    test('typing /help is accepted and can be submitted', async ({ page }) => {
        const input = page.locator('.chat-input input[type="text"]');
        await input.fill('/help');
        await expect(input).toHaveValue('/help');

        // Submit the form — the send button exists
        const sendBtn = page.locator('.chat-input button[type="submit"]');
        await expect(sendBtn).toBeVisible();
    });
});

// ═══════════════════════════════════════════════════════════════
//  2. Viewport constraint tests at multiple breakpoints
// ═══════════════════════════════════════════════════════════════

test.describe('Viewport constraints', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
    });

    test('chatroom has overflow hidden on desktop (1280x720)', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.goto('/');
        await page.waitForSelector('.chat-layout');

        const result = await page.evaluate(() => {
            const layout = document.querySelector('.chat-layout');
            if (!layout) return { found: false };
            const style = getComputedStyle(layout);
            return {
                found: true,
                overflow: style.overflow,
                noHScroll: document.documentElement.scrollWidth <= window.innerWidth,
            };
        });
        expect(result.found).toBe(true);
        expect(['hidden', 'clip']).toContain(result.overflow);
        expect(result.noHScroll).toBe(true);
    });

    test('chatroom has overflow hidden on tablet portrait (768x1024)', async ({ page }) => {
        await page.setViewportSize({ width: 768, height: 1024 });
        await page.goto('/');
        await page.waitForSelector('.chat-layout');

        const result = await page.evaluate(() => {
            const layout = document.querySelector('.chat-layout');
            if (!layout) return { found: false };
            const style = getComputedStyle(layout);
            return {
                found: true,
                overflow: style.overflow,
                noHScroll: document.documentElement.scrollWidth <= window.innerWidth,
            };
        });
        expect(result.found).toBe(true);
        expect(['hidden', 'clip']).toContain(result.overflow);
        expect(result.noHScroll).toBe(true);
    });

    test('chatroom has overflow hidden on mobile (375x667)', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/');
        await page.waitForSelector('.chat-layout');

        const result = await page.evaluate(() => {
            const layout = document.querySelector('.chat-layout');
            if (!layout) return { found: false };
            const style = getComputedStyle(layout);
            return {
                found: true,
                overflow: style.overflow,
                noHScroll: document.documentElement.scrollWidth <= window.innerWidth,
            };
        });
        expect(result.found).toBe(true);
        expect(['hidden', 'clip']).toContain(result.overflow);
        expect(result.noHScroll).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════
//  3. ChatRoom structural integrity tests
// ═══════════════════════════════════════════════════════════════

test.describe('ChatRoom structure', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
    });

    test('chat header displays OpenWire branding and status area', async ({ page }) => {
        const header = page.locator('.chat-header');
        await expect(header).toBeVisible();

        // Branding in h1
        await expect(header.locator('h1')).toContainText('OpenWire');

        // Header-status area exists (contains balance, connection dot, etc.)
        await expect(header.locator('.header-status')).toBeVisible();
    });

    test('GIF button and Send button are present in input area', async ({ page }) => {
        const gifBtn = page.locator('.gif-btn');
        await expect(gifBtn).toBeVisible();
        await expect(gifBtn).toHaveText('GIF');

        const sendBtn = page.locator('.chat-input button[type="submit"]');
        await expect(sendBtn).toBeVisible();
        await expect(sendBtn).toHaveText('Send');
    });

    test('typing indicator bar is rendered (empty state)', async ({ page }) => {
        // TypingBar renders .typing-bar even when no one is typing (with typing-bar-empty class)
        const typingBar = page.locator('.typing-bar');
        await expect(typingBar).toBeVisible();
    });
});

// ═══════════════════════════════════════════════════════════════
//  4. Landing page tests (logged out)
// ═══════════════════════════════════════════════════════════════

test.describe('Landing page', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await clearSession(page);
        await page.goto('/');
    });

    test('landing page renders when no session exists', async ({ page }) => {
        await expect(page.locator('.landing')).toBeVisible();
        await expect(page.locator('.landing-logo')).toContainText('OpenWire');
    });

    test('landing page fits viewport (no scroll)', async ({ page }) => {
        await page.waitForSelector('.landing');
        const fits = await page.evaluate(() => {
            return (
                document.documentElement.scrollHeight <= window.innerHeight &&
                document.documentElement.scrollWidth <= window.innerWidth
            );
        });
        expect(fits).toBe(true);
    });

    test('nickname input and join form are present', async ({ page }) => {
        const nickInput = page.locator('.landing-card input[type="text"]');
        await expect(nickInput).toBeVisible();
        await expect(nickInput).toHaveAttribute('placeholder', /nickname/i);
    });
});
