export const LAB_PREFERENCES_KEY = 'jarvis.lab.personalize.v1';

export const DEFAULT_LAB_PREFERENCES = Object.freeze({
  theme: 'system',
  accent: 'cyan',
  density: 'comfortable',
  voiceURI: '',
  widgets: Object.freeze({
    assistant: true,
    status: true,
    voice: true,
    chat: true,
    system: true,
  }),
});

export const LAB_ACCENTS = Object.freeze({
  cyan: '#83e8ff',
  blue: '#62a8ff',
  violet: '#b59bff',
  mint: '#75e4bd',
  amber: '#f2bf77',
});

const LAB_ACCENT_STRONGS = Object.freeze({
  cyan: '#2a9dff',
  blue: '#347fda',
  violet: '#8f6de0',
  mint: '#2d9d79',
  amber: '#bd812f',
});

const THEMES = new Set(['dark', 'light', 'system']);
const DENSITIES = new Set(['comfortable', 'compact']);
const WIDGET_KEYS = Object.keys(DEFAULT_LAB_PREFERENCES.widgets);

export function normalizeLabPreferences(value = {}) {
  const preferences = value && typeof value === 'object' ? value : {};
  const widgets = preferences.widgets && typeof preferences.widgets === 'object'
    ? preferences.widgets
    : {};

  return {
    theme: THEMES.has(preferences.theme) ? preferences.theme : DEFAULT_LAB_PREFERENCES.theme,
    accent: Object.hasOwn(LAB_ACCENTS, preferences.accent) ? preferences.accent : DEFAULT_LAB_PREFERENCES.accent,
    density: DENSITIES.has(preferences.density) ? preferences.density : DEFAULT_LAB_PREFERENCES.density,
    voiceURI: typeof preferences.voiceURI === 'string' ? preferences.voiceURI : '',
    widgets: Object.fromEntries(WIDGET_KEYS.map((key) => [
      key,
      typeof widgets[key] === 'boolean' ? widgets[key] : DEFAULT_LAB_PREFERENCES.widgets[key],
    ])),
  };
}

export function loadLabPreferences(storage) {
  try {
    const saved = storage.getItem(LAB_PREFERENCES_KEY);
    return saved ? normalizeLabPreferences(JSON.parse(saved)) : normalizeLabPreferences();
  } catch {
    return normalizeLabPreferences();
  }
}

export function saveLabPreferences(value, storage) {
  const preferences = normalizeLabPreferences(value);
  storage.setItem(LAB_PREFERENCES_KEY, JSON.stringify(preferences));
  return preferences;
}

export function applyLabPreferences(value, document) {
  const preferences = normalizeLabPreferences(value);
  const root = document.documentElement;
  root.dataset.labTheme = preferences.theme;
  root.dataset.labDensity = preferences.density;
  root.dataset.labAccent = preferences.accent;
  root.style.setProperty('--lab-accent', LAB_ACCENTS[preferences.accent]);
  root.style.setProperty('--lab-accent-strong', LAB_ACCENT_STRONGS[preferences.accent]);

  for (const widget of document.querySelectorAll('[data-lab-widget]')) {
    widget.hidden = preferences.widgets[widget.dataset.labWidget] === false;
  }
  return preferences;
}

export function resetLabPreferencesDraft() {
  return normalizeLabPreferences();
}
