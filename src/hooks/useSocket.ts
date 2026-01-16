import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

interface UseSocketReturn {
  socket: Socket | null;
  status: ConnectionStatus;
  sessionId: string | null;
  isRestored: boolean;
}

const STORAGE_KEY = 'mobile_terminal_session';

export function useSocket(): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isRestored, setIsRestored] = useState(false);

  useEffect(() => {
    // Clear old legacy session - multi-terminal uses different storage
    localStorage.removeItem(STORAGE_KEY);

    // Create socket connection
    // Use current origin - Vite proxies /socket.io to backend
    // This allows tunnel access (trycloudflare.com) to work properly
    // In dev mode, connect directly to Express server (not through Vite proxy)
    // This ensures Socket.io connections work when running via Tauri webview
    const serverUrl = undefined;

    const socket = io(serverUrl, {
      reconnection: true,
      reconnectionAttempts: 30,  // More attempts to handle dev server restarts
      reconnectionDelay: 1000,
      reconnectionDelayMax: 3000,  // Cap delay to reconnect faster
      withCredentials: true
    });

    socketRef.current = socket;

    // Set up terminal data listener BEFORE connecting
    // This ensures we capture all data from the PTY
    socket.on('terminal:data', (data: string | { terminalId: string; data: string }) => {
      if (typeof data === 'string') {
        // Legacy format - single terminal
        if (legacyTerminalDataHandler) {
          legacyTerminalDataHandler(data);
        } else {
          legacyTerminalDataBuffer.push(data);
        }
      } else {
        // New format - multi-terminal
        const { terminalId, data: termData } = data;
        const handler = multiTerminalDataHandlers.get(terminalId);
        if (handler) {
          handler(termData);
        } else {
          // Buffer data for this terminal
          if (!multiTerminalDataBuffers.has(terminalId)) {
            multiTerminalDataBuffers.set(terminalId, []);
          }
          multiTerminalDataBuffers.get(terminalId)!.push(termData);
        }
      }
    });

    // Handle terminal history (scrollback) for late-joining clients
    // This is sent BEFORE joining the room, so we get the full history before live data
    // CRITICAL: Server sends dimensions (cols/rows) - we MUST resize BEFORE writing content
    // FIX: Always buffer history, then use flushBufferIfReady to ensure proper ordering
    socket.on('terminal:history', (data: { terminalId: string; data: string; cols?: number; rows?: number }) => {
      const { terminalId, data: historyData, cols, rows } = data;
      console.log(`[Socket] History received for ${terminalId.slice(0, 8)}: ${historyData.length} bytes, dims: ${cols}x${rows}`);

      // ALWAYS buffer history - don't write directly
      // This ensures dimensions are applied before data regardless of handler registration order
      if (!multiTerminalDataBuffers.has(terminalId)) {
        multiTerminalDataBuffers.set(terminalId, []);
      }

      // Store dimensions with the buffer
      if (cols && rows) {
        (multiTerminalDataBuffers.get(terminalId)! as unknown as { __dims?: { cols: number; rows: number } }).__dims = { cols, rows };
      }

      // Prepend history (should appear before any live data that may be buffered)
      multiTerminalDataBuffers.get(terminalId)!.unshift(historyData);

      // Try to flush if handlers are ready
      flushBufferIfReady(terminalId);
    });

    socket.on('connect', () => {
      console.log('[Socket] Connected');
      setStatus('connected');

      // Small delay to ensure React has rendered
      setTimeout(() => {
        socket.emit('terminal:join', {
          cols: Math.floor(window.innerWidth / 9), // Approximate character width
          rows: Math.floor((window.innerHeight - 150) / 17) // Approximate line height
        });
      }, 50);
    });

    socket.on('terminal:joined', (data: { sessionId: string; restored: boolean }) => {
      setSessionId(data.sessionId);
      setIsRestored(data.restored);
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
      // Socket.io will auto-reconnect, so set to reconnecting instead of disconnected
      // unless it was an intentional disconnect
      if (reason === 'io client disconnect' || reason === 'io server disconnect') {
        setStatus('disconnected');
      } else {
        setStatus('reconnecting');
      }
    });

    socket.on('connect_error', (error) => {
      console.log('[Socket] Connection error:', error.message);
      // Socket.io will retry, so set to reconnecting
      setStatus('reconnecting');
    });

    // Track reconnection attempts
    socket.io.on('reconnect_attempt', (attempt) => {
      console.log(`[Socket] Reconnection attempt ${attempt}/30`);
      setStatus('reconnecting');
    });

    // Only set disconnected after all reconnection attempts fail
    socket.io.on('reconnect_failed', () => {
      console.log('[Socket] All reconnection attempts failed');
      setStatus('disconnected');
    });

    // Successfully reconnected
    socket.io.on('reconnect', (attempt) => {
      console.log(`[Socket] Reconnected after ${attempt} attempts`);
      // 'connect' event will also fire, which sets status to 'connected'
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return {
    socket: socketRef.current,
    status,
    sessionId,
    isRestored
  };
}

// ========================================
// LEGACY SINGLE-TERMINAL SUPPORT
// ========================================

// Buffer for terminal data received before handler is set up
const legacyTerminalDataBuffer: string[] = [];
let legacyTerminalDataHandler: ((data: string) => void) | null = null;

// Track last sent dimensions to avoid duplicate resize events
let lastSentCols = 0;
let lastSentRows = 0;
let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

export function useTerminalSocket(socket: Socket | null) {
  const write = useCallback((data: string) => {
    if (socket) {
      socket.emit('terminal:input', data);
    }
  }, [socket]);

  const resize = useCallback((cols: number, rows: number) => {
    if (!socket) return;

    // Only send resize if dimensions actually changed
    if (cols === lastSentCols && rows === lastSentRows) return;

    // Debounce resize events to prevent rapid-fire resizes
    if (resizeTimeout) {
      clearTimeout(resizeTimeout);
    }

    resizeTimeout = setTimeout(() => {
      // Double-check dimensions haven't changed during debounce
      if (cols !== lastSentCols || rows !== lastSentRows) {
        lastSentCols = cols;
        lastSentRows = rows;
        socket.emit('terminal:resize', { cols, rows });
      }
      resizeTimeout = null;
    }, 100);
  }, [socket]);

  // Force immediate resize (for when we need dimensions set before running a command)
  const resizeImmediate = useCallback((cols: number, rows: number) => {
    if (!socket) return;

    if (resizeTimeout) {
      clearTimeout(resizeTimeout);
      resizeTimeout = null;
    }

    lastSentCols = cols;
    lastSentRows = rows;
    socket.emit('terminal:resize', { cols, rows });
  }, [socket]);

  const onData = useCallback((handler: (data: string) => void) => {
    legacyTerminalDataHandler = handler;

    // Flush any buffered data
    if (legacyTerminalDataBuffer.length > 0) {
      legacyTerminalDataBuffer.forEach(data => handler(data));
      legacyTerminalDataBuffer.length = 0;
    }

    return () => {
      legacyTerminalDataHandler = null;
    };
  }, []);

  return { write, resize, resizeImmediate, onData };
}

// ========================================
// NEW MULTI-TERMINAL SUPPORT
// ========================================

// Data handlers and buffers per terminal
const multiTerminalDataHandlers: Map<string, (data: string) => void> = new Map();
const multiTerminalDataBuffers: Map<string, string[]> = new Map();

// Dimension change handlers per terminal (for width sync across clients)
const multiTerminalDimensionHandlers: Map<string, (cols: number, rows: number) => void> = new Map();

// Helper to flush buffered data with proper dimension ordering
// This ensures dimensions are ALWAYS applied before data is written
// Critical for CLI apps that use cursor movement/spinners
function flushBufferIfReady(terminalId: string) {
  const buffer = multiTerminalDataBuffers.get(terminalId);
  const dataHandler = multiTerminalDataHandlers.get(terminalId);
  const dimHandler = multiTerminalDimensionHandlers.get(terminalId);

  // Need at least data handler and some buffered data
  if (!buffer || buffer.length === 0 || !dataHandler) return;

  // Apply dimensions FIRST if present (critical for correct rendering)
  const dims = (buffer as unknown as { __dims?: { cols: number; rows: number } }).__dims;
  if (dims) {
    if (dimHandler) {
      console.log(`[Socket] Flushing: applying dimensions ${dims.cols}x${dims.rows} for ${terminalId.slice(0, 8)}`);
      dimHandler(dims.cols, dims.rows);
    }
    delete (buffer as unknown as { __dims?: { cols: number; rows: number } }).__dims;
  }

  // THEN flush data (after dimensions are applied)
  console.log(`[Socket] Flushing: writing ${buffer.length} buffered items for ${terminalId.slice(0, 8)}`);
  buffer.forEach(data => dataHandler(data));
  buffer.length = 0;
}

// Track resize state per terminal
const terminalResizeState: Map<string, { cols: number; rows: number; timeout: ReturnType<typeof setTimeout> | null }> = new Map();

// Session tracking for persistence
const terminalSessions: Map<string, string> = new Map(); // terminalId -> sessionId

export interface MultiTerminalSocketReturn {
  // Terminal lifecycle
  createTerminal: (terminalId: string, cols: number, rows: number, sessionId?: string | null) => void;
  destroyTerminal: (terminalId: string) => void;
  restoreTerminals: (terminals: Array<{ terminalId: string; sessionId: string; cols: number; rows: number }>) => void;

  // Terminal I/O
  writeTerminal: (terminalId: string, data: string) => void;
  resizeTerminal: (terminalId: string, cols: number, rows: number) => void;
  resizeTerminalImmediate: (terminalId: string, cols: number, rows: number) => void;

  // Data handling
  onTerminalData: (terminalId: string, handler: (data: string) => void) => () => void;

  // Dimension sync (server broadcasts effective dimensions when they change)
  onDimensionsChange: (terminalId: string, handler: (cols: number, rows: number) => void) => () => void;

  // Session tracking
  getSessionId: (terminalId: string) => string | null;
  setSessionId: (terminalId: string, sessionId: string) => void;
}

export function useMultiTerminalSocket(socket: Socket | null): MultiTerminalSocketReturn {
  // Set up event listeners for terminal created/destroyed events
  useEffect(() => {
    if (!socket) return;

    const handleCreated = (data: { terminalId: string; sessionId: string; restored: boolean }) => {
      console.log(`[Socket] Terminal created: ${data.terminalId.slice(0, 8)} (restored: ${data.restored})`);
      terminalSessions.set(data.terminalId, data.sessionId);
    };

    const handleDestroyed = (data: { terminalId: string }) => {
      console.log(`[Socket] Terminal destroyed: ${data.terminalId.slice(0, 8)}`);
      terminalSessions.delete(data.terminalId);
      multiTerminalDataHandlers.delete(data.terminalId);
      multiTerminalDataBuffers.delete(data.terminalId);
      terminalResizeState.delete(data.terminalId);
    };

    const handleRestored = (data: { terminals: Array<{ terminalId: string; sessionId: string; restored: boolean }> }) => {
      for (const term of data.terminals) {
        terminalSessions.set(term.terminalId, term.sessionId);
      }
    };

    // Handle dimension changes (server broadcasts effective dimensions when they change)
    const handleDimensions = (data: { terminalId: string; cols: number; rows: number }) => {
      console.log(`[Socket] Dimensions changed for ${data.terminalId.slice(0, 8)}: ${data.cols}x${data.rows}`);
      const handler = multiTerminalDimensionHandlers.get(data.terminalId);
      if (handler) {
        handler(data.cols, data.rows);
      }
    };

    socket.on('terminal:created', handleCreated);
    socket.on('terminal:destroyed', handleDestroyed);
    socket.on('terminal:restored', handleRestored);
    socket.on('terminal:dimensions', handleDimensions);

    return () => {
      socket.off('terminal:created', handleCreated);
      socket.off('terminal:destroyed', handleDestroyed);
      socket.off('terminal:restored', handleRestored);
      socket.off('terminal:dimensions', handleDimensions);
    };
  }, [socket]);

  const createTerminal = useCallback((terminalId: string, cols: number, rows: number, sessionId?: string | null) => {
    if (!socket) return;
    socket.emit('terminal:create', { terminalId, cols, rows, sessionId: sessionId || undefined });
  }, [socket]);

  const destroyTerminal = useCallback((terminalId: string) => {
    if (!socket) return;
    socket.emit('terminal:destroy', { terminalId });
  }, [socket]);

  const restoreTerminals = useCallback((terminals: Array<{ terminalId: string; sessionId: string; cols: number; rows: number }>) => {
    if (!socket) return;
    socket.emit('terminal:restore', { terminals });
  }, [socket]);

  const writeTerminal = useCallback((terminalId: string, data: string) => {
    if (!socket) return;
    socket.emit('terminal:input', { terminalId, data });
  }, [socket]);

  const resizeTerminal = useCallback((terminalId: string, cols: number, rows: number) => {
    if (!socket) return;

    // Get or create resize state for this terminal
    let state = terminalResizeState.get(terminalId);
    if (!state) {
      state = { cols: 0, rows: 0, timeout: null };
      terminalResizeState.set(terminalId, state);
    }

    // Only send resize if dimensions actually changed
    if (cols === state.cols && rows === state.rows) return;

    // Debounce resize events
    if (state.timeout) {
      clearTimeout(state.timeout);
    }

    state.timeout = setTimeout(() => {
      const currentState = terminalResizeState.get(terminalId);
      if (currentState && (cols !== currentState.cols || rows !== currentState.rows)) {
        currentState.cols = cols;
        currentState.rows = rows;
        socket.emit('terminal:resize', { terminalId, cols, rows });
      }
      if (currentState) {
        currentState.timeout = null;
      }
    }, 100);
  }, [socket]);

  const resizeTerminalImmediate = useCallback((terminalId: string, cols: number, rows: number) => {
    if (!socket) return;

    let state = terminalResizeState.get(terminalId);
    if (!state) {
      state = { cols: 0, rows: 0, timeout: null };
      terminalResizeState.set(terminalId, state);
    }

    if (state.timeout) {
      clearTimeout(state.timeout);
      state.timeout = null;
    }

    state.cols = cols;
    state.rows = rows;
    socket.emit('terminal:resize', { terminalId, cols, rows });
  }, [socket]);

  const onTerminalData = useCallback((terminalId: string, handler: (data: string) => void) => {
    multiTerminalDataHandlers.set(terminalId, handler);

    // Try to flush buffered data if dimension handler is also ready
    // Uses flushBufferIfReady to ensure dimensions are applied BEFORE data
    flushBufferIfReady(terminalId);

    return () => {
      multiTerminalDataHandlers.delete(terminalId);
    };
  }, []);

  const onDimensionsChange = useCallback((terminalId: string, handler: (cols: number, rows: number) => void) => {
    multiTerminalDimensionHandlers.set(terminalId, handler);

    // Try to flush buffered data if data handler is also ready
    // This ensures dimensions are applied when dimension handler registers after data handler
    flushBufferIfReady(terminalId);

    return () => {
      multiTerminalDimensionHandlers.delete(terminalId);
    };
  }, []);

  const getSessionId = useCallback((terminalId: string): string | null => {
    return terminalSessions.get(terminalId) || null;
  }, []);

  const setSessionId = useCallback((terminalId: string, sessionId: string) => {
    terminalSessions.set(terminalId, sessionId);
  }, []);

  return {
    createTerminal,
    destroyTerminal,
    restoreTerminals,
    writeTerminal,
    resizeTerminal,
    resizeTerminalImmediate,
    onTerminalData,
    onDimensionsChange,
    getSessionId,
    setSessionId,
  };
}
