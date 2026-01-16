#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.join(__dirname, '..');
const distServer = path.join(projectRoot, 'dist', 'server');
const targetServer = path.join(projectRoot, 'src-tauri', 'server');

console.log('Bundling server...');
console.log(`Source: ${distServer}`);
console.log(`Target: ${targetServer}`);

// Copy compiled server files
const files = [
  'index.js',
  'auth.js',
  'pty-manager.js',
  'file-api.js',
  'port-proxy.js',
  'tab-settings.js',
  'favorites-settings.js',
  'commands-settings.js',
  'pin-settings.js',
  'push-notifications.js',
];

for (const file of files) {
  const srcPath = path.join(distServer, file);
  const destPath = path.join(targetServer, file);

  try {
    fs.copyFileSync(srcPath, destPath);
    console.log(`✓ Copied ${file}`);
  } catch (error) {
    console.error(`✗ Failed to copy ${file}:`, error.message);
    process.exit(1);
  }
}

console.log('✓ Server bundled successfully');
