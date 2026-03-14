/**
 * WebSocket Event Handling E2E Tests
 *
 * Validates that the ChatRoom component correctly handles all major
 * WebSocket message types: peer_joined, peer_left, peers, room_invite,
 * kicked, error, admin_adjust_balance, and rapid peer events.
 *
 * All tests run WITHOUT a real backend using the mock WebSocket from helpers.js.
 */
import { test, expect } from '@playwright/test';
import { mockWebSocket, loginAs, setWallet } from './helpers.js';

/**
 * Set up mock WebSocket, login, navigate, and inject welcome so the app
 * is fully initialised and rendering the ChatRoom UI.
 */
async function setupAndWelcome(page) {
    await mockWebSocket(page);
    await loginAs(page, 'TestUser');
    await setWallet(page, 1000);
    await page.goto('/');
    await page.waitForSelector('.global-header');
    await page.evaluate(() => {
        const ws = window.__wsMock?.active;
        if (ws) ws._injectMessage(JSON.stringify({
            type: 'welcome', peer_id: 'me-001', nick: 'TestUser', peers: [], rooms: [],
        }));
    });
    await page.waitForTimeout(200);
}

/**
 * Inject a single message into the active mock WebSocket.
 */
async function injectMessage(page, msg) {
    await page.evaluate((data) => {
        const ws = window.__wsMock?.active;
        if (ws) ws._injectMessage(JSON.stringify(data));
    }, msg);
}

/**
 * Collect all visible system messages from the messages area.
 */
async function getSystemMessages(page) {
    return page.evaluate(() => {
        const msgs = document.querySelectorAll('.messages-area .msg.system .msg-content');
        return Array.from(msgs).map(el => el.textContent.trim());
    });
}

// ── peer_joined ─────────────────────────────────────────────────────────

test.describe('peer_joined event', () => {
    test.beforeEach(async ({ page }) => {
        await setupAndWelcome(page);
    });

    test('displays system message when a new peer joins', async ({ page }) => {
        await injectMessage(page, {
            type: 'peer_joined', nick: 'NewUser', peer_id: 'p123',
        });
        await page.waitForTimeout(200);

        const texts = await getSystemMessages(page);
        expect(texts.some(t => t.includes('NewUser') && t.includes('joined'))).toBe(true);
    });

    test('new peer appears in the sidebar online list', async ({ page }) => {
        await injectMessage(page, {
            type: 'peer_joined', nick: 'SidebarUser', peer_id: 'p456',
        });
        await page.waitForTimeout(200);

        const sidebarText = await page.locator('.sidebar').textContent();
        expect(sidebarText).toContain('SidebarUser');
    });
});

// ── peer_left ───────────────────────────────────────────────────────────

test.describe('peer_left event', () => {
    test.beforeEach(async ({ page }) => {
        await setupAndWelcome(page);
        // Add a peer first so they can leave
        await injectMessage(page, {
            type: 'peer_joined', nick: 'LeavingUser', peer_id: 'p-leave',
        });
        await page.waitForTimeout(100);
    });

    test('displays system message when a peer leaves', async ({ page }) => {
        await injectMessage(page, {
            type: 'peer_left', nick: 'LeavingUser', peer_id: 'p-leave',
        });
        await page.waitForTimeout(200);

        const texts = await getSystemMessages(page);
        expect(texts.some(t => t.includes('LeavingUser') && t.includes('left'))).toBe(true);
    });

    test('peer is removed from sidebar online list after leaving', async ({ page }) => {
        await injectMessage(page, {
            type: 'peer_left', nick: 'LeavingUser', peer_id: 'p-leave',
        });
        await page.waitForTimeout(200);

        const peerItems = await page.locator('.peer-item').all();
        const peerTexts = await Promise.all(peerItems.map(el => el.textContent()));
        expect(peerTexts.some(t => t.includes('LeavingUser'))).toBe(false);
    });
});

// ── peers (bulk list) ───────────────────────────────────────────────────

test.describe('peers event', () => {
    test.beforeEach(async ({ page }) => {
        await setupAndWelcome(page);
    });

    test('updates sidebar peer count when peers list is received', async ({ page }) => {
        await injectMessage(page, {
            type: 'peers',
            peers: [
                { peer_id: 'me-001', nick: 'TestUser' },
                { peer_id: 'p1', nick: 'Alice' },
                { peer_id: 'p2', nick: 'Bob' },
                { peer_id: 'p3', nick: 'Charlie' },
            ],
        });
        await page.waitForTimeout(200);

        // The sidebar shows "Online (N)" where N is the peer count
        const sidebarTitle = await page.locator('.sidebar-title', { hasText: /Online/ }).textContent();
        expect(sidebarTitle).toContain('4');
    });

    test('peer names from peers event appear in sidebar', async ({ page }) => {
        await injectMessage(page, {
            type: 'peers',
            peers: [
                { peer_id: 'me-001', nick: 'TestUser' },
                { peer_id: 'p10', nick: 'Diana' },
            ],
        });
        await page.waitForTimeout(200);

        const sidebarText = await page.locator('.sidebar').textContent();
        expect(sidebarText).toContain('Diana');
    });
});

// ── room_invite ─────────────────────────────────────────────────────────

