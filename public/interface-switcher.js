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
