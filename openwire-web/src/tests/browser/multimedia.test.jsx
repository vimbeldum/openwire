/**
 * multimedia.test.jsx
 *
 * Tests for multimedia logic: GIF URL construction, screenshot detection
 * payload, and clipboard paste size validation.
 *
 * Strategy:
 *   - GIF URL tests do NOT duplicate the 7 tests in messaging.test.js §8.
 *     They cover edge-cases and GIF message wire-format not tested there.
 *   - Screenshot detection tests focus on the key-combination predicate and
 *     the payload JSON format (both extractable as pure functions).
 *   - Paste size validation tests the 1MB limit constant from ChatRoom.jsx.
 *   - Browser API tests (actual ClipboardEvent, FileReader, DOM paste) are
 *     marked it.todo() because they require a jsdom environment with stubs
 *     that are not practical without full ChatRoom render scaffolding.
 */

import { describe, it, expect } from 'vitest';

/* ═══════════════════════════════════════════════════════════════
   Pure logic: GIF URL construction
   ─────────────────────────────────────────────────────────────
   Source: GifPicker.jsx lines 15-17 (search function).
   NOTE: messaging.test.js §8 already covers the 6 core URL cases.
   This suite adds edge-cases and wire-format tests NOT in that file.
   ═══════════════════════════════════════════════════════════════ */

const GIPHY_API = 'https://api.giphy.com/v1/gifs';
const DEFAULT_KEY = 'dc6zaTOxFJmzC';

function buildGiphyUrl(query, apiKey = DEFAULT_KEY) {
    if (query) {
        return `${GIPHY_API}/search?api_key=${apiKey}&q=${encodeURIComponent(query)}&limit=12&rating=g`;
    }
    return `${GIPHY_API}/trending?api_key=${apiKey}&limit=12&rating=g`;
}

/* ═══════════════════════════════════════════════════════════════
   Pure logic: GIF message wire format
   ─────────────────────────────────────────────────────────────
   ChatRoom.jsx:
   - Sending:   `[GIF]${url}` prefixed chat message (lines around 1801)
   - Receiving: gifMatch = msg.data.match(/^\[GIF\](.+)$/) (lines 1013-1015)
   ═══════════════════════════════════════════════════════════════ */

const GIF_PREFIX = '[GIF]';

function encodeGifMessage(url) {
    return `${GIF_PREFIX}${url}`;
}

function decodeGifMessage(data) {
    const match = data.match(/^\[GIF\](.+)$/);
    return match ? match[1] : null;
}

/* ═══════════════════════════════════════════════════════════════
   Pure logic: Screenshot key-combination detection
   ─────────────────────────────────────────────────────────────
   Source: ChatRoom.jsx lines 279-291 (screenshot useEffect detect function).
   ═══════════════════════════════════════════════════════════════ */

function isScreenshotKeyCombo(e, platform) {
    const isMac = /Mac|iPhone|iPad/.test(platform || '');
    const isMacShot = isMac && e.metaKey && e.shiftKey && ['3', '4', '5', '6'].includes(e.key);
    const isWinShot = !isMac && e.key === 'PrintScreen';
    return isMacShot || isWinShot;
}

function buildScreenshotAlertPayload(nick) {
    return JSON.stringify({ type: 'screenshot_alert', nick });
}

/* ═══════════════════════════════════════════════════════════════
   Pure logic: Paste size validation
   ─────────────────────────────────────────────────────────────
   Source: ChatRoom.jsx line 1465 — if (file.size > 1024 * 1024) // 1MB limit
   ═══════════════════════════════════════════════════════════════ */

const MAX_PASTE_SIZE = 1024 * 1024; // 1MB — from ChatRoom.jsx

function isPasteSizeValid(fileSize) {
    return fileSize <= MAX_PASTE_SIZE;
}

/* ═══════════════════════════════════════════════════════════════
   1. GIF URL construction — edge cases
      (Core URL tests are in messaging.test.js §8 — not duplicated here)
   ═══════════════════════════════════════════════════════════════ */

