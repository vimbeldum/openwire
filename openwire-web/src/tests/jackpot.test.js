import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RAKE,
  createJackpotState,
  addRake,
  checkTriggers,
  recordPayout,
  getTickerMessage,
  applyResaleFee,
} from '../lib/jackpot.js';

// ── Helpers ─────────────────────────────────────────────────
function freshJackpot(pool = 0) {
  const j = createJackpotState('room-1');
  return { ...j, pool };
}

// ════════════════════════════════════════════════════════════
// createJackpotState
// ════════════════════════════════════════════════════════════
describe('createJackpotState', () => {
  it('sets pool to 0', () => {
    const j = createJackpotState('room-42');
    expect(j.pool).toBe(0);
  });

  it('stores the roomId', () => {
    const j = createJackpotState('room-42');
    expect(j.roomId).toBe('room-42');
  });

  it('initialises lastPayout to null', () => {
    const j = createJackpotState('room-42');
    expect(j.lastPayout).toBeNull();
  });

  it('initialises all contribution buckets to 0', () => {
    const j = createJackpotState('room-42');
    expect(j.contributions).toEqual({ blackjack: 0, roulette: 0, andar_bahar: 0, tambola: 0, slots: 0 });
  });
});

// ════════════════════════════════════════════════════════════
// RAKE constants
// ════════════════════════════════════════════════════════════
describe('RAKE', () => {
  it('blackjack rake is 0.03', () => expect(RAKE.blackjack).toBe(0.03));
  it('roulette rake is 0.01', () => expect(RAKE.roulette).toBe(0.01));
  it('andar_bahar rake is 0.02', () => expect(RAKE.andar_bahar).toBe(0.02));
  it('tambola rake is 0.05', () => expect(RAKE.tambola).toBe(0.05));
});

// ════════════════════════════════════════════════════════════
// addRake
// ════════════════════════════════════════════════════════════
describe('addRake', () => {
  it('blackjack 100 bet → pool += 3', () => {
    const j = freshJackpot();
    const next = addRake(j, 'blackjack', 100);
    expect(next.pool).toBe(3);
    expect(next.contributions.blackjack).toBe(3);
  });

  it('roulette 100 bet → pool += 1', () => {
    const j = freshJackpot();
    const next = addRake(j, 'roulette', 100);
    expect(next.pool).toBe(1);
    expect(next.contributions.roulette).toBe(1);
  });

  it('tambola 200 bet → pool += 10', () => {
    const j = freshJackpot();
    const next = addRake(j, 'tambola', 200);
    expect(next.pool).toBe(10);
    expect(next.contributions.tambola).toBe(10);
  });

  it('andar_bahar 50 bet → pool += 1 (floor)', () => {
    const j = freshJackpot();
    const next = addRake(j, 'andar_bahar', 50);
    expect(next.pool).toBe(1);
    expect(next.contributions.andar_bahar).toBe(1);
  });

  it('accumulates across multiple calls', () => {
    let j = freshJackpot();
    j = addRake(j, 'blackjack', 100); // +3
    j = addRake(j, 'roulette', 100);  // +1
    expect(j.pool).toBe(4);
    expect(j.contributions.blackjack).toBe(3);
    expect(j.contributions.roulette).toBe(1);
  });

  it('does not mutate the original jackpot', () => {
    const j = freshJackpot();
    addRake(j, 'blackjack', 100);
    expect(j.pool).toBe(0);
  });

  it('throws for an invalid game name', () => {
    const j = freshJackpot();
    expect(() => addRake(j, 'poker', 100)).toThrow();
  });
});

