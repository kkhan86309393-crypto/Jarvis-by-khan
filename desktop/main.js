import { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, session, shell } from 'electron';
import { createAppServer } from '../server.js';
import { getAllowedExternalUrl } from './external-links.js';
import { isTrustedDesktopIpcEvent, getApprovedClipboardText, getApprovedDesktopExternalUrl } from './ipc-validation.js';
import { fileURLToPath } from 'node:url';

let server;
let desktopOrigin;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      server = createAppServer();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });

      const { port } = server.address();
      const appUrl = `http://127.0.0.1:${port}/?desktop-app=1`;
      desktopOrigin = new URL(appUrl).origin;
      ipcMain.on('jarvis:open-external-url', (event, value) => {
        if (!isTrustedDesktopIpcEvent(event, desktopOrigin)) return;
        const externalUrl = getApprovedDesktopExternalUrl(event, desktopOrigin, value);
        if (!externalUrl) {
          if (typeof value === 'string' && /^intent:/i.test(value)) {
            dialog.showMessageBox({
              type: 'info',
              title: 'Android app link unavailable',
              message: 'Android intent links are not supported by this desktop shell. Open J.A.R.V.I.S. in a compatible Android browser to use this link.',
              buttons: ['OK'],
            }).catch(() => {});
          }
          return;
        }
        try {
          Promise.resolve(shell.openExternal(externalUrl)).catch(() => {
            dialog.showMessageBox({
              type: 'warning',
              title: 'Unable to open link',
              message: 'Your operating system could not open this link. Check that a compatible browser, dialer, or messaging app is available.',
              buttons: ['OK'],
            }).catch(() => {});
          });
        } catch {
          dialog.showMessageBox({
            type: 'warning',
            title: 'Unable to open link',
            message: 'Your operating system could not open this link. Check that a compatible browser, dialer, or messaging app is available.',
            buttons: ['OK'],
          }).catch(() => {});
        }
      });
      ipcMain.handle('jarvis:copy-text', (event, value) => {
        const text = getApprovedClipboardText(event, desktopOrigin, value);
        if (text === null) return false;
        try {
          clipboard.writeText(text);
          return true;
        } catch {
          return false;
        }
      });
      session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
        let requestingOrigin;
        try {
          requestingOrigin = new URL(details.requestingUrl || webContents.getURL()).origin;
        } catch {
          callback(false);
          return;
        }
        if (requestingOrigin !== desktopOrigin || permission !== 'media'
          || !details.mediaTypes?.includes('audio') || details.mediaTypes.includes('video')) {
          callback(false);
          return;
        }
        dialog.showMessageBox({
          type: 'question',
          title: 'Microphone access',
          message: 'Allow J.A.R.V.I.S. to use the microphone for voice input?',
          buttons: ['Allow', 'Deny'],
          defaultId: 1,
          cancelId: 1,
        }).then(({ response }) => callback(response === 0)).catch(() => callback(false));
      });
      const window = new BrowserWindow({
        width: 1440,
        height: 960,
        minWidth: 360,
        minHeight: 600,
        title: 'J.A.R.V.I.S.',
        webPreferences: {
          preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
        },
      });
      session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
        try {
          if (new URL(request.frame.url).origin !== desktopOrigin) {
            callback({});
            return;
          }
          const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
          if (sources.length === 0) {
            callback({});
            return;
          }
          const cancelId = sources.length;
          const { response } = await dialog.showMessageBox(window, {
            type: 'question',
            title: 'Share your screen',
            message: 'Choose a screen or window to share with J.A.R.V.I.S.',
            buttons: [...sources.map((source) => source.name), 'Cancel'],
            cancelId,
            defaultId: cancelId,
          });
          if (response === cancelId) {
            callback({});
            return;
          }
          callback({
            video: sources[response],
            ...(request.audioRequested && process.platform === 'win32' ? { audio: 'loopback' } : {}),
          });
        } catch {
          callback({});
        }
      });
      window.webContents.setWindowOpenHandler(({ url }) => {
        const externalUrl = getAllowedExternalUrl(url);
        if (!externalUrl) {
          if (/^intent:/i.test(url)) {
            dialog.showMessageBox(window, {
              type: 'info',
              title: 'Android app link unavailable',
              message: 'Android intent links are not supported by this desktop shell. Open J.A.R.V.I.S. in a compatible Android browser to use this link.',
              buttons: ['OK'],
            }).catch(() => {});
          }
          return { action: 'deny' };
        }

        const showExternalOpenFailure = () => {
          dialog.showMessageBox(window, {
            type: 'warning',
            title: 'Unable to open link',
            message: 'Your operating system could not open this link. Check that a compatible browser, dialer, or messaging app is available.',
            buttons: ['OK'],
          });
        };
        try {
          shell.openExternal(externalUrl).catch(showExternalOpenFailure);
        } catch {
          showExternalOpenFailure();
        }
        return { action: 'deny' };
      });
      window.webContents.on('will-navigate', (event, url) => {
        try {
          if (new URL(url).origin !== desktopOrigin) event.preventDefault();
        } catch {
          event.preventDefault();
        }
      });
      await window.loadURL(appUrl);
    } catch (error) {
      dialog.showErrorBox('J.A.R.V.I.S. could not start', error.message);
      app.quit();
    }
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    if (server?.listening) server.close();
  });
}
