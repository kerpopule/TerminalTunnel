// All localStorage keys used by the app.
const APP_STATE_KEYS = [
  'mobile_terminal_settings',
  'mobile_terminal_split_state',
  'mobile_terminal_tab_sessions',
  'mobile_terminal_dashboard_tabs',
  'mobile_terminal_dashboard',
  'mobile_terminal_dashboard_user_disabled',
  'mobile_terminal_active_tab',
  'mobile_terminal_has_local_theme',
  'mobile_terminal_favorites',
  'mobile_terminal_view_mode',
  'mobile_terminal_custom_button',
  'terminal-tunnel-notification-onboarding-seen',
];

const PERSISTED_KEYS = new Set([
  'onboarding_complete',
  'mobile_terminal_favorites',
]);

export async function clearAppState(): Promise<void> {
  // Clear client-side localStorage
  APP_STATE_KEYS.forEach(key => localStorage.removeItem(key));

  // Also clear server-side tab state to prevent client-server mismatch
  // This ensures fresh tabs are created that match between client and server
  try {
    await fetch('/api/tabs/reset', { method: 'POST' });
  } catch (e) {
    console.error('Failed to reset server tabs:', e);
    // Continue anyway - worst case tabs will be out of sync but app will work
  }
}

export async function clearAppStateExceptPersistent(): Promise<void> {
  const keys = Object.keys(localStorage);
  keys.forEach((key) => {
    if (!PERSISTED_KEYS.has(key)) {
      localStorage.removeItem(key);
    }
  });

  try {
    await fetch('/api/tabs/reset', { method: 'POST' });
  } catch (e) {
    console.error('Failed to reset server tabs:', e);
  }
}
