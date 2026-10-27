import { readWorkspaceView, saveWorkspaceView, switchWorkspaceView } from './interface-switcher.js';
import { detectDeviceProfile } from './device-monitor.js';
import { applySpeechBoundaryCue, estimateAudioMouthOpening, initializeAvatar3d } from './avatar3d.bundle.js';
import { getPublicShareUrl } from './share-link.js';

const HISTORY_KEY = 'jarvis.history.v1';
const PREFERENCES_KEY = 'jarvis.preferences.v1';
const historyLimit = 80;
const defaults = {
  language: 'en',
  voiceURI: '',
  speechRate: 1,
  voiceEnabled: false,
  memoryEnabled: true,
  fullAccessEnabled: false,
  studyMode: false,
};

const elements = {
  transcript: document.querySelector('#transcript'),
  feedback: document.querySelector('#assistant-feedback'),
  message: document.querySelector('#message-input'),
  form: document.querySelector('#chat-form'),
  send: document.querySelector('#send-button'),
  searchToggle: document.querySelector('#search-toggle'),
  mic: document.querySelector('#mic-button'),
  stage: document.querySelector('#holo-stage'),
  avatar: document.querySelector('#ai-avatar'),
  avatarFrame: document.querySelector('.avatar-frame'),
  avatarFallback: document.querySelector('#avatar-fallback'),
  avatarCanvas: document.querySelector('#avatar-canvas'),
  avatarModelButton: document.querySelector('#avatar-model-button'),
  avatarModelInput: document.querySelector('#avatar-model-input'),
  avatarModelStatus: document.querySelector('#avatar-model-status'),
  avatarAudioSyncButton: document.querySelector('#avatar-audio-sync-button'),
  avatarAudioSyncStatus: document.querySelector('#avatar-audio-sync-status'),
  dashboardLayout: document.querySelector('#dashboard-layout'),
  dashboardChatPanel: document.querySelector('.dashboard-chat-panel'),
  conversationView: document.querySelector('#conversation-view'),
  dashboardTranscript: document.querySelector('#dashboard-transcript'),
  dashboardFeedback: document.querySelector('#dashboard-feedback'),
  assistantState: document.querySelector('#assistant-state'),
  presenceTitle: document.querySelector('#presence-title'),
  presenceAiStatus: document.querySelector('#presence-ai-status'),
  presenceMicStatus: document.querySelector('#presence-mic-status'),
  presenceMemoryStatus: document.querySelector('#presence-memory-status'),
  avatarExpressionReadout: document.querySelector('#avatar-expression-readout'),
  providerNote: document.querySelector('#provider-note'),
  connection: document.querySelector('#connection-status'),
  settings: document.querySelector('#settings-dialog'),
  shareLinkButton: document.querySelector('#share-link-button'),
  copyLinkButton: document.querySelector('#copy-link-button'),
  shareStatus: document.querySelector('#share-status'),
  aiSettingsForm: document.querySelector('#ai-settings-form'),
  aiProvider: document.querySelector('#ai-provider-select'),
  aiModel: document.querySelector('#ai-model-input'),
  aiBaseUrl: document.querySelector('#ai-base-url'),
  aiBaseUrlField: document.querySelector('#ai-base-url-field'),
  aiApiKey: document.querySelector('#ai-api-key'),
  aiKeyField: document.querySelector('#ai-key-field'),
  aiProviderHelp: document.querySelector('#ai-provider-help'),
  aiSetupStatus: document.querySelector('#ai-setup-status'),
  aiSettingsSave: document.querySelector('#ai-settings-save'),
  aiSettingsEnvironment: document.querySelector('#ai-settings-environment'),
  language: document.querySelector('#language-select'),
  voice: document.querySelector('#voice-select'),
  voiceSupport: document.querySelector('#voice-support'),
  speechRate: document.querySelector('#speech-rate'),
  speechRateValue: document.querySelector('#speech-rate-value'),
  voiceEnabled: document.querySelector('#voice-enabled'),
  memoryEnabled: document.querySelector('#memory-enabled'),
  install: document.querySelector('#install-button'),
  installHelp: document.querySelector('#install-help'),
  installInstructions: document.querySelector('#install-instructions'),
  footerStatus: document.querySelector('#footer-status'),
  accessToken: document.querySelector('#access-token'),
  fullAccess: document.querySelector('#full-access-toggle'),
  fullAccessMobile: document.querySelector('#full-access-mobile-toggle'),
  accessNote: document.querySelector('#access-mode-note'),
  activityLog: document.querySelector('#activity-log'),
  networkValue: document.querySelector('#network-value'),
  voiceValue: document.querySelector('#voice-value'),
  voiceOutputValue: document.querySelector('#voice-output-value'),
  backendConnectionValue: document.querySelector('#backend-connection-value'),
  memoryValue: document.querySelector('#memory-value'),
  modelValue: document.querySelector('#model-value'),
  deviceTypeValue: document.querySelector('#device-type-value'),
  platformValue: document.querySelector('#platform-value'),
  batteryValue: document.querySelector('#battery-value'),
  browserMemoryValue: document.querySelector('#browser-memory-value'),
  fileInput: document.querySelector('#file-input'),
  attachButton: document.querySelector('#attach-button'),
  attachmentNote: document.querySelector('#attachment-note'),
  briefingButton: document.querySelector('#news-button'),
  briefingResults: document.querySelector('#briefing-results'),
  leftAiStatus: document.querySelector('#left-ai-status'),
  leftAiDetail: document.querySelector('#left-ai-detail'),
  leftSessionStatus: document.querySelector('#left-session-status'),
  leftMemoryStatus: document.querySelector('#left-memory-status'),
  voiceConsoleStatus: document.querySelector('#voice-console-status'),
  dashboardMicButton: document.querySelector('#dashboard-mic-button'),
  dashboardVoiceToggle: document.querySelector('#dashboard-voice-toggle'),
  dashboardVoiceLabel: document.querySelector('#dashboard-voice-label'),
  dashboardSettingsButton: document.querySelector('#dashboard-settings-button'),
  dashboardAttachButton: document.querySelector('#dashboard-attach-button'),
  dashboardFileStatus: document.querySelector('#dashboard-file-status'),
  dashboardCommandForm: document.querySelector('#dashboard-command-form'),
  dashboardMessage: document.querySelector('#dashboard-message'),
  dashboardSend: document.querySelector('#dashboard-command-form button[type="submit"]'),
  dashboardChatState: document.querySelector('#dashboard-chat-state'),
  dashboardChatStateLabel: document.querySelector('#dashboard-chat-state-label'),
  dashboardRetryButton: document.querySelector('#dashboard-retry-button'),
  voiceWaveform: document.querySelector('#voice-waveform'),
  leftMicStatus: document.querySelector('#left-mic-status'),
  leftModeStatus: document.querySelector('#left-mode-status'),
  leftLanguageStatus: document.querySelector('#left-language-status'),
  studyIndicator: document.querySelector('#study-mode-indicator'),
  studyQuickIndicator: document.querySelector('#study-quick-indicator'),
  cpuValue: document.querySelector('#cpu-value'),
  cpuMeter: document.querySelector('#cpu-meter'),
  cpuMeterTrack: document.querySelector('#cpu-meter-track'),
  ramValue: document.querySelector('#ram-value'),
  ramMeter: document.querySelector('#ram-meter'),
  ramMeterTrack: document.querySelector('#ram-meter-track'),
  diskValue: document.querySelector('#disk-value'),
  diskMeter: document.querySelector('#disk-meter'),
  diskMeterTrack: document.querySelector('#disk-meter-track'),
  monitorContext: document.querySelector('#monitor-context'),
  cpuLabel: document.querySelector('#cpu-label'),
  ramLabel: document.querySelector('#ram-label'),
  diskLabel: document.querySelector('#disk-label'),
  fileSearchDialog: document.querySelector('#file-search-dialog'),
  fileSearchQuery: document.querySelector('#file-search-query'),
  fileSearchResults: document.querySelector('#file-search-results'),
  historyDialog: document.querySelector('#history-dialog'),
  historyCount: document.querySelector('#history-count'),
  historyList: document.querySelector('#history-list'),
  applicationDialog: document.querySelector('#application-dialog'),
  applicationUrl: document.querySelector('#application-url'),
  screenCaptureDialog: document.querySelector('#screen-capture-dialog'),
  capturePreview: document.querySelector('#capture-preview'),
  captureCanvas: document.querySelector('#capture-canvas'),
  captureFrameButton: document.querySelector('#capture-frame-button'),
  downloadCapture: document.querySelector('#download-capture'),
  stopCaptureButton: document.querySelector('#stop-capture-button'),
  captureStatus: document.querySelector('#capture-status'),
  moreNavigationDialog: document.querySelector('#more-navigation-dialog'),
  focusTimerDisplay: document.querySelector('#focus-timer-display'),
  focusTimerButton: document.querySelector('#focus-timer-button'),
};

function readStoredJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function loadPreferences() {
  const stored = readStoredJson(PREFERENCES_KEY, {});
  return {
    ...defaults,
    ...stored,
    language: stored.language === 'hi' ? 'hi' : 'en',
    speechRate: Number.isFinite(Number(stored.speechRate)) ? Math.min(1.3, Math.max(.7, Number(stored.speechRate))) : 1,
    voiceURI: typeof stored.voiceURI === 'string' ? stored.voiceURI : '',
    voiceEnabled: stored.voiceEnabled === true,
    memoryEnabled: stored.memoryEnabled !== false,
    fullAccessEnabled: stored.fullAccessEnabled === true,
    studyMode: stored.studyMode === true,
  };
}

function loadWorkspaceView() {
  try {
    return readWorkspaceView(localStorage);
  } catch {
    return 'chat';
  }
}

