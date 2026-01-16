import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

// Suppress react-beautiful-dnd defaultProps warning (library issue with React 18+)
const originalError = console.error;
console.error = (...args) => {
  if (args[0]?.includes?.('defaultProps will be removed')) return;
  originalError.apply(console, args);
};

// Debug: Track page lifecycle events
if (import.meta.env.DEV) {
  window.addEventListener('beforeunload', () => {
    console.log('[Page] beforeunload - page is being unloaded');
  });
  window.addEventListener('pagehide', () => {
    console.log('[Page] pagehide');
  });
  window.addEventListener('visibilitychange', () => {
    console.log('[Page] visibilitychange:', document.visibilityState);
  });

  // Prevent Vite from auto-reloading when HMR connection is lost
  // This is critical for terminal apps that run dev servers
  if (import.meta.hot) {
    let suppressReload = false;
    let reloadTimeout: ReturnType<typeof setTimeout> | null = null;

    // Track when HMR disconnects
    import.meta.hot.on('vite:ws:disconnect', () => {
      console.log('[Vite] HMR WebSocket disconnected - suppressing auto-reload for 30s');
      suppressReload = true;
      if (reloadTimeout) clearTimeout(reloadTimeout);
      reloadTimeout = setTimeout(() => {
        suppressReload = false;
        reloadTimeout = null;
        console.log('[Vite] Reload suppression expired');
      }, 30000);
    });

    import.meta.hot.on('vite:ws:connect', () => {
      console.log('[Vite] HMR WebSocket reconnected');
      suppressReload = false;
      if (reloadTimeout) {
        clearTimeout(reloadTimeout);
        reloadTimeout = null;
      }
    });

    // Intercept beforeunload to prevent automatic page reloads during reconnection
    window.addEventListener('beforeunload', (e) => {
      if (suppressReload) {
        console.log('[Vite] Blocking page unload during reconnection period');
        e.preventDefault();
        // Note: Modern browsers require returnValue to be set
        e.returnValue = '';
      }
    });

    // Use Vite's HMR API to prevent full reloads
    import.meta.hot.on('vite:beforeFullReload', (payload) => {
      if (suppressReload) {
        console.log('[Vite] Full reload blocked to preserve terminal state');
        // Returning false doesn't prevent reload, but we can throw to interrupt
        throw new Error('Reload suppressed');
      }
    });
  }
}

// Service Worker Management
// We have two types of SWs:
// 1. VitePWA SW (sw.js) - handles caching, caused reload loops previously
// 2. Push SW (push-sw.js) - ONLY handles push notifications, safe to keep
if ('serviceWorker' in navigator) {
  // Unregister the VitePWA service worker (sw.js) to stop reload loops
  // BUT keep the push notification service worker (push-sw.js)
  navigator.serviceWorker.getRegistrations()
    .then(registrations => {
      for (const registration of registrations) {
        // Only unregister the VitePWA SW, keep push-sw.js
        if (!registration.active?.scriptURL.includes('push-sw.js')) {
          registration.unregister();
          console.log('[SW] Unregistered VitePWA service worker:', registration.scope);
        } else {
          console.log('[SW] Keeping push notification SW:', registration.scope);
        }
      }
    })
    .catch(() => {}); // Silently ignore errors to prevent Safari refresh hang

  // Clear VitePWA caches but NOT push-related data
  if ('caches' in window) {
    caches.keys()
      .then(names => {
        for (const name of names) {
          // Delete VitePWA caches (workbox-*)
          if (name.startsWith('workbox-') || name.includes('precache')) {
            caches.delete(name);
            console.log('[SW] Deleted VitePWA cache:', name);
          }
        }
      })
      .catch(() => {}); // Silently ignore errors to prevent Safari refresh hang
  }

  // Prevent VitePWA service worker from causing reloads
  // Push SW changes are fine since it doesn't cache anything
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.log('[SW] Controller changed - NOT reloading to preserve session state');
    // Don't reload - user can manually refresh when ready
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  // StrictMode disabled - causes terminal create/destroy loops in development
  // due to double-invoke behavior with socket connections
  // <React.StrictMode>
    <App />
  // </React.StrictMode>
);