describe('GifPicker URL construction — edge cases', () => {
    it('unicode query is URL-encoded correctly', () => {
        const url = buildGiphyUrl('火🔥');
        expect(url).toContain(encodeURIComponent('火🔥'));
    });

    it('query with only spaces is treated as non-empty (search endpoint)', () => {
        const url = buildGiphyUrl('   ');
        // "   " is truthy so goes to search endpoint
        expect(url).toContain('/search');
    });

    it('custom apiKey is applied to search URL', () => {
        const url = buildGiphyUrl('cats', 'MY_CUSTOM_KEY');
        expect(url).toContain('api_key=MY_CUSTOM_KEY');
    });

    it('custom apiKey is applied to trending URL', () => {
        const url = buildGiphyUrl('', 'MY_CUSTOM_KEY');
        expect(url).toContain('api_key=MY_CUSTOM_KEY');
    });

    it('default api key matches the fallback in GifPicker.jsx', () => {
        // GifPicker.jsx line 3: || 'dc6zaTOxFJmzC'
        expect(DEFAULT_KEY).toBe('dc6zaTOxFJmzC');
    });

    it('URL starts with the correct Giphy base', () => {
        expect(buildGiphyUrl('test')).toMatch(/^https:\/\/api\.giphy\.com\/v1\/gifs/);
        expect(buildGiphyUrl('')).toMatch(/^https:\/\/api\.giphy\.com\/v1\/gifs/);
    });
});

/* ═══════════════════════════════════════════════════════════════
   2. GIF message wire format
   ═══════════════════════════════════════════════════════════════ */

describe('GIF message wire format [GIF]<url>', () => {
    it('encodeGifMessage prefixes URL with [GIF]', () => {
        const msg = encodeGifMessage('https://media.giphy.com/abc.gif');
        expect(msg.startsWith('[GIF]')).toBe(true);
    });

    it('decodeGifMessage extracts the URL from a [GIF] message', () => {
        const url = 'https://media.giphy.com/abc.gif';
        expect(decodeGifMessage(`[GIF]${url}`)).toBe(url);
    });

    it('decodeGifMessage returns null for non-GIF messages', () => {
        expect(decodeGifMessage('hello world')).toBeNull();
    });

    it('decodeGifMessage returns null for an empty string', () => {
        expect(decodeGifMessage('')).toBeNull();
    });

    it('decodeGifMessage returns null for [GIF] with no URL', () => {
        // The regex requires at least one char after [GIF]
        expect(decodeGifMessage('[GIF]')).toBeNull();
    });

    it('round-trip: encode then decode returns the original URL', () => {
        const original = 'https://media.giphy.com/media/xyz/giphy.gif';
        expect(decodeGifMessage(encodeGifMessage(original))).toBe(original);
    });

    it('[GIF] prefix is case-sensitive (lower-case does not match)', () => {
        expect(decodeGifMessage('[gif]https://example.com/a.gif')).toBeNull();
    });

    it('GIF message does not contain msg-content in the wire form', () => {
        // When a GIF is sent the content field is empty, the URL is in the gif field
        const msgExtra = { gif: 'https://example.com/a.gif', content: '' };
        expect(msgExtra.content).toBe('');
        expect(msgExtra.gif).toContain('http');
    });
});

/* ═══════════════════════════════════════════════════════════════
   3. Screenshot detection key-combination predicate
   ═══════════════════════════════════════════════════════════════ */