const state = {
  preferences: loadPreferences(),
  messages: [],
  voices: [],
  pending: false,
  searchMode: false,
  recognition: null,
  listening: false,
  installPrompt: null,
  accessRequired: false,
  accessToken: '',
  pendingAttachment: null,
  speechPlaybackId: 0,
  workspaceView: loadWorkspaceView(),
  displayStream: null,
  audioLipSyncStream: null,
  audioLipSyncContext: null,
  audioLipSyncAnalyser: null,
  audioLipSyncBuffer: null,
  audioLipSyncTimer: null,
  audioLipSyncStarting: false,
  focusRemaining: 25 * 60,
  focusTimerId: null,
  captureObjectUrl: null,
  assistantMode: 'normal',
  avatarMoodTimer: null,
  microphonePermission: 'unknown',
  lastChatFailure: null,
  aiSettingsLoaded: false,
};

const avatar3d = initializeAvatar3d({
  frame: elements.avatarFrame,
  canvas: elements.avatarCanvas,
  image: elements.avatar,
  mouthOverlay: document.querySelector('#portrait-mouth'),
  fileInput: elements.avatarModelInput,
  modelButton: elements.avatarModelButton,
  status: elements.avatarModelStatus,
});

function loadHistory() {
  if (!state.preferences.memoryEnabled) return [];
  const stored = readStoredJson(HISTORY_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.slice(-historyLimit).filter((message) => (
    message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string'
  ));
}

function savePreferences() {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(state.preferences));
  } catch {
    showFeedback('Preferences could not be saved in this browser.');
  }
}

function saveHistory() {
  if (!state.preferences.memoryEnabled) return;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.messages.slice(-historyLimit)));
  } catch {
    showFeedback('History could not be saved. Browser storage may be full.');
  }
}

function showFeedback(message = '') {
  elements.feedback.textContent = message;
  elements.dashboardFeedback.textContent = message;
}

function logActivity(message) {
  const item = document.createElement('li');
  const marker = document.createElement('i');
  const label = document.createElement('span');
  const time = document.createElement('time');
  label.textContent = message;
  time.textContent = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date());
  item.append(marker, label, time);
  elements.activityLog.prepend(item);
  while (elements.activityLog.children.length > 6) elements.activityLog.lastElementChild.remove();
  elements.leftSessionStatus.textContent = 'ACTIVE';
}

function syncFullAccess() {
  const enabled = state.preferences.fullAccessEnabled;
  elements.fullAccess.checked = enabled;
  elements.fullAccessMobile.checked = enabled;
  elements.accessNote.textContent = enabled ? 'In-app actions enabled' : 'Browser-safe actions only';
  document.querySelectorAll('[data-requires-full-access]').forEach((control) => {
    control.disabled = !enabled;
    control.title = enabled ? 'Run this action inside J.A.R.V.I.S.' : 'Enable Full Access to use app shortcuts';
  });
}

function setAssistantState(mode, label) {
  window.clearTimeout(state.avatarMoodTimer);
  state.avatarMoodTimer = null;
  const supportedModes = ['normal', 'listening', 'speaking', 'thinking', 'happy', 'error', 'offline'];
  state.assistantMode = supportedModes.includes(mode) ? mode : 'normal';
  elements.stage.classList.remove(...supportedModes.filter((item) => item !== 'normal').map((item) => `is-${item}`));
  if (state.assistantMode !== 'normal') elements.stage.classList.add(`is-${state.assistantMode}`);
  elements.assistantState.textContent = label;
  elements.presenceTitle.textContent = ({
    listening: "I'm listening.",
    thinking: 'One moment.',
    speaking: 'Speaking.',
    error: 'I could not complete that request.',
    offline: 'Connection unavailable.',
  })[state.assistantMode] || 'At your service.';
  elements.voiceConsoleStatus.textContent = label;
  renderMicrophoneStatus();
  elements.voiceOutputValue.textContent = state.assistantMode === 'speaking'
    ? 'Speaking'
    : 'speechSynthesis' in window ? state.preferences.voiceEnabled ? 'Ready' : 'Off' : 'Not available';
  elements.voiceWaveform.classList.toggle('is-active', ['listening', 'speaking'].includes(state.assistantMode));
  elements.voiceWaveform.classList.toggle('is-listening', state.assistantMode === 'listening');
  elements.voiceWaveform.setAttribute('aria-label', ({
    listening: 'Listening for speech',
    speaking: 'Assistant voice playing',
    thinking: 'Assistant is thinking',
    error: 'Assistant request failed',
    offline: 'Assistant connection unavailable',
  })[state.assistantMode] || 'Voice channel idle');
  updateAvatarExpression(state.assistantMode);
  avatar3d.setState(state.assistantMode);
}

function updateAvatarExpression(expression) {
  const supportedState = ['normal', 'listening', 'thinking', 'speaking', 'happy', 'error', 'offline'].includes(expression)
    ? expression
    : 'normal';
  const activeState = supportedState === 'offline' ? 'error' : supportedState;
  const stateLabel = ({
    normal: 'IDLE',
    listening: 'LISTENING',
    thinking: 'THINKING',
    speaking: 'SPEAKING',
    happy: 'HAPPY',
    error: 'ERROR / OFFLINE',
  })[activeState];
  elements.avatarExpressionReadout.textContent = stateLabel;
  document.querySelectorAll('[data-expression]').forEach((item) => {
    item.classList.toggle('is-current', item.dataset.expression === activeState);
  });
}

function setDashboardChatState(mode, message = '', canRetry = false) {
  elements.dashboardChatState.hidden = !message;
  elements.dashboardChatState.dataset.state = mode;
  elements.dashboardChatStateLabel.textContent = message;
  elements.dashboardRetryButton.hidden = !canRetry;
  elements.dashboardRetryButton.disabled = state.pending;
}

function messageElement(message) {
  const wrapper = document.createElement('article');
  wrapper.className = `message ${message.role}`;

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = message.role === 'user' ? 'YOU' : 'J.A.R.V.I.S.';
  wrapper.append(meta);

  if (message.kind === 'search') {
    const source = document.createElement('span');
    source.className = 'message-source';
    source.textContent = message.data?.source || 'WEB RESULTS';
    wrapper.append(source);
    const results = Array.isArray(message.data?.results) ? message.data.results : [];
    for (const result of results) {
      if (typeof result.url !== 'string') continue;
      let safeUrl;
      try {
        safeUrl = new URL(result.url);
      } catch {
        continue;
      }
      if (!['http:', 'https:'].includes(safeUrl.protocol)) continue;
      const item = document.createElement('div');
      item.className = 'search-result';
      const link = document.createElement('a');
      link.href = safeUrl.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = result.title || safeUrl.hostname;
      item.append(link);
      if (result.snippet) {
        const snippet = document.createElement('p');
        snippet.textContent = result.snippet;
        item.append(snippet);
      }
      wrapper.append(item);
    }
    if (!results.length) {
      const notice = document.createElement('p');
      notice.className = 'search-notice';
      notice.textContent = message.data?.notice || 'No search results were returned.';
      wrapper.append(notice);
    }
    return wrapper;
  }

  const body = document.createElement('div');
  body.className = 'message-body';
  body.textContent = message.content;
  wrapper.append(body);
  return wrapper;
}

function renderMessages() {
  const transcripts = [elements.transcript, elements.dashboardTranscript];
  for (const transcript of transcripts) transcript.replaceChildren();
  if (!state.messages.length) {
    for (const transcript of transcripts) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const title = document.createElement('strong');
      title.textContent = 'Your session begins here.';
      const description = document.createElement('span');
      description.textContent = 'Ask a question, start a voice conversation, or search for a source-backed answer.';
      empty.append(title, description);
      transcript.append(empty);
    }
    return;
  }

  for (const transcript of transcripts) {
    for (const message of state.messages) transcript.append(messageElement(message));
    transcript.scrollTop = transcript.scrollHeight;
  }
}

function addMessage(message) {
  state.messages.push(message);
  state.messages = state.messages.slice(-historyLimit);
  renderMessages();
  saveHistory();
}

async function readApiResponse(response) {
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('The server returned an unreadable response.');
  }
  if (!response.ok) throw new Error(data.error || `Request failed with status ${response.status}.`);
  return data;
}

function getRequestErrorMessage(error, action = 'request') {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return `The ${action} timed out. Check your connection or AI provider, then try again.`;
  }
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return 'J.A.R.V.I.S. could not reach its server. Check your internet connection and that the server is running.';
  }
  return error?.message || `The ${action} failed. Please try again.`;
}

function apiHeaders(json = false) {
  const headers = {};
  if (json) headers['content-type'] = 'application/json';
  if (state.accessToken) headers.authorization = `Bearer ${state.accessToken}`;
  return headers;
}

