import { useState, useEffect } from 'react';

// Check for Tauri runtime - supports both Tauri 1.x and 2.x
// Exported for synchronous use in settings defaults
export function checkIsTauri(): boolean {
  if (typeof window === 'undefined') return false;

  const win = window as any;

  // Tauri 2.x detection
  if (win.__TAURI_INTERNALS__ || win.__TAURI_IPC__) {
    return true;
  }

  // Tauri 1.x detection
  if (win.__TAURI__) {
    return true;
  }

  // Check for Tauri invoke function
  if (typeof win.__TAURI_INTERNALS__?.invoke === 'function') {
    return true;
  }

  return false;
}

// Set window background color in Tauri
// This affects the title bar area to match the app theme
export async function setTauriWindowBackground(color: string): Promise<void> {
  if (!checkIsTauri()) return;

  try {
    // Dynamic import for Tauri window API
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();

    // Convert hex to RGB array [r, g, b, a]
    const hex = color.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Set window background color (available in Tauri 2.x)
    // This affects the window chrome/title bar area
    await win.setBackgroundColor([r, g, b, 255]);
  } catch (e) {
    // Silently fail if API not available
    console.debug('[useDesktopApp] Failed to set window background:', e);
  }
}

interface DesktopAppState {
  isDesktopApp: boolean;
  platform: 'tauri' | 'web';
}

export function useDesktopApp(): DesktopAppState {
  // Initialize with synchronous check to avoid flicker
  const [state, setState] = useState<DesktopAppState>(() => {
    const isTauri = checkIsTauri();
    return {
      isDesktopApp: isTauri,
      platform: isTauri ? 'tauri' : 'web',
    };
  });

  useEffect(() => {
    // Re-check immediately after mount
    const checkAndUpdate = () => {
      const isTauri = checkIsTauri();
      if (isTauri !== state.isDesktopApp) {
        console.log('[useDesktopApp] Tauri detected:', isTauri);
        setState({
          isDesktopApp: isTauri,
          platform: isTauri ? 'tauri' : 'web',
        });
      }
    };

    // Check immediately
    checkAndUpdate();

    // Also check after a short delay in case Tauri injects globals async
    const timer = setTimeout(checkAndUpdate, 100);

    // And check again after a longer delay for slow initialization
    const timer2 = setTimeout(checkAndUpdate, 500);

    return () => {
      clearTimeout(timer);
      clearTimeout(timer2);
    };
  }, []);

  return state;
}