test.describe('room_invite event', () => {
    test.beforeEach(async ({ page }) => {
        await setupAndWelcome(page);
    });

    test('shows invite toast when a room invite is received', async ({ page }) => {
        await injectMessage(page, {
            type: 'room_invite',
            room_id: 'room-inv-1',
            room_name: 'SecretRoom',
            from: 'p-host',
            from_nick: 'HostUser',
        });
        await page.waitForTimeout(200);

        const toast = page.locator('.invite-toast');
        await expect(toast).toBeVisible({ timeout: 3000 });

        const toastText = await toast.textContent();
        expect(toastText).toContain('HostUser');
        expect(toastText).toContain('SecretRoom');
    });

    test('invite toast has Accept and Decline buttons', async ({ page }) => {
        await injectMessage(page, {
            type: 'room_invite',
            room_id: 'room-inv-2',
            room_name: 'AnotherRoom',
            from: 'p-host2',
            from_nick: 'Host2',
        });
        await page.waitForTimeout(200);

        await expect(page.locator('.btn-accept')).toBeVisible({ timeout: 3000 });
        await expect(page.locator('.btn-decline')).toBeVisible({ timeout: 3000 });
    });

    test('declining an invite removes the toast', async ({ page }) => {
        await injectMessage(page, {
            type: 'room_invite',
            room_id: 'room-inv-3',
            room_name: 'DeclineRoom',
            from: 'p-host3',
            from_nick: 'Host3',
        });
        await page.waitForTimeout(200);

        await expect(page.locator('.invite-toast')).toBeVisible({ timeout: 3000 });
        await page.locator('.btn-decline').click();
        await page.waitForTimeout(200);

        await expect(page.locator('.invite-toast')).not.toBeVisible();
    });
});

// ── kicked ──────────────────────────────────────────────────────────────

test.describe('kicked event', () => {
    test.beforeEach(async ({ page }) => {
        await setupAndWelcome(page);
    });

    test('displays kicked message when user is kicked', async ({ page }) => {
        await injectMessage(page, {
            type: 'kicked', message: 'Bad behavior',
        });
        await page.waitForTimeout(200);

        const texts = await getSystemMessages(page);
        expect(texts.some(t => t.includes('Bad behavior'))).toBe(true);
    });

    test('displays default kicked message when no reason given', async ({ page }) => {
        await injectMessage(page, {
            type: 'kicked',
        });
        await page.waitForTimeout(200);

        const texts = await getSystemMessages(page);
        expect(texts.some(t => t.includes('kicked'))).toBe(true);
    });
});

// ── error ───────────────────────────────────────────────────────────────

test.describe('error event', () => {
    test.beforeEach(async ({ page }) => {
        await setupAndWelcome(page);
    });

    test('displays error message as system message', async ({ page }) => {
        await injectMessage(page, {
            type: 'error', message: 'Something went wrong',
        });
        await page.waitForTimeout(200);

        const texts = await getSystemMessages(page);
        expect(texts.some(t => t.includes('Something went wrong'))).toBe(true);
    });

    test('displays generic error without room_id', async ({ page }) => {
        await injectMessage(page, {
            type: 'error', message: 'Rate limit exceeded',
        });
        await page.waitForTimeout(200);

        const texts = await getSystemMessages(page);
        expect(texts.some(t => t.includes('Rate limit exceeded'))).toBe(true);
    });
});

// ── admin_adjust_balance ────────────────────────────────────────────────

test.describe('admin_adjust_balance event', () => {
    test.beforeEach(async ({ page }) => {
        await setupAndWelcome(page);
    });

    test('displays system message when admin adds chips', async ({ page }) => {
        await injectMessage(page, {
            type: 'admin_adjust_balance', delta: 500, reason: 'Bonus reward',
        });
        await page.waitForTimeout(200);

        const texts = await getSystemMessages(page);
        expect(texts.some(t => t.includes('Admin') && t.includes('added') && t.includes('500') && t.includes('Bonus reward'))).toBe(true);
    });

    test('displays system message when admin deducts chips', async ({ page }) => {
        await injectMessage(page, {
            type: 'admin_adjust_balance', delta: -200, reason: 'Penalty',
        });
        await page.waitForTimeout(200);

        const texts = await getSystemMessages(page);
        expect(texts.some(t => t.includes('Admin') && t.includes('deducted') && t.includes('200') && t.includes('Penalty'))).toBe(true);
    });
});

// ── Multiple rapid peer events ──────────────────────────────────────────

test.describe('rapid peer events', () => {
    test.beforeEach(async ({ page }) => {
        await setupAndWelcome(page);
    });

    test('handles 10 rapid peer_joined events and renders all messages', async ({ page }) => {
        // Inject 10 peer_joined events in quick succession
        await page.evaluate(() => {
            const ws = window.__wsMock?.active;
            if (!ws) return;
            for (let i = 0; i < 10; i++) {
                ws._injectMessage(JSON.stringify({
                    type: 'peer_joined',
                    nick: `RapidUser${i}`,
                    peer_id: `rapid-${i}`,
                }));
            }
        });
        await page.waitForTimeout(500);

        const texts = await getSystemMessages(page);
        const joinMessages = texts.filter(t => t.includes('joined') && t.includes('RapidUser'));
        expect(joinMessages.length).toBe(10);
    });

    test('sidebar peer count reflects all rapid joins', async ({ page }) => {
        await page.evaluate(() => {
            const ws = window.__wsMock?.active;
            if (!ws) return;
            for (let i = 0; i < 10; i++) {
                ws._injectMessage(JSON.stringify({
                    type: 'peer_joined',
                    nick: `BatchUser${i}`,
                    peer_id: `batch-${i}`,
                }));
            }
        });
        await page.waitForTimeout(500);

        const sidebarTitle = await page.locator('.sidebar-title', { hasText: /Online/ }).textContent();
        // Should show 10 peers (our own peer is filtered out of the display list
        // but still counted in the peers array)
        expect(sidebarTitle).toContain('10');
    });
});
