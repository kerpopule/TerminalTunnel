import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import type { TerminalTheme } from '../themes';

interface UseTerminalOptions {
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onLink?: (url: string) => void;
  theme?: TerminalTheme;
  fontFamily?: string;
  fontSize?: number;
}

interface UseTerminalReturn {
  terminalRef: React.RefObject<HTMLDivElement>;
  terminal: Terminal | null;
  write: (data: string) => void;
  focus: () => void;
  fit: () => void;
}

export function useTerminal(options: UseTerminalOptions = {}): UseTerminalReturn {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const dataBuffer = useRef<string[]>([]);
  const isCreating = useRef(false);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Initialize terminal - retry if ref not ready
  useEffect(() => {
    // Already created or in progress
    if (terminalInstance.current || isCreating.current) return;

    if (!terminalRef.current) {
      // Ref not ready, retry after a short delay
      if (retryCount < 10) {
        const timer = setTimeout(() => setRetryCount(c => c + 1), 50);
        return () => clearTimeout(timer);
      }
      console.error('Terminal ref never became available');
      return;
    }

    // Mark as creating to prevent duplicate creation
    isCreating.current = true;

    // Default theme (midnight)
    const defaultTerminalTheme = {
      background: '#0f0f1a',
      foreground: '#e4e4e7',
      cursor: '#4f46e5',
      cursorAccent: '#0f0f1a',
      selectionBackground: 'rgba(79, 70, 229, 0.3)',
      black: '#27272a',
      red: '#ef4444',
      green: '#22c55e',
      yellow: '#f59e0b',
      blue: '#3b82f6',
      magenta: '#a855f7',
      cyan: '#06b6d4',
      white: '#e4e4e7',
      brightBlack: '#52525b',
      brightRed: '#f87171',
      brightGreen: '#4ade80',
      brightYellow: '#fbbf24',
      brightBlue: '#60a5fa',
      brightMagenta: '#c084fc',
      brightCyan: '#22d3ee',
      brightWhite: '#fafafa'
    };

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: options.fontSize || 14,
      fontFamily: options.fontFamily || '"SF Mono", "Menlo", "Monaco", "Consolas", monospace',
      fontWeight: '400',
      fontWeightBold: '600',
      lineHeight: 1.2,
      letterSpacing: 0,
      theme: options.theme || defaultTerminalTheme,
      allowProposedApi: true,
      scrollback: 10000,
      convertEol: true
    });

    // Load addons
    const fit = new FitAddon();
    fitAddon.current = fit;
    term.loadAddon(fit);

    // Unicode support
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = '11';

    // Custom regex that matches localhost URLs with or without http://
    // Note: Don't use 'g' flag - WebLinksAddon adds it automatically
    const urlRegex = /(?:https?:\/\/[\w\-\.]+(?::\d+)?(?:\/[^\s]*)?|(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+(?:\/[^\s]*)?)/i;

    // Web links with custom handler for localhost URLs
    // Use willLinkActivate to control link behavior and prevent default navigation
    const webLinks = new WebLinksAddon((event, url) => {
      // Prevent default anchor behavior - critical for mobile
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      console.log('[Terminal] Link clicked:', url);

      // Normalize URL - add http:// if missing for localhost URLs
      let normalizedUrl = url;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        if (url.match(/^(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/)) {
          normalizedUrl = `http://${url}`;
        }
      }

      // Check if this is a local URL that should go through the preview tunnel
      const isLocalUrl = normalizedUrl.includes('localhost') ||
                         normalizedUrl.includes('127.0.0.1') ||
                         normalizedUrl.includes('0.0.0.0') ||
                         normalizedUrl.match(/:\d{4,5}/) !== null;

      if (isLocalUrl) {
        // Route local URLs through the preview handler if available
        // NEVER open localhost in a new tab - it won't work remotely
        console.log('[Terminal] Routing local URL to preview handler');
        if (options.onLink) {
          options.onLink(normalizedUrl);
        } else {
          console.warn('[Terminal] No onLink handler provided for local URL');
        }
        // If no handler, do nothing - don't open in new tab
      } else {
        // Only external URLs can open in new tab
        console.log('[Terminal] Opening external URL in new tab');
        window.open(normalizedUrl, '_blank', 'noopener,noreferrer');
      }

      // Return false to ensure link doesn't navigate
      return false;
    }, { urlRegex });
    term.loadAddon(webLinks);

    // Handle resize
    const handleResize = () => {
      if (fit) {
        fit.fit();
        options.onResize?.(term.cols, term.rows);
      }
    };

    // Open terminal in container after DOM has dimensions
    // Use requestAnimationFrame to ensure container is measured
    const openTerminal = () => {
      if (!terminalRef.current) return;

      term.open(terminalRef.current);

      // Fit to container
      requestAnimationFrame(() => {
        fit.fit();
        options.onResize?.(term.cols, term.rows);
      });

      // Handle data from terminal (user input)
      term.onData((data) => {
        options.onData?.(data);
      });

      window.addEventListener('resize', handleResize);

      terminalInstance.current = term;
      setTerminal(term);

      // Flush any buffered data
      if (dataBuffer.current.length > 0) {
        dataBuffer.current.forEach(data => term.write(data));
        dataBuffer.current = [];
      }
    };

    // Wait for next frame to ensure container has dimensions
    requestAnimationFrame(openTerminal);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
      terminalInstance.current = null;
      isCreating.current = false;
    };
  }, [retryCount]);

  // Update terminal settings when they change
  useEffect(() => {
    if (!terminalInstance.current) return;

    const term = terminalInstance.current;

    if (options.theme) {
      term.options.theme = options.theme;
    }

    if (options.fontFamily) {
      term.options.fontFamily = options.fontFamily;
    }

    if (options.fontSize) {
      term.options.fontSize = options.fontSize;
    }

    // Re-fit terminal after font changes
    fitAddon.current?.fit();
  }, [options.theme, options.fontFamily, options.fontSize]);

  // Write data to terminal (buffers if terminal not ready)
  const write = useCallback((data: string) => {
    if (terminalInstance.current) {
      terminalInstance.current.write(data);
    } else {
      // Buffer data until terminal is ready
      dataBuffer.current.push(data);
    }
  }, []);

  // Focus terminal
  const focus = useCallback(() => {
    terminalInstance.current?.focus();
  }, []);

  // Fit terminal to container
  const fit = useCallback(() => {
    fitAddon.current?.fit();
  }, []);

  return {
    terminalRef: terminalRef as React.RefObject<HTMLDivElement>,
    terminal,
    write,
    focus,
    fit
  };
}
