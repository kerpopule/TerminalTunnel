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

ReactDOM.createRoot(document.getElementById('root')!).render(
  // StrictMode disabled - causes terminal create/destroy loops in development
  // due to double-invoke behavior with socket connections
  // <React.StrictMode>
    <App />
  // </React.StrictMode>
);
