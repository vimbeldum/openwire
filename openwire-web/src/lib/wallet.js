/* ═══════════════════════════════════════════════════════════
   OpenWire — Virtual Wallet
   Daily base chips (IST midnight reset) + admin bonus chips
   ═══════════════════════════════════════════════════════════ */

export const DAILY_BASE = 1000;

// Get current date string in IST (UTC+5:30) as YYYY-MM-DD
function getISTDateString() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

function storageKey(nick) {
    return `openwire_wallet_${nick}`;
}

// Load wallet from localStorage, resetting base if new IST day
export function loadWallet(nick) {
    const today = getISTDateString();
    let wallet;

    try {
        const raw = localStorage.getItem(storageKey(nick));
        wallet = raw ? JSON.parse(raw) : null;
    } catch {
        wallet = null;
    }

    if (!wallet) {
        // Brand new user
        wallet = {
            nick,
            baseBalance: DAILY_BASE,
            adminBonus: 0,
            lastRefreshDate: today,
            history: [{ time: Date.now(), reason: 'Daily refresh', amount: DAILY_BASE, balance: DAILY_BASE }],
        };
    } else if (wallet.lastRefreshDate !== today) {
        // New IST day — reset base only, preserve admin bonus
        const prevBonus = wallet.adminBonus || 0;
        wallet = {
            ...wallet,
            baseBalance: DAILY_BASE,
            lastRefreshDate: today,
            history: [
                ...(wallet.history || []).slice(-99),
                { time: Date.now(), reason: 'Daily refresh', amount: DAILY_BASE, balance: DAILY_BASE + prevBonus },
            ],
        };
    }

    saveWallet(nick, wallet);
    return wallet;
}

export function saveWallet(nick, wallet) {
    try {
        localStorage.setItem(storageKey(nick), JSON.stringify(wallet));
    } catch (e) {
        console.warn('Failed to save wallet', e);
    }
}

// Total spendable balance
export function getTotalBalance(wallet) {
    return (wallet.baseBalance || 0) + (wallet.adminBonus || 0);
}

export function canAfford(wallet, amount) {
    return getTotalBalance(wallet) >= amount;
}

// Debit: takes from baseBalance first, then adminBonus
export function debit(wallet, amount, reason = 'Bet') {
    if (!canAfford(wallet, amount)) return wallet; // safety guard
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
    saveWallet(wallet.nick, updated);
    return updated;
}

// Credit game winnings → into baseBalance; admin grants → into adminBonus
export function credit(wallet, amount, reason = 'Winnings', isAdminGrant = false) {
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
    saveWallet(wallet.nick, updated);
    return updated;
}

// Adjust by admin — can be positive or negative; goes into adminBonus
export function adminAdjust(wallet, delta, reason = 'Admin adjustment') {
    const bonus = Math.max(0, (wallet.adminBonus || 0) + delta);
    const updated = {
        ...wallet,
        adminBonus: bonus,
        history: [
            ...(wallet.history || []).slice(-99),
            { time: Date.now(), reason, amount: delta, balance: wallet.baseBalance + bonus },
        ],
    };
    saveWallet(wallet.nick, updated);
    return updated;
}