async function sendChat(text, { retry = false } = {}) {
  const context = state.messages
    .filter((message) => !message.kind && ['user', 'assistant'].includes(message.role))
    .slice(-20)
    .map(({ role, content }) => ({ role, content }));
  if (!retry) state.lastChatFailure = null;
  setDashboardChatState('thinking', 'J.A.R.V.I.S. is processing your message.');
  setAssistantState('thinking', 'PROCESSING REQUEST');
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: apiHeaders(true),
      body: JSON.stringify({
        messages: context,
        language: state.preferences.language,
        mode: state.preferences.studyMode ? 'study' : 'standard',
      }),
      signal: AbortSignal.timeout(65_000),
    });
    const data = await readApiResponse(response);
    state.lastChatFailure = null;
    setDashboardChatState('', '');
    addMessage({ role: 'assistant', content: data.reply });
    elements.providerNote.textContent = `Connected through ${data.provider}. Search results are retrieved separately and linked to their sources.`;
    elements.modelValue.textContent = data.provider;
    elements.leftAiStatus.textContent = 'AI RESPONDED';
    elements.leftAiDetail.textContent = `Most recent successful reply came from ${data.provider}.`;
    logActivity('Assistant reply received');
    setAssistantState('happy', 'RESPONSE READY');
    state.avatarMoodTimer = window.setTimeout(() => {
      if (state.assistantMode === 'happy') setAssistantState('', 'SYSTEM STANDBY');
    }, 1400);
    if (state.preferences.voiceEnabled) speak(data.reply);
  } catch (error) {
    const message = getRequestErrorMessage(error, 'AI request');
    showFeedback(message);
    addMessage({ role: 'assistant', content: message });
    state.lastChatFailure = { text, message };
    setDashboardChatState('error', message, true);
    elements.leftAiStatus.textContent = 'REQUEST FAILED';
    elements.leftAiDetail.textContent = message;
    logActivity('Chat request unavailable');
    setAssistantState('error', 'REQUEST FAILED');
  } finally {
    state.pending = false;
    elements.send.disabled = false;
    elements.dashboardSend.disabled = false;
    elements.dashboardRetryButton.disabled = false;
    if (state.assistantMode === 'thinking' && (!state.preferences.voiceEnabled || !('speechSynthesis' in window))) {
      setAssistantState('', 'SYSTEM STANDBY');
    }
  }
}

function retryLastChat() {
  if (state.pending || !state.lastChatFailure) return;
  const failure = state.lastChatFailure;
  const lastMessage = state.messages.at(-1);
  if (lastMessage?.role === 'assistant' && lastMessage.content === failure.message) {
    state.messages.pop();
    renderMessages();
    saveHistory();
  }
  state.pending = true;
  elements.send.disabled = true;
  elements.dashboardSend.disabled = true;
  setDashboardChatState('thinking', 'Retrying your last message.');
  sendChat(failure.text, { retry: true });
}

async function searchWeb(query) {
  setDashboardChatState('thinking', 'Searching available web sources.');
  setAssistantState('thinking', 'SEARCHING THE WEB');
  try {
    const params = new URLSearchParams({ q: query, lang: state.preferences.language });
    const response = await fetch(`/api/search?${params}`, { headers: apiHeaders(), signal: AbortSignal.timeout(18_000) });
    const data = await readApiResponse(response);
    setDashboardChatState('', '');
    state.accessRequired = data.accessRequired === true;
    addMessage({ role: 'assistant', content: '', kind: 'search', data });
    elements.providerNote.textContent = `Retrieved results from ${data.source}. Results are shown as retrieved; no AI summary is implied.`;
    logActivity(`Web lookup: ${data.results.length} result${data.results.length === 1 ? '' : 's'}`);
  } catch (error) {
    const message = getRequestErrorMessage(error, 'web search');
    showFeedback(message);
    addMessage({ role: 'assistant', content: message });
    setDashboardChatState('error', message);
    setAssistantState('error', 'SEARCH UNAVAILABLE');
  } finally {
    state.pending = false;
    elements.send.disabled = false;
    elements.dashboardSend.disabled = false;
    if (state.assistantMode === 'thinking') setAssistantState('', 'SYSTEM STANDBY');
  }
}

function submitMessage(event) {
  event.preventDefault();
  if (state.pending) return;
  const text = elements.message.value.trim();
  if (!text) return;
  const attachment = state.pendingAttachment;
  const outgoingText = attachment ? `${text}\n\n[Attached file: ${attachment.name}]\n${attachment.content}` : text;
  if (outgoingText.length > 4_000) {
    showFeedback('Message and attachment together must be under 4,000 characters. Shorten the message or attach a smaller file.');
    return;
  }
  elements.message.value = '';
  elements.message.style.height = '';
  state.pendingAttachment = null;
  elements.attachmentNote.hidden = true;
  elements.attachmentNote.textContent = '';
  elements.fileInput.value = '';
  showFeedback('');
  addMessage({ role: 'user', content: outgoingText });
  state.pending = true;
  elements.send.disabled = true;
  elements.dashboardSend.disabled = true;
  if (state.searchMode) searchWeb(outgoingText);
  else sendChat(outgoingText);
}

function updateSearchMode() {
  elements.searchToggle.setAttribute('aria-pressed', String(state.searchMode));
  elements.message.placeholder = state.searchMode ? 'Search the web for...' : 'Ask J.A.R.V.I.S. anything...';
  elements.send.querySelector('span').textContent = state.searchMode ? 'Search' : 'Send';
  elements.send.setAttribute('aria-label', state.searchMode ? 'Search the web' : 'Send message');
  elements.send.title = state.searchMode ? 'Search the web' : 'Send message';
}

function selectedVoice() {
  return state.voices.find((voice) => voice.voiceURI === state.preferences.voiceURI) || null;
}

function speak(text) {
  if (!('speechSynthesis' in window) || !state.preferences.voiceEnabled) return;
  const playbackId = ++state.speechPlaybackId;
  setAvatarMouth(0);
  elements.stage.classList.remove('is-speech-paused');
  if (state.assistantMode === 'speaking') setAssistantState('', 'SYSTEM STANDBY');
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = state.preferences.language === 'hi' ? 'hi-IN' : 'en-US';
  utterance.rate = state.preferences.speechRate;
  utterance.voice = selectedVoice();
  utterance.onstart = () => {
    if (playbackId !== state.speechPlaybackId) return;
    setAssistantState('speaking', 'VOICE OUTPUT');
    logActivity('Voice response started');
  };
  utterance.onboundary = (event) => {
    if (playbackId !== state.speechPlaybackId || (event.name && event.name !== 'word')) return;
    applySpeechBoundaryCue(text, event, (opening, viseme) => {
      if (state.audioLipSyncAnalyser) avatar3d.setViseme(viseme);
      else setAvatarMouth(opening, viseme);
    });
  };
  utterance.onpause = () => {
    if (playbackId !== state.speechPlaybackId) return;
    setAvatarMouth(0);
    elements.stage.classList.add('is-speech-paused');
    setAssistantState('', 'VOICE PAUSED');
  };
  utterance.onresume = () => {
    if (playbackId !== state.speechPlaybackId) return;
    elements.stage.classList.remove('is-speech-paused');
    setAssistantState('speaking', 'VOICE OUTPUT');
  };
  utterance.onend = () => {
    if (playbackId !== state.speechPlaybackId) return;
    state.speechPlaybackId += 1;
    setAvatarMouth(0);
    elements.stage.classList.remove('is-speech-paused');
    setAssistantState('', 'SYSTEM STANDBY');
    logActivity('Voice response complete');
  };
  utterance.onerror = (event) => {
    if (playbackId !== state.speechPlaybackId) return;
    state.speechPlaybackId += 1;
    setAvatarMouth(0);
    elements.stage.classList.remove('is-speech-paused');
    setAssistantState('', 'SYSTEM STANDBY');
    showFeedback(event.error === 'canceled' || event.error === 'interrupted'
      ? ''
      : 'Speech output is unavailable for the selected voice on this device.');
  };
  try {
    window.speechSynthesis.speak(utterance);
  } catch {
    state.speechPlaybackId += 1;
    setAvatarMouth(0);
    setAssistantState('', 'SYSTEM STANDBY');
    showFeedback('Speech output could not start on this device.');
  }
}

function setAvatarMouth(opening, viseme = 'aa') {
  elements.avatarFrame.style.setProperty('--mouth-open', String(opening));
  avatar3d.setMouth(opening);
  avatar3d.setViseme(viseme);
}

function stopSpeechOutput() {
  state.speechPlaybackId += 1;
  window.speechSynthesis.cancel();
  setAvatarMouth(0);
  elements.stage.classList.remove('is-speech-paused');
  if (state.assistantMode === 'speaking') setAssistantState('', 'SYSTEM STANDBY');
}

function stopAudioLipSync(message = 'Audio lip-sync is off. Browser word-boundary cues are used when available.') {
  const stream = state.audioLipSyncStream;
  const audioContext = state.audioLipSyncContext;
  if (state.audioLipSyncTimer) window.clearInterval(state.audioLipSyncTimer);
  state.audioLipSyncTimer = null;
  state.audioLipSyncStream = null;
  state.audioLipSyncContext = null;
  state.audioLipSyncAnalyser = null;
  state.audioLipSyncBuffer = null;
  stream?.getTracks().forEach((track) => track.stop());
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close().catch((error) => {
      elements.avatarAudioSyncStatus.textContent = `Audio processing could not close cleanly: ${error.message}`;
    });
  }
  elements.avatarAudioSyncButton.setAttribute('aria-pressed', 'false');
  elements.avatarAudioSyncButton.textContent = 'Sync mouth to tab audio';
  elements.avatarAudioSyncStatus.textContent = message;
  setAvatarMouth(0);
}

