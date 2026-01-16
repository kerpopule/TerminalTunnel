#!/usr/bin/env node
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import process from 'node:process';
import os from 'node:os';
import path from 'node:path';

const CHECK_HOST = '127.0.0.1';
const BIND_HOST = '127.0.0.1';
const PORT = 5174;
const BUNDLED_NODE = path.resolve(process.cwd(), 'src-tauri', 'bin', 'node');
const NODE_BIN = process.env.MT_NODE_BIN || process.execPath || (fs.existsSync(BUNDLED_NODE) ? BUNDLED_NODE : 'node');
const LSOF_BIN = fs.existsSync('/usr/sbin/lsof')
  ? '/usr/sbin/lsof'
  : (fs.existsSync('/usr/bin/lsof') ? '/usr/bin/lsof' : 'lsof');
const LOCK_PATH = path.join(os.tmpdir(), 'mt-vite-dev.lock');

const isPortOpen = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host: CHECK_HOST }, () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('error', (error) => {
      const code = (error && error.code) || '';
      if (code === 'ECONNREFUSED') {
        resolve(false);
      } else {
        resolve(true);
      }
    });

    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(true);
    });
  });

const httpCheck = (path, timeoutMs = 800) => new Promise((resolve) => {
  const req = http.request(
    { host: CHECK_HOST, port: PORT, path, method: 'GET' },
    (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    }
  );

  req.on('error', () => resolve(0));
  req.setTimeout(timeoutMs, () => {
    req.destroy();
    resolve(0);
  });
  req.end();
});

const isViteHealthy = async () => {
  if (!(await isPortOpen(PORT))) return false;
  const status = await httpCheck('/@vite/client');
  return status === 200;
};

const forwardSignals = (child) => {
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((signal) => {
    process.on(signal, () => {
      child.kill(signal);
    });
  });
};

let lockAcquired = false;
let currentChild = null;

const isProcessAlive = (pid) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const acquireLock = () => {
  try {
    const fd = fs.openSync(LOCK_PATH, 'wx');
    fs.writeFileSync(fd, `${process.pid}\n`, { encoding: 'utf8' });
    fs.closeSync(fd);
    lockAcquired = true;
    return true;
  } catch {
    try {
      const contents = fs.readFileSync(LOCK_PATH, 'utf8').trim();
      const existingPid = Number(contents.split('\n')[0]);
      if (isProcessAlive(existingPid)) {
        console.log(`Vite monitor already running (pid ${existingPid}).`);
        return false;
      }
    } catch {
      // Ignore read errors; we'll attempt to replace the lock.
    }
    try {
      fs.unlinkSync(LOCK_PATH);
    } catch {
      // Ignore stale lock removal failures.
    }
    return acquireLock();
  }
};

const releaseLock = () => {
  if (!lockAcquired) return;
  try {
    fs.unlinkSync(LOCK_PATH);
  } catch {
    // Ignore cleanup errors.
  }
  lockAcquired = false;
};

const keepAlive = () => {
  console.log(`Vite already running on ${CHECK_HOST}:${PORT}. Watching only...`);
  setInterval(async () => {
    if (await isViteHealthy()) return;
    console.warn('Vite not responding; leaving it to the existing process.');
  }, 5000);
};

const startClient = () => {
  console.log(`Starting Vite dev server on port ${PORT}...`);
  const child = spawn(
    NODE_BIN,
    ['node_modules/vite/bin/vite.js', '--host', BIND_HOST, '--port', String(PORT), '--strictPort'],
    { stdio: 'inherit' }
  );
  currentChild = child;
  forwardSignals(child);
  child.on('exit', (code, signal) => {
    currentChild = null;
    if (signal) {
      console.warn(`Vite exited due to signal ${signal}.`);
    } else {
      console.warn(`Vite exited with code ${code ?? 0}.`);
    }
    setTimeout(async () => {
      if (await isPortOpen(PORT)) {
        console.warn('Port still in use; another process owns Vite. Skipping restart.');
        keepAlive();
        return;
      }
      startClient();
    }, 1000);
  });
};

const killPort = (port) => {
  try {
    execSync(`${LSOF_BIN} -ti:${port} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
  } catch {
    // Ignore failures - port may already be free.
  }
};

(async () => {
  if (!acquireLock()) {
    return;
  }
  process.on('exit', releaseLock);
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));

  if (await isViteHealthy()) {
    keepAlive();
    return;
  }
  if (await isPortOpen(PORT)) {
    console.warn(`Port ${PORT} is in use but Vite is not healthy. Waiting before restart...`);
    const start = Date.now();
    while (Date.now() - start < 10000) {
      if (await isViteHealthy()) {
        keepAlive();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    console.warn(`Port ${PORT} still unhealthy after 10s. Restarting Vite...`);
    killPort(PORT);
  }
  startClient();
})();
