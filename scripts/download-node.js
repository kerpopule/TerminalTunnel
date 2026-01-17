#!/usr/bin/env node

/**
 * Downloads Node.js binary for bundling with the Tauri app.
 * Automatically detects and uses the current system Node.js version
 * so that native modules (like node-pty) work without rebuilding.
 */

import { createWriteStream, existsSync, mkdirSync, chmodSync, unlinkSync, rmSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import https from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Detect system Node.js version (without 'v' prefix)
const NODE_VERSION = process.version.slice(1);
console.log(`Detected system Node.js version: v${NODE_VERSION}`);

// Detect architecture
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const platform = 'darwin'; // macOS only for now

// Download URL
const downloadUrl = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${platform}-${arch}.tar.gz`;

// Output paths
const outputDir = join(__dirname, '..', 'src-tauri', 'bin');
const tarPath = join(outputDir, `node-v${NODE_VERSION}.tar.gz`);
const nodeBinaryPath = join(outputDir, 'node');

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading from: ${url}`);

    const file = createWriteStream(dest);

    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        file.close();
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloaded = 0;

      response.on('data', (chunk) => {
        downloaded += chunk.length;
        const percent = ((downloaded / totalSize) * 100).toFixed(1);
        process.stdout.write(`\rDownloading: ${percent}%`);
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log('\nDownload complete.');
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      reject(err);
    });
  });
}

async function extractNode() {
  console.log('Extracting Node.js binary...');

  const tar = await import('tar');

  // Extract the tar.gz
  await tar.x({
    file: tarPath,
    cwd: outputDir,
    strip: 1, // Remove the top-level directory
    filter: (path) => {
      // Only extract the node binary
      return path.endsWith('/bin/node') || path === 'bin/node';
    }
  });

  // The binary will be at outputDir/bin/node, move it to outputDir/node
  const extractedBin = join(outputDir, 'bin', 'node');
  if (existsSync(extractedBin)) {
    renameSync(extractedBin, nodeBinaryPath);
    // Clean up the bin directory
    rmSync(join(outputDir, 'bin'), { recursive: true, force: true });
  }

  // Make executable
  chmodSync(nodeBinaryPath, 0o755);

  // Clean up tar file
  unlinkSync(tarPath);

  console.log(`Node.js binary extracted to: ${nodeBinaryPath}`);
}

function getBundledNodeVersion() {
  if (!existsSync(nodeBinaryPath)) {
    return null;
  }
  try {
    const version = execSync(`"${nodeBinaryPath}" --version`, { encoding: 'utf-8' }).trim();
    return version.slice(1); // Remove 'v' prefix
  } catch {
    return null;
  }
}

async function main() {
  console.log(`\n=== Bundling Node.js v${NODE_VERSION} for ${platform}-${arch} ===\n`);

  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Check if node binary already exists with correct version
  const bundledVersion = getBundledNodeVersion();
  if (bundledVersion) {
    if (bundledVersion === NODE_VERSION) {
      console.log(`Node.js v${bundledVersion} already bundled. Skipping download.`);
      console.log(`Location: ${nodeBinaryPath}`);
      return;
    } else {
      console.log(`Bundled Node.js v${bundledVersion} differs from system v${NODE_VERSION}.`);
      console.log('Removing old binary and downloading matching version...');
      unlinkSync(nodeBinaryPath);
    }
  }

  try {
    await downloadFile(downloadUrl, tarPath);
    await extractNode();
    console.log(`\n=== Node.js v${NODE_VERSION} bundled successfully ===\n`);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
