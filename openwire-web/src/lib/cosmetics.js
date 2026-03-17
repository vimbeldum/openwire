/* ═══════════════════════════════════════════════════════════
   OpenWire — Cosmetic Shop System
   Pure ESM module. No React. No side effects.
   All functions are pure / immutable.
   ═══════════════════════════════════════════════════════════ */

import { applyResaleFee } from './jackpot.js';

/* ── Constants ────────────────────────────────────────────── */
export const CATEGORIES = ['bubbleStyle', 'nameColor', 'customEmoji', 'entryAnimation', 'chatFlair'];

export const HOUSE_CUT = 0.10;       // 10% on resale
export const MIN_RESALE_RATIO = 0.50; // must list at >= 50% of original price

export const DEFAULT_CATALOG = [
  { id: 'neon-green-bubble',    category: 'bubbleStyle',    name: 'Neon Green',        price: 500,  cssClass: 'bubble-neon-green',    ownerDeviceHash: null, forSale: false, resalePrice: null, purchasedAt: null, availableUntil: null },
  { id: 'cyberpunk-red-bubble', category: 'bubbleStyle',    name: 'Cyberpunk Red',     price: 700,  cssClass: 'bubble-cyberpunk-red', ownerDeviceHash: null, forSale: false, resalePrice: null, purchasedAt: null, availableUntil: null },
  { id: 'pastel-pink-bubble',   category: 'bubbleStyle',    name: 'Pastel Pink',       price: 400,  cssClass: 'bubble-pastel-pink',   ownerDeviceHash: null, forSale: false, resalePrice: null, purchasedAt: null, availableUntil: null },
  { id: 'gold-name',            category: 'nameColor',      name: 'Pure Gold',         price: 600,  cssClass: 'name-gold',            ownerDeviceHash: null, forSale: false, resalePrice: null, purchasedAt: null, availableUntil: null },
  { id: 'rainbow-name',         category: 'nameColor',      name: 'Rainbow Gradient',  price: 800,  cssClass: 'name-rainbow',         ownerDeviceHash: null, forSale: false, resalePrice: null, purchasedAt: null, availableUntil: null },
  { id: 'flames-entry',         category: 'entryAnimation', name: 'Flames',            price: 1200, cssClass: 'entry-flames',         ownerDeviceHash: null, forSale: false, resalePrice: null, purchasedAt: null, availableUntil: null },
  { id: 'matrix-entry',         category: 'entryAnimation', name: 'Matrix Rain',       price: 1500, cssClass: 'entry-matrix',         ownerDeviceHash: null, forSale: false, resalePrice: null, purchasedAt: null, availableUntil: null },
  { id: 'sparkle-flair',        category: 'chatFlair',      name: 'Sparkle',           price: 1000, cssClass: 'flair-sparkle',        ownerDeviceHash: null, forSale: false, resalePrice: null, purchasedAt: null, availableUntil: null },
  { id: 'glitch-flair',         category: 'chatFlair',      name: 'Glitch Effect',     price: 2000, cssClass: 'flair-glitch',         ownerDeviceHash: null, forSale: false, resalePrice: null, purchasedAt: null, availableUntil: null },
  { id: 'confetti-entry',       category: 'entryAnimation', name: 'Confetti Burst',    price: 1000, cssClass: 'entry-confetti',       ownerDeviceHash: null, forSale: false, resalePrice: null, purchasedAt: null, availableUntil: null },
];

/* ── Internal helpers ─────────────────────────────────────── */

/**
 * Deterministic hash of a device ID string.
 * Returns a hex string.
 */
function hashDeviceId(deviceId) {
  let hash = 5381;
  for (let i = 0; i < deviceId.length; i++) {
    hash = ((hash << 5) + hash) + deviceId.charCodeAt(i);
    hash |= 0; // coerce to 32-bit int
  }
  return hash.toString(16);
}

/**
 * Find an item in a catalog array by id.
 * Returns the item or undefined.
 */
function findItem(catalog, itemId) {
  return catalog.find((item) => item.id === itemId);
}

/**
 * Return a new catalog with a single item replaced by updatedItem.
 */