async function toggleAudioLipSync() {
  if (state.audioLipSyncStream) {
    stopAudioLipSync();
    return;
  }
  if (state.displayStream) {
    elements.avatarAudioSyncStatus.textContent = 'Stop the current screen-capture session before enabling audio lip-sync.';
    return;
  }
  if (state.audioLipSyncStarting) return;
  if (!navigator.mediaDevices?.getDisplayMedia || !window.AudioContext) {
    elements.avatarAudioSyncStatus.textContent = 'Tab-audio capture is unavailable in this browser. Word-boundary cues remain available when provided by the voice.';
    return;
  }

  elements.avatarAudioSyncButton.disabled = true;
  state.audioLipSyncStarting = true;
  elements.avatarAudioSyncStatus.textContent = 'Choose this J.A.R.V.I.S. browser tab and enable its audio in the browser sharing prompt.';
  let stream;
  let audioContext;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: true,
      preferCurrentTab: true,
    });
    const [audioTrack] = stream.getAudioTracks();
    if (!audioTrack) {
      throw new Error('No tab-audio track was shared. Choose this browser tab and enable Share tab audio.');
    }

    audioContext = new window.AudioContext();
    await audioContext.resume();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.58;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    stream.getVideoTracks().forEach((track) => track.stop());

    state.audioLipSyncStream = stream;
    state.audioLipSyncContext = audioContext;
    state.audioLipSyncAnalyser = analyser;
    state.audioLipSyncBuffer = new Float32Array(analyser.fftSize);
    state.audioLipSyncTimer = window.setInterval(() => {
      if (!state.audioLipSyncAnalyser || state.assistantMode !== 'speaking') {
        setAvatarMouth(0);
        return;
      }
      state.audioLipSyncAnalyser.getFloatTimeDomainData(state.audioLipSyncBuffer);
      setAvatarMouth(estimateAudioMouthOpening(state.audioLipSyncBuffer));
    }, 30);
    audioTrack.addEventListener('ended', () => {
      if (state.audioLipSyncStream === stream) {
        stopAudioLipSync('Shared-tab audio ended. Word-boundary cues are used again when available.');
      }
    }, { once: true });
    elements.avatarAudioSyncButton.textContent = 'Stop audio lip-sync';
    elements.avatarAudioSyncButton.setAttribute('aria-pressed', 'true');
    elements.avatarAudioSyncStatus.textContent = 'Using live tab-audio amplitude locally while J.A.R.V.I.S. speaks. This controls mouth opening, not phoneme timing.';
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    if (audioContext && audioContext.state !== 'closed') {
      await audioContext.close().catch((closeError) => {
        elements.avatarAudioSyncStatus.textContent = `Audio processing could not close cleanly: ${closeError.message}`;
      });
    }
    if (!elements.avatarAudioSyncStatus.textContent.startsWith('Audio processing could not close cleanly:')) {
      elements.avatarAudioSyncStatus.textContent = error.name === 'NotAllowedError'
        ? 'Audio sharing was cancelled or denied. No audio was captured.'
        : error.message || 'Tab audio could not be connected.';
    }
  } finally {
    state.audioLipSyncStarting = false;
    elements.avatarAudioSyncButton.disabled = false;
  }
}

elements.avatarAudioSyncButton.addEventListener('click', toggleAudioLipSync);
elements.avatar.addEventListener('error', () => {
  elements.avatar.classList.add('is-unavailable');
  elements.avatarFallback.hidden = false;
});

function updateVoiceList() {
  if (!('speechSynthesis' in window)) {
    elements.voice.disabled = true;
    elements.voiceEnabled.disabled = true;
    elements.voiceSupport.textContent = 'Speech output is not supported by this browser';
    return;
  }
  state.voices = window.speechSynthesis.getVoices();
  const oldValue = state.preferences.voiceURI;
  elements.voice.replaceChildren(new Option('System default', ''));
  for (const voice of state.voices) {
    const label = `${voice.name} (${voice.lang})${voice.default ? ' · default' : ''}`;
    elements.voice.add(new Option(label, voice.voiceURI));
  }
  elements.voice.value = state.voices.some((voice) => voice.voiceURI === oldValue) ? oldValue : '';
  elements.voiceSupport.textContent = state.voices.length ? `${state.voices.length} voice${state.voices.length === 1 ? '' : 's'} available on this device` : 'No system voices are available';
}

function startListening() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    showFeedback('Voice input is not supported by this browser. Try a current Chrome-based browser over HTTPS.');
    setAssistantState('error', 'VOICE INPUT UNAVAILABLE');
    return;
  }
  if (state.listening) {
    state.recognition?.stop();
    return;
  }

  const recognition = new Recognition();
  recognition.lang = state.preferences.language === 'hi' ? 'hi-IN' : 'en-US';
  recognition.interimResults = true;
  recognition.continuous = false;
  state.recognition = recognition;
  state.listening = true;
  elements.mic.classList.add('is-active');
  elements.mic.setAttribute('aria-label', 'Stop voice input');
  elements.mic.setAttribute('aria-pressed', 'true');
  elements.dashboardMicButton.classList.add('is-active');
  elements.dashboardMicButton.setAttribute('aria-label', 'Stop voice input');
  elements.dashboardMicButton.setAttribute('aria-pressed', 'true');
  setAssistantState('listening', 'LISTENING');
  showFeedback('Listening. Your browser may ask for microphone permission.');

  recognition.onresult = (event) => {
    let transcript = '';
    let finalResult = false;
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      transcript += event.results[index][0].transcript;
      finalResult ||= event.results[index].isFinal;
    }
    elements.message.value = transcript.trim();
    if (finalResult && elements.message.value) elements.form.requestSubmit();
  };
  recognition.onerror = (event) => {
    const messages = {
      'not-allowed': 'Microphone permission was denied. Allow access in your browser settings to use voice input.',
      'no-speech': 'No speech was detected. Try again when you are ready.',
      'network': 'Browser speech recognition is unavailable over the current network.',
    };
    showFeedback(messages[event.error] || `Voice input stopped: ${event.error}.`);
    setAssistantState('error', 'VOICE INPUT ERROR');
    stopListening();
  };
  recognition.onend = stopListening;
  try {
    recognition.start();
  } catch {
    showFeedback('The microphone could not be started. Check browser permissions and try again.');
    setAssistantState('error', 'MICROPHONE UNAVAILABLE');
    stopListening();
  }
}

function stopListening() {
  state.listening = false;
  elements.mic.classList.remove('is-active');
  elements.mic.setAttribute('aria-label', 'Start voice input');
  elements.mic.setAttribute('aria-pressed', 'false');
  elements.dashboardMicButton.classList.remove('is-active');
  elements.dashboardMicButton.setAttribute('aria-label', 'Start voice input');
  elements.dashboardMicButton.setAttribute('aria-pressed', 'false');
  if (elements.assistantState.textContent === 'LISTENING') setAssistantState('', 'SYSTEM STANDBY');
}

function syncSettings() {
  elements.language.value = state.preferences.language;
  elements.speechRate.value = String(state.preferences.speechRate);
  elements.speechRateValue.textContent = Number(state.preferences.speechRate).toFixed(1);
  elements.voiceEnabled.checked = state.preferences.voiceEnabled;
  elements.memoryEnabled.checked = state.preferences.memoryEnabled;
  elements.leftMemoryStatus.textContent = state.preferences.memoryEnabled ? 'LOCAL' : 'OFF';
  elements.presenceMemoryStatus.textContent = state.preferences.memoryEnabled ? 'MEMORY LOCAL' : 'MEMORY OFF';
  elements.leftMicStatus.textContent = window.SpeechRecognition || window.webkitSpeechRecognition ? 'AVAILABLE' : 'UNSUPPORTED';
  elements.presenceMicStatus.textContent = window.SpeechRecognition || window.webkitSpeechRecognition
    ? 'MIC AVAILABLE'
    : 'MIC UNSUPPORTED';
  elements.leftLanguageStatus.textContent = state.preferences.language === 'hi' ? 'HINDI' : 'ENGLISH';
  elements.leftModeStatus.textContent = state.preferences.studyMode ? 'STUDY' : 'STANDARD';
  elements.studyIndicator.textContent = state.preferences.studyMode ? 'ON' : 'OFF';
  elements.studyQuickIndicator.textContent = state.preferences.studyMode ? 'ON' : 'OFF';
  elements.dashboardVoiceToggle.setAttribute('aria-pressed', String(state.preferences.voiceEnabled));
  elements.dashboardVoiceLabel.textContent = state.preferences.voiceEnabled ? 'Voice on' : 'Voice off';
  elements.voiceOutputValue.textContent = 'speechSynthesis' in window
    ? state.preferences.voiceEnabled ? 'Ready' : 'Off'
    : 'Not available';
  elements.dashboardVoiceToggle.disabled = !('speechSynthesis' in window);
  syncFullAccess();
  updateVoiceList();
}

