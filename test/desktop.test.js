import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const desktopMain = await readFile(new URL('../desktop/main.js', import.meta.url), 'utf8');
const preload = await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');

test('configures a Windows NSIS installer without changing the web entry point', () => {
  assert.equal(packageJson.scripts.start, 'node server.js');
  assert.equal(packageJson.main, 'desktop/main.js');
  assert.equal(packageJson.scripts.desktop, 'electron .');
  assert.equal(packageJson.scripts['desktop:dist'], 'electron-builder --win nsis');
  assert.equal(packageJson.scripts['predesktop:dist'], 'npm run build:avatar');
  assert.equal(packageJson.build.win.target, 'nsis');
  assert.equal(packageJson.build.nsis.createDesktopShortcut, true);
  assert.ok(packageJson.build.files.includes('desktop/external-links.js'));
  assert.ok(packageJson.build.files.includes('desktop/ipc-validation.js'));
  assert.ok(packageJson.build.files.includes('desktop/preload.cjs'));
});

test('starts the existing server on loopback with isolated Electron web contents', () => {
  assert.match(desktopMain, /server\.listen\(0, '127\.0\.0\.1'/);
  assert.match(desktopMain, /contextIsolation: true/);
  assert.match(desktopMain, /nodeIntegration: false/);
  assert.match(desktopMain, /preload: fileURLToPath\(new URL\('\.\/preload\.cjs', import\.meta\.url\)\)/);
  assert.match(desktopMain, /sandbox: true/);
  assert.match(desktopMain, /webSecurity: true/);
  assert.match(desktopMain, /window\.webContents\.on\('will-navigate'/);
  assert.match(desktopMain, /getAllowedExternalUrl\(url\)/);
  assert.match(desktopMain, /shell\.openExternal\(externalUrl\)\.catch/);
  assert.match(desktopMain, /catch \{\s*showExternalOpenFailure\(\);/);
  assert.match(desktopMain, /compatible browser, dialer, or messaging app/);
  assert.match(desktopMain, /Android intent links are not supported by this desktop shell/);
  assert.match(desktopMain, /setPermissionRequestHandler/);
  assert.match(desktopMain, /permission !== 'media'/);
  assert.match(desktopMain, /buttons: \['Allow', 'Deny'\]/);
  assert.match(desktopMain, /details\.mediaTypes\.includes\('video'\)/);
  assert.match(desktopMain, /setDisplayMediaRequestHandler/);
  assert.match(desktopMain, /desktopCapturer\.getSources/);
  assert.match(desktopMain, /Choose a screen or window to share/);
  assert.match(desktopMain, /ipcMain\.on\('jarvis:open-external-url'/);
  assert.match(desktopMain, /ipcMain\.handle\('jarvis:copy-text'/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\('jarvisDesktop'/);
  assert.match(preload, /openExternalUrl\(url\)[\s\S]*copyText\(text\)/);
  assert.match(preload, /navigator\.userActivation\?\.isActive/);
  assert.doesNotMatch(preload, /exposeInMainWorld\('jarvisDesktop',\s*ipcRenderer/);
});
