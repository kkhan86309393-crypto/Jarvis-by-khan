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
  saveGeminiApiKey(key, model) {
    if (!navigator.userActivation?.isActive
      || typeof key !== 'string'
      || key.length > 1_024
      || typeof model !== 'string'
      || model.length > 120) {
      return Promise.reject(new Error('Enter a Gemini API key to save securely.'));
    }
    return ipcRenderer.invoke('jarvis:gemini-key-save', key, model);
  },
  hasSavedGeminiApiKey() {
    return ipcRenderer.invoke('jarvis:gemini-key-status');
  },
  unlockSavedGeminiApiKey() {
    if (!navigator.userActivation?.isActive) {
      return Promise.reject(new Error('Use an explicit user action to unlock the saved Gemini key.'));
    }
    return ipcRenderer.invoke('jarvis:gemini-key-unlock');
  },
  lockGeminiApiKey() {
    if (!navigator.userActivation?.isActive) {
      return Promise.reject(new Error('Use an explicit user action to lock the Gemini key.'));
    }
    return ipcRenderer.invoke('jarvis:gemini-key-lock');
  },
}));