const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvisDesktop', Object.freeze({
  openExternalUrl(url) {
    if (!navigator.userActivation?.isActive || typeof url !== 'string' || url.length > 2_048) return false;
    ipcRenderer.send('jarvis:open-external-url', url);
    return true;
  },
  copyText(text) {
    if (!navigator.userActivation?.isActive || typeof text !== 'string' || text.length > 20_000) return Promise.resolve(false);
    return ipcRenderer.invoke('jarvis:copy-text', text);
  },
}));