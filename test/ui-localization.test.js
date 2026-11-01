import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  applyUiLanguage,
  getUiLanguagePreference,
  normalizeUiLanguage,
  observeUiLanguage,
  translateUiText,
} from '../public/ui-localization.js';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

function createText(value, parentElement) {
  return { nodeType: 3, nodeValue: value, parentElement };
}

function createElement(tagName, attributes = {}, classes = []) {
  const element = {
    nodeType: 1,
    tagName,
    attributes: new Map(Object.entries(attributes)),
    classes: new Set(classes),
    value: attributes.value ?? '',
    childNodes: [],
    parentElement: null,
    append(child) {
      child.parentElement = this;
      this.childNodes.push(child);
      return this;
    },
    closest(selector) {
      const selectors = selector.split(',').map((part) => part.trim());
      let current = this;
      while (current) {
        if (selectors.some((part) => current.matches(part))) {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    },
    matches(selector) {
      if (selector === '[data-no-translate]' || selector === '[data-hub-apps]') {
        return this.attributes.has(selector.slice(1, -1));
      }
      if (selector === 'input' || selector === 'textarea' || selector === 'code' || selector === 'pre') {
        return this.tagName.toLocaleLowerCase() === selector;
      }
      if (selector === '[contenteditable="true"]') {
        return this.attributes.get('contenteditable') === 'true';
      }
      if (selector.startsWith('.')) return this.classes.has(selector.slice(1));
      if (selector.startsWith('#')) return this.attributes.get('id') === selector.slice(1);
      if (selector.endsWith(' strong')) {
        return this.tagName === 'STRONG'
          && this.parentElement?.matches(selector.slice(0, -7));
      }
      return false;
    },
    hasAttribute(name) {
      return this.attributes.has(name);
    },
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    querySelectorAll() {
      const descendants = [];
      const visit = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 1) {
            descendants.push(child);
            visit(child);
          }
        }
      };
      visit(this);
      return descendants;
    },
  };
  return element;
}

function createDocument() {
  const documentElement = { lang: 'en' };
  const document = { documentElement, title: 'J.A.R.V.I.S. | Personal AI' };
  const body = createElement('BODY');
  body.ownerDocument = document;
  document.body = body;
  return { document, body };
}

test('Hindi selection translates Dashboard, navigation, settings, and primary section labels', () => {
  const { document, body } = createDocument();
  const dashboard = createElement('SECTION')
    .append(createText('Assistant status'))
    .append(createText('FOCUS TIMER'))
    .append(createText('Notes & Tasks'))
    .append(createText('News & Briefing'))
    .append(createText('Voice Assistant'))
    .append(createText('Load Custom Avatar'));
  const navigation = createElement('NAV', { 'aria-label': 'Primary navigation' })
    .append(createText('Productivity'))
    .append(createText('Settings'));
  body.append(dashboard).append(navigation);

  applyUiLanguage(body, 'hi');

  assert.equal(document.documentElement.lang, 'hi');
  assert.equal(document.title, 'J.A.R.V.I.S. | व्यक्तिगत AI');
  assert.deepEqual(dashboard.childNodes.map(({ nodeValue }) => nodeValue), [
    'सहायक की स्थिति',
    'फ़ोकस टाइमर',
    'नोट्स और कार्य',
    'समाचार और संक्षिप्त जानकारी',
    'वॉइस सहायक',
    'कस्टम अवतार लोड करें',
  ]);
  assert.equal(navigation.childNodes[0].nodeValue, 'उत्पादकता');
  assert.equal(navigation.childNodes[1].nodeValue, 'सेटिंग्स');
  assert.equal(navigation.getAttribute('aria-label'), 'मुख्य नेविगेशन');
});

test('English selection restores original labels and preserves technical or unknown text', () => {
  assert.equal(translateUiText('फ़ोकस टाइमर', 'en'), 'FOCUS TIMER');
  assert.equal(translateUiText('J.A.R.V.I.S. v2.1', 'hi'), 'J.A.R.V.I.S. v2.1');
  assert.equal(translateUiText('https://example.com/नोट', 'hi'), 'https://example.com/नोट');
  assert.equal(translateUiText('A user-entered title', 'hi'), 'A user-entered title');
  assert.equal(translateUiText('  Settings  ', 'hi'), '  सेटिंग्स  ');
  assert.equal(normalizeUiLanguage('unsupported'), 'en');
});

test('switching languages restores original DOM text and attributes without reverse-lookup ambiguity', () => {
  const { document, body } = createDocument();
  const settings = createElement('BUTTON', { title: 'Settings' })
    .append(createText('Settings'))
    .append(createText('OFF'));
  body.append(settings);

  applyUiLanguage(body, 'hi');
  assert.deepEqual(settings.childNodes.map(({ nodeValue }) => nodeValue), ['सेटिंग्स', 'बंद']);
  assert.equal(settings.getAttribute('title'), 'सेटिंग्स');

  applyUiLanguage(body, 'en');
  assert.deepEqual(settings.childNodes.map(({ nodeValue }) => nodeValue), ['Settings', 'OFF']);
  assert.equal(settings.getAttribute('title'), 'Settings');
  assert.equal(document.documentElement.lang, 'en');
});

test('new dynamic messages and changed accessibility attributes follow the selected language', () => {
  const { document, body } = createDocument();
  let notify;
  document.defaultView = {
    MutationObserver: class {
      constructor(callback) {
        notify = callback;
      }

      observe() {}

      disconnect() {}
    },
  };
  let language = 'hi';
  const stopObserving = observeUiLanguage(document, () => language);
  const loading = createElement('P').append(createText('Loading…'));
  body.append(loading);
  notify([{ type: 'childList', addedNodes: [loading] }]);
  assert.equal(loading.childNodes[0].nodeValue, 'लोड हो रहा है…');

  const search = createElement('INPUT', { 'aria-label': 'Search notes' });
  body.append(search);
  notify([{ type: 'childList', addedNodes: [search] }]);
  assert.equal(search.getAttribute('aria-label'), 'नोट खोजें');

  const protectedRoot = createElement('DIV', { 'data-no-translate': '' })
    .append(createElement('BUTTON', { 'aria-label': 'Settings', title: 'Settings' })
      .append(createText('Settings')));
  body.append(protectedRoot);
  notify([{ type: 'childList', addedNodes: [protectedRoot] }]);
  assert.equal(protectedRoot.childNodes[0].childNodes[0].nodeValue, 'Settings');
  assert.equal(protectedRoot.childNodes[0].getAttribute('aria-label'), 'Settings');
  assert.equal(protectedRoot.childNodes[0].getAttribute('title'), 'Settings');

  search.setAttribute('aria-label', 'Search tasks');
  notify([{ type: 'attributes', target: search, attributeName: 'aria-label' }]);
  assert.equal(search.getAttribute('aria-label'), 'कार्य खोजें');

  language = 'en';
  applyUiLanguage(body, language);
  assert.equal(loading.childNodes[0].nodeValue, 'Loading…');
  assert.equal(search.getAttribute('aria-label'), 'Search tasks');
  stopObserving();
});

test('reloading saved preferences restores the selected language and changing it is persisted', () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
  const preferencesKey = 'jarvis.preferences.v1';
  const preferences = { language: 'hi', voiceEnabled: true, studyMode: false };
  storage.setItem(preferencesKey, JSON.stringify(preferences));

  const restored = JSON.parse(storage.getItem(preferencesKey));
  assert.equal(getUiLanguagePreference(restored), 'hi');

  restored.language = 'en';
  storage.setItem(preferencesKey, JSON.stringify(restored));
  assert.equal(getUiLanguagePreference(JSON.parse(storage.getItem(preferencesKey))), 'en');
  assert.match(app, /language: getUiLanguagePreference\(stored\)/);
  assert.match(app, /state\.preferences\.language = elements\.language\.value;[\s\S]*?savePreferences\(\);[\s\S]*?applyUiLanguage\(document\.body/);
  assert.match(app, /function localizeActivityLog\(\)[\s\S]*?label\.dataset\.uiSource/);
  assert.match(app, /localizeActivityLog\(\);[\s\S]*?if \(state\.recognitionWakeSession\)/);
});

test('dynamic status and error text translates without translating user data and falls back when missing', () => {
  const taskTitle = 'Review the Hindi report';
  const dynamic = translateUiText(`Focus session selected for "${taskTitle}".`, 'hi');
  assert.equal(dynamic, `फ़ोकस सत्र "${taskTitle}" के लिए चुना गया।`);
  assert.equal(translateUiText(dynamic, 'en'), `Focus session selected for "${taskTitle}".`);
  assert.equal(
    translateUiText(`Focus task selected for active session: ${taskTitle}`, 'hi'),
    `सक्रिय सत्र के लिए फ़ोकस कार्य चुना गया: ${taskTitle}`,
  );
  assert.equal(
    translateUiText('Preference · Created Jan 1 · Updated Jan 2', 'hi'),
    'पसंद · बनाया गया: Jan 1 · अपडेट किया गया: Jan 2',
  );
  assert.equal(translateUiText('Could not save note: quota exceeded', 'hi'), 'नोट सहेजा नहीं जा सका: quota exceeded');
  assert.equal(translateUiText('A future message without a translation', 'hi'), 'A future message without a translation');
  assert.equal(translateUiText('Searching available web sources...', 'hi'), 'उपलब्ध वेब स्रोत खोजे जा रहे हैं…');
});

