import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { spawn, execSync, ChildProcess } from 'child_process';
import { existsSync, createWriteStream, mkdirSync } from 'fs';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { setupAuth, authMiddleware, AUTH_COOKIE_NAME } from './auth.js';
import { PtyManager } from './pty-manager.js';
import { setupFileApi } from './file-api.js';
import { setupPortProxy, setupWebSocketProxy } from './port-proxy.js';
import { getPinSettings, savePinSettings } from './pin-settings.js';
import {
  getTabSettings,
  saveTabSettings,
  addTab,
  removeTab,
  renameTab,
  setTabSessionId,
  resetTabs,
  type SyncedTab,
} from './tab-settings.js';
import {
  getFavorites,
  saveFavorites,
} from './favorites-settings.js';
import {
  getCommands,
  saveCommands,
} from './commands-settings.js';
import {
  initializePushNotifications,
  getVapidPublicKey,
  addSubscription,
  removeSubscription,
  notifyClaudeStop,
  getSubscriptionCount,
} from './push-notifications.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';

const resolveLsofPath = () => {
  if (existsSync('/usr/sbin/lsof')) return '/usr/sbin/lsof';
  if (existsSync('/usr/bin/lsof')) return '/usr/bin/lsof';
  return 'lsof';
};

const LSOF_PATH = resolveLsofPath();

// Ensure npm's script env doesn't leak into shells (breaks nvm/claude PATH).
const stripNpmEnv = () => {
  delete process.env.npm_config_prefix;
  delete process.env.NPM_CONFIG_PREFIX;
  delete process.env.npm_config_userconfig;
  delete process.env.NPM_CONFIG_USERCONFIG;
  delete process.env.npm_config_globalconfig;
  delete process.env.NPM_CONFIG_GLOBALCONFIG;
  delete process.env.PREFIX;
  delete process.env.prefix;
};

stripNpmEnv();

// Prevent broken pipes from crashing the dev server when parent stdio closes.
const ignoreEpipe = (stream: NodeJS.WriteStream, label: string) => {
  stream.on('error', (err) => {
    if (err && err.code === 'EPIPE') return;
    console.error(`[Server:${label}] stream error`, err);
  });
};

ignoreEpipe(process.stdout, 'stdout');
ignoreEpipe(process.stderr, 'stderr');

// Optional log file for bundled app diagnostics
if (process.env.SERVER_LOG) {
  try {
    mkdirSync(path.dirname(process.env.SERVER_LOG), { recursive: true });
    const logStream = createWriteStream(process.env.SERVER_LOG, { flags: 'a' });
    logStream.on('error', (err) => {
      if (err && err.code === 'EPIPE') return;
      console.error('SERVER_LOG stream error:', err);
    });
    const logLine = (level: string, args: unknown[]) => {
      try {
        const message = args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
        logStream.write(`[${new Date().toISOString()}] [${level}] ${message}\n`);
      } catch {
        // Ignore log write failures (e.g., broken pipe).
      }
    };

    const originalLog = console.log.bind(console);
    const originalError = console.error.bind(console);

    console.log = (...args: unknown[]) => {
      originalLog(...args);
      logLine('INFO', args);
    };
    console.error = (...args: unknown[]) => {
      originalError(...args);
      logLine('ERROR', args);
    };
  } catch (error) {
    // Fall back to console only if log file fails.
    console.error('Failed to initialize SERVER_LOG:', error);
  }
}

// Auto-set NODE_PTY_BINARY for Tauri app bundle
if (!process.env.NODE_PTY_BINARY && process.env.NODE_ENV === 'production') {
  // Check if we're running from the Tauri app bundle
  if (__dirname.includes('Terminal Tunnel.app')) {
    process.env.NODE_PTY_BINARY = path.join(__dirname, 'node_modules/node-pty/prebuilds/darwin-arm64/pty.node');
    console.log('Auto-set NODE_PTY_BINARY for Tauri bundle:', process.env.NODE_PTY_BINARY);
  }
}

