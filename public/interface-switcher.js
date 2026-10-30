const PREFERENCE_KEY = 'jarvis.interface.mode.v7';
const LEGACY_PREFERENCE_KEYS = ['jarvis.interface.mode.v6', 'jarvis.interface.mode.v5', 'jarvis.interface.mode.v4'];

export function readWorkspaceView(storage, defaultView = 'chat') {
  for (const key of LEGACY_PREFERENCE_KEYS) storage.removeItem(key);
  const savedView = storage.getItem(PREFERENCE_KEY);
  if (savedView === 'new') return 'dashboard';
  if (savedView === 'old') return 'chat';
  return defaultView;
}

export function saveWorkspaceView(view, storage) {
  storage.setItem(PREFERENCE_KEY, view === 'dashboard' ? 'new' : 'old');
}

export function switchWorkspaceView(view, { dashboard, conversation, lab = null, body, navigationItems }) {
  if (!['dashboard', 'chat', 'lab'].includes(view) || (view === 'lab' && !lab)) {
    throw new TypeError('Unknown J.A.R.V.I.S. interface.');
  }

  dashboard.hidden = view !== 'dashboard';
  conversation.hidden = view !== 'chat';
  if (lab) lab.hidden = view !== 'lab';
  body.classList.toggle('chat-view', view === 'chat');
  body.classList.toggle('new-interface', view === 'dashboard');
  body.classList.toggle('jarvis-lab-view', view === 'lab');
  body.classList.remove('mobile-system-open', 'mobile-news-open', 'mobile-activity-open');
  navigationItems.forEach((item) => item.classList.toggle('is-current', item.dataset.nav === view));
}
