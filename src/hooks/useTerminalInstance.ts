import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Socket } from 'socket.io-client';
import { useMultiTerminalSocket } from './useSocket';
import type { TerminalTheme } from '../themes';
import '@xterm/xterm/css/xterm.css';

// Module-level tracking to handle React StrictMode double-invoke
// These persist across unmount/remount cycles within the same page load
const activeTerminals = new Set<string>();
const pendingTerminals = new Set<string>();

// Debug logging for terminal lifecycle
const DEBUG = true;
function debugLog(terminalId: string, message: string) {
  if (DEBUG) {
    console.log(`[Terminal ${terminalId.slice(0, 8)}] ${message}`);
  }
}

interface UseTerminalInstanceOptions {
  terminalId: string;
  socket: Socket | null;
  sessionId?: string | null;  // For restoring existing sessions
  onLink?: (url: string) => void;
  onSessionCreated?: (sessionId: string) => void;
  theme?: TerminalTheme;
  fontFamily?: string;
  fontSize?: number;
  isVisible?: boolean;
}

interface UseTerminalInstanceReturn {
  containerRef: React.RefObject<HTMLDivElement>;
  terminal: Terminal | null;
  write: (data: string) => void;
  focus: () => void;
  fit: () => void;
}

export function useTerminalInstance(options: UseTerminalInstanceOptions): UseTerminalInstanceReturn {
  const {
    terminalId,
    socket,
    sessionId,
    onLink,
    onSessionCreated,
    theme,
    fontFamily,
    fontSize,
    isVisible = true,
  } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const dataBuffer = useRef<string[]>([]);
  const isCreating = useRef(false);
  const isConnected = useRef(false);
  const generationRef = useRef(0); // Generation counter to invalidate stale handlers
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Store callbacks and sessionId in refs to prevent effect re-runs when they change
  const onSessionCreatedRef = useRef(onSessionCreated);
  const onLinkRef = useRef(onLink);
  const sessionIdRef = useRef(sessionId);

  // Sync refs immediately on every render (not just in effects) to avoid race conditions
  onLinkRef.current = onLink;
  onSessionCreatedRef.current = onSessionCreated;
  const writeTerminalRef = useRef<((terminalId: string, data: string) => void) | null>(null);
  const resizeTerminalRef = useRef<((terminalId: string, cols: number, rows: number) => void) | null>(null);

  // Store initial settings in refs - terminal init uses these, then update effect applies changes
  const themeRef = useRef(theme);
  const fontFamilyRef = useRef(fontFamily);
  const fontSizeRef = useRef(fontSize);

  // Only update sessionId ref if we're not connected (for initial restore)
  useEffect(() => {
    if (!isConnected.current) {
      sessionIdRef.current = sessionId;
    }
  }, [sessionId]);

  const {
    createTerminal,
    destroyTerminal,
    writeTerminal,
    resizeTerminal,
    onTerminalData,
  } = useMultiTerminalSocket(socket);

  // Keep socket function refs updated - prevents unstable deps from causing effect re-runs
  useEffect(() => {
    writeTerminalRef.current = writeTerminal;
  }, [writeTerminal]);

  useEffect(() => {
    resizeTerminalRef.current = resizeTerminal;
  }, [resizeTerminal]);

  // Handle data from terminal (user input) - uses ref for stable callback
  const handleUserInput = useCallback((data: string) => {
    writeTerminalRef.current?.(terminalId, data);
  }, [terminalId]);

  // Handle resize - uses ref for stable callback
  const handleResize = useCallback((cols: number, rows: number) => {
    resizeTerminalRef.current?.(terminalId, cols, rows);
  }, [terminalId]);

  // Initialize terminal
  useEffect(() => {
    debugLog(terminalId, `INIT effect: instance=${!!terminalInstance.current}, creating=${isCreating.current}, retryCount=${retryCount}`);
    if (terminalInstance.current || isCreating.current) return;

    if (!containerRef.current) {
      if (retryCount < 10) {
        const timer = setTimeout(() => setRetryCount(c => c + 1), 50);
        return () => clearTimeout(timer);
      }
      console.error(`Terminal ${terminalId}: container ref never became available`);
      return;
    }

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
      fontSize: fontSizeRef.current || 14,
      fontFamily: fontFamilyRef.current || '"SF Mono", "Menlo", "Monaco", "Consolas", monospace',
      fontWeight: '400',
      fontWeightBold: '600',
      lineHeight: 1.2,
      letterSpacing: 0,
      theme: themeRef.current || defaultTerminalTheme,
      allowProposedApi: true,
      scrollback: 500,  // Reduced for split mode
      convertEol: true
    });

    // Load addons
    const fit = new FitAddon();
    fitAddon.current = fit;
    term.loadAddon(fit);

    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = '11';

    // Custom regex that matches:
    // 1. Standard URLs with http:// or https://
    // 2. localhost:port without http://
    // 3. 127.0.0.1:port without http://
    // 4. 0.0.0.0:port without http://
    // Note: Don't use 'g' flag - WebLinksAddon adds it automatically
    const urlRegex = /(?:https?:\/\/[\w\-\.]+(?::\d+)?(?:\/[^\s]*)?|(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+(?:\/[^\s]*)?)/i;

    const webLinks = new WebLinksAddon((event, url) => {
      // Prevent ALL default handling - critical for mobile
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) {
        event.stopImmediatePropagation();
      }

      console.log('[Terminal] Link clicked:', url, 'onLink available:', !!onLinkRef.current);

      // Normalize URL - add http:// if missing for localhost URLs
      let normalizedUrl = url;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        if (url.match(/^(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/)) {
          normalizedUrl = `http://${url}`;
          console.log('[Terminal] Normalized URL:', normalizedUrl);
        }
      }

      // Check if this is a localhost/local URL that should go through the preview tunnel
      const isLocalUrl = normalizedUrl.includes('localhost') ||
                         normalizedUrl.includes('127.0.0.1') ||
                         normalizedUrl.includes('0.0.0.0') ||
                         normalizedUrl.match(/:\d{4,5}/) !== null; // Any URL with a port number

      if (isLocalUrl) {
        // Always route local URLs through the preview handler
        // NEVER open localhost in a new tab - it won't work remotely
        if (onLinkRef.current) {
          console.log('[Terminal] Routing to preview handler');
          onLinkRef.current(normalizedUrl);
        } else {
          console.warn('[Terminal] Preview handler not available, link ignored');
          // Do nothing - don't open in new tab as it won't work remotely
        }
      } else {
        // Only external URLs (non-localhost) can open in new tab
        console.log('[Terminal] Opening external URL in new tab');
        window.open(normalizedUrl, '_blank', 'noopener,noreferrer');
      }

      // Return false to prevent any remaining default handling
      return false;
    }, { urlRegex });
    term.loadAddon(webLinks);

    const openTerminal = () => {
      if (!containerRef.current) return;

      term.open(containerRef.current);

      requestAnimationFrame(() => {
        fit.fit();
      });

      // Handle user input
      term.onData(handleUserInput);

      terminalInstance.current = term;
      setTerminal(term);

      // Flush any buffered data
      if (dataBuffer.current.length > 0) {
        dataBuffer.current.forEach(data => term.write(data));
        dataBuffer.current = [];
      }
    };

    requestAnimationFrame(openTerminal);

    return () => {
      debugLog(terminalId, 'INIT effect CLEANUP - disposing xterm');
      term.dispose();
      terminalInstance.current = null;
      isCreating.current = false;
    };
  // Note: handleUserInput uses refs internally so it's stable
  // Theme/font settings use refs - actual updates happen in separate effect
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount, terminalId]);

  // Connect to socket when terminal and socket are ready
  useEffect(() => {
    debugLog(terminalId, `SOCKET effect: terminal=${!!terminal}, socket=${!!socket}`);
    if (!terminal || !socket) return;

    // Generation counter: prevents stale handlers from executing after cleanup
    const currentGeneration = ++generationRef.current;
    debugLog(terminalId, `SOCKET effect active, generation=${currentGeneration}`);

    // Timestamp guard: prevents destroying terminal during StrictMode's immediate cleanup
    const creationTime = Date.now();

    const cols = terminal.cols || 80;
    const rows = terminal.rows || 24;

    // Check if we should create (not already pending/active from previous invoke)
    const shouldCreate = !activeTerminals.has(terminalId) && !pendingTerminals.has(terminalId);

    if (shouldCreate) {
      pendingTerminals.add(terminalId);
    }

    // Listen for session created - with generation check to ignore stale handlers
    const handleCreated = (data: { terminalId: string; sessionId: string; restored: boolean }) => {
      // Ignore if this handler is stale (from previous StrictMode invoke)
      if (currentGeneration !== generationRef.current) return;

      if (data.terminalId === terminalId) {
        activeTerminals.add(terminalId);
        pendingTerminals.delete(terminalId);
        isConnected.current = true;
        if (onSessionCreatedRef.current) {
          onSessionCreatedRef.current(data.sessionId);
        }
      }
    };
    socket.on('terminal:created', handleCreated);

    // Set up data handler - with generation check to ignore stale handlers
    // Use requestAnimationFrame to batch writes and prevent rendering glitches
    let pendingData: string[] = [];
    let rafId: number | null = null;

    const flushPendingData = () => {
      rafId = null;
      if (pendingData.length > 0 && terminalInstance.current) {
        // Join all pending data and write in one batch
        terminalInstance.current.write(pendingData.join(''));
        pendingData = [];
      }
    };

    const dataCleanup = onTerminalData(terminalId, (data) => {
      // Ignore if this handler is stale (from previous StrictMode invoke)
      if (currentGeneration !== generationRef.current) return;

      if (terminalInstance.current) {
        // Buffer data and schedule a batched write
        pendingData.push(data);
        if (rafId === null) {
          rafId = requestAnimationFrame(flushPendingData);
        }
      } else {
        dataBuffer.current.push(data);
      }
    });

    // Create terminal on server if not already created/pending
    if (shouldCreate) {
      createTerminal(terminalId, cols, rows, sessionIdRef.current);
    }

    return () => {
      const timeSinceCreation = Date.now() - creationTime;
      debugLog(terminalId, `SOCKET effect CLEANUP: active=${activeTerminals.has(terminalId)}, timeSince=${timeSinceCreation}ms`);

      // Cancel any pending render
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      pendingData = [];

      dataCleanup();
      socket.off('terminal:created', handleCreated);

      // Only destroy if terminal is active and enough time has passed
      // (prevents destroying during StrictMode's immediate cleanup)
      if (activeTerminals.has(terminalId) && timeSinceCreation >= 100) {
        debugLog(terminalId, 'DESTROYING terminal on server');
        activeTerminals.delete(terminalId);
        pendingTerminals.delete(terminalId);
        destroyTerminal(terminalId);
        isConnected.current = false;
      }
    };
  }, [terminal, socket, terminalId, createTerminal, destroyTerminal, onTerminalData]);

  // Send resize when terminal dimensions change
  useEffect(() => {
    if (!terminal || !isConnected.current) return;

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      handleResize(cols, rows);
    });

    return () => {
      resizeDisposable.dispose();
    };
  }, [terminal, handleResize]);

  // Refit when becoming visible
  useEffect(() => {
    if (isVisible && terminal && fitAddon.current) {
      requestAnimationFrame(() => {
        fitAddon.current?.fit();
      });
    }
  }, [isVisible, terminal]);

  // Update terminal settings when they change
  useEffect(() => {
    if (!terminalInstance.current) return;

    const term = terminalInstance.current;

    if (theme) {
      term.options.theme = theme;
    }

    if (fontFamily) {
      term.options.fontFamily = fontFamily;
    }

    if (fontSize) {
      term.options.fontSize = fontSize;
    }

    fitAddon.current?.fit();
  }, [theme, fontFamily, fontSize]);

  const write = useCallback((data: string) => {
    if (terminalInstance.current) {
      terminalInstance.current.write(data);
    } else {
      dataBuffer.current.push(data);
    }
  }, []);

  const focus = useCallback(() => {
    terminalInstance.current?.focus();
  }, []);

  const fit = useCallback(() => {
    fitAddon.current?.fit();
  }, []);

  return {
    containerRef: containerRef as React.RefObject<HTMLDivElement>,
    terminal,
    write,
    focus,
    fit,
  };
}