async function checkServer() {
  updateDeviceMonitor();
  elements.memoryValue.textContent = state.preferences.memoryEnabled ? 'Local storage' : 'Disabled';
  loadSystemMetrics();
  if (!navigator.onLine) {
    elements.backendConnectionValue.textContent = 'Offline';
    elements.connection.className = 'connection-indicator is-offline';
    elements.connection.lastElementChild.textContent = 'OFFLINE';
    elements.leftAiStatus.textContent = 'OFFLINE';
    elements.presenceAiStatus.textContent = 'AI OFFLINE';
    elements.leftAiDetail.textContent = 'The server cannot be reached while this device is offline.';
    elements.leftSessionStatus.textContent = 'OFFLINE';
    return;
  }
  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(5_000) });
    const data = await readApiResponse(response);
    state.accessRequired = data.accessRequired === true;
    const ollamaSelected = data.provider === 'ollama';
    const aiReady = data.aiConfigured && (!ollamaSelected || data.aiAvailable);
    if (!state.aiSettingsLoaded) {
      state.aiSettingsLoaded = true;
      elements.aiProvider.value = data.provider || 'openai-compatible';
      elements.aiModel.value = data.model || (ollamaSelected ? 'qwen2.5:3b' : 'gemini-2.5-flash');
      if (data.baseUrl) elements.aiBaseUrl.value = data.baseUrl;
      updateAIProviderFields();
    }
    elements.aiSetupStatus.textContent = data.aiConfigured
      ? `Current: ${data.provider === 'ollama' ? 'Ollama' : 'OpenAI-compatible'} · ${data.model}`
      : 'No AI provider is configured. Choose a provider and model here, then save.';
    elements.connection.className = aiReady ? 'connection-indicator' : 'connection-indicator is-warning';
    elements.connection.lastElementChild.textContent = aiReady
      ? ollamaSelected ? 'OLLAMA READY' : 'AI CONFIGURED'
      : ollamaSelected && !data.ollamaAvailable ? 'OLLAMA OFFLINE'
        : ollamaSelected ? 'MODEL MISSING' : 'NO AI MODEL';
    elements.providerNote.textContent = !data.aiConfigured
      ? 'No AI provider is configured. Open Settings → AI provider to select a model and configure Ollama or an OpenAI-compatible provider.'
      : ollamaSelected && !data.ollamaAvailable
        ? 'Ollama is selected but unreachable from this server. Start the Ollama daemon on the server host.'
        : ollamaSelected && !data.modelInstalled
          ? `Ollama is running, but ${data.model} is not installed there.`
          : ollamaSelected
            ? `Ollama and ${data.model} are available on the server.`
            : 'AI provider is configured on the server. Live availability is confirmed when you send a message.';
    if (state.accessRequired) {
      elements.providerNote.textContent += data.accessConfigured
        ? ' This server requires an access key; enter it in Settings.'
        : ' The production server is locked until its administrator configures APP_ACCESS_TOKEN.';
    }
    elements.modelValue.textContent = ollamaSelected
      ? data.aiAvailable ? data.model : data.ollamaAvailable ? 'Model missing' : 'Ollama offline'
      : data.aiConfigured ? 'Configured' : 'Not configured';
    elements.leftAiStatus.textContent = ollamaSelected
      ? data.aiAvailable ? 'OLLAMA READY' : data.ollamaAvailable ? 'MODEL MISSING' : 'OLLAMA OFFLINE'
      : data.aiConfigured ? 'PROVIDER SET' : 'NO MODEL';
    elements.presenceAiStatus.textContent = data.aiConfigured
      ? `${data.provider === 'ollama' ? 'OLLAMA' : 'AI'} ${data.aiAvailable ? 'READY' : 'SET'}`
      : 'AI NOT SET';
    elements.presenceMicStatus.textContent = window.SpeechRecognition || window.webkitSpeechRecognition
      ? 'MIC AVAILABLE'
      : 'MIC UNSUPPORTED';
    elements.presenceMemoryStatus.textContent = state.preferences.memoryEnabled ? 'MEMORY LOCAL' : 'MEMORY OFF';
    elements.leftAiDetail.textContent = ollamaSelected
      ? data.aiAvailable ? `${data.model} is available on this server.` : data.ollamaAvailable ? `${data.model} is not installed.` : 'Ollama is not reachable from this server.'
      : data.aiConfigured ? 'Provider is configured. Availability is confirmed when you send a message.' : 'Open Settings to configure an AI provider and model.';
    elements.leftSessionStatus.textContent = 'CONNECTED';
    elements.backendConnectionValue.textContent = 'Connected';
    elements.leftMemoryStatus.textContent = state.preferences.memoryEnabled ? 'LOCAL' : 'OFF';
    elements.footerStatus.textContent = aiReady ? 'SERVER AI · LOCAL HISTORY · PERMISSION-BOUND' : 'AI UNAVAILABLE · LOCAL HISTORY · PERMISSION-BOUND';
  } catch {
    elements.connection.className = 'connection-indicator is-offline';
    elements.connection.lastElementChild.textContent = 'SERVER OFFLINE';
    elements.providerNote.textContent = 'The app server is not responding. Chat and web search require a connection to this server.';
    elements.modelValue.textContent = 'Unavailable';
    elements.leftAiStatus.textContent = 'UNAVAILABLE';
    elements.presenceAiStatus.textContent = 'AI UNAVAILABLE';
    elements.leftAiDetail.textContent = 'The J.A.R.V.I.S. server did not respond.';
    elements.leftSessionStatus.textContent = 'OFFLINE';
    elements.backendConnectionValue.textContent = 'Unavailable';
  }
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return 'Unavailable';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function updateMetricGauge(track, meter, value) {
  const available = Number.isFinite(value) && value >= 0 && value <= 100;
  track.hidden = !available;
  if (available) meter.style.width = `${value}%`;
}

function updateDeviceMonitor() {
  const profile = detectDeviceProfile(navigator);
  elements.deviceTypeValue.textContent = profile.deviceType;
  elements.platformValue.textContent = `${profile.browser} · ${profile.platform}`;
  document.querySelectorAll('[data-device-group="mobile"]').forEach((item) => {
    item.hidden = !profile.isMobile;
  });
  document.querySelectorAll('[data-device-group="desktop"]').forEach((item) => {
    item.hidden = profile.isMobile;
  });
  elements.cpuLabel.textContent = 'SERVER CPU';
  elements.ramLabel.textContent = 'SERVER RAM';
  elements.diskLabel.textContent = 'SERVER STORAGE';

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const networkParts = [navigator.onLine ? 'Online' : 'Offline'];
  if (navigator.onLine && connection?.effectiveType) networkParts.push(connection.effectiveType);
  elements.networkValue.textContent = networkParts.join(' · ');

  renderMicrophoneStatus();
  elements.voiceOutputValue.textContent = 'speechSynthesis' in window
    ? state.assistantMode === 'speaking' ? 'Speaking' : state.preferences.voiceEnabled ? 'Ready' : 'Off'
    : 'Not available';

  const memory = performance.memory;
  elements.browserMemoryValue.textContent = memory
    && Number.isFinite(memory.usedJSHeapSize)
    && Number.isFinite(memory.jsHeapSizeLimit)
    ? `${formatBytes(memory.usedJSHeapSize)} / ${formatBytes(memory.jsHeapSizeLimit)} JS heap`
    : 'Not available';
  return profile;
}

function renderMicrophoneStatus() {
  const recognitionSupported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  const text = !recognitionSupported
    ? 'Not available'
    : state.assistantMode === 'listening' ? 'Listening'
      : state.microphonePermission === 'granted' ? 'Ready'
        : state.microphonePermission === 'denied' ? 'Permission denied'
          : state.microphonePermission === 'prompt' ? 'Permission required'
            : 'Permission status unavailable';
  elements.voiceValue.textContent = text;
}

async function updateMicrophonePermission(permissionStatus) {
  if (!elements.voiceValue) return;
  const recognitionSupported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!recognitionSupported) {
    elements.voiceValue.textContent = 'Not available';
    return;
  }
  if (!navigator.permissions?.query && !permissionStatus) {
    elements.voiceValue.textContent = 'Permission status unavailable';
    return;
  }
  try {
    const status = permissionStatus || await navigator.permissions.query({ name: 'microphone' });
    state.microphonePermission = status.state;
    renderMicrophoneStatus();
    if (!permissionStatus) status.addEventListener('change', () => updateMicrophonePermission(status));
  } catch {
    state.microphonePermission = 'unknown';
    renderMicrophoneStatus();
  }
}

async function updateBatteryStatus() {
  if (!elements.batteryValue || typeof navigator.getBattery !== 'function') {
    if (elements.batteryValue) elements.batteryValue.textContent = 'Not available';
    return;
  }
  try {
    const battery = await navigator.getBattery();
    const renderBattery = () => {
      const percent = Number.isFinite(battery.level) ? `${Math.round(battery.level * 100)}%` : 'Level unavailable';
      elements.batteryValue.textContent = `${percent} · ${battery.charging ? 'Charging' : 'On battery'}`;
    };
    renderBattery();
    battery.addEventListener('levelchange', renderBattery);
    battery.addEventListener('chargingchange', renderBattery);
  } catch {
    elements.batteryValue.textContent = 'Not available';
  }
}

async function loadSystemMetrics() {
  const profile = detectDeviceProfile(navigator);
  if (profile.isMobile) {
    elements.cpuValue.textContent = 'Not available on this device';
    elements.ramValue.textContent = 'Not available on this device';
    elements.diskValue.textContent = 'Not available on this device';
    updateMetricGauge(elements.cpuMeterTrack, elements.cpuMeter, null);
    updateMetricGauge(elements.ramMeterTrack, elements.ramMeter, null);
    updateMetricGauge(elements.diskMeterTrack, elements.diskMeter, null);
    elements.monitorContext.textContent = 'Mobile browsers do not expose system CPU, RAM, or storage. Browser-only information is shown instead.';
    return;
  }
  try {
    const response = await fetch('/api/system', { headers: apiHeaders(), signal: AbortSignal.timeout(4_000) });
    const metrics = await readApiResponse(response);
    elements.cpuValue.textContent = metrics.cpuUsagePercent === null
      ? 'Sampling…'
      : `${metrics.cpuUsagePercent}% / ${metrics.cpuCount} cores`;
    elements.ramValue.textContent = `${formatBytes(metrics.memoryUsedBytes)} / ${formatBytes(metrics.memoryTotalBytes)} (${metrics.memoryPercent}%)`;
    elements.diskValue.textContent = `${formatBytes(metrics.diskUsedBytes)} / ${formatBytes(metrics.diskTotalBytes)} (${metrics.diskPercent}%)`;
    updateMetricGauge(elements.cpuMeterTrack, elements.cpuMeter, metrics.cpuUsagePercent);
    updateMetricGauge(elements.ramMeterTrack, elements.ramMeter, metrics.memoryPercent);
    updateMetricGauge(elements.diskMeterTrack, elements.diskMeter, metrics.diskPercent);
    elements.monitorContext.textContent = `Server/container measurements · ${metrics.source} · ${new Date(metrics.measuredAt).toLocaleTimeString()}`;
  } catch {
    elements.cpuValue.textContent = 'Unavailable';
    elements.ramValue.textContent = 'Unavailable';
    elements.diskValue.textContent = 'Unavailable';
    updateMetricGauge(elements.cpuMeterTrack, elements.cpuMeter, null);
    updateMetricGauge(elements.ramMeterTrack, elements.ramMeter, null);
    updateMetricGauge(elements.diskMeterTrack, elements.diskMeter, null);
    elements.monitorContext.textContent = 'Server measurements unavailable. They describe the app host/container, not this device.';
  }
}

function initializeDeviceMonitor() {
  const profile = updateDeviceMonitor();
  updateMicrophonePermission();
  if (profile.isMobile) updateBatteryStatus();

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  connection?.addEventListener?.('change', updateDeviceMonitor);
}

