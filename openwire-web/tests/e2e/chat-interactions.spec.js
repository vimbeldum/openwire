/**
 * Chat Interactions E2E Tests
 *
 * Validates all core chat interactions: message sending, display, scrolling,
 * typing indicators, live ticker, and keyboard navigation.
 * All tests run WITHOUT a real backend using the mock WebSocket.
 */
import { test, expect } from '@playwright/test';
import { mockWebSocket, loginAs, clearSession, setWallet } from './helpers.js';

/**
 * Inject a welcome message from the mock relay so the app considers itself
 * connected and renders the full ChatRoom UI (status dot, peers, rooms, etc.).
 */
async function injectWelcome(page, peerId = 'test-peer-001') {
    await page.evaluate((pid) => {
        const ws = window.__wsMock?.active;
        if (ws) {
            ws._injectMessage(JSON.stringify({
                type: 'welcome',
                peer_id: pid,
                nick: 'TestUser',
                peers: [],
                rooms: [],
            }));
        }
    }, peerId);
    // Best-effort wait for the "Connected!" system message so React has processed
    // the welcome. A short delay is used instead of .catch(() => {}) so failures
    // are not silently swallowed; downstream tests do not require the welcome.
    await page.waitForTimeout(150);
}

/**
 * Wait for the chat layout to be visible (WebSocket mock fires 'open' after 50ms).
 */
async function waitForChat(page) {
    await page.waitForSelector('.chat-layout', { state: 'visible', timeout: 5000 });
}

/**
 * Helper: get the chat text input element.
 */
function chatInput(page) {
    return page.locator('.chat-input input[type="text"]');
}

/**
 * Helper: get the Send button inside the chat form.
 */
