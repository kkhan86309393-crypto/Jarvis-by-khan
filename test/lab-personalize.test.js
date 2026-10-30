import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LAB_PREFERENCES,
  LAB_PREFERENCES_KEY,
  applyLabPreferences,
  loadLabPreferences,
  normalizeLabPreferences,
  resetLabPreferencesDraft,
  saveLabPreferences,
} from '../public/lab-personalize.js';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    values,
  };
}

test('saves and restores LAB preferences without modifying JARVIS preferences', () => {
  const storage = createStorage({ 'jarvis.preferences.v1': '{"voiceURI":"existing-voice"}' });
  const input = {
    theme: 'light',
    accent: 'violet',
    density: 'compact',
    voiceURI: 'lab-voice',
    widgets: { assistant: false, status: true, voice: false, chat: true, system: false },
  };

  assert.deepEqual(saveLabPreferences(input, storage), input);
  assert.deepEqual(loadLabPreferences(storage), input);
  assert.equal(storage.values.get('jarvis.preferences.v1'), '{"voiceURI":"existing-voice"}');
});

test('applies appearance and widget visibility without changing the saved voice preference', () => {
  const widgets = ['assistant', 'voice', 'system'].map((name) => ({
    dataset: { labWidget: name },
    hidden: false,
  }));
  const properties = new Map();
  const document = {
    documentElement: {
      dataset: {},
      style: { setProperty: (name, value) => properties.set(name, value) },
    },
    querySelectorAll: () => widgets,
  };
  const preferences = {
    ...DEFAULT_LAB_PREFERENCES,
    theme: 'light',
    accent: 'amber',
    density: 'compact',
    voiceURI: 'lab-only-voice',
    widgets: { ...DEFAULT_LAB_PREFERENCES.widgets, assistant: false, voice: false },
  };

  assert.deepEqual(applyLabPreferences(preferences, document), preferences);
  assert.deepEqual(document.documentElement.dataset, {
    labTheme: 'light',
    labDensity: 'compact',
    labAccent: 'amber',
  });
  assert.equal(properties.get('--lab-accent'), '#f2bf77');
  assert.equal(widgets[0].hidden, true);
  assert.equal(widgets[1].hidden, true);
  assert.equal(widgets[2].hidden, false);
  assert.equal(preferences.voiceURI, 'lab-only-voice');
});

test('reset restores the default draft without writing to storage', () => {
  const storage = createStorage();
  const reset = resetLabPreferencesDraft();

  assert.deepEqual(reset, DEFAULT_LAB_PREFERENCES);
  assert.equal(storage.values.has(LAB_PREFERENCES_KEY), false);
});

test('ignores malformed or invalid saved preference values', () => {
  const storage = createStorage({
    [LAB_PREFERENCES_KEY]: JSON.stringify({ theme: 'unknown', accent: 'invalid', density: 'wide', widgets: { chat: 'no' } }),
  });

  assert.deepEqual(loadLabPreferences(storage), DEFAULT_LAB_PREFERENCES);
  assert.deepEqual(normalizeLabPreferences(null), DEFAULT_LAB_PREFERENCES);
});
