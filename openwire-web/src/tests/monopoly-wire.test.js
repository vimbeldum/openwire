import { describe, it, expect } from 'vitest';
import { isMonopolyMessage, parseMonopolyAction, serializeMonopolyAction } from '../lib/monopoly.js';

describe('monopoly wire protocol', () => {
    it('detects serialized Monopoly actions sent as JSON strings', () => {
        const payload = serializeMonopolyAction({ type: 'mono_start', room_id: 'room-1', host: 'peer-1' });
        expect(isMonopolyMessage(payload)).toBe(true);
    });

    it('parses serialized Monopoly actions', () => {
        const payload = serializeMonopolyAction({ type: 'mono_join', peer_id: 'peer-2', nick: 'Bob' });
        expect(parseMonopolyAction(payload)).toMatchObject({ type: 'mono_join', peer_id: 'peer-2', nick: 'Bob' });
    });

    it('does not classify arbitrary chat JSON as Monopoly actions', () => {
        expect(isMonopolyMessage(JSON.stringify({ type: 'typing', nick: 'Bob' }))).toBe(false);
    });
});
