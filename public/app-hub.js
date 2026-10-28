const STORAGE_KEY = 'jarvis.app-hub.v1';
const MAX_SHORTCUTS = 60;
const MAX_ICON_BYTES = 256_000;
const IMAGE_DATA_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const BLOCKED_INTENT_SCHEMES = new Set(['javascript', 'data', 'file', 'content', 'intent']);

const defaultShortcuts = [
  { id: 'jarvis-default-google', name: 'Google', url: 'https://www.google.com/' },
  { id: 'jarvis-default-youtube', name: 'YouTube', url: 'https://www.youtube.com/' },
  { id: 'jarvis-default-github', name: 'GitHub', url: 'https://github.com/' },
  { id: 'jarvis-default-wikipedia', name: 'Wikipedia', url: 'https://www.wikipedia.org/' },
];

export function normalizeWebUrl(value) {
  if (typeof value !== 'string') throw new TypeError('Enter an HTTP or HTTPS website address.');
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2_048 || /[\u0000-\u0020\u007f]/.test(trimmed)) {
    throw new TypeError('Enter a valid website address without spaces or control characters.');
  }
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new TypeError('Enter a valid HTTP or HTTPS website address.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new TypeError('Only HTTP or HTTPS websites without embedded credentials are allowed.');
  }
  return url.href;
}