// Debug environment variables at startup
console.log('Environment variables at startup:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('NODE_PTY_BINARY:', process.env.NODE_PTY_BINARY);
console.log('SHELL:', process.env.SHELL);
console.log('PATH (first 100 chars):', process.env.PATH?.substring(0, 100));
const PORT = parseInt(process.env.PORT || '3456', 10);

// Force-kill any process using our port to prevent startup conflicts
// This ensures the app ALWAYS starts successfully
function killPort(port: number): void {
  try {
    // macOS/Linux: Find and kill any process on this port
    execSync(`${LSOF_PATH} -ti:${port} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
    console.log(`[Server] Cleared port ${port}`);
  } catch {
    // Ignore errors - port may already be free
  }
}

// Kill our server port before starting
killPort(PORT);

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
  'http://127.0.0.1:5176',
  'http://localhost:3456',   // Tauri dev mode loads from Express server
  'http://127.0.0.1:3456'
];

// Helper function to detect Cloudflare tunnel requests
function isTunnelRequest(req: express.Request): boolean {
  const host = req.get('host') || '';
  // Cloudflare tunnel URLs: *.trycloudflare.com or custom domains
  // Also check for Cloudflare-specific headers
  return host.includes('trycloudflare.com') ||
         req.get('CF-RAY') !== undefined ||
         req.get('CF-Visitor') !== undefined;
}

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // No origin header (same-origin requests) - allow in both dev and prod
      // This happens when Tauri webview loads from localhost:3456 and connects to same origin
      if (!origin) {
        return callback(null, true);
      }

      // Development - check whitelist
      if (!isProduction && devOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Tunnel mode - allow requests from Cloudflare tunnel URLs
      // Socket.io doesn't provide req object, so check against known tunnel patterns
      if (origin.includes('trycloudflare.com')) {
        return callback(null, true);
      }

      // Reject all other origins
      callback(new Error('CORS not allowed'));
    },
    credentials: true
  }
});

// Middleware
app.use(express.json());
app.use(cookieParser());

// Health check endpoint - used by Tauri to verify server is ready
// No auth required, responds immediately
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// CORS for REST API - handle development, production, and tunnel modes
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const host = req.get('host');

  // Log CORS decision for debugging
  if (origin) {
    console.log(`[CORS] ${req.method} ${req.path} - Origin: ${origin}, Host: ${host}, Tunnel: ${isTunnelRequest(req)}`);
  }

  if (origin) {
    try {
      const originHost = new URL(origin).host;

      // Allow same-origin requests (works for tunnel and embedded modes)
      if (originHost === host) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        console.log(`[CORS] ✅ Allowed (same-origin): ${origin}`);
      }
      // Also allow whitelisted dev origins in development mode
      else if (!isProduction && devOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        console.log(`[CORS] ✅ Allowed (dev whitelist): ${origin}`);
      }
      else {
        console.log(`[CORS] ❌ Origin not allowed: ${origin}`);
      }
    } catch (err) {
      console.error('[CORS] Invalid origin URL:', origin, err);
    }
  }

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }

  next();
});

// Initialize PTY manager
const ptyManager = new PtyManager();

// Clean stale session IDs on server startup
// PTY sessions are in-memory, so any sessionIds in tabs.json from previous runs are stale
(async function cleanStaleTabSessions() {
  try {
    const settings = await getTabSettings();
    let needsUpdate = false;
    for (const tab of settings.tabs) {
      if (tab.sessionId) {
        // Server just started, no PTY sessions exist yet - clear all sessionIds
        tab.sessionId = null;
        needsUpdate = true;
      }
    }
    if (needsUpdate) {
      await saveTabSettings(settings);
      console.log('[Server] Cleared stale session IDs from tabs.json on startup');
    }
  } catch (err) {
    console.error('[Server] Failed to clean stale sessions on startup:', err);
  }
})();

// Track which sessions have broadcast handlers set up (to prevent double broadcasts)
const sessionBroadcastHandlers = new Set<string>();

// Setup auth routes (login, logout)
setupAuth(app);

// PIN settings API endpoints
// GET is public - tunnel clients need to check PIN status and theme before auth
app.get('/api/pin-settings', async (_req, res) => {
  try {
    const settings = await getPinSettings();
    res.json({
      pinEnabled: settings.pinEnabled,
      pinHash: settings.pinHash,
      themeName: settings.themeName,
    });
  } catch (error) {
    console.error('Failed to get PIN settings:', error);
    res.status(500).json({ error: 'Failed to get PIN settings' });
  }
});

// PUT requires auth - only localhost/desktop can modify settings
app.put('/api/pin-settings', authMiddleware, async (req, res) => {
  try {
    const { pinEnabled, pinHash, themeName } = req.body;

    // Build update object - only include fields that are provided
    const updateData: { pinEnabled?: boolean; pinHash?: string | null; themeName?: string } = {};

    // Handle PIN settings if provided
    if (typeof pinEnabled === 'boolean') {
      updateData.pinEnabled = pinEnabled;
      // If enabling PIN, validate hash format (SHA-256 = 64 hex chars)
      if (pinEnabled) {
        if (typeof pinHash !== 'string' || pinHash.length !== 64) {
          res.status(400).json({ error: 'Invalid PIN hash format' });
          return;
        }
        updateData.pinHash = pinHash;
      } else {
        updateData.pinHash = null;
      }
    }

    // Handle theme update if provided
    if (typeof themeName === 'string') {
      updateData.themeName = themeName;
    }

    // If nothing to update, return current settings
    if (Object.keys(updateData).length === 0) {
      const current = await getPinSettings();
      res.json({
        pinEnabled: current.pinEnabled,
        pinHash: current.pinHash,
        themeName: current.themeName,
      });
      return;
    }

    const updated = await savePinSettings(updateData);

    res.json({
      pinEnabled: updated.pinEnabled,
      pinHash: updated.pinHash,
      themeName: updated.themeName,
    });
  } catch (error) {
    console.error('Failed to save PIN settings:', error);
    res.status(500).json({ error: 'Failed to save PIN settings' });
  }
});

// Tab reset endpoint - clears server-side tab state during onboarding
app.post('/api/tabs/reset', async (_req, res) => {
  try {
    const settings = await resetTabs();
    // Broadcast to all connected clients that tabs have been reset
    io.emit('tabs:sync', { tabs: settings.tabs, lastModified: settings.lastModified });
    res.json({ success: true, tabs: settings.tabs });
  } catch (error) {
    console.error('Failed to reset tabs:', error);
    res.status(500).json({ error: 'Failed to reset tabs' });
  }
});

// Favorites endpoint - sets favorites during onboarding and syncs to all clients
app.post('/api/favorites', async (req, res) => {
  try {
    const { favorites } = req.body;
    if (!Array.isArray(favorites)) {
      return res.status(400).json({ error: 'favorites must be an array' });
    }
    const settings = await saveFavorites(favorites);
    // Broadcast to all connected clients
    io.emit('favorites:sync', { favorites: settings.favorites, lastModified: settings.lastModified });
    console.log(`Favorites set via API (${settings.favorites.length} items)`);
    res.json(settings);
  } catch (error) {
    console.error('Failed to save favorites:', error);
    res.status(500).json({ error: 'Failed to save favorites' });
  }
});

// Claude Code detection endpoint
app.get('/api/claude-code/detect', async (_req, res) => {
  const fsPromises = await import('fs/promises');
  const { execSync } = await import('child_process');

  const results = {
    installed: false,
    claudeDir: false,
    claudeBinary: null as string | null,
    configExists: false,
    npmPackage: false,
    version: null as string | null,
    paths: [] as string[],
    method: '' as string,
  };

  try {
    const homeDir = os.homedir();
    const claudeDir = path.join(homeDir, '.claude');

    // 1. FASTEST: Check ~/.claude/settings.json (definitive proof)
    const settingsPath = path.join(claudeDir, 'settings.json');
    try {
      await fsPromises.access(settingsPath);
      results.installed = true;
      results.claudeDir = true;
      results.configExists = true;
      results.method = 'Found ~/.claude/settings.json';
      results.paths.push(claudeDir);
      console.log('[ClaudeCode] Detected via settings.json');
      return res.json(results);
    } catch {
      // Continue
    }

    // 2. Check ~/.claude directory with any config indicator
    try {
      const stats = await fsPromises.stat(claudeDir);
      if (stats.isDirectory()) {
        results.claudeDir = true;
        results.paths.push(claudeDir);

        const indicators = ['settings.local.json', 'projects', 'statsig', 'credentials.json', 'claude-ssh-wrapper.sh'];
        for (const indicator of indicators) {
          try {
            await fsPromises.access(path.join(claudeDir, indicator));
            results.configExists = true;
            results.installed = true;
            results.method = `Found ${indicator} in ~/.claude`;
            console.log(`[ClaudeCode] Detected via ${indicator}`);
            return res.json(results);
          } catch {
            // Continue
          }
        }
      }
    } catch {
      // Directory doesn't exist
    }

    // 3. Check nvm paths
    const nvmDir = path.join(homeDir, '.nvm', 'versions', 'node');
    try {
      const nodeVersions = await fsPromises.readdir(nvmDir);
      for (const version of nodeVersions) {
        const claudePath = path.join(nvmDir, version, 'bin', 'claude');
        try {
          await fsPromises.access(claudePath);
          results.claudeBinary = claudePath;
          results.installed = true;
          results.method = `Found in nvm ${version}`;
          results.paths.push(claudePath);
          console.log(`[ClaudeCode] Detected in nvm ${version}`);
          return res.json(results);
        } catch {
          // Not in this version
        }
      }
    } catch {
      // nvm not installed
    }

    // 4. Check common paths
    const commonPaths = [
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      path.join(homeDir, '.local', 'bin', 'claude'),
      path.join(homeDir, '.npm-global', 'bin', 'claude'),
      '/usr/bin/claude',
    ];

    for (const p of commonPaths) {
      try {
        await fsPromises.access(p);
        results.claudeBinary = p;
        results.installed = true;
        results.method = `Found at ${p}`;
        results.paths.push(p);
        console.log(`[ClaudeCode] Detected at ${p}`);
        return res.json(results);
      } catch {
        // Path doesn't exist
      }
    }

    // 5. Shell command fallback (slower)
    try {
      const cmdResult = execSync('command -v claude 2>/dev/null || which claude 2>/dev/null', {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();
      if (cmdResult) {
        results.claudeBinary = cmdResult;
        results.installed = true;
        results.method = 'Found via shell';
        results.paths.push(cmdResult);
      }
    } catch {
      // Shell check failed
    }

    // 6. npm check fallback (slowest)
    if (!results.installed) {
      try {
        const npmResult = execSync('npm list -g @anthropic-ai/claude-code 2>/dev/null', {
          encoding: 'utf-8',
          timeout: 5000,
        });
        if (npmResult.includes('@anthropic-ai/claude-code')) {
          results.npmPackage = true;
          results.installed = true;
          const versionMatch = npmResult.match(/@anthropic-ai\/claude-code@([\d.]+)/);
          if (versionMatch) results.version = versionMatch[1];
          results.method = 'Found via npm';
        }
      } catch {
        // npm check failed
      }
    }

    console.log('[ClaudeCode] Detection results:', results);
    res.json(results);
  } catch (error) {
    console.error('[ClaudeCode] Detection error:', error);
    res.status(500).json({ error: 'Detection failed', installed: false });
  }
});

// claude-mem detection endpoint
app.get('/api/claude-mem/detect', async (_req, res) => {
  const fs = await import('fs/promises');

  const results = {
    installed: false,
    running: false,
    directory: null as string | null,
    version: null as string | null,
  };

  try {
    const homeDir = os.homedir();

    // Check if ~/.claude-mem directory exists
    const claudeMemDir = path.join(homeDir, '.claude-mem');
    try {
      const stats = await fs.stat(claudeMemDir);
      if (stats.isDirectory()) {
        results.directory = claudeMemDir;
        results.installed = true;

        // Try to read version from package.json
        try {
          const pkgPath = path.join(claudeMemDir, 'package.json');
          const pkgContent = await fs.readFile(pkgPath, 'utf-8');
          const pkg = JSON.parse(pkgContent);
          results.version = pkg.version || null;
        } catch {
          // No package.json or invalid
        }
      }
    } catch {
      // Directory doesn't exist
    }

    // Check if claude-mem service is running on port 37777
    try {
      const response = await fetch('http://127.0.0.1:37777/api/settings', {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        results.running = true;
        results.installed = true;
      }
    } catch {
      // Service not running
    }

    res.json(results);
  } catch (error) {
    console.error('Failed to detect claude-mem:', error);
    res.status(500).json({ error: 'Failed to detect claude-mem', installed: false });
  }
});

// claude-mem installation endpoint
app.post('/api/claude-mem/install', authMiddleware, async (_req, res) => {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const fs = await import('fs/promises');
  const execAsync = promisify(exec);

  try {
    const homeDir = os.homedir();
    const installDir = path.join(homeDir, '.claude-mem');
    const claudeSettingsPath = path.join(homeDir, '.claude', 'settings.json');
    const workerPath = path.join(installDir, 'plugin', 'scripts', 'worker-service.cjs');

    // Check if already installed
    try {
      await fs.access(workerPath);
      // Already installed - just start the worker and return success
      console.log('[claude-mem] Already installed, starting worker...');
      startClaudeMem();
      return res.json({ success: true, directory: installDir, alreadyInstalled: true });
    } catch {
      // Not installed, continue with installation
    }

    // Clone the repository
    console.log('[claude-mem] Starting installation...');
    await execAsync(`git clone https://github.com/thedotmack/claude-mem "${installDir}"`, {
      timeout: 60000,
    });

    // Install dependencies using bun (required for bun:sqlite native module)
    console.log('[claude-mem] Installing dependencies with bun...');
    await execAsync('bun install', {
      cwd: installDir,
      timeout: 120000,
    });

    // Build the project (compiles TypeScript to worker-service.cjs)
    console.log('[claude-mem] Building worker service...');
    await execAsync('bun run build', {
      cwd: installDir,
      timeout: 120000,
    });

    // Register hooks in Claude Code settings
    console.log('[claude-mem] Registering hooks in Claude Code settings...');
    const hooksPath = path.join(installDir, 'plugin', 'hooks', 'hooks.json');

    try {
      const hooksContent = await fs.readFile(hooksPath, 'utf-8');
      const hooksConfig = JSON.parse(hooksContent);

      // Read existing Claude settings
      let claudeSettings: Record<string, any> = {};
      try {
        const existing = await fs.readFile(claudeSettingsPath, 'utf-8');
        claudeSettings = JSON.parse(existing);
      } catch {
        // Settings file doesn't exist, start fresh
        claudeSettings = {};
      }

      // Process hooks - replace ${CLAUDE_PLUGIN_ROOT} with actual plugin path
      // Scripts are in installDir/plugin/scripts/, so CLAUDE_PLUGIN_ROOT should point to installDir/plugin
      const pluginDir = path.join(installDir, 'plugin');
      const processedHooks = JSON.parse(
        JSON.stringify(hooksConfig.hooks)
          .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginDir)
      );

      // Merge hooks into settings (preserve other settings)
      claudeSettings.hooks = processedHooks;

      // Write updated settings
      await fs.writeFile(claudeSettingsPath, JSON.stringify(claudeSettings, null, 2));
      console.log('[claude-mem] Hooks registered successfully');
    } catch (hookError: any) {
      console.error('[claude-mem] Failed to register hooks:', hookError);
      // Continue anyway - worker can still run, hooks can be added manually
    }

    // Start the worker service automatically after installation
    console.log('[claude-mem] Installation complete');

    // Start the worker service now that it's installed
    startClaudeMem();

    res.json({ success: true, directory: installDir, hooksRegistered: true });
  } catch (error: any) {
    console.error('[claude-mem] Installation failed:', error);
    res.status(500).json({ error: error.message || 'Installation failed' });
  }
});

