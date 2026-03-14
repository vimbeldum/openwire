/**
 * cosmetics-shop.test.jsx
 *
 * Vitest + RTL tests for CosmeticsShop component.
 * Covers: render, balance, close, buy/sold/equip states, category filters.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import CosmeticsShop from '../../components/CosmeticsShop.jsx';
import * as walletLib from '../../lib/wallet.js';
import * as cosmeticsLib from '../../lib/cosmetics.js';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../../lib/cosmetics.js', () => ({
    DEFAULT_CATALOG: [],
    isAvailable: vi.fn(item => item.ownerDeviceHash === null),
}));

vi.mock('../../lib/wallet.js', () => ({
    getTotalBalance: vi.fn(() => 1000),
}));

// ── Catalog fixture ────────────────────────────────────────────────────────────

const MOCK_CATALOG = [
    {
        id: 'neon-green-bubble',
        category: 'bubbleStyle',
        name: 'Neon Green',
        price: 500,
        cssClass: 'bubble-neon-green',
        ownerDeviceHash: null,
        forSale: false,
        resalePrice: null,
        purchasedAt: null,
        availableUntil: null,
    },
    {
        id: 'gold-name',
        category: 'nameColor',
        name: 'Pure Gold',
        price: 600,
        cssClass: 'name-gold',
        ownerDeviceHash: null,
        forSale: false,
        resalePrice: null,
        purchasedAt: null,
        availableUntil: null,
    },
    {
        id: 'flames-entry',
        category: 'entryAnimation',
        name: 'Flames',
        price: 1200,
        cssClass: 'entry-flames',
        ownerDeviceHash: 'someone-else',
        forSale: false,
        resalePrice: null,
        purchasedAt: null,
        availableUntil: null,
    },
];

// ── helpers ────────────────────────────────────────────────────────────────────

function makeProfile(ownedIds = [], equippedMap = {}) {
    return {
        cosmetics: {
            owned: ownedIds,
            equipped: equippedMap,
        },
    };
}

function renderShop(props = {}) {
    const defaults = {
        wallet: { baseBalance: 1000, adminBonus: 0 },
        profile: makeProfile(),
        catalog: MOCK_CATALOG,
        deviceId: 'dev-test',
        onClose: vi.fn(),
        onPurchase: vi.fn(),
        onEquip: vi.fn(),
        onUnequip: vi.fn(),
    };
    return render(<CosmeticsShop {...defaults} {...props} />);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('CosmeticsShop', () => {
    beforeEach(() => {
        vi.stubGlobal('confirm', () => true);
        vi.mocked(walletLib.getTotalBalance).mockReturnValue(1000);
        vi.mocked(cosmeticsLib.isAvailable).mockImplementation(item => item.ownerDeviceHash === null);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('header', () => {
        it('renders the "✨ Cosmetics Shop" title', () => {
            renderShop();
            expect(screen.getByText('✨ Cosmetics Shop')).toBeInTheDocument();
        });

        it('close button calls onClose', () => {
            const onClose = vi.fn();
            renderShop({ onClose });
            fireEvent.click(screen.getByText('✕'));
            expect(onClose).toHaveBeenCalledTimes(1);
        });
    });

    describe('balance bar', () => {
        it('shows the chip balance amount', () => {
            renderShop();
            // getTotalBalance returns 1000 — rendered as "1,000" via toLocaleString
            expect(screen.getByText('1,000')).toBeInTheDocument();
        });

        it('shows "chips available" label', () => {
            renderShop();
            expect(screen.getByText(/chips available/i)).toBeInTheDocument();
        });
    });

    describe('category filter tabs', () => {
        it('renders "All" filter tab', () => {
            renderShop();
            expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
        });

        it('renders at least two category tabs beyond "All"', () => {
            renderShop();
            const categoryNames = ['Bubble Style', 'Name Color', 'Entry Animation', 'Chat Flair'];
            const found = categoryNames.filter(name => screen.queryByRole('button', { name }));
            expect(found.length).toBeGreaterThanOrEqual(2);
        });

        it('filtering by "Bubble Style" shows only bubbleStyle items', () => {
            renderShop();
            fireEvent.click(screen.getByRole('button', { name: 'Bubble Style' }));
            expect(screen.getByText('Neon Green')).toBeInTheDocument();
            expect(screen.queryByText('Pure Gold')).not.toBeInTheDocument();
        });

        it('filtering by "Name Color" shows only nameColor items', () => {
            renderShop();
            fireEvent.click(screen.getByRole('button', { name: 'Name Color' }));
            expect(screen.getByText('Pure Gold')).toBeInTheDocument();
            expect(screen.queryByText('Neon Green')).not.toBeInTheDocument();
        });

        it('"All" tab is active by default', () => {
            renderShop();
            expect(screen.getByRole('button', { name: 'All' })).toHaveClass('active');
        });
    });

    describe('item states', () => {
        it('available items show a "Buy" button', () => {
            renderShop();
            // Neon Green and Pure Gold are available (ownerDeviceHash === null)
            const buyButtons = screen.getAllByRole('button', { name: 'Buy' });
            expect(buyButtons.length).toBeGreaterThanOrEqual(1);
        });

        it('sold/taken items show "Sold" badge', () => {
            renderShop();
            // Flames has ownerDeviceHash !== null → isAvailable returns false → Sold
            expect(screen.getByText('Sold')).toBeInTheDocument();
        });

        it('"Buy" button is disabled when balance < item price', () => {
            vi.mocked(walletLib.getTotalBalance).mockReturnValue(100);
            renderShop({ wallet: { baseBalance: 100, adminBonus: 0 } });
            const buyButtons = screen.getAllByRole('button', { name: 'Buy' });
            buyButtons.forEach(btn => expect(btn).toBeDisabled());
        });

        it('clicking "Buy" on affordable item calls onPurchase with item id', () => {
            const onPurchase = vi.fn();
            renderShop({ onPurchase });
            const buyButtons = screen.getAllByRole('button', { name: 'Buy' });
            fireEvent.click(buyButtons[0]);
            expect(onPurchase).toHaveBeenCalledWith('neon-green-bubble');
        });

        it('does not call onPurchase when confirm returns false', () => {
            vi.stubGlobal('confirm', () => false);
            const onPurchase = vi.fn();
            renderShop({ onPurchase });
            const buyButtons = screen.getAllByRole('button', { name: 'Buy' });
            fireEvent.click(buyButtons[0]);
            expect(onPurchase).not.toHaveBeenCalled();
        });
    });

    describe('owned item states', () => {
        it('owned and equipped item shows "Equipped" button', () => {
            const profile = makeProfile(
                ['neon-green-bubble'],
                { bubbleStyle: 'neon-green-bubble' }
            );
            renderShop({ profile });
            expect(screen.getByRole('button', { name: /Equipped/i })).toBeInTheDocument();
        });

        it('owned but not equipped item shows "Equip" button', () => {
            const profile = makeProfile(['gold-name'], {});
            renderShop({ profile });
            expect(screen.getByRole('button', { name: 'Equip' })).toBeInTheDocument();
        });

        it('"Equip" button calls onEquip with item id', () => {
            const onEquip = vi.fn();
            const profile = makeProfile(['gold-name'], {});
            renderShop({ profile, onEquip });
            fireEvent.click(screen.getByRole('button', { name: 'Equip' }));
            expect(onEquip).toHaveBeenCalledWith('gold-name');
        });

        it('"Equipped" button calls onUnequip when clicked', () => {
            const onUnequip = vi.fn();
            const profile = makeProfile(
                ['neon-green-bubble'],
                { bubbleStyle: 'neon-green-bubble' }
            );
            renderShop({ profile, onUnequip });
            fireEvent.click(screen.getByRole('button', { name: /Equipped/i }));
            expect(onUnequip).toHaveBeenCalledWith('bubbleStyle');
        });
    });
});