function openSettings() {
  if (!elements.settings.open) elements.settings.showModal();
}

function updateAIProviderFields() {
  const usesApiKey = elements.aiProvider.value === 'openai-compatible';
  elements.aiKeyField.hidden = !usesApiKey;
  elements.aiBaseUrlField.hidden = !usesApiKey;
  elements.aiBaseUrl.required = usesApiKey;
  elements.aiApiKey.required = usesApiKey;
  elements.aiProviderHelp.textContent = usesApiKey
    ? 'Use Google Gemini’s OpenAI-compatible chat completions API or another compatible provider. The key is sent to this server, held only in server memory, and never returned to this page or saved in this browser. Use a trusted server over HTTPS.'
    : 'Ollama must be running on the Node server host. J.A.R.V.I.S. uses OLLAMA_BASE_URL or http://127.0.0.1:11434; the selected model must already be installed.';
}

async function saveAISettings(provider = elements.aiProvider.value) {
  const apiKey = provider === 'openai-compatible' ? elements.aiApiKey.value : '';
  elements.aiApiKey.value = '';
  elements.aiSettingsSave.disabled = true;
  elements.aiSettingsEnvironment.disabled = true;
  elements.aiSetupStatus.textContent = 'Saving provider settings…';
  try {
    const response = await fetch('/api/settings/ai', {
      method: 'POST',
      headers: apiHeaders(true),
      body: JSON.stringify(provider === 'environment'
        ? { provider }
        : {
          provider,
          model: elements.aiModel.value.trim(),
          baseUrl: provider === 'openai-compatible' ? elements.aiBaseUrl.value.trim() : undefined,
          apiKey,
        }),
      signal: AbortSignal.timeout(8_000),
    });
    const data = await readApiResponse(response);
    state.aiSettingsLoaded = true;
    if (data.configured) {
      elements.aiProvider.value = data.provider;
      elements.aiModel.value = data.model;
      if (data.baseUrl) elements.aiBaseUrl.value = data.baseUrl;
      updateAIProviderFields();
      elements.aiSetupStatus.textContent = `Saved for this server session: ${data.provider === 'ollama' ? 'Ollama' : 'OpenAI-compatible'} · ${data.model}.`;
    } else {
      elements.aiSetupStatus.textContent = 'No server-side AI provider is configured. Enter a provider key here or set AI_API_KEY on the server.';
    }
    await checkServer();
  } catch (error) {
    elements.aiSetupStatus.textContent = getRequestErrorMessage(error, 'provider settings request');
  } finally {
    elements.aiSettingsSave.disabled = false;
    elements.aiSettingsEnvironment.disabled = false;
  }
}

function selectNavigation(destination) {
  document.querySelectorAll('[data-nav]').forEach((item) => item.classList.toggle('is-current', item.dataset.nav === destination));
}

function setWorkspaceView(view, { remember = true } = {}) {
  state.workspaceView = view;
  switchWorkspaceView(view, {
    dashboard: elements.dashboardLayout,
    conversation: elements.conversationView,
    body: document.body,
    navigationItems: document.querySelectorAll('[data-nav]'),
  });
  document.querySelector('#new-interface-button').setAttribute('aria-pressed', String(view === 'dashboard'));
  document.querySelector('#old-interface-button').setAttribute('aria-pressed', String(view === 'chat'));
  if (remember) {
    try {
      saveWorkspaceView(view, localStorage);
    } catch {
      showFeedback('Your interface choice could not be saved in this browser.');
    }
  }
}

function showHistory() {
  elements.historyList.replaceChildren();
  elements.historyCount.textContent = state.preferences.memoryEnabled
    ? `${state.messages.length} messages saved on this device.`
    : 'Conversation history saving is turned off.';
  if (!state.messages.length) {
    const empty = document.createElement('p');
    empty.className = 'settings-disclaimer';
    empty.textContent = 'No saved conversation messages.';
    elements.historyList.append(empty);
  }
  for (const [index, message] of state.messages.entries()) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'history-entry';
    const role = document.createElement('strong');
    role.textContent = message.role === 'user' ? 'YOU' : 'J.A.R.V.I.S.';
    const text = document.createElement('span');
    text.textContent = message.content.slice(0, 240) || 'Retrieved web results';
    const number = document.createElement('small');
    number.textContent = String(index + 1).padStart(2, '0');
    row.append(number, role, text);
    row.addEventListener('click', () => {
      setWorkspaceView('chat');
      elements.historyDialog.close();
    });
    elements.historyList.append(row);
  }
  elements.historyDialog.showModal();
}

function searchAttachedFiles() {
  const query = elements.fileSearchQuery.value.trim().toLocaleLowerCase();
  elements.fileSearchResults.replaceChildren();
  const attachedFiles = state.messages.flatMap((message, index) => {
    if (message.role !== 'user') return [];
    const match = message.content.match(/^\[Attached file: ([^\]]+)\]\n([\s\S]*)$/m);
    return match ? [{ name: match[1], content: match[2], index }] : [];
  });
  const matches = attachedFiles.filter((file) => !query || `${file.name}\n${file.content}`.toLocaleLowerCase().includes(query));
  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'settings-disclaimer';
    empty.textContent = attachedFiles.length ? 'No attached files match this search.' : 'No attached text files found in saved history.';
    elements.fileSearchResults.append(empty);
    return;
  }
  for (const file of matches) {
    const result = document.createElement('article');
    result.className = 'file-search-result';
    const title = document.createElement('strong');
    title.textContent = `${file.name} · message ${file.index + 1}`;
    const preview = document.createElement('p');
    const excerptIndex = query ? file.content.toLocaleLowerCase().indexOf(query) : 0;
    const start = Math.max(0, excerptIndex - 70);
    preview.textContent = file.content.slice(start, start + 220);
    result.append(title, preview);
    elements.fileSearchResults.append(result);
  }
}

function toggleStudyMode() {
  state.preferences.studyMode = !state.preferences.studyMode;
  elements.studyIndicator.textContent = state.preferences.studyMode ? 'ON' : 'OFF';
  elements.studyQuickIndicator.textContent = state.preferences.studyMode ? 'ON' : 'OFF';
  elements.leftModeStatus.textContent = state.preferences.studyMode ? 'STUDY' : 'STANDARD';
  savePreferences();
  logActivity(state.preferences.studyMode ? 'Study Mode enabled' : 'Study Mode disabled');
  setWorkspaceView('chat');
  elements.message.placeholder = state.preferences.studyMode ? 'Ask a question to learn step by step...' : 'Ask J.A.R.V.I.S. anything...';
  elements.dashboardMessage.placeholder = state.preferences.studyMode ? 'Ask a study question...' : 'Ask J.A.R.V.I.S.';
  elements.message.focus();
}