// ════════════════════════════════════════════════════════════
// checkTriggers
// ════════════════════════════════════════════════════════════
describe('checkTriggers', () => {
  it('blackjack_3x triggers at pool=1000 → payout=500', () => {
    const j = freshJackpot(1000);
    const result = checkTriggers(j, { type: 'blackjack_3x', playerId: 'p1', data: { consecutiveBlackjacks: 3 } });
    expect(result.triggered).toBe(true);
    expect(result.trigger).toBe('blackjack_3x');
    expect(result.payout).toBe(500);
    expect(result.newJackpot.pool).toBe(500);
  });

  it('blackjack_3x does NOT trigger when consecutiveBlackjacks < 3', () => {
    const j = freshJackpot(1000);
    const result = checkTriggers(j, { type: 'blackjack_3x', playerId: 'p1', data: { consecutiveBlackjacks: 2 } });
    expect(result.triggered).toBe(false);
  });

  it('roulette_repeat at pool=1000 → payout=250', () => {
    const j = freshJackpot(1000);
    const result = checkTriggers(j, { type: 'roulette_repeat', playerId: 'p1', data: { sameNumberTwice: true } });
    expect(result.triggered).toBe(true);
    expect(result.trigger).toBe('roulette_repeat');
    expect(result.payout).toBe(250);
    expect(result.newJackpot.pool).toBe(750);
  });

  it('roulette_repeat does NOT trigger when sameNumberTwice is false', () => {
    const j = freshJackpot(1000);
    const result = checkTriggers(j, { type: 'roulette_repeat', playerId: 'p1', data: { sameNumberTwice: false } });
    expect(result.triggered).toBe(false);
  });

  it('tambola_speedhouse at pool=1000 → payout=750', () => {
    const j = freshJackpot(1000);
    const result = checkTriggers(j, { type: 'tambola_speedhouse', playerId: 'p1', data: { numbersCalledForFullHouse: 25 } });
    expect(result.triggered).toBe(true);
    expect(result.trigger).toBe('tambola_speedhouse');
    expect(result.payout).toBe(750);
    expect(result.newJackpot.pool).toBe(250);
  });

  it('tambola_speedhouse does NOT trigger when numbersCalledForFullHouse > 30', () => {
    const j = freshJackpot(1000);
    const result = checkTriggers(j, { type: 'tambola_speedhouse', playerId: 'p1', data: { numbersCalledForFullHouse: 31 } });
    expect(result.triggered).toBe(false);
  });

  it('does NOT trigger any event when pool < 100', () => {
    const j = freshJackpot(50);
    const result = checkTriggers(j, { type: 'blackjack_3x', playerId: 'p1', data: { consecutiveBlackjacks: 5 } });
    expect(result.triggered).toBe(false);
  });

  it('random trigger fires when crypto random < 1/500', () => {
    const j = freshJackpot(1000);
    // Mock crypto.getRandomValues to return a value that maps to < 1/500
    // _cryptoRandom() = buf[0] / 0x100000000, so buf[0] = floor(0.001 * 0x100000000) = 4294967
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation((buf) => { buf[0] = 4294967; return buf; });
    const result = checkTriggers(j, { type: 'random', playerId: 'p1', data: {} });
    expect(result.triggered).toBe(true);
    expect(result.trigger).toBe('random');
    expect(result.payout).toBe(100); // Math.floor(1000 * 0.10)
    spy.mockRestore();
  });

  it('random trigger does NOT fire when crypto random >= 1/500', () => {
    const j = freshJackpot(1000);
    // buf[0] = floor(0.5 * 0x100000000) = 2147483648 → _cryptoRandom() = 0.5
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation((buf) => { buf[0] = 2147483648; return buf; });
    const result = checkTriggers(j, { type: 'random', playerId: 'p1', data: {} });
    expect(result.triggered).toBe(false);
    spy.mockRestore();
  });

  it('does not mutate original jackpot on trigger', () => {
    const j = freshJackpot(1000);
    checkTriggers(j, { type: 'blackjack_3x', playerId: 'p1', data: { consecutiveBlackjacks: 3 } });
    expect(j.pool).toBe(1000);
  });
});

// ════════════════════════════════════════════════════════════
// recordPayout
// ════════════════════════════════════════════════════════════
describe('recordPayout', () => {
  it('sets lastPayout with correct fields', () => {
    const j = freshJackpot(500);
    const next = recordPayout(j, 'blackjack_3x', 250, 'alice', 1700000000000);
    expect(next.lastPayout).toEqual({
      trigger: 'blackjack_3x',
      payout: 250,
      winner: 'alice',
      timestamp: 1700000000000,
    });
  });

  it('does not mutate the original jackpot', () => {
    const j = freshJackpot(500);
    recordPayout(j, 'blackjack_3x', 250, 'alice', 0);
    expect(j.lastPayout).toBeNull();
  });

  it('preserves existing pool value', () => {
    const j = freshJackpot(500);
    const next = recordPayout(j, 'roulette_repeat', 125, 'bob', 0);
    expect(next.pool).toBe(500);
  });
});

// ════════════════════════════════════════════════════════════
// getTickerMessage
// ════════════════════════════════════════════════════════════
describe('getTickerMessage', () => {
  it('blackjack_3x returns correct string', () => {
    const msg = getTickerMessage('blackjack_3x', 'alice', 500);
    expect(msg).toBe('🎰 [JACKPOT] alice hit the jackpot! +500 chips from Blackjack 3x Streak! 🎰');
  });

  it('roulette_repeat returns correct string', () => {
    const msg = getTickerMessage('roulette_repeat', 'bob', 250);
    expect(msg).toBe('🎰 [JACKPOT] bob hit the jackpot! +250 chips from Roulette Repeat! 🎰');
  });

  it('tambola_speedhouse returns correct string', () => {
    const msg = getTickerMessage('tambola_speedhouse', 'carol', 750);
    expect(msg).toBe('🎰 [JACKPOT] carol hit the jackpot! +750 chips from Tambola Speed House! 🎰');
  });

  it('random returns correct string', () => {
    const msg = getTickerMessage('random', 'dave', 100);
    expect(msg).toBe('🎰 [JACKPOT] dave hit the jackpot! +100 chips from Lucky Strike! 🎰');
  });
});

// ════════════════════════════════════════════════════════════
// applyResaleFee
// ════════════════════════════════════════════════════════════
describe('applyResaleFee', () => {
  it('adds 10% of resalePrice to pool', () => {
    const j = freshJackpot(100);
    const next = applyResaleFee(j, 200);
    expect(next.pool).toBe(120); // 100 + floor(200 * 0.10) = 100 + 20
  });

  it('floors fractional fees', () => {
    const j = freshJackpot(0);
    const next = applyResaleFee(j, 15); // 15 * 0.10 = 1.5 → floor = 1
    expect(next.pool).toBe(1);
  });

  it('does not mutate the original jackpot', () => {
    const j = freshJackpot(100);
    applyResaleFee(j, 200);
    expect(j.pool).toBe(100);
  });
});
