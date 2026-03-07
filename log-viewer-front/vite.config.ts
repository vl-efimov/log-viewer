import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    base: "/log-viewer/",
    plugins: [
        react(),
        VitePWA({
            workbox: {
                globPatterns: ["**/*"],
            },
            includeAssets: [
                "**/*",
            ],
            manifest: {
                "name": "My PWA App",
                "short_name": "PWA App",
                "description": "A simple PWA built with React, TypeScript, and Vite",
                "start_url": "/log-viewer/",
                "display": "standalone",
                "background_color": "#ffffff",
                "theme_color": "#ffffff",
                "icons": [
                    {
                        "src": "/log-viewer/pwa-192x192.png",
                        "sizes": "192x192",
                        "type": "image/png"
                    },
                    {
                        "src": "/log-viewer/pwa-512x512.png",
                        "sizes": "512x512",
                        "type": "image/png"
                    }
                ],
                "screenshots": [
                    {
                        "src": "/log-viewer/screenshot-wide-desktop.png",
                        "sizes": "2560x1440",
                        "type": "image/png",
                        "form_factor": "wide"
                    },
                    {
                        "src": "/log-viewer/screenshot-wide-mobile.png",
                        "sizes": "850x1440",
                        "type": "image/png",
                        "form_factor": "narrow"
                    }
                ]
            },
        }),
    ],
});
