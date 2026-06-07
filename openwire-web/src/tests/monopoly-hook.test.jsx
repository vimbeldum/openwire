import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/socket', () => ({
    sendRoomMessage: vi.fn(),
}));

import useMonopolyGame from '../hooks/useMonopolyGame';
import { addPlayer, createMonopoly } from '../lib/monopoly';

function makeDeps() {
    return {
        myIdRef: { current: 'host-1' },
        nickRef: { current: 'Alice' },
        walletRef: { current: null },
        addMsg: vi.fn(),
        updateWallet: vi.fn(),
        amIHost: vi.fn((hostPeerId) => hostPeerId === 'host-1'),
        updateBankLedger: vi.fn(),
        resolvePayoutEvent: vi.fn(),
        addActivityLog: vi.fn(),
    };
}

describe('useMonopolyGame', () => {
    it('uses the latest monopoly game state for local begin actions', () => {
        const { result } = renderHook(() => useMonopolyGame(makeDeps()));

        act(() => {
            result.current.monoHostRef.current = 'host-1';
            const lobby = addPlayer(
                addPlayer(createMonopoly('room-1'), 'host-1', 'Alice'),
                'peer-2',
                'Bob'
            );
            result.current.setMonopolyGame(lobby);
        });

        act(() => {
            result.current.handleMonoAction({ type: 'begin' });
        });

        expect(result.current.monopolyGame.phase).toBe('rolling');
        expect(result.current.monopolyGame.players).toHaveLength(2);
    });
});
