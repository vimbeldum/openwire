/**
 * Chat Commands & Room Management E2E Tests
 *
 * Validates all slash commands (/help, /clear, /balance, /debug, /tip),
 * room management (/room create, /room list, room switching),
 * and whisper functionality.
 * All tests run WITHOUT a real backend using the mock WebSocket.
 */
import { test, expect } from '@playwright/test';
import { mockWebSocket, loginAs, setWallet, injectPeers } from './helpers.js';

/**
 * Inject a welcome message from the mock relay so the app considers itself
 * connected and renders the full ChatRoom UI.
 */
async function injectWelcome(page, peerId = 'test-peer-001') {
    await page.evaluate((pid) => {
        const ws = window.__wsMock?.active;
        if (ws) ws._injectMessage(JSON.stringify({
            type: 'welcome', peer_id: pid, nick: 'TestUser', peers: [], rooms: [],
        }));
    }, peerId);
    await page.waitForTimeout(200);
}

/**
 * Wait for the chat layout to be visible (WebSocket mock fires 'open' after 50ms).
 */
async function waitForChat(page) {
    await page.waitForSelector('.chat-layout', { state: 'visible', timeout: 5000 });
}

/** Helper: get the chat text input element. */
function chatInput(page) {
    return page.locator('.chat-input input[type="text"]');
}

/** Helper: get the Send button inside the chat form. */
function sendButton(page) {
    return page.locator('.chat-input button[type="submit"]');
}

/**
 * Submit a slash command via the chat input.
 */
