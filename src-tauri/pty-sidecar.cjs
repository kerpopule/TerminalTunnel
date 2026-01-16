const fs = require('fs');
const path = require('path');
const os = require('os');

const logFile = process.env.PTY_SIDECAR_LOG;
let logStream = null;

const stripNpmEnv = (env) => {
  delete env.npm_config_prefix;
  delete env.NPM_CONFIG_PREFIX;
  delete env.npm_config_userconfig;
  delete env.NPM_CONFIG_USERCONFIG;
  delete env.npm_config_globalconfig;
  delete env.NPM_CONFIG_GLOBALCONFIG;
  delete env.PREFIX;
  delete env.prefix;
};

stripNpmEnv(process.env);

if (logFile) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    logStream = fs.createWriteStream(logFile, { flags: 'a' });
  } catch (error) {
    console.error('Sidecar: Failed to open log file:', error);
  }
}

function writeLog(level, message, extra) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}${extra ? ` ${extra}` : ''}\n`;
  if (logStream) {
    logStream.write(line);
  }
}

const originalLog = console.log.bind(console);
const originalError = console.error.bind(console);

console.log = (...args) => {
  originalLog(...args);
  writeLog('INFO', args.map(String).join(' '));
};

console.error = (...args) => {
  originalError(...args);
  writeLog('ERROR', args.map(String).join(' '));
};

function findClaudeBin(env) {
  const nvmBin = env.NVM_BIN;
  if (nvmBin && fs.existsSync(path.join(nvmBin, 'claude'))) {
    return nvmBin;
  }

  const homeDir = env.HOME || process.env.HOME;
  const nvmDir = env.NVM_DIR || (homeDir ? path.join(homeDir, '.nvm') : null);
  if (!nvmDir) return null;

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

function ensureZdotDir() {
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

    const wrapFile = (filename, sourcePath, guard) => {
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
    console.error('Sidecar: Failed to prepare ZDOTDIR:', error);
    return null;
  }
}

function logEnvSnapshot(label, env) {
  const pathPreview = (env.PATH || '').split(':').slice(0, 3).join(':');
  console.log(
    `${label} npm_config_prefix=${env.npm_config_prefix || ''} NPM_CONFIG_PREFIX=${env.NPM_CONFIG_PREFIX || ''} ` +
    `ZDOTDIR=${env.ZDOTDIR || ''} NVM_DIR=${env.NVM_DIR || ''} NVM_BIN=${env.NVM_BIN || ''} PATH=${pathPreview}`
  );
}

function buildPtyEnv(shell) {
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    SHELL: shell,
    PS1: '\\$ '  // Simple prompt
  };

  // Remove npm script env that breaks nvm PATH setup.
  stripNpmEnv(env);

  const claudeBin = findClaudeBin(env);
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

let pty;
try {
  pty = require('node-pty');
} catch (error) {
  console.error('Sidecar: Failed to load node-pty:', error);
  process.exit(1);
}
const { createServer } = require('http');
const { Server } = require('socket.io');

// Create HTTP server for Socket.IO
const server = createServer();
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PTY_PORT = parseInt(process.env.PTY_SIDECAR_PORT || '3457', 10);
const PTY_HOST = process.env.PTY_SIDECAR_HOST || '127.0.0.1';

logEnvSnapshot('Sidecar env:', process.env);

// Store active PTY processes
const ptyProcesses = new Map();

io.on('connection', (socket) => {
  console.log('Sidecar: Client connected', socket.id);

  socket.on('create-pty', (data) => {
    const { sessionId, cols = 80, rows = 24 } = data;

    try {
      console.log(`Sidecar: Creating PTY for session ${sessionId}`);

      const shell = process.env.SHELL || '/bin/zsh';
      const shellArgs = ['-l'];
      const shellName = path.basename(shell);
      console.log(`Sidecar: Using shell ${shell} (${shellName})`);

      const ptyEnv = buildPtyEnv(shell);
      logEnvSnapshot('Sidecar PTY env:', ptyEnv);

      const proc = pty.spawn(shell, shellArgs, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: process.env.HOME || '/tmp',
        env: ptyEnv
      });

      ptyProcesses.set(sessionId, proc);

      console.log(`Sidecar: PTY created for ${sessionId}, PID: ${proc.pid}`);

      // Handle PTY data
      proc.onData((data) => {
        socket.emit('pty-data', { sessionId, data });
      });

      // Handle PTY exit
      proc.onExit(({ exitCode, signal }) => {
        console.log(`Sidecar: PTY ${sessionId} exited with code ${exitCode}`);
        socket.emit('pty-exit', { sessionId, exitCode, signal });
        ptyProcesses.delete(sessionId);
      });

      // Confirm creation
      socket.emit('pty-created', { sessionId, pid: proc.pid });

    } catch (error) {
      console.error('Sidecar: Failed to create PTY:', error);
      socket.emit('pty-error', { sessionId, error: error.message });
    }
  });

  socket.on('pty-input', (data) => {
    const { sessionId, input } = data;
    const proc = ptyProcesses.get(sessionId);
    if (proc) {
      proc.write(input);
    }
  });

  socket.on('pty-resize', (data) => {
    const { sessionId, cols, rows } = data;
    const proc = ptyProcesses.get(sessionId);
    if (proc) {
      proc.resize(cols, rows);
    }
  });

  socket.on('destroy-pty', (data) => {
    const { sessionId } = data;
    const proc = ptyProcesses.get(sessionId);
    if (proc) {
      proc.kill();
      ptyProcesses.delete(sessionId);
      console.log(`Sidecar: PTY ${sessionId} destroyed`);
    }
  });

  socket.on('disconnect', () => {
    console.log('Sidecar: Client disconnected', socket.id);
  });
});

server.listen(PTY_PORT, PTY_HOST, () => {
  console.log(`PTY Sidecar listening on http://${PTY_HOST}:${PTY_PORT}`);
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('Sidecar: Shutting down...');
  for (const proc of ptyProcesses.values()) {
    proc.kill();
  }
  server.close();
  process.exit(0);
});
