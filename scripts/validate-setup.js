import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const checks = [
  {
    name: 'node_modules exists',
    check: () => existsSync(join(rootDir, 'node_modules')),
    fix: 'Run: npm install'
  },
  {
    name: 'Tauri CLI installed',
    check: () => existsSync(join(rootDir, 'node_modules/@tauri-apps/cli')),
    fix: 'Run: npm install'
  },
  {
    name: 'Vite installed',
    check: () => existsSync(join(rootDir, 'node_modules/vite')),
    fix: 'Run: npm install'
  },
  {
    name: 'Server compiled',
    check: () => existsSync(join(rootDir, 'dist/server/index.js')),
    fix: 'Run: npm run build'
  },
  {
    name: 'Bundled Node.js exists',
    check: () => existsSync(join(rootDir, 'src-tauri/bin/node')),
    fix: 'Run: npm run bundle:node'
  },
  {
    name: 'node-pty built for bundled Node',
    check: () => {
      try {
        // Quick check: verify node-pty binary exists
        return existsSync(join(rootDir, 'node_modules/node-pty/build/Release/pty.node'));
      } catch {
        return false;
      }
    },
    fix: 'Run: npm run rebuild:node-pty'
  }
];

console.log('🔍 Validating Terminal Tunnel setup...\n');

let failed = false;
for (const { name, check, fix } of checks) {
  const passed = check();
  console.log(`${passed ? '✅' : '❌'} ${name}`);
  if (!passed) {
    console.log(`   Fix: ${fix}`);
    failed = true;
  }
}

if (failed) {
  console.log('\n❌ Setup validation failed. Please address the issues above.\n');
  process.exit(1);
} else {
  console.log('\n✅ All setup checks passed!\n');
}
