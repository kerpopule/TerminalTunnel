const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..');
const NODE_BINARY = path.join(PROJECT_ROOT, 'src-tauri', 'bin', 'node');

// Check if bundled Node.js exists
if (!fs.existsSync(NODE_BINARY)) {
  console.error('❌ Bundled Node.js not found. Run: npm run bundle:node');
  process.exit(1);
}

// Get bundled Node.js version
try {
  const nodeVersion = execSync(`"${NODE_BINARY}" --version`, { encoding: 'utf-8' }).trim();
  console.log(`\n🔧 Rebuilding node-pty for ${nodeVersion}...\n`);

  // Rebuild node-pty against bundled Node.js
  const rebuildCmd = `npm rebuild node-pty --runtime=node --target=${nodeVersion.slice(1)} --disturl=https://nodejs.org/download/release`;

  execSync(rebuildCmd, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit'
  });

  console.log('\n✅ node-pty rebuilt successfully for', nodeVersion, '\n');
} catch (error) {
  console.error('❌ Failed to rebuild node-pty:', error.message);
  process.exit(1);
}