// claude-mem uninstall endpoint
app.post('/api/claude-mem/uninstall', authMiddleware, async (_req, res) => {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const fs = await import('fs/promises');
  const execAsync = promisify(exec);

  try {
    const homeDir = os.homedir();
    const installDir = path.join(homeDir, '.claude-mem');
    const claudeSettingsPath = path.join(homeDir, '.claude', 'settings.json');

    console.log('[claude-mem] Starting uninstall...');

    // 1. Stop worker service
    stopClaudeMem();

    // 2. Kill any remaining worker processes
    try {
      await execAsync('pkill -f "worker-service.cjs"');
    } catch {
      // Process might not exist, that's OK
    }

    // 3. Remove hooks from Claude Code settings
    try {
      const settingsContent = await fs.readFile(claudeSettingsPath, 'utf-8');
      const settings = JSON.parse(settingsContent);
      settings.hooks = {};
      await fs.writeFile(claudeSettingsPath, JSON.stringify(settings, null, 2));
      console.log('[claude-mem] Hooks removed from settings');
    } catch (e) {
      console.log('[claude-mem] Could not clean settings (may not exist)');
    }

    // 4. Remove installation directory
    try {
      await fs.rm(installDir, { recursive: true, force: true });
      console.log('[claude-mem] Installation directory removed');
    } catch (e) {
      console.log('[claude-mem] Could not remove directory (may not exist)');
    }

    // 5. Clean plugin registry
    const pluginsPath = path.join(homeDir, '.claude', 'plugins', 'installed_plugins.json');
    try {
      const pluginsContent = await fs.readFile(pluginsPath, 'utf-8');
      const plugins = JSON.parse(pluginsContent);
      if (plugins.plugins && plugins.plugins['claude-mem@thedotmack']) {
        delete plugins.plugins['claude-mem@thedotmack'];
        await fs.writeFile(pluginsPath, JSON.stringify(plugins, null, 2));
        console.log('[claude-mem] Plugin registry cleaned');
      }
    } catch {
      // Plugin registry might not exist
    }

    console.log('[claude-mem] Uninstall complete');
    res.json({ success: true, message: 'claude-mem uninstalled successfully' });
  } catch (error: any) {
    console.error('[claude-mem] Uninstall failed:', error);
    res.status(500).json({ error: error.message || 'Uninstall failed' });
  }
});

