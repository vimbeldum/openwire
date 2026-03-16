import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
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
