import { describe, it, expect } from 'vitest';
import { tip, getTotalBalance } from '../../lib/wallet.js';
import { sanitizeNick } from '../../lib/utils/sanitizeNick.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWallet(nick, baseBalance, adminBonus = 0) {
    return { deviceId: `dev-${nick}`, nick, baseBalance, adminBonus, history: [] };
}

// ── tip() tests ───────────────────────────────────────────────────────────────

describe('tip()', () => {
    it('succeeds with a valid amount, decreases sender and increases receiver', () => {
        const from = makeWallet('Alice', 500, 0);
        const to = makeWallet('Bob', 100, 0);
        const result = tip(from, to, 200);

        expect(result.success).toBe(true);
        expect(getTotalBalance(result.from)).toBe(300);
        expect(getTotalBalance(result.to)).toBe(300);
    });

    it('returns insufficient_balance when amount exceeds total balance', () => {
        const from = makeWallet('Alice', 100, 50);   // total = 150
        const to = makeWallet('Bob', 0, 0);
        const result = tip(from, to, 200);

        expect(result.success).toBe(false);
        expect(result.reason).toBe('insufficient_balance');
    });

    it('returns invalid_amount when amount is 0', () => {
        const from = makeWallet('Alice', 500, 0);
        const to = makeWallet('Bob', 0, 0);
        const result = tip(from, to, 0);

        expect(result.success).toBe(false);
        expect(result.reason).toBe('invalid_amount');
    });

    it('returns invalid_amount when amount is negative', () => {
        const from = makeWallet('Alice', 500, 0);
        const to = makeWallet('Bob', 0, 0);
        const result = tip(from, to, -50);

        expect(result.success).toBe(false);
        expect(result.reason).toBe('invalid_amount');
    });

    it('returns invalid_amount when amount is Infinity', () => {
        const from = makeWallet('Alice', 500, 0);
        const to = makeWallet('Bob', 0, 0);
        const result = tip(from, to, Infinity);

        expect(result.success).toBe(false);
        expect(result.reason).toBe('invalid_amount');
    });

    it('drains baseBalance before adminBonus', () => {
        const from = makeWallet('Alice', 100, 200);  // total = 300
        const to = makeWallet('Bob', 0, 0);
        const result = tip(from, to, 150);

        expect(result.success).toBe(true);
        // 100 base consumed first, then 50 from adminBonus
        expect(result.from.baseBalance).toBe(0);
        expect(result.from.adminBonus).toBe(150);
    });

    it('records a tip transaction in both wallet histories', () => {
        const from = makeWallet('Alice', 500, 0);
        const to = makeWallet('Bob', 100, 0);
        const result = tip(from, to, 50);

        expect(result.success).toBe(true);

        const fromEntry = result.from.history[result.from.history.length - 1];
        expect(fromEntry.type).toBe('tip');
        expect(fromEntry.amount).toBe(-50);

        const toEntry = result.to.history[result.to.history.length - 1];
        expect(toEntry.type).toBe('tip');
        expect(toEntry.amount).toBe(50);
    });

    it('is pure: original wallet objects are not mutated', () => {
        const from = makeWallet('Alice', 500, 0);
        const to = makeWallet('Bob', 100, 0);

        const fromBefore = { ...from };
        const toBefore = { ...to };

        tip(from, to, 100);

        expect(from.baseBalance).toBe(fromBefore.baseBalance);
        expect(to.baseBalance).toBe(toBefore.baseBalance);
        expect(from.history.length).toBe(0);
        expect(to.history.length).toBe(0);
    });
});

// ── sanitizeNick() tests ──────────────────────────────────────────────────────

describe('sanitizeNick()', () => {
    it('strips control characters in range \\x00–\\x1f', () => {
        expect(sanitizeNick('hel\x00lo\x1f')).toBe('hello');
    });

    it('strips the DEL character \\x7f', () => {
        expect(sanitizeNick('hel\x7flo')).toBe('hello');
    });

    it('enforces a 24-character limit', () => {
        const long = 'a'.repeat(30);
        expect(sanitizeNick(long).length).toBe(24);
    });

    it('returns the default fallback "Anonymous" for an empty string', () => {
        expect(sanitizeNick('')).toBe('Anonymous');
    });

    it('returns the custom fallback "Admin" when provided and input is empty', () => {
        expect(sanitizeNick('', 'Admin')).toBe('Admin');
    });

    it('leaves a normal nick unchanged', () => {
        expect(sanitizeNick('ShwetanshuDev')).toBe('ShwetanshuDev');
    });

    it('trims leading and trailing whitespace', () => {
        expect(sanitizeNick('  Alice  ')).toBe('Alice');
    });
});