function replaceCatalogItem(catalog, updatedItem) {
  return catalog.map((item) => (item.id === updatedItem.id ? updatedItem : item));
}

/**
 * Deduct `amount` from wallet — baseBalance first, adminBonus next.
 * Chips are destroyed (sink): no credit elsewhere.
 * Returns new wallet object without side effects.
 */
function deductFromWallet(wallet, amount, reason = 'Cosmetic purchase') {
  let base = wallet.baseBalance;
  let bonus = wallet.adminBonus;

  if (amount <= base) {
    base -= amount;
  } else {
    const fromBase = base;
    base = 0;
    bonus -= (amount - fromBase);
  }

  const newTotal = Math.max(0, base) + Math.max(0, bonus);
  return {
    ...wallet,
    baseBalance: Math.max(0, base),
    adminBonus: Math.max(0, bonus),
    history: [
      ...(wallet.history ?? []).slice(-99),
      { time: Date.now(), reason, amount: -amount, balance: newTotal },
    ],
  };
}

/**
 * Total spendable balance.
 */
function totalBalance(wallet) {
  return (wallet.baseBalance || 0) + (wallet.adminBonus || 0);
}

/* ── Public API ───────────────────────────────────────────── */

/**
 * Returns true if the item is available to purchase from the shop.
 * Available means: not owned (ownerDeviceHash === null) AND
 * either no time limit or the time limit has not passed.
 *
 * @param {object} item
 * @param {number} nowMs - current epoch milliseconds
 * @returns {boolean}
 */
export function isAvailable(item, nowMs) {
  if (item.ownerDeviceHash !== null) return false;
  if (item.availableUntil !== null && nowMs >= item.availableUntil) return false;
  return true;
}

/**
 * Purchase an item from the shop catalog.
 * Pure — returns a new catalog and wallet; does not mutate inputs.
 *
 * @param {object[]} catalog
 * @param {object}   wallet
 * @param {string}   itemId
 * @param {string}   deviceId
 * @param {number}   nowMs
 * @returns {{ success: boolean, catalog?: object[], wallet?: object, item?: object, reason?: string }}
 */
export function purchaseItem(catalog, wallet, itemId, deviceId, nowMs) {
  const item = findItem(catalog, itemId);

  if (!item) {
    return { success: false, reason: 'not_found' };
  }

  if (!isAvailable(item, nowMs)) {
    return { success: false, reason: 'not_available' };
  }

  if (totalBalance(wallet) < item.price) {
    return { success: false, reason: 'insufficient_balance' };
  }

  const updatedItem = {
    ...item,
    ownerDeviceHash: hashDeviceId(deviceId),
    purchasedAt: nowMs,
  };

  const newCatalog = replaceCatalogItem(catalog, updatedItem);
  const newWallet = deductFromWallet(wallet, item.price, `Cosmetic: ${item.name}`);

  return { success: true, catalog: newCatalog, wallet: newWallet, item: updatedItem };
}

/**
 * List a purchased item for resale on the secondary market.
 * Pure — returns updated catalog.
 *
 * @param {object[]} catalog
 * @param {string}   itemId
 * @param {string}   deviceId
 * @param {number}   resalePrice
 * @returns {{ success: boolean, catalog?: object[], reason?: string }}
 */
export function listForSale(catalog, itemId, deviceId, resalePrice) {
  const item = findItem(catalog, itemId);

  if (!item) {
    return { success: false, reason: 'not_found' };
  }

  if (item.ownerDeviceHash !== hashDeviceId(deviceId)) {
    return { success: false, reason: 'not_owner' };
  }

  const minPrice = item.price * MIN_RESALE_RATIO;
  if (resalePrice < minPrice) {
    return { success: false, reason: 'below_min_resale_price' };
  }

  const updatedItem = { ...item, forSale: true, resalePrice };
  return { success: true, catalog: replaceCatalogItem(catalog, updatedItem) };
}