// Update claude-mem (git pull)
app.post('/api/claude-mem/update', authMiddleware, async (_req, res) => {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const fs = await import('fs/promises');
  const execAsync = promisify(exec);

  try {
    const homeDir = os.homedir();
    const installDir = path.join(homeDir, '.claude-mem');

    // Check if installed
    try {
      await fs.access(installDir);
    } catch {
      res.status(404).json({ error: 'claude-mem not installed' });
      return;
    }

    // Git pull
    console.log('[claude-mem] Checking for updates...');
    const { stdout } = await execAsync('git pull', {
      cwd: installDir,
      timeout: 60000,
    });

    const updated = !stdout.includes('Already up to date');
    if (updated) {
      console.log('[claude-mem] Updates found, reinstalling dependencies...');
      await execAsync('npm install', {
        cwd: installDir,
        timeout: 120000,
      });
    }

    console.log('[claude-mem] Update check complete');
    res.json({ success: true, updated, message: stdout.trim() });
  } catch (error: any) {
    console.error('[claude-mem] Update failed:', error);
    res.status(500).json({ error: error.message || 'Update failed' });
  }
});

// claude-mem settings management endpoint
// GET: Fetch current settings (proxied to 127.0.0.1:37777)
// POST: Update injection settings (enable/disable context injection)
app.get('/api/claude-mem/injection-settings', async (_req, res) => {
  try {
    const response = await fetch('http://127.0.0.1:37777/api/settings', {
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      res.status(503).json({ error: 'claude-mem service unavailable' });
      return;
    }

    const settings = await response.json() as Record<string, unknown>;
    res.json({
      injectionEnabled: (Number(settings.CLAUDE_MEM_CONTEXT_OBSERVATIONS) || 0) > 0,
      settings: {
        observations: Number(settings.CLAUDE_MEM_CONTEXT_OBSERVATIONS) || 0,
        sessionCount: Number(settings.CLAUDE_MEM_CONTEXT_SESSION_COUNT) || 0,
        observationTypes: String(settings.CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES || ''),
        observationConcepts: String(settings.CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS || ''),
      },
    });
  } catch (error) {
    res.status(503).json({ error: 'claude-mem service unavailable' });
  }
});

app.post('/api/claude-mem/injection-settings', authMiddleware, async (req, res) => {
  const { enabled } = req.body;

  try {
    // Fetch current settings first
    const getResponse = await fetch('http://127.0.0.1:37777/api/settings', {
      signal: AbortSignal.timeout(3000),
    });

    if (!getResponse.ok) {
      res.status(503).json({ error: 'claude-mem service unavailable' });
      return;
    }

    const currentSettings = await getResponse.json() as Record<string, unknown>;

    // Prepare updated settings
    const updatedSettings: Record<string, unknown> = { ...currentSettings };

    if (enabled) {
      // Enable injection with reasonable defaults if currently disabled
      if ((Number(updatedSettings.CLAUDE_MEM_CONTEXT_OBSERVATIONS) || 0) === 0) {
        updatedSettings.CLAUDE_MEM_CONTEXT_OBSERVATIONS = 50;
        updatedSettings.CLAUDE_MEM_CONTEXT_SESSION_COUNT = 10;
      }
    } else {
      // Disable injection by setting to 0
      updatedSettings.CLAUDE_MEM_CONTEXT_OBSERVATIONS = 0;
      updatedSettings.CLAUDE_MEM_CONTEXT_SESSION_COUNT = 0;
    }

    // Save updated settings
    const postResponse = await fetch('http://127.0.0.1:37777/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedSettings),
      signal: AbortSignal.timeout(3000),
    });

    if (!postResponse.ok) {
      res.status(500).json({ error: 'Failed to update claude-mem settings' });
      return;
    }

    console.log(`[claude-mem] Injection ${enabled ? 'enabled' : 'disabled'}`);
    res.json({
      success: true,
      injectionEnabled: enabled,
    });
  } catch (error) {
    console.error('[claude-mem] Failed to update injection settings:', error);
    res.status(503).json({ error: 'claude-mem service unavailable' });
  }
});

