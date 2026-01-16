#!/usr/bin/env node
import net from 'node:net';
import fs from 'node:fs';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import process from 'node:process';
import path from 'node:path';

const PORT = 3456;
const HOST = '127.0.0.1';
const BUNDLED_NODE = path.resolve(process.cwd(), 'src-tauri', 'bin', 'node');
const NODE_BIN = process.env.MT_NODE_BIN || process.execPath || (fs.existsSync(BUNDLED_NODE) ? BUNDLED_NODE : 'node');
const LSOF_BIN = fs.existsSync('/usr/sbin/lsof')
  ? '/usr/sbin/lsof'
  : (fs.existsSync('/usr/bin/lsof') ? '/usr/bin/lsof' : 'lsof');
const FORCE_RESTART = process.env.MT_FORCE_RESTART === '1' || process.env.FORCE_SERVER_RESTART === '1';

const isPortOpen = () => new Promise((resolve) => {
  const socket = net.connect({ port: PORT, host: HOST }, () => {
    socket.destroy();
    resolve(true);
  });
  socket.on('error', () => resolve(false));
  socket.setTimeout(500, () => {
    socket.destroy();
    resolve(false);
  });
});

const httpCheck = (path, timeoutMs = 800) => new Promise((resolve) => {
  const req = http.request(
    { host: HOST, port: PORT, path, method: 'GET' },
    (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode || 0, body });
      });
    }
  );

  req.on('error', () => resolve({ status: 0, body: '' }));
  req.setTimeout(timeoutMs, () => {
    req.destroy();
    resolve({ status: 0, body: '' });
  });
  req.end();
});

const isServerHealthy = async () => {
  if (!(await isPortOpen())) return false;
  const health = await httpCheck('/health');
  if (health.status !== 200) return false;
  const socketProbe = await httpCheck('/socket.io/?EIO=4&transport=polling&t=probe');
  return socketProbe.status === 200 && socketProbe.body.startsWith('0{');
};

const killServerOnPort = () => {
  try {
    execSync(`${LSOF_BIN} -ti:${PORT} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
  } catch {
    // Ignore failures - we only use this when probing detected a bad server.
  }
};

const killSidecarOnPort = () => {
  try {
    execSync(`${LSOF_BIN} -tiTCP:3457 -sTCP:LISTEN | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
  } catch {
    // Ignore failures - sidecar may not be running.
  }
};

const forwardSignals = (child) => {
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((signal) => {
    process.on(signal, () => {
      child.kill(signal);
    });
  });
};

const args = ['--import', 'tsx', 'server/index.ts'];
const startServer = () => {
  console.log('Starting dev server with tsx...');
  const child = spawn(NODE_BIN, args, { stdio: 'inherit' });
  forwardSignals(child);
  child.on('exit', (code, signal) => {
    if (signal) {
      process.exit(1);
    } else {
      process.exit(code ?? 0);
    }
  });
};

(async () => {
  if (FORCE_RESTART) {
    if (await isPortOpen()) {
      console.log(`Force restart enabled; stopping existing server on http://${HOST}:${PORT}...`);
      killServerOnPort();
    }
    killSidecarOnPort();
    startServer();
    return;
  }

  if (await isServerHealthy()) {
    console.log(`Dev server already running at http://${HOST}:${PORT}`);
    process.exit(0);
  }
  if (await isPortOpen()) {
    console.log(`Detected stale dev server on http://${HOST}:${PORT}, restarting...`);
    killServerOnPort();
  }
  startServer();
})();
