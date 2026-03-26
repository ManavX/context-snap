/**
 * Build script that produces browser-specific extension packages
 * from the single shared codebase.
 *
 * Usage:
 *   node scripts/build.js           # builds both
 *   node scripts/build.js chrome    # chrome only
 *   node scripts/build.js firefox   # firefox only
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const targets = process.argv[2]
  ? [process.argv[2]]
  : ['chrome', 'firefox'];

// Files to copy into the build (relative to ROOT)
const FILES = [
  'src/background/service-worker.js',
  'src/content/capture.js',
  'src/popup/popup.html',
  'src/popup/popup.css',
  'src/popup/popup.js',
  'src/shared/types.js',
  'src/changelog/changelog.html',
  'assets/icons/icon16.png',
  'assets/icons/icon48.png',
  'assets/icons/icon128.png',
];

function copyFiles(targetDir) {
  for (const file of FILES) {
    const src = path.join(ROOT, file);
    const dest = path.join(targetDir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function buildChrome() {
  const dir = path.join(DIST, 'chrome');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  // Copy source files
  copyFiles(dir);

  // Copy manifest as-is (already Chrome-compatible)
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')
  );
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  console.log(`Chrome build -> ${dir}`);
}

function buildFirefox() {
  const dir = path.join(DIST, 'firefox');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  // Copy source files
  copyFiles(dir);

  // Modify manifest for Firefox
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')
  );

  // Add Firefox-specific settings
  manifest.browser_specific_settings = {
    gecko: {
      id: 'contextsnap@example.com',
      strict_min_version: '109.0',
      data_collection_permissions: {
        required: ["none"],
        optional: [],
      },
    },
  };

  // Firefox doesn't support service_worker — use background.scripts instead
  manifest.background = {
    scripts: [manifest.background.service_worker],
    type: 'module',
  };

  // Firefox: replace show-contexts with _execute_action
  // (_execute_action opens the popup natively in Firefox)
  if (manifest.commands['show-contexts']) {
    manifest.commands['_execute_action'] = {
      suggested_key: manifest.commands['show-contexts'].suggested_key,
      description: 'Open context list',
    };
    delete manifest.commands['show-contexts'];
  }

  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  // Patch the service worker to handle Firefox differences
  const swPath = path.join(dir, 'src/background/service-worker.js');
  let sw = fs.readFileSync(swPath, 'utf8');

  // Replace chrome.action.openPopup() which doesn't exist in Firefox
  sw = sw.replace(
    'chrome.action.openPopup();',
    '// Firefox: _execute_action command handles this natively'
  );

  fs.writeFileSync(swPath, sw);

  console.log(`Firefox build -> ${dir}`);
}

// Run builds
for (const target of targets) {
  if (target === 'chrome') buildChrome();
  else if (target === 'firefox') buildFirefox();
  else console.error(`Unknown target: ${target}`);
}

console.log('Done!');
