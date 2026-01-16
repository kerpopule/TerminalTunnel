import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Socket } from 'socket.io-client';
import { useMultiTerminalSocket } from './useSocket';
import { useTerminalScroll } from './useTerminalScroll';
import type { TerminalTheme } from '../themes';

import '@xterm/xterm/css/xterm.css';

// Check if we're in Tauri environment
const isTauri = (): boolean => {
  const win = window as any;
  return !!(win.__TAURI__ || win.__TAURI_INTERNALS__ || win.__TAURI_IPC__);
};

// Tauri shell plugin for opening external URLs in system browser
// Imported dynamically to avoid errors in non-Tauri environments
// Exported for use in other components (e.g., TerminalPane click handler)
export const openExternalUrl = async (url: string): Promise<void> => {
  try {
    if (isTauri()) {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
    } else {
      // Fallback for web version
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  } catch (error) {
    console.error('[Terminal] Failed to open external URL:', error);
    // Fallback to window.open
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

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
  isScrolledUp: boolean;
  scrollToBottom: () => void;
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
  const isOpenedRef = useRef(false);
  const generationRef = useRef(0); // Generation counter to invalidate stale handlers
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  // Track socket connection status to trigger effect re-run when socket connects
  const [socketConnected, setSocketConnected] = useState(socket?.connected ?? false);

  // Scroll state tracking for auto-scroll and scroll-to-bottom button
  const { isScrolledUp, scrollToBottom } = useTerminalScroll(terminal);

  // Store callbacks and sessionId in refs to prevent effect re-runs when they change
  const onSessionCreatedRef = useRef(onSessionCreated);
  const onLinkRef = useRef(onLink);
  const sessionIdRef = useRef(sessionId);

  // Sync refs immediately on every render (not just in effects) to avoid race conditions
  onLinkRef.current = onLink;
  onSessionCreatedRef.current = onSessionCreated;
  // Sync sessionId during render - but only if not yet connected (to preserve active session)
  if (!isConnected.current) {
    sessionIdRef.current = sessionId;
  }
  const writeTerminalRef = useRef<((terminalId: string, data: string) => void) | null>(null);
  const resizeTerminalRef = useRef<((terminalId: string, cols: number, rows: number) => void) | null>(null);

  // Store initial settings in refs - terminal init uses these, then update effect applies changes
  const themeRef = useRef(theme);
  const fontFamilyRef = useRef(fontFamily);
  const fontSizeRef = useRef(fontSize);

  const {
    createTerminal,
    destroyTerminal,
    writeTerminal,
    resizeTerminal,
    onTerminalData,
    onDimensionsChange,
  } = useMultiTerminalSocket(socket);

  // Track if we're applying server-sent dimensions (to avoid resize loops)
  const applyingServerDimensions = useRef(false);

  // Synchronization for live dimension changes during data writes
  // Prevents data being written at wrong dimensions when resize comes in
  const pendingData: string[] = [];
  let rafId: number | null = null;
  const isResizingRef = useRef(false);



  // Keep socket function refs updated - prevents unstable deps from causing effect re-runs
  useEffect(() => {
    writeTerminalRef.current = writeTerminal;
  }, [writeTerminal]);

  useEffect(() => {
    resizeTerminalRef.current = resizeTerminal;
  }, [resizeTerminal]);

  // Track which sessionId we're actually connected to (not just the prop)
  const connectedSessionIdRef = useRef<string | null>(null);

  // Effect to handle sessionId changes (reconnect to correct session when tabs:sync arrives)
  // This handles the race condition where mobile creates a terminal before receiving the sessionId from desktop
  useEffect(() => {
    debugLog(terminalId, `RECONNECT effect: sessionId=${sessionId}, connected=${isConnected.current}, connectedTo=${connectedSessionIdRef.current}, socket=${!!socket}, terminal=${!!terminal}`);

    // Skip if not connected yet, or if terminal not ready
    if (!isConnected.current || !socket || !terminal) {
      debugLog(terminalId, `RECONNECT effect: SKIPPING (not ready)`);
      return;
    }

    // If sessionId changed from what we're connected to, reconnect
    const connectedSessionId = connectedSessionIdRef.current;
    if (sessionId && sessionId !== connectedSessionId) {
      debugLog(terminalId, `RECONNECT effect: SessionId changed from ${connectedSessionId} to ${sessionId}, reconnecting...`);

      // Destroy current connection
      destroyTerminal(terminalId);
      activeTerminals.delete(terminalId);
      pendingTerminals.delete(terminalId);
      isConnected.current = false;
      connectedSessionIdRef.current = null;

      // Reconnect with the correct sessionId (use the prop, not the ref - ref is stale)
      pendingTerminals.add(terminalId);
      debugLog(terminalId, `RECONNECT effect: Calling createTerminal with sessionId=${sessionId}`);
      createTerminal(terminalId, terminal.cols || 80, terminal.rows || 24, sessionId);
      // Update the ref to track what we're now connecting to
      sessionIdRef.current = sessionId;
    } else {
      debugLog(terminalId, `RECONNECT effect: No change needed (sessionId=${sessionId}, connectedTo=${connectedSessionId})`);
    }
  }, [sessionId, terminalId, socket, terminal, destroyTerminal, createTerminal]);

  // Track socket connection status changes
  useEffect(() => {
    if (!socket) {
      setSocketConnected(false);
      return;
    }

    // Update immediately if socket is already connected
    if (socket.connected && !socketConnected) {
      debugLog(terminalId, 'Socket already connected, updating state');
      setSocketConnected(true);
    }

    const handleConnect = () => {
      debugLog(terminalId, 'Socket connected event received');
      setSocketConnected(true);
    };

    const handleDisconnect = () => {
      debugLog(terminalId, 'Socket disconnected event received');
      setSocketConnected(false);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, [socket, terminalId, socketConnected]);

  // Handle data from terminal (user input) - uses ref for stable callback
  const handleUserInput = useCallback((data: string) => {
    writeTerminalRef.current?.(terminalId, data);
  }, [terminalId]);

  // Handle resize - uses ref for stable callback
  // Skip sending resize when we're applying server-sent dimensions
  const handleResize = useCallback((cols: number, rows: number) => {
    if (applyingServerDimensions.current) {
      debugLog(terminalId, `handleResize SKIPPED (applying server dimensions): ${cols}x${rows}`);
      return;
    }
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
      convertEol: true,
      smoothScrollDuration: 100,  // Enable smooth scrolling animation for better mobile UX
    });

    // Load addons
    const fit = new FitAddon();
    fitAddon.current = fit;
    term.loadAddon(fit);

    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = '11';

    // WebLinksAddon - handles ALL URLs with visual link styling (underline, pointer cursor)
    // Routes localhost/private IPs to preview panel, external URLs to browser
    // Matches:
    // - Standard URLs: http:// or https://
    // - Localhost: localhost:port, 127.0.0.1:port, 0.0.0.0:port (with or without protocol)
    // - Private IPs: 192.168.x.x, 10.x.x.x, 172.16-31.x.x (RFC 1918)
    // Note: Don't use 'g' flag - WebLinksAddon adds it automatically
    const allUrlRegex = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d+)?(?:\/[^\s]*)?|https?:\/\/[\w\-\.]+(?::\d+)?(?:\/[^\s]*)?/i;

    const webLinks = new WebLinksAddon((event, url) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      // Normalize URL - add protocol if missing
      let normalizedUrl = url;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        normalizedUrl = 'http://' + url;
      }

      // Check if this is a localhost or private network URL
      const isLocalhost = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.\d|10\.\d|172\.(?:1[6-9]|2\d|3[01])\.)/i.test(url);

      if (isLocalhost) {
        // Localhost/private IP → open in preview panel
        console.log('[Terminal WebLinksAddon] Localhost URL clicked:', normalizedUrl);
        onLinkRef.current?.(normalizedUrl);
      } else {
        // External URL → open in system browser
        console.log('[Terminal WebLinksAddon] External URL clicked:', normalizedUrl);
        openExternalUrl(normalizedUrl);
      }
      return false;
    }, { urlRegex: allUrlRegex });
    term.loadAddon(webLinks);

    // Position-based link detection for mobile touch events (capture phase, before xterm.js)
    // Desktop click handling is done by React's handleContainerClick in TerminalPane.tsx
    // This provides reliable touch detection using xterm's buffer API
    let linkTouchListener: ((e: TouchEvent) => void) | null = null;
    let containerElement: HTMLElement | null = null;

    // Touch-based link detection for mobile (click is handled by React's handleContainerClick)
    const handleTerminalLinkClick = (e: MouseEvent | TouchEvent) => {
      console.log('[Terminal Click] handleTerminalLinkClick fired');
      const target = e.target as HTMLElement;

      // Don't intercept if user is selecting text
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) {
        console.log('[Terminal Click] Aborted: text selection active');
        return;
      }

      // Get terminal element
      const termElement = term.element;
      if (!termElement || !termElement.contains(target)) {
        console.log('[Terminal Click] Aborted: target not in terminal element');
        return;
      }

      // Find the xterm-screen element for accurate character positioning
      const screenElement = termElement.querySelector('.xterm-screen') as HTMLElement;
      const rect = screenElement ? screenElement.getBoundingClientRect() : termElement.getBoundingClientRect();

      const clientX = 'touches' in e ? e.changedTouches?.[0]?.clientX : e.clientX;
      const clientY = 'touches' in e ? e.changedTouches?.[0]?.clientY : e.clientY;

      if (clientX === undefined || clientY === undefined) {
        console.log('[Terminal Click] Aborted: no client coordinates');
        return;
      }
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        console.log('[Terminal Click] Aborted: click outside terminal bounds');
        return;
      }

      const x = clientX - rect.left;
      const y = clientY - rect.top;

      const cellWidth = rect.width / term.cols;
      const cellHeight = rect.height / term.rows;

      if (!cellWidth || !cellHeight || cellWidth <= 0 || cellHeight <= 0) return;

      const col = Math.floor(x / cellWidth);
      const row = Math.floor(y / cellHeight);

      // Get the line from buffer at clicked position
      const buffer = term.buffer.active;
      const lineIndex = buffer.viewportY + row;
      const line = buffer.getLine(lineIndex);

      if (!line) {
        console.log('[Terminal Click] Aborted: no line at row', row);
        return;
      }

      const lineText = line.translateToString();
      console.log('[Terminal Click] Line text at row', row, ':', lineText.substring(0, 100));

      // Find localhost and private network URLs in line
      const urlRegex = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):\d+(?:\/[^\s]*)?/gi;
      let match;
      let foundAnyMatch = false;

      while ((match = urlRegex.exec(lineText)) !== null) {
        foundAnyMatch = true;
        const startCol = match.index;
        const endCol = startCol + match[0].length;
        console.log('[Terminal Click] Found URL:', match[0], 'at cols', startCol, '-', endCol, ', clicked col:', col);

        // Check if click is within this URL
        if (col >= startCol && col < endCol) {
          e.preventDefault();
          e.stopPropagation();
          // Also stop immediate propagation to prevent other same-phase listeners from interfering
          if ('stopImmediatePropagation' in e) {
            (e as MouseEvent).stopImmediatePropagation();
          }

          let url = match[0];
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'http://' + url;
          }

          console.log('[Terminal Click] Click-based link detection:', url, 'onLinkRef exists:', !!onLinkRef.current);
          onLinkRef.current?.(url);
          return;
        }
      }

      if (!foundAnyMatch) {
        console.log('[Terminal Click] No localhost URLs found in line');
      } else {
        console.log('[Terminal Click] URLs found but click not on any of them');
      }
    };

    const openTerminal = () => {
      if (!containerRef.current) return;

      term.open(containerRef.current);
      
      // Mark terminal as opened - safe to call fit() after this
      isOpenedRef.current = true;

      // Mark terminal as opened - safe to call fit() after this
      isOpenedRef.current = true;

      // Attach touch-based link listener for mobile (click is handled by React's handleContainerClick)
      // Touch listener runs in capture phase for reliable mobile link detection
      containerElement = containerRef.current;
      linkTouchListener = handleTerminalLinkClick as (e: TouchEvent) => void;
      containerElement.addEventListener('touchend', linkTouchListener, true);

      debugLog(terminalId, 'Terminal opened with touch link listener attached');

      // Initial fit - delayed by one RAF to ensure renderer is ready
      requestAnimationFrame(() => {
        if (fit && isOpenedRef.current) {
          try {
            fit.fit();
          } catch (e) {
            console.warn('[useTerminalInstance] Initial fit failed:', e);
          }
        }
      });

      // Delayed fit for tunneled clients receiving history
      // Similar to ReplicaTerminal - gives time for data to render properly
      setTimeout(() => {
        try {
          fit.fit();
        } catch (e) {
          console.warn('[useTerminalInstance] Delayed fit failed:', e);
        }
      }, 500);

      // Handle user input
      term.onData(handleUserInput);

      terminalInstance.current = term;
      setTerminal(term);

      // Flush any buffered data with chunking to prevent rendering glitches
      // This is especially important for session restore when late-joining clients
      // receive a large burst of scrollback history
      if (dataBuffer.current.length > 0) {
        const INIT_CHUNK_SIZE = 2048; // 2KB chunks to prevent rendering artifacts
        const allBufferedData = dataBuffer.current.join('');
        dataBuffer.current = [];

        if (allBufferedData.length > INIT_CHUNK_SIZE) {
          // Write in chunks with RAF between each to allow rendering
          let offset = 0;
          const writeInitChunk = () => {
            if (offset < allBufferedData.length && term) {
              const chunk = allBufferedData.slice(offset, offset + INIT_CHUNK_SIZE);
              term.write(chunk);
              offset += INIT_CHUNK_SIZE;
              if (offset < allBufferedData.length) {
                requestAnimationFrame(writeInitChunk);
              } else {
                // Large buffer write complete - delayed fit for proper rendering
                setTimeout(() => {
                  try {
                    fitAddon.current?.fit();
                  } catch { /* ignore */ }
                }, 500);
              }
            }
          };
          writeInitChunk();
        } else {
          // Small amount of data - write directly
          term.write(allBufferedData);
        }
      }
    };

    requestAnimationFrame(openTerminal);

    return () => {
      debugLog(terminalId, 'INIT effect CLEANUP - disposing xterm');

      // Remove touch-based link listener (click is handled by React)
      if (containerElement && linkTouchListener) {
        containerElement.removeEventListener('touchend', linkTouchListener, true);
      }

      term.dispose();
      terminalInstance.current = null;
      isCreating.current = false;
      isOpenedRef.current = false;
    };
  // Note: handleUserInput uses refs internally so it's stable
  // Theme/font settings use refs - actual updates happen in separate effect
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount, terminalId]);

  // Connect to socket when terminal and socket are ready AND connected
  useEffect(() => {
    debugLog(terminalId, `SOCKET effect: terminal=${!!terminal}, socket=${!!socket}, socketConnected=${socketConnected}`);
    if (!terminal || !socket || !socketConnected) return;

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
      debugLog(terminalId, `handleCreated received: tid=${data.terminalId.slice(0,8)}, sessionId=${data.sessionId.slice(0,8)}, restored=${data.restored}, generation=${currentGeneration}/${generationRef.current}`);

      // Ignore if this handler is stale (from previous StrictMode invoke)
      if (currentGeneration !== generationRef.current) {
        debugLog(terminalId, `handleCreated SKIPPED: stale generation`);
        return;
      }

      if (data.terminalId === terminalId) {
        debugLog(terminalId, `handleCreated PROCESSING: setting connectedSessionIdRef to ${data.sessionId.slice(0,8)}, restored=${data.restored}`);
        activeTerminals.add(terminalId);
        pendingTerminals.delete(terminalId);
        isConnected.current = true;
        connectedSessionIdRef.current = data.sessionId;  // Track which session we're connected to
        // Always broadcast sessionId - this ensures stale client state gets corrected
        // When restoring, the sessionId from server is authoritative
        if (onSessionCreatedRef.current) {
          debugLog(terminalId, `handleCreated: Broadcasting sessionId ${data.sessionId.slice(0,8)} (restored=${data.restored})`);
          onSessionCreatedRef.current(data.sessionId);
        }

        // Request history now that we're ready and handlers are registered
        // This is a safeguard in case the automatic delayed history from server wasn't received
        // The server will only send if there's actual scrollback data
        socket.emit('terminal:request-history', { terminalId, sessionId: data.sessionId });
        debugLog(terminalId, `handleCreated: Requested history for sessionId ${data.sessionId.slice(0,8)}`);
      }
    };
    socket.on('terminal:created', handleCreated);

    // Set up data handler - with generation check to ignore stale handlers
    // Use requestAnimationFrame to batch writes and prevent rendering glitches
    // For large data (session restore), chunk writes to prevent horizontal line artifacts
    let pendingData: string[] = [];
    let rafId: number | null = null;
    let isChunkedWriteInProgress = false; // Prevent race conditions during chunked writes
    const CHUNK_SIZE = 2048; // 2KB chunks to prevent rendering artifacts

    const flushPendingData = () => {
      rafId = null;

      // Skip if chunked write is in progress - data will be flushed after
      if (isChunkedWriteInProgress) {
        return;
      }

      if (pendingData.length > 0 && terminalInstance.current) {
        // Join all pending data
        const allData = pendingData.join('');
        pendingData = [];

        // If data is large (session restore), write in chunks with RAF between each
        if (allData.length > CHUNK_SIZE) {
          isChunkedWriteInProgress = true;
          let offset = 0;
          const writeChunk = () => {
            if (offset < allData.length && terminalInstance.current) {
              const chunk = allData.slice(offset, offset + CHUNK_SIZE);
              terminalInstance.current.write(chunk);
              offset += CHUNK_SIZE;
              // Schedule next chunk
              if (offset < allData.length) {
                requestAnimationFrame(writeChunk);
              } else {
                // Chunked write complete - delayed fit for proper rendering
                isChunkedWriteInProgress = false;
                setTimeout(() => {
                  try {
                    fitAddon.current?.fit();
                  } catch { /* ignore */ }
                }, 500);
                // Also flush any data that arrived during the write
                if (pendingData.length > 0) {
                  rafId = requestAnimationFrame(flushPendingData);
                }
              }
            } else {
              isChunkedWriteInProgress = false;
            }
          };
          writeChunk();
        } else {
          // Small data - write all at once
          terminalInstance.current.write(allData);
        }
      }
    };

    // CRITICAL: Register dimension handler FIRST, before data handler
    // This ensures buffered dimensions from terminal:history are applied before data is written
    // When onTerminalData flushes the buffer, it checks for __dims and calls this handler
    const dimensionCleanup = onDimensionsChange(terminalId, (cols, rows) => {
      // Ignore if this handler is stale (from previous StrictMode invoke)
      if (currentGeneration !== generationRef.current) return;
      if (!terminalInstance.current) return;

      debugLog(terminalId, `Applying server dimensions: ${cols}x${rows}, current: ${terminalInstance.current.cols}x${terminalInstance.current.rows}`);

      // Only resize if dimensions actually differ
      if (terminalInstance.current.cols !== cols || terminalInstance.current.rows !== rows) {
        // Set flag to prevent sending resize back to server
        applyingServerDimensions.current = true;

        // CRITICAL: Mark resize in progress - data handler will queue data during this time
        // This prevents data being written at wrong dimensions
        isResizingRef.current = true;

        // Resize xterm to match server's effective dimensions
        terminalInstance.current.resize(cols, rows);

        // Use double RAF to ensure resize is fully rendered before writing any pending data
        // First RAF queues after current frame, second RAF queues after resize paint
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            applyingServerDimensions.current = false;
            isResizingRef.current = false;

            // Flush any data that was queued during resize
            if (pendingData.length > 0 && rafId === null) {
              rafId = requestAnimationFrame(flushPendingData);
            }
          });
        });
      }
    });

  // Handle terminal data - URL detection removed (click-based handling only)
  // NOTE: This must come AFTER dimension handler registration above
  const dataCleanup = onTerminalData(terminalId, (data) => {
      // Ignore if this handler is stale (from previous StrictMode invoke)
      if (currentGeneration !== generationRef.current) return;

      if (terminalInstance.current) {
        // Buffer data and schedule a batched write
        pendingData.push(data);

        // CRITICAL: If resize is in progress, just queue the data - don't schedule write yet
        // The dimension handler will flush after resize is complete
        // This prevents data being written at wrong dimensions during resize
        if (isResizingRef.current) {
          debugLog(terminalId, `Data queued during resize: ${data.length} bytes`);
          return;
        }

        if (rafId === null) {
          rafId = requestAnimationFrame(flushPendingData);
        }
      } else {
        dataBuffer.current.push(data);
      }
    });

    // Create terminal on server
    // ALWAYS call createTerminal if we don't have an established session yet
    // This ensures first terminal works the same as subsequent ones
    // Server handles duplicate creates gracefully by reusing existing sessions
    const hasEstablishedSession = isConnected.current && connectedSessionIdRef.current;

    if (shouldCreate || !hasEstablishedSession) {
      if (!shouldCreate) {
        debugLog(terminalId, `Forcing createTerminal - no established session yet`);
      }
      pendingTerminals.add(terminalId);
      debugLog(terminalId, `Creating terminal with sessionId=${sessionIdRef.current || 'null (new session)'}`);
      createTerminal(terminalId, cols, rows, sessionIdRef.current);
    } else {
      // Terminal already exists with established session - just request history refresh
      debugLog(terminalId, `Session established, requesting history refresh`);
      socket.emit('terminal:request-history', { terminalId, sessionId: connectedSessionIdRef.current || undefined });
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

      dimensionCleanup();
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
  }, [terminal, socket, socketConnected, terminalId, createTerminal, destroyTerminal, onTerminalData, onDimensionsChange]);

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

  // NOTE: Dimension changes from server are now handled in the main socket effect above
  // This ensures the dimension handler is registered BEFORE the data handler,
  // which is critical for synced terminals to render correctly.

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
    if (!fitAddon.current || !isOpenedRef.current) {
      console.warn('[useTerminalInstance] fit() called but terminal not ready');
      return;
    }
    try {
      fitAddon.current.fit();
    } catch (e) {
      console.warn('[useTerminalInstance] fit() failed:', e);
    }
  }, []);

  return {
    containerRef: containerRef as React.RefObject<HTMLDivElement>,
    terminal,
    write,
    focus,
    fit,
    isScrolledUp,
    scrollToBottom,
  };
}
