/* ═══════════════════════════════════════════════════════════
   OpenWire — Agent Domain: Persistent Storage Adapter
   Manages dynamic characters, groups, and model filters
   with localStorage persistence. Falls back to defaults
   from characters.js on first load.
   ═══════════════════════════════════════════════════════════ */

import { CHARACTERS as DEFAULT_CHARACTERS, SHOWS as DEFAULT_SHOWS } from './characters.js';

const STORAGE_KEY = 'openwire_agent_store';

/** Load the full store from localStorage, merging with defaults */
function loadRaw() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) return JSON.parse(stored);
    } catch { /* corrupt data — reset */ }
    return null;
}

function saveRaw(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch { /* quota exceeded — silently fail */ }
}

/** Build initial store from hardcoded defaults */
function buildDefaults() {
    const groups = Object.values(DEFAULT_SHOWS).map(s => ({
        id: s.id, name: s.name, emoji: s.emoji,
    }));

    const characters = Object.values(DEFAULT_CHARACTERS).map(c => ({
        id: c.id,
        name: c.name,
        groupId: c.show,
        avatar: c.avatar,
        systemPrompt: c.systemPrompt,
        frequencyWeight: c.frequencyWeight,
        minInterval: c.minInterval,
        maxInterval: c.maxInterval,
        reactive_tags: c.reactive_tags || [],
        agent_triggers: c.agent_triggers || [],
        moods: c.moods || { normal: '' },
    }));

    return {
        groups,
        characters,
        modelFilters: { whitelist: [], blacklist: [] },
        _version: 2,
    };
}

// ── Public API ────────────────────────────────────────────

/** Load the complete agent store (groups, characters, modelFilters) */
export function loadStore() {
    const stored = loadRaw();
    if (stored && stored._version >= 2) return stored;
    const defaults = buildDefaults();
    saveRaw(defaults);
    return defaults;
}

/** Save the complete store */
export function saveStore(store) {
    saveRaw(store);
}

/** Reset store to defaults (wipes localStorage) */
export function resetStore() {
    const defaults = buildDefaults();
    saveRaw(defaults);
    return defaults;
}

// ── Group CRUD ────────────────────────────────────────────

export function addGroup(store, group) {
    if (store.groups.some(g => g.id === group.id)) return store;
    return { ...store, groups: [...store.groups, group] };
}

export function removeGroup(store, groupId) {
    return {
        ...store,
        groups: store.groups.filter(g => g.id !== groupId),
        characters: store.characters.filter(c => c.groupId !== groupId),
    };
}

// ── Character CRUD ────────────────────────────────────────

export function addCharacter(store, char) {
    if (store.characters.some(c => c.id === char.id)) return store;
    return { ...store, characters: [...store.characters, char] };
}

export function updateCharacter(store, charId, updates) {
    return {
        ...store,
        characters: store.characters.map(c =>
            c.id === charId ? { ...c, ...updates } : c
        ),
    };
}

export function removeCharacter(store, charId) {
    return {
        ...store,
        characters: store.characters.filter(c => c.id !== charId),
    };
}

// ── Model Filter CRUD ─────────────────────────────────────

export function addToWhitelist(store, modelId) {
    const wl = [...(store.modelFilters.whitelist || [])];
    if (!wl.includes(modelId)) wl.push(modelId);
    const bl = (store.modelFilters.blacklist || []).filter(id => id !== modelId);
    return { ...store, modelFilters: { whitelist: wl, blacklist: bl } };
}

export function addToBlacklist(store, modelId) {
    const bl = [...(store.modelFilters.blacklist || [])];
    if (!bl.includes(modelId)) bl.push(modelId);
    const wl = (store.modelFilters.whitelist || []).filter(id => id !== modelId);
    return { ...store, modelFilters: { whitelist: wl, blacklist: bl } };
}

export function removeFromWhitelist(store, modelId) {
    return {
        ...store,
        modelFilters: {
            ...store.modelFilters,
            whitelist: (store.modelFilters.whitelist || []).filter(id => id !== modelId),
        },
    };
}

export function removeFromBlacklist(store, modelId) {
    return {
        ...store,
        modelFilters: {
            ...store.modelFilters,
            blacklist: (store.modelFilters.blacklist || []).filter(id => id !== modelId),
        },
    };
}

// ── Helpers for backward compat ───────────────────────────

/** Convert store to the dict-based format swarm/panels expect */
export function getCharactersDict(store) {
    const dict = {};
    store.characters.forEach(c => {
        dict[c.id] = {
            ...c,
            show: c.groupId,  // compat alias
        };
    });
    return dict;
}

export function getGroupsDict(store) {
    const dict = {};
    store.groups.forEach(g => { dict[g.id] = g; });
    return dict;
}

export function getGroupCharacters(store, groupId) {
    return store.characters.filter(c => c.groupId === groupId);
}
