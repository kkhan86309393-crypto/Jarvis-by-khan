export function createGeminiKeySettingsController({
  bridge = null,
  elements,
  onBrowserSave,
  getModel = () => undefined,
  onStatus = () => {},
  onUnlock = () => {},
  onLock = () => {},
  onSessionOnlySave = () => {},
  translate = (text) => text,
}) {
  const isDesktop = Boolean(bridge);
  let provider = 'openai-compatible';
  let stage = isDesktop ? 'loading' : 'new';
  let hasSavedKey = false;
  let persistentStorageAvailable = false;
  let busy = false;
  let statusText = isDesktop
    ? 'Checking secure Gemini key status…'
    : 'Browser mode: Gemini keys are sent to server memory for this session only and are never saved in browser storage.';

  function setStatus(text) {
    statusText = text;
    elements.status.textContent = translate(statusText);
  }

  function render() {
    const active = provider === 'gemini';
    const editable = stage === 'new' || stage === 'editing';
    elements.actions.hidden = !active;
    elements.status.hidden = !active && !hasSavedKey;
    elements.label.textContent = translate(active ? 'Google Gemini API key' : 'Provider API key');
    elements.model.disabled = active && !editable;
    elements.input.disabled = active ? busy || !editable : false;
    elements.input.required = active ? false : provider === 'openai-compatible';
    elements.saveButton.hidden = !active || !editable;
    elements.saveButton.disabled = busy || !elements.input.value.trim();
    elements.saveButton.textContent = translate(
      isDesktop && persistentStorageAvailable ? 'Save & Lock' : 'Use for this session',
    );
    elements.unlockButton.hidden = !active || !isDesktop || stage !== 'locked' || !persistentStorageAvailable;
    elements.unlockButton.disabled = busy;
    elements.changeButton.hidden = !active || !['locked', 'unlocked', 'session'].includes(stage);
    elements.changeButton.disabled = busy;
    elements.status.textContent = translate(statusText);
    elements.input.placeholder = hasSavedKey && stage !== 'editing'
      ? '••••••••'
      : translate('Not saved in this browser');
  }

  async function initialize() {
    if (!isDesktop) {
      stage = 'new';
      setStatus('Browser mode: Gemini keys are sent to server memory for this session only and are never saved in browser storage.');
      render();
      return;
    }

    if (typeof bridge.hasSavedGeminiApiKey !== 'function') {
      stage = 'unavailable';
      setStatus('Secure Gemini key controls are unavailable in this desktop session.');
      render();
      return;
    }

    try {
      const result = await bridge.hasSavedGeminiApiKey();
      if (typeof result?.hasSavedKey !== 'boolean'
        || typeof result?.persistentStorageAvailable !== 'boolean') {
        throw new Error('Invalid Gemini key status.');
      }
      hasSavedKey = result.hasSavedKey;
      persistentStorageAvailable = result.persistentStorageAvailable;
      stage = hasSavedKey ? 'locked' : 'new';
      await onStatus(result);
      if (hasSavedKey && persistentStorageAvailable) {
        setStatus('Saved Gemini key is locked. Select Google Gemini and choose Unlock to activate it; the key will remain hidden.');
      } else if (hasSavedKey) {
        setStatus('Saved Gemini key detected, but OS-backed encryption is unavailable. Select Google Gemini and use Change Key for a session-only key.');
      } else if (!persistentStorageAvailable) {
        setStatus('OS-backed encryption is unavailable. This key can only be used for the current session.');
      } else {
        setStatus('No Gemini key is saved. Enter a key to use it.');
      }
    } catch {
      stage = 'new';
      persistentStorageAvailable = false;
      setStatus('Could not check secure Gemini key status. A new key can only be used for this session until secure storage is available.');
    }
    render();
  }

  async function save() {
    if (busy || (stage !== 'new' && stage !== 'editing')) return;
    const key = elements.input.value;
    elements.input.value = '';
    if (!key.trim()) {
      setStatus('Enter a Gemini API key.');
      render();
      return;
    }

    busy = true;
    setStatus('Saving Gemini key…');
    render();
    try {
      if (isDesktop) {
        if (typeof bridge.saveGeminiApiKey !== 'function') throw new Error('Secure save unavailable.');
        const result = await bridge.saveGeminiApiKey(key, getModel());
        if (result?.saved === true && result.persistentStorageAvailable === true) {
          hasSavedKey = true;
          persistentStorageAvailable = true;
          stage = 'locked';
          setStatus('Gemini key saved securely and locked. Choose Unlock to activate it.');
        } else if (result?.configuredForSession === true && result.persistentStorageAvailable === false) {
          hasSavedKey = false;
          persistentStorageAvailable = false;
          stage = 'session';
          setStatus('OS-backed encryption is unavailable. The Gemini key is active only for this session.');
          await onSessionOnlySave();
        } else {
          throw new Error('Gemini key save failed.');
        }
      } else {
        if (typeof onBrowserSave !== 'function') throw new Error('Session setup unavailable.');
        await onBrowserSave(key);
        stage = 'session';
        setStatus('Gemini key is active in server memory for this session. It was not saved in this browser.');
      }
    } catch {
      stage = hasSavedKey ? 'locked' : 'new';
      setStatus('Could not save the Gemini key. Check the key and secure-storage availability.');
    } finally {
      busy = false;
      elements.input.value = '';
      render();
    }
  }

  async function unlock() {
    if (busy || !isDesktop || stage !== 'locked') return;
    busy = true;
    setStatus('Unlocking saved Gemini key…');
    render();
    try {
      if (typeof bridge.unlockSavedGeminiApiKey !== 'function') throw new Error('Secure unlock unavailable.');
      const result = await bridge.unlockSavedGeminiApiKey();
      if (result?.unlocked !== true) throw new Error('Gemini key unlock failed.');
      stage = 'unlocked';
      setStatus('Gemini key is unlocked. It remains hidden in this interface.');
      await onUnlock();
    } catch {
      stage = 'locked';
      setStatus('Could not unlock the saved Gemini key. Check OS-backed encryption and try again.');
    } finally {
      busy = false;
      elements.input.value = '';
      render();
    }
  }

  async function changeKey() {
    if (busy || !['locked', 'unlocked', 'session'].includes(stage)) return;
    busy = true;
    setStatus('Preparing to change the Gemini key…');
    render();
    try {
      if (isDesktop) {
        if (typeof bridge.lockGeminiApiKey !== 'function') throw new Error('Secure lock unavailable.');
        const result = await bridge.lockGeminiApiKey();
        if (result?.locked !== true) throw new Error('Gemini key lock failed.');
        await onLock();
      }
      stage = 'editing';
      setStatus('Enter the replacement key, then choose Save & Lock.');
    } catch {
      setStatus('Could not lock the active Gemini key. The saved key remains unchanged.');
    } finally {
      busy = false;
      elements.input.value = '';
      render();
      if (stage === 'editing') elements.input.focus();
    }
  }

  function setProvider(value) {
    provider = value;
    if (provider !== 'gemini') elements.input.value = '';
    render();
  }

  function refreshLanguage() {
    render();
  }

  elements.input.addEventListener('input', render);
  elements.saveButton.addEventListener('click', save);
  elements.unlockButton.addEventListener('click', unlock);
  elements.changeButton.addEventListener('click', changeKey);

  render();
  return Object.freeze({ initialize, setProvider, refreshLanguage, save, unlock, changeKey });
}
