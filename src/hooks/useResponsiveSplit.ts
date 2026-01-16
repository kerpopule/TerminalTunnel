import { useState, useEffect } from 'react';
import type { SplitDirection } from '../types/terminal';

const DESKTOP_BREAKPOINT = 768;

/**
 * Hook to detect mobile vs desktop and return appropriate split direction
 * Mobile (< 768px): 'vertical' (top/bottom split)
 * Desktop (>= 768px): 'horizontal' (left/right split)
 */
export function useResponsiveSplit(): SplitDirection {
  const [direction, setDirection] = useState<SplitDirection>(() => {
    if (typeof window === 'undefined') return 'vertical';
    return window.innerWidth >= DESKTOP_BREAKPOINT ? 'horizontal' : 'vertical';
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);

    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setDirection(e.matches ? 'horizontal' : 'vertical');
    };

    // Set initial value
    handleChange(mediaQuery);

    // Listen for changes
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    } else {
      // Fallback for older browsers
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, []);

  return direction;
}
