
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const BIN_DIR = path.join(__dirname, '..', 'src-tauri', 'bin');
const BIN_PATH = path.join(BIN_DIR, 'cloudflared');

function getPlatform() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin') {
    return arch === 'arm64' ? 'darwin-arm64' : 'darwin-amd64';
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? 'linux-arm64' : 'linux-amd64';
  }
  if (platform === 'win32') {
    return arch === 'x64' ? 'windows-amd64.exe' : 'windows-386.exe';
  }
  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

async function download() {
  const platform = getPlatform();
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${platform}`;
  
  if (platform.includes('windows')) {
    const dest = path.join(BIN_DIR, 'cloudflared.exe');
     if (fs.existsSync(dest)) {
      console.log('cloudflared.exe already exists. Skipping download.');
      return;
    }
    console.log(`Downloading cloudflared for Windows from ${url}...`);
    await downloadFile(url, dest);
    return;
  }
  
  if (fs.existsSync(BIN_PATH)) {
    console.log('cloudflared binary already exists. Skipping download.');
    return;
  }
  
  console.log(`Downloading cloudflared for ${platform} from ${url}...`);
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  await downloadFile(url, BIN_PATH);

  // Make it executable
  fs.chmodSync(BIN_PATH, '755');

  console.log(`cloudflared binary downloaded to ${BIN_PATH}`);
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 302) {
        // Handle redirect
        downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download: ${res.statusCode} ${res.statusMessage}`));
        return;
      }

      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

(async () => {
  try {
    await download();
  } catch (err) {
    console.error('Failed to download cloudflared:', err);
    process.exit(1);
  }
})();