export function parseAppDestination(value, fallbackValue = '') {
  if (typeof value !== 'string') throw new TypeError('Enter a website URL or supported Android intent link.');
  const trimmed = value.trim();
  if (trimmed.length > 2_048 || /[\u0000-\u0020\u007f]/.test(trimmed)) {
    throw new TypeError('The destination URL is too long or contains invalid characters.');
  }

  if (/^intent:/i.test(trimmed)) {
    const match = /^intent:\/\/([^#\s]+)#Intent;([^#]+);end$/i.exec(trimmed);
    if (!match) throw new TypeError('Enter a complete Android intent:// link.');
    const parameters = new Map();
    for (const part of match[2].split(';')) {
      const separator = part.indexOf('=');
      if (separator <= 0) continue;
      parameters.set(part.slice(0, separator), part.slice(separator + 1));
    }
    const scheme = parameters.get('scheme')?.toLowerCase();
    const packageName = parameters.get('package');
    if (!scheme || BLOCKED_INTENT_SCHEMES.has(scheme) || !/^[a-z][a-z\d+.-]*$/.test(scheme)) {
      throw new TypeError('This Android intent uses an unsupported or unsafe app scheme.');
    }
    if (!packageName || !/^[A-Za-z][A-Za-z\d_]*(?:\.[A-Za-z][A-Za-z\d_]*)+$/.test(packageName)) {
      throw new TypeError('Android intent links must identify a valid app package.');
    }

    let fallbackUrl = fallbackValue ? normalizeWebUrl(fallbackValue) : '';
    const embeddedFallback = parameters.get('S.browser_fallback_url');
    if (!fallbackUrl && embeddedFallback) {
      try {
        fallbackUrl = normalizeWebUrl(decodeURIComponent(embeddedFallback));
      } catch {
        throw new TypeError('The fallback embedded in this Android intent is not a safe website URL.');
      }
    }
    if (!fallbackUrl) {
      fallbackUrl = `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}`;
    }
    const launchUrl = `intent://${match[1]}#Intent;scheme=${scheme};package=${packageName};S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;
    return { url: launchUrl, kind: 'intent', fallbackUrl, packageName };
  }

  return {
    url: normalizeWebUrl(trimmed),
    kind: 'web',
    fallbackUrl: fallbackValue ? normalizeWebUrl(fallbackValue) : '',
    packageName: '',
  };
}

function normalizeIcon(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > MAX_ICON_BYTES * 1.4 || !IMAGE_DATA_PATTERN.test(value)) {
    throw new TypeError('Choose a PNG, JPEG, or WebP icon smaller than 256 KB.');
  }
  const encoded = value.slice(value.indexOf(',') + 1);
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  if (Math.floor(encoded.length * 3 / 4) - padding > MAX_ICON_BYTES) {
    throw new TypeError('The selected icon must be smaller than 256 KB.');
  }
  return value;
}

export function normalizeShortcut(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Shortcut details are invalid.');
  }
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name || name.length > 32 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new TypeError('Enter an app name between 1 and 32 characters.');
  }
  const destination = parseAppDestination(value.url, value.fallbackUrl || '');
  const id = typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value.id)
    ? value.id
    : createShortcutId();
  return {
    id,
    name,
    url: destination.url,
    kind: destination.kind,
    fallbackUrl: destination.fallbackUrl,
    packageName: destination.packageName,
    icon: normalizeIcon(value.icon),
  };
}

function createShortcutId() {
  return globalThis.crypto?.randomUUID?.().replaceAll('-', '') || `app-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function writeShortcuts(shortcuts, storage = globalThis.localStorage) {
  if (!Array.isArray(shortcuts) || shortcuts.length > MAX_SHORTCUTS) {
    throw new TypeError(`You can save up to ${MAX_SHORTCUTS} app shortcuts.`);
  }
  const normalized = shortcuts.map(normalizeShortcut);
  const ids = new Set(normalized.map(({ id }) => id));
  if (ids.size !== normalized.length) throw new TypeError('App shortcut identifiers must be unique.');
  storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function readShortcuts(storage = globalThis.localStorage) {
  const saved = storage.getItem(STORAGE_KEY);
  if (saved === null) return writeShortcuts(defaultShortcuts, storage);
  let parsed;
  try {
    parsed = JSON.parse(saved);
  } catch {
    throw new Error('Saved App Hub shortcuts could not be read. Clear this browser’s App Hub data and try again.');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Saved App Hub data has an invalid format. Clear this browser’s App Hub data and try again.');
  }
  if (parsed.length > MAX_SHORTCUTS || parsed.some((shortcut) => !shortcut || typeof shortcut.id !== 'string')) {
    throw new Error('Saved App Hub shortcuts exceed their limit or are missing identifiers. Clear this browser’s App Hub data and try again.');
  }
  const normalized = parsed.map(normalizeShortcut);
  if (new Set(normalized.map(({ id }) => id)).size !== normalized.length) {
    throw new Error('Saved App Hub shortcuts contain duplicate identifiers. Clear this browser’s App Hub data and try again.');
  }
  return normalized;
}

export function openAppDestination(value, openWindow = (...args) => globalThis.window.open(...args)) {
  const destination = typeof value === 'string'
    ? parseAppDestination(value)
    : parseAppDestination(value.url, value.fallbackUrl || '');
  const openSafely = (url) => {
    const opened = openWindow(url, '_blank');
    if (opened && typeof opened === 'object') opened.opener = null;
    return Boolean(opened);
  };
  if (openSafely(destination.url)) return { opened: true, usedFallback: false, destination };
  if (destination.fallbackUrl && openSafely(destination.fallbackUrl)) {
    return { opened: true, usedFallback: true, destination };
  }
  return { opened: false, usedFallback: false, destination };
}

function setStatus(root, message, isError = false) {
  const status = root.querySelector('[data-hub-status]');
  status.textContent = message;
  status.dataset.state = isError ? 'error' : 'ready';
}

function iconElement(shortcut) {
  const icon = document.createElement('span');
  icon.className = 'app-hub-icon';
  icon.setAttribute('aria-hidden', 'true');
  if (shortcut.icon) {
    const image = document.createElement('img');
    image.src = shortcut.icon;
    image.alt = '';
    icon.append(image);
  } else {
    icon.textContent = shortcut.name.slice(0, 2).toUpperCase();
  }
  return icon;
}

function button(label, action, className = '') {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.dataset.hubAction = action;
  element.textContent = label;
  element.setAttribute('aria-label', label);
  return element;
}

function renderShortcuts(root, shortcuts, query) {
  const list = root.querySelector('[data-hub-apps]');
  const normalizedQuery = query.trim().toLowerCase();
  const matches = shortcuts.filter((shortcut) => `${shortcut.name} ${shortcut.url}`.toLowerCase().includes(normalizedQuery));
  list.replaceChildren();
  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'app-hub-empty';
    empty.textContent = shortcuts.length ? 'No saved apps match this search.' : 'Your hub is clear. Add an app or website shortcut to get started.';
    list.append(empty);
    return;
  }

  matches.forEach((shortcut) => {
    const card = document.createElement('article');
    card.className = 'app-hub-card';
    card.append(iconElement(shortcut));
    const description = document.createElement('div');
    description.className = 'app-hub-card-copy';
    const title = document.createElement('strong');
    title.textContent = shortcut.name;
    const address = document.createElement('span');
    address.textContent = shortcut.kind === 'intent' ? 'Android app link' : new URL(shortcut.url).hostname;
    description.append(title, address);
    card.append(description);

    const actions = document.createElement('div');
    actions.className = 'app-hub-card-actions';
    const launch = button('Open', 'launch', 'app-hub-launch');
    launch.dataset.shortcutId = shortcut.id;
    actions.append(launch);
    if (shortcut.fallbackUrl) {
      const fallback = button('Fallback', 'fallback', 'app-hub-small-action');
      fallback.dataset.shortcutId = shortcut.id;
      fallback.title = 'Open website or Play Store fallback';
      actions.append(fallback);
    }
    const edit = button('Edit', 'edit', 'app-hub-small-action');
    edit.dataset.shortcutId = shortcut.id;
    actions.append(edit);
    const moveUp = button('Move up', 'up', 'app-hub-small-action');
    moveUp.dataset.shortcutId = shortcut.id;
    moveUp.disabled = shortcuts.indexOf(shortcut) === 0;
    actions.append(moveUp);
    const moveDown = button('Move down', 'down', 'app-hub-small-action');
    moveDown.dataset.shortcutId = shortcut.id;
    moveDown.disabled = shortcuts.indexOf(shortcut) === shortcuts.length - 1;
    actions.append(moveDown);
    const remove = button('Delete', 'delete', 'app-hub-small-action danger');
    remove.dataset.shortcutId = shortcut.id;
    actions.append(remove);
    card.append(actions);
    list.append(card);
  });
}

function setFormValue(root, name, value) {
  const field = root.querySelector(`[data-hub-field="${name}"]`);
  if (field) field.value = value;
}

function setFormMode(root, shortcut = null) {
  const form = root.querySelector('[data-hub-form]');
  if (shortcut) {
    form.hidden = false;
    form.dataset.editingId = shortcut.id;
    setFormValue(root, 'name', shortcut.name);
    setFormValue(root, 'url', shortcut.url);
    setFormValue(root, 'fallback', shortcut.fallbackUrl);
    root.querySelector('[data-hub-icon-status]').textContent = shortcut.icon ? 'Saved icon retained unless replaced.' : 'No icon selected.';
    form.dataset.icon = shortcut.icon;
  } else {
    form.hidden = true;
    delete form.dataset.editingId;
    delete form.dataset.icon;
    form.reset();
    root.querySelector('[data-hub-icon-status]').textContent = 'PNG, JPEG, or WebP; up to 256 KB.';
  }
}

function moveShortcut(shortcuts, id, offset) {
  const index = shortcuts.findIndex((shortcut) => shortcut.id === id);
  const nextIndex = index + offset;
  if (index < 0 || nextIndex < 0 || nextIndex >= shortcuts.length) return shortcuts;
  const reordered = [...shortcuts];
  [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
  return reordered;
}

function readIconFile(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > MAX_ICON_BYTES) {
    return Promise.reject(new TypeError('Choose a PNG, JPEG, or WebP icon smaller than 256 KB.'));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      try {
        resolve(normalizeIcon(reader.result));
      } catch (error) {
        reject(error);
      }
    }, { once: true });
    reader.addEventListener('error', () => reject(new Error('The selected icon could not be read.')), { once: true });
    reader.readAsDataURL(file);
  });
}

function renderAll(roots, shortcuts) {
  for (const root of roots) {
    renderShortcuts(root, shortcuts, root.querySelector('[data-hub-search]').value);
  }
}

export function initializeAppHubs({
  documentObject = globalThis.document,
  storage = globalThis.localStorage,
  openWindow = (...args) => globalThis.window.open(...args),
  onActivity = () => {},
} = {}) {
  const roots = [...documentObject.querySelectorAll('[data-app-hub]')];
  if (!roots.length) return;
  let shortcuts;
  try {
    shortcuts = readShortcuts(storage);
    renderAll(roots, shortcuts);
  } catch (error) {
    for (const root of roots) setStatus(root, error.message, true);
    return;
  }

  const persist = () => {
    try {
      shortcuts = writeShortcuts(shortcuts, storage);
      renderAll(roots, shortcuts);
      return true;
    } catch (error) {
      for (const root of roots) setStatus(root, error.message, true);
      return false;
    }
  };

  for (const root of roots) {
    root.addEventListener('input', (event) => {
      if (event.target.matches('[data-hub-search]')) {
        renderShortcuts(root, shortcuts, event.target.value);
      }
    });

    root.addEventListener('submit', async (event) => {
      const form = event.target.closest('[data-hub-form], [data-hub-runner]');
      if (!form) return;
      event.preventDefault();
      if (form.matches('[data-hub-runner]')) {
        try {
          const destination = parseAppDestination(
            root.querySelector('[data-hub-field="run-url"]').value,
            root.querySelector('[data-hub-field="run-fallback"]').value,
          );
          const result = openAppDestination(destination, openWindow);
          setStatus(root, result.opened
            ? result.usedFallback
              ? 'The link could not be opened; its safe fallback was opened instead.'
              : destination.kind === 'intent'
                ? 'Android app link sent to your browser or operating system; support depends on this device and browser.'
                : 'Website opened in a new tab.'
            : 'The browser blocked the new tab. Allow pop-ups and try again.', !result.opened);
          if (result.opened) onActivity(`Opened ${destination.kind === 'intent' ? 'Android app link' : 'website'}: ${new URL(destination.fallbackUrl || destination.url).hostname}`);
        } catch (error) {
          setStatus(root, error.message, true);
        }
        return;
      }

      try {
        const name = root.querySelector('[data-hub-field="name"]').value;
        const url = root.querySelector('[data-hub-field="url"]').value;
        const fallbackUrl = root.querySelector('[data-hub-field="fallback"]').value;
        const iconInput = root.querySelector('[data-hub-field="icon"]');
        const editingId = form.dataset.editingId;
        const oldShortcut = shortcuts.find((shortcut) => shortcut.id === editingId);
        const icon = form.dataset.icon || oldShortcut?.icon || '';
        const shortcut = normalizeShortcut({
          id: editingId,
          name,
          url,
          fallbackUrl,
          icon: iconInput.files?.[0] ? await readIconFile(iconInput.files[0]) : icon,
        });
        if (editingId) {
          shortcuts = shortcuts.map((saved) => saved.id === editingId ? shortcut : saved);
        } else {
          if (shortcuts.length >= MAX_SHORTCUTS) throw new TypeError(`You can save up to ${MAX_SHORTCUTS} app shortcuts.`);
          shortcuts = [...shortcuts, shortcut];
        }
        if (persist()) {
          for (const hub of roots) {
            setFormMode(hub);
            setStatus(hub, `${shortcut.name} saved on this device.`);
          }
          onActivity(`Saved App Hub shortcut: ${shortcut.name}`);
        }
      } catch (error) {
        setStatus(root, error.message, true);
      }
    });

    root.addEventListener('click', (event) => {
      const actionButton = event.target.closest('[data-hub-action]');
      if (!actionButton) return;
      const action = actionButton.dataset.hubAction;
      const id = actionButton.dataset.shortcutId;
      const shortcut = shortcuts.find((saved) => saved.id === id);
      if (action === 'add') {
        setFormMode(root);
        root.querySelector('[data-hub-form]').hidden = false;
        root.querySelector('[data-hub-field="name"]').focus();
      } else if (action === 'cancel') {
        setFormMode(root);
      } else if (action === 'launch' && shortcut) {
        const result = openAppDestination(shortcut, openWindow);
        setStatus(root, result.opened
          ? result.usedFallback
            ? 'The app link could not be opened; its fallback was opened instead.'
            : shortcut.kind === 'intent'
              ? 'Android app link sent to your browser or operating system; support depends on this device and browser.'
              : `Opened ${shortcut.name} in a new tab.`
          : 'The browser blocked the new tab. Allow pop-ups and try again.', !result.opened);
        if (result.opened) onActivity(`Opened App Hub shortcut: ${shortcut.name}`);
      } else if (action === 'fallback' && shortcut?.fallbackUrl) {
        const result = openAppDestination(shortcut.fallbackUrl, openWindow);
        setStatus(root, result.opened ? 'Fallback website or Play Store opened in a new tab.' : 'The browser blocked the new tab.', !result.opened);
      } else if (action === 'edit' && shortcut) {
        setFormMode(root, shortcut);
        root.querySelector('[data-hub-field="name"]').focus();
      } else if (action === 'delete' && shortcut) {
        shortcuts = shortcuts.filter((saved) => saved.id !== id);
        if (persist()) {
          setStatus(root, `${shortcut.name} removed from this device.`);
          onActivity(`Removed App Hub shortcut: ${shortcut.name}`);
        }
      } else if (action === 'up' || action === 'down') {
        shortcuts = moveShortcut(shortcuts, id, action === 'up' ? -1 : 1);
        persist();
      }
    });

    root.addEventListener('change', async (event) => {
      if (!event.target.matches('[data-hub-field="icon"]')) return;
      try {
        const icon = await readIconFile(event.target.files?.[0]);
        const form = root.querySelector('[data-hub-form]');
        form.dataset.icon = icon;
        root.querySelector('[data-hub-icon-status]').textContent = 'Icon ready. Save the shortcut to keep it on this device.';
      } catch (error) {
        event.target.value = '';
        setStatus(root, error.message, true);
      }
    });
  }

  globalThis.addEventListener?.('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    try {
      shortcuts = readShortcuts(storage);
      renderAll(roots, shortcuts);
      for (const root of roots) setStatus(root, 'App Hub shortcuts updated in another tab.');
    } catch (error) {
      for (const root of roots) setStatus(root, error.message, true);
    }
  });
}
