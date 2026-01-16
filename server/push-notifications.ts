import webpush from 'web-push';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Store VAPID keys and subscriptions in ~/.terminal-tunnel/
const CONFIG_DIR = path.join(os.homedir(), '.terminal-tunnel');
const VAPID_KEYS_FILE = path.join(CONFIG_DIR, 'vapid-keys.json');
const SUBSCRIPTIONS_FILE = path.join(CONFIG_DIR, 'push-subscriptions.json');

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  deviceId: string;
  createdAt: number;
  userAgent?: string;
}

// In-memory subscription store
const subscriptions = new Map<string, PushSubscriptionData>();

// Track if VAPID is configured
let vapidConfigured = false;

/**
 * Ensure config directory exists
 */
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Generate or load VAPID keys
 */
export function initializeVapidKeys(): VapidKeys {
  ensureConfigDir();

  // Try to load existing keys
  if (fs.existsSync(VAPID_KEYS_FILE)) {
    try {
      const data = fs.readFileSync(VAPID_KEYS_FILE, 'utf-8');
      const keys = JSON.parse(data) as VapidKeys;

      // Configure web-push with loaded keys
      webpush.setVapidDetails(
        'mailto:notifications@terminaltunnel.local',
        keys.publicKey,
        keys.privateKey
      );
      vapidConfigured = true;

      console.log('[Push] Loaded existing VAPID keys');
      return keys;
    } catch (err) {
      console.warn('[Push] Failed to load VAPID keys, generating new ones:', err);
    }
  }

  // Generate new keys
  const keys = webpush.generateVAPIDKeys();

  // Save keys
  fs.writeFileSync(VAPID_KEYS_FILE, JSON.stringify(keys, null, 2), { mode: 0o600 });

  // Configure web-push
  webpush.setVapidDetails(
    'mailto:notifications@terminaltunnel.local',
    keys.publicKey,
    keys.privateKey
  );
  vapidConfigured = true;

  console.log('[Push] Generated new VAPID keys');
  return keys;
}

/**
 * Get the public VAPID key for client subscription
 */
export function getVapidPublicKey(): string | null {
  if (!vapidConfigured) {
    initializeVapidKeys();
  }

  try {
    const data = fs.readFileSync(VAPID_KEYS_FILE, 'utf-8');
    const keys = JSON.parse(data) as VapidKeys;
    return keys.publicKey;
  } catch {
    return null;
  }
}

/**
 * Load subscriptions from disk
 */
export function loadSubscriptions(): void {
  ensureConfigDir();

  if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
    try {
      const data = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf-8');
      const subs = JSON.parse(data) as PushSubscriptionData[];

      for (const sub of subs) {
        subscriptions.set(sub.deviceId, sub);
      }

      console.log(`[Push] Loaded ${subscriptions.size} subscription(s)`);
    } catch (err) {
      console.warn('[Push] Failed to load subscriptions:', err);
    }
  }
}

/**
 * Save subscriptions to disk
 */
function saveSubscriptions(): void {
  ensureConfigDir();

  const subs = Array.from(subscriptions.values());
  fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subs, null, 2), { mode: 0o600 });
}

/**
 * Add a push subscription
 */
export function addSubscription(subscription: PushSubscriptionData): void {
  subscriptions.set(subscription.deviceId, {
    ...subscription,
    createdAt: Date.now()
  });
  saveSubscriptions();
  console.log(`[Push] Added subscription for device ${subscription.deviceId.slice(0, 8)}...`);
}

/**
 * Remove a push subscription
 */
export function removeSubscription(deviceId: string): boolean {
  const existed = subscriptions.delete(deviceId);
  if (existed) {
    saveSubscriptions();
    console.log(`[Push] Removed subscription for device ${deviceId.slice(0, 8)}...`);
  }
  return existed;
}

/**
 * Get subscription count
 */
export function getSubscriptionCount(): number {
  return subscriptions.size;
}

/**
 * Send notification to all subscribed devices
 */
export async function sendNotificationToAll(payload: {
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
}): Promise<{ sent: number; failed: number; expired: string[] }> {
  if (!vapidConfigured) {
    console.warn('[Push] VAPID not configured, cannot send notifications');
    return { sent: 0, failed: 0, expired: [] };
  }

  console.log(`[Push] Attempting to send notification to ${subscriptions.size} device(s)`);
  console.log(`[Push] Payload: title="${payload.title}", body="${payload.body}", tag="${payload.tag || 'claude-notification'}"`);

  const results = { sent: 0, failed: 0, expired: [] as string[] };

  const notificationPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    tag: payload.tag || 'claude-notification',
    data: payload.data || {}
  });

  for (const [deviceId, sub] of subscriptions) {
    try {
      console.log(`[Push] Sending to device ${deviceId.slice(0, 8)}... (endpoint: ${sub.endpoint.slice(0, 50)}...)`);
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: sub.keys
        },
        notificationPayload,
        {
          TTL: 60 * 60, // 1 hour
          urgency: 'high'
        }
      );
      console.log(`[Push] Successfully sent to device ${deviceId.slice(0, 8)}...`);
      results.sent++;
    } catch (error: unknown) {
      const err = error as { statusCode?: number };

      // 410 Gone or 404 Not Found = subscription expired
      if (err.statusCode === 410 || err.statusCode === 404) {
        subscriptions.delete(deviceId);
        results.expired.push(deviceId);
        console.log(`[Push] Subscription expired for device ${deviceId.slice(0, 8)}...`);
      } else {
        results.failed++;
        console.error(`[Push] Failed to send to ${deviceId.slice(0, 8)}...:`, error);
      }
    }
  }

  // Save if any subscriptions were removed
  if (results.expired.length > 0) {
    saveSubscriptions();
  }

  console.log(`[Push] Sent: ${results.sent}, Failed: ${results.failed}, Expired: ${results.expired.length}`);
  return results;
}

/**
 * Send notification for Claude Code stop event
 */
export async function notifyClaudeStop(message?: string): Promise<void> {
  await sendNotificationToAll({
    title: 'Terminal Tunnel',
    body: message || 'Claude is awaiting your input',
    tag: 'claude-stop'
  });
}

/**
 * Initialize the push notification system
 */
export function initializePushNotifications(): void {
  initializeVapidKeys();
  loadSubscriptions();
  console.log('[Push] Push notification system initialized');
}