function updateFocusTimerDisplay() {
  const minutes = Math.floor(state.focusRemaining / 60);
  const seconds = state.focusRemaining % 60;
  elements.focusTimerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function toggleFocusTimer() {
  if (state.focusTimerId) {
    window.clearInterval(state.focusTimerId);
    state.focusTimerId = null;
    elements.focusTimerButton.textContent = 'Resume';
    elements.focusTimerButton.setAttribute('aria-pressed', 'false');
    return;
  }
  elements.focusTimerButton.textContent = 'Pause';
  elements.focusTimerButton.setAttribute('aria-pressed', 'true');
  logActivity('Focus timer started');
  state.focusTimerId = window.setInterval(() => {
    state.focusRemaining -= 1;
    updateFocusTimerDisplay();
    if (state.focusRemaining <= 0) {
      window.clearInterval(state.focusTimerId);
      state.focusTimerId = null;
      state.focusRemaining = 25 * 60;
      updateFocusTimerDisplay();
      elements.focusTimerButton.textContent = 'Start';
      elements.focusTimerButton.setAttribute('aria-pressed', 'false');
      showFeedback('Focus session complete.');
      logActivity('Focus session complete');
    }
  }, 1000);
}

async function startScreenCapture() {
  if (state.audioLipSyncStream || state.audioLipSyncStarting) {
    elements.captureStatus.textContent = 'Stop audio lip-sync before starting screen capture.';
    return;
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    elements.captureStatus.textContent = 'Screen capture is not supported in this browser.';
    return;
  }
  elements.captureStatus.textContent = 'Choose a screen or window in the browser permission picker.';
  try {
    state.displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    elements.capturePreview.srcObject = state.displayStream;
    elements.capturePreview.hidden = false;
    elements.captureFrameButton.disabled = false;
    elements.stopCaptureButton.disabled = false;
    elements.captureStatus.textContent = 'Screen sharing is active only while the browser indicator is visible.';
    state.displayStream.getVideoTracks()[0]?.addEventListener('ended', stopScreenCapture, { once: true });
    logActivity('Screen sharing approved by user');
  } catch (error) {
    elements.captureStatus.textContent = error.name === 'NotAllowedError'
      ? 'Screen capture was cancelled or denied.'
      : `Screen capture unavailable: ${error.message}`;
  }
}

function stopScreenCapture() {
  state.displayStream?.getTracks().forEach((track) => track.stop());
  state.displayStream = null;
  elements.capturePreview.srcObject = null;
  elements.capturePreview.hidden = true;
  elements.captureFrameButton.disabled = true;
  elements.stopCaptureButton.disabled = true;
  elements.captureStatus.textContent = 'Screen sharing stopped.';
}

function openWebsiteApplication() {
  let destination;
  try {
    destination = new URL(elements.applicationUrl.value.trim());
  } catch {
    elements.applicationUrl.setCustomValidity('Enter a valid HTTPS website address.');
    elements.applicationUrl.reportValidity();
    return;
  }
  elements.applicationUrl.setCustomValidity('');
  if (destination.protocol !== 'https:') {
    elements.applicationUrl.setCustomValidity('Only HTTPS websites can be opened from this launcher.');
    elements.applicationUrl.reportValidity();
    return;
  }
  const opened = window.open(destination.href, '_blank');
  if (!opened) {
    showFeedback('The browser blocked the new tab. Allow pop-ups for J.A.R.V.I.S. and try again.');
    return;
  }
  opened.opener = null;
  elements.applicationDialog.close();
  logActivity(`Opened website: ${destination.hostname}`);
}

function captureScreenFrame() {
  const video = elements.capturePreview;
  if (!state.displayStream || !video.videoWidth || !video.videoHeight) {
    elements.captureStatus.textContent = 'No active screen stream is available.';
    return;
  }
  const canvas = elements.captureCanvas;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  canvas.toBlob((blob) => {
    if (!blob) {
      elements.captureStatus.textContent = 'The browser could not encode this screen frame.';
      return;
    }
    if (state.captureObjectUrl) URL.revokeObjectURL(state.captureObjectUrl);
    state.captureObjectUrl = URL.createObjectURL(blob);
    elements.downloadCapture.href = state.captureObjectUrl;
    elements.downloadCapture.hidden = false;
    elements.captureStatus.textContent = 'Frame captured locally. Use Download capture to save it.';
    logActivity('Screen frame captured locally');
  }, 'image/png');
}

function handleNavigation(event) {
  const button = event.target.closest('[data-nav]');
  if (!button) return;
  if (event.currentTarget === elements.moreNavigationDialog && elements.moreNavigationDialog.open) {
    elements.moreNavigationDialog.close();
  }
  const destination = button.dataset.nav;
  if (destination === 'dashboard') {
    setWorkspaceView('dashboard');
  } else if (destination === 'chat') {
    if (state.workspaceView === 'dashboard') {
      elements.dashboardMessage.focus();
      elements.dashboardChatPanel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      setWorkspaceView('chat');
      elements.message.focus();
    }
  } else if (destination === 'voice') {
    if (state.workspaceView !== 'dashboard') setWorkspaceView('chat');
    startListening();
  } else if (destination === 'more') {
    elements.moreNavigationDialog.showModal();
  } else if (destination === 'history') {
    showHistory();
  } else if (destination === 'memory') {
    selectNavigation('memory');
    showHistory();
  } else if (destination === 'files') {
    elements.fileSearchQuery.value = '';
    searchAttachedFiles();
    elements.fileSearchDialog.showModal();
  } else if (destination === 'applications') {
    elements.applicationDialog.showModal();
  } else if (destination === 'study') {
    toggleStudyMode();
  } else if (destination === 'productivity') {
    setWorkspaceView('dashboard');
    document.querySelector('.focus-timer-row').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    elements.focusTimerButton.focus();
  } else if (destination === 'system') {
    setWorkspaceView('dashboard');
    if (matchMedia('(max-width: 780px)').matches) document.body.classList.add('mobile-system-open');
    document.querySelector('#system-title').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else if (destination === 'news') {
    setWorkspaceView('dashboard');
    if (matchMedia('(max-width: 780px)').matches) document.body.classList.add('mobile-news-open');
    if (!elements.briefingResults.childElementCount) loadBriefing();
    document.querySelector('#briefing-title').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else if (destination === 'memory' || destination === 'settings') {
    selectNavigation(destination);
    openSettings();
  } else if (destination === 'activity') {
    setWorkspaceView('dashboard');
    selectNavigation(destination);
    if (matchMedia('(max-width: 780px)').matches) document.body.classList.add('mobile-activity-open');
    document.querySelector('#activity-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function handleDashboardFeature(event) {
  const button = event.target.closest('[data-dashboard-feature], [data-avatar-feature]');
  if (!button) return;
  const destination = button.dataset.dashboardFeature || button.dataset.avatarFeature;
  if (destination === 'chat') {
    elements.dashboardMessage.focus();
    document.querySelector('#dashboard-chat-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (destination === 'voice') {
    startListening();
  } else if (destination === 'files') {
    elements.fileSearchQuery.value = '';
    searchAttachedFiles();
    elements.fileSearchDialog.showModal();
  } else if (destination === 'browser') {
    elements.applicationDialog.showModal();
  } else if (destination === 'system') {
    document.querySelector('#system-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (destination === 'settings') {
    openSettings();
  } else if (destination === 'more') {
    elements.moreNavigationDialog.showModal();
  }
}

async function loadBriefing() {
  elements.briefingButton.disabled = true;
  elements.briefingResults.replaceChildren();
  const status = document.createElement('p');
  status.textContent = 'Searching available web sources...';
  elements.briefingResults.append(status);
  try {
    const query = state.preferences.language === 'hi' ? 'प्रौद्योगिकी समाचार' : 'latest technology news';
    const params = new URLSearchParams({ q: query, lang: state.preferences.language });
    const response = await fetch(`/api/search?${params}`, {
      headers: apiHeaders(),
      signal: AbortSignal.timeout(18_000),
    });
    const data = await readApiResponse(response);
    elements.briefingResults.replaceChildren();
    if (!data.results.length) {
      const notice = document.createElement('p');
      notice.textContent = data.notice || 'No source-backed headlines were returned.';
      elements.briefingResults.append(notice);
    }
    for (const result of data.results.slice(0, 3)) {
      const link = document.createElement('a');
      link.href = result.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = result.title;
      elements.briefingResults.append(link);
      const snippet = document.createElement('p');
      snippet.textContent = result.snippet;
      elements.briefingResults.append(snippet);
    }
    logActivity(`Briefing retrieved: ${data.results.length} source${data.results.length === 1 ? '' : 's'}`);
  } catch (error) {
    elements.briefingResults.replaceChildren();
    const notice = document.createElement('p');
    notice.textContent = error.message;
    elements.briefingResults.append(notice);
    logActivity('Briefing unavailable');
  } finally {
    elements.briefingButton.disabled = false;
  }
}

function updateClock() {
  document.querySelector('#clock').textContent = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date());
}

document.querySelector('#settings-button').addEventListener('click', () => elements.settings.showModal());
elements.dashboardSettingsButton.addEventListener('click', () => elements.settings.showModal());
const publicShareUrl = getPublicShareUrl(window.location);
if (publicShareUrl) {
  elements.shareStatus.textContent = 'HTTPS link ready. Confirm your host marks it Public before sharing; J.A.R.V.I.S. cannot verify access from other networks.';
} else {
  elements.shareStatus.textContent = 'This address is local or not secure, so it cannot be shared. In a Codespace, run npm run codespaces, set port 4173 visibility to Public in the Ports tab, then reopen JARVIS using its HTTPS forwarded URL.';
  elements.shareLinkButton.disabled = true;
  elements.copyLinkButton.disabled = true;
}

async function copyPublicLink() {
  if (!publicShareUrl) return;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(publicShareUrl);
      elements.shareStatus.textContent = 'Public JARVIS link copied. No keys or private settings were included.';
      return;
    } catch {
      // Try the browser's legacy clipboard API below.
    }
  }
  const input = document.createElement('textarea');
  input.value = publicShareUrl;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('Clipboard access was denied. Copy the HTTPS address from the browser address bar instead.');
  elements.shareStatus.textContent = 'Public JARVIS link copied. No keys or private settings were included.';
}

elements.copyLinkButton.addEventListener('click', () => {
  copyPublicLink().catch((error) => {
    elements.shareStatus.textContent = error.message;
  });
});
elements.shareLinkButton.addEventListener('click', async () => {
  if (!publicShareUrl) return;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'J.A.R.V.I.S.', text: 'Open J.A.R.V.I.S.', url: publicShareUrl });
      elements.shareStatus.textContent = 'J.A.R.V.I.S. link shared.';
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
      elements.shareStatus.textContent = `Sharing failed: ${error.message}`;
      return;
    }
  }
  try {
    await copyPublicLink();
  } catch (error) {
    elements.shareStatus.textContent = error.message;
  }
});
document.querySelector('#new-interface-button').addEventListener('click', () => setWorkspaceView('dashboard'));
document.querySelector('#old-interface-button').addEventListener('click', () => setWorkspaceView('chat'));
document.querySelector('#more-tools-button').addEventListener('click', () => {
  elements.settings.close();
  elements.moreNavigationDialog.showModal();
});
document.querySelectorAll('.primary-nav, .mobile-nav, .feature-toolbar, .right-rail').forEach((nav) => nav.addEventListener('click', handleNavigation));
document.querySelector('.new-feature-bar').addEventListener('click', handleDashboardFeature);
document.querySelector('.avatar-shortcuts-left').addEventListener('click', handleDashboardFeature);
document.querySelector('.avatar-shortcuts-right').addEventListener('click', handleDashboardFeature);
elements.moreNavigationDialog.addEventListener('click', handleNavigation);
document.querySelector('#clear-button').addEventListener('click', () => {
  state.messages = [];
  renderMessages();
  try { localStorage.removeItem(HISTORY_KEY); } catch { showFeedback('Saved history could not be cleared in this browser.'); }
});
document.querySelector('#settings-clear').addEventListener('click', () => {
  if (!window.confirm('Clear saved conversation history and preferences from this browser?')) return;
  state.messages = [];
  state.accessToken = '';
  elements.accessToken.value = '';
  renderMessages();
  let storageCleared = true;
  try {
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(PREFERENCES_KEY);
  } catch {
    storageCleared = false;
  }
  state.preferences = { ...defaults };
  syncSettings();
  showFeedback(storageCleared
    ? 'Saved data cleared from this browser.'
    : 'Active settings were reset, but the browser could not confirm that all saved data was cleared.');
});
elements.dashboardCommandForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = elements.dashboardMessage.value.trim();
  if (!text) return;
  elements.message.value = text;
  elements.dashboardMessage.value = '';
  elements.form.requestSubmit();
});
elements.dashboardRetryButton.addEventListener('click', retryLastChat);
elements.dashboardMessage.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    elements.dashboardCommandForm.requestSubmit();
  }
});
elements.fileSearchQuery.addEventListener('input', searchAttachedFiles);
document.querySelector('#history-open-chat').addEventListener('click', () => {
  elements.historyDialog.close();
  setWorkspaceView('chat');
  elements.message.focus();
});
document.querySelector('#open-application-button').addEventListener('click', openWebsiteApplication);
elements.applicationUrl.addEventListener('input', () => elements.applicationUrl.setCustomValidity(''));
document.querySelector('[data-quick-action="capture"]').addEventListener('click', () => {
  if (!state.preferences.fullAccessEnabled) return;
  elements.captureStatus.textContent = '';
  elements.downloadCapture.hidden = true;
  elements.screenCaptureDialog.showModal();
  startScreenCapture();
});
elements.captureFrameButton.addEventListener('click', captureScreenFrame);
elements.stopCaptureButton.addEventListener('click', stopScreenCapture);
elements.screenCaptureDialog.addEventListener('close', () => {
  if (state.displayStream) stopScreenCapture();
});
elements.focusTimerButton.addEventListener('click', toggleFocusTimer);
document.querySelector('[data-quick-action="files"]').addEventListener('click', () => {
  elements.fileSearchQuery.value = '';
  searchAttachedFiles();
  elements.fileSearchDialog.showModal();
});
document.querySelector('[data-quick-action="applications"]').addEventListener('click', () => elements.applicationDialog.showModal());
elements.form.addEventListener('submit', submitMessage);
elements.message.addEventListener('input', () => {
  elements.message.style.height = 'auto';
  elements.message.style.height = `${Math.min(elements.message.scrollHeight, 140)}px`;
});
elements.message.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    elements.form.requestSubmit();
  }
});
elements.searchToggle.addEventListener('click', () => {
  state.searchMode = !state.searchMode;
  updateSearchMode();
  elements.message.focus();
});
elements.mic.addEventListener('click', startListening);
elements.attachButton.addEventListener('click', () => elements.fileInput.click());
elements.dashboardAttachButton.addEventListener('click', () => elements.fileInput.click());
elements.fileInput.addEventListener('change', async () => {
  const file = elements.fileInput.files?.[0];
  if (!file) return;
  if (file.size > 16_000) {
    showFeedback('Text attachments are limited to 16 KB.');
    elements.dashboardFileStatus.textContent = 'File exceeds the 16 KB limit';
    elements.fileInput.value = '';
    return;
  }
  try {
    const content = await file.text();
    if (!content.trim() || content.length > 2_500) throw new Error('Choose a non-empty text file with at most 2,500 characters.');
    state.pendingAttachment = { name: file.name.slice(0, 100), content };
    elements.attachmentNote.textContent = `${file.name} ready. Its text will be included with your next message.`;
    elements.attachmentNote.hidden = false;
    elements.dashboardFileStatus.textContent = `${file.name} ready to attach`;
    logActivity('Text attachment prepared');
    showFeedback('');
  } catch (error) {
    state.pendingAttachment = null;
    elements.dashboardFileStatus.textContent = 'No file selected';
    elements.fileInput.value = '';
    showFeedback(error.message || 'This file could not be read as text.');
  }
});
elements.fullAccess.addEventListener('change', () => {
  state.preferences.fullAccessEnabled = elements.fullAccess.checked;
  syncFullAccess();
  savePreferences();
  logActivity(state.preferences.fullAccessEnabled ? 'In-app quick actions enabled' : 'In-app quick actions disabled');
});
elements.fullAccessMobile.addEventListener('change', () => {
  elements.fullAccess.checked = elements.fullAccessMobile.checked;
  elements.fullAccess.dispatchEvent(new Event('change', { bubbles: true }));
});
elements.briefingButton.addEventListener('click', loadBriefing);
document.querySelectorAll('[data-quick-action]').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.quickAction === 'chat') {
    setWorkspaceView('chat');
    elements.message.focus();
    return;
  }
  if (button.dataset.quickAction === 'study') {
    toggleStudyMode();
    return;
  }
  if (!state.preferences.fullAccessEnabled) return;
  if (button.dataset.quickAction === 'voice') {
    startListening();
  }
  if (button.dataset.quickAction === 'search') {
    setWorkspaceView('chat');
    state.searchMode = true;
    updateSearchMode();
    elements.message.focus();
    document.querySelector('.conversation').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}));
