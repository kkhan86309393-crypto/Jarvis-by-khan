const PREFERENCE_KEY = 'jarvis.interface.mode.v7';
const LEGACY_PREFERENCE_KEYS = ['jarvis.interface.mode.v6', 'jarvis.interface.mode.v5', 'jarvis.interface.mode.v4'];

export function readWorkspaceView(storage) {
  for (const key of LEGACY_PREFERENCE_KEYS) storage.removeItem(key);
  return storage.getItem(PREFERENCE_KEY) === 'new' ? 'dashboard' : 'chat';
}

export function saveWorkspaceView(view, storage) {
  storage.setItem(PREFERENCE_KEY, view === 'dashboard' ? 'new' : 'old');
}

export function switchWorkspaceView(view, { dashboard, conversation, body, navigationItems }) {
  if (view !== 'dashboard' && view !== 'chat') throw new TypeError('Unknown J.A.R.V.I.S. interface.');

  dashboard.hidden = view !== 'dashboard';
  conversation.hidden = view !== 'chat';
  body.classList.toggle('chat-view', view === 'chat');
  body.classList.toggle('new-interface', view === 'dashboard');
  body.classList.remove('mobile-system-open', 'mobile-news-open', 'mobile-activity-open');
  navigationItems.forEach((item) => item.classList.toggle('is-current', item.dataset.nav === view));
}
