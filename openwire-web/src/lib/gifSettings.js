const SETTINGS_KEY = 'openwire:gif_provider';

export function setDefaultProvider(provider) {
    try { localStorage.setItem(SETTINGS_KEY, provider); } catch {}
}

export function getDefaultProvider() {
    try { return localStorage.getItem(SETTINGS_KEY) || 'giphy'; } catch { return 'giphy'; }
}
