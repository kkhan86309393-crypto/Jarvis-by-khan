import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const desktopMain = await readFile(new URL('../desktop/main.js', import.meta.url), 'utf8');

test('configures a Windows NSIS installer without changing the web entry point', () => {
  assert.equal(packageJson.scripts.start, 'node server.js');
  assert.equal(packageJson.main, 'desktop/main.js');
  assert.equal(packageJson.scripts.desktop, 'electron .');
  assert.equal(packageJson.scripts['desktop:dist'], 'electron-builder --win nsis');
  assert.equal(packageJson.scripts['predesktop:dist'], 'npm run build:avatar');
  assert.equal(packageJson.build.win.target, 'nsis');
  assert.equal(packageJson.build.nsis.createDesktopShortcut, true);
});

test('starts the existing server on loopback with isolated Electron web contents', () => {
  assert.match(desktopMain, /server\.listen\(0, '127\.0\.0\.1'/);
  assert.match(desktopMain, /contextIsolation: true/);
  assert.match(desktopMain, /nodeIntegration: false/);
  assert.match(desktopMain, /sandbox: true/);
  assert.match(desktopMain, /webSecurity: true/);
  assert.match(desktopMain, /window\.webContents\.on\('will-navigate'/);
  assert.match(desktopMain, /target\.protocol === 'https:'/);
  assert.match(desktopMain, /setPermissionRequestHandler/);
  assert.match(desktopMain, /permission !== 'media'/);
  assert.match(desktopMain, /buttons: \['Allow', 'Deny'\]/);
  assert.match(desktopMain, /details\.mediaTypes\.includes\('video'\)/);
  assert.match(desktopMain, /setDisplayMediaRequestHandler/);
  assert.match(desktopMain, /desktopCapturer\.getSources/);
  assert.match(desktopMain, /Choose a screen or window to share/);
});