elements.language.addEventListener('change', () => {
  state.preferences.language = elements.language.value;
  elements.leftLanguageStatus.textContent = state.preferences.language === 'hi' ? 'HINDI' : 'ENGLISH';
  savePreferences();
});
elements.accessToken.addEventListener('input', () => {
  state.accessToken = elements.accessToken.value.trim();
});
elements.aiProvider.addEventListener('change', () => {
  elements.aiModel.value = elements.aiProvider.value === 'ollama' ? 'qwen2.5:3b' : 'gemini-2.5-flash';
  elements.aiApiKey.value = '';
  updateAIProviderFields();
});
elements.aiSettingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  saveAISettings();
});
elements.aiSettingsEnvironment.addEventListener('click', () => saveAISettings('environment'));
elements.voice.addEventListener('change', () => {
  state.preferences.voiceURI = elements.voice.value;
  savePreferences();
});
elements.speechRate.addEventListener('input', () => {
  state.preferences.speechRate = Number(elements.speechRate.value);
  elements.speechRateValue.textContent = state.preferences.speechRate.toFixed(1);
  savePreferences();
});
elements.voiceEnabled.addEventListener('change', () => {
  state.preferences.voiceEnabled = elements.voiceEnabled.checked;
  elements.dashboardVoiceToggle.setAttribute('aria-pressed', String(state.preferences.voiceEnabled));
  elements.dashboardVoiceLabel.textContent = state.preferences.voiceEnabled ? 'Voice on' : 'Voice off';
  if (!state.preferences.voiceEnabled && 'speechSynthesis' in window) stopSpeechOutput();
  savePreferences();
});
elements.dashboardMicButton.addEventListener('click', () => {
  startListening();
});
elements.dashboardVoiceToggle.addEventListener('click', () => {
  elements.voiceEnabled.checked = !elements.voiceEnabled.checked;
  elements.voiceEnabled.dispatchEvent(new Event('change', { bubbles: true }));
});
elements.memoryEnabled.addEventListener('change', () => {
  state.preferences.memoryEnabled = elements.memoryEnabled.checked;
  elements.leftMemoryStatus.textContent = state.preferences.memoryEnabled ? 'LOCAL' : 'OFF';
  if (!state.preferences.memoryEnabled) {
    try { localStorage.removeItem(HISTORY_KEY); } catch { showFeedback('Saved history could not be removed.'); }
  } else {
    saveHistory();
  }
  savePreferences();
});
document.querySelector('#preview-voice').addEventListener('click', () => {
  if (!('speechSynthesis' in window)) {
    showFeedback('Speech output is not supported by this browser.');
    return;
  }
  speak(state.preferences.language === 'hi' ? 'नमस्ते, मैं आपकी सहायता के लिए तैयार हूँ।' : 'Hello. I am ready to assist you.');
});
window.addEventListener('online', checkServer);
window.addEventListener('offline', checkServer);
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  state.installPrompt = event;
  updateInstallButton();
});
window.addEventListener('appinstalled', () => {
  state.installPrompt = null;
  elements.install.hidden = true;
});

function isInstalledApp() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function updateInstallButton() {
  elements.install.hidden = isInstalledApp() || new URLSearchParams(location.search).has('desktop-app');
}

function showInstallInstructions() {
  const userAgent = navigator.userAgent;
  if (/android/i.test(userAgent)) {
    elements.installInstructions.textContent = 'In Chrome on Android, open the browser menu (three dots) and choose Install app or Add to Home screen, then confirm.';
  } else if (/windows/i.test(userAgent) && /edg\//i.test(userAgent)) {
    elements.installInstructions.textContent = 'In Microsoft Edge on Windows, select the Apps icon in the address bar, or open Settings and more > Apps > Install this site as an app.';
  } else if (/windows/i.test(userAgent)) {
    elements.installInstructions.textContent = 'In Chrome on Windows, select the install icon in the address bar, or open the menu > Cast, save, and share > Install page as app.';
  } else if (/iphone|ipad|ipod/i.test(userAgent)) {
    elements.installInstructions.textContent = 'In Safari, tap Share, choose Add to Home Screen, then confirm.';
  } else {
    elements.installInstructions.textContent = 'Use your browser menu or address-bar install icon and choose Install J.A.R.V.I.S. or Install this site as an app.';
  }
  if (!elements.installHelp.open) elements.installHelp.showModal();
}

elements.install.addEventListener('click', async () => {
  if (isInstalledApp()) {
    updateInstallButton();
    return;
  }
  if (!state.installPrompt) {
    showInstallInstructions();
    return;
  }
  try {
    const prompt = state.installPrompt;
    state.installPrompt = null;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') elements.install.hidden = true;
    else showInstallInstructions();
  } catch {
    showInstallInstructions();
  }
});

state.messages = loadHistory();
syncSettings();
renderMessages();
updateSearchMode();
setWorkspaceView(state.workspaceView, { remember: false });
initializeDeviceMonitor();
updateClock();
window.setInterval(updateClock, 30_000);
window.setInterval(loadSystemMetrics, 30_000);
checkServer();
logActivity('Interface initialized');
updateInstallButton();

if ('speechSynthesis' in window) window.speechSynthesis.addEventListener('voiceschanged', updateVoiceList);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('/service-worker.js?hud=26', { updateViaCache: 'none' }).then((registration) => {
    registration.update().catch(() => {});
  }).catch(() => {});
}

window.dispatchEvent(new Event('jarvis:app-ready'));