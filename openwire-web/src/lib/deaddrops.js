/**
 * deaddrops.js — Anonymous message board logic for OpenWire Dead Drops.
 *
 * Pure ESM, no React, no DOM access. All functions are immutable
 * (no input mutation). sessionStorage access is silently guarded.
 */

import { stripDangerousTags } from './socket.js';

// ── Constants ────────────────────────────────────────────────────────────────

export const MAX_BODY_LENGTH = 500;
export const RATE_LIMIT_PER_HOUR = 3;
export const DEFAULT_MIN_KARMA_TO_POST = 10;
export const AI_REACTION_THRESHOLD = 5;

// Configurable min karma — persisted in localStorage, synced via admin broadcast
const SETTINGS_KEY = 'openwire:dead_drop_settings';

export function getMinKarmaToPost() {
    try {
        const v = localStorage.getItem(SETTINGS_KEY);
        if (v) { const parsed = JSON.parse(v); return parsed.minKarma ?? DEFAULT_MIN_KARMA_TO_POST; }
    } catch {}
    return DEFAULT_MIN_KARMA_TO_POST;
}

export function setMinKarmaToPost(value) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ minKarma: value })); } catch {}
}

// Backward-compat alias
export const MIN_KARMA_TO_POST = DEFAULT_MIN_KARMA_TO_POST;

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * djb2-style hash of a string. Returns a hex string.
 * Pure and synchronous — no Web Crypto.
 */
function hashDeviceId(deviceId) {
  let hash = 5381;
  for (let i = 0; i < deviceId.length; i++) {
    hash = ((hash << 5) + hash) + deviceId.charCodeAt(i);
    hash |= 0; // convert to 32-bit int
  }
  return hash.toString(16);
}

export { hashDeviceId };

// ── Post creation ────────────────────────────────────────────────────────────

/**
 * Attempt to create a new dead-drop post.
 *
 * @param {string} roomId
 * @param {string} body           - Raw message text
 * @param {string} deviceId       - Caller's device identifier
 * @param {number} karma          - Caller's current karma score
 * @param {Array}  existingPosts  - All posts currently in the room
 * @param {number} nowMs          - Current time in milliseconds (injectable for testing)
 * @returns {{ success: boolean, post?: object, reason?: string }}
 */
export function createPost(roomId, body, deviceId, karma, existingPosts, nowMs) {
  const minKarma = getMinKarmaToPost();
  if (karma < minKarma) {
    return { success: false, reason: `Karma too low (need ${minKarma})` };
  }

  if (!body || body.trim().length === 0) {
    return { success: false, reason: 'Body must not be empty' };
  }

  if (body.length > MAX_BODY_LENGTH) {
    return { success: false, reason: `Body exceeds ${MAX_BODY_LENGTH} characters` };
  }

  const hashedId = hashDeviceId(deviceId);
  const oneHourAgo = nowMs - 60 * 60 * 1000;

  const postsThisHour = (existingPosts || []).filter(
    (p) => p._authorHash === hashedId && p.timestamp >= oneHourAgo
  ).length;

  if (postsThisHour >= RATE_LIMIT_PER_HOUR) {
    return { success: false, reason: 'Rate limit exceeded — max 3 posts per hour' };
  }

  const sanitizedBody = stripDangerousTags(body);

  const id = `dd_${nowMs.toString(36)}_${Math.random().toString(36).slice(2)}`;

  const post = {
    id,
    roomId,
    body: sanitizedBody,
    timestamp: nowMs,
    upvotes: 0,
    downvotes: 0,
    reactions: {},
    votedBy: [],
    aiReactions: [],
    // Internal field used for rate-limiting; not part of the public data model
    // but stored so callers can pass existingPosts back without extra bookkeeping.
    _authorHash: hashedId,
  };

  return { success: true, post };
}

// ── Voting ───────────────────────────────────────────────────────────────────

/**
 * Cast a vote on a post. Returns a new post object; never mutates the input.
 *
 * @param {object} post
 * @param {string} deviceId
 * @param {'up'|'down'} direction
 * @returns {object} updated post
 */
export function vote(post, deviceId, direction) {
  const hashedId = hashDeviceId(deviceId);

  if (post.votedBy.includes(hashedId)) {
    return post; // already voted — no change
  }

  return {
    ...post,
    upvotes:   direction === 'up'   ? post.upvotes + 1   : post.upvotes,
    downvotes: direction === 'down' ? post.downvotes + 1 : post.downvotes,
    votedBy: [...post.votedBy, hashedId],
  };
}

// ── Reactions ────────────────────────────────────────────────────────────────

/**
 * Add an emoji reaction to a post. Returns a new post object.
 *
 * @param {object} post
 * @param {string} emoji
 * @returns {object} updated post
 */
export function addReaction(post, emoji) {
  return {
    ...post,
    reactions: {
      ...post.reactions,
      [emoji]: (post.reactions[emoji] || 0) + 1,
    },
  };
}

/**
 * Append an AI character's reaction. Only applied when the post has reached
 * AI_REACTION_THRESHOLD upvotes. Returns a new post object (unchanged if threshold not met).
 *
 * @param {object} post
 * @param {string} characterId
 * @param {string} reaction
 * @param {string} mood
 * @returns {object} updated post
 */
export function addAiReaction(post, characterId, reaction, mood) {
  if (post.upvotes < AI_REACTION_THRESHOLD) {
    return post;
  }

  return {
    ...post,
    aiReactions: [...post.aiReactions, { characterId, reaction, mood }],
  };
}

// ── Sorting ──────────────────────────────────────────────────────────────────

/**
 * Sort an array of posts by the given mode. Returns a new array; never mutates input.
 *
 * @param {object[]} posts
 * @param {'hot'|'new'|'top'} mode
 * @returns {object[]}
 */
export function sortPosts(posts, mode) {
  const copy = [...posts];

  if (mode === 'new') {
    return copy.sort((a, b) => b.timestamp - a.timestamp);
  }

  if (mode === 'top') {
    return copy.sort((a, b) => b.upvotes - a.upvotes);
  }

  // 'hot' — score decays with age
  const now = Date.now();
  const score = (p) => {
    const ageInHours = (now - p.timestamp) / (1000 * 60 * 60);
    return (p.upvotes - p.downvotes) - ageInHours * 0.5;
  };

  return copy.sort((a, b) => score(b) - score(a));
}

// ── Session storage ──────────────────────────────────────────────────────────

/**
 * Returns the sessionStorage key for a room's dead-drop posts.
 *
 * @param {string} roomId
 * @returns {string}
 */
export function getSessionKey(roomId) {
  return `openwire:deaddrops:${roomId}`;
}

/**
 * Persist posts to sessionStorage. Silently swallows errors (e.g. SSR, private
 * browsing quota exceeded).
 *
 * @param {string}   roomId
 * @param {object[]} posts
 */
export function saveToSession(roomId, posts) {
  try {
    sessionStorage.setItem(getSessionKey(roomId), JSON.stringify(posts));
  } catch (_) {
    // silently fail
  }
}

/**
 * Load posts from sessionStorage. Returns [] when no data is found or on error.
 *
 * @param {string} roomId
 * @returns {object[]}
 */
export function loadFromSession(roomId) {
  try {
    const raw = sessionStorage.getItem(getSessionKey(roomId));
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (_) {
    return [];
  }
}