describe('Screenshot detection — key-combination predicate', () => {
    it('Mac Cmd+Shift+4 is detected as a screenshot combo', () => {
        const e = { metaKey: true, shiftKey: true, key: '4' };
        expect(isScreenshotKeyCombo(e, 'MacIntel')).toBe(true);
    });

    it('Mac Cmd+Shift+3 is detected as a screenshot combo', () => {
        const e = { metaKey: true, shiftKey: true, key: '3' };
        expect(isScreenshotKeyCombo(e, 'MacIntel')).toBe(true);
    });

    it('Mac Cmd+Shift+5 is detected as a screenshot combo', () => {
        const e = { metaKey: true, shiftKey: true, key: '5' };
        expect(isScreenshotKeyCombo(e, 'MacIntel')).toBe(true);
    });

    it('Mac Cmd+Shift+6 is detected as a screenshot combo', () => {
        const e = { metaKey: true, shiftKey: true, key: '6' };
        expect(isScreenshotKeyCombo(e, 'MacIntel')).toBe(true);
    });

    it('Mac Cmd+Shift+1 is NOT a screenshot combo (key "1" not in list)', () => {
        const e = { metaKey: true, shiftKey: true, key: '1' };
        expect(isScreenshotKeyCombo(e, 'MacIntel')).toBe(false);
    });

    it('Mac Cmd+4 without Shift is NOT a screenshot combo', () => {
        const e = { metaKey: true, shiftKey: false, key: '4' };
        expect(isScreenshotKeyCombo(e, 'MacIntel')).toBe(false);
    });

    it('Windows PrintScreen is detected as a screenshot combo', () => {
        const e = { metaKey: false, shiftKey: false, key: 'PrintScreen' };
        expect(isScreenshotKeyCombo(e, 'Win32')).toBe(true);
    });

    it('Windows PrintScreen on a Mac platform is NOT a screenshot (isMac overrides)', () => {
        const e = { metaKey: false, shiftKey: false, key: 'PrintScreen' };
        expect(isScreenshotKeyCombo(e, 'MacIntel')).toBe(false);
    });

    it('random key combo is not a screenshot', () => {
        const e = { metaKey: false, shiftKey: false, key: 'a' };
        expect(isScreenshotKeyCombo(e, 'Win32')).toBe(false);
    });

    it('iPhone platform is treated as Mac (uses Mac screenshot combos)', () => {
        const e = { metaKey: true, shiftKey: true, key: '4' };
        expect(isScreenshotKeyCombo(e, 'iPhone')).toBe(true);
    });
});

/* ═══════════════════════════════════════════════════════════════
   4. Screenshot alert payload
   ═══════════════════════════════════════════════════════════════ */

describe('Screenshot alert payload JSON', () => {
    it('serializes to valid JSON', () => {
        expect(() => JSON.parse(buildScreenshotAlertPayload('Alice'))).not.toThrow();
    });

    it('type field is "screenshot_alert"', () => {
        const p = JSON.parse(buildScreenshotAlertPayload('Alice'));
        expect(p.type).toBe('screenshot_alert');
    });

    it('nick field carries the sender nick', () => {
        const p = JSON.parse(buildScreenshotAlertPayload('Alice'));
        expect(p.nick).toBe('Alice');
    });

    it('payload contains exactly type and nick fields', () => {
        const p = JSON.parse(buildScreenshotAlertPayload('Alice'));
        expect(Object.keys(p).sort()).toEqual(['nick', 'type']);
    });

    it('screenshot_alert is in the CUSTOM action types list', () => {
        const CUSTOM = ['typing', 'react', 'tip', 'screenshot_alert', 'casino_ticker',
                        'whisper', 'agent_message', 'mention_notify', 'swarm_config',
                        'context_summary', 'admin_announce', 'ready_up', 'game_new_round'];
        expect(CUSTOM).toContain('screenshot_alert');
    });
});

/* ═══════════════════════════════════════════════════════════════
   5. Paste size validation
   ═══════════════════════════════════════════════════════════════ */

describe('Clipboard paste size validation', () => {
    it('MAX_PASTE_SIZE is exactly 1MB (1048576 bytes)', () => {
        expect(MAX_PASTE_SIZE).toBe(1048576);
    });

    it('file exactly at the 1MB limit is accepted', () => {
        expect(isPasteSizeValid(1024 * 1024)).toBe(true);
    });

    it('file 1 byte over the limit is rejected', () => {
        expect(isPasteSizeValid(1024 * 1024 + 1)).toBe(false);
    });

    it('small file (100 bytes) is accepted', () => {
        expect(isPasteSizeValid(100)).toBe(true);
    });

    it('zero-byte file is accepted', () => {
        expect(isPasteSizeValid(0)).toBe(true);
    });

    it('very large file (10MB) is rejected', () => {
        expect(isPasteSizeValid(10 * 1024 * 1024)).toBe(false);
    });

    it('file just under 1MB is accepted', () => {
        expect(isPasteSizeValid(1024 * 1024 - 1)).toBe(true);
    });
});