async function sendCommand(page, command) {
    const input = chatInput(page);
    await input.fill(command);
    await sendButton(page).click();
    await page.waitForTimeout(200);
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

/**
 * Get the last N items sent over the mock WebSocket.
 */
async function getLastSent(page, count = 1) {
    return page.evaluate((n) => {
        const sent = window.__wsMock.lastSent;
        return sent.slice(-n);
    }, count);
}

/**
 * Find the last WebSocket message matching a given type.
 */
async function findLastSentByType(page, type) {
    return page.evaluate((t) => {
        const sent = window.__wsMock.lastSent;
        for (let i = sent.length - 1; i >= 0; i--) {
            try {
                const p = JSON.parse(sent[i]);
                if (p.type === t) return p;
            } catch { /* skip non-JSON */ }
        }
        return null;
    }, type);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. /help COMMAND
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('/help Command', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await waitForChat(page);
        await injectWelcome(page);
        await page.waitForTimeout(200);
    });

    test('displays help text as system messages', async ({ page }) => {
        await sendCommand(page, '/help');

        // Wait for help messages to render
        const helpMsgs = page.locator('.messages-area .msg.system');
        // Help outputs multiple lines — at least 10
        await expect(helpMsgs).not.toHaveCount(0, { timeout: 3000 });

        const texts = await getSystemMessages(page);
        const helpTexts = texts.filter(t => t.includes('COMMANDS') || t.includes('/'));

        // Should contain the COMMANDS header
        expect(helpTexts.some(t => t.includes('COMMANDS'))).toBe(true);
    });

    test('help text includes game commands', async ({ page }) => {
        await sendCommand(page, '/help');

        const texts = await getSystemMessages(page);
        const allText = texts.join('\n');

        expect(allText).toContain('/roulette');
        expect(allText).toContain('/blackjack');
        expect(allText).toContain('/andarbahar');
        expect(allText).toContain('/balance');
        expect(allText).toContain('/tip');
        expect(allText).toContain('/clear');
        expect(allText).toContain('/debug');
    });

    test('help text includes room and game commands', async ({ page }) => {
        await sendCommand(page, '/help');

        const texts = await getSystemMessages(page);
        const allText = texts.join('\n');

        expect(allText).toContain('/room create');
        expect(allText).toContain('/room list');
        expect(allText).toContain('/predictions');
    });

    test('help messages do not send over WebSocket', async ({ page }) => {
        // Count chat messages before
        const countBefore = await page.evaluate(() =>
            window.__wsMock.lastSent.filter(raw => {
                try { return JSON.parse(raw).type === 'message'; } catch { return false; }
            }).length
        );

        await sendCommand(page, '/help');

        // Count after — should be unchanged
        const countAfter = await page.evaluate(() =>
            window.__wsMock.lastSent.filter(raw => {
                try { return JSON.parse(raw).type === 'message'; } catch { return false; }
            }).length
        );
        expect(countAfter).toBe(countBefore);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. /clear COMMAND
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('/clear Command', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await waitForChat(page);
        await injectWelcome(page);
        await page.waitForTimeout(200);
    });

    test('clears chat messages from the messages area', async ({ page }) => {
        // Add some messages first
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            for (let i = 0; i < 5; i++) {
                ws._injectMessage(JSON.stringify({
                    type: 'message', peer_id: 'peer-1', nick: 'Alice',
                    data: `Test message ${i}`,
                }));
            }
        });
        await page.waitForTimeout(200);

        // Verify messages exist
        const peerMsgs = page.locator('.messages-area .msg.peer');
        await expect(peerMsgs).not.toHaveCount(0, { timeout: 3000 });

        // Clear
        await sendCommand(page, '/clear');

        // After clear, the old peer messages should be gone.
        // Only the "Chat history cleared." system message should remain.
        await expect(page.locator('.messages-area .msg.peer')).toHaveCount(0, { timeout: 3000 });

        // The clear confirmation message should be present
        const texts = await getSystemMessages(page);
        expect(texts.some(t => t.includes('Chat history cleared'))).toBe(true);
    });

    test('clear does not affect messages in a different room', async ({ page }) => {
        // Join a room first
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            ws._injectMessage(JSON.stringify({
                type: 'room_created', room_id: 'room-clear-test', name: 'ClearTestRoom',
            }));
        });
        await page.waitForTimeout(200);

        // Add a room message
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            ws._injectMessage(JSON.stringify({
                type: 'room_message', room_id: 'room-clear-test',
                peer_id: 'peer-1', nick: 'Alice', data: 'Room message',
            }));
        });
        await page.waitForTimeout(200);

        // Switch to General Chat
        await page.locator('.room-item', { hasText: 'General Chat' }).click();
        await page.waitForTimeout(200);

        // Add a general message
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            ws._injectMessage(JSON.stringify({
                type: 'message', peer_id: 'peer-2', nick: 'Bob', data: 'General msg',
            }));
        });
        await page.waitForTimeout(200);

        // Clear General Chat
        await sendCommand(page, '/clear');

        // General Chat peer messages should be gone
        await expect(page.locator('.messages-area .msg.peer')).toHaveCount(0, { timeout: 3000 });

        // Switch back to room — room message should still be there
        await page.locator('.room-item', { hasText: 'ClearTestRoom' }).click();
        await page.waitForTimeout(300);

        const roomPeerMsgs = page.locator('.messages-area .msg.peer');
        await expect(roomPeerMsgs).not.toHaveCount(0, { timeout: 3000 });
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. /balance COMMAND
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('/balance Command', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 2500);
        await page.goto('/');
        await waitForChat(page);
        await injectWelcome(page);
        await page.waitForTimeout(200);
    });

    test('displays balance breakdown as a system message', async ({ page }) => {
        await sendCommand(page, '/balance');

        const texts = await getSystemMessages(page);
        const balanceMsg = texts.find(t => t.includes('Balance'));
        expect(balanceMsg).toBeDefined();
        expect(balanceMsg).toContain('2500');
    });

    test('balance shows base and bonus breakdown', async ({ page }) => {
        await sendCommand(page, '/balance');

        const texts = await getSystemMessages(page);
        const balanceMsg = texts.find(t => t.includes('Balance'));
        expect(balanceMsg).toBeDefined();
        // Should show base: 2500, bonus: 0
        expect(balanceMsg).toContain('base: 2500');
        expect(balanceMsg).toContain('bonus: 0');
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. /debug COMMAND
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('/debug Command', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await waitForChat(page);
        await injectWelcome(page);
        await page.waitForTimeout(200);
    });

    test('toggles debug mode ON', async ({ page }) => {
        await sendCommand(page, '/debug');

        const texts = await getSystemMessages(page);
        const debugMsg = texts.find(t => t.includes('Debug mode'));
        expect(debugMsg).toBeDefined();
        expect(debugMsg).toContain('ON');
    });

    test('toggles debug mode OFF on second invocation', async ({ page }) => {
        // Toggle ON
        await sendCommand(page, '/debug');
        // Toggle OFF
        await sendCommand(page, '/debug');

        const texts = await getSystemMessages(page);
        const debugMsgs = texts.filter(t => t.includes('Debug mode'));
        expect(debugMsgs.length).toBeGreaterThanOrEqual(2);
        expect(debugMsgs[debugMsgs.length - 1]).toContain('OFF');
    });

    test('persists debug mode to localStorage', async ({ page }) => {
        await sendCommand(page, '/debug');

        const stored = await page.evaluate(() => localStorage.getItem('openwire_debug'));
        expect(stored).toBe('true');

        // Toggle off
        await sendCommand(page, '/debug');
        const storedOff = await page.evaluate(() => localStorage.getItem('openwire_debug'));
        expect(storedOff).toBe('false');
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. /tip COMMAND
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('/tip Command', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await waitForChat(page);
        await injectWelcome(page);
        // Inject peers so tip target resolution works
        await injectPeers(page, [
            { peer_id: 'peer-alice', nick: 'Alice' },
            { peer_id: 'peer-bob', nick: 'Bob' },
        ]);
        await page.waitForTimeout(200);
        // Join a room so tip messages can be sent via room_message
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            ws._injectMessage(JSON.stringify({
                type: 'room_joined', room_id: 'tip-room', name: 'TipRoom',
            }));
        });
        await page.waitForTimeout(200);
    });

    test('sends tip to a known peer', async ({ page }) => {
        await sendCommand(page, '/tip Alice 100');

        // Verify tip confirmation message
        const texts = await getSystemMessages(page);
        const tipMsg = texts.find(t => t.includes('Tipped') && t.includes('Alice'));
        expect(tipMsg).toBeDefined();
        expect(tipMsg).toContain('100');
    });

    test('tip is sent as room_message via WebSocket', async ({ page }) => {
        await sendCommand(page, '/tip Alice 100');

        // Find the room_message that contains the tip JSON
        const tipWsMsg = await page.evaluate(() => {
            const sent = window.__wsMock.lastSent;
            for (let i = sent.length - 1; i >= 0; i--) {
                try {
                    const p = JSON.parse(sent[i]);
                    if (p.type === 'room_message' && p.data) {
                        const inner = JSON.parse(p.data);
                        if (inner.type === 'tip') return inner;
                    }
                } catch { /* skip */ }
            }
            return null;
        });
        expect(tipWsMsg).not.toBeNull();
        expect(tipWsMsg.to).toBe('peer-alice');
        expect(tipWsMsg.amount).toBe(100);
        expect(tipWsMsg.from_nick).toBe('TestUser');
    });

    test('rejects tip with insufficient balance', async ({ page }) => {
        await sendCommand(page, '/tip Alice 5000');

        const texts = await getSystemMessages(page);
        const errMsg = texts.find(t => t.includes('Insufficient'));
        expect(errMsg).toBeDefined();
    });

    test('rejects tip with invalid amount', async ({ page }) => {
        await sendCommand(page, '/tip Alice abc');

        const texts = await getSystemMessages(page);
        const errMsg = texts.find(t => t.includes('Invalid amount'));
        expect(errMsg).toBeDefined();
    });

    test('rejects tip to unknown peer', async ({ page }) => {
        await sendCommand(page, '/tip UnknownUser 50');

        const texts = await getSystemMessages(page);
        const errMsg = texts.find(t => t.includes('not found'));
        expect(errMsg).toBeDefined();
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. ROOM MANAGEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Room Management', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await waitForChat(page);
        await injectWelcome(page);
        await page.waitForTimeout(200);
    });

    test('/room create sends room_create via WebSocket', async ({ page }) => {
        await sendCommand(page, '/room create TestRoom');

        const createMsg = await findLastSentByType(page, 'room_create');
        expect(createMsg).not.toBeNull();
        expect(createMsg.name).toBe('TestRoom');
    });

    test('room creation confirmation appears in sidebar', async ({ page }) => {
        await sendCommand(page, '/room create TestRoom');

        // Simulate server confirming room creation
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            ws._injectMessage(JSON.stringify({
                type: 'room_created', room_id: 'room-test-123', name: 'TestRoom',
            }));
        });
        await page.waitForTimeout(300);

        // Verify room appears in sidebar
        const roomItem = page.locator('.room-item', { hasText: 'TestRoom' });
        await expect(roomItem).toBeVisible({ timeout: 3000 });

        // The system message about room creation is stored under General Chat
        // (roomId: null) because the ref hasn't updated yet when addMsg runs.
        // Switch back to General Chat to verify it.
        await page.locator('.room-item', { hasText: 'General Chat' }).click();
        await page.waitForTimeout(200);
        const texts = await getSystemMessages(page);
        expect(texts.some(t => t.includes('TestRoom') && t.includes('created'))).toBe(true);
    });

    test('switching between rooms changes displayed messages', async ({ page }) => {
        // Create and join a room via server message
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            ws._injectMessage(JSON.stringify({
                type: 'room_created', room_id: 'room-switch-1', name: 'SwitchRoom',
            }));
        });
        await page.waitForTimeout(300);

        // Send a message in the room
        const input = chatInput(page);
        await input.fill('Room message here');
        await sendButton(page).click();
        await page.waitForTimeout(200);

        // Verify message appears as self message in the room
        const roomSelfMsg = page.locator('.messages-area .msg.self .msg-content');
        await expect(roomSelfMsg.last()).toContainText('Room message here');

        // Switch to General Chat
        await page.locator('.room-item', { hasText: 'General Chat' }).click();
        await page.waitForTimeout(300);

        // The room message should NOT be visible in General Chat (filtered by roomId)
        const generalMsgs = await page.evaluate(() => {
            const msgs = document.querySelectorAll('.messages-area .msg.self .msg-content');
            return Array.from(msgs).map(el => el.textContent.trim());
        });
        expect(generalMsgs).not.toContain('Room message here');

        // Switch back to the room
        await page.locator('.room-item', { hasText: 'SwitchRoom' }).click();
        await page.waitForTimeout(300);

        // The room message should be visible again
        const backInRoom = page.locator('.messages-area .msg.self .msg-content');
        await expect(backInRoom.last()).toContainText('Room message here');
    });

    test('/room list shows rooms as system messages', async ({ page }) => {
        // First create a room so the list is not empty
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            ws._injectMessage(JSON.stringify({
                type: 'room_created', room_id: 'room-list-1', name: 'ListRoom1',
            }));
        });
        await page.waitForTimeout(300);

        // Switch to General Chat so /room list messages appear in general context
        await page.locator('.room-item', { hasText: 'General Chat' }).click();
        await page.waitForTimeout(200);

        await sendCommand(page, '/room list');

        const texts = await getSystemMessages(page);
        // The room list should mention "ListRoom1"
        expect(texts.some(t => t.includes('ListRoom1'))).toBe(true);
    });

    test('/room list with no rooms shows empty message', async ({ page }) => {
        // Ensure we are in General Chat where there are no rooms
        await sendCommand(page, '/room list');

        const texts = await getSystemMessages(page);
        expect(texts.some(t => t.includes('No rooms'))).toBe(true);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. WHISPER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Whisper', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await waitForChat(page);
        // Inject welcome with peers so the sidebar shows whisper buttons
        await page.evaluate(() => {
            const ws = window.__wsMock?.active;
            if (ws) ws._injectMessage(JSON.stringify({
                type: 'welcome',
                peer_id: 'test-peer-001',
                nick: 'TestUser',
                peers: [
                    { peer_id: 'test-peer-001', nick: 'TestUser' },
                    { peer_id: 'peer-alice', nick: 'Alice' },
                ],
                rooms: [],
            }));
        });
        await page.waitForTimeout(200);
        // Join a room so whisper messages can be sent via room_message
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            ws._injectMessage(JSON.stringify({
                type: 'room_joined', room_id: 'whisper-room', name: 'WhisperRoom',
            }));
        });
        await page.waitForTimeout(200);
    });

    test('clicking whisper button activates whisper mode', async ({ page }) => {
        // Click the whisper button for Alice in the sidebar
        const whisperBtn = page.locator('.whisper-btn').first();
        await whisperBtn.click();
        await page.waitForTimeout(200);

        // Verify whisper mode bar appears
        const whisperBar = page.locator('.whisper-mode-bar');
        await expect(whisperBar).toBeVisible({ timeout: 3000 });
        await expect(whisperBar).toContainText('Alice');
    });

    test('whisper message is sent via WebSocket with correct format', async ({ page }) => {
        // Activate whisper mode for Alice
        const whisperBtn = page.locator('.whisper-btn').first();
        await whisperBtn.click();
        await page.waitForTimeout(200);

        // Send a whisper message
        const input = chatInput(page);
        await input.fill('secret message');
        await sendButton(page).click();
        await page.waitForTimeout(200);

        // Find the room_message that contains the whisper JSON
        const whisperWsMsg = await page.evaluate(() => {
            const sent = window.__wsMock.lastSent;
            for (let i = sent.length - 1; i >= 0; i--) {
                try {
                    const p = JSON.parse(sent[i]);
                    if (p.type === 'room_message' && p.data) {
                        const inner = JSON.parse(p.data);
                        if (inner.type === 'whisper') return inner;
                    }
                } catch { /* skip */ }
            }
            return null;
        });
        expect(whisperWsMsg).not.toBeNull();
        expect(whisperWsMsg.to).toBe('peer-alice');
        expect(whisperWsMsg.to_nick).toBe('Alice');
        expect(whisperWsMsg.from_nick).toBe('TestUser');
        expect(whisperWsMsg.content).toBe('secret message');
    });

    test('sent whisper displays with whisper styling', async ({ page }) => {
        // Activate whisper mode for Alice
        const whisperBtn = page.locator('.whisper-btn').first();
        await whisperBtn.click();
        await page.waitForTimeout(200);

        // Send a whisper
        const input = chatInput(page);
        await input.fill('whisper text');
        await sendButton(page).click();
        await page.waitForTimeout(200);

        // Verify the whisper message renders with .whisper class
        const whisperMsg = page.locator('.messages-area .msg.whisper');
        await expect(whisperMsg).toBeVisible({ timeout: 3000 });
        await expect(whisperMsg.locator('.msg-content')).toContainText('whisper text');
    });

    test('incoming whisper from another peer displays with whisper styling', async ({ page }) => {
        // Inject a whisper from Alice
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            ws._injectMessage(JSON.stringify({
                type: 'room_message',
                room_id: 'whisper-room',
                peer_id: 'peer-alice',
                nick: 'Alice',
                data: JSON.stringify({
                    type: 'whisper',
                    to: 'test-peer-001',
                    to_nick: 'TestUser',
                    from_nick: 'Alice',
                    content: 'hello secretly',
                }),
            }));
        });
        await page.waitForTimeout(300);

        // Verify the whisper message appears
        const whisperMsg = page.locator('.messages-area .msg.whisper');
        await expect(whisperMsg).toBeVisible({ timeout: 3000 });
        await expect(whisperMsg.locator('.msg-content')).toContainText('hello secretly');
    });

    test('exiting whisper mode removes the whisper bar', async ({ page }) => {
        // Activate whisper
        const whisperBtn = page.locator('.whisper-btn').first();
        await whisperBtn.click();
        await page.waitForTimeout(200);

        const whisperBar = page.locator('.whisper-mode-bar');
        await expect(whisperBar).toBeVisible({ timeout: 3000 });

        // Click the exit button
        await whisperBar.locator('button').click();
        await page.waitForTimeout(200);

        await expect(whisperBar).not.toBeVisible();
    });
});
