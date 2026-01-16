import { checkIsTauri } from '../hooks/useDesktopApp';

/**
 * Detect if device has touch capability
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/**
 * Detect if device likely has a physical keyboard as primary input
 *
 * Logic:
 * - Desktop (Tauri app) without touch = physical keyboard
 * - Web browser without touch capability = physical keyboard
 * - Touch device (iPad, tablet, mobile) = no physical keyboard (or not primary)
 *
 * Result:
 * - Desktop (Tauri, no touch) → true (has physical keyboard)
 * - iPad Safari (web, touch) → false (touch is primary input)
 * - Mobile (web, touch) → false (touch is primary input)
 */
export function hasPhysicalKeyboard(): boolean {
  const isTauri = checkIsTauri();
  const hasTouch = isTouchDevice();

  // Tauri desktop app with no touch = physical keyboard
  if (isTauri && !hasTouch) return true;

  // Web with no touch (rare, but possible) = physical keyboard
  if (!hasTouch) return true;

  // Touch device = likely no physical keyboard (or not primary input)
  return false;
}

/**
 * Get the default value for showKeybar based on device type
 *
 * - Physical keyboard devices (desktop) → false (don't need keybar)
 * - Touch devices (iPad, tablet, mobile) → true (need keybar for special keys)
 */
export function getDefaultShowKeybar(): boolean {
  return !hasPhysicalKeyboard();
}
