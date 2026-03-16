import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            './characters.js': resolve(__dirname, 'src/lib/agents/characters-light.js'),
        },
    },
    define: {
        'console.log': 'undefined',
        'console.warn': 'undefined',
        'console.debug': 'undefined',
    },
    build: {
        target: 'esnext',
        modulePreload: false,
        cssCodeSplit: true,
        rollupOptions: {
            output: {
                compact: true,
            },
            treeshake: {
                moduleSideEffects: false,
                propertyReadSideEffects: false,
            },
        },
    },
    server: {
        port: 5173,
    },
    test: {
        environment: 'jsdom',
        include: [
            'src/tests/**/*.test.{js,jsx,ts,tsx}',
            'src/tests/browser/**/*.test.{js,jsx,ts,tsx}',
        ],
        setupFiles: ['src/tests/browser/setup.js'],
        globals: true,
    },
});
