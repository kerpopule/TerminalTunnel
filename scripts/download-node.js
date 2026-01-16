#!/usr/bin/env node

/**
 * Downloads Node.js binary for bundling with the Tauri app.
 * Supports macOS arm64 and x64 architectures.
 */

import { createWriteStream, existsSync, mkdirSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { extract } from 'tar';
import https from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Node.js version to bundle
const NODE_VERSION = '20.19.0';

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

  const { createReadStream } = await import('fs');
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
    const { renameSync, rmSync } = await import('fs');
    renameSync(extractedBin, nodeBinaryPath);
    // Clean up the bin directory
    rmSync(join(outputDir, 'bin'), { recursive: true, force: true });
  }

  // Make executable
  chmodSync(nodeBinaryPath, 0o755);

  // Clean up tar file
  const { unlinkSync } = await import('fs');
  unlinkSync(tarPath);

  console.log(`Node.js binary extracted to: ${nodeBinaryPath}`);
}

async function main() {
  console.log(`\n=== Downloading Node.js v${NODE_VERSION} for ${platform}-${arch} ===\n`);

  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Check if node binary already exists
  if (existsSync(nodeBinaryPath)) {
    console.log('Node.js binary already exists. Skipping download.');
    console.log(`Location: ${nodeBinaryPath}`);
    return;
  }

  try {
    await downloadFile(downloadUrl, tarPath);
    await extractNode();
    console.log('\n=== Node.js download complete ===\n');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
