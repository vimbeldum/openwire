/* ═══════════════════════════════════════════════════════════
   OpenWire — Presentation Domain: Cosmetics Shop
   Modal overlay for browsing and purchasing cosmetic items.
   Fits strictly within 100dvh × 100vw. Items grid scrolls internally.
   ═══════════════════════════════════════════════════════════ */

import { useState } from 'react';
import { getTotalBalance } from '../lib/wallet.js';
import { isAvailable } from '../lib/cosmetics.js';

const CATEGORY_LABELS = {
    bubbleStyle:    'Bubble Style',
    nameColor:      'Name Color',
    entryAnimation: 'Entry Animation',
    chatFlair:      'Chat Flair',
    customEmoji:    'Custom Emoji',
};

const FILTERS = [
    { key: 'all',            label: 'All' },
    { key: 'bubbleStyle',    label: 'Bubble Style' },
    { key: 'nameColor',      label: 'Name Color' },
    { key: 'entryAnimation', label: 'Entry Animation' },
    { key: 'chatFlair',      label: 'Chat Flair' },
];

function ItemCard({ item, owned, equipped, balance, onBuy, onEquip, onUnequip }) {
    const available = isAvailable(item, Date.now());
    const canAfford = balance >= item.price;

    let action;
    if (owned) {
        if (equipped) {
            action = (
                <button className="cs-btn cs-btn-equipped" onClick={() => onUnequip(item.category)}>
                    ✓ Equipped
                </button>
            );
        } else {
            action = (
                <button className="cs-btn cs-btn-equip" onClick={() => onEquip(item.id)}>
                    Equip
                </button>
            );
        }
    } else if (available) {
        action = (
            <button
                className={`cs-btn cs-btn-buy${canAfford ? '' : ' cs-btn-disabled'}`}
                disabled={!canAfford}
                onClick={() => onBuy(item)}
            >
                Buy
            </button>
        );
    } else {
        action = <span className="cs-badge-sold">Sold</span>;
    }

    return (
        <div className={`cs-item-card${owned ? ' cs-item-owned' : ''}`}>
            <div className="cs-item-top">
                <span className="cs-item-name">{item.name}</span>
                <span className="cs-category-badge">{CATEGORY_LABELS[item.category] ?? item.category}</span>
            </div>
            <span className="cs-item-css">{item.cssClass}</span>
            <div className="cs-item-bottom">
                <span className="cs-item-price">{item.price.toLocaleString()} chips</span>
                {action}
            </div>
        </div>
    );
}

export default function CosmeticsShop({ wallet, profile, catalog, deviceId, onClose, onPurchase, onEquip, onUnequip }) {
    const [filter, setFilter] = useState('all');

    const balance = getTotalBalance(wallet);
    const owned = new Set(profile?.cosmetics?.owned ?? []);
    const equipped = profile?.cosmetics?.equipped ?? {};

    const visible = filter === 'all'
        ? catalog
        : catalog.filter(item => item.category === filter);

    const handleBuy = (item) => {
        if (!window.confirm(`Buy ${item.name} for ${item.price.toLocaleString()} chips?`)) return;
        onPurchase(item.id);
    };

    return (
        <div className="ah-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="ah-panel cs-panel">
                {/* Header */}
                <div className="ah-header">
                    <span className="ah-title">✨ Cosmetics Shop</span>
                    <button className="btn-icon-close" onClick={onClose}>✕</button>
                </div>

                {/* Balance bar */}
                <div className="cs-balance-bar">
                    💰 <strong>{balance.toLocaleString()}</strong> chips available
                </div>

                {/* Category filter tabs */}
                <div className="ah-filters">
                    {FILTERS.map(f => (
                        <button
                            key={f.key}
                            className={`ah-filter-btn${filter === f.key ? ' active' : ''}`}
                            onClick={() => setFilter(f.key)}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>

                {/* Scrollable items grid */}
                <div className="cs-grid">
                    {visible.length === 0 ? (
                        <div className="ah-empty">No items in this category.</div>
                    ) : (
                        visible.map(item => (
                            <ItemCard
                                key={item.id}
                                item={item}
                                owned={owned.has(item.id)}
                                equipped={equipped[item.category] === item.id}
                                balance={balance}
                                onBuy={handleBuy}
                                onEquip={onEquip}
                                onUnequip={onUnequip}
                            />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
