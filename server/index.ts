import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { setupAuth, authMiddleware, AUTH_COOKIE_NAME } from './auth.js';
import { PtyManager } from './pty-manager.js';
import { setupFileApi } from './file-api.js';
import { setupPortProxy, setupWebSocketProxy } from './port-proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';
const PORT = parseInt(process.env.PORT || '3456', 10);

const app = express();
const server = createServer(app);

// CORS origins for development (Vite may use different ports)
const devOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
  'http://127.0.0.1:5176'
];

const io = new Server(server, {
  cors: {
    origin: isProduction ? false : devOrigins,
    credentials: true
  }
});

// Middleware
app.use(express.json());
app.use(cookieParser());

// CORS for REST API in development
if (!isProduction) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && devOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });
}

// Initialize PTY manager
const ptyManager = new PtyManager();

// Setup auth routes (login, logout)
setupAuth(app);

// Setup port proxy (must be before static files)
setupPortProxy(app);

// Setup WebSocket proxy for HMR (dev servers)
setupWebSocketProxy(server);

// Setup file API (protected)
setupFileApi(app, authMiddleware);

// Proxy claude-mem API routes to localhost:37777 (only when service is available)
const CLAUDE_MEM_PORT = 37777;

// Create proxy with proper error handling that won't crash the server
const createClaudeMemProxy = (pathRewrite?: Record<string, string>) => {
  return createProxyMiddleware({
    target: `http://localhost:${CLAUDE_MEM_PORT}`,
    changeOrigin: true,
    timeout: 3000,
    proxyTimeout: 3000,
    ...(pathRewrite ? { pathRewrite } : {}),
    on: {
      error: (_err, _req, res) => {
        // Silently handle errors - claude-mem may not be running
        try {
          const response = res as express.Response;
          if (response && typeof response.status === 'function' && !response.headersSent) {
            response.status(503).json({ error: 'Memory service unavailable' });
          }
        } catch {
          // Response already sent or closed
        }
      },
    },
  });
};

// Proxy /memory/api/* to claude-mem (for legacy routes)
app.use('/memory/api', createClaudeMemProxy({ '^/memory/api': '/api' }));

// Proxy specific claude-mem API routes (these don't conflict with our /api/files or /api/auth)
const claudeMemRoutes = ['/api/projects', '/api/settings', '/api/prompts', '/api/observations', '/api/summaries', '/api/search'];
claudeMemRoutes.forEach(route => {
  app.use(route, createClaudeMemProxy());
});

// Serve memory viewer files (in both dev and prod)
// This includes memory-viewer.html and its dependencies (viewer-bundle.js, icons, fonts)
const publicPath = isProduction
  ? path.join(__dirname, '../client')
  : path.join(__dirname, '../public');

app.get('/memory-viewer.html', (req, res) => {
  const filePath = path.join(publicPath, 'memory-viewer.html');
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('Error serving memory-viewer.html:', err.message, 'Path:', filePath);
      if (!res.headersSent) {
        res.status(404).send('Memory viewer not found');
      }
    }
  });
});
app.get('/viewer-bundle.js', (req, res) => {
  const filePath = path.join(publicPath, 'viewer-bundle.js');
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).send('Viewer bundle not found');
    }
  });
});
app.get('/claude-mem-logomark.webp', (req, res) => {
  const filePath = path.join(publicPath, 'claude-mem-logomark.webp');
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).send('Logo not found');
    }
  });
});
app.use('/assets', express.static(path.join(publicPath, 'assets')));
app.get('/icon-thick-:name.svg', (req, res) => {
  res.sendFile(path.join(publicPath, `icon-thick-${req.params.name}.svg`));
});

// Serve static files in production
if (isProduction) {
  const clientPath = path.join(__dirname, '../client');
  app.use(express.static(clientPath));
  app.get('*', authMiddleware, (req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
  });
}

