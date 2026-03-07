/* ═══════════════════════════════════════════════════════════
   OpenWire — Shared Core: Anonymous Identity Service
   Generates ephemeral per-room aliases so users appear
   as "Gold Wolf #42" instead of their real nick in rooms.
   Aliases persist for the browser session (sessionStorage).
   ═══════════════════════════════════════════════════════════ */

const ADJECTIVES = [
    'Gold', 'Shadow', 'Red', 'Dark', 'Wild', 'Iron',
    'Blue', 'Ghost', 'Jade', 'Neon', 'Silver', 'Crimson',
    'Storm', 'Void', 'Amber', 'Frost',
];
const NOUNS = [
    'Wolf', 'Panda', 'Hawk', 'Fox', 'Bear', 'Shark',
    'Tiger', 'Viper', 'Eagle', 'Cobra', 'Lynx', 'Raven',
    'Drake', 'Phantom', 'Ace', 'King',
];

/**
 * Get (or generate) an ephemeral anonymous alias for the current session in a room.
 * Aliases are scoped per-room and survive page refresh within the session.
 *
 * @param {string} roomId       The room's ID
 * @param {string} [fallback]   Shown if roomId is null (general chat uses real nick)
 * @returns {string}
 */
export function getRoomAlias(roomId, fallback = 'Anonymous') {
    if (!roomId) return fallback;
    const key = `openwire_alias_${roomId}`;
    try {
        let alias = sessionStorage.getItem(key);
        if (!alias) {
            const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
            const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
            const num = String(Math.floor(Math.random() * 99) + 1).padStart(2, '0');
            alias = `${adj} ${noun} #${num}`;
            sessionStorage.setItem(key, alias);
        }
        return alias;
    } catch {
        return fallback;
    }
}

/**
 * Clear the alias for a specific room (e.g. when leaving).
 * @param {string} roomId
 */
export function clearRoomAlias(roomId) {
    if (!roomId) return;
    try { sessionStorage.removeItem(`openwire_alias_${roomId}`); } catch { }
}