// Kill process on a specific port - used by preview stop button
app.post('/api/kill-port/:port', authMiddleware, async (req, res) => {
  const portStr = req.params.port;
  const port = parseInt(portStr, 10);

  // Validate port number
  if (isNaN(port) || port < 1024 || port > 65535) {
    res.status(400).json({ error: 'Invalid port number' });
    return;
  }

  // Don't allow killing our own server port
  if (port === PORT) {
    res.status(403).json({ error: 'Cannot kill terminal server port' });
    return;
  }

  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    // Use lsof to find and kill process on port (macOS)
    try {
      // First get the PID
      const { stdout: lsofOutput } = await execAsync(`${LSOF_PATH} -ti:${port}`);
      const pids = lsofOutput.trim().split('\n').filter(Boolean);

      if (pids.length === 0) {
        res.status(404).json({ error: 'No process found on port' });
        return;
      }

      // Kill each PID
      for (const pid of pids) {
        await execAsync(`kill -9 ${pid}`);
      }

      console.log(`[kill-port] Killed process(es) on port ${port}: ${pids.join(', ')}`);
      res.json({ success: true, port, pids });
    } catch (lsofError: any) {
      // If lsof returns empty/error, no process on port
      if (lsofError.code === 1) {
        res.status(404).json({ error: 'No process found on port' });
      } else {
        throw lsofError;
      }
    }
  } catch (error: any) {
    console.error(`[kill-port] Failed to kill port ${port}:`, error);
    res.status(500).json({ error: error.message || 'Failed to kill process' });
  }
});

// ========================================
// PUSH NOTIFICATION ROUTES
// ========================================

// Initialize push notification system
initializePushNotifications();

// Get VAPID public key for client subscription
app.get('/api/push/vapid-public-key', (_req, res) => {
  const publicKey = getVapidPublicKey();
  if (publicKey) {
    res.json({ publicKey });
  } else {
    res.status(500).json({ error: 'VAPID keys not configured' });
  }
});

// Subscribe to push notifications
app.post('/api/push/subscribe', (req, res) => {
  const { subscription, deviceId, userAgent } = req.body;

  if (!subscription || !deviceId) {
    res.status(400).json({ error: 'subscription and deviceId required' });
    return;
  }

  if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    res.status(400).json({ error: 'Invalid subscription format' });
    return;
  }

  addSubscription({
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    deviceId,
    createdAt: Date.now(),
    userAgent,
  });

  res.json({ success: true, subscriptionCount: getSubscriptionCount() });
});

// Unsubscribe from push notifications
app.post('/api/push/unsubscribe', (req, res) => {
  const { deviceId } = req.body;

  if (!deviceId) {
    res.status(400).json({ error: 'deviceId required' });
    return;
  }

  const removed = removeSubscription(deviceId);
  res.json({ success: removed, subscriptionCount: getSubscriptionCount() });
});