// Socket.io authentication
io.use((socket, next) => {
  // Skip auth in development mode
  if (!isProduction) {
    return next();
  }

  const cookies = socket.handshake.headers.cookie;
  if (!cookies) {
    return next(new Error('Authentication required'));
  }

  // Parse cookies manually
  const cookieObj: Record<string, string> = {};
  cookies.split(';').forEach(cookie => {
    const [key, value] = cookie.trim().split('=');
    if (key && value) cookieObj[key] = value;
  });

  const token = cookieObj[AUTH_COOKIE_NAME];
  if (!token || token !== process.env.AUTH_TOKEN) {
    return next(new Error('Invalid authentication'));
  }

  next();
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Track legacy session for backward compatibility
  let legacySessionId: string | null = null;

  // ========================================
  // NEW MULTI-TERMINAL EVENTS
  // ========================================

  // Create a new terminal with specific terminalId
  socket.on('terminal:create', (data: { terminalId: string; cols?: number; rows?: number; sessionId?: string }) => {
    const { terminalId, cols = 80, rows = 24, sessionId } = data;

    // Check if trying to restore an existing session
    if (sessionId && ptyManager.hasSession(sessionId)) {
      // Restore existing session
      const attached = ptyManager.attachTerminal(terminalId, sessionId, socket.id);
      if (attached) {
        // Set up data handler
        ptyManager.onTerminalData(terminalId, socket.id, (tid, termData) => {
          socket.emit('terminal:data', { terminalId: tid, data: termData });
        });
        socket.emit('terminal:created', { terminalId, sessionId, restored: true });
        console.log(`Terminal ${terminalId} restored session ${sessionId} for ${socket.id}`);
        return;
      }
    }

    // Create new session
    const newSessionId = ptyManager.createTerminal(terminalId, socket.id, cols, rows);
    if (!newSessionId) {
      socket.emit('terminal:error', { terminalId, message: 'Failed to create terminal session' });
      console.error(`Failed to create terminal ${terminalId} for ${socket.id}`);
      return;
    }

    // Set up data handler
    ptyManager.onTerminalData(terminalId, socket.id, (tid, termData) => {
      socket.emit('terminal:data', { terminalId: tid, data: termData });
    });

    socket.emit('terminal:created', { terminalId, sessionId: newSessionId, restored: false });
    console.log(`Terminal ${terminalId} created with session ${newSessionId} for ${socket.id}`);
  });

  // Destroy a terminal
  socket.on('terminal:destroy', (data: { terminalId: string }) => {
    const { terminalId } = data;
    ptyManager.destroyTerminal(terminalId, socket.id);
    socket.emit('terminal:destroyed', { terminalId });
    console.log(`Terminal ${terminalId} destroyed for ${socket.id}`);
  });

  // Restore multiple terminals at once (on reconnect)
  socket.on('terminal:restore', (data: { terminals: Array<{ terminalId: string; sessionId: string; cols?: number; rows?: number }> }) => {
    const results: Array<{ terminalId: string; sessionId: string; restored: boolean }> = [];

    for (const term of data.terminals) {
      const { terminalId, sessionId, cols = 80, rows = 24 } = term;

      if (ptyManager.hasSession(sessionId)) {
        // Restore existing session
        const attached = ptyManager.attachTerminal(terminalId, sessionId, socket.id);
        if (attached) {
          // Set up data handler
          ptyManager.onTerminalData(terminalId, socket.id, (tid, termData) => {
            socket.emit('terminal:data', { terminalId: tid, data: termData });
          });
          results.push({ terminalId, sessionId, restored: true });
          console.log(`Terminal ${terminalId} restored session ${sessionId}`);
          continue;
        }
      }

      // Session doesn't exist or couldn't attach, create new
      const newSessionId = ptyManager.createTerminal(terminalId, socket.id, cols, rows);
      if (newSessionId) {
        ptyManager.onTerminalData(terminalId, socket.id, (tid, termData) => {
          socket.emit('terminal:data', { terminalId: tid, data: termData });
        });
        results.push({ terminalId, sessionId: newSessionId, restored: false });
        console.log(`Terminal ${terminalId} created new session ${newSessionId}`);
      } else {
        console.error(`Failed to restore/create terminal ${terminalId}`);
      }
    }

    socket.emit('terminal:restored', { terminals: results });
  });

  // ========================================
  // LEGACY SINGLE-TERMINAL EVENTS (backward compatible)
  // ========================================

  // Join or create terminal session (legacy - for single terminal)
  socket.on('terminal:join', (data: { sessionId?: string; cols?: number; rows?: number }) => {
    const cols = data.cols || 80;
    const rows = data.rows || 24;

    if (data.sessionId && ptyManager.hasSession(data.sessionId)) {
      // Rejoin existing session
      legacySessionId = data.sessionId;
      ptyManager.attachSocket(legacySessionId, socket.id);
      socket.emit('terminal:joined', { sessionId: legacySessionId, restored: true });
      console.log(`Client ${socket.id} rejoined legacy session ${legacySessionId}`);
    } else {
      // Create new session
      const newSessionId = ptyManager.createSession(cols, rows, socket.id);
      if (!newSessionId) {
        socket.emit('terminal:error', { message: 'Failed to create terminal session' });
        console.error(`Failed to create legacy session for ${socket.id}`);
        return;
      }
      legacySessionId = newSessionId;
      socket.emit('terminal:joined', { sessionId: legacySessionId, restored: false });
      console.log(`Client ${socket.id} created legacy session ${legacySessionId}`);
    }

    // Set up data handler for this socket
    if (legacySessionId) {
      ptyManager.onData(legacySessionId, (data) => {
        socket.emit('terminal:data', data);
      });
    }
  });

  // Handle terminal input (supports both new and legacy formats)
  socket.on('terminal:input', (data: string | { terminalId: string; data: string }) => {
    if (typeof data === 'string') {
      // Legacy format - single terminal
      if (legacySessionId) {
        ptyManager.write(legacySessionId, data);
      }
    } else {
      // New format - multi-terminal
      const { terminalId, data: inputData } = data;
      ptyManager.writeTerminal(terminalId, socket.id, inputData);
    }
  });

  // Handle terminal resize (supports both new and legacy formats)
  socket.on('terminal:resize', (data: { cols: number; rows: number } | { terminalId: string; cols: number; rows: number }) => {
    if ('terminalId' in data) {
      // New format - multi-terminal
      const { terminalId, cols, rows } = data;
      ptyManager.resizeTerminal(terminalId, socket.id, cols, rows);
    } else {
      // Legacy format - single terminal
      if (legacySessionId) {
        ptyManager.resize(legacySessionId, data.cols, data.rows);
      }
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    // Detach all multi-terminal sessions
    ptyManager.detachAllTerminals(socket.id);

    // Handle legacy session
    if (legacySessionId) {
      ptyManager.detachSocket(legacySessionId, socket.id);
      // Don't kill the session immediately - allow reconnection
      // Session will be cleaned up after timeout
    }
  });
});

// Global error handlers to prevent crashes
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Don't exit - try to keep running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - try to keep running
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  ptyManager.killAllSessions();
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  ptyManager.killAllSessions();
  server.close(() => {
    process.exit(0);
  });
});

server.listen(PORT, () => {
  console.log(`Mobile Terminal server running on http://localhost:${PORT}`);
  if (!process.env.AUTH_TOKEN) {
    console.log('WARNING: No AUTH_TOKEN set. Using default password.');
  }
});
