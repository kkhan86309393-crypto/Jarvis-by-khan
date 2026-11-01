import assert from 'node:assert/strict';
import test from 'node:test';
import { createGeminiKeySettingsController } from '../public/gemini-key-settings.js';
import { translateUiText } from '../public/ui-localization.js';

function createButton() {
  const listeners = new Map();
  return {
    hidden: false,
    disabled: false,
    textContent: '',
    addEventListener(type, listener) { listeners.set(type, listener); },
    click() { return listeners.get('click')?.(); },
  };
}

function createInput() {
  const listeners = new Map();
  return {
    value: '',
    placeholder: '',
    disabled: false,
    required: false,
    addEventListener(type, listener) { listeners.set(type, listener); },
    focus() { this.focused = true; },
    input() { return listeners.get('input')?.(); },
  };
}

function createControls() {
  return {
    actions: { hidden: true },
    label: { textContent: '' },
    input: createInput(),
    model: { disabled: false, value: 'gemini-test-model' },
    saveButton: createButton(),
    unlockButton: createButton(),
    changeButton: createButton(),
    status: { textContent: '' },
  };
}

test('Electron Save & Lock stores through IPC and clears/locks the masked input', async () => {
  const controls = createControls();
  const calls = [];
  const key = 'test-only-gemini-ui-key';
  const controller = createGeminiKeySettingsController({
    bridge: {
      hasSavedGeminiApiKey: async () => ({ hasSavedKey: false, persistentStorageAvailable: true }),
      saveGeminiApiKey: async (value, model) => {
        calls.push(['save', value, model]);
        return { saved: true, persistentStorageAvailable: true, configuredForSession: false };
      },
      unlockSavedGeminiApiKey: async () => ({ unlocked: true }),
      lockGeminiApiKey: async () => ({ locked: true }),
    },
    elements: controls,
    getModel: () => controls.model.value,
  });
  controller.setProvider('gemini');
  await controller.initialize();
  controls.input.value = key;
  await controls.saveButton.click();

  assert.deepEqual(calls, [['save', key, 'gemini-test-model']]);
  assert.equal(controls.input.value, '');
  assert.equal(controls.input.disabled, true);
  assert.equal(controls.model.disabled, true);
  assert.equal(controls.input.placeholder, '••••••••');
  assert.equal(controls.saveButton.hidden, true);
  assert.equal(controls.unlockButton.hidden, false);
  assert.match(controls.status.textContent, /saved securely and locked/i);
  assert.doesNotMatch(controls.status.textContent, new RegExp(key));
});

test('Electron Unlock uses secure IPC without returning or rendering key material, and Change Key re-locks', async () => {
  const controls = createControls();
  const calls = [];
  const controller = createGeminiKeySettingsController({
    bridge: {
      hasSavedGeminiApiKey: async () => ({ hasSavedKey: true, persistentStorageAvailable: true }),
      saveGeminiApiKey: async () => ({ saved: true, persistentStorageAvailable: true }),
      unlockSavedGeminiApiKey: async () => {
        calls.push('unlock');
        return { unlocked: true };
      },
      lockGeminiApiKey: async () => {
        calls.push('lock');
        return { locked: true };
      },
    },
    elements: controls,
  });
  controller.setProvider('gemini');
  await controller.initialize();
  await controls.unlockButton.click();
  assert.deepEqual(calls, ['unlock']);
  assert.equal(controls.input.value, '');
  assert.equal(controls.input.disabled, true);
  assert.equal(controls.model.disabled, true);
  assert.match(controls.status.textContent, /remains hidden/i);
  await controls.changeButton.click();
  assert.deepEqual(calls, ['unlock', 'lock']);
  assert.equal(controls.input.disabled, false);
  assert.equal(controls.input.focused, true);
  assert.equal(controls.saveButton.hidden, false);
});

test('saved key status after restart starts locked without exposing any key', async () => {
  const controls = createControls();
  let controller;
  controller = createGeminiKeySettingsController({
    bridge: {
      hasSavedGeminiApiKey: async () => ({
        hasSavedKey: true,
        persistentStorageAvailable: true,
        model: 'gemini-saved-model',
      }),
      saveGeminiApiKey: async () => ({ saved: true, persistentStorageAvailable: true }),
      unlockSavedGeminiApiKey: async () => ({ unlocked: true }),
      lockGeminiApiKey: async () => ({ locked: true }),
    },
    elements: controls,
    onStatus: (status) => {
      controls.model.value = status.model;
      controller.setProvider('gemini');
    },
  });
  controller.setProvider('openai-compatible');
  await controller.initialize();

  assert.equal(controls.model.value, 'gemini-saved-model');
  assert.equal(controls.model.disabled, true);
  assert.equal(controls.input.value, '');
  assert.equal(controls.input.disabled, true);
  assert.equal(controls.unlockButton.hidden, false);
  assert.match(controls.status.textContent, /is locked/i);
});

test('browser mode uses only the session callback and clearly discloses non-persistence', async () => {
  const controls = createControls();
  const key = 'test-only-browser-session-key';
  const saved = [];
  const controller = createGeminiKeySettingsController({
    elements: controls,
    onBrowserSave: async (value) => {
      saved.push(value);
      return { configured: true };
    },
  });
  controller.setProvider('gemini');
  await controller.initialize();
  assert.match(controls.status.textContent, /server memory for this session only/i);
  controls.input.value = key;
  await controls.saveButton.click();

  assert.deepEqual(saved, [key]);
  assert.equal(controls.input.value, '');
  assert.equal(controls.input.disabled, true);
  assert.equal(controls.unlockButton.hidden, true);
  assert.equal(controls.changeButton.hidden, false);
  assert.match(controls.status.textContent, /not saved in this browser/i);
  assert.doesNotMatch(controls.status.textContent, new RegExp(key));
});

test('Gemini key controls are localized through the active language callback', async () => {
  const controls = createControls();
  const controller = createGeminiKeySettingsController({
    elements: controls,
    onBrowserSave: async () => ({ configured: true }),
    translate: (text) => translateUiText(text, 'hi'),
  });
  controller.setProvider('gemini');
  await controller.initialize();
  assert.equal(controls.label.textContent, 'Google Gemini API कुंजी');
  controller.refreshLanguage();
  assert.equal(controls.label.textContent, 'Google Gemini API कुंजी');
  assert.equal(controls.saveButton.textContent, 'इस सत्र के लिए उपयोग करें');
});

test('OpenAI-compatible key entry remains enabled and required outside Gemini mode', () => {
  const controls = createControls();
  const controller = createGeminiKeySettingsController({ elements: controls });
  controller.setProvider('openai-compatible');

  assert.equal(controls.actions.hidden, true);
  assert.equal(controls.input.disabled, false);
  assert.equal(controls.input.required, true);
});
