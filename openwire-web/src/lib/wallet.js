/* ═══════════════════════════════════════════════════════════
   OpenWire — Virtual Wallet
   Keyed by device UUID (not nickname) so re-joining with a
   different name doesn't reset the balance.
   - baseBalance:  daily refresh at IST midnight (game winnings)
   - adminBonus:   permanent, admin-granted only
   ═══════════════════════════════════════════════════════════ */

export const DAILY_BASE = 1000;
const DEVICE_KEY = 'openwire_device_id';
const WALLET_PREFIX = 'openwire_wallet_dev_';

/* ── Device fingerprint ───────────────────────────────────── */
export function getDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
        // Generate a persistent UUID for this browser/device
        id = crypto.randomUUID?.()
            ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${performance.now().toString(36)}`;
        localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
}

// Get current date string in IST (UTC+5:30) as YYYY-MM-DD
function getISTDateString() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

function storageKey(deviceId) {
    return `${WALLET_PREFIX}${deviceId}`;
}

/* ── Load / create wallet ─────────────────────────────────── */
export function loadWallet(nick) {
    const deviceId = getDeviceId();
    const today = getISTDateString();
    let wallet;

    try {
        const raw = localStorage.getItem(storageKey(deviceId));
        wallet = raw ? JSON.parse(raw) : null;
    } catch {
        wallet = null;
    }

    if (!wallet) {
        wallet = {
            deviceId,
            nick,
            baseBalance: DAILY_BASE,
            adminBonus: 0,
            lastRefreshDate: today,
            history: [{ time: Date.now(), reason: 'Daily refresh', amount: DAILY_BASE, balance: DAILY_BASE }],
        };
    } else {
        // Update nick on login (display only — not used for keying)
        wallet.nick = nick;
        if (wallet.lastRefreshDate !== today) {
            // New IST day — reset game winnings only, preserve admin bonus
            const prevBonus = wallet.adminBonus || 0;
            wallet = {
                ...wallet,
                nick,
                baseBalance: DAILY_BASE,
                lastRefreshDate: today,
                history: [
                    ...(wallet.history || []).slice(-99),
                    { time: Date.now(), reason: 'Daily refresh', amount: DAILY_BASE, balance: DAILY_BASE + prevBonus },
                ],
            };
        }
    }

    saveWallet(wallet);
    return wallet;
}

// Debounced save — writes at most once per second to avoid blocking main thread
let _walletSaveTimer = null;
let _pendingWallet = null;

export function saveWallet(wallet) {
    _pendingWallet = wallet;
    if (!_walletSaveTimer) {
        _walletSaveTimer = setTimeout(() => {
            _walletSaveTimer = null;
            if (_pendingWallet) {
                const deviceId = _pendingWallet.deviceId || getDeviceId();
                try {
                    localStorage.setItem(storageKey(deviceId), JSON.stringify(_pendingWallet));
                } catch (e) {
                    console.warn('Failed to save wallet', e);
                }
            }
        }, 1000);
    }
}

// Synchronous save for security-critical operations (debit)
export function saveWalletSync(wallet) {
    _pendingWallet = wallet;
    const deviceId = wallet.deviceId || getDeviceId();
    try {
        localStorage.setItem(storageKey(deviceId), JSON.stringify(wallet));
    } catch (e) {
        console.warn('Failed to save wallet (sync)', e);
    }
}

/* ── Balance helpers ──────────────────────────────────────── */
export function getTotalBalance(wallet) {
    return (wallet.baseBalance || 0) + (wallet.adminBonus || 0);
}

export function canAfford(wallet, amount) {
    return getTotalBalance(wallet) >= amount;
}

/* ── Debit: baseBalance first, adminBonus next ────────────── */
export function debit(wallet, amount, reason = 'Bet') {
    if (!canAfford(wallet, amount)) return wallet;
    let base = wallet.baseBalance;
    let bonus = wallet.adminBonus;

    if (amount <= base) {
        base -= amount;
    } else {
        const fromBase = base;
        base = 0;
        bonus -= (amount - fromBase);
    }

    const updated = {
        ...wallet,
        baseBalance: Math.max(0, base),
        adminBonus: Math.max(0, bonus),
        history: [
            ...(wallet.history || []).slice(-99),
            { time: Date.now(), reason, amount: -amount, balance: Math.max(0, base) + Math.max(0, bonus) },
        ],
    };
    saveWalletSync(updated);
    return updated;
}

/* ── Credit ───────────────────────────────────────────────── */
// Game winnings → baseBalance (expires daily)
// Admin grants  → adminBonus (permanent)
export function credit(wallet, amount, reason = 'Winnings', isAdminGrant = false) {
    if (!Number.isFinite(amount) || amount <= 0) return wallet;
    const updated = {
        ...wallet,
        baseBalance: isAdminGrant ? wallet.baseBalance : wallet.baseBalance + amount,
        adminBonus: isAdminGrant ? (wallet.adminBonus || 0) + amount : (wallet.adminBonus || 0),
        history: [
            ...(wallet.history || []).slice(-99),
            {
                time: Date.now(),
                reason: isAdminGrant ? `Admin grant: ${reason}` : reason,
                amount: +amount,
                balance: getTotalBalance(wallet) + amount,
            },
        ],
    };
    saveWalletSync(updated);
    return updated;
}

/* ── Admin adjust ─────────────────────────────────────────── */
export function adminAdjust(wallet, delta, reason = 'Admin adjustment') {
    if (!Number.isFinite(delta)) return wallet;
    const bonus = Math.max(0, (wallet.adminBonus || 0) + delta);
    const updated = {
        ...wallet,
        adminBonus: bonus,
        history: [
            ...(wallet.history || []).slice(-99),
            { time: Date.now(), reason, amount: delta, balance: wallet.baseBalance + bonus },
        ],
    };
    saveWalletSync(updated);
    return updated;
}

/* ── Tip: transfer from one wallet to another ─────────────── */
export function tip(fromWallet, toWallet, amount) {
    if (!Number.isFinite(amount) || amount <= 0) {
        return { success: false, reason: 'invalid_amount' };
    }
    if (!canAfford(fromWallet, amount)) {
        return { success: false, reason: 'insufficient_balance' };
    }

    // Deduct from sender (baseBalance first, then adminBonus)
    let base = fromWallet.baseBalance;
    let bonus = fromWallet.adminBonus;
    if (amount <= base) {
        base -= amount;
    } else {
        const fromBase = base;
        base = 0;
        bonus -= (amount - fromBase);
    }
    const newFromTotal = Math.max(0, base) + Math.max(0, bonus);
    const updatedFrom = {
        ...fromWallet,
        baseBalance: Math.max(0, base),
        adminBonus: Math.max(0, bonus),
        history: [
            ...(fromWallet.history || []).slice(-99),
            { time: Date.now(), type: 'tip', reason: `Tip sent to ${toWallet.nick || toWallet.deviceId}`, amount: -amount, balance: newFromTotal },
        ],
    };

    // Credit receiver (goes to baseBalance, same as game winnings)
    const newToTotal = getTotalBalance(toWallet) + amount;
    const updatedTo = {
        ...toWallet,
        baseBalance: toWallet.baseBalance + amount,
        history: [
            ...(toWallet.history || []).slice(-99),
            { time: Date.now(), type: 'tip', reason: `Tip received from ${fromWallet.nick || fromWallet.deviceId}`, amount: +amount, balance: newToTotal },
        ],
    };

    return { success: true, from: updatedFrom, to: updatedTo };
}

/* Flush pending wallet on page unload to prevent data loss */
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        if (_pendingWallet) {
            const deviceId = _pendingWallet.deviceId || getDeviceId();
            try { localStorage.setItem(storageKey(deviceId), JSON.stringify(_pendingWallet)); } catch {}
        }
    });
}
