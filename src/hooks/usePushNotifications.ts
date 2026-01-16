import { useState, useEffect, useCallback } from 'react';

// Unique device ID stored in localStorage
const DEVICE_ID_KEY = 'terminal-tunnel-device-id';

interface PushNotificationState {
  isSupported: boolean;
  isPWA: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  permission: NotificationPermission | 'unsupported';
  isSubscribed: boolean;
  isLoading: boolean;
  error: string | null;
}

interface UsePushNotificationsReturn extends PushNotificationState {
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
  testNotification: () => Promise<void>;
}

/**
 * Convert a URL-safe base64 string to a Uint8Array
 * Required for VAPID public key conversion
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Get or generate a unique device ID
 */
function getDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

/**
 * Detect if running as installed PWA
 */
function detectPWA(): boolean {
  // Check display-mode media query
  if (window.matchMedia('(display-mode: standalone)').matches) {
    return true;
  }
  // Check iOS standalone mode
  if ((window.navigator as any).standalone === true) {
    return true;
  }
  // Check if launched from home screen (Android TWA)
  if (document.referrer.includes('android-app://')) {
    return true;
  }
  return false;
}

/**
 * Detect iOS device
 */
function detectIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

/**
 * Detect Android device
 */
function detectAndroid(): boolean {
  return /Android/.test(navigator.userAgent);
}

/**
 * Check if push notifications are supported
 */
function checkSupport(): boolean {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Hook for managing push notification subscriptions
 */
export function usePushNotifications(): UsePushNotificationsReturn {
  const [state, setState] = useState<PushNotificationState>({
    isSupported: false,
    isPWA: false,
    isIOS: false,
    isAndroid: false,
    permission: 'unsupported',
    isSubscribed: false,
    isLoading: true,
    error: null,
  });

  // Initialize state on mount
  useEffect(() => {
    const isSupported = checkSupport();
    const isPWA = detectPWA();
    const isIOS = detectIOS();
    const isAndroid = detectAndroid();

    setState((prev) => ({
      ...prev,
      isSupported,
      isPWA,
      isIOS,
      isAndroid,
      permission: isSupported ? Notification.permission : 'unsupported',
    }));

    // Check if already subscribed
    if (isSupported) {
      checkSubscription();
    } else {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, []);

  /**
   * Check if user is already subscribed
   */
  const checkSubscription = useCallback(async () => {
    try {
      // Use scope '/' since that's what we register with, not the script URL
      const registration = await navigator.serviceWorker.getRegistration('/');
      console.log('[Push] Checking subscription, registration found:', !!registration);
      if (registration) {
        const subscription = await registration.pushManager.getSubscription();
        console.log('[Push] Subscription found:', !!subscription);
        setState((prev) => ({
          ...prev,
          isSubscribed: !!subscription,
          isLoading: false,
        }));
      } else {
        console.log('[Push] No service worker registration found');
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    } catch (error) {
      console.error('[Push] Failed to check subscription:', error);
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, []);

  /**
   * Subscribe to push notifications
   */
  const subscribe = useCallback(async (): Promise<boolean> => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // Request notification permission
      const permission = await Notification.requestPermission();
      setState((prev) => ({ ...prev, permission }));

      if (permission !== 'granted') {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: 'Notification permission denied',
        }));
        return false;
      }

      // Register service worker
      const registration = await navigator.serviceWorker.register('/push-sw.js', {
        scope: '/',
      });

      // Wait for service worker to be ready
      await navigator.serviceWorker.ready;

      // Get VAPID public key from server
      const vapidResponse = await fetch('/api/push/vapid-public-key');
      if (!vapidResponse.ok) {
        throw new Error('Failed to get VAPID public key');
      }
      const { publicKey } = await vapidResponse.json();

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      // Send subscription to server
      const deviceId = getDeviceId();
      const subscribeResponse = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          deviceId,
          userAgent: navigator.userAgent,
        }),
      });

      if (!subscribeResponse.ok) {
        throw new Error('Failed to register subscription with server');
      }

      setState((prev) => ({
        ...prev,
        isSubscribed: true,
        isLoading: false,
      }));

      console.log('[Push] Successfully subscribed');
      return true;
    } catch (error) {
      console.error('[Push] Subscription failed:', error);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Subscription failed',
      }));
      return false;
    }
  }, []);

  /**
   * Unsubscribe from push notifications
   */
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      if (registration) {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await subscription.unsubscribe();
        }
      }

      // Notify server
      const deviceId = getDeviceId();
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ deviceId }),
      });

      setState((prev) => ({
        ...prev,
        isSubscribed: false,
        isLoading: false,
      }));

      console.log('[Push] Successfully unsubscribed');
      return true;
    } catch (error) {
      console.error('[Push] Unsubscribe failed:', error);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unsubscribe failed',
      }));
      return false;
    }
  }, []);

  /**
   * Send a test notification (for debugging)
   */
  const testNotification = useCallback(async (): Promise<void> => {
    try {
      await fetch('/api/notify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'test',
          message: 'This is a test notification',
        }),
      });
    } catch (error) {
      console.error('[Push] Test notification failed:', error);
    }
  }, []);

  return {
    ...state,
    subscribe,
    unsubscribe,
    testNotification,
  };
}

/**
 * Check if user needs PWA installation instructions
 * (iOS users must install PWA before notifications work)
 */
export function needsPWAInstallation(): { needsInstall: boolean; isIOS: boolean } {
  const isIOS = detectIOS();
  const isPWA = detectPWA();

  // On iOS, push notifications ONLY work when installed as PWA
  if (isIOS && !isPWA) {
    return { needsInstall: true, isIOS: true };
  }

  return { needsInstall: false, isIOS };
}
