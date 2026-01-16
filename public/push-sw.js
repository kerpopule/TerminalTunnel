/**
 * Push Notification Service Worker for Terminal Tunnel
 *
 * This is a minimal service worker that ONLY handles push notifications.
 * It does NOT cache any assets or intercept fetch requests to avoid
 * conflicts with the main application and the reload loop issue.
 */

// Handle push events from the server
self.addEventListener('push', (event) => {
  console.log('[push-sw] Push event received');

  // Default notification content
  let title = 'Terminal Tunnel';
  let body = 'Claude is awaiting your input';
  let tag = 'claude-notification';
  let data = {};

  // Try to parse push data
  if (event.data) {
    try {
      const payload = event.data.json();
      title = payload.title || title;
      body = payload.body || body;
      tag = payload.tag || tag;
      data = payload.data || data;
    } catch (e) {
      // If JSON parsing fails, try as text
      body = event.data.text() || body;
    }
  }

  const options = {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag, // Replaces previous notifications with same tag
    requireInteraction: true, // Keep visible until user interacts
    vibrate: [200, 100, 200], // Vibration pattern for mobile
    data: {
      ...data,
      url: '/', // URL to open when clicked
      timestamp: Date.now(),
    },
    actions: [
      {
        action: 'open',
        title: 'Open Terminal',
      },
      {
        action: 'dismiss',
        title: 'Dismiss',
      },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('[push-sw] Notification clicked:', event.action);

  event.notification.close();

  // Handle different actions
  if (event.action === 'dismiss') {
    return;
  }

  // Default action or 'open' action - open/focus the app
  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // Check if there's already an open window
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        // No existing window, open a new one
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// Handle notification close
self.addEventListener('notificationclose', (event) => {
  console.log('[push-sw] Notification closed');
});

// Handle service worker installation
self.addEventListener('install', (event) => {
  console.log('[push-sw] Service worker installed');
  // Skip waiting to activate immediately
  self.skipWaiting();
});

// Handle service worker activation
self.addEventListener('activate', (event) => {
  console.log('[push-sw] Service worker activated');
  // Take control of all pages immediately
  event.waitUntil(clients.claim());
});

// Log subscription changes
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[push-sw] Push subscription changed');
  // Could re-subscribe here if needed
});
