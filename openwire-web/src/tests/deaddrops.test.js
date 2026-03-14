/**
 * deaddrops.test.js — Vitest suite for the Dead Drops anonymous message board.
 *
 * Uses vi.mock to stub socket.js so that stripDangerousTags is a passthrough,
 * and vi.stubGlobal to provide a minimal sessionStorage shim.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock socket.js ────────────────────────────────────────────────────────────
vi.mock('../lib/socket.js', () => ({
  stripDangerousTags: (text) => text,
}));

// ── Mock sessionStorage ───────────────────────────────────────────────────────
function makeSessionStorageMock() {
  let store = {};
  return {
    getItem:    (key) => (key in store ? store[key] : null),
    setItem:    (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear:      () => { store = {}; },
  };
}

const sessionStorageMock = makeSessionStorageMock();
vi.stubGlobal('sessionStorage', sessionStorageMock);

// ── Import module under test (after mocks are registered) ────────────────────
import {
  createPost,
  vote,
  addReaction,
  addAiReaction,
  sortPosts,
  getSessionKey,
  saveToSession,
  loadFromSession,
  hashDeviceId,
  MAX_BODY_LENGTH,
  RATE_LIMIT_PER_HOUR,
  MIN_KARMA_TO_POST,
  AI_REACTION_THRESHOLD,
} from '../lib/deaddrops.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROOM  = 'room_test';
const DEVICE = 'device-abc-123';
const NOW   = 1_700_000_000_000; // fixed ms timestamp

function makePost(overrides = {}) {
  return {
    id: 'dd_test_1',
    roomId: ROOM,
    body: 'Hello world',
    timestamp: NOW,
    upvotes: 0,
    downvotes: 0,
    reactions: {},
    votedBy: [],
    aiReactions: [],
    _authorHash: hashDeviceId(DEVICE),
    ...overrides,
  };
}

function validCreate(overrides = {}) {
  return createPost(
    overrides.roomId   ?? ROOM,
    overrides.body     ?? 'A valid message',
    overrides.deviceId ?? DEVICE,
    overrides.karma    ?? MIN_KARMA_TO_POST,
    overrides.posts    ?? [],
    overrides.nowMs    ?? NOW,
  );
}

// ── createPost ────────────────────────────────────────────────────────────────

describe('createPost', () => {
  it('is blocked when karma is below MIN_KARMA_TO_POST', () => {
    const result = createPost(ROOM, 'Hello', DEVICE, MIN_KARMA_TO_POST - 1, [], NOW);
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/karma/i);
  });

  it('is blocked when karma is exactly MIN_KARMA_TO_POST - 1', () => {
    const result = createPost(ROOM, 'Hi', DEVICE, 49, [], NOW);
    expect(result.success).toBe(false);
  });

  it('succeeds when karma equals MIN_KARMA_TO_POST exactly', () => {
    const result = createPost(ROOM, 'Hi', DEVICE, MIN_KARMA_TO_POST, [], NOW);
    expect(result.success).toBe(true);
  });

  it('is blocked when body exceeds MAX_BODY_LENGTH characters', () => {
    const longBody = 'x'.repeat(MAX_BODY_LENGTH + 1);
    const result = createPost(ROOM, longBody, DEVICE, 100, [], NOW);
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/exceeds/i);
  });

  it('is blocked when body is exactly MAX_BODY_LENGTH + 1', () => {
    const result = createPost(ROOM, 'a'.repeat(501), DEVICE, 100, [], NOW);
    expect(result.success).toBe(false);
  });

  it('succeeds when body is exactly MAX_BODY_LENGTH characters', () => {
    const result = createPost(ROOM, 'a'.repeat(MAX_BODY_LENGTH), DEVICE, 100, [], NOW);
    expect(result.success).toBe(true);
  });

  it('is blocked when body is empty string', () => {
    const result = createPost(ROOM, '', DEVICE, 100, [], NOW);
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/empty/i);
  });

  it('is blocked when body is whitespace only', () => {
    const result = createPost(ROOM, '   ', DEVICE, 100, [], NOW);
    expect(result.success).toBe(false);
  });

  it('is blocked when rate limit is exceeded (3 posts in last hour)', () => {
    const authorHash = hashDeviceId(DEVICE);
    const recentPosts = Array.from({ length: RATE_LIMIT_PER_HOUR }, (_, i) => makePost({
      _authorHash: authorHash,
      timestamp: NOW - i * 1000, // all within the last hour
    }));
    const result = createPost(ROOM, 'Another post', DEVICE, 100, recentPosts, NOW);
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/rate limit/i);
  });

  it('allows posting when only 2 posts exist in the last hour', () => {
    const authorHash = hashDeviceId(DEVICE);
    const recentPosts = Array.from({ length: RATE_LIMIT_PER_HOUR - 1 }, (_, i) => makePost({
      _authorHash: authorHash,
      timestamp: NOW - i * 1000,
    }));
    const result = createPost(ROOM, 'Third post', DEVICE, 100, recentPosts, NOW);
    expect(result.success).toBe(true);
  });

  it('does not count posts older than 1 hour against the rate limit', () => {
    const authorHash = hashDeviceId(DEVICE);
    const oldPosts = Array.from({ length: 10 }, (_, i) => makePost({
      _authorHash: authorHash,
      timestamp: NOW - (2 * 60 * 60 * 1000) - i * 1000, // 2+ hours ago
    }));
    const result = createPost(ROOM, 'New post', DEVICE, 100, oldPosts, NOW);
    expect(result.success).toBe(true);
  });

  it('succeeds with valid inputs and returns a post', () => {
    const result = validCreate();
    expect(result.success).toBe(true);
    expect(result.post).toBeDefined();
  });

  it('sets upvotes to 0 on a new post', () => {
    const { post } = validCreate();
    expect(post.upvotes).toBe(0);
  });

  it('sets downvotes to 0 on a new post', () => {
    const { post } = validCreate();
    expect(post.downvotes).toBe(0);
  });

  it('sets votedBy to empty array on a new post', () => {
    const { post } = validCreate();
    expect(post.votedBy).toEqual([]);
  });

  it('sets reactions to empty object on a new post', () => {
    const { post } = validCreate();
    expect(post.reactions).toEqual({});
  });

  it('sets aiReactions to empty array on a new post', () => {
    const { post } = validCreate();
    expect(post.aiReactions).toEqual([]);
  });

  it('sets the correct roomId on the post', () => {
    const { post } = validCreate({ roomId: 'room_xyz' });
    expect(post.roomId).toBe('room_xyz');
  });

  it('sets timestamp to the provided nowMs', () => {
    const { post } = validCreate({ nowMs: NOW });
    expect(post.timestamp).toBe(NOW);
  });

  it('generates an id starting with "dd_"', () => {
    const { post } = validCreate();
    expect(post.id).toMatch(/^dd_/);
  });

  it('does not mutate the existingPosts array', () => {
    const existing = [];
    Object.freeze(existing);
    expect(() => validCreate({ posts: existing })).not.toThrow();
  });
});

// ── vote ──────────────────────────────────────────────────────────────────────

describe('vote', () => {
  it('increments upvotes on an upvote', () => {
    const post = makePost();
    const updated = vote(post, DEVICE, 'up');
    expect(updated.upvotes).toBe(1);
    expect(updated.downvotes).toBe(0);
  });

  it('increments downvotes on a downvote', () => {
    const post = makePost();
    const updated = vote(post, DEVICE, 'down');
    expect(updated.downvotes).toBe(1);
    expect(updated.upvotes).toBe(0);
  });

  it('adds hashed deviceId to votedBy', () => {
    const post = makePost();
    const updated = vote(post, DEVICE, 'up');
    expect(updated.votedBy).toContain(hashDeviceId(DEVICE));
  });

  it('does not allow the same deviceId to vote twice', () => {
    const post = makePost();
    const once = vote(post, DEVICE, 'up');
    const twice = vote(once, DEVICE, 'up');
    expect(twice.upvotes).toBe(1); // still 1, not 2
  });

  it('returns the original post object when the device has already voted', () => {
    const post = makePost({ votedBy: [hashDeviceId(DEVICE)] });
    const result = vote(post, DEVICE, 'up');
    expect(result).toBe(post); // strict reference equality
  });

  it('does not mutate the input post', () => {
    const post = makePost();
    const upvotesBefore = post.upvotes;
    vote(post, DEVICE, 'up');
    expect(post.upvotes).toBe(upvotesBefore);
  });

  it('allows different devices to vote independently', () => {
    const post = makePost();
    const after1 = vote(post, 'device-1', 'up');
    const after2 = vote(after1, 'device-2', 'up');
    expect(after2.upvotes).toBe(2);
    expect(after2.votedBy).toHaveLength(2);
  });
});

// ── addReaction ───────────────────────────────────────────────────────────────

describe('addReaction', () => {
  it('adds a new emoji reaction with count 1', () => {
    const post = makePost();
    const updated = addReaction(post, '🔥');
    expect(updated.reactions['🔥']).toBe(1);
  });

  it('increments an existing emoji reaction', () => {
    const post = makePost({ reactions: { '🔥': 2 } });
    const updated = addReaction(post, '🔥');
    expect(updated.reactions['🔥']).toBe(3);
  });

  it('does not affect other reactions', () => {
    const post = makePost({ reactions: { '💀': 1 } });
    const updated = addReaction(post, '🔥');
    expect(updated.reactions['💀']).toBe(1);
  });

  it('does not mutate the input post', () => {
    const post = makePost({ reactions: {} });
    addReaction(post, '🔥');
    expect(post.reactions['🔥']).toBeUndefined();
  });
});

// ── addAiReaction ─────────────────────────────────────────────────────────────

describe('addAiReaction', () => {
  it('returns unchanged post when upvotes < AI_REACTION_THRESHOLD', () => {
    const post = makePost({ upvotes: AI_REACTION_THRESHOLD - 1 });
    const result = addAiReaction(post, 'char1', 'Interesting...', 'curious');
    expect(result).toBe(post);
    expect(result.aiReactions).toHaveLength(0);
  });

  it('appends AI reaction when upvotes >= AI_REACTION_THRESHOLD', () => {
    const post = makePost({ upvotes: AI_REACTION_THRESHOLD });
    const updated = addAiReaction(post, 'char1', 'Interesting...', 'curious');
    expect(updated.aiReactions).toHaveLength(1);
    expect(updated.aiReactions[0]).toEqual({
      characterId: 'char1',
      reaction: 'Interesting...',
      mood: 'curious',
    });
  });

  it('appends multiple AI reactions', () => {
    const post = makePost({ upvotes: AI_REACTION_THRESHOLD });
    const first  = addAiReaction(post, 'char1', 'Wow', 'excited');
    const second = addAiReaction(first, 'char2', 'Hmm', 'thoughtful');
    expect(second.aiReactions).toHaveLength(2);
  });

  it('does not mutate the input post', () => {
    const post = makePost({ upvotes: AI_REACTION_THRESHOLD });
    addAiReaction(post, 'char1', 'Hey', 'neutral');
    expect(post.aiReactions).toHaveLength(0);
  });
});

// ── sortPosts ─────────────────────────────────────────────────────────────────

describe('sortPosts', () => {
  const older  = makePost({ id: 'old', timestamp: NOW - 10_000, upvotes: 1 });
  const newer  = makePost({ id: 'new', timestamp: NOW,          upvotes: 0 });
  const top    = makePost({ id: 'top', timestamp: NOW - 5_000,  upvotes: 10 });

  it('"new" mode returns newest post first', () => {
    const sorted = sortPosts([older, newer, top], 'new');
    expect(sorted[0].id).toBe('new');
  });

  it('"new" mode returns oldest post last', () => {
    const sorted = sortPosts([older, newer, top], 'new');
    expect(sorted[sorted.length - 1].id).toBe('old');
  });

  it('"top" mode returns most-upvoted post first', () => {
    const sorted = sortPosts([older, newer, top], 'top');
    expect(sorted[0].id).toBe('top');
  });

  it('"top" mode returns least-upvoted post last', () => {
    const sorted = sortPosts([older, newer, top], 'top');
    expect(sorted[sorted.length - 1].id).toBe('new');
  });

  it('"hot" mode applies time decay (older high-vote post can be outranked)', () => {
    // A very old post with many upvotes vs a recent post with fewer upvotes
    const veryOld   = makePost({ id: 'veryOld', timestamp: NOW - 200 * 60 * 60 * 1000, upvotes: 20 });
    const recentish = makePost({ id: 'recent',  timestamp: NOW - 1 * 60 * 60 * 1000,   upvotes: 5 });
    const sorted = sortPosts([veryOld, recentish], 'hot');
    // veryOld score ≈ 20 - (200 * 0.5) = 20 - 100 = -80
    // recentish score ≈ 5 - (1 * 0.5) = 4.5
    expect(sorted[0].id).toBe('recent');
  });

  it('does not mutate the input array', () => {
    const posts = [older, newer, top];
    const copy  = [...posts];
    sortPosts(posts, 'new');
    expect(posts).toEqual(copy);
  });

  it('returns a new array reference', () => {
    const posts = [older, newer];
    const sorted = sortPosts(posts, 'top');
    expect(sorted).not.toBe(posts);
  });
});

// ── getSessionKey ─────────────────────────────────────────────────────────────

describe('getSessionKey', () => {
  it('returns the expected key format', () => {
    expect(getSessionKey('room_abc')).toBe('openwire:deaddrops:room_abc');
  });
});

// ── saveToSession / loadFromSession ───────────────────────────────────────────

describe('saveToSession / loadFromSession', () => {
  beforeEach(() => {
    sessionStorageMock.clear();
  });

  it('loadFromSession returns [] when no data exists', () => {
    expect(loadFromSession('room_empty')).toEqual([]);
  });

  it('saveToSession then loadFromSession round-trips posts correctly', () => {
    const posts = [makePost({ id: 'dd_1' }), makePost({ id: 'dd_2' })];
    saveToSession(ROOM, posts);
    const loaded = loadFromSession(ROOM);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].id).toBe('dd_1');
    expect(loaded[1].id).toBe('dd_2');
  });

  it('overwrites previous session data on a second save', () => {
    saveToSession(ROOM, [makePost({ id: 'dd_1' })]);
    saveToSession(ROOM, [makePost({ id: 'dd_2' })]);
    const loaded = loadFromSession(ROOM);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('dd_2');
  });

  it('loadFromSession returns [] when sessionStorage throws', () => {
    const brokenStorage = {
      getItem:  () => { throw new Error('unavailable'); },
      setItem:  () => { throw new Error('unavailable'); },
      clear:    () => {},
    };
    vi.stubGlobal('sessionStorage', brokenStorage);
    expect(loadFromSession('room_x')).toEqual([]);
    // restore
    vi.stubGlobal('sessionStorage', sessionStorageMock);
  });

  it('saveToSession does not throw when sessionStorage throws', () => {
    const brokenStorage = {
      getItem:  () => { throw new Error('quota'); },
      setItem:  () => { throw new Error('quota'); },
      clear:    () => {},
    };
    vi.stubGlobal('sessionStorage', brokenStorage);
    expect(() => saveToSession(ROOM, [])).not.toThrow();
    vi.stubGlobal('sessionStorage', sessionStorageMock);
  });
});
