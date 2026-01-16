import { useState, useEffect, useMemo } from 'react';
import { checkIsTauri } from './useDesktopApp';

const DESKTOP_BREAKPOINT = 768;

interface WebDesktopModeState {
  isWebDesktopMode: boolean;
  isLargeScreen: boolean;
  isTunnelAccess: boolean;
}

export function useWebDesktopMode(): WebDesktopModeState {
  const [isLargeScreen, setIsLargeScreen] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth >= DESKTOP_BREAKPOINT
  );

  const isTauri = checkIsTauri();

  // Check if accessing via tunnel (not localhost)
  const isTunnelAccess = useMemo(() => {
    if (isTauri) return false;
    if (typeof window === 'undefined') return false;
    const hostname = window.location.hostname;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    return !isLocal;
  }, [isTauri]);

  useEffect(() => {
    const handleResize = () => {
      setIsLargeScreen(window.innerWidth >= DESKTOP_BREAKPOINT);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Web desktop mode is when we're not in Tauri but on a large screen
  const isWebDesktopMode = !isTauri && isLargeScreen;

  return { isWebDesktopMode, isLargeScreen, isTunnelAccess };
}
