import { Express, Request, Response } from 'express';
import httpProxy from 'http-proxy';

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  ws: true,
  xfwd: true
});

// Track the last active preview port for absolute path requests
let activePreviewPort: number | null = null;

// Add CORS headers to proxy responses
proxy.on('proxyRes', (proxyRes, req, res) => {
  // Allow requests from any origin (needed for iframe preview)
  proxyRes.headers['access-control-allow-origin'] = '*';
  proxyRes.headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS, HEAD';
  proxyRes.headers['access-control-allow-headers'] = '*';
});

// Handle proxy errors gracefully
proxy.on('error', (err: Error & { code?: string }, req, res) => {
  console.error('Proxy error:', err.message || err.code || err);
  // Don't try to send response here - it's handled in the route handlers
});

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

// Extract port from Referer header (e.g., /preview/3000/...)
function getPortFromReferer(referer: string | undefined): number | null {
  if (!referer) return null;
  const match = referer.match(/\/preview\/(\d+)/);
  if (match) {
    const port = parseInt(match[1], 10);
    return isValidPort(port) ? port : null;
  }
  return null;
}

export function setupPortProxy(app: Express): void {
  // Claude-mem API paths - ALWAYS proxy to 37777
  // These are specific claude-mem endpoints that don't conflict with our file API (/api/files/*)
  const memoryApiPaths = [
    '/api/projects',
    '/api/settings',
    '/api/stats',
    '/api/observations',
    '/api/summaries',
    '/api/prompts',
    '/api/context',
    '/stream'
  ];

  memoryApiPaths.forEach(apiPath => {
    app.use(apiPath, (req: Request, res: Response) => {
      const target = 'http://localhost:37777';
      const fullPath = apiPath + (req.url || '');
      req.url = fullPath;

      proxy.web(req, res, { target }, (err) => {
        console.error(`Claude-mem API proxy error for ${apiPath}:`, err.message);
        res.status(502).json({
          error: 'Memory API unavailable',
          message: 'Could not connect to claude-mem at localhost:37777. Is it running?'
        });
      });
    });
  });

  // Memory proxy fallback - localhost:37777 (for any other /memory/* paths)
  app.use('/memory', (req: Request, res: Response) => {
    const target = 'http://localhost:37777';

    // Rewrite path to remove /memory prefix
    req.url = req.url?.replace(/^\/memory/, '') || '/';

    proxy.web(req, res, { target }, (err) => {
      console.error('Memory proxy error:', err.message);
      res.status(502).json({
        error: 'Memory service unavailable',
        message: 'Could not connect to claude-mem at localhost:37777. Is it running?'
      });
    });
  });

  // Dynamic port proxy - /preview/:port/*
  app.use('/preview/:port', (req: Request, res: Response) => {
    // Add CORS headers for preview requests
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
    res.header('Access-Control-Allow-Headers', '*');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    const port = parseInt(req.params.port, 10);

    if (!isValidPort(port)) {
      res.status(400).json({ error: 'Invalid port number' });
      return;
    }

    // Track this as the active preview port for absolute path requests
    activePreviewPort = port;

    const target = `http://localhost:${port}`;

    // Rewrite path to remove /preview/:port prefix
    const originalPath = req.url || '/';
    req.url = originalPath;

    console.log(`Proxying ${req.method} /preview/${port}${originalPath} -> ${target}${originalPath}`);

    proxy.web(req, res, { target, timeout: 30000 }, (err: any) => {
      const errorMsg = err?.message || err?.code || 'Unknown error';
      console.error(`Preview proxy error for port ${port}: ${errorMsg}`);
      if (!res.headersSent) {
        res.status(502).json({
          error: 'Preview service unavailable',
          message: `Could not connect to localhost:${port}. Error: ${errorMsg}`
        });
      }
    });
  });

  // Catch-all routes for dev server absolute paths (Next.js, Vite, etc.)
  // These use the Referer header or the last active preview port
  const devServerPaths = ['/_next', '/__vite', '/@vite', '/@fs', '/@id', '/node_modules/.vite', '/__webpack_hmr'];

  devServerPaths.forEach(pathPrefix => {
    app.use(pathPrefix, (req: Request, res: Response) => {
      // Add CORS headers for all requests (needed for fonts, etc.)
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
      res.header('Access-Control-Allow-Headers', '*');

      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }

      // Try to get port from Referer header first, then fall back to active port
      const refererPort = getPortFromReferer(req.headers.referer);
      const port = refererPort || activePreviewPort;

      if (!port) {
        res.status(400).json({
          error: 'No active preview',
          message: 'Could not determine which preview server to proxy to. Open a preview first.'
        });
        return;
      }

      const target = `http://localhost:${port}`;
      const fullPath = pathPrefix + (req.url || '');
      req.url = fullPath;

      proxy.web(req, res, { target }, (err) => {
        console.error(`Dev server proxy error for port ${port}:`, err.message);
        if (!res.headersSent) {
          res.status(502).json({
            error: 'Dev server unavailable',
            message: `Could not connect to localhost:${port}`
          });
        }
      });
    });
  });
}

// Export for WebSocket upgrade handling
export function setupWebSocketProxy(server: import('http').Server): void {
  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '';

    // Handle memory WebSocket
    if (url.startsWith('/memory')) {
      const target = 'http://localhost:37777';
      req.url = url.replace(/^\/memory/, '') || '/';
      proxy.ws(req, socket, head, { target });
      return;
    }

    // Handle preview WebSocket - extract port from URL
    const previewMatch = url.match(/^\/preview\/(\d+)(.*)/);
    if (previewMatch) {
      const port = parseInt(previewMatch[1], 10);
      if (isValidPort(port)) {
        activePreviewPort = port;
        const target = `http://localhost:${port}`;
        req.url = previewMatch[2] || '/';
        proxy.ws(req, socket, head, { target });
      }
      return;
    }

    // Handle dev server WebSocket paths (HMR) using active preview port
    const devServerWsPaths = ['/_next', '/__vite', '/@vite', '/__webpack_hmr'];
    const isDevServerPath = devServerWsPaths.some(prefix => url.startsWith(prefix));

    if (isDevServerPath && activePreviewPort) {
      const target = `http://localhost:${activePreviewPort}`;
      // Keep the original path for dev server
      proxy.ws(req, socket, head, { target });
      return;
    }

    // Handle memory WebSocket (if claude-mem uses WebSockets)
    if (url.startsWith('/stream') || url.startsWith('/api/')) {
      const target = 'http://localhost:37777';
      proxy.ws(req, socket, head, { target });
      return;
    }
  });
}
