import { useState, useCallback, memo } from 'react';
import { GiphyFetch } from '@giphy/js-fetch-api';
import { Grid } from '@giphy/react-components';

const GIPHY_KEY = import.meta.env.VITE_GIPHY_KEY || 'dc6zaTOxFJmzC';
const gf = new GiphyFetch(GIPHY_KEY);

const TABS = [
    { key: 'gifs', label: 'GIFs' },
    { key: 'stickers', label: 'Stickers' },
    { key: 'emoji', label: 'Emoji' },
];

function GifPicker({ onSelect, onClose }) {
    const [query, setQuery] = useState('');
    const [activeTab, setActiveTab] = useState('gifs');
    const [searchKey, setSearchKey] = useState(0); // force Grid remount on search

    const fetchGifs = useCallback((offset) => {
        if (activeTab === 'emoji') {
            return gf.emoji({ offset, limit: 20 });
        }
        const type = activeTab === 'stickers' ? 'stickers' : 'gifs';
        if (query) {
            return gf.search(query, { offset, limit: 20, type, rating: 'g' });
        }
        return gf.trending({ offset, limit: 20, type, rating: 'g' });
    }, [query, activeTab]);

    const handleSearch = () => {
        setSearchKey(prev => prev + 1); // remount Grid to reset pagination
    };

    const handleKey = (e) => {
        if (e.key === 'Enter') handleSearch();
    };

    const handleGifClick = useCallback((gif, e) => {
        e.preventDefault();
        const url = gif.images?.fixed_height?.url || gif.images?.original?.url;
        if (url) {
            onSelect(url);
            onClose();
        }
    }, [onSelect, onClose]);

    return (
        <div className="gif-picker">
            <div className="gif-header">
                <div className="gif-tabs">
                    {TABS.map(t => (
                        <button
                            key={t.key}
                            className={`gif-tab ${activeTab === t.key ? 'active' : ''}`}
                            onClick={() => { setActiveTab(t.key); setSearchKey(prev => prev + 1); }}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
                <button className="gif-close" onClick={onClose}>✕</button>
            </div>
            {activeTab !== 'emoji' && (
                <div className="gif-search-row">
                    <input
                        className="gif-search"
                        placeholder={`Search ${activeTab}...`}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKey}
                        autoFocus
                    />
                    <button className="gif-search-btn" onClick={handleSearch}>🔍</button>
                </div>
            )}
            <div className="gif-grid" style={{ height: 250, overflowY: 'auto' }}>
                <Grid
                    key={`${activeTab}-${searchKey}`}
                    width={320}
                    columns={3}
                    gutter={4}
                    fetchGifs={fetchGifs}
                    onGifClick={handleGifClick}
                    noLink
                />
            </div>
            <div className="gif-footer">
                Powered by GIPHY
            </div>
        </div>
    );
}

export default memo(GifPicker);