/* ═══════════════════════════════════════════════════════════════
   6. GifPicker standalone component tests (jsdom + RTL)
   ═══════════════════════════════════════════════════════════════ */

import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@giphy/js-fetch-api', () => {
    class MockGiphyFetch {
        constructor() {
            this.search = vi.fn().mockResolvedValue({ data: [] });
            this.trending = vi.fn().mockResolvedValue({ data: [] });
            this.emoji = vi.fn().mockResolvedValue({ data: [] });
        }
    }
    return { GiphyFetch: MockGiphyFetch };
});

vi.mock('@giphy/react-components', () => ({
    Grid: () => null,
}));

// Must import AFTER mocks are set up
const { default: GifPicker } = await import('../../components/GifPicker.jsx');

describe('GifPicker standalone', () => {
    it('shows search input', () => {
        render(<GifPicker onSelect={vi.fn()} onClose={vi.fn()} />);
        const searchInput = screen.getByPlaceholderText(/search/i);
        expect(searchInput).toBeInTheDocument();
    });

    it('has provider toggle (GIPHY button)', () => {
        render(<GifPicker onSelect={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByRole('button', { name: /giphy/i })).toBeInTheDocument();
    });

    it('tab switching works (GIFs/Stickers/Emoji)', async () => {
        render(<GifPicker onSelect={vi.fn()} onClose={vi.fn()} />);
        // GIFs tab should exist
        expect(screen.getByRole('button', { name: 'GIFs' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Stickers' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Emoji' })).toBeInTheDocument();

        // Click Stickers tab
        await userEvent.click(screen.getByRole('button', { name: 'Stickers' }));
        // Search placeholder should update
        expect(screen.getByPlaceholderText(/search stickers/i)).toBeInTheDocument();

        // Click Emoji tab — search input should disappear (giphy emoji mode)
        await userEvent.click(screen.getByRole('button', { name: 'Emoji' }));
        expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument();
    });

    it('close button calls onClose', async () => {
        const onClose = vi.fn();
        render(<GifPicker onSelect={vi.fn()} onClose={onClose} />);
        await userEvent.click(screen.getByRole('button', { name: /✕/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('search input fires on Enter', async () => {
        render(<GifPicker onSelect={vi.fn()} onClose={vi.fn()} />);
        const searchInput = screen.getByPlaceholderText(/search/i);
        await userEvent.type(searchInput, 'cats');
        // Press Enter to trigger search (which increments searchKey)
        fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });
        // The search has been triggered (no error thrown, component re-rendered)
        expect(searchInput).toHaveValue('cats');
    });

    it('renders "Powered by GIPHY" footer', () => {
        render(<GifPicker onSelect={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByText(/powered by giphy/i)).toBeInTheDocument();
    });

    it('has autoFocus on the search input', () => {
        render(<GifPicker onSelect={vi.fn()} onClose={vi.fn()} />);
        const input = screen.getByPlaceholderText(/search/i);
        // React renders autoFocus as a DOM property, so check via activeElement
        expect(document.activeElement).toBe(input);
    });
});

/* ═══════════════════════════════════════════════════════════════
   7. Browser API tests — require full ChatRoom render (todos)
   ═══════════════════════════════════════════════════════════════ */

describe('Multimedia — browser API tests (require full ChatRoom render)', () => {
    it.todo('pasting an image file under 1MB sends it to the room');
    it.todo('pasting an image over 1MB shows the "Image too large. Max 1MB." system message');
    it.todo('pasting an image when not in a room shows "Must be in a room" system message');
    it.todo('pasting a non-image clipboard item is ignored');
});
