import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

const disablePwa = process.env.VITE_DISABLE_PWA === '1';

export default defineConfig({
  plugins: [
    react(),
    ...(disablePwa ? [] : [VitePWA({
      // Disable in development mode to prevent SW complications during tunnel testing
      devOptions: {
        enabled: false,
      },
      registerType: 'prompt',  // Changed from 'autoUpdate' - user chooses when to refresh
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'icon-32.png'],
      manifest: {
        name: 'Terminal Tunnel',
        short_name: 'Terminal Tunnel',
        description: 'Access your terminal from anywhere',
        theme_color: '#1c1917',      // Fixed: was '#0D0D0C', now matches ropic default
        background_color: '#1c1917', // Fixed: was '#0D0D0C', now matches ropic default
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        skipWaiting: false,    // Don't immediately activate new service worker
        clientsClaim: false,   // Don't take over all clients immediately - prevents page reloads
      }
    })])
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    // Allow external hosts for tunnel access
    allowedHosts: ['.trycloudflare.com', '.darlow.me'],
    hmr: {
      // Don't trigger full page reload on HMR connection loss
      // This prevents the terminal from resetting when dev servers are started
      overlay: false,
    },
    proxy: {
      '/socket.io': {
        target: 'http://127.0.0.1:3456',
        ws: true
      },
      '/api': {
        target: 'http://127.0.0.1:3456'
      },
      '/stream': {
        target: 'http://127.0.0.1:3456'
      },
      '/preview': {
        target: 'http://127.0.0.1:3456'
      },
      '/memory': {
        target: 'http://127.0.0.1:3456'
      },
      // Memory viewer files served by Express
      '/memory-viewer.html': {
        target: 'http://127.0.0.1:3456'
      },
      '/viewer-bundle.js': {
        target: 'http://127.0.0.1:3456'
      },
      '/claude-mem-logomark.webp': {
        target: 'http://127.0.0.1:3456'
      },
      '/assets': {
        target: 'http://127.0.0.1:3456'
      },
      '/icon-thick-': {
        target: 'http://127.0.0.1:3456'
      },
      // Dev server paths for preview tunneling
      '/_next': {
        target: 'http://127.0.0.1:3456'
      }
    }
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true
  }
});
