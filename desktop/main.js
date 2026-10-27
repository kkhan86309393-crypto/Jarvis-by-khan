import { app, BrowserWindow, desktopCapturer, dialog, session, shell } from 'electron';
import { createAppServer } from '../server.js';

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
        try {
          const target = new URL(url);
          if (target.protocol === 'https:') {
            shell.openExternal(target.href);
          }
        } catch {
          dialog.showErrorBox('Unable to open link', 'The requested link is not a valid HTTPS address.');
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
