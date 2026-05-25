import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Local dev proxy: any /api request hits `wrangler pages dev` on :8788
// so the React app + Pages Functions can be developed together.
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            '/api': 'http://127.0.0.1:8788',
        },
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: false,
    },
});
