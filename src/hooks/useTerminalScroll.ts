import { useState, useCallback, useEffect } from 'react';
import type { Terminal } from '@xterm/xterm';

interface UseTerminalScrollReturn {
  isScrolledUp: boolean;
  scrollToBottom: () => void;
}

/**
 * Hook to track terminal scroll position and provide scroll-to-bottom functionality.
 *
 * - Detects when user scrolls up from bottom
 * - Provides function to scroll back to bottom
 * - Auto-scroll continues when at bottom, pauses when user scrolls up
 */
export function useTerminalScroll(terminal: Terminal | null): UseTerminalScrollReturn {
  const [isScrolledUp, setIsScrolledUp] = useState(false);

  // Check if viewport is at the bottom of the scrollback buffer
  const checkIsAtBottom = useCallback(() => {
    if (!terminal) return true;

    const buffer = terminal.buffer.active;
    const baseY = buffer.baseY; // Scroll offset (lines scrolled from top)
    const rows = terminal.rows; // Visible rows in viewport
    const totalLines = buffer.length; // Total lines in buffer

    // Allow 2-line tolerance for edge cases (floating point, cursor position)
    return (baseY + rows) >= (totalLines - 2);
  }, [terminal]);

  // Subscribe to scroll events to track scroll position
  useEffect(() => {
    if (!terminal) return;

    const disposable = terminal.onScroll(() => {
      const atBottom = checkIsAtBottom();
      setIsScrolledUp(!atBottom);
    });

    return () => disposable.dispose();
  }, [terminal, checkIsAtBottom]);

  // Recheck position when terminal size changes (rows can change on resize)
  useEffect(() => {
    if (!terminal) return;

    const disposable = terminal.onResize(() => {
      // After resize, check if we're still at bottom
      const atBottom = checkIsAtBottom();
      setIsScrolledUp(!atBottom);
    });

    return () => disposable.dispose();
  }, [terminal, checkIsAtBottom]);

  // Scroll to bottom and reset state
  const scrollToBottom = useCallback(() => {
    if (!terminal) return;
    terminal.scrollToBottom();
    setIsScrolledUp(false);
  }, [terminal]);

  return { isScrolledUp, scrollToBottom };
}