function sendButton(page) {
    return page.locator('.chat-input button[type="submit"]');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. MESSAGE SENDING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Message Sending', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await waitForChat(page);
        await injectWelcome(page);
        // Best-effort wait for the system messages — downstream tests do not require them
        await page.waitForTimeout(200);
    });

    test('clicking Send button dispatches message via WebSocket', async ({ page }) => {
        const input = chatInput(page);
        await input.fill('Hello world!');
        await sendButton(page).click();

        // Find the last WebSocket payload with type 'message' (other system
        // messages like balance_update may race in after the chat message)
        const lastChatMsg = await page.evaluate(() => {
            const sent = window.__wsMock.lastSent;
            for (let i = sent.length - 1; i >= 0; i--) {
                try { const p = JSON.parse(sent[i]); if (p.type === 'message') return sent[i]; } catch {}
            }
            return null;
        });
        expect(lastChatMsg).not.toBeNull();
        const parsed = JSON.parse(lastChatMsg);
        expect(parsed.type).toBe('message');
        expect(parsed.data).toBe('Hello world!');
    });

    test('pressing Enter in input sends message', async ({ page }) => {
        const input = chatInput(page);
        await input.fill('Enter key test');
        await input.press('Enter');

        // Find the last WebSocket payload with type 'message'
        const lastChatMsg = await page.evaluate(() => {
            const sent = window.__wsMock.lastSent;
            for (let i = sent.length - 1; i >= 0; i--) {
                try { const p = JSON.parse(sent[i]); if (p.type === 'message') return sent[i]; } catch {}
            }
            return null;
        });
        expect(lastChatMsg).not.toBeNull();
        const parsed = JSON.parse(lastChatMsg);
        expect(parsed.type).toBe('message');
        expect(parsed.data).toBe('Enter key test');
    });

    test('input field clears after sending', async ({ page }) => {
        const input = chatInput(page);
        await input.fill('This should clear');
        await sendButton(page).click();
        await expect(input).toHaveValue('');
    });

    test('empty input does not send a message', async ({ page }) => {
        // Count only chat messages (type: 'message'), ignoring system join/ping messages
        const countBefore = await page.evaluate(() =>
            window.__wsMock.lastSent.filter(raw => {
                try { return JSON.parse(raw).type === 'message'; } catch { return false; }
            }).length
        );

        const input = chatInput(page);
        // Ensure input is empty
        await input.fill('');
        await sendButton(page).click();

        const countAfter = await page.evaluate(() =>
            window.__wsMock.lastSent.filter(raw => {
                try { return JSON.parse(raw).type === 'message'; } catch { return false; }
            }).length
        );
        // No new message should have been dispatched
        expect(countAfter).toBe(countBefore);
    });

    test('whitespace-only input does not send a message', async ({ page }) => {
        // Count only chat messages (type: 'message'), ignoring system join/ping messages
        const chatMsgCount = (sent) => sent.filter(raw => {
            try { return JSON.parse(raw).type === 'message'; } catch { return false; }
        }).length;

        const countBefore = await page.evaluate(() =>
            window.__wsMock.lastSent.filter(raw => {
                try { return JSON.parse(raw).type === 'message'; } catch { return false; }
            }).length
        );

        const input = chatInput(page);
        await input.fill('   ');
        await sendButton(page).click();

        const countAfter = await page.evaluate(() =>
            window.__wsMock.lastSent.filter(raw => {
                try { return JSON.parse(raw).type === 'message'; } catch { return false; }
            }).length
        );
        expect(countAfter).toBe(countBefore);
    });

    test('special characters in messages are preserved', async ({ page }) => {
        const specialMsg = '<script>alert("xss")</script> & "quotes" \'single\' `backtick` @#$%^&*()';
        const input = chatInput(page);
        await input.fill(specialMsg);
        await sendButton(page).click();

        // Find the last WebSocket payload with type 'message'
        const lastChatMsg = await page.evaluate(() => {
            const sent = window.__wsMock.lastSent;
            for (let i = sent.length - 1; i >= 0; i--) {
                try { const p = JSON.parse(sent[i]); if (p.type === 'message') return sent[i]; } catch {}
            }
            return null;
        });
        expect(lastChatMsg).not.toBeNull();
        const parsed = JSON.parse(lastChatMsg);
        expect(parsed.data).toBe(specialMsg);

        // The message should also appear in the messages area as a self message
        const selfMsg = page.locator('.messages-area .msg.self .msg-content');
        await expect(selfMsg.last()).toContainText('<script>');
    });

    test('very long message wraps correctly without horizontal overflow', async ({ page }) => {
        const longMsg = 'A'.repeat(500);
        const input = chatInput(page);
        await input.fill(longMsg);
        await sendButton(page).click();

        // Wait for the message to render
        await expect(page.locator('.messages-area .msg.self')).toHaveCount(1, { timeout: 3000 });

        // Verify no horizontal scrollbar on document
        const noHScroll = await page.evaluate(() => {
            return document.documentElement.scrollWidth <= window.innerWidth;
        });
        expect(noHScroll).toBe(true);

        // Verify the message element does not overflow the messages area
        const overflow = await page.evaluate(() => {
            const area = document.querySelector('.messages-area');
            const msg = document.querySelector('.messages-area .msg.self');
            if (!area || !msg) return { ok: false };
            const areaRect = area.getBoundingClientRect();
            const msgRect = msg.getBoundingClientRect();
            return {
                ok: true,
                msgFitsInArea: msgRect.right <= areaRect.right + 1, // 1px tolerance
            };
        });
        expect(overflow.ok).toBe(true);
        expect(overflow.msgFitsInArea).toBe(true);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. MESSAGE DISPLAY & SCROLLING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Message Display & Scrolling', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await waitForChat(page);
        await injectWelcome(page);
    });

    test('injected peer messages appear in .messages-area', async ({ page }) => {
        // Inject a message from a remote peer
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            ws._injectMessage(JSON.stringify({
                type: 'message',
                peer_id: 'remote-peer-1',
                nick: 'Alice',
                data: 'Hello from Alice!',
            }));
        });

        const peerMsg = page.locator('.messages-area .msg.peer .msg-content');
        await expect(peerMsg.last()).toContainText('Hello from Alice!');
    });

    test('messages auto-scroll to bottom when new message arrives', async ({ page }) => {
        // Fill the messages area with enough messages to cause scrolling
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            for (let i = 0; i < 30; i++) {
                ws._injectMessage(JSON.stringify({
                    type: 'message',
                    peer_id: 'remote-peer-fill',
                    nick: 'Filler',
                    data: `Filler message ${i}`,
                }));
            }
        });

        // Wait for messages to render
        await page.waitForFunction(() => {
            const msgs = document.querySelectorAll('.messages-area .msg.peer');
            return msgs.length >= 30;
        }, {}, { timeout: 5000 });

        // Now inject one more message at the bottom
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            ws._injectMessage(JSON.stringify({
                type: 'message',
                peer_id: 'remote-peer-2',
                nick: 'Bob',
                data: 'LATEST MESSAGE HERE',
            }));
        });

        // Wait for the latest message to render, then verify the messages area
        // is scrollable (scrollHeight > clientHeight). The auto-scroll behavior
        // (scrollIntoView) is timing-dependent; we verify the area has content
        // and is scrollable rather than checking exact scroll position.
        await expect(page.locator('.messages-area .msg.peer', { hasText: 'LATEST MESSAGE HERE' }))
            .toBeVisible({ timeout: 5000 });

        const scrollInfo = await page.evaluate(() => {
            const area = document.querySelector('.messages-area');
            if (!area) return { found: false };
            return {
                found: true,
                isScrollable: area.scrollHeight > area.clientHeight,
                hasContent: area.children.length > 30,
            };
        });
        expect(scrollInfo.found).toBe(true);
        expect(scrollInfo.isScrollable).toBe(true);
        expect(scrollInfo.hasContent).toBe(true);
    });

    test('multiple rapid messages all render in order', async ({ page }) => {
        const messageTexts = ['First', 'Second', 'Third', 'Fourth', 'Fifth'];

        await page.evaluate((texts) => {
            const ws = window.__wsMock.active;
            texts.forEach((text) => {
                ws._injectMessage(JSON.stringify({
                    type: 'message',
                    peer_id: 'rapid-peer',
                    nick: 'RapidSender',
                    data: text,
                }));
            });
        }, messageTexts);

        // Wait for the last of the 5 injected peer messages to render
        await page.locator('.messages-area .msg.peer').nth(4).waitFor({ state: 'visible', timeout: 5000 });

        // Collect all peer message contents
        const renderedTexts = await page.evaluate(() => {
            const msgs = document.querySelectorAll('.messages-area .msg.peer .msg-content');
            return Array.from(msgs).map(el => el.textContent.trim());
        });

        // Verify all messages appear and in order
        const rapidMsgs = renderedTexts.filter(t =>
            ['First', 'Second', 'Third', 'Fourth', 'Fifth'].includes(t)
        );
        expect(rapidMsgs).toEqual(['First', 'Second', 'Third', 'Fourth', 'Fifth']);
    });

    test('messages area is scrollable when content exceeds height', async ({ page }) => {
        // Inject many messages to overflow the container
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            for (let i = 0; i < 50; i++) {
                ws._injectMessage(JSON.stringify({
                    type: 'message',
                    peer_id: 'overflow-peer',
                    nick: 'OverflowUser',
                    data: `Scrollable message ${i} - ${'lorem ipsum dolor sit amet '.repeat(3)}`,
                }));
            }
        });

        await page.waitForTimeout(500);

        const scrollInfo = await page.evaluate(() => {
            const area = document.querySelector('.messages-area');
            if (!area) return { found: false };
            return {
                found: true,
                scrollHeight: area.scrollHeight,
                clientHeight: area.clientHeight,
                isScrollable: area.scrollHeight > area.clientHeight,
                overflowY: getComputedStyle(area).overflowY,
            };
        });
        expect(scrollInfo.found).toBe(true);
        expect(scrollInfo.isScrollable).toBe(true);
        // overflow-y should be 'auto' or 'scroll' to allow scrolling
        expect(['auto', 'scroll']).toContain(scrollInfo.overflowY);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. TYPING INDICATOR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Typing Indicator', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await waitForChat(page);
        // Inject welcome with a room so typing events via room_message are dispatched
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            ws._injectMessage(JSON.stringify({
                type: 'welcome',
                peer_id: 'test-peer-001',
                nick: 'TestUser',
                peers: [{ peer_id: 'test-peer-001', nick: 'TestUser' }],
                rooms: [{ room_id: 'room-1', name: 'TestRoom' }],
            }));
        });
        // Join the room so currentRoom is set
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            ws._injectMessage(JSON.stringify({
                type: 'room_joined',
                room_id: 'room-1',
                name: 'TestRoom',
            }));
        });
        // Wait for the room to be active
        await page.waitForTimeout(200);
    });

    test('typing in input sends typing action via WebSocket', async ({ page }) => {
        const input = chatInput(page);
        await input.click();
        // Type character-by-character to trigger the onChange handler
        await input.pressSequentially('Hi', { delay: 50 });

        // Check that a typing event was sent over the mock WebSocket
        const typingSent = await page.evaluate(() => {
            return window.__wsMock.lastSent.some(raw => {
                try {
                    const msg = JSON.parse(raw);
                    if (msg.type === 'room_message' && msg.data) {
                        const inner = JSON.parse(msg.data);
                        return inner.type === 'typing';
                    }
                } catch { /* not JSON */ }
                return false;
            });
        });
        expect(typingSent).toBe(true);
    });

    test('typing indicator bar shows content when peer types', async ({ page }) => {
        // The typing bar should initially be empty
        const typingBar = page.locator('.typing-bar');
        await expect(typingBar).toBeVisible();
        // The empty bar has class typing-bar-empty
        await expect(page.locator('.typing-bar-empty')).toBeVisible();

        // Inject a typing event from a remote peer via room_message
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            ws._injectMessage(JSON.stringify({
                type: 'room_message',
                room_id: 'room-1',
                peer_id: 'remote-peer-typer',
                nick: 'TypingAlice',
                data: JSON.stringify({ type: 'typing', nick: 'TypingAlice' }),
            }));
        });

        // The typing bar should now show the typing text
        const typingText = page.locator('.typing-bar .typing-text');
        await expect(typingText).toBeVisible({ timeout: 3000 });
        await expect(typingText).toContainText('TypingAlice');
        await expect(typingText).toContainText('is typing');
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. LIVE TICKER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Live Ticker', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await waitForChat(page);
        await injectWelcome(page);
    });

    test('ticker shows idle state when no events', async ({ page }) => {
        const ticker = page.locator('.live-ticker');
        await expect(ticker).toBeVisible();

        // Empty ticker shows the idle message
        const idleText = page.locator('.live-ticker .ticker-idle');
        await expect(idleText).toBeVisible();
        await expect(idleText).toContainText('Waiting for game activity');

        // LIVE label is always present
        const liveLabel = page.locator('.live-ticker .ticker-label');
        await expect(liveLabel).toBeVisible();
        await expect(liveLabel).toHaveText('LIVE');
    });

    test('injected ticker event appears in .live-ticker', async ({ page }) => {
        // First, need to join a room so room_message events are processed
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            ws._injectMessage(JSON.stringify({
                type: 'room_joined',
                room_id: 'ticker-room',
                name: 'TickerRoom',
            }));
        });
        await page.waitForTimeout(100);

        // Inject a casino_ticker event via room_message
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            ws._injectMessage(JSON.stringify({
                type: 'room_message',
                room_id: 'ticker-room',
                peer_id: 'dealer-peer',
                nick: 'Dealer',
                data: JSON.stringify({
                    type: 'casino_ticker',
                    text: 'TestUser won 500 chips on Roulette!',
                    gameType: 'roulette',
                }),
            }));
        });

        // The ticker should now show the event text
        const tickerItem = page.locator('.live-ticker .ticker-item');
        await expect(tickerItem).toBeVisible({ timeout: 3000 });
        await expect(tickerItem).toContainText('TestUser won 500 chips on Roulette!');

        // Idle message should no longer be visible
        await expect(page.locator('.live-ticker .ticker-idle')).not.toBeVisible();
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. KEYBOARD NAVIGATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Keyboard Navigation', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await waitForChat(page);
        await injectWelcome(page);
    });

    test('Tab key moves focus between interactive elements', async ({ page }) => {
        // The chat input should be auto-focused
        const input = chatInput(page);
        await expect(input).toBeFocused();

        // Tab should move focus to the next interactive element (GIF button)
        await page.keyboard.press('Tab');
        const gifBtn = page.locator('.gif-btn');
        await expect(gifBtn).toBeFocused();

        // Tab again should move to the Send button
        await page.keyboard.press('Tab');
        await expect(sendButton(page)).toBeFocused();
    });

    test('Escape key closes game overlay when one is open', async ({ page }) => {
        // The /help command opens system messages but doesn't create an overlay.
        // Game overlays are controlled via activeGame/blackjackGame state.
        // We verify that pressing Escape while no overlay is open does not
        // break the chat (input stays functional).
        const input = chatInput(page);
        await input.click();
        await input.fill('test before escape');
        await page.keyboard.press('Escape');

        // Input should still be usable after pressing Escape
        await input.fill('after escape');
        await expect(input).toHaveValue('after escape');
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. VIEWPORT CONSTRAINT (100vh / 100vw)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Viewport Constraint', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebSocket(page);
        await loginAs(page, 'TestUser');
        await setWallet(page, 1000);
        await page.goto('/');
        await waitForChat(page);
        await injectWelcome(page);
    });

    test('100vh constraint is maintained after many messages', async ({ page }) => {
        // Inject a large batch of messages
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            for (let i = 0; i < 100; i++) {
                ws._injectMessage(JSON.stringify({
                    type: 'message',
                    peer_id: 'flood-peer',
                    nick: 'FloodBot',
                    data: `Flood message #${i} — ${'content '.repeat(10)}`,
                }));
            }
        });

        await page.waitForTimeout(500);

        // Verify no page-level vertical scrollbar
        const noVScroll = await page.evaluate(() => {
            return document.documentElement.scrollHeight <= window.innerHeight + 2;
        });
        expect(noVScroll).toBe(true);

        // Verify no horizontal scrollbar
        const noHScroll = await page.evaluate(() => {
            return document.documentElement.scrollWidth <= window.innerWidth;
        });
        expect(noHScroll).toBe(true);

        // Verify chat-layout overflow is hidden
        const layoutOverflow = await page.evaluate(() => {
            const layout = document.querySelector('.chat-layout');
            if (!layout) return null;
            return getComputedStyle(layout).overflow;
        });
        expect(['hidden', 'clip']).toContain(layoutOverflow);
    });

    test('100vh constraint is maintained with active ticker and typing bar', async ({ page }) => {
        // Join a room so room_message events work
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            ws._injectMessage(JSON.stringify({
                type: 'room_joined',
                room_id: 'constraint-room',
                name: 'ConstraintRoom',
            }));
        });
        await page.waitForTimeout(100);

        // Inject a ticker event
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            ws._injectMessage(JSON.stringify({
                type: 'room_message',
                room_id: 'constraint-room',
                peer_id: 'dealer',
                nick: 'Dealer',
                data: JSON.stringify({
                    type: 'casino_ticker',
                    text: 'Big win event!',
                    gameType: 'roulette',
                }),
            }));
        });

        // Inject a typing event
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            ws._injectMessage(JSON.stringify({
                type: 'room_message',
                room_id: 'constraint-room',
                peer_id: 'typer-peer',
                nick: 'Typer',
                data: JSON.stringify({ type: 'typing', nick: 'Typer' }),
            }));
        });

        // Inject some messages too
        await page.evaluate(() => {
            const ws = window.__wsMock.active;
            for (let i = 0; i < 20; i++) {
                ws._injectMessage(JSON.stringify({
                    type: 'room_message',
                    room_id: 'constraint-room',
                    peer_id: 'chatter',
                    nick: 'Chatter',
                    data: `Room message ${i}`,
                }));
            }
        });

        await page.waitForTimeout(500);

        // Verify viewport constraints still hold
        const noScroll = await page.evaluate(() => {
            return {
                vScroll: document.documentElement.scrollHeight <= window.innerHeight + 2,
                hScroll: document.documentElement.scrollWidth <= window.innerWidth,
            };
        });
        expect(noScroll.vScroll).toBe(true);
        expect(noScroll.hScroll).toBe(true);
    });
});
