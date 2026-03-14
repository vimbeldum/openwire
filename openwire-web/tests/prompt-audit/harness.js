/**
 * Prompt Audit Harness
 * Loads API key from .env.local and calls Gemini API directly.
 */

import { readFileSync } from 'fs';

function loadEnv() {
    try {
        const content = readFileSync(
            new URL('../../.env.local', import.meta.url).pathname,
            'utf8'
        );
        const env = {};
        for (const line of content.split('\n')) {
            const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)/);
            if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
        }
        return env;
    } catch {
        return {};
    }
}

export function getApiKey() {
    const env = loadEnv();
    return (
        env.GEMINI_API_KEY ||
        env.VITE_GEMINI_KEY ||
        env.GEMINI_KEY ||
        process.env.GEMINI_API_KEY ||
        process.env.VITE_GEMINI_KEY ||
        ''
    );
}

/**
 * Call Gemini API with a system prompt, optional chat history, and a user message.
 * Returns { text, raw }.
 */
export async function callGemini(modelId, systemPrompt, userMessage, chatHistory = []) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('No Gemini API key found in .env.local (expected GEMINI_API_KEY)');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

    const systemInstruction = { parts: [{ text: systemPrompt }] };

    const contents = [];
    for (const turn of chatHistory) {
        contents.push({ role: turn.role, parts: [{ text: turn.text }] });
    }
    contents.push({ role: 'user', parts: [{ text: userMessage }] });

    const body = {
        systemInstruction,
        contents,
        generationConfig: {
            temperature: 0,
            topP: 0.01,
            topK: 1,
            maxOutputTokens: 200,
        },
    };

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
        const err = await resp.text().catch(() => '');
        throw new Error(`Gemini API error ${resp.status}: ${err}`);
    }

    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { text, raw: data };
}
