import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'ZeroMalaria',
        short_name: 'ZeroMalaria',
        description: 'Offline-first CHW malaria triage and referral',
        theme_color: '#0B3D5C',
        background_color: '#F4FAF8',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,ico,svg,png,woff2,json,mp3}'],
        runtimeCaching: [
          {
            // Never cache voice auth uploads — stale 401s break Record
            urlPattern: ({ url }) => url.pathname.startsWith('/api/voice'),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ url }) =>
              (url.pathname.startsWith('/api') || url.port === '8000') &&
              !url.pathname.startsWith('/api/voice'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 3,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Pre-recorded Kinyarwanda / English phrase packs for offline voice.
            urlPattern: ({ url }) => url.pathname.startsWith('/audio/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'audio-pack',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        cookieDomainRewrite: 'localhost',
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // Preserve Authorization on multipart uploads
            void proxyReq;
          });
          // SSE / API reload: ECONNRESET is expected — do not spam the Vite console
          proxy.on('error', (err, req, res) => {
            const url = String(req?.url || '');
            const code = (err as NodeJS.ErrnoException)?.code || '';
            const expected =
              url.includes('/events') &&
              (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EPIPE');
            if (expected) {
              if (res && 'writeHead' in res && typeof res.writeHead === 'function' && !res.headersSent) {
                try {
                  res.writeHead(502, { 'Content-Type': 'text/plain' });
                  res.end('upstream unavailable');
                } catch {
                  /* ignore */
                }
              }
              return;
            }
            console.error('[vite proxy]', code || err.message, url.replace(/([?&](?:access_token|ticket)=)[^&]*/gi, '$1***'));
          });
        },
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        cookieDomainRewrite: 'localhost',
        configure: (proxy) => {
          proxy.on('error', (err, req, res) => {
            const url = String(req?.url || '');
            const code = (err as NodeJS.ErrnoException)?.code || '';
            if (url.includes('/events') && (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EPIPE')) {
              if (res && 'writeHead' in res && typeof res.writeHead === 'function' && !res.headersSent) {
                try {
                  res.writeHead(502);
                  res.end();
                } catch {
                  /* ignore */
                }
              }
              return;
            }
            console.error('[vite proxy]', code || err.message);
          });
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    exclude: ['**/node_modules/**', '**/e2e/**', '**/dist/**'],
  },
});