// Trigger notification (called by Claude Code stop hook)
// No auth required - hook runs locally
app.post('/api/notify', async (req, res) => {
  const { type, message } = req.body;

  console.log(`[Push] Notification triggered: type=${type}, message=${message || 'none'}`);

  try {
    await notifyClaudeStop(message);
    res.json({ success: true, subscriptionCount: getSubscriptionCount() });
  } catch (error) {
    console.error('[Push] Failed to send notification:', error);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

// Get notification status (for debugging)
app.get('/api/push/status', (_req, res) => {
  res.json({
    configured: !!getVapidPublicKey(),
    subscriptionCount: getSubscriptionCount(),
  });
});

// Setup port proxy (must be before static files)
setupPortProxy(app);

// Setup WebSocket proxy for HMR (dev servers)
setupWebSocketProxy(server);

// Setup file API (protected)
setupFileApi(app, authMiddleware);

// Proxy claude-mem API routes to 127.0.0.1:37777 (only when service is available)
const CLAUDE_MEM_PORT = 37777;

// Create proxy with proper error handling that won't crash the server
const createClaudeMemProxy = (pathRewrite?: Record<string, string>) => {
  return createProxyMiddleware({
    target: `http://127.0.0.1:${CLAUDE_MEM_PORT}`,
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

// Serve push notification service worker
// Must be explicitly served with correct headers for SW registration
app.get('/push-sw.js', (req, res) => {
  const filePath = path.join(publicPath, 'push-sw.js');
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      console.error('[Push] Failed to serve push-sw.js:', err);
      res.status(404).send('Service worker not found');
    }
  });
});

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

if (!isProduction) {
  const devClientPath = path.resolve(process.cwd(), 'dist', 'client');
  const devIndex = path.join(devClientPath, 'index.html');
  const useViteProxy = process.env.MT_DEV_SERVER_MODE === 'vite';

  if (useViteProxy) {
    const viteProxy = createProxyMiddleware({
      target: 'http://127.0.0.1:5174',
      changeOrigin: true,
      ws: true,
      logLevel: 'warn',
    });

    app.use((req, res, next) => {
      const pathName = req.path || '';
      if (
        pathName.startsWith('/api') ||
        pathName.startsWith('/socket.io') ||
        pathName.startsWith('/preview') ||
        pathName.startsWith('/memory') ||
        pathName.startsWith('/stream')
      ) {
        next();
        return;
      }
      viteProxy(req, res, next);
    });
  } else if (existsSync(devIndex)) {
    app.use(express.static(devClientPath));
    app.get('*', (req, res) => {
      res.sendFile(devIndex);
    });
  } else {
    console.warn('[Dev] No Vite proxy and no built client. Run `npm run build:client:tauri`.');
  }
}

// Log API requests for debugging
app.use('/api', (req, res, next) => {
  console.log('API Request:', req.method, req.path);
  next();
});

// Socket.io authentication - disabled for simplified desktop app usage
io.use((socket, next) => {
  return next();
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
  socket.on('terminal:create', async (data: { terminalId: string; cols?: number; rows?: number; sessionId?: string }) => {
    const { terminalId, cols = 80, rows = 24, sessionId } = data;
    console.log(`[terminal:create] tid=${terminalId.slice(0,8)}, requestedSession=${sessionId?.slice(0,8) || 'null'}, hasSession=${sessionId ? ptyManager.hasSession(sessionId) : 'N/A'}`);

    // Check if trying to restore an existing session
    if (sessionId && ptyManager.hasSession(sessionId)) {
      // Restore existing session
      const attached = ptyManager.attachTerminal(terminalId, sessionId, socket.id);
      if (attached) {
        // Send scrollback history BEFORE joining room (only this client gets it)
        const scrollback = ptyManager.getScrollback(sessionId);
        if (scrollback) {
          socket.emit('terminal:history', { terminalId, data: scrollback });
        }

        // Join the session room for real-time sync
        socket.join(`session:${sessionId}`);

        // DON'T set up another data handler - the existing one already broadcasts to the room
        // This prevents double letters when multiple clients are connected

        socket.emit('terminal:created', { terminalId, sessionId, restored: true });
        console.log(`Terminal ${terminalId} restored session ${sessionId} for ${socket.id}`);
        return;
      }
    }

    // Before creating a new session, check if another client already has one for this terminalId
    // This prevents race conditions when multiple clients connect simultaneously
    const existingSessionId = ptyManager.findActiveSessionForTerminal(terminalId);
    if (existingSessionId) {
      console.log(`[terminal:create] Found existing session ${existingSessionId.slice(0,8)} for terminal ${terminalId.slice(0,8)}, restoring`);
      const attached = ptyManager.attachTerminal(terminalId, existingSessionId, socket.id);
      if (attached) {
        const scrollback = ptyManager.getScrollback(existingSessionId);
        if (scrollback) {
          socket.emit('terminal:history', { terminalId, data: scrollback });
        }
        socket.join(`session:${existingSessionId}`);
        socket.emit('terminal:created', { terminalId, sessionId: existingSessionId, restored: true });
        console.log(`Terminal ${terminalId} joined existing session ${existingSessionId} for ${socket.id}`);
        return;
      }
    }

    // Create new session
    const newSessionId = await ptyManager.createTerminal(terminalId, socket.id, cols, rows);
    if (!newSessionId) {
      socket.emit('terminal:error', { terminalId, message: 'Failed to create terminal session' });
      console.error(`Failed to create terminal ${terminalId} for ${socket.id}`);
      return;
    }

    // Join the session room for real-time sync
    socket.join(`session:${newSessionId}`);

    // Set up broadcast handler ONLY for new sessions (prevents double broadcasts)
    if (!sessionBroadcastHandlers.has(newSessionId)) {
      sessionBroadcastHandlers.add(newSessionId);
      ptyManager.onTerminalData(terminalId, socket.id, (tid, termData) => {
        // Include sessionId for replica terminals to filter by
        io.to(`session:${newSessionId}`).emit('terminal:data', { terminalId: tid, sessionId: newSessionId, data: termData });
      });
    }

    // IMPORTANT: Send terminal:created FIRST so client can register handlers
    // Then send history with a small delay to ensure client is ready
    socket.emit('terminal:created', { terminalId, sessionId: newSessionId, restored: false });

    // Send any initial scrollback (e.g., shell prompt) for brand-new sessions
    // Delayed by 50ms to give client time to set up data handlers
    const initialScrollback = ptyManager.getScrollback(newSessionId);
    if (initialScrollback) {
      setTimeout(() => {
        const dimensions = ptyManager.getEffectiveDimensions(newSessionId);
        socket.emit('terminal:history', {
          terminalId,
          data: initialScrollback,
          cols: dimensions?.cols || cols,
          rows: dimensions?.rows || rows,
        });
      }, 50);
    }
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
  socket.on('terminal:restore', async (data: { terminals: Array<{ terminalId: string; sessionId: string; cols?: number; rows?: number }> }) => {
    const results: Array<{ terminalId: string; sessionId: string; restored: boolean }> = [];

    for (const term of data.terminals) {
      const { terminalId, sessionId, cols = 80, rows = 24 } = term;

      if (ptyManager.hasSession(sessionId)) {
        // Restore existing session
        const attached = ptyManager.attachTerminal(terminalId, sessionId, socket.id, { cols, rows });
        if (attached) {
          // Send scrollback history WITH dimensions BEFORE joining room (only this client gets it)
          // Dimensions are critical for synced terminals to render correctly
          const scrollback = ptyManager.getScrollback(sessionId);
          const dimensions = ptyManager.getEffectiveDimensions(sessionId);
          socket.emit('terminal:history', {
            terminalId,
            data: scrollback || '',
            cols: dimensions?.cols || 80,
            rows: dimensions?.rows || 24
          });

          // Join the session room for real-time sync
          socket.join(`session:${sessionId}`);

          // DON'T set up another data handler - the existing one already broadcasts to the room
          // This prevents double letters when multiple clients are connected

          results.push({ terminalId, sessionId, restored: true });
          console.log(`Terminal ${terminalId} restored session ${sessionId}`);
          continue;
        }
      }

      // Session doesn't exist or couldn't attach, create new
      const newSessionId = await ptyManager.createTerminal(terminalId, socket.id, cols, rows);
      if (newSessionId) {
        // Join the session room for real-time sync
        socket.join(`session:${newSessionId}`);

        // Set up broadcast handler ONLY for new sessions (prevents double broadcasts)
        if (!sessionBroadcastHandlers.has(newSessionId)) {
          sessionBroadcastHandlers.add(newSessionId);
          ptyManager.onTerminalData(terminalId, socket.id, (tid, termData) => {
            // Include sessionId for replica terminals to filter by
            io.to(`session:${newSessionId}`).emit('terminal:data', { terminalId: tid, sessionId: newSessionId, data: termData });
          });
        }

        // Send history with delay to ensure client has time to set up handlers
        const initialScrollback = ptyManager.getScrollback(newSessionId);
        if (initialScrollback) {
          setTimeout(() => {
            const dimensions = ptyManager.getEffectiveDimensions(newSessionId);
            socket.emit('terminal:history', {
              terminalId,
              data: initialScrollback,
              cols: dimensions?.cols || cols,
              rows: dimensions?.rows || rows,
            });
          }, 50);
        }

        results.push({ terminalId, sessionId: newSessionId, restored: false });
        console.log(`Terminal ${terminalId} created new session ${newSessionId}`);
      } else {
        console.error(`Failed to restore/create terminal ${terminalId}`);
      }
    }

    socket.emit('terminal:restored', { terminals: results });
  });

  // ========================================
  // REPLICA TERMINAL EVENTS (read-only view)
  // ========================================

  // Client wants to watch a session (read-only replica)
  // Now supports bidirectional sync - replica can type and resize
  socket.on('terminal:replica', ({ sessionId, cols, rows }: { sessionId: string; cols?: number; rows?: number }) => {
    if (!sessionId) {
      socket.emit('terminal:replica-error', { error: 'sessionId required' });
      return;
    }

    if (!ptyManager.hasSession(sessionId)) {
      socket.emit('terminal:replica-error', { sessionId, error: 'Session not found' });
      console.log(`[terminal:replica] Session ${sessionId.slice(0,8)} not found`);
      return;
    }

    // Join the session room to receive live data broadcasts
    socket.join(`session:${sessionId}`);

    // Register this replica client (dimensions stay fixed to whoever created the terminal)
    ptyManager.detachSocket(sessionId, socket.id);
    console.log(`[terminal:replica] ${socket.id.slice(0,8)} joined session ${sessionId.slice(0,8)}`);

    // Send scrollback history with current effective dimensions
    const scrollback = ptyManager.getScrollback(sessionId);
    const dimensions = ptyManager.getEffectiveDimensions(sessionId);
    socket.emit('terminal:replica-history', {
      sessionId,
      data: scrollback || '',
      cols: dimensions?.cols || 80,
      rows: dimensions?.rows || 24
    });

    console.log(`[terminal:replica] ${socket.id.slice(0,8)} joined session ${sessionId.slice(0,8)} as replica (dims: ${dimensions?.cols}x${dimensions?.rows})`);
  });

  // Client leaving replica view
  // IMPORTANT: Don't leave the room if this socket has a main terminal in the same session
  // (replica and main terminal share the same socket in desktop app mode)
  socket.on('terminal:replica-leave', ({ sessionId }: { sessionId: string }) => {
    if (sessionId) {
      // Check if this socket has a main terminal using this session
      const socketTerminals = ptyManager.getSocketTerminals(socket.id);
      let hasMainTerminalInSession = false;
      for (const [, termSessionId] of socketTerminals) {
        if (termSessionId === sessionId) {
          hasMainTerminalInSession = true;
          break;
        }
      }

      if (hasMainTerminalInSession) {
        // Don't leave the room - main terminal needs it for sync
        console.log(`[terminal:replica] ${socket.id.slice(0,8)} replica view closed but staying in session ${sessionId.slice(0,8)} (main terminal active)`);
      } else {
        // No main terminal in this session, safe to leave
        socket.leave(`session:${sessionId}`);
        console.log(`[terminal:replica] ${socket.id.slice(0,8)} left session ${sessionId.slice(0,8)}`);
      }
    }
  });

  // Handle input from replica terminals (using sessionId, not terminalId)
  // This enables bidirectional sync - replicas can type and it syncs to desktop
  socket.on('terminal:replica-input', ({ sessionId, data }: { sessionId: string; data: string }) => {
    if (!sessionId || !data) return;

    // Write directly to the session's PTY
    // Dimensions stay fixed to whoever created/first opened the terminal
    if (ptyManager.hasSession(sessionId)) {
      ptyManager.write(sessionId, data);
    }
  });

  // Handle resize from replica terminals
  // Replica resize events are ignored - dimensions stay fixed to whoever created the terminal
  socket.on('terminal:replica-resize', () => {
    // No-op: dimensions are fixed to creator
  });

  // Client explicitly requests history after confirming handlers are ready
  // This is a fallback/safeguard in case the automatic delayed history wasn't received
  // sessionId is optional - if not provided, we look it up from terminalId (handles StrictMode remount)
  socket.on('terminal:request-history', (data: { terminalId: string; sessionId?: string }) => {
    const { terminalId } = data;

    // Use provided sessionId or look it up from terminalId
    const sessionId = data.sessionId || ptyManager.getSessionForTerminal(terminalId, socket.id);

    if (!sessionId) {
      console.log(`[terminal:request-history] No session found for terminal ${terminalId.slice(0,8)}`);
      return;
    }

    if (!ptyManager.hasSession(sessionId)) {
      console.log(`[terminal:request-history] Session ${sessionId.slice(0,8)} not found`);
      return;
    }

    const scrollback = ptyManager.getScrollback(sessionId);
    const dimensions = ptyManager.getEffectiveDimensions(sessionId);

    if (scrollback) {
      socket.emit('terminal:history', {
        terminalId,
        data: scrollback,
        cols: dimensions?.cols || 80,
        rows: dimensions?.rows || 24,
      });
      console.log(`[terminal:request-history] Sent ${scrollback.length} bytes to terminal ${terminalId.slice(0,8)}`);
    }
  });

  // ========================================
  // TAB SYNC EVENTS
  // ========================================

  // Request full tab state (on connect or manual request)
  socket.on('tabs:request', async () => {
    try {
      const settings = await getTabSettings();

      // Validate each tab's sessionId - clear stale sessions that no longer exist
      let needsUpdate = false;
      for (const tab of settings.tabs) {
        if (tab.sessionId && !ptyManager.hasSession(tab.sessionId)) {
          console.log(`[tabs:request] Clearing stale sessionId ${tab.sessionId.slice(0,8)} for tab ${tab.id.slice(0,8)}`);
          tab.sessionId = null;
          needsUpdate = true;
        }
      }

      // Save updated settings if any sessions were cleared
      if (needsUpdate) {
        await saveTabSettings(settings);
      }

      socket.emit('tabs:sync', { tabs: settings.tabs, lastModified: settings.lastModified });
      console.log(`Sent ${settings.tabs.length} tabs to ${socket.id}`);
    } catch (err) {
      console.error('Failed to get tab settings:', err);
      socket.emit('tabs:error', { message: 'Failed to load tabs' });
    }
  });

  // Create a new tab
  // Client can provide an ID for optimistic updates - server uses it if provided
  socket.on('tab:create', async (data: { name?: string; id?: string }) => {
    try {
      const { tabs, newTab } = await addTab(data.name, data.id);
      // Notify all clients including sender
      io.emit('tabs:sync', { tabs, lastModified: Date.now() });
      console.log(`Tab created: ${newTab.name} (${newTab.id}) by ${socket.id}`);
    } catch (err) {
      console.error('Failed to create tab:', err);
      socket.emit('tabs:error', { message: (err as Error).message || 'Failed to create tab' });
    }
  });

  // Close a tab
  socket.on('tab:close', async (data: { tabId: string }) => {
    try {
      const { tabs, removedId, autoCreated } = await removeTab(data.tabId);
      // Notify all clients
      io.emit('tabs:sync', { tabs, lastModified: Date.now() });
      if (autoCreated) {
        console.log(`Tab ${removedId} closed, auto-created ${autoCreated.name} by ${socket.id}`);
      } else {
        console.log(`Tab ${removedId} closed by ${socket.id}`);
      }
    } catch (err) {
      console.error('Failed to close tab:', err);
      socket.emit('tabs:error', { message: (err as Error).message || 'Failed to close tab' });
    }
  });

  // Rename a tab
  socket.on('tab:rename', async (data: { tabId: string; name: string }) => {
    try {
      const { tabs, tab } = await renameTab(data.tabId, data.name);
      // Notify all clients
      io.emit('tabs:sync', { tabs, lastModified: Date.now() });
      console.log(`Tab ${data.tabId} renamed to "${tab.name}" by ${socket.id}`);
    } catch (err) {
      console.error('Failed to rename tab:', err);
      socket.emit('tabs:error', { message: (err as Error).message || 'Failed to rename tab' });
    }
  });

  // Update tab's session ID
  socket.on('tab:set-session', async (data: { tabId: string; sessionId: string | null }) => {
    try {
      const tab = await setTabSessionId(data.tabId, data.sessionId);
      if (tab) {
        // Notify all clients of the session update
        io.emit('tab:session-updated', { tabId: data.tabId, sessionId: data.sessionId });
        console.log(`Tab ${data.tabId} session set to ${data.sessionId} by ${socket.id}`);
      }
    } catch (err) {
      console.error('Failed to set tab session:', err);
    }
  });

  // ========================================
  // FAVORITES SYNC EVENTS
  // ========================================

  // Request favorites state (on connect or manual request)
  socket.on('favorites:request', async () => {
    try {
      const settings = await getFavorites();
      socket.emit('favorites:sync', { favorites: settings.favorites, lastModified: settings.lastModified });
      console.log(`Sent ${settings.favorites.length} favorites to ${socket.id}`);
    } catch (err) {
      console.error('Failed to get favorites:', err);
      socket.emit('favorites:error', { message: 'Failed to load favorites' });
    }
  });

  // Update favorites (full replacement)
  socket.on('favorites:update', async (favorites: string[]) => {
    try {
      const settings = await saveFavorites(favorites);
      // Notify all clients including sender
      io.emit('favorites:sync', { favorites: settings.favorites, lastModified: settings.lastModified });
      console.log(`Favorites updated (${settings.favorites.length} items) by ${socket.id}`);
    } catch (err) {
      console.error('Failed to save favorites:', err);
      socket.emit('favorites:error', { message: 'Failed to save favorites' });
    }
  });

  // ========================================
  // CUSTOM COMMANDS SYNC EVENTS
  // ========================================

  // Request custom commands state (on connect or manual request)
  socket.on('commands:request', async () => {
    try {
      const settings = await getCommands();
      socket.emit('commands:sync', { commands: settings.commands, lastModified: settings.lastModified });
      console.log(`Sent ${settings.commands.length} commands to ${socket.id}`);
    } catch (err) {
      console.error('Failed to get commands:', err);
      socket.emit('commands:error', { message: 'Failed to load commands' });
    }
  });

  // Update custom commands (full replacement)
  socket.on('commands:update', async (commands: { name?: string; command: string }[]) => {
    try {
      const settings = await saveCommands(commands);
      // Notify all clients including sender
      io.emit('commands:sync', { commands: settings.commands, lastModified: settings.lastModified });
      console.log(`Commands updated (${settings.commands.length} items) by ${socket.id}`);
    } catch (err) {
      console.error('Failed to save commands:', err);
      socket.emit('commands:error', { message: 'Failed to save commands' });
    }
  });

  // ========================================
  // LEGACY SINGLE-TERMINAL EVENTS (backward compatible)
  // ========================================

  // Join or create terminal session (legacy - for single terminal)
  socket.on('terminal:join', async (data: { sessionId?: string; cols?: number; rows?: number }) => {
    const cols = data.cols || 80;
    const rows = data.rows || 24;

    if (data.sessionId && ptyManager.hasSession(data.sessionId)) {
      // Rejoin existing session
      legacySessionId = data.sessionId;
      ptyManager.detachSocket(legacySessionId, socket.id);
      socket.emit('terminal:joined', { sessionId: legacySessionId, restored: true });
      console.log(`Client ${socket.id} rejoined legacy session ${legacySessionId}`);
    } else {
      // Create new session
      const newSessionId = await ptyManager.createSession(cols, rows, socket.id);
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
      ptyManager.onTerminalData(legacySessionId, (data) => {
        socket.emit('terminal:data', data);
      });
    }
  });

  // Handle terminal input (supports both new and legacy formats)
  socket.on('terminal:input', (data: string | { terminalId: string; data: string }) => {
    console.log('[terminal:input] Received from socket:', socket.id, typeof data === 'string' ? 'legacy format' : 'new format');
    if (typeof data === 'string') {
      // Legacy format - single terminal
      console.log('[terminal:input] Legacy format, data length:', data.length, 'legacySessionId:', legacySessionId);
      if (legacySessionId) {
        ptyManager.write(legacySessionId, data);
      }
    } else {
      // New format - multi-terminal
      const { terminalId, data: inputData } = data;
      console.log('[terminal:input] New format, terminalId:', terminalId, 'socketId:', socket.id, 'data length:', inputData.length);
      ptyManager.writeTerminal(terminalId, socket.id, inputData);
      // Dimensions stay fixed to whoever created/first opened the terminal
    }
  });

  // Handle terminal resize (supports both new and legacy formats)
  socket.on('terminal:resize', (data: { cols: number; rows: number } | { terminalId: string; cols: number; rows: number }) => {
    if ('terminalId' in data) {
      // New format - multi-terminal
      const { terminalId, cols, rows } = data;
      const effectiveDimensions = ptyManager.resizeTerminal(terminalId, socket.id, cols, rows);

      // If effective dimensions changed, broadcast to all clients sharing this session
      if (effectiveDimensions) {
        const sessionId = ptyManager.getSessionForTerminal(terminalId, socket.id);
        if (sessionId) {
          // Broadcast to all clients in the session room (including sender)
          io.to(`session:${sessionId}`).emit('terminal:dimensions', {
            terminalId,
            cols: effectiveDimensions.cols,
            rows: effectiveDimensions.rows
          });
          console.log(`[terminal:resize] Broadcasting effective dimensions ${effectiveDimensions.cols}x${effectiveDimensions.rows} to session ${sessionId.slice(0, 8)}`);
        }
      }
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
  if (err && err.code === 'EPIPE') return;
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
  stopClaudeMem();
  ptyManager.destroy();
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  stopClaudeMem();
  ptyManager.destroy();
  server.close(() => {
    process.exit(0);
  });
});

// Auto-start claude-mem server if available
let claudeMemProcess: ChildProcess | null = null;

function startClaudeMem(): void {
  const claudeMemDir = path.join(os.homedir(), '.claude-mem');
  const workerScript = path.join(claudeMemDir, 'plugin', 'scripts', 'worker-service.cjs');

  // Check if claude-mem is installed
  if (!existsSync(workerScript)) {
    console.log('[claude-mem] Not installed, skipping auto-start');
    return;
  }

  // Try to start with bun (required for bun:sqlite)
  try {
    // Find bun in common locations
    const bunPaths = [
      path.join(os.homedir(), '.bun', 'bin', 'bun'),
      '/usr/local/bin/bun',
      '/opt/homebrew/bin/bun',
    ];

    let bunPath: string | null = null;
    for (const p of bunPaths) {
      if (existsSync(p)) {
        bunPath = p;
        break;
      }
    }

    if (!bunPath) {
      console.log('[claude-mem] bun not found, cannot start worker service');
      return;
    }

    claudeMemProcess = spawn(bunPath, [workerScript, 'start'], {
      cwd: claudeMemDir,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        PATH: `${path.join(os.homedir(), '.bun', 'bin')}:${process.env.PATH}`,
      },
    });

    claudeMemProcess.unref();
    console.log('[claude-mem] Started worker service on port 37777');
  } catch (err) {
    console.log('[claude-mem] Failed to start:', err);
  }
}

// Kill claude-mem on shutdown
function stopClaudeMem(): void {
  if (claudeMemProcess) {
    try {
      claudeMemProcess.kill();
    } catch {
      // Process may have already exited
    }
    claudeMemProcess = null;
  }
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mobile Terminal server running on http://127.0.0.1:${PORT}`);
  if (!process.env.AUTH_TOKEN) {
    console.log('WARNING: No AUTH_TOKEN set. Using default password.');
  }

  // Start claude-mem if installed
  startClaudeMem();
});
