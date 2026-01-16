import type * as pty from 'node-pty';
import { createRequire } from 'module';
import { spawn, execSync, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { io, type Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';

type NodePtyModule = typeof import('node-pty');
const require = createRequire(import.meta.url);
interface TerminalDimensions {
  cols: number;
  rows: number;
}

interface PtySession {
  id: string;
  pty: pty.IPty;
  sockets: Set<string>;
  dataHandlers: Map<string, (data: string) => void>;
  dataDisposable: pty.IDisposable | null;  // Track the onData disposable
  lastActivity: number;
  createdAt: number;
  scrollbackBuffer: string[];  // Circular buffer for terminal history
  scrollbackSize: number;      // Current size in bytes
  clientDimensions: Map<string, TerminalDimensions>;  // Track dimensions per socket
  effectiveDimensions: TerminalDimensions;  // Current PTY dimensions (active client's dimensions)
  activeSocketId: string | null;  // Which client is actively typing - their dimensions take priority
  // Data batching to prevent escape sequence fragmentation
  pendingData: string;                      // Batched data waiting to send
  batchTimeout: ReturnType<typeof setTimeout> | null;  // Timer for flushing batch
}

// Callback type for terminal data with terminalId
type TerminalDataCallback = (terminalId: string, data: string) => void;

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes of inactivity
const MAX_SCROLLBACK_BYTES = 50 * 1024; // 50KB scrollback buffer per session
// Data batching interval - coalesces rapid PTY output to prevent escape sequence fragmentation

const resolveLsofPath = (): string => {
  if (fs.existsSync('/usr/sbin/lsof')) return '/usr/sbin/lsof';
  if (fs.existsSync('/usr/bin/lsof')) return '/usr/bin/lsof';
  return 'lsof';
};

const LSOF_PATH = resolveLsofPath();

function findClaudeBin(env: NodeJS.ProcessEnv, homeDir: string): string | null {
  const nvmBin = env.NVM_BIN;
  if (nvmBin && fs.existsSync(path.join(nvmBin, 'claude'))) {
    return nvmBin;
  }

  const nvmDir = env.NVM_DIR || path.join(homeDir, '.nvm');
  const versionsDir = path.join(nvmDir, 'versions', 'node');
  if (!fs.existsSync(versionsDir)) return null;

  const entries = fs.readdirSync(versionsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const binDir = path.join(versionsDir, entry.name, 'bin');
    if (fs.existsSync(path.join(binDir, 'claude'))) {
      return binDir;
    }
  }
  return null;
}

function ensureZdotDir(): string | null {
  try {
    const zdotDir = path.join(os.tmpdir(), 'mt-zdot');
    fs.mkdirSync(zdotDir, { recursive: true });

    const shared = [
      'unset npm_config_prefix NPM_CONFIG_PREFIX PREFIX',
      'unset npm_config_userconfig NPM_CONFIG_USERCONFIG',
      'unset npm_config_globalconfig NPM_CONFIG_GLOBALCONFIG',
      '',
    ].join('\n');

    const pathFix = [
      'if [ -n "${CLAUDE_BIN:-}" ]; then',
      '  case ":$PATH:" in',
      '    *":$CLAUDE_BIN:"*) ;;',
      '    *) export PATH="$CLAUDE_BIN:$PATH" ;;',
      '  esac',
      'fi',
      '',
    ].join('\n');

    const wrapFile = (filename: string, sourcePath: string, guard: string) => {
      const content = [
        `if [ -z "${guard}" ]; then`,
        `  export ${guard}=1`,
        `  ${shared}`,
        `  if [ -f "${sourcePath}" ]; then`,
        `    source "${sourcePath}"`,
        '  fi',
        `  ${shared}`,
        `  ${pathFix}`,
        'fi',
        '',
      ].join('\n');
      fs.writeFileSync(path.join(zdotDir, filename), content, { encoding: 'utf8' });
    };

    wrapFile('.zshenv', '$HOME/.zshenv', 'MT_ZDOTDIR_ZSHENV');
    wrapFile('.zprofile', '$HOME/.zprofile', 'MT_ZDOTDIR_ZPROFILE');
    wrapFile('.zshrc', '$HOME/.zshrc', 'MT_ZDOTDIR_ZSHRC');
    return zdotDir;
  } catch (error) {
    console.error('[PTY] Failed to prepare ZDOTDIR:', error);
    return null;
  }
}

function buildPtyEnv(shell: string, homeDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: 'xterm-256color',
    HOME: homeDir,
    SHELL: shell,
    LANG: 'en_US.UTF-8',
  };

  delete env.npm_config_prefix;
  delete env.NPM_CONFIG_PREFIX;
  delete env.npm_config_userconfig;
  delete env.NPM_CONFIG_USERCONFIG;
  delete env.npm_config_globalconfig;
  delete env.NPM_CONFIG_GLOBALCONFIG;
  delete env.PREFIX;
  delete env.prefix;

  const claudeBin = findClaudeBin(env, homeDir);
  if (claudeBin) {
    env.CLAUDE_BIN = claudeBin;
    const currentPath = env.PATH || '';
    if (!currentPath.split(':').includes(claudeBin)) {
      env.PATH = `${claudeBin}:${currentPath}`;
    }
  }

  if (shell.endsWith('zsh')) {
    const zdotDir = ensureZdotDir();
    if (zdotDir) {
      env.ZDOTDIR = zdotDir;
    }
  }

  return env;
}

function resolveSidecarExecPath(): string {
  const bundledNode = path.resolve(process.cwd(), 'src-tauri', 'bin', 'node');
  if (fs.existsSync(bundledNode)) {
    return bundledNode;
  }
  return process.execPath;
}

function killSidecarPort(port: number): void {
  try {
    execSync(`${LSOF_PATH} -tiTCP:${port} -sTCP:LISTEN | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
  } catch {
    // Ignore failures; port may already be free.
  }
}
// 16ms = ~60fps, balances responsiveness with better sequence grouping for tunneled connections
const DATA_BATCH_INTERVAL_MS = 16;

export class PtyManager {
  private sessions: Map<string, PtySession> = new Map();
  // Track which terminals belong to which socket: socketId → Map<terminalId, sessionId>
  private socketTerminals: Map<string, Map<string, string>> = new Map();
  // Track data handlers per socket and terminal: socketId → Map<terminalId, callback>
  private terminalDataHandlers: Map<string, Map<string, TerminalDataCallback>> = new Map();
  private cleanupInterval: NodeJS.Timeout;
  private ptyModule: NodePtyModule | null = null;
  private sidecarSocket: Socket | null = null;
  private sidecarUrl: string | null = null;
  private useSidecar: boolean = false;
  private sidecarProcess: ChildProcess | null = null;
  private sidecarLogPath: string;
  private sidecarConnected: boolean = false;
  private sidecarReadyWaiters: Array<() => void> = [];

  constructor() {
    // Cleanup inactive sessions every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanupInactiveSessions(), 5 * 60 * 1000);
    this.tryLoadPtyModule();
    const isProduction = process.env.NODE_ENV === 'production';
    const forceSidecar = !isProduction && process.env.PTY_BACKEND !== 'direct';
    this.useSidecar = forceSidecar || process.env.PTY_BACKEND === 'sidecar' || !!process.env.PTY_SIDECAR_URL;
    this.sidecarLogPath = process.env.PTY_SIDECAR_LOG || path.resolve(process.cwd(), 'pty-sidecar.log');
    this.ensureSidecarLogFile();
    this.appendSidecarLog(`Server init: useSidecar=${this.useSidecar}, backend=${process.env.PTY_BACKEND || 'default'}, cwd=${process.cwd()}`);
    if (this.useSidecar) {
      this.maybeStartSidecarProcess();
      this.connectSidecar();
    }
  }

  private tryLoadPtyModule(): void {
    try {
      this.ptyModule = require('node-pty') as NodePtyModule;
      console.log('node-pty loaded successfully');
    } catch (error) {
      this.ptyModule = null;
      console.error('Failed to load node-pty, falling back to mock PTY:', error);
    }
  }

  private connectSidecar(): void {
    if (this.sidecarSocket) return;

    const host = process.env.PTY_SIDECAR_HOST || '127.0.0.1';
    const port = process.env.PTY_SIDECAR_PORT || '3457';
    const url = process.env.PTY_SIDECAR_URL || `http://${host}:${port}`;
    this.sidecarUrl = url;

    const socket = io(url, {
      reconnection: true,
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      console.log(`PTY sidecar connected at ${url}`);
      this.sidecarConnected = true;
      const waiters = this.sidecarReadyWaiters;
      this.sidecarReadyWaiters = [];
      waiters.forEach((resolve) => resolve());
    });

    socket.on('connect_error', (error) => {
      console.warn(`PTY sidecar connection error: ${error.message}`);
    });

    socket.on('disconnect', () => {
      this.sidecarConnected = false;
    });

    socket.on('pty-created', ({ sessionId, pid }) => {
      console.log(`PTY sidecar created session ${sessionId}, PID: ${pid}`);
    });

    socket.on('pty-data', ({ sessionId, data }) => {
      this.handleSessionData(sessionId, data);
    });

    socket.on('pty-exit', ({ sessionId }) => {
      console.log(`PTY sidecar session exited: ${sessionId}`);
      this.killSession(sessionId);
    });

    socket.on('pty-error', ({ sessionId, error }) => {
      console.error(`PTY sidecar error for session ${sessionId}:`, error);
    });

    this.sidecarSocket = socket;
  }

  private async waitForSidecarReady(timeoutMs = 5000): Promise<boolean> {
    if (this.sidecarConnected) {
      return true;
    }

    this.connectSidecar();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false);
      }, timeoutMs);

      this.sidecarReadyWaiters.push(() => {
        clearTimeout(timeout);
        resolve(true);
      });
    });
  }

  private maybeStartSidecarProcess(): void {
    if (process.env.NODE_ENV === 'production') {
      return;
    }
    if (this.sidecarProcess) {
      return;
    }

    const sidecarPath = path.resolve(process.cwd(), 'pty-sidecar.cjs');
    const logPath = this.sidecarLogPath;
    const sidecarPort = parseInt(process.env.PTY_SIDECAR_PORT || '3457', 10);
    const sidecarHost = process.env.PTY_SIDECAR_HOST || '127.0.0.1';

    try {
      if (!fs.existsSync(sidecarPath)) {
        this.appendSidecarLog(`Sidecar script not found at ${sidecarPath}`);
        console.error('[PTY] Sidecar script not found:', sidecarPath);
        return;
      }

      const sidecarUrl = process.env.PTY_SIDECAR_URL || '';
      const isLocalUrl = !sidecarUrl || sidecarUrl.includes('127.0.0.1') || sidecarUrl.includes('localhost');
      if (isLocalUrl) {
        killSidecarPort(sidecarPort);
      }

      const sidecarExecPath = resolveSidecarExecPath();
      this.appendSidecarLog(`Spawning sidecar: exec=${sidecarExecPath} script=${sidecarPath}`);
      const sidecarEnv: NodeJS.ProcessEnv = {
        ...process.env,
        PTY_SIDECAR_LOG: logPath,
        PTY_SIDECAR_PORT: sidecarPort.toString(),
        PTY_SIDECAR_HOST: sidecarHost,
      };
      delete sidecarEnv.npm_config_prefix;
      delete sidecarEnv.NPM_CONFIG_PREFIX;
      delete sidecarEnv.npm_config_userconfig;
      delete sidecarEnv.NPM_CONFIG_USERCONFIG;
      delete sidecarEnv.npm_config_globalconfig;
      delete sidecarEnv.NPM_CONFIG_GLOBALCONFIG;
      delete sidecarEnv.PREFIX;
      delete sidecarEnv.prefix;
      if (process.env.SHELL && process.env.SHELL.endsWith('zsh')) {
        const zdotDir = ensureZdotDir();
        if (zdotDir) {
          sidecarEnv.ZDOTDIR = zdotDir;
        }
      }

      this.sidecarProcess = spawn(sidecarExecPath, [sidecarPath], {
        cwd: process.cwd(),
        env: sidecarEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      console.log(`[PTY] Sidecar autostarted (dev). Log: ${logPath}`);
      this.appendSidecarLog(`Sidecar spawn attempted. pid=${this.sidecarProcess.pid || 'unknown'}`);
      this.sidecarProcess.stdout?.on('data', (data) => {
        this.appendSidecarLog(`sidecar stdout: ${String(data).trim()}`);
      });
      this.sidecarProcess.stderr?.on('data', (data) => {
        this.appendSidecarLog(`sidecar stderr: ${String(data).trim()}`);
      });
      this.sidecarProcess.on('exit', (code, signal) => {
        this.appendSidecarLog(`sidecar exit: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      });
      this.sidecarProcess.on('error', (error) => {
        this.appendSidecarLog(`sidecar error: ${String(error)}`);
      });
    } catch (error) {
      console.error('[PTY] Failed to autostart sidecar:', error);
      this.appendSidecarLog(`Sidecar spawn failed: ${String(error)}`);
    }
  }

  private stopSidecarProcess(): void {
    if (this.sidecarProcess) {
      this.sidecarProcess.kill();
      this.sidecarProcess = null;
    }
  }

  private ensureSidecarLogFile(): void {
    try {
      fs.mkdirSync(path.dirname(this.sidecarLogPath), { recursive: true });
      fs.writeFileSync(this.sidecarLogPath, '', { flag: 'a' });
    } catch (error) {
      console.error('[PTY] Failed to prepare sidecar log file:', error);
    }
  }

  private appendSidecarLog(message: string): void {
    try {
      fs.appendFileSync(this.sidecarLogPath, `[${new Date().toISOString()}] ${message}\n`);
    } catch {
      // Ignore logging errors to avoid crashing server startup.
    }
  }

  /**
   * Create a new PTY session for a specific terminal
   */
  async createSession(cols: number, rows: number, socketId: string): Promise<string | null> {
    const sessionId = uuidv4();
    // Use zsh (modern macOS default) or fall back to user's SHELL
    const shell = process.env.SHELL || '/bin/zsh';
    const home = os.homedir();

    console.log(`Creating PTY session with shell: ${shell}, cwd: ${home}`);

    try {
      if (this.useSidecar) {
        if (!this.sidecarConnected) {
          console.log('PTY sidecar not connected yet, waiting for readiness...');
        }
        const ready = await this.waitForSidecarReady();
        if (!ready) {
          console.warn('PTY sidecar not ready after timeout, falling back to mock session');
          return this.createMockSession(sessionId, cols, rows, socketId);
        }
        return this.createSidecarSession(sessionId, cols, rows, socketId);
      }

      if (!this.ptyModule) {
        console.warn('node-pty not available and sidecar not enabled, using mock PTY');
        return this.createMockSession(sessionId, cols, rows, socketId);
      }

      const ptyProcess = this.ptyModule.spawn(shell, ['-l'], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: home,
        env: buildPtyEnv(shell, home)
      });

      const session: PtySession = {
        id: sessionId,
        pty: ptyProcess,
        sockets: new Set([socketId]),
        dataHandlers: new Map(),
        dataDisposable: null,
        lastActivity: Date.now(),
        createdAt: Date.now(),
        scrollbackBuffer: [],
        scrollbackSize: 0,
        clientDimensions: new Map([[socketId, { cols, rows }]]),
        effectiveDimensions: { cols, rows },
        activeSocketId: socketId,  // Creator is initially active
        // Initialize data batching state
        pendingData: '',
        batchTimeout: null,
      };

      this.sessions.set(sessionId, session);

      // Set up PTY data listener IMMEDIATELY to capture initial shell prompt
      // This must happen before any data can be output by the shell
      session.dataDisposable = ptyProcess.onData((data) => {
        this.handleSessionData(sessionId, data);
      });

      // Handle PTY exit
      ptyProcess.onExit(({ exitCode }) => {
        console.log(`Session ${sessionId} exited with code ${exitCode}`);
        this.sessions.delete(sessionId);
      });

      return sessionId;
    } catch (error) {
      console.error('Failed to create PTY session:', error);
      if (this.useSidecar) {
        return this.createSidecarSession(sessionId, cols, rows, socketId);
      }
      return this.createMockSession(sessionId, cols, rows, socketId);
    }
  }

  private createSidecarSession(sessionId: string, cols: number, rows: number, socketId: string): string | null {
    if (!this.sidecarSocket) {
      this.connectSidecar();
    }

    if (!this.sidecarSocket || !this.sidecarSocket.connected) {
      console.warn('PTY sidecar not available, falling back to mock session');
      return this.createMockSession(sessionId, cols, rows, socketId);
    }

    const socket = this.sidecarSocket;
    const session: PtySession = {
      id: sessionId,
      pty: {
        pid: Math.floor(Math.random() * 90000) + 10000,
        onData: () => ({ dispose() {} }),
        onExit: () => ({ dispose() {} }),
        kill: () => {
          socket.emit('destroy-pty', { sessionId });
        },
        resize: (nextCols: number, nextRows: number) => {
          socket.emit('pty-resize', { sessionId, cols: nextCols, rows: nextRows });
        },
        write: (data: string) => {
          console.log('[sidecar write] Emitting pty-input to sidecar, sessionId:', sessionId.substring(0, 12), 'data length:', data.length, 'socket connected:', socket.connected);
          socket.emit('pty-input', { sessionId, input: data });
          console.log('[sidecar write] pty-input emitted');
        },
      } as unknown as pty.IPty,
      sockets: new Set([socketId]),
      dataHandlers: new Map(),
      dataDisposable: null,
      lastActivity: Date.now(),
      createdAt: Date.now(),
      scrollbackBuffer: [],
      scrollbackSize: 0,
      clientDimensions: new Map([[socketId, { cols, rows }]]),
      effectiveDimensions: { cols, rows },
      activeSocketId: socketId,
      pendingData: '',
      batchTimeout: null,
    };

    this.sessions.set(sessionId, session);
    socket.emit('create-pty', { sessionId, cols, rows });
    console.log(`Requested PTY sidecar session ${sessionId}`);
    return sessionId;
  }

  private handleSessionData(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.lastActivity = Date.now();

    session.scrollbackBuffer.push(data);
    session.scrollbackSize += data.length;

    while (session.scrollbackSize > MAX_SCROLLBACK_BYTES && session.scrollbackBuffer.length > 1) {
      const removed = session.scrollbackBuffer.shift();
      if (removed) {
        session.scrollbackSize -= removed.length;
      }
    }

    session.pendingData += data;

    if (!session.batchTimeout) {
      session.batchTimeout = setTimeout(() => {
        session.batchTimeout = null;
        if (session.pendingData.length === 0) {
          return;
        }

        const batchedData = session.pendingData;
        session.pendingData = '';

        for (const [key, handler] of session.dataHandlers) {
          try {
            handler(batchedData);
          } catch (err) {
            console.error(`Error in data handler ${key}:`, err);
          }
        }
      }, DATA_BATCH_INTERVAL_MS);
    }
  }

  private createMockSession(sessionId: string, cols: number, rows: number, socketId: string): string {
    const mockSession: PtySession = {
      id: sessionId,
      pty: {
        pid: Math.floor(Math.random() * 90000) + 10000,
        onData: () => ({ dispose() {} }),
        onExit: () => ({ dispose() {} }),
        kill: () => {
          this.killSession(sessionId);
        },
        resize: (nextCols: number, nextRows: number) => {
          const session = this.sessions.get(sessionId);
          if (!session) return;
          session.clientDimensions.set(socketId, { cols: nextCols, rows: nextRows });
          session.effectiveDimensions = { cols: nextCols, rows: nextRows };
        },
        write: (data: string) => {
          this.handleMockCommand(sessionId, data);
        },
      } as unknown as pty.IPty,
      sockets: new Set([socketId]),
      dataHandlers: new Map(),
      dataDisposable: null,
      lastActivity: Date.now(),
      createdAt: Date.now(),
      scrollbackBuffer: [],
      scrollbackSize: 0,
      clientDimensions: new Map([[socketId, { cols, rows }]]),
      effectiveDimensions: { cols, rows },
      activeSocketId: socketId,
      pendingData: '',
      batchTimeout: null,
    };

    this.sessions.set(sessionId, mockSession);
    // Don't send initial prompt here - let terminal:join handler decide
    // this.handleSessionData(sessionId, '\r\n$ ');

    console.log(`Created mock PTY session ${sessionId}`);
    return sessionId;
  }

  private handleMockCommand(sessionId: string, data: string): void {
    const command = data.replace(/\r/g, '').trim();
    let response = '';

    if (!command) {
      response = '\r\n$ ';
    } else if (command === 'ls') {
      response = '\r\nDesktop  Documents  Downloads  Pictures\r\n$ ';
    } else if (command === 'pwd') {
      response = `\r\n${os.homedir()}\r\n$ `;
    } else if (command === 'whoami') {
      response = `\r\n${os.userInfo().username}\r\n$ `;
    } else if (command.startsWith('echo ')) {
      response = `\r\n${command.slice(5)}\r\n$ `;
    } else if (command === 'clear') {
      response = '\x1b[2J\x1b[H$ ';
    } else if (command === 'exit' || command === 'quit') {
      response = '\r\nGoodbye!\r\n';
      setTimeout(() => this.killSession(sessionId), 200);
      this.handleSessionData(sessionId, response);
      return;
    } else {
      response = `\r\n${command}: command not found\r\n$ `;
    }

    setTimeout(() => this.handleSessionData(sessionId, response), 50);
  }

  /**
   * Create a new terminal for a socket with a specific terminalId
   */
  async createTerminal(terminalId: string, socketId: string, cols: number, rows: number): Promise<string | null> {
    const sessionId = await this.createSession(cols, rows, socketId);
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

  attachSocket(sessionId: string, socketId: string, dimensions?: TerminalDimensions): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.sockets.add(socketId);
      session.lastActivity = Date.now();
      // Track this client's dimensions if provided
      if (dimensions) {
        session.clientDimensions.set(socketId, dimensions);
      }
    }
  }

  /**
   * Attach a socket to an existing session for a specific terminal
   */
  attachTerminal(terminalId: string, sessionId: string, socketId: string, dimensions?: TerminalDimensions): boolean {
    if (!this.hasSession(sessionId)) {
      return false;
    }

    // Track this terminal for the socket
    if (!this.socketTerminals.has(socketId)) {
      this.socketTerminals.set(socketId, new Map());
    }
    this.socketTerminals.get(socketId)!.set(terminalId, sessionId);

    this.attachSocket(sessionId, socketId, dimensions);
    console.log(`Attached terminal ${terminalId} -> session ${sessionId} for socket ${socketId}`);
    return true;
  }

  detachSocket(sessionId: string, socketId: string): TerminalDimensions | null {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.sockets.delete(socketId);
      session.dataHandlers.delete(socketId);
      session.clientDimensions.delete(socketId);

      // Keep activeSocketId even if active client disconnects
      // Dimensions stay fixed - whoever created it gets it
      // The creator can resume control when they reconnect
    }
    return null;
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
   * Find an active session for a terminalId from ANY socket
   * This helps coordinate when multiple clients connect simultaneously
   */
  findActiveSessionForTerminal(terminalId: string): string | null {
    // Search all sockets to find one with an active session for this terminalId
    for (const [_socketId, terminals] of this.socketTerminals) {
      const sessionId = terminals.get(terminalId);
      if (sessionId && this.hasSession(sessionId)) {
        return sessionId;
      }
    }
    return null;
  }

  /**
   * Write data directly to a session's PTY
   */
  writeToSession(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pty.write(data);
      session.lastActivity = Date.now();
    }
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

    // NOTE: PTY data listener is set up in createSession() to capture initial shell prompt
    // Here we only register the handler that will receive the data

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

    session.dataHandlers.set('primary', handler);
  }

  /**
   * Write to a specific terminal
   */
  writeTerminal(terminalId: string, socketId: string, data: string): void {
    console.log('[writeTerminal] Called with:', {
      terminalId: terminalId.substring(0, 12),
      socketId: socketId.substring(0, 12),
      dataLength: data.length,
      useSidecar: this.useSidecar
    });
    const sessionId = this.getSessionForTerminal(terminalId, socketId);
    console.log('[writeTerminal] Resolved sessionId:', sessionId ? sessionId.substring(0, 12) : 'NULL');
    if (!sessionId) {
      console.warn(`[writeTerminal] No session found for terminal ${terminalId}`, {
        socketTerminals: Array.from(this.socketTerminals.keys()).map(k => k.substring(0, 12)),
        hasThisSocket: this.socketTerminals.has(socketId)
      });
      return;
    }
    console.log('[writeTerminal] Calling write() with sessionId:', sessionId.substring(0, 12));
    this.write(sessionId, data);
  }

  write(sessionId: string, data: string): void {
    console.log('[write] Called with sessionId:', sessionId.substring(0, 12), 'data length:', data.length);
    const session = this.sessions.get(sessionId);
    if (session) {
      console.log('[write] Session found, writing to PTY, useSidecar:', this.useSidecar);
      session.lastActivity = Date.now();
      session.pty.write(data);
      console.log('[write] PTY write completed');
    } else {
      console.warn('[write] Session not found:', sessionId.substring(0, 12));
    }
  }

  /**
   * Calculate dimensions based on active client (who last typed)
   * Falls back to first connected client if no active client
   */
  private calculateActiveClientDimensions(session: PtySession): TerminalDimensions {
    // Use active client's dimensions if available
    if (session.activeSocketId && session.clientDimensions.has(session.activeSocketId)) {
      return session.clientDimensions.get(session.activeSocketId)!;
    }

    // Fallback: use first connected client's dimensions
    if (session.clientDimensions.size > 0) {
      const firstDims = session.clientDimensions.values().next().value;
      if (firstDims) return firstDims;
    }

    // Default fallback
    return { cols: 80, rows: 24 };
  }

  /**
   * Mark a client as active (typing) and update PTY dimensions if needed
   * Returns new dimensions if they changed, null otherwise
   */
  markClientActive(sessionId: string, socketId: string): TerminalDimensions | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // If this client is already active, no change needed
    if (session.activeSocketId === socketId) {
      return null;
    }

    // Mark this client as active
    session.activeSocketId = socketId;
    console.log(`[markClientActive] Session ${sessionId.slice(0,8)}: active client changed to ${socketId.slice(0,8)}`);

    // Get the new active client's dimensions
    const clientDims = session.clientDimensions.get(socketId);
    if (!clientDims) {
      return null;  // Client hasn't reported dimensions yet
    }

    // Check if dimensions need to change
    if (clientDims.cols !== session.effectiveDimensions.cols ||
        clientDims.rows !== session.effectiveDimensions.rows) {
      session.effectiveDimensions = { ...clientDims };
      session.pty.resize(clientDims.cols, clientDims.rows);
      console.log(`[markClientActive] PTY resized to ${clientDims.cols}x${clientDims.rows} for active client`);
      return session.effectiveDimensions;
    }

    return null;
  }

  /**
   * Resize a specific terminal - tracks per-client dimensions
   * Only applies dimensions if this client is the active typer
   * Returns the effective dimensions if they changed, null otherwise
   */
  resizeTerminal(terminalId: string, socketId: string, cols: number, rows: number): TerminalDimensions | null {
    const sessionId = this.getSessionForTerminal(terminalId, socketId);
    if (!sessionId) {
      console.warn(`No session found for terminal ${terminalId}`);
      return null;
    }

    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Store this client's dimensions
    session.clientDimensions.set(socketId, { cols, rows });

    // Only resize PTY if this client is the creator (active client)
    // Dimensions are fixed to whoever created the terminal
    if (session.activeSocketId === socketId) {
      // This is the creator - use their dimensions
      if (cols !== session.effectiveDimensions.cols ||
          rows !== session.effectiveDimensions.rows) {
        session.effectiveDimensions = { cols, rows };
        session.pty.resize(cols, rows);
        console.log(`[resizeTerminal] Terminal ${terminalId.slice(0,8)}: creator resized to ${cols}x${rows}`);
        return session.effectiveDimensions;
      }
    }
    // Non-creators can't resize - dimensions stay fixed

    return null;
  }

  /**
   * Get the effective dimensions for a session
   */
  getEffectiveDimensions(sessionId: string): TerminalDimensions | null {
    const session = this.sessions.get(sessionId);
    return session ? session.effectiveDimensions : null;
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.effectiveDimensions = { cols, rows };
      session.pty.resize(cols, rows);
    }
  }

  killSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Clear batch timer to prevent memory leaks
      if (session.batchTimeout) {
        clearTimeout(session.batchTimeout);
        session.batchTimeout = null;
      }
      session.pendingData = '';
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

  /**
   * Get scrollback buffer for a session (for sending to late-joining clients)
   */
  getScrollback(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) return '';
    return session.scrollbackBuffer.join('');
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
    this.stopSidecarProcess();
  }
}
