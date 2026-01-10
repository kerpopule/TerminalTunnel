import * as pty from 'node-pty';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';

interface PtySession {
  id: string;
  pty: pty.IPty;
  sockets: Set<string>;
  dataHandlers: Map<string, (data: string) => void>;
  dataDisposable: pty.IDisposable | null;  // Track the onData disposable
  lastActivity: number;
  createdAt: number;
}

// Callback type for terminal data with terminalId
type TerminalDataCallback = (terminalId: string, data: string) => void;

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes of inactivity

export class PtyManager {
  private sessions: Map<string, PtySession> = new Map();
  // Track which terminals belong to which socket: socketId → Map<terminalId, sessionId>
  private socketTerminals: Map<string, Map<string, string>> = new Map();
  // Track data handlers per socket and terminal: socketId → Map<terminalId, callback>
  private terminalDataHandlers: Map<string, Map<string, TerminalDataCallback>> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Cleanup inactive sessions every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanupInactiveSessions(), 5 * 60 * 1000);
  }

  /**
   * Create a new PTY session for a specific terminal
   */
  createSession(cols: number, rows: number, socketId: string): string | null {
    const sessionId = uuidv4();
    // Use zsh (modern macOS default) or fall back to user's SHELL
    const shell = process.env.SHELL || '/bin/zsh';
    const home = os.homedir();

    console.log(`Creating PTY session with shell: ${shell}, cwd: ${home}`);

    try {
      const ptyProcess = pty.spawn(shell, ['-l'], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: home,
        env: {
          ...process.env,  // Inherit full environment for proper shell config
          TERM: 'xterm-256color',
          HOME: home,
          SHELL: shell,
          LANG: 'en_US.UTF-8'
        }
      });

      const session: PtySession = {
        id: sessionId,
        pty: ptyProcess,
        sockets: new Set([socketId]),
        dataHandlers: new Map(),
        dataDisposable: null,
        lastActivity: Date.now(),
        createdAt: Date.now()
      };

      this.sessions.set(sessionId, session);

      // Handle PTY exit
      ptyProcess.onExit(({ exitCode }) => {
        console.log(`Session ${sessionId} exited with code ${exitCode}`);
        this.sessions.delete(sessionId);
      });

      return sessionId;
    } catch (error) {
      console.error('Failed to create PTY session:', error);
      return null;
    }
  }

  /**
   * Create a new terminal for a socket with a specific terminalId
   */
  createTerminal(terminalId: string, socketId: string, cols: number, rows: number): string | null {
    const sessionId = this.createSession(cols, rows, socketId);
    if (!sessionId) {
      return null;
    }

    // Track this terminal for the socket
    if (!this.socketTerminals.has(socketId)) {
      this.socketTerminals.set(socketId, new Map());
    }
    this.socketTerminals.get(socketId)!.set(terminalId, sessionId);

    console.log(`Created terminal ${terminalId} -> session ${sessionId} for socket ${socketId}`);
    return sessionId;
  }

  /**
   * Destroy a specific terminal
   */
  destroyTerminal(terminalId: string, socketId: string): void {
    const socketTerminals = this.socketTerminals.get(socketId);
    if (!socketTerminals) return;

    const sessionId = socketTerminals.get(terminalId);
    if (!sessionId) return;

    // Remove terminal from socket's map
    socketTerminals.delete(terminalId);
    if (socketTerminals.size === 0) {
      this.socketTerminals.delete(socketId);
    }

    // Remove data handler for this terminal
    const handlers = this.terminalDataHandlers.get(socketId);
    if (handlers) {
      handlers.delete(terminalId);
      if (handlers.size === 0) {
        this.terminalDataHandlers.delete(socketId);
      }
    }

    // Detach socket from session
    const session = this.sessions.get(sessionId);
    if (session) {
      session.sockets.delete(socketId);
      session.dataHandlers.delete(socketId);

      // If no sockets left, kill the session immediately
      if (session.sockets.size === 0) {
        console.log(`Killing orphaned session ${sessionId} for terminal ${terminalId}`);
        this.killSession(sessionId);
      }
    }

    console.log(`Destroyed terminal ${terminalId} for socket ${socketId}`);
  }

  /**
   * Get the sessionId for a specific terminal
   */
  getSessionForTerminal(terminalId: string, socketId: string): string | null {
    const socketTerminals = this.socketTerminals.get(socketId);
    if (!socketTerminals) return null;
    return socketTerminals.get(terminalId) || null;
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  attachSocket(sessionId: string, socketId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.sockets.add(socketId);
      session.lastActivity = Date.now();
    }
  }

  /**
   * Attach a socket to an existing session for a specific terminal
   */
  attachTerminal(terminalId: string, sessionId: string, socketId: string): boolean {
    if (!this.hasSession(sessionId)) {
      return false;
    }

    // Track this terminal for the socket
    if (!this.socketTerminals.has(socketId)) {
      this.socketTerminals.set(socketId, new Map());
    }
    this.socketTerminals.get(socketId)!.set(terminalId, sessionId);

    this.attachSocket(sessionId, socketId);
    console.log(`Attached terminal ${terminalId} -> session ${sessionId} for socket ${socketId}`);
    return true;
  }

  detachSocket(sessionId: string, socketId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.sockets.delete(socketId);
      session.dataHandlers.delete(socketId);
      // Don't kill session if no sockets - allow reconnection
    }
  }

  /**
   * Detach all terminals for a socket
   */
  detachAllTerminals(socketId: string): void {
    const socketTerminals = this.socketTerminals.get(socketId);
    if (!socketTerminals) return;

    // Detach from all sessions
    for (const [terminalId, sessionId] of socketTerminals) {
      this.detachSocket(sessionId, socketId);
      console.log(`Detached terminal ${terminalId} from session ${sessionId}`);
    }

    // Clean up tracking
    this.socketTerminals.delete(socketId);
    this.terminalDataHandlers.delete(socketId);
  }

  /**
   * Set up data handler for a specific terminal
   */
  onTerminalData(terminalId: string, socketId: string, handler: TerminalDataCallback): void {
    const sessionId = this.getSessionForTerminal(terminalId, socketId);
    if (!sessionId) {
      console.warn(`No session found for terminal ${terminalId}`);
      return;
    }

    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Track handler
    if (!this.terminalDataHandlers.has(socketId)) {
      this.terminalDataHandlers.set(socketId, new Map());
    }
    this.terminalDataHandlers.get(socketId)!.set(terminalId, handler);

    // Only set up PTY data handler once per session (prevent memory leak)
    if (!session.dataDisposable) {
      session.dataDisposable = session.pty.onData((data) => {
        session.lastActivity = Date.now();
        // Route to all registered handlers for this session
        for (const [key, h] of session.dataHandlers) {
          try {
            h(data);
          } catch (err) {
            console.error(`Error in data handler ${key}:`, err);
          }
        }
      });
    }

    // Track in session's handlers - wrapper that includes terminalId
    session.dataHandlers.set(`${socketId}:${terminalId}`, (data) => {
      try {
        handler(terminalId, data);
      } catch (err) {
        console.error(`Error in terminal handler ${terminalId}:`, err);
      }
    });
  }

  // Legacy method for backward compatibility
  onData(sessionId: string, handler: (data: string) => void): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Remove any existing listener first
    const existingHandler = session.dataHandlers.get('primary');
    if (existingHandler) {
      // node-pty doesn't have removeListener, so we track handlers ourselves
    }

    // Set up data handler
    session.pty.onData((data) => {
      session.lastActivity = Date.now();
      handler(data);
    });

    session.dataHandlers.set('primary', handler);
  }

  /**
   * Write to a specific terminal
   */
  writeTerminal(terminalId: string, socketId: string, data: string): void {
    const sessionId = this.getSessionForTerminal(terminalId, socketId);
    if (!sessionId) {
      console.warn(`No session found for terminal ${terminalId}`);
      return;
    }
    this.write(sessionId, data);
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
      session.pty.write(data);
    }
  }

  /**
   * Resize a specific terminal
   */
  resizeTerminal(terminalId: string, socketId: string, cols: number, rows: number): void {
    const sessionId = this.getSessionForTerminal(terminalId, socketId);
    if (!sessionId) {
      console.warn(`No session found for terminal ${terminalId}`);
      return;
    }
    this.resize(sessionId, cols, rows);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pty.resize(cols, rows);
    }
  }

  killSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Dispose of data handler to prevent memory leaks
      if (session.dataDisposable) {
        session.dataDisposable.dispose();
        session.dataDisposable = null;
      }
      // Clear all handlers
      session.dataHandlers.clear();
      // Kill the PTY process
      try {
        session.pty.kill();
      } catch (err) {
        console.error(`Error killing PTY session ${sessionId}:`, err);
      }
      this.sessions.delete(sessionId);
    }
  }

  killAllSessions(): void {
    for (const [sessionId] of this.sessions) {
      this.killSession(sessionId);
    }
  }

  /**
   * Get all terminals for a socket
   */
  getSocketTerminals(socketId: string): Map<string, string> {
    return this.socketTerminals.get(socketId) || new Map();
  }

  private cleanupInactiveSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      // Kill sessions that have been inactive and have no connected sockets
      if (session.sockets.size === 0 && now - session.lastActivity > SESSION_TIMEOUT) {
        console.log(`Cleaning up inactive session ${sessionId}`);
        this.killSession(sessionId);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.killAllSessions();
  }
}
