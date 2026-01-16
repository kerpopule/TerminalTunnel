import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { useTerminalTabs } from '../contexts/TerminalTabsContext';
import { useSettings } from '../contexts/SettingsContext';

interface ReplicaTerminalProps {
  sessionId: string;
  onLink?: (url: string) => void;
}

/**
 * ReplicaTerminal - A terminal that syncs with an existing session via room sync.
 *
 * This component:
 * 1. Creates an xterm instance
 * 2. Joins the session's room via terminal:replica event
 * 3. Receives scrollback history and live data
 * 4. Supports bidirectional input sync
 * 5. Uses FitAddon to fit terminal to its own container (native sizing, no CSS scaling)
 */
const ReplicaTerminal: React.FC<ReplicaTerminalProps> = ({ sessionId, onLink }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Buffering for tunneled connections - coalesces incoming data to prevent
  // ANSI escape sequence fragmentation over high-latency connections
  const TUNNEL_BUFFER_DELAY_MS = 50;
  const MAX_BUFFER_SIZE = 64 * 1024;
  const bufferRef = useRef<string>('');
  const bufferTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { socket } = useTerminalTabs();
  const { theme, fontFamily } = useSettings();

  // Helper function to detect incomplete ANSI escape sequences
  const hasIncompleteEscapeSequence = useCallback((data: string): boolean => {
    const lastEscIndex = data.lastIndexOf('\x1b');
    if (lastEscIndex === -1) return false;

    const remaining = data.slice(lastEscIndex);
    if (remaining.match(/^\x1b\[[\d;]*$/)) return true;
    if (remaining.match(/^\x1b\][^\x07]*$/) && !remaining.endsWith('\x1b\\')) return true;
    if (remaining.match(/^\x1bP[^\x1b]*$/)) return true;
    if (remaining === '\x1b') return true;
    if (remaining.length === 1) return true;

    return false;
  }, []);

  // Flush buffered data to terminal
  const WRITE_CHUNK_SIZE = 2048;

  const flushBuffer = useCallback(() => {
    if (!bufferRef.current || !terminalRef.current) return;

    const data = bufferRef.current;
    bufferRef.current = '';

    if (data.length > WRITE_CHUNK_SIZE) {
      let offset = 0;
      const writeChunk = () => {
        if (offset < data.length && terminalRef.current) {
          const chunk = data.slice(offset, offset + WRITE_CHUNK_SIZE);
          terminalRef.current.write(chunk);
          offset += WRITE_CHUNK_SIZE;
          if (offset < data.length) {
            requestAnimationFrame(writeChunk);
          }
        }
      };
      writeChunk();
    } else {
      terminalRef.current.write(data);
    }
  }, []);

  // Initialize terminal and connect to session
  useEffect(() => {
    if (!containerRef.current || !socket) return;

    setIsReady(false);

    let cancelled = false;
    let term: Terminal | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const initDelay = setTimeout(() => {
      if (cancelled || !containerRef.current) return;

      const terminalTheme = {
        background: theme.terminal.background,
        foreground: theme.terminal.foreground,
        cursor: theme.terminal.cursor,
        cursorAccent: theme.terminal.background,
        selectionBackground: theme.terminal.selectionBackground,
        black: '#1e1e2e',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#cba6f7',
        cyan: '#94e2d5',
        white: '#cdd6f4',
        brightBlack: '#45475a',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#cba6f7',
        brightCyan: '#94e2d5',
        brightWhite: '#f5f5f5'
      };

      // Create terminal with larger font size for preview readability
      term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: 16, // Larger font for preview mode readability
        fontFamily: fontFamily || '"SF Mono", "Menlo", "Monaco", "Consolas", monospace',
        fontWeight: '400',
        fontWeightBold: '600',
        lineHeight: 1.2,
        letterSpacing: 0,
        theme: terminalTheme,
        allowTransparency: true,
        allowProposedApi: true,
        convertEol: true,
        smoothScrollDuration: 100,
        scrollback: 10000,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      fitAddonRef.current = fitAddon;

      const unicode11 = new Unicode11Addon();
      term.loadAddon(unicode11);
      term.unicode.activeVersion = '11';

      // WebLinksAddon - handles ALL URLs with visual link styling (underline, pointer cursor)
      // Routes localhost/private IPs to preview panel (via onLink), external URLs to browser
      const allUrlRegex = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d+)?(?:\/[^\s]*)?|https?:\/\/[\w\-\.]+(?::\d+)?(?:\/[^\s]*)?/i;

      const webLinksAddon = new WebLinksAddon((event, url) => {
        event.preventDefault();
        event.stopPropagation();

        // Normalize URL - add protocol if missing
        let normalizedUrl = url;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          normalizedUrl = 'http://' + url;
        }

        // Check if this is a localhost or private network URL
        const isLocalhost = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.\d|10\.\d|172\.(?:1[6-9]|2\d|3[01])\.)/i.test(url);

        if (isLocalhost && onLink) {
          // Localhost/private IP → open in preview panel
          console.log('[ReplicaTerminal WebLinksAddon] Localhost URL clicked:', normalizedUrl);
          onLink(normalizedUrl);
        } else {
          // External URL → open in system browser
          console.log('[ReplicaTerminal WebLinksAddon] External URL clicked:', normalizedUrl);
          window.open(normalizedUrl, '_blank', 'noopener,noreferrer');
        }
      }, { urlRegex: allUrlRegex });
      term.loadAddon(webLinksAddon);

      // Open terminal in container
      term.open(containerRef.current);
      terminalRef.current = term;

      // Handle user input
      term.onData((data) => {
        socket.emit('terminal:replica-input', { sessionId, data });
      });

      setError(null);

      // Delay joining until terminal is rendered
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (cancelled || !fitAddon) return;

          // Fit terminal to container first
          try {
            fitAddon.fit();
          } catch (e) {
            console.warn('[ReplicaTerminal] Initial fit failed:', e);
          }

          const dims = fitAddon.proposeDimensions();
          const proposedCols = dims?.cols && dims.cols > 0 ? dims.cols : undefined;
          const proposedRows = dims?.rows && dims.rows > 0 ? dims.rows : undefined;

          socket.emit('terminal:replica', {
            sessionId,
            cols: proposedCols,
            rows: proposedRows
          });
          console.log('[ReplicaTerminal] Joining session ' + sessionId.slice(0, 8) + ' as replica (dims: ' + proposedCols + 'x' + proposedRows + ')');
        });
      });

      // Handle errors
      const handleError = (data: { sessionId?: string; error: string }) => {
        if (!data.sessionId || data.sessionId === sessionId) {
          console.error('[ReplicaTerminal] Error: ' + data.error);
          setError(data.error);
          setIsReady(true);
        }
      };
      socket.on('terminal:replica-error', handleError);

      // Fallback timeout
      fallbackTimer = setTimeout(() => {
        if (!terminalRef.current || !fitAddonRef.current) return;
        console.log('[ReplicaTerminal] Fallback: showing terminal without history');
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            try {
              fitAddonRef.current?.fit();
            } catch (e) {
              console.warn('[ReplicaTerminal] Fallback fit failed:', e);
            }
            setIsReady(true);
          });
        });
      }, 2000);

      // Handle scrollback history - write history then fit to container
      const handleHistory = (data: { sessionId: string; data: string; cols?: number; rows?: number }) => {
        if (data.sessionId !== sessionId || !terminalRef.current || !fitAddonRef.current) return;

        const historyData = data.data;
        console.log('[ReplicaTerminal] Received history: ' + historyData.length + ' bytes');

        if (fallbackTimer) clearTimeout(fallbackTimer);

        // Reset and write history
        terminalRef.current.reset();

        if (historyData) {
          terminalRef.current.write(historyData);
        }

        // Fit terminal to container after writing history
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            try {
              fitAddonRef.current?.fit();
            } catch (e) {
              console.warn('[ReplicaTerminal] Post-history fit failed:', e);
            }
            setIsReady(true);

            // Delayed refit for late layout changes
            setTimeout(() => {
              try {
                fitAddonRef.current?.fit();
              } catch (e) {
                // Ignore
              }
            }, 500);
          });
        });
      };

      // Handle dimension changes from server
      const handleDimensions = (data: { terminalId?: string; sessionId?: string; cols: number; rows: number }) => {
        if (data.sessionId && data.sessionId !== sessionId) return;
        // We use our own dimensions via FitAddon, ignore server dimensions
        console.log('[ReplicaTerminal] Ignoring server dimension change (using local fit): ' + data.cols + 'x' + data.rows);
      };

      // Handle live data with buffering
      const handleData = (data: { terminalId?: string; sessionId?: string; data: string }) => {
        if (data.sessionId !== sessionId || !terminalRef.current) return;

        bufferRef.current += data.data;

        if (bufferRef.current.length > MAX_BUFFER_SIZE) {
          if (bufferTimeoutRef.current) {
            clearTimeout(bufferTimeoutRef.current);
            bufferTimeoutRef.current = null;
          }
          flushBuffer();
          return;
        }

        if (bufferTimeoutRef.current) {
          clearTimeout(bufferTimeoutRef.current);
        }

        bufferTimeoutRef.current = setTimeout(() => {
          bufferTimeoutRef.current = null;

          if (hasIncompleteEscapeSequence(bufferRef.current)) {
            bufferTimeoutRef.current = setTimeout(() => {
              bufferTimeoutRef.current = null;
              flushBuffer();
            }, TUNNEL_BUFFER_DELAY_MS);
            return;
          }

          flushBuffer();
        }, TUNNEL_BUFFER_DELAY_MS);
      };

      socket.on('terminal:replica-history', handleHistory);
      socket.on('terminal:data', handleData);
      socket.on('terminal:dimensions', handleDimensions);

    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(initDelay);

      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
      }

      if (bufferTimeoutRef.current) {
        clearTimeout(bufferTimeoutRef.current);
        bufferTimeoutRef.current = null;
      }
      if (bufferRef.current && term) {
        term.write(bufferRef.current);
        bufferRef.current = '';
      }

      socket.emit('terminal:replica-leave', { sessionId });
      console.log('[ReplicaTerminal] Leaving session ' + sessionId.slice(0, 8));

      socket.off('terminal:replica-history');
      socket.off('terminal:replica-error');
      socket.off('terminal:data');
      socket.off('terminal:dimensions');

      if (term) {
        term.dispose();
      }
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, socket, theme, fontFamily, onLink, hasIncompleteEscapeSequence, flushBuffer]);

  // ResizeObserver to refit terminal when container size changes
  // Only fit - dimensions are reported once on join, not continuously
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (fitAddonRef.current && terminalRef.current) {
          try {
            fitAddonRef.current.fit();
          } catch (e) {
            console.warn('[ReplicaTerminal] Resize fit failed:', e);
          }
        }
      });
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div className="replica-terminal-container">
      {error ? (
        <div className="replica-terminal-error" style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#f38ba8',
          padding: '20px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '14px', marginBottom: '8px' }}>Session not found</div>
          <div style={{ fontSize: '12px', color: '#6c7086' }}>
            The terminal session may have been closed or restarted.
          </div>
          <div style={{ fontSize: '11px', color: '#45475a', marginTop: '12px' }}>
            SessionId: {sessionId.slice(0, 8)}...
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="replica-terminal-content"
          style={{
            opacity: isReady ? 1 : 0,
            transition: 'opacity 0.15s ease-in-out',
          }}
        />
      )}
    </div>
  );
};

export default ReplicaTerminal;
