import { describe, it, expect } from 'vitest';
import {
  CATEGORIES,
  DEFAULT_CATALOG,
  HOUSE_CUT,
  MIN_RESALE_RATIO,
  isAvailable,
  purchaseItem,
  listForSale,
  buyResale,
  equipItem,
  unequipItem,
  getEquippedClasses,
  getSenderCosmetics,
} from '../lib/cosmetics.js';
import { createJackpotState } from '../lib/jackpot.js';

/* ── Helpers ─────────────────────────────────────────────── */

function freshCatalog() {
  // Deep copy so tests never share state
  return DEFAULT_CATALOG.map((item) => ({ ...item }));
}

function freshWallet(baseBalance = 2000, adminBonus = 0) {
  return { baseBalance, adminBonus };
}

function freshProfile(ownedIds = [], equipped = {}) {
  return {
    cosmetics: {
      owned: [...ownedIds],
      equipped: { ...equipped },
    },
  };
}

function freshJackpot(pool = 0) {
  return { ...createJackpotState('room-test'), pool };
}

const NOW = 1_700_000_000_000; // fixed timestamp for determinism
const DEVICE_A = 'device-aaa';
const DEVICE_B = 'device-bbb';

// ════════════════════════════════════════════════════════════
// isAvailable
// ════════════════════════════════════════════════════════════
describe('isAvailable', () => {
  it('returns true when ownerDeviceHash is null and no time limit', () => {
    const item = { ownerDeviceHash: null, availableUntil: null };
    expect(isAvailable(item, NOW)).toBe(true);
  });

  it('returns false when ownerDeviceHash is set (item already owned)', () => {
    const item = { ownerDeviceHash: 'abc123', availableUntil: null };
    expect(isAvailable(item, NOW)).toBe(false);
  });

  it('returns false when availableUntil has passed', () => {
    const item = { ownerDeviceHash: null, availableUntil: NOW - 1 };
    expect(isAvailable(item, NOW)).toBe(false);
  });

  it('returns true when availableUntil is in the future', () => {
    const item = { ownerDeviceHash: null, availableUntil: NOW + 10_000 };
    expect(isAvailable(item, NOW)).toBe(true);
  });

  it('returns false when availableUntil equals nowMs (boundary)', () => {
    const item = { ownerDeviceHash: null, availableUntil: NOW };
    expect(isAvailable(item, NOW)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
// purchaseItem
// ════════════════════════════════════════════════════════════
describe('purchaseItem', () => {
  it('deducts item price from wallet baseBalance', () => {
    const catalog = freshCatalog();
    const wallet = freshWallet(2000, 0);
    const item = catalog.find((i) => i.id === 'pastel-pink-bubble'); // price 400
    const result = purchaseItem(catalog, wallet, item.id, DEVICE_A, NOW);
    expect(result.success).toBe(true);
    expect(result.wallet.baseBalance).toBe(1600);
    expect(result.wallet.adminBonus).toBe(0);
  });

  it('deducts from adminBonus when baseBalance is insufficient', () => {
    const catalog = freshCatalog();
    const wallet = freshWallet(100, 500); // total 600
    const item = catalog.find((i) => i.id === 'gold-name'); // price 600
    const result = purchaseItem(catalog, wallet, item.id, DEVICE_A, NOW);
    expect(result.success).toBe(true);
    expect(result.wallet.baseBalance).toBe(0);
    expect(result.wallet.adminBonus).toBe(0);
  });

  it('assigns ownerDeviceHash to the purchased item', () => {
    const catalog = freshCatalog();
    const wallet = freshWallet(2000);
    const result = purchaseItem(catalog, wallet, 'neon-green-bubble', DEVICE_A, NOW);
    expect(result.success).toBe(true);
    expect(result.item.ownerDeviceHash).toBeTruthy();
    expect(typeof result.item.ownerDeviceHash).toBe('string');
  });

  it('sets purchasedAt on the item', () => {
    const catalog = freshCatalog();
    const wallet = freshWallet(2000);
    const result = purchaseItem(catalog, wallet, 'neon-green-bubble', DEVICE_A, NOW);
    expect(result.item.purchasedAt).toBe(NOW);
  });

  it('fails with not_found when itemId does not exist', () => {
    const result = purchaseItem(freshCatalog(), freshWallet(), 'does-not-exist', DEVICE_A, NOW);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('not_found');
  });

  it('fails with not_available when item is already owned', () => {
    const catalog = freshCatalog();
    // Pre-own the item
    const idx = catalog.findIndex((i) => i.id === 'neon-green-bubble');
    catalog[idx] = { ...catalog[idx], ownerDeviceHash: 'someone-else' };
    const result = purchaseItem(catalog, freshWallet(2000), 'neon-green-bubble', DEVICE_A, NOW);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('not_available');
  });

  it('fails with insufficient_balance when wallet is too low', () => {
    const catalog = freshCatalog();
    const wallet = freshWallet(10); // much less than cheapest item
    const result = purchaseItem(catalog, wallet, 'pastel-pink-bubble', DEVICE_A, NOW);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('insufficient_balance');
  });

  it('does not mutate the original catalog', () => {
    const catalog = freshCatalog();
    const original = catalog.find((i) => i.id === 'neon-green-bubble');
    purchaseItem(catalog, freshWallet(2000), 'neon-green-bubble', DEVICE_A, NOW);
    expect(original.ownerDeviceHash).toBeNull();
  });

  it('does not mutate the original wallet', () => {
    const catalog = freshCatalog();
    const wallet = freshWallet(2000);
    purchaseItem(catalog, wallet, 'neon-green-bubble', DEVICE_A, NOW);
    expect(wallet.baseBalance).toBe(2000);
  });
});

// ════════════════════════════════════════════════════════════
// listForSale
// ════════════════════════════════════════════════════════════
describe('listForSale', () => {
  /** Returns a catalog where DEVICE_A owns neon-green-bubble (price 500). */
  function catalogWithOwnership() {
    const catalog = freshCatalog();
    const result = purchaseItem(catalog, freshWallet(2000), 'neon-green-bubble', DEVICE_A, NOW);
    return result.catalog;
  }

  it('marks item forSale and sets resalePrice when owner lists it', () => {
    const catalog = catalogWithOwnership();
    const result = listForSale(catalog, 'neon-green-bubble', DEVICE_A, 300); // 300 >= 500*0.5=250
    expect(result.success).toBe(true);
    const item = result.catalog.find((i) => i.id === 'neon-green-bubble');
    expect(item.forSale).toBe(true);
    expect(item.resalePrice).toBe(300);
  });

  it('rejects listing below minimum resale price (50% of original)', () => {
    const catalog = catalogWithOwnership();
    const result = listForSale(catalog, 'neon-green-bubble', DEVICE_A, 200); // 200 < 250
    expect(result.success).toBe(false);
    expect(result.reason).toBe('below_min_resale_price');
  });

  it('rejects listing when caller is not the owner', () => {
    const catalog = catalogWithOwnership();
    const result = listForSale(catalog, 'neon-green-bubble', DEVICE_B, 300);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('not_owner');
  });

  it('fails with not_found for unknown item', () => {
    const result = listForSale(freshCatalog(), 'unknown-id', DEVICE_A, 300);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('not_found');
  });

  it('does not mutate the original catalog', () => {
    const catalog = catalogWithOwnership();
    listForSale(catalog, 'neon-green-bubble', DEVICE_A, 300);
    const item = catalog.find((i) => i.id === 'neon-green-bubble');
    expect(item.forSale).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
// buyResale
// ════════════════════════════════════════════════════════════
describe('buyResale', () => {
  /** Returns a catalog where DEVICE_A owns and has listed neon-green-bubble at 300. */
  function catalogListedForSale() {
    const c1 = purchaseItem(freshCatalog(), freshWallet(2000), 'neon-green-bubble', DEVICE_A, NOW).catalog;
    return listForSale(c1, 'neon-green-bubble', DEVICE_A, 300).catalog;
  }

  it('transfers ownership to the buyer', () => {
    const catalog = catalogListedForSale();
    const result = buyResale(catalog, freshWallet(2000), 'neon-green-bubble', DEVICE_B, freshJackpot(), NOW);
    expect(result.success).toBe(true);
    const item = result.catalog.find((i) => i.id === 'neon-green-bubble');
    // ownerDeviceHash should now be a hash of DEVICE_B, not DEVICE_A
    const hashA = purchaseItem(freshCatalog(), freshWallet(2000), 'neon-green-bubble', DEVICE_A, NOW).item.ownerDeviceHash;
    expect(item.ownerDeviceHash).not.toBe(hashA);
  });

  it('sends 10% of resalePrice to jackpot pool', () => {
    const catalog = catalogListedForSale(); // resalePrice = 300
    const jackpot = freshJackpot(100);
    const result = buyResale(catalog, freshWallet(2000), 'neon-green-bubble', DEVICE_B, jackpot, NOW);
    expect(result.success).toBe(true);
    // Math.floor(300 * 0.10) = 30
    expect(result.jackpot.pool).toBe(130);
  });

  it('deducts resalePrice from buyer wallet', () => {
    const catalog = catalogListedForSale(); // resalePrice = 300
    const result = buyResale(catalog, freshWallet(2000), 'neon-green-bubble', DEVICE_B, freshJackpot(), NOW);
    expect(result.wallet.baseBalance).toBe(1700);
  });

  it('clears forSale flag and resalePrice after purchase', () => {
    const catalog = catalogListedForSale();
    const result = buyResale(catalog, freshWallet(2000), 'neon-green-bubble', DEVICE_B, freshJackpot(), NOW);
    const item = result.catalog.find((i) => i.id === 'neon-green-bubble');
    expect(item.forSale).toBe(false);
    expect(item.resalePrice).toBeNull();
  });

  it('fails with not_for_sale when item is not listed', () => {
    const catalog = freshCatalog();
    const result = buyResale(catalog, freshWallet(2000), 'neon-green-bubble', DEVICE_B, freshJackpot(), NOW);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('not_for_sale');
  });

  it('fails with insufficient_balance when buyer cannot afford resalePrice', () => {
    const catalog = catalogListedForSale(); // resalePrice = 300
    const result = buyResale(catalog, freshWallet(50), 'neon-green-bubble', DEVICE_B, freshJackpot(), NOW);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('insufficient_balance');
  });
});

// ════════════════════════════════════════════════════════════
// equipItem
// ════════════════════════════════════════════════════════════
describe('equipItem', () => {
  it('sets equipped[category] to the itemId', () => {
    const profile = freshProfile(['neon-green-bubble']);
    const result = equipItem(profile, 'neon-green-bubble');
    expect(result.success).toBe(true);
    expect(result.profile.cosmetics.equipped.bubbleStyle).toBe('neon-green-bubble');
  });

  it('fails with not_owned when item is not in profile.cosmetics.owned', () => {
    const profile = freshProfile([]);
    const result = equipItem(profile, 'neon-green-bubble');
    expect(result.success).toBe(false);
    expect(result.reason).toBe('not_owned');
  });

  it('replaces previously equipped item in the same category', () => {
    const profile = freshProfile(
      ['neon-green-bubble', 'cyberpunk-red-bubble'],
      { bubbleStyle: 'neon-green-bubble' },
    );
    const result = equipItem(profile, 'cyberpunk-red-bubble');
    expect(result.success).toBe(true);
    expect(result.profile.cosmetics.equipped.bubbleStyle).toBe('cyberpunk-red-bubble');
  });

  it('does not mutate the original profile', () => {
    const profile = freshProfile(['neon-green-bubble']);
    equipItem(profile, 'neon-green-bubble');
    expect(profile.cosmetics.equipped.bubbleStyle).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════
// unequipItem
// ════════════════════════════════════════════════════════════
describe('unequipItem', () => {
  it('sets equipped[category] to null', () => {
    const profile = freshProfile(['neon-green-bubble'], { bubbleStyle: 'neon-green-bubble' });
    const updated = unequipItem(profile, 'bubbleStyle');
    expect(updated.cosmetics.equipped.bubbleStyle).toBeNull();
  });

  it('does not affect other equipped categories', () => {
    const profile = freshProfile(
      ['neon-green-bubble', 'gold-name'],
      { bubbleStyle: 'neon-green-bubble', nameColor: 'gold-name' },
    );
    const updated = unequipItem(profile, 'bubbleStyle');
    expect(updated.cosmetics.equipped.nameColor).toBe('gold-name');
  });

  it('does not mutate the original profile', () => {
    const profile = freshProfile(['neon-green-bubble'], { bubbleStyle: 'neon-green-bubble' });
    unequipItem(profile, 'bubbleStyle');
    expect(profile.cosmetics.equipped.bubbleStyle).toBe('neon-green-bubble');
  });
});

// ════════════════════════════════════════════════════════════
// getEquippedClasses
// ════════════════════════════════════════════════════════════
describe('getEquippedClasses', () => {
  it('returns correct cssClass for an equipped bubbleStyle', () => {
    const profile = freshProfile(['neon-green-bubble'], { bubbleStyle: 'neon-green-bubble' });
    const classes = getEquippedClasses(profile);
    expect(classes.bubbleStyle).toBe('bubble-neon-green');
  });

  it('returns null for unequipped categories', () => {
    const profile = freshProfile(['neon-green-bubble'], { bubbleStyle: 'neon-green-bubble' });
    const classes = getEquippedClasses(profile);
    expect(classes.nameColor).toBeNull();
    expect(classes.chatFlair).toBeNull();
    expect(classes.entryAnimation).toBeNull();
    expect(classes.customEmoji).toBeNull();
  });

  it('returns all CATEGORIES as keys', () => {
    const profile = freshProfile([]);
    const classes = getEquippedClasses(profile);
    for (const category of CATEGORIES) {
      expect(Object.prototype.hasOwnProperty.call(classes, category)).toBe(true);
    }
  });

  it('returns correct cssClass for equipped chatFlair', () => {
    const profile = freshProfile(['sparkle-flair'], { chatFlair: 'sparkle-flair' });
    const classes = getEquippedClasses(profile);
    expect(classes.chatFlair).toBe('flair-sparkle');
  });
});

// ════════════════════════════════════════════════════════════
// getSenderCosmetics
// ════════════════════════════════════════════════════════════
describe('getSenderCosmetics', () => {
  it('includes all CATEGORIES as keys', () => {
    const profile = freshProfile([]);
    const meta = getSenderCosmetics(profile);
    for (const category of CATEGORIES) {
      expect(Object.prototype.hasOwnProperty.call(meta, category)).toBe(true);
    }
  });

  it('returns cssClass for equipped nameColor', () => {
    const profile = freshProfile(['gold-name'], { nameColor: 'gold-name' });
    const meta = getSenderCosmetics(profile);
    expect(meta.nameColor).toBe('name-gold');
  });

  it('returns null for unequipped slots', () => {
    const profile = freshProfile([]);
    const meta = getSenderCosmetics(profile);
    expect(meta.bubbleStyle).toBeNull();
    expect(meta.chatFlair).toBeNull();
  });

  it('returns cssClass for equipped bubbleStyle', () => {
    const profile = freshProfile(['cyberpunk-red-bubble'], { bubbleStyle: 'cyberpunk-red-bubble' });
    const meta = getSenderCosmetics(profile);
    expect(meta.bubbleStyle).toBe('bubble-cyberpunk-red');
  });

  it('returns cssClass for equipped entryAnimation', () => {
    const profile = freshProfile(['flames-entry'], { entryAnimation: 'flames-entry' });
    const meta = getSenderCosmetics(profile);
    expect(meta.entryAnimation).toBe('entry-flames');
  });
});
