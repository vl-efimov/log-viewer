
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const getBaseUrl = (mode: string) => {
    // Optional override (e.g. CI or custom hosting)
    const override = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env
        ?.VITE_BASE_PATH;
    if (override !== undefined) {
        return override;
    }

    // GitHub Pages (project site)
    if (mode === 'gh-pages') {
        return '/log-viewer';
    }

    // Default: local/self-hosted at domain root
    return '';
};

export default defineConfig(({ mode }) => {
    const BASE_URL = getBaseUrl(mode) + '/';

    return {
        base: BASE_URL,
        plugins: [
            react(),
            VitePWA({
                workbox: {
                    globPatterns: ["**/*"],
                    maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
                },
                includeAssets: [
                    "**/*",
                ],
                manifest: {
                    "name": "My PWA App",
                    "short_name": "PWA App",
                    "description": "A simple PWA built with React, TypeScript, and Vite",
                    "start_url": BASE_URL,
                    "display": "standalone",
                    "background_color": "#ffffff",
                    "theme_color": "#ffffff",
                    "icons": [
                        {
                            "src": `${BASE_URL}pwa-192x192.png`,
                            "sizes": "192x192",
                            "type": "image/png"
                        },
                        {
                            "src": `${BASE_URL}pwa-512x512.png`,
                            "sizes": "512x512",
                            "type": "image/png"
                        }
                    ],
                    "screenshots": [
                        {
                            "src": `${BASE_URL}screenshot-wide-desktop.png`,
                            "sizes": "2560x1440",
                            "type": "image/png",
                            "form_factor": "wide"
                        },
                        {
                            "src": `${BASE_URL}screenshot-wide-mobile.png`,
                            "sizes": "850x1440",
                            "type": "image/png",
                            "form_factor": "narrow"
                        }
                    ]
                },
            }),
        ],
    };
});