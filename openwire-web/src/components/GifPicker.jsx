import { useState, useRef } from 'react';

const GIPHY_KEY = import.meta.env.VITE_GIPHY_KEY || 'dc6zaTOxFJmzC';
const API = `https://api.giphy.com/v1/gifs`;

export default function GifPicker({ onSelect, onClose }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const inputRef = useRef();

    const search = async (q) => {
        if (!q.trim()) return;
        setLoading(true);
        try {
            const url = q
                ? `${API}/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=12&rating=g`
                : `${API}/trending?api_key=${GIPHY_KEY}&limit=12&rating=g`;
            const res = await fetch(url);
            const json = await res.json();
            setResults(json.data || []);
        } catch {
            setResults([]);
        }
        setLoading(false);
    };

    // Load trending on first mount
    useState(() => { search(''); }, []);

    const handleKey = (e) => {
        if (e.key === 'Enter') search(query);
    };

    return (
        <div className="gif-picker">
            <div className="gif-header">
                <input
                    ref={inputRef}
                    className="gif-search"
                    placeholder="Search GIFs..."
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={handleKey}
                    autoFocus
                />
                <button className="gif-search-btn" onClick={() => search(query)}>🔍</button>
                <button className="gif-close" onClick={onClose}>✕</button>
            </div>
            <div className="gif-grid">
                {loading && <div className="gif-loading">Loading…</div>}
                {!loading && results.map(gif => (
                    <img
                        key={gif.id}
                        src={gif.images.fixed_height_small.url}
                        alt={gif.title}
                        className="gif-item"
                        onClick={() => {
                            onSelect(gif.images.fixed_height.url);
                            onClose();
                        }}
                    />
                ))}
                {!loading && results.length === 0 && (
                    <div className="gif-empty">No GIFs found</div>
                )}
            </div>
            <div className="gif-footer">
                Powered by GIPHY
            </div>
        </div>
    );
}