test('dynamic messages round-trip exactly between English and Hindi', () => {
  const messages = [
    'Next action: Review report',
    'Oldest pending: Submit tax · 2 days',
    'Available activity: Focus timer started',
    'Focus task selected for active session: Review report',
    'Priority suggestion dismissed: Review report',
    'Web lookup: 1 result',
    'Web lookup: 2 results',
    'Created Jan 1 · Updated Jan 2',
    'Focus session selected for "Review report".',
    'Focus timer started: Review report',
    'Focus timer started for 25 minutes.',
    'Focus timer state could not be saved in this browser: quota exceeded',
    'Focus session complete, but its final state could not be saved: quota exceeded',
    'Could not save note: quota exceeded',
    'Could not delete note: quota exceeded',
    'Could not save task: quota exceeded',
    'Could not save memory: quota exceeded',
    'Memory approval could not be saved: quota exceeded',
    'Could not load this model: unsupported. The portrait remains available.',
    'Loading model.glb locally...',
    'Analysis complete via local model.',
    'The request timed out. Check your connection or AI provider, then try again.',
    '3 pending · 4 completed today',
    'Preference · Created Jan 1 · Updated Jan 2',
    'Waiting for your voice...',
    'Analyzing...',
    'Generating response...',
    'Ready',
    'Offline',
  ];

  for (const english of messages) {
    const hindi = translateUiText(english, 'hi');
    assert.notEqual(hindi, english, `expected Hindi translation for: ${english}`);
    assert.equal(translateUiText(hindi, 'en'), english, `round-trip mismatch for: ${english}`);
  }
});

test('planner user text and conversation content are protected while placeholders localize', () => {
  const { document, body } = createDocument();
  const title = createElement('P', {}, ['planner-item-content']).append(createText('Settings'));
  const plannerItem = createElement('LI', {}, ['planner-item']).append(title);
  const transcript = createElement('DIV', {}, ['transcript']).append(createText('Settings'));
  const input = createElement('INPUT', { placeholder: 'Search notes', value: 'User-entered value' });
  const codeEditor = createElement('TEXTAREA', {
    id: 'code-studio-editor',
    'aria-label': 'Code editor text',
    value: 'Settings',
  }).append(createText('Settings'));
  body.append(plannerItem).append(transcript).append(input).append(codeEditor);

  applyUiLanguage(body, 'hi');

  assert.equal(title.childNodes[0].nodeValue, 'Settings');
  assert.equal(transcript.childNodes[0].nodeValue, 'Settings');
  assert.equal(input.getAttribute('placeholder'), 'नोट खोजें');
  assert.equal(input.getAttribute('value'), 'User-entered value');
  assert.equal(input.value, 'User-entered value');
  assert.equal(codeEditor.childNodes[0].nodeValue, 'Settings');
  assert.equal(codeEditor.getAttribute('aria-label'), 'Code editor text');
  assert.equal(codeEditor.value, 'Settings');
});

test('language wiring preserves existing navigation and major section order', () => {
  const sectionOrder = [
    'data-nav="dashboard"',
    'data-nav="chat"',
    'data-nav="voice"',
    'data-nav="history"',
    'data-nav="files"',
    'data-nav="applications"',
    'data-nav="study"',
    'data-nav="productivity"',
    'data-nav="system"',
    'data-nav="news"',
    'data-nav="memory"',
    'data-nav="activity"',
    'data-nav="settings"',
    'data-nav="lab"',
  ].map((marker) => html.indexOf(marker));
  assert.ok(sectionOrder.every((index) => index >= 0));
  assert.deepEqual(sectionOrder, [...sectionOrder].sort((a, b) => a - b));
  assert.match(app, /observeUiLanguage\(document, \(\) => state\.preferences\.language\)/);
  assert.match(html, /id="language-select"[\s\S]*?<option value="en">English<\/option><option value="hi">Hindi<\/option>/);
});