/**
 * Purchase an item from the secondary (resale) market.
 * House cut (10%) goes to the jackpot pool. Seller receives the remaining 90%.
 * Pure — returns updated catalog, buyer wallet, seller proceeds, and jackpot.
 *
 * @param {object[]} catalog
 * @param {object}   buyerWallet
 * @param {string}   itemId
 * @param {string}   buyerDeviceId
 * @param {object}   jackpot
 * @param {number}   nowMs
 * @returns {{ success: boolean, catalog?: object[], wallet?: object, sellerProceeds?: number, jackpot?: object, reason?: string }}
 */
export function buyResale(catalog, buyerWallet, itemId, buyerDeviceId, jackpot, nowMs) {
  const item = findItem(catalog, itemId);

  if (!item) {
    return { success: false, reason: 'not_found' };
  }

  if (!item.forSale) {
    return { success: false, reason: 'not_for_sale' };
  }

  if (totalBalance(buyerWallet) < item.resalePrice) {
    return { success: false, reason: 'insufficient_balance' };
  }

  const newWallet = deductFromWallet(buyerWallet, item.resalePrice, `Resale: ${item.name}`);
  const newJackpot = applyResaleFee(jackpot, item.resalePrice);
  // Seller receives resalePrice minus the 10% house cut
  const houseCut = Math.floor(item.resalePrice * HOUSE_CUT);
  const sellerProceeds = item.resalePrice - houseCut;

  const updatedItem = {
    ...item,
    ownerDeviceHash: hashDeviceId(buyerDeviceId),
    forSale: false,
    resalePrice: null,
    purchasedAt: nowMs,
  };

  return {
    success: true,
    catalog: replaceCatalogItem(catalog, updatedItem),
    wallet: newWallet,
    sellerProceeds,
    sellerDeviceHash: item.ownerDeviceHash,
    jackpot: newJackpot,
  };
}

/**
 * Equip an owned cosmetic item in the corresponding category slot.
 * Pure — returns updated profile.
 *
 * @param {object} profile - must have profile.cosmetics.owned (string[])
 * @param {string} itemId
 * @returns {{ success: boolean, profile?: object, reason?: string }}
 */
export function equipItem(profile, itemId) {
  if (!profile.cosmetics.owned.includes(itemId)) {
    return { success: false, reason: 'not_owned' };
  }

  const catalogItem = findItem(DEFAULT_CATALOG, itemId);
  if (!catalogItem) {
    return { success: false, reason: 'not_in_catalog' };
  }

  const newProfile = {
    ...profile,
    cosmetics: {
      ...profile.cosmetics,
      equipped: {
        ...profile.cosmetics.equipped,
        [catalogItem.category]: itemId,
      },
    },
  };

  return { success: true, profile: newProfile };
}

/**
 * Unequip the cosmetic in a given category slot.
 * Pure — returns updated profile.
 *
 * @param {object} profile
 * @param {string} category
 * @returns {object} Updated profile
 */
export function unequipItem(profile, category) {
  return {
    ...profile,
    cosmetics: {
      ...profile.cosmetics,
      equipped: {
        ...profile.cosmetics.equipped,
        [category]: null,
      },
    },
  };
}

/**
 * Returns a map of category → cssClass for every equipped item.
 * Unequipped categories map to null.
 *
 * @param {object} profile
 * @returns {Record<string, string|null>}
 */
export function getEquippedClasses(profile) {
  const result = {};
  for (const category of CATEGORIES) {
    const equippedId = profile.cosmetics?.equipped?.[category] ?? null;
    if (equippedId) {
      const catalogItem = findItem(DEFAULT_CATALOG, equippedId);
      result[category] = catalogItem ? catalogItem.cssClass : null;
    } else {
      result[category] = null;
    }
  }
  return result;
}

/**
 * Returns the senderCosmetics metadata object to embed in outgoing messages.
 * Only categories relevant to chat (bubbleStyle, nameColor, chatFlair) are
 * included but ALL CATEGORIES are present (null when unequipped) so the
 * receiver can safely read any key.
 *
 * @param {object} profile
 * @returns {Record<string, string|null>}
 */
export function getSenderCosmetics(profile) {
  const classes = getEquippedClasses(profile);
  const result = {};
  for (const category of CATEGORIES) {
    result[category] = classes[category] ?? null;
  }
  return result;
}
