import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'icon-32.png'],
      manifest: {
        name: 'Terminal Tunnel',
        short_name: 'Terminal Tunnel',
        description: 'Access your terminal from anywhere',
        theme_color: '#0D0D0C',
        background_color: '#0D0D0C',
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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 5173,
    // Allow external hosts for tunnel access
    allowedHosts: ['.trycloudflare.com', '.darlow.me'],
    hmr: {
      // Don't trigger full page reload on HMR connection loss
      // This prevents the terminal from resetting when dev servers are started
      overlay: false,
    },
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3456',
        ws: true
      },
      '/api': {
        target: 'http://localhost:3456'
      },
      '/stream': {
        target: 'http://localhost:3456'
      },
      '/preview': {
        target: 'http://localhost:3456'
      },
      '/memory': {
        target: 'http://localhost:3456'
      },
      // Memory viewer files served by Express
      '/memory-viewer.html': {
        target: 'http://localhost:3456'
      },
      '/viewer-bundle.js': {
        target: 'http://localhost:3456'
      },
      '/claude-mem-logomark.webp': {
        target: 'http://localhost:3456'
      },
      '/assets': {
        target: 'http://localhost:3456'
      },
      '/icon-thick-': {
        target: 'http://localhost:3456'
      },
      // Dev server paths for preview tunneling
      '/_next': {
        target: 'http://localhost:3456'
      }
    }
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true
  }
});
