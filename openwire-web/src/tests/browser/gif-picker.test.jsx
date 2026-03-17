/**
 * gif-picker.test.jsx
 *
 * Vitest + RTL tests for GifPicker component.
 * Covers: rendering, tabs, provider switching, search, selection, close.
 * Mocks fetch API to avoid real network calls.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

/* ── Mocks ─────────────────────────────────────────── */

// Mock gifSettings
vi.mock('../../lib/gifSettings.js', () => ({
    getDefaultProvider: vi.fn(() => 'giphy'),
    setDefaultProvider: vi.fn(),
}));

// Mock fetch globally
const mockFetch = vi.fn(() =>
    Promise.resolve({
        json: () => Promise.resolve({ data: [
            {
                id: 'gif-1',
                title: 'Test GIF',
                images: {
                    fixed_height_small: { url: 'https://example.com/small.gif' },
                    fixed_height: { url: 'https://example.com/full.gif' },
                    original: { url: 'https://example.com/original.gif' },
                },
            },
        ]}),
    })
);
vi.stubGlobal('fetch', mockFetch);

import GifPicker from '../../components/GifPicker.jsx';

/* ── Helpers ─────────────────────────────────────── */

function renderPicker(props = {}) {
    const defaults = {
        onSelect: vi.fn(),
        onClose: vi.fn(),
    };
    return render(<GifPicker {...defaults} {...props} />);
}

/* ── Tests ──────────────────────────────────────── */

describe('GifPicker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockImplementation(() =>
            Promise.resolve({
                json: () => Promise.resolve({ data: [
                    {
                        id: 'gif-1',
                        title: 'Test GIF',
                        images: {
                            fixed_height_small: { url: 'https://example.com/small.gif' },
                            fixed_height: { url: 'https://example.com/full.gif' },
                        },
                    },
                ]}),
            })
        );
    });

    describe('rendering', () => {
        it('renders the picker container', () => {
            const { container } = renderPicker();
            expect(container.querySelector('.gif-picker')).toBeInTheDocument();
        });

        it('renders GIPHY provider button as active by default', () => {
            const { container } = renderPicker();
            const giphyBtn = container.querySelector('.gif-provider-btn.active');
            expect(giphyBtn.textContent).toBe('GIPHY');
        });

        it('renders tab buttons (GIFs, Stickers, Emoji)', () => {
            renderPicker();
            expect(screen.getByText('GIFs')).toBeInTheDocument();
            expect(screen.getByText('Stickers')).toBeInTheDocument();
            expect(screen.getByText('Emoji')).toBeInTheDocument();
        });

        it('renders search input', () => {
            renderPicker();
            expect(screen.getByPlaceholderText(/Search gifs/i)).toBeInTheDocument();
        });

        it('renders close button', () => {
            const onClose = vi.fn();
            renderPicker({ onClose });
            fireEvent.click(screen.getByText('✕'));
            expect(onClose).toHaveBeenCalledOnce();
        });

        it('renders powered by footer', () => {
            renderPicker();
            expect(screen.getByText(/Powered by GIPHY/)).toBeInTheDocument();
        });
    });

    describe('tab switching', () => {
        it('clicking Stickers tab changes active tab', () => {
            const { container } = renderPicker();
            fireEvent.click(screen.getByText('Stickers'));
            const activeTab = container.querySelector('.gif-tab.active');
            expect(activeTab.textContent).toBe('Stickers');
        });

        it('clicking Emoji tab hides search input (emoji has no search)', () => {
            renderPicker();
            fireEvent.click(screen.getByText('Emoji'));
            expect(screen.queryByPlaceholderText(/Search/)).not.toBeInTheDocument();
        });

        it('clicking back to GIFs restores search input', () => {
            renderPicker();
            fireEvent.click(screen.getByText('Emoji'));
            fireEvent.click(screen.getByText('GIFs'));
            expect(screen.getByPlaceholderText(/Search gifs/i)).toBeInTheDocument();
        });
    });

    describe('search', () => {
        it('search button triggers fetch', () => {
            renderPicker();
            const input = screen.getByPlaceholderText(/Search gifs/i);
            fireEvent.change(input, { target: { value: 'cats' } });
            fireEvent.click(screen.getByText('🔍'));
            // fetch should have been called (initial + search)
            expect(mockFetch).toHaveBeenCalled();
        });

        it('Enter key triggers search', () => {
            renderPicker();
            const input = screen.getByPlaceholderText(/Search gifs/i);
            fireEvent.change(input, { target: { value: 'dogs' } });
            fireEvent.keyDown(input, { key: 'Enter' });
            expect(mockFetch).toHaveBeenCalled();
        });
    });

    describe('gif selection', () => {
        it('clicking a GIF calls onSelect and onClose', async () => {
            const onSelect = vi.fn();
            const onClose = vi.fn();
            renderPicker({ onSelect, onClose });

            // Wait for the GIF to render
            await waitFor(() => {
                expect(screen.getByAltText('Test GIF')).toBeInTheDocument();
            });

            fireEvent.click(screen.getByAltText('Test GIF'));
            expect(onSelect).toHaveBeenCalledWith('https://example.com/full.gif');
            expect(onClose).toHaveBeenCalledOnce();
        });
    });

    describe('loading state', () => {
        it('shows loading text while fetching', () => {
            // Make fetch hang
            mockFetch.mockImplementation(() => new Promise(() => {}));
            renderPicker();
            expect(screen.getByText('Loading...')).toBeInTheDocument();
        });
    });

    describe('empty state', () => {
        it('shows No results when fetch returns empty', async () => {
            mockFetch.mockImplementation(() =>
                Promise.resolve({ json: () => Promise.resolve({ data: [] }) })
            );
            renderPicker();
            await waitFor(() => {
                expect(screen.getByText('No results')).toBeInTheDocument();
            });
        });
    });

    describe('provider switching', () => {
        it('clicking GIPHY activates GIPHY provider', () => {
            const { container } = renderPicker();
            fireEvent.click(screen.getByText('GIPHY'));
            const active = container.querySelector('.gif-provider-btn.active');
            expect(active.textContent).toBe('GIPHY');
        });
    });
});
