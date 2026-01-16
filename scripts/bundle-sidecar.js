#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.join(__dirname, '..');
const sourcePath = path.join(projectRoot, 'pty-sidecar.cjs');
const targetPath = path.join(projectRoot, 'src-tauri', 'pty-sidecar.cjs');

if (!fs.existsSync(sourcePath)) {
  console.error(`Missing sidecar script at ${sourcePath}`);
  process.exit(1);
}

fs.copyFileSync(sourcePath, targetPath);
console.log(`Copied pty-sidecar.cjs -> ${targetPath}`);
