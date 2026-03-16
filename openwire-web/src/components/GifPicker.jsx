import { useState, useEffect, useCallback, memo } from 'react';
import { getDefaultProvider, setDefaultProvider } from '../lib/gifSettings.js';
export { setDefaultProvider };

const GIPHY_KEY = import.meta.env.VITE_GIPHY_KEY || 'dc6zaTOxFJmzC';
const KLIPY_KEY = import.meta.env.VITE_KLIPY_API_KEY || '';
const KLIPY_API = 'https://api.klipy.com/v2';
const GIPHY_API = 'https://api.giphy.com/v1';

const GIPHY_TABS = [
    { key: 'gifs', label: 'GIFs' },
    { key: 'stickers', label: 'Stickers' },
    { key: 'emoji', label: 'Emoji' },
];

const KLIPY_TABS = [
    { key: 'gifs', label: 'GIFs' },
    { key: 'stickers', label: 'Stickers' },
    { key: 'clips', label: 'Clips' },
];

/* ── Klipy REST grid ───────────────────────────── */
function KlipyGrid({ query, tab, onSelect }) {
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!KLIPY_KEY) { setResults([]); return; }
        let cancelled = false;
        setLoading(true);

        const type = tab === 'stickers' ? 'stickers' : tab === 'clips' ? 'clips' : '';
        const endpoint = query
            ? `${KLIPY_API}/search?q=${encodeURIComponent(query)}&key=${KLIPY_KEY}&limit=24${type ? `&type=${type}` : ''}`
            : `${KLIPY_API}/featured?key=${KLIPY_KEY}&limit=24${type ? `&type=${type}` : ''}`;

        fetch(endpoint)
            .then(r => r.json())
            .then(json => {
                if (cancelled) return;
                const items = json.results || json.data?.data || [];
                setResults(items);
            })
            .catch(() => { if (!cancelled) setResults([]); })
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [query, tab]);

    if (!KLIPY_KEY) return <div className="gif-empty">Set VITE_KLIPY_API_KEY to enable Klipy</div>;

    return (
        <>
            {loading && <div className="gif-loading">Loading...</div>}
            {!loading && results.length === 0 && <div className="gif-empty">No results</div>}
            {!loading && (
                <div className="klipy-grid">
                    {results.map(item => {
                        const preview = item.media_formats?.tinygif?.url
                            || item.media_formats?.gif?.url
                            || item.media_formats?.tinymp4?.url
                            || '';
                        const full = item.media_formats?.gif?.url
                            || item.media_formats?.mp4?.url
                            || preview;
                        if (!preview) return null;
                        return (
                            <img
                                key={item.id}
                                src={preview}
                                alt={item.title || ''}
                                className="klipy-item"
                                onClick={() => onSelect(full)}
                            />
                        );
                    })}
                </div>
            )}
        </>
    );
}

/* ── Giphy REST grid (replaces @giphy SDK) ────── */
function GiphyGrid({ query, tab, onSelect }) {
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);

        let endpoint;
        if (tab === 'emoji') {
            endpoint = `https://api.giphy.com/v2/emoji?api_key=${GIPHY_KEY}&limit=24`;
        } else {
            const type = tab === 'stickers' ? 'stickers' : 'gifs';
            endpoint = query
                ? `${GIPHY_API}/${type}/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(query)}&limit=24&rating=g`
                : `${GIPHY_API}/${type}/trending?api_key=${GIPHY_KEY}&limit=24&rating=g`;
        }

        fetch(endpoint)
            .then(r => r.json())
            .then(json => {
                if (cancelled) return;
                setResults(json.data || []);
            })
            .catch(() => { if (!cancelled) setResults([]); })
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [query, tab]);

    return (
        <>
            {loading && <div className="gif-loading">Loading...</div>}
            {!loading && results.length === 0 && <div className="gif-empty">No results</div>}
            {!loading && (
                <div className="klipy-grid">
                    {results.map(gif => {
                        const preview = gif.images?.fixed_height_small?.url
                            || gif.images?.fixed_height?.url || '';
                        const full = gif.images?.fixed_height?.url
                            || gif.images?.original?.url || preview;
                        if (!preview) return null;
                        return (
                            <img
                                key={gif.id}
                                src={preview}
                                alt={gif.title || ''}
                                className="klipy-item"
                                onClick={() => onSelect(full)}
                            />
                        );
                    })}
                </div>
            )}
        </>
    );
}

/* ── Main Picker ───────────────────────────────── */
function GifPicker({ onSelect, onClose }) {
    const [provider, setProvider] = useState(getDefaultProvider);
    const [query, setQuery] = useState('');
    const [activeTab, setActiveTab] = useState('gifs');
    const [searchKey, setSearchKey] = useState(0);
    const [submittedQuery, setSubmittedQuery] = useState('');

    const hasKlipy = !!KLIPY_KEY;
    const tabs = provider === 'klipy' ? KLIPY_TABS : GIPHY_TABS;

    const handleSearch = () => {
        setSubmittedQuery(query);
        setSearchKey(prev => prev + 1);
    };

    const handleKey = (e) => { if (e.key === 'Enter') handleSearch(); };

    const handleSelect = useCallback((url) => {
        onSelect(url); onClose();
    }, [onSelect, onClose]);

    const switchProvider = (p) => {
        setProvider(p);
        setDefaultProvider(p);
        setActiveTab('gifs');
        setSearchKey(prev => prev + 1);
    };

    return (
        <div className="gif-picker">
            <div className="gif-header">
                <div className="gif-provider-toggle">
                    <button className={`gif-provider-btn ${provider === 'giphy' ? 'active' : ''}`} onClick={() => switchProvider('giphy')}>GIPHY</button>
                    {hasKlipy && <button className={`gif-provider-btn ${provider === 'klipy' ? 'active' : ''}`} onClick={() => switchProvider('klipy')}>Klipy</button>}
                </div>
                <div className="gif-tabs">
                    {tabs.map(t => (
                        <button key={t.key} className={`gif-tab ${activeTab === t.key ? 'active' : ''}`}
                            onClick={() => { setActiveTab(t.key); setSearchKey(prev => prev + 1); }}>
                            {t.label}
                        </button>
                    ))}
                </div>
                <button className="gif-close" onClick={onClose}>✕</button>
            </div>

            {!(provider === 'giphy' && activeTab === 'emoji') && (
                <div className="gif-search-row">
                    <input className="gif-search" placeholder={`Search ${activeTab}...`}
                        value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKey} autoFocus />
                    <button className="gif-search-btn" onClick={handleSearch}>🔍</button>
                </div>
            )}

            <div className="gif-grid" style={{ height: 250, overflowY: 'auto' }}>
                {provider === 'giphy' ? (
                    <GiphyGrid key={`giphy-${activeTab}-${searchKey}`}
                        query={submittedQuery} tab={activeTab} onSelect={handleSelect} />
                ) : (
                    <KlipyGrid key={`klipy-${activeTab}-${searchKey}`}
                        query={submittedQuery} tab={activeTab} onSelect={handleSelect} />
                )}
            </div>

            <div className="gif-footer">
                Powered by {provider === 'giphy' ? 'GIPHY' : 'Klipy'}
            </div>
        </div>
    );
}

export default memo(GifPicker);
