import { readWorkspaceView, saveWorkspaceView, switchWorkspaceView } from './interface-switcher.js';
import { detectDeviceProfile } from './device-monitor.js';
import { getPublicShareUrl } from './share-link.js';
import { initializeAppHubs } from './app-hub.js';
import { createSearchSummaryPrompt } from './search-summary.js';
import { readApiResponse, readChatReply } from './api-response.js';
import {
  createMicrophonePermissionGuard,
  createRecognitionLifecycle,
  createSpeechReplayController,
  createWakeWordRecoveryPolicy,
  getWakeWordListeningBlockReason,
  getSpeechRecognitionErrorMessage,
  getSpeechRecognitionConstructor,
  getSpeechRecognitionLanguage,
  getSpeechRecognitionStartError,
  isFatalSpeechRecognitionError,
  getSpeechSynthesisErrorMessage,
  isPageForeground,
  matchWakeWord,
  monitorSpeechSynthesisStart,
  nextWakeWordRestartDelay,
  primeSpeechSynthesis,
  readSpeechRecognitionAlternatives,
  readSpeechRecognitionResult,
  readWakeWordCommand,
  resolveVoiceOutputEnabled,
  selectSpeechSynthesisVoice,
  shouldPlaySpeech,
  shouldRunWakeWord,
  WAKE_WORD_MAX_RESTART_ATTEMPTS,
} from './speech-input.js';
import { selectRecentChatContext } from './chat-context.js';
import {
  DEFAULT_LAB_PREFERENCES,
  LAB_PREFERENCES_KEY,
  LAB_ACCENTS,
  applyLabPreferences,
  loadLabPreferences,
  resetLabPreferencesDraft,
  saveLabPreferences,
} from './lab-personalize.js';
import {
  LAB_AI_MODIFY_HISTORY_KEY,
  getLabAiModifyRequestStatus,
  loadLabAiModifyHistory,
  recordLabAiModifyHistory,
} from './lab-ai-modify.js';
import {
  CODE_STUDIO_LANGUAGES,
  createCodeExport,
  reviewCodeLocally,
  validateCodeFile,
} from './lab-code-studio.js';
import {
  EXTENSION_PACKAGE_MAX_BYTES,
  addPendingExtension,
  getExtensionPackageFileStatus,
  loadLabExtensions,
  recordLabExtensionExport,
  recordLabExtensionRejection,
  removeLabExtension,
  serializeLabExtensionPackage,
  setLabExtensionState,
  validateExtensionPackageText,
} from './lab-extensions.js';
import {
  LAB_PROJECT_CHANGES_ENABLED,
  containsSensitiveText,
  redactSensitiveText,
} from './lab-safety.js';

const HISTORY_KEY = 'jarvis.history.v1';
const PREFERENCES_KEY = 'jarvis.preferences.v1';
const historyLimit = 80;
const maxVisionDimension = 1_280;
const maxVisionImageBytes = 500 * 1024;
const speechDiagnosticsEnabled = new URLSearchParams(location.search).get('diagnostics') === '1';
const defaults = {
  language: 'en',
  voiceURI: '',
  speechRate: 1,
  voiceEnabled: 'speechSynthesis' in window,
  wakeWordEnabled: false,
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
  dashboardLayout: document.querySelector('#dashboard-layout'),
  labLayout: document.querySelector('#jarvis-lab'),
  labModules: document.querySelector('.lab-module-grid'),
  labSafetyPanel: document.querySelector('#lab-safety-panel'),
  labSafetyChangeState: document.querySelector('#lab-safety-change-state'),
  personalizePanel: document.querySelector('#personalize-panel'),
  personalizeTitle: document.querySelector('#personalize-title'),
  personalizeForm: document.querySelector('#personalize-form'),
  personalizePreview: document.querySelector('#personalize-preview'),
  personalizePreviewNote: document.querySelector('#personalize-preview-note'),
  personalizePreviewVoice: document.querySelector('#personalize-preview-voice'),
  personalizeStatus: document.querySelector('#personalize-status'),
  labDensity: document.querySelector('#lab-density-select'),
  labVoice: document.querySelector('#lab-voice-select'),
  aiModifyPanel: document.querySelector('#ai-modify-panel'),
  aiModifyTitle: document.querySelector('#ai-modify-title'),
  aiModifyRequest: document.querySelector('#ai-modify-request'),
  aiModifyPlanStatus: document.querySelector('#ai-modify-plan-status'),
  aiModifyStatus: document.querySelector('#ai-modify-status'),
  aiModifyHistory: document.querySelector('#ai-modify-history'),
  codeStudioPanel: document.querySelector('#code-studio-panel'),
  codeStudioTitle: document.querySelector('#code-studio-title'),
  codeStudioEditor: document.querySelector('#code-studio-editor'),
  codeStudioLanguage: document.querySelector('#code-studio-language'),
  codeStudioReadonly: document.querySelector('#code-studio-readonly'),
  codeStudioFile: document.querySelector('#code-studio-file'),
  codeStudioStatus: document.querySelector('#code-studio-status'),
  codeStudioCount: document.querySelector('#code-studio-count'),
  codeStudioReviewSummary: document.querySelector('#code-studio-review-summary'),
  codeStudioFindings: document.querySelector('#code-studio-findings'),
  extensionsPanel: document.querySelector('#extensions-panel'),
  extensionsTitle: document.querySelector('#extensions-title'),
  extensionsFile: document.querySelector('#extensions-package-file'),
  extensionsStatus: document.querySelector('#extensions-status'),
  extensionsCount: document.querySelector('#extensions-count'),
  extensionsList: document.querySelector('#extensions-list'),
  extensionsHistory: document.querySelector('#extensions-history'),
  dashboardChatPanel: document.querySelector('.dashboard-chat-panel'),
  conversationView: document.querySelector('#conversation-view'),
  dashboardTranscript: document.querySelector('#dashboard-transcript'),
  dashboardFeedback: document.querySelector('#dashboard-feedback'),
  assistantState: document.querySelector('#assistant-state'),
  holoWaveform: document.querySelector('#holo-waveform'),
  holoStateAnnouncement: document.querySelector('#holo-state-announcement'),
  statePanelLive: document.querySelector('#state-panel-live'),
  holoStates: document.querySelectorAll('[data-holo-state]'),
  dashboardConnection: document.querySelector('#connection-status-dashboard'),
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
  wakeWordEnabled: document.querySelector('#wake-word-enabled'),
  wakeWordSupport: document.querySelector('#wake-word-support'),
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
  leftAiStatus: document.querySelector('#left-ai-status'),
  leftAiDetail: document.querySelector('#left-ai-detail'),
  leftSessionStatus: document.querySelector('#left-session-status'),
  leftMemoryStatus: document.querySelector('#left-memory-status'),
  voiceConsoleStatus: document.querySelector('#voice-console-status'),
  dashboardMicButton: document.querySelector('#dashboard-mic-button'),
  dashboardVoiceMicButton: document.querySelector('#dashboard-voice-mic-button'),
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
  briefingButton: document.querySelector('#news-button'),
  briefingResults: document.querySelector('#briefing-results'),
  fileSearchDialog: document.querySelector('#file-search-dialog'),
  fileSearchQuery: document.querySelector('#file-search-query'),
  fileSearchResults: document.querySelector('#file-search-results'),
  historyDialog: document.querySelector('#history-dialog'),
  historyCount: document.querySelector('#history-count'),
  historyList: document.querySelector('#history-list'),
  applicationDialog: document.querySelector('#application-dialog'),
  screenCaptureDialog: document.querySelector('#screen-capture-dialog'),
  capturePreview: document.querySelector('#capture-preview'),
  captureFramePreview: document.querySelector('#capture-frame-preview'),
  captureCanvas: document.querySelector('#capture-canvas'),
  captureFrameButton: document.querySelector('#capture-frame-button'),
  visionQuestion: document.querySelector('#vision-question'),
  visionSendButton: document.querySelector('#vision-send-button'),
  downloadCapture: document.querySelector('#download-capture'),
  stopCaptureButton: document.querySelector('#stop-capture-button'),
  captureStatus: document.querySelector('#capture-status'),
  moreNavigationDialog: document.querySelector('#more-navigation-dialog'),
  focusTimerDisplay: document.querySelector('#focus-timer-display'),
  focusTimerButton: document.querySelector('#focus-timer-button'),
};

function reportSpeechDiagnostic(event, details = {}) {
  if (!speechDiagnosticsEnabled) return;
  window.dispatchEvent(new CustomEvent('jarvis:speech-diagnostic', {
    detail: {
      event,
      timestamp: new Date().toISOString(),
      ...details,
    },
  }));
}

function reportTtsDiagnostic(event, details = {}) {
  const synthesis = window.speechSynthesis;
  reportSpeechDiagnostic(event, {
    speaking: Boolean(synthesis?.speaking),
    pending: Boolean(synthesis?.pending),
    paused: Boolean(synthesis?.paused),
    ...details,
  });
}

function reportWakeWordStatus(reason) {
  reportSpeechDiagnostic('Wake-word status', {
    enabled: state.preferences.wakeWordEnabled,
    language: getSpeechRecognitionLanguage(state.preferences.language),
    microphonePermission: state.microphonePermission,
    visibility: document.visibilityState,
    focused: pageIsFocused(),
    secureContext: window.isSecureContext === true,
    reason,
  });
}

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
    voiceEnabled: resolveVoiceOutputEnabled(stored.voiceEnabled, 'speechSynthesis' in window),
    wakeWordEnabled: stored.wakeWordEnabled === true,
    memoryEnabled: stored.memoryEnabled !== false,
    fullAccessEnabled: stored.fullAccessEnabled === true,
    studyMode: stored.studyMode === true,
  };
}

function loadWorkspaceView() {
  try {
    const defaultView = window.matchMedia?.('(max-width: 780px)').matches ? 'dashboard' : 'chat';
    return readWorkspaceView(localStorage, defaultView);
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
  recognitionPurpose: null,
  recognitionWakeSession: false,
  wakeWordTriggered: false,
  wakeWordResumePending: false,
  wakeWordManualRetryPending: false,
  wakeWordManualTakeoverPending: false,
  wakeWordPagePaused: false,
  wakeWordRestartTimer: null,
  wakeWordRestartDelay: 600,
  recognitionStartTimer: null,
  recognitionStartedAt: null,
  recognitionError: null,
  listening: false,
  pendingSpeechText: null,
  speechOutputTexts: new Set(),
  speechStartMonitorCancel: null,
  pendingSpeechOptions: null,
  installPrompt: null,
  accessRequired: false,
  accessToken: '',
  pendingAttachment: null,
  speechPlaybackId: 0,
  workspaceView: loadWorkspaceView(),
  displayStream: null,
  focusRemaining: 25 * 60,
  focusTimerId: null,
  captureObjectUrl: null,
  visionFrame: null,
  visionSending: false,
  visionAbortController: null,
  visionCaptureSequence: 0,
  assistantMode: 'normal',
  holoOnline: false,
  microphonePermission: 'unknown',
  lastChatFailure: null,
  aiSettingsLoaded: false,
  aiConfigured: false,
  labPreferences: loadLabPreferences(localStorage),
};

let personalizeDraft = null;
let codeStudioPreviewSource = null;

let healthRequestSequence = 0;
const recognitionLifecycle = createRecognitionLifecycle();
const speechReplayController = createSpeechReplayController(() => renderMessages());
const wakeWordRecoveryPolicy = createWakeWordRecoveryPolicy();
const microphonePermissionGuard = createMicrophonePermissionGuard();

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
  if (!enabled && elements.screenCaptureDialog.open) {
    state.visionCaptureSequence += 1;
    state.visionAbortController?.abort();
    elements.screenCaptureDialog.close();
  }
  window.dispatchEvent(new Event('jarvis:full-access-change'));
}

function setAssistantState(mode, label) {
  const supportedModes = ['normal', 'listening', 'speaking', 'thinking', 'happy', 'error', 'offline'];
  state.assistantMode = supportedModes.includes(mode) ? mode : 'normal';
  elements.assistantState.textContent = label;
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
  updateHologramState();
}

function updateHologramState() {
  const activeMode = ['listening', 'thinking', 'speaking'].includes(state.assistantMode)
    ? state.assistantMode
    : state.holoOnline ? 'online' : '';
  const announcement = activeMode || 'offline';
  elements.holoStates.forEach((item) => {
    const active = item.dataset.holoState === activeMode;
    item.classList.toggle('is-current', active);
    if (active) item.setAttribute('aria-current', 'true');
    else item.removeAttribute('aria-current');
  });
  const voiceActive = ['listening', 'speaking'].includes(state.assistantMode);
  elements.holoWaveform.classList.toggle('is-active', voiceActive);
  elements.holoWaveform.classList.toggle('is-listening', state.assistantMode === 'listening');
  elements.holoWaveform.classList.toggle('is-speaking', state.assistantMode === 'speaking');
  elements.holoWaveform.setAttribute('aria-label', voiceActive
    ? `Voice activity ${state.assistantMode}`
    : 'Voice activity idle');
  elements.holoStateAnnouncement.textContent = announcement === 'online'
    ? 'J.A.R.V.I.S. is online.'
    : announcement === 'offline' ? 'J.A.R.V.I.S. is offline.'
      : `J.A.R.V.I.S. is ${announcement}.`;
  elements.statePanelLive.textContent = announcement.toUpperCase();
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
    const summaryPrompt = createSearchSummaryPrompt(message.data);
    if (summaryPrompt) {
      const summarize = document.createElement('button');
      summarize.type = 'button';
      summarize.className = 'search-summary-button';
      summarize.textContent = 'Summarize with AI';
      summarize.setAttribute('aria-label', 'Ask J.A.R.V.I.S. to summarize these search results');
      summarize.disabled = state.pending;
      summarize.addEventListener('click', () => summarizeSearchResults(message.data, summaryPrompt));
      wrapper.append(summarize);
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
  if (message.role === 'assistant' && speechReplayController.getStatus(message) === 'available') {
    const replayButton = document.createElement('button');
    replayButton.type = 'button';
    replayButton.className = 'tts-replay-button';
    replayButton.textContent = 'Tap to Replay';
    replayButton.setAttribute('aria-label', 'Tap to replay this J.A.R.V.I.S. response');
    replayButton.addEventListener('click', () => {
      if (!speechReplayController.beginReplay(message)) return;
      speak(message.content, {
        onStart: () => speechReplayController.markStarted(message),
        onNotStarted: () => speechReplayController.markNotStarted(message),
      });
    });
    wrapper.append(replayButton);
  }
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

async function sendChat(text, { retry = false, contextOverride = null, maxTokens = null, singleAttempt = false } = {}) {
  const context = contextOverride || selectRecentChatContext(state.messages);
  if (!retry) state.lastChatFailure = null;
  setDashboardChatState('thinking', 'J.A.R.V.I.S. is processing your message.');
  setAssistantState('thinking', 'PROCESSING REQUEST');
  try {
    showFeedback('');
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: apiHeaders(true),
      body: JSON.stringify({
        messages: context,
        language: state.preferences.language,
        mode: state.preferences.studyMode ? 'study' : 'standard',
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
        ...(singleAttempt ? { singleAttempt: true } : {}),
      }),
      signal: AbortSignal.timeout(50_000),
    });
    const data = await readApiResponse(response);
    const reply = readChatReply(data);
    state.lastChatFailure = null;
    setDashboardChatState('', '');
    const replyMessage = { role: 'assistant', content: reply };
    addMessage(replyMessage);
    elements.providerNote.textContent = `Connected through ${data.provider}. Search results are retrieved separately and linked to their sources.`;
    elements.modelValue.textContent = data.provider;
    elements.leftAiStatus.textContent = 'AI RESPONDED';
    elements.leftAiDetail.textContent = `Most recent successful reply came from ${data.provider}.`;
    logActivity('Assistant reply received');
    setAssistantState('happy', 'RESPONSE READY');
    if (state.preferences.voiceEnabled) {
      speechReplayController.track(replyMessage);
      reportSpeechDiagnostic('AI reply reaches speak()', { voiceOutputEnabled: true });
      speak(reply, {
        onStart: () => speechReplayController.markStarted(replyMessage),
        onNotStarted: () => speechReplayController.markNotStarted(replyMessage),
      });
    } else {
      reportTtsDiagnostic('TTS utterance skipped', {
        reason: 'speechSynthesis' in window ? 'voice-output-disabled' : 'speech-synthesis-unavailable',
      });
    }
  } catch (error) {
    const message = getRequestErrorMessage(error, 'AI request');
    showFeedback(document.body.classList.contains('new-interface') ? '' : message);
    state.lastChatFailure = { text, message, contextOverride, maxTokens, singleAttempt };
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
    document.querySelectorAll('.search-summary-button').forEach((button) => { button.disabled = false; });
    if (state.assistantMode === 'thinking' && (!state.preferences.voiceEnabled || !('speechSynthesis' in window))) {
      setAssistantState('', 'SYSTEM STANDBY');
    }
    resumeWakeWordDetection();
  }
}

function retryLastChat() {
  if (state.pending || !state.lastChatFailure) return;
  primeVoiceOutput();
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
  sendChat(failure.text, {
    retry: true,
    contextOverride: failure.contextOverride,
    maxTokens: failure.maxTokens,
    singleAttempt: failure.singleAttempt,
  });
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
    document.querySelectorAll('.search-summary-button').forEach((button) => { button.disabled = false; });
    if (state.assistantMode === 'thinking') setAssistantState('', 'SYSTEM STANDBY');
    resumeWakeWordDetection();
  }
}

function summarizeSearchResults(data, prompt) {
  if (state.pending) return;
  if (!state.aiConfigured) {
    showFeedback('AI summaries are unavailable because no AI provider is configured. Search results are still available.');
    return;
  }
  if (!prompt) {
    showFeedback('No safe source links are available to summarize.');
    return;
  }
  primeVoiceOutput();
  state.pending = true;
  elements.send.disabled = true;
  elements.dashboardSend.disabled = true;
  document.querySelectorAll('.search-summary-button').forEach((button) => { button.disabled = true; });
  const query = typeof data.query === 'string' ? data.query : 'the retrieved sources';
  addMessage({ role: 'user', content: `Summarize the retrieved search sources for: ${query}` });
  sendChat(prompt, {
    contextOverride: [{ role: 'user', content: prompt }],
    maxTokens: 256,
    singleAttempt: true,
  });
}

function submitMessage(event) {
  event.preventDefault();
  if (event.submitter === elements.send) primeVoiceOutput();
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
  if (state.recognitionWakeSession) {
    state.wakeWordResumePending = state.preferences.wakeWordEnabled;
    requestStopListening();
  }
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
  return selectSpeechSynthesisVoice(
    state.voices,
    state.preferences.language,
    state.labPreferences.voiceURI || state.preferences.voiceURI,
  );
}

function primeVoiceOutput() {
  if (!('speechSynthesis' in window) || !state.preferences.voiceEnabled) return false;
  return primeSpeechSynthesis(
    window.speechSynthesis,
    window.SpeechSynthesisUtterance || globalThis.SpeechSynthesisUtterance,
    state.preferences.language,
  );
}

function startListeningFromUserGesture() {
  startListening();
  primeVoiceOutput();
}

function pageIsFocused() {
  try {
    return typeof document.hasFocus === 'function' && document.hasFocus();
  } catch {
    return false;
  }
}

function speak(text, { onStart, onNotStarted } = {}) {
  if (!('speechSynthesis' in window)) {
    reportSpeechDiagnostic('TTS utterance skipped', { reason: 'speech-synthesis-unavailable' });
    onNotStarted?.();
    return;
  }
  if (!state.preferences.voiceEnabled) {
    reportTtsDiagnostic('TTS utterance skipped', { reason: 'voice-output-disabled' });
    onNotStarted?.();
    return;
  }
  const speechText = String(text || '').trim();
  if (!speechText) {
    reportTtsDiagnostic('TTS utterance skipped', { reason: 'empty-text' });
    onNotStarted?.();
    return;
  }
  if (state.speechOutputTexts.has(speechText)) {
    reportTtsDiagnostic('TTS utterance skipped', { reason: 'duplicate-text' });
    onStart?.();
    return;
  }
  if (!shouldPlaySpeech(document.visibilityState, pageIsFocused())) {
    reportTtsDiagnostic('TTS utterance skipped', { reason: 'page-unfocused' });
    state.pendingSpeechText = null;
    state.pendingSpeechOptions = null;
    setAssistantState('', 'SYSTEM STANDBY');
    showFeedback('Voice output was skipped while J.A.R.V.I.S. was unfocused or in the background. The text reply is available.');
    onNotStarted?.();
    return;
  }
  state.speechOutputTexts.add(speechText);
  if (state.recognition) {
    reportTtsDiagnostic('TTS utterance deferred', {
      language: getSpeechRecognitionLanguage(state.preferences.language),
      reason: 'recognition-active',
    });
    state.pendingSpeechText = speechText;
    state.pendingSpeechOptions = { onStart, onNotStarted };
    requestStopListening();
    return;
  }
  const playbackId = ++state.speechPlaybackId;
  state.speechStartMonitorCancel?.();
  state.speechStartMonitorCancel = null;
  state.pendingSpeechText = null;
  const voice = selectedVoice();
  const voiceDetails = {
    language: state.preferences.language === 'hi' ? 'hi-IN' : 'en-US',
    voiceName: voice?.name || 'System default',
    voiceLanguage: voice?.lang || 'unknown',
  };
  const queuedAt = performance.now();
  let startedAt = null;
  let utterance;
  try {
    utterance = new (window.SpeechSynthesisUtterance || globalThis.SpeechSynthesisUtterance)(speechText);
  } catch {
    reportTtsDiagnostic('TTS utterance creation failed', voiceDetails);
    state.speechOutputTexts.delete(speechText);
    state.speechPlaybackId += 1;
    setAssistantState('', 'SYSTEM STANDBY');
    showFeedback('Speech output could not start on this device.');
    resumeWakeWordDetection();
    onNotStarted?.();
    return;
  }
  utterance.lang = voiceDetails.language;
  utterance.rate = state.preferences.speechRate;
  utterance.voice = voice;
  let playbackStarted = false;
  const markPlaybackStarted = () => {
    if (playbackStarted || playbackId !== state.speechPlaybackId) return;
    playbackStarted = true;
    state.speechStartMonitorCancel?.();
    state.speechStartMonitorCancel = null;
    setAssistantState('speaking', 'VOICE OUTPUT');
    logActivity('Voice response started');
  };
  utterance.onstart = () => {
    if (playbackId !== state.speechPlaybackId) return;
    startedAt = performance.now();
    reportTtsDiagnostic('TTS utterance onstart', {
      ...voiceDetails,
      queueDurationMs: Math.max(0, Math.round(startedAt - queuedAt)),
    });
    markPlaybackStarted();
    onStart?.();
  };
  utterance.onpause = () => {
    if (playbackId !== state.speechPlaybackId) return;
    reportTtsDiagnostic('TTS utterance onpause', {
      ...voiceDetails,
      started: playbackStarted,
      ...(startedAt === null ? {} : { durationMs: Math.max(0, Math.round(performance.now() - startedAt)) }),
    });
    setAssistantState('', 'VOICE PAUSED');
  };
  utterance.onresume = () => {
    if (playbackId !== state.speechPlaybackId) return;
    reportTtsDiagnostic('TTS utterance onresume', {
      ...voiceDetails,
      started: playbackStarted,
      ...(startedAt === null ? {} : { durationMs: Math.max(0, Math.round(performance.now() - startedAt)) }),
    });
    setAssistantState('speaking', 'VOICE OUTPUT');
  };
  utterance.onend = () => {
    const endedAt = performance.now();
    reportTtsDiagnostic('TTS utterance onend', {
      ...voiceDetails,
      started: playbackStarted,
      elapsedMs: Math.max(0, Math.round(endedAt - queuedAt)),
      ...(startedAt === null ? {} : {
        queueDurationMs: Math.max(0, Math.round(startedAt - queuedAt)),
        durationMs: Math.max(0, Math.round(endedAt - startedAt)),
      }),
    });
    state.speechOutputTexts.delete(speechText);
    if (playbackId !== state.speechPlaybackId) return;
    if (!playbackStarted) onNotStarted?.();
    state.speechStartMonitorCancel?.();
    state.speechStartMonitorCancel = null;
    state.speechPlaybackId += 1;
    setAssistantState('', 'SYSTEM STANDBY');
    logActivity('Voice response complete');
    resumeWakeWordDetection();
  };
  utterance.onerror = (event) => {
    const erroredAt = performance.now();
    reportTtsDiagnostic('TTS utterance onerror', {
      ...voiceDetails,
      error: event.error || 'unknown',
      started: playbackStarted,
      elapsedMs: Math.max(0, Math.round(erroredAt - queuedAt)),
      ...(startedAt === null ? {} : {
        queueDurationMs: Math.max(0, Math.round(startedAt - queuedAt)),
        durationMs: Math.max(0, Math.round(erroredAt - startedAt)),
      }),
    });
    state.speechOutputTexts.delete(speechText);
    if (playbackId !== state.speechPlaybackId) return;
    if (!playbackStarted) onNotStarted?.();
    state.speechStartMonitorCancel?.();
    state.speechStartMonitorCancel = null;
    state.speechPlaybackId += 1;
    setAssistantState('', 'SYSTEM STANDBY');
    showFeedback(getSpeechSynthesisErrorMessage(event.error));
    resumeWakeWordDetection();
  };
  try {
    window.speechSynthesis.speak(utterance);
  } catch (error) {
    reportTtsDiagnostic('TTS utterance queue failed', {
      ...voiceDetails,
      error: error?.name || 'unknown',
    });
    state.speechOutputTexts.delete(speechText);
    state.speechPlaybackId += 1;
    setAssistantState('', 'SYSTEM STANDBY');
    showFeedback('Speech output could not start on this device.');
    resumeWakeWordDetection();
    onNotStarted?.();
    return;
  }
  reportTtsDiagnostic('TTS utterance queued', voiceDetails);
  try {
    window.speechSynthesis.resume?.();
  } catch (error) {
    reportTtsDiagnostic('TTS resume failed', {
      ...voiceDetails,
      error: error?.name || 'unknown',
    });
  }
  if (!playbackStarted) state.speechStartMonitorCancel = monitorSpeechSynthesisStart(window.speechSynthesis, {
    onTimeout: () => {
      if (playbackId !== state.speechPlaybackId) return;
      reportTtsDiagnostic('TTS utterance start timeout', {
        ...voiceDetails,
        started: false,
        elapsedMs: Math.max(0, Math.round(performance.now() - queuedAt)),
      });
      state.speechStartMonitorCancel = null;
      state.speechOutputTexts.delete(speechText);
      state.speechPlaybackId += 1;
      setAssistantState('', 'SYSTEM STANDBY');
      showFeedback(getSpeechSynthesisErrorMessage('timeout'));
      onNotStarted?.();
      resumeWakeWordDetection();
    },
  });
}

function stopSpeechOutput() {
  state.speechStartMonitorCancel?.();
  state.speechStartMonitorCancel = null;
  state.pendingSpeechText = null;
  state.pendingSpeechOptions = null;
  state.speechOutputTexts.clear();
  state.speechPlaybackId += 1;
  try {
    window.speechSynthesis.cancel();
  } catch {}
  if (state.assistantMode === 'speaking') setAssistantState('', 'SYSTEM STANDBY');
  resumeWakeWordDetection();
}

function updateVoiceList() {
  if (!('speechSynthesis' in window)) {
    elements.voice.disabled = true;
    elements.voiceEnabled.disabled = true;
    elements.voiceSupport.textContent = 'Speech output is not supported by this browser';
    return;
  }
  state.voices = window.speechSynthesis.getVoices();
  elements.voice.replaceChildren(new Option('System default', ''));
  for (const voice of state.voices) {
    const label = `${voice.name} (${voice.lang})${voice.default ? ' · default' : ''}`;
    elements.voice.add(new Option(label, voice.voiceURI));
  }
  elements.voice.value = state.preferences.voiceURI;
  elements.voiceSupport.textContent = state.labPreferences.voiceURI
    ? 'A LAB voice override is active. Your saved J.A.R.V.I.S. voice setting remains unchanged.'
    : state.voices.length ? `${state.voices.length} voice${state.voices.length === 1 ? '' : 's'} available on this device` : 'No system voices are available';
  updateLabVoiceOptions();
  if (!elements.personalizePanel.hidden && personalizeDraft) renderPersonalizePreview(personalizeDraft);
}

function updateLabVoiceOptions(selectedURI = personalizeDraft?.voiceURI ?? state.labPreferences.voiceURI) {
  if (!elements.labVoice) return;
  elements.labVoice.replaceChildren(new Option('System default', ''));
  for (const voice of state.voices) {
    elements.labVoice.add(new Option(redactSensitiveText(`${voice.name} (${voice.lang})${voice.default ? ' · default' : ''}`), voice.voiceURI));
  }
  if (selectedURI && !state.voices.some((voice) => voice.voiceURI === selectedURI)) {
    elements.labVoice.add(new Option('Saved voice unavailable on this device', selectedURI));
  }
  elements.labVoice.value = selectedURI;
  elements.labVoice.disabled = !('speechSynthesis' in window);
  const voiceHelp = document.querySelector('#lab-voice-help');
  voiceHelp.textContent = 'Applied LAB voice overrides output while selected; your saved J.A.R.V.I.S. voice setting remains unchanged. Choose System default to restore it.';
  if (!('speechSynthesis' in window)) voiceHelp.textContent = 'Speech voices are not available in this browser. The LAB preference remains separate.';
}

function readPersonalizeForm() {
  const form = elements.personalizeForm;
  const checkedValue = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value;
  return {
    theme: checkedValue('lab-theme') || DEFAULT_LAB_PREFERENCES.theme,
    accent: checkedValue('lab-accent') || DEFAULT_LAB_PREFERENCES.accent,
    density: elements.labDensity.value,
    voiceURI: elements.labVoice.value,
    widgets: {
      assistant: form.elements.namedItem('lab-widget-assistant').checked,
      status: form.elements.namedItem('lab-widget-status').checked,
      voice: form.elements.namedItem('lab-widget-voice').checked,
      chat: form.elements.namedItem('lab-widget-chat').checked,
      system: form.elements.namedItem('lab-widget-system').checked,
    },
  };
}

function syncPersonalizeForm(preferences) {
  for (const name of ['lab-theme', 'lab-accent']) {
    const value = preferences[name === 'lab-theme' ? 'theme' : 'accent'];
    const radio = elements.personalizeForm.querySelector(`input[name="${name}"][value="${value}"]`);
    if (radio) radio.checked = true;
  }
  elements.labDensity.value = preferences.density;
  updateLabVoiceOptions(preferences.voiceURI);
  for (const [key, checked] of Object.entries(preferences.widgets)) {
    elements.personalizeForm.elements.namedItem(`lab-widget-${key}`).checked = checked;
  }
  renderPersonalizePreview(preferences);
}

function renderPersonalizePreview(preferences) {
  const preview = elements.personalizePreview;
  preview.dataset.theme = preferences.theme;
  preview.dataset.density = preferences.density;
  preview.dataset.accent = preferences.accent;
  preview.style.setProperty('--lab-accent', LAB_ACCENTS[preferences.accent]);
  for (const widget of preview.querySelectorAll('[data-preview-widget]')) {
    widget.hidden = preferences.widgets[widget.dataset.previewWidget] === false;
  }
  const themeName = preferences.theme[0].toUpperCase() + preferences.theme.slice(1);
  const densityName = preferences.density[0].toUpperCase() + preferences.density.slice(1);
  elements.personalizePreviewNote.textContent = `${themeName} theme · ${densityName} layout`;
  elements.personalizePreviewVoice.textContent = redactSensitiveText(elements.labVoice.selectedOptions[0]?.textContent || 'System default voice');
}

function renderLabSafetyStatus() {
  elements.labSafetyChangeState.textContent = LAB_PROJECT_CHANGES_ENABLED
    ? 'Enabled only through audited approval controls.'
    : 'Disabled · project files cannot be changed by J.A.R.V.I.S. LAB.';
}

function openPersonalizePanel() {
  renderLabSafetyStatus();
  personalizeDraft = loadLabPreferences(localStorage);
  syncPersonalizeForm(personalizeDraft);
  elements.aiModifyPanel.hidden = true;
  elements.codeStudioPanel.hidden = true;
  elements.extensionsPanel.hidden = true;
  elements.labModules.hidden = true;
  elements.personalizePanel.hidden = false;
  elements.labSafetyPanel.hidden = true;
  elements.personalizeStatus.textContent = 'Changes are preview-only until applied.';
  elements.personalizeTitle.focus();
}

function closePersonalizePanel() {
  personalizeDraft = null;
  elements.personalizePanel.hidden = true;
  elements.labModules.hidden = false;
  elements.labSafetyPanel.hidden = false;
  document.querySelector('[data-lab-module="personalize"]').focus();
}

function renderLabAiModifyHistory() {
  const history = loadLabAiModifyHistory(localStorage);
  elements.aiModifyHistory.replaceChildren();
  if (!history.length) {
    const empty = document.createElement('li');
    empty.className = 'ai-modify-history-empty';
    empty.textContent = 'No proposal activity yet.';
    elements.aiModifyHistory.append(empty);
    return;
  }
  for (const entry of history.slice().reverse()) {
    const item = document.createElement('li');
    const time = document.createElement('time');
    time.dateTime = new Date(entry.timestamp).toISOString();
    time.textContent = new Date(entry.timestamp).toLocaleString();
    const message = document.createElement('span');
    message.textContent = redactSensitiveText(entry.message);
    item.append(time, message);
    elements.aiModifyHistory.append(item);
  }
}

function recordLabAiModifyEvent(status) {
  try {
    recordLabAiModifyHistory(localStorage, status);
    renderLabAiModifyHistory();
    return true;
  } catch (error) {
    elements.aiModifyStatus.textContent = `Local history could not be saved: ${error.message}`;
    return false;
  }
}

function openLabAiModifyPanel() {
  renderLabSafetyStatus();
  elements.labModules.hidden = true;
  elements.personalizePanel.hidden = true;
  elements.codeStudioPanel.hidden = true;
  elements.extensionsPanel.hidden = true;
  elements.aiModifyPanel.hidden = false;
  elements.labSafetyPanel.hidden = true;
  elements.aiModifyRequest.value = '';
  elements.aiModifyPlanStatus.textContent = 'No plan generated';
  renderLabAiModifyHistory();
  elements.aiModifyTitle.focus();
}

function closeLabAiModifyPanel() {
  elements.aiModifyRequest.value = '';
  elements.aiModifyPanel.hidden = true;
  elements.labModules.hidden = false;
  elements.labSafetyPanel.hidden = false;
  document.querySelector('[data-lab-module="ai-modify"]').focus();
}

function submitLabAiModifyRequest(event) {
  event.preventDefault();
  const outcome = getLabAiModifyRequestStatus(elements.aiModifyRequest.value);
  if (outcome === 'empty') {
    elements.aiModifyStatus.textContent = 'Describe a change before requesting a proposal.';
    elements.aiModifyRequest.focus();
    return;
  }
  if (!recordLabAiModifyEvent(outcome)) return;
  elements.aiModifyPlanStatus.textContent = 'Unavailable · no plan generated';
  elements.aiModifyStatus.textContent = 'AI Modify is not connected. Your request was not sent, and no plan or diff was generated.';
}

function cancelLabAiModifyRequest() {
  if (elements.aiModifyRequest.value.trim() && !recordLabAiModifyEvent('cancelled')) return;
  closeLabAiModifyPanel();
}

function rejectLabAiModifyRequest() {
  if (!elements.aiModifyRequest.value.trim()) {
    elements.aiModifyStatus.textContent = 'There is no generated proposal to reject.';
    return;
  }
  if (!recordLabAiModifyEvent('rejected')) return;
  elements.aiModifyRequest.value = '';
  elements.aiModifyPlanStatus.textContent = 'No plan generated';
  elements.aiModifyStatus.textContent = 'Request rejected and discarded. No proposal was generated or applied.';
}

function openCodeStudioPanel() {
  renderLabSafetyStatus();
  elements.labModules.hidden = true;
  elements.personalizePanel.hidden = true;
  elements.aiModifyPanel.hidden = true;
  elements.extensionsPanel.hidden = true;
  elements.codeStudioPanel.hidden = false;
  elements.labSafetyPanel.hidden = true;
  updateCodeStudioEditorState();
  elements.codeStudioTitle.focus();
}

function closeCodeStudioPanel() {
  elements.codeStudioPanel.hidden = true;
  elements.labModules.hidden = false;
  elements.labSafetyPanel.hidden = false;
  document.querySelector('[data-lab-module="code-studio"]').focus();
}

function updateCodeStudioReview() {
  const code = elements.codeStudioEditor.value;
  const findings = reviewCodeLocally(code);
  elements.codeStudioCount.textContent = `${code.length.toLocaleString()} characters · ${code.split(/\r?\n/).length.toLocaleString()} line${code.split(/\r?\n/).length === 1 ? '' : 's'}`;
  elements.codeStudioFindings.replaceChildren();
  if (!code.trim()) {
    elements.codeStudioReviewSummary.textContent = 'Paste or import code to see local, non-executing review suggestions.';
    const empty = document.createElement('li');
    empty.textContent = 'No review findings.';
    elements.codeStudioFindings.append(empty);
    return;
  }
  elements.codeStudioReviewSummary.textContent = findings.length
    ? `${findings.length} heuristic finding${findings.length === 1 ? '' : 's'} · review manually; this is not a full security audit.`
    : 'No heuristic issues found. This is not a full security audit.';
  if (!findings.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No heuristic findings.';
    elements.codeStudioFindings.append(empty);
    return;
  }
  for (const finding of findings) {
    const item = document.createElement('li');
    const severity = document.createElement('strong');
    severity.textContent = `${finding.severity.toUpperCase()} · line ${finding.line}`;
    const message = document.createElement('span');
    message.textContent = finding.title;
    item.append(severity, message);
    elements.codeStudioFindings.append(item);
  }
}

function updateCodeStudioEditorState() {
  const readOnly = elements.codeStudioReadonly.checked;
  if (readOnly) {
    if (codeStudioPreviewSource === null) codeStudioPreviewSource = elements.codeStudioEditor.value;
    elements.codeStudioEditor.value = redactSensitiveText(codeStudioPreviewSource);
  } else if (codeStudioPreviewSource !== null) {
    elements.codeStudioEditor.value = codeStudioPreviewSource;
    codeStudioPreviewSource = null;
  }
  elements.codeStudioEditor.readOnly = readOnly;
  elements.codeStudioStatus.textContent = readOnly
    ? 'Read-only preview enabled. Credential-like values are masked; switch it off to edit the original local text.'
    : 'Editing local text only. Nothing is executed or written to the project.';
  updateCodeStudioReview();
}

async function importCodeStudioFile() {
  const file = elements.codeStudioFile.files?.[0];
  elements.codeStudioFile.value = '';
  if (!file) return;
  const validation = validateCodeFile(file);
  if (!validation.valid) {
    elements.codeStudioStatus.textContent = validation.reason;
    return;
  }
  try {
    const text = await file.text();
    codeStudioPreviewSource = elements.codeStudioReadonly.checked ? text : null;
    elements.codeStudioEditor.value = elements.codeStudioReadonly.checked ? redactSensitiveText(text) : text;
    elements.codeStudioLanguage.value = validation.language;
    updateCodeStudioReview();
    elements.codeStudioStatus.textContent = redactSensitiveText(
      `${containsSensitiveText(text) ? 'Imported with credential-like values masked' : 'Imported'} ${file.name} as untrusted text for local preview only. It was not executed or saved to the project.`,
    );
  } catch (error) {
    elements.codeStudioStatus.textContent = `Could not read the selected file: ${error.message}`;
  }
}

async function copyCodeStudioText() {
  if (!elements.codeStudioEditor.value) {
    elements.codeStudioStatus.textContent = 'There is no code to copy.';
    return;
  }
  try {
    const source = elements.codeStudioReadonly.checked && codeStudioPreviewSource !== null
      ? codeStudioPreviewSource
      : elements.codeStudioEditor.value;
    const safeText = redactSensitiveText(source);
    if (!await copyTextToClipboard(safeText)) {
      elements.codeStudioStatus.textContent = 'Clipboard access was denied. Select and copy the code manually.';
      return;
    }
    elements.codeStudioStatus.textContent = safeText === source
      ? 'Code copied to this device clipboard only; it was not sent or executed.'
      : 'Code copied with credential-like values redacted. The editor remains unchanged.';
  } catch (error) {
    elements.codeStudioStatus.textContent = `Code could not be copied: ${error.message}`;
  }
}

function exportCodeStudioText() {
  const code = elements.codeStudioReadonly.checked && codeStudioPreviewSource !== null
    ? codeStudioPreviewSource
    : elements.codeStudioEditor.value;
  if (!code) {
    elements.codeStudioStatus.textContent = 'There is no code to export.';
    return;
  }
  if (!window.confirm('Export a separate text copy? Review it for API keys, passwords, tokens, and other secrets first. This downloads to your device and does not modify the project.')) {
    elements.codeStudioStatus.textContent = 'Export canceled. No file was downloaded.';
    return;
  }
  let url = '';
  let link = null;
  try {
    const { blob, fileName } = createCodeExport(code, elements.codeStudioLanguage.value);
    url = URL.createObjectURL(blob);
    link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.hidden = true;
    document.body.append(link);
    link.click();
    elements.codeStudioStatus.textContent = containsSensitiveText(code)
      ? `${fileName} downloaded with credential-like values redacted. The editor and project were not changed.`
      : `${fileName} downloaded as a separate plain-text copy. The project was not changed.`;
  } catch (error) {
    elements.codeStudioStatus.textContent = `Code could not be exported: ${error.message}`;
  } finally {
    link?.remove();
    if (url) window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function clearCodeStudioText() {
  if (!elements.codeStudioEditor.value) {
    elements.codeStudioStatus.textContent = 'The editor is already clear.';
    return;
  }
  elements.codeStudioEditor.value = '';
  codeStudioPreviewSource = null;
  elements.codeStudioReadonly.checked = false;
  updateCodeStudioEditorState();
  updateCodeStudioReview();
  elements.codeStudioStatus.textContent = 'Local editor text cleared.';
}

function prepareCodeStudioImport() {
  if (!window.confirm('Import a local code or text file for preview? It will be treated as untrusted text, stay in this tab, and will not be executed or written to the project. Files are limited to 1 MB.')) {
    elements.codeStudioStatus.textContent = 'Import canceled. No file was opened.';
    return;
  }
  elements.codeStudioFile.click();
}

function extensionStatusLabel(state) {
  return ({
    'pending-review': 'Pending review',
    installed: 'Installed · enabled state (metadata only)',
    disabled: 'Disabled · installed',
  })[state] || 'Unknown state';
}

function renderLabExtensionHistory(history) {
  elements.extensionsHistory.replaceChildren();
  if (!history.length) {
    const empty = document.createElement('li');
    empty.className = 'extensions-history-empty';
    empty.textContent = 'No extension activity yet.';
    elements.extensionsHistory.append(empty);
    return;
  }
  for (const entry of history.slice().reverse()) {
    const item = document.createElement('li');
    const time = document.createElement('time');
    time.dateTime = new Date(entry.timestamp).toISOString();
    time.textContent = new Date(entry.timestamp).toLocaleString();
    const description = document.createElement('span');
    description.textContent = `${redactSensitiveText(entry.extensionName)} · ${entry.action.replaceAll('-', ' ')}`;
    item.append(time, description);
    elements.extensionsHistory.append(item);
  }
}

function renderLabExtensions() {
  let store;
  try {
    store = loadLabExtensions(localStorage);
  } catch (error) {
    elements.extensionsCount.textContent = 'DATA UNAVAILABLE';
    elements.extensionsList.replaceChildren();
    elements.extensionsHistory.replaceChildren();
    elements.extensionsStatus.textContent = redactSensitiveText(`Saved extension data could not be read safely: ${error.message}`);
    return false;
  }
  elements.extensionsCount.textContent = `${store.extensions.length} EXTENSION${store.extensions.length === 1 ? '' : 'S'}`;
  elements.extensionsList.replaceChildren();
  if (!store.extensions.length) {
    const empty = document.createElement('p');
    empty.className = 'extensions-empty';
    empty.textContent = 'No imported extensions.';
    elements.extensionsList.append(empty);
  }
  for (const extension of store.extensions) {
    const card = document.createElement('article');
    card.className = 'extension-card';
    card.dataset.extensionId = extension.id;

    const heading = document.createElement('div');
    heading.className = 'extension-card-heading';
    const title = document.createElement('div');
    const name = document.createElement('h4');
    name.textContent = redactSensitiveText(extension.manifest.name);
    const version = document.createElement('span');
    version.textContent = `Version ${extension.manifest.version}`;
    title.append(name, version);
    const state = document.createElement('span');
    state.className = `extension-state is-${extension.state}`;
    state.textContent = extensionStatusLabel(extension.state);
    heading.append(title, state);

    const description = document.createElement('p');
    description.className = 'extension-description';
    description.textContent = redactSensitiveText(extension.manifest.description || 'No description provided.');

    const permissionHeading = document.createElement('strong');
    permissionHeading.className = 'extension-permission-title';
    permissionHeading.textContent = 'Requested permissions · not granted';
    const permissions = document.createElement('ul');
    permissions.className = 'extension-permissions';
    if (!extension.manifest.permissions.length) {
      const none = document.createElement('li');
      none.textContent = 'No permissions requested.';
      permissions.append(none);
    }
    for (const permission of extension.manifest.permissions) {
      const item = document.createElement('li');
      item.textContent = redactSensitiveText(permission);
      permissions.append(item);
    }

    const fileSummary = document.createElement('p');
    fileSummary.className = 'extension-file-summary';
    fileSummary.textContent = `${Object.keys(extension.files).length} package file${Object.keys(extension.files).length === 1 ? '' : 's'} stored as inert text.`;

    const actions = document.createElement('div');
    actions.className = 'extension-actions';
    const addAction = (action, label, className = 'personalize-secondary-button') => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.dataset.extensionAction = action;
      button.dataset.extensionId = extension.id;
      button.textContent = label;
      actions.append(button);
    };
    if (extension.state === 'pending-review') {
      addAction('approve', 'Review permissions & install', 'personalize-apply-button');
      addAction('reject', 'Reject package');
      addAction('export', 'Export package');
    } else {
      addAction(extension.state === 'disabled' ? 'enable' : 'disable', extension.state === 'disabled' ? 'Enable' : 'Disable');
      addAction('export', 'Export package');
      addAction('remove', 'Remove', 'personalize-secondary-button');
    }
    card.append(heading, description, permissionHeading, permissions, fileSummary, actions);
    elements.extensionsList.append(card);
  }
  renderLabExtensionHistory(store.history);
  return true;
}

function openExtensionsPanel() {
  renderLabSafetyStatus();
  elements.labModules.hidden = true;
  elements.personalizePanel.hidden = true;
  elements.aiModifyPanel.hidden = true;
  elements.codeStudioPanel.hidden = true;
  elements.extensionsPanel.hidden = false;
  elements.labSafetyPanel.hidden = true;
  elements.extensionsStatus.textContent = 'Packages are stored locally as inert data. No extension runtime is available.';
  renderLabExtensions();
  elements.extensionsTitle.focus();
}

function closeExtensionsPanel() {
  elements.extensionsPanel.hidden = true;
  elements.labModules.hidden = false;
  elements.labSafetyPanel.hidden = false;
  document.querySelector('[data-lab-module="extensions"]').focus();
}

function createExtensionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `extension-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function importLabExtension() {
  const file = elements.extensionsFile.files?.[0];
  elements.extensionsFile.value = '';
  if (!file) return;
  const fileStatus = getExtensionPackageFileStatus(file);
  if (!fileStatus.valid) {
    elements.extensionsStatus.textContent = fileStatus.reason;
    return;
  }
  try {
    const packageText = await file.text();
    if (new TextEncoder().encode(packageText).byteLength > EXTENSION_PACKAGE_MAX_BYTES) {
      elements.extensionsStatus.textContent = 'Extension package exceeds the 512 KB limit.';
      return;
    }
    const packageData = validateExtensionPackageText(packageText, file.name);
    if (!packageData.valid) {
      elements.extensionsStatus.textContent = packageData.reason;
      return;
    }
    const extension = addPendingExtension(localStorage, packageData, { id: createExtensionId() });
    if (!renderLabExtensions()) return;
    elements.extensionsStatus.textContent = redactSensitiveText(`${extension.manifest.name} ${extension.manifest.version} added as pending review. Review all requested permissions before approval.`);
  } catch (error) {
    elements.extensionsStatus.textContent = redactSensitiveText(`Package could not be imported: ${error.message}`);
  }
}

function promptExtensionImport() {
  const accepted = window.confirm(
    'Import an untrusted extension package for local metadata review? It will not be executed or granted access to J.A.R.V.I.S. settings, provider keys, or secrets.',
  );
  if (!accepted) {
    elements.extensionsStatus.textContent = 'Import canceled. No package was opened.';
    return;
  }
  elements.extensionsFile.click();
}

function approveLabExtension(extension) {
  const safeName = redactSensitiveText(extension.manifest.name);
  const requested = extension.manifest.permissions.length
    ? extension.manifest.permissions.map((permission) => `• ${redactSensitiveText(permission)}`).join('\n')
    : 'No permissions requested.';
  const accepted = window.confirm(
    `Review ${safeName} ${extension.manifest.version} and approve installation in disabled state?\n\nRequested permissions (not granted):\n${requested}\n\nApproval stores package metadata only. No code runs and no permissions or secret access are granted.`,
  );
  if (!accepted) {
    elements.extensionsStatus.textContent = 'Approval canceled. Package remains pending review.';
    return;
  }
  try {
    setLabExtensionState(localStorage, extension.id, 'disabled');
    if (!renderLabExtensions()) return;
    elements.extensionsStatus.textContent = `${safeName} installed disabled. No runtime access has been granted.`;
  } catch (error) {
    elements.extensionsStatus.textContent = redactSensitiveText(`Extension approval failed: ${error.message}`);
  }
}

function changeLabExtensionState(extension, enabled) {
  if (enabled && !window.confirm(
    `Enable ${redactSensitiveText(extension.manifest.name)} in the manager? This changes metadata state only. The package remains inert; no code runs and no permissions are granted.`,
  )) {
    elements.extensionsStatus.textContent = 'Enable canceled. Extension remains disabled.';
    return;
  }
  try {
    setLabExtensionState(localStorage, extension.id, enabled ? 'installed' : 'disabled');
    if (!renderLabExtensions()) return;
    elements.extensionsStatus.textContent = enabled
      ? `${redactSensitiveText(extension.manifest.name)} marked enabled in metadata only; runtime execution remains unavailable.`
      : `${redactSensitiveText(extension.manifest.name)} disabled.`;
  } catch (error) {
    elements.extensionsStatus.textContent = redactSensitiveText(`Extension state could not be changed: ${error.message}`);
  }
}

function rejectLabExtension(extension) {
  const safeName = redactSensitiveText(extension.manifest.name);
  if (!window.confirm(`Reject and remove pending package "${safeName}"?`)) {
    elements.extensionsStatus.textContent = 'Rejection canceled. Package remains pending review.';
    return;
  }
  try {
    recordLabExtensionRejection(localStorage, extension);
    if (!renderLabExtensions()) return;
    elements.extensionsStatus.textContent = `${safeName} rejected and removed.`;
  } catch (error) {
    elements.extensionsStatus.textContent = redactSensitiveText(`Package could not be rejected: ${error.message}`);
  }
}

function removeManagedLabExtension(extension) {
  const safeName = redactSensitiveText(extension.manifest.name);
  if (!window.confirm(`Remove "${safeName}" and its locally stored package files? This cannot be undone.`)) {
    elements.extensionsStatus.textContent = 'Removal canceled.';
    return;
  }
  try {
    removeLabExtension(localStorage, extension.id);
    if (!renderLabExtensions()) return;
    elements.extensionsStatus.textContent = `${safeName} and its local package data were removed.`;
  } catch (error) {
    elements.extensionsStatus.textContent = redactSensitiveText(`Extension could not be removed: ${error.message}`);
  }
}

function exportManagedLabExtension(extension) {
  if (!window.confirm(
    `Export "${redactSensitiveText(extension.manifest.name)}" as a package download? Credential-like values will be redacted before download.`,
  )) {
    elements.extensionsStatus.textContent = 'Export canceled. No package was downloaded.';
    return;
  }
  let url = '';
  let link = null;
  let downloaded = false;
  try {
    const packageText = serializeLabExtensionPackage(extension);
    const blob = new Blob([packageText], { type: 'application/json;charset=utf-8' });
    url = URL.createObjectURL(blob);
    link = document.createElement('a');
    link.href = url;
    link.download = `${extension.id.replace(/[^a-zA-Z0-9_-]/g, '-')}.jarvis-extension.json`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    downloaded = true;
    recordLabExtensionExport(localStorage, extension);
    if (!renderLabExtensions()) return;
    elements.extensionsStatus.textContent = containsSensitiveText(extension)
      ? `${redactSensitiveText(extension.manifest.name)} exported with credential-like values redacted. The project was not changed.`
      : `${redactSensitiveText(extension.manifest.name)} exported as a separate JSON package. The project was not changed.`;
  } catch (error) {
    elements.extensionsStatus.textContent = downloaded
      ? redactSensitiveText(`Package downloaded, but export history could not be saved: ${error.message}`)
      : redactSensitiveText(`Extension package could not be exported: ${error.message}`);
  } finally {
    link?.remove();
    if (url) window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function handleLabExtensionAction(event) {
  const button = event.target.closest('[data-extension-action]');
  if (!button) return;
  let extension;
  try {
    extension = loadLabExtensions(localStorage).extensions.find(({ id }) => id === button.dataset.extensionId);
  } catch (error) {
    elements.extensionsStatus.textContent = redactSensitiveText(`Saved extension data could not be read safely: ${error.message}`);
    renderLabExtensions();
    return;
  }
  if (!extension) {
    elements.extensionsStatus.textContent = 'Extension is no longer available. Refresh the manager.';
    renderLabExtensions();
    return;
  }
  const action = button.dataset.extensionAction;
  if (action === 'approve') approveLabExtension(extension);
  else if (action === 'reject') rejectLabExtension(extension);
  else if (action === 'enable') changeLabExtensionState(extension, true);
  else if (action === 'disable') changeLabExtensionState(extension, false);
  else if (action === 'remove') removeManagedLabExtension(extension);
  else if (action === 'export') exportManagedLabExtension(extension);
}

function resetPersonalizeDraft() {
  personalizeDraft = resetLabPreferencesDraft();
  syncPersonalizeForm(personalizeDraft);
  elements.personalizeStatus.textContent = 'Default values are preview-only until you apply them.';
}

function applyPersonalizeDraft() {
  personalizeDraft = readPersonalizeForm();
  let savedPreferences;
  try {
    savedPreferences = saveLabPreferences(personalizeDraft, localStorage);
  } catch (error) {
    elements.personalizeStatus.textContent = 'Preferences could not be saved. Your active settings were not changed.';
    showFeedback(`Personalization preferences could not be saved: ${error.message}`);
    return;
  }
  state.labPreferences = savedPreferences;
  try {
    applyLabPreferences(state.labPreferences, document);
    updateVoiceList();
    elements.personalizeStatus.textContent = 'Preferences applied and saved separately from J.A.R.V.I.S. settings.';
  } catch (error) {
    elements.personalizeStatus.textContent = 'Preferences were saved, but could not be fully applied.';
    showFeedback(`Saved personalization preferences could not be applied: ${error.message}`);
  }
}

function updateWakeWordSupport() {
  const supported = Boolean(getSpeechRecognitionConstructor(window));
  if (!supported || window.isSecureContext === false) {
    elements.wakeWordEnabled.disabled = true;
    elements.wakeWordEnabled.checked = false;
    state.preferences.wakeWordEnabled = false;
    savePreferences();
    elements.wakeWordSupport.textContent = supported
      ? 'Wake-word detection requires HTTPS or localhost.'
      : 'Wake-word detection is not supported by this browser.';
    return false;
  }
  elements.wakeWordEnabled.disabled = false;
  elements.wakeWordEnabled.checked = state.preferences.wakeWordEnabled;
  elements.wakeWordSupport.textContent = 'Say "Hey JARVIS" or "हे जार्विस" while this app is open. Requires microphone permission; recognition may use your browser speech service.';
  return true;
}

function disableWakeWord(message = '') {
  state.preferences.wakeWordEnabled = false;
  state.wakeWordResumePending = false;
  state.wakeWordRestartDelay = 600;
  elements.wakeWordEnabled.checked = false;
  window.clearTimeout(state.wakeWordRestartTimer);
  state.wakeWordRestartTimer = null;
  savePreferences();
  if (message) showFeedback(message);
}

function resumeWakeWordDetection(reason = 'assistant-workflow-complete') {
  if (!state.wakeWordResumePending || !state.preferences.wakeWordEnabled) return;
  if (wakeWordRecoveryPolicy.circuitOpen) return;
  if (!shouldRunWakeWord(state.preferences.wakeWordEnabled, document.visibilityState, state.wakeWordPagePaused, state.microphonePermission, pageIsFocused())) return;
  if (state.recognition || state.pending || isSpeechOutputBusy()) return;
  if (!wakeWordRecoveryPolicy.canRetry()) {
    wakeWordRecoveryPolicy.openCircuit();
    state.wakeWordResumePending = false;
    reportSpeechDiagnostic('Wake-word circuit breaker opened', {
      attempt: wakeWordRecoveryPolicy.restartAttempts,
      limit: WAKE_WORD_MAX_RESTART_ATTEMPTS,
      reason: 'retry-limit-reached',
    });
    showFeedback('Wake-word listening paused after repeated recognition interruptions. Toggle wake-word detection off and on to retry.');
    return;
  }
  state.wakeWordResumePending = false;
  window.clearTimeout(state.wakeWordRestartTimer);
  const restartDelay = state.wakeWordRestartDelay;
  reportSpeechDiagnostic('Wake-word automatic restart scheduled', {
    attempt: wakeWordRecoveryPolicy.restartAttempts + 1,
    delayMs: restartDelay,
    reason,
  });
  state.wakeWordRestartTimer = window.setTimeout(() => {
    state.wakeWordRestartTimer = null;
    if (!state.preferences.wakeWordEnabled) return;
    if (!shouldRunWakeWord(state.preferences.wakeWordEnabled, document.visibilityState, state.wakeWordPagePaused, state.microphonePermission, pageIsFocused())) {
      state.wakeWordResumePending = true;
      return;
    }
    if (state.recognition || state.pending || isSpeechOutputBusy()) {
      state.wakeWordResumePending = true;
      resumeWakeWordDetection();
      return;
    }
    const attempt = wakeWordRecoveryPolicy.recordRestartAttempt();
    if (attempt === null) {
      state.wakeWordResumePending = false;
      reportSpeechDiagnostic('Wake-word circuit breaker opened', {
        attempt: wakeWordRecoveryPolicy.restartAttempts,
        limit: WAKE_WORD_MAX_RESTART_ATTEMPTS,
        reason: 'retry-limit-reached',
      });
      showFeedback('Wake-word listening paused after repeated recognition interruptions. Toggle wake-word detection off and on to retry.');
      return;
    }
    state.wakeWordResumePending = false;
    reportSpeechDiagnostic('Wake-word automatic restart attempted', {
      attempt,
      delayMs: restartDelay,
      reason,
    });
    startListening('wake', false, true);
  }, restartDelay);
}

function scheduleWakeWordRecovery(reason = 'recognition-ended-after-activation') {
  if (!state.preferences.wakeWordEnabled) return;
  state.wakeWordRestartDelay = nextWakeWordRestartDelay(state.wakeWordRestartDelay);
  state.wakeWordResumePending = true;
  resumeWakeWordDetection(reason);
}

function clearRecognitionStartTimer() {
  window.clearTimeout(state.recognitionStartTimer);
  state.recognitionStartTimer = null;
}

function isSpeechOutputBusy() {
  return state.assistantMode === 'speaking'
    || Boolean(window.speechSynthesis?.speaking)
    || Boolean(window.speechSynthesis?.pending);
}

function startListening(purpose = 'command', wakeHandoff = false, automaticWakeRestart = false) {
  const Recognition = getSpeechRecognitionConstructor(window);
  if (purpose === 'wake') reportWakeWordStatus('start-attempt');
  if (purpose === 'wake' && automaticWakeRestart && wakeWordRecoveryPolicy.circuitOpen) {
    reportSpeechDiagnostic('Wake-word listening blocked', {
      reason: 'retry-limit-reached',
    });
    return;
  }
  if (!Recognition) {
    if (purpose === 'wake') {
      reportSpeechDiagnostic('Wake-word listening blocked', {
        reason: 'recognition-unavailable',
      });
    }
    const message = 'Voice input is not supported by this browser. Try a current Chrome-based browser over HTTPS.';
    if (purpose === 'wake' || wakeHandoff) disableWakeWord(message);
    else showFeedback(message);
    setAssistantState('error', 'VOICE INPUT UNAVAILABLE');
    return;
  }
  if (state.recognition) {
    if (purpose === 'wake') {
      reportSpeechDiagnostic('Wake-word listening blocked', {
        reason: state.wakeWordManualRetryPending ? 'manual-retry-waiting-for-end' : 'recognition-active',
      });
      state.wakeWordResumePending = true;
      return;
    }
    if (state.recognitionWakeSession) {
      disableWakeWord('Wake-word detection is off. Listening for your request.');
      state.wakeWordManualTakeoverPending = true;
      requestStopListening();
    } else if (state.listening && !recognitionLifecycle.isStopping(state.recognition)) {
      requestStopListening();
    }
    return;
  }
  if (purpose === 'wake' && !state.preferences.wakeWordEnabled) {
    reportSpeechDiagnostic('Wake-word listening blocked', { reason: 'disabled' });
    return;
  }
  const wakeWordBlockReason = getWakeWordListeningBlockReason(
    state.preferences.wakeWordEnabled,
    document.visibilityState,
    state.wakeWordPagePaused,
    state.microphonePermission,
    pageIsFocused(),
  );
  if (purpose === 'wake' && wakeWordBlockReason) {
    reportSpeechDiagnostic('Wake-word listening blocked', {
      reason: wakeWordBlockReason,
    });
    state.wakeWordResumePending = true;
    return;
  }
  if (purpose === 'wake' && (state.pending || isSpeechOutputBusy())) {
    reportSpeechDiagnostic('Wake-word listening blocked', {
      reason: state.pending ? 'assistant-busy' : 'speech-output-busy',
    });
    state.wakeWordResumePending = true;
    return;
  }
  if (window.isSecureContext === false) {
    const message = 'Voice input requires a secure HTTPS connection or localhost.';
    if (purpose === 'wake' || wakeHandoff) disableWakeWord(message);
    else showFeedback(message);
    setAssistantState('error', 'MICROPHONE UNAVAILABLE');
    return;
  }
  if (purpose === 'command' && 'speechSynthesis' in window) stopSpeechOutput();
  let recognition;
  try {
    recognition = new Recognition();
  } catch (error) {
    if (purpose === 'wake' || wakeHandoff) {
      reportSpeechDiagnostic('SpeechRecognition start failed', {
        error: error?.name || 'unknown',
        language: getSpeechRecognitionLanguage(state.preferences.language),
        purpose: wakeHandoff ? 'wake-command' : purpose,
      });
    }
    const message = 'The browser could not initialize speech recognition. Check microphone permissions and try again.';
    if (purpose === 'wake' || wakeHandoff) disableWakeWord(message);
    else showFeedback(message);
    setAssistantState('error', 'MICROPHONE UNAVAILABLE');
    return;
  }
  if (!recognitionLifecycle.begin(recognition)) {
    if (purpose === 'wake') {
      reportSpeechDiagnostic('Wake-word listening blocked', {
        reason: 'recognition-active',
      });
    }
    return;
  }
  if (purpose === 'wake' && !automaticWakeRestart && state.wakeWordManualRetryPending) {
    wakeWordRecoveryPolicy.resetForManualRetry();
    state.wakeWordManualRetryPending = false;
    state.wakeWordRestartDelay = 600;
  }
  window.clearTimeout(state.wakeWordRestartTimer);
  state.wakeWordRestartTimer = null;
  if (!wakeHandoff) state.wakeWordResumePending = false;
  state.recognitionPurpose = wakeHandoff ? 'wake-command' : purpose;
  state.recognitionWakeSession = purpose === 'wake';
  state.wakeWordTriggered = false;
  state.recognitionStartedAt = null;
  state.recognitionError = null;
  recognition.lang = getSpeechRecognitionLanguage(state.preferences.language);
  recognition.interimResults = true;
  recognition.continuous = purpose === 'wake';
  recognition.maxAlternatives = purpose === 'wake' ? 3 : 1;
  state.recognition = recognition;
  state.listening = true;
  elements.mic.classList.add('is-active');
  elements.mic.setAttribute('aria-label', 'Stop voice input');
  elements.mic.setAttribute('aria-pressed', 'true');
  elements.dashboardMicButton.classList.add('is-active');
  elements.dashboardMicButton.setAttribute('aria-label', 'Stop voice input');
  elements.dashboardMicButton.setAttribute('aria-pressed', 'true');
  setAssistantState('listening', 'STARTING MICROPHONE');
  showFeedback(wakeHandoff
    ? 'Wake phrase heard. Starting command listening; speak when listening is confirmed.'
    : purpose === 'wake'
      ? 'Starting wake-word listening. Your browser may ask for microphone permission.'
      : 'Starting voice input. Speak when listening is confirmed.');
  if (purpose === 'wake' || wakeHandoff) {
    reportSpeechDiagnostic('SpeechRecognition start requested', {
      language: recognition.lang,
      purpose: state.recognitionPurpose,
      continuous: recognition.continuous,
      maxAlternatives: recognition.maxAlternatives,
    });
  }

  recognition.onstart = () => {
    if (!recognitionLifecycle.isCurrent(recognition) || recognitionLifecycle.isStopping(recognition)) return;
    clearRecognitionStartTimer();
    state.recognitionStartedAt = performance.now();
    if (purpose === 'wake' || wakeHandoff) {
      reportSpeechDiagnostic('SpeechRecognition started', {
        language: recognition.lang,
        purpose: state.recognitionPurpose,
      });
    }
    setAssistantState('listening', purpose === 'wake' ? 'WAITING FOR WAKE WORD' : wakeHandoff ? 'WAITING FOR COMMAND' : 'LISTENING');
    showFeedback(purpose === 'wake'
      ? 'Listening for "Hey JARVIS" or "हे जार्विस". Keep J.A.R.V.I.S. open and in the foreground.'
      : wakeHandoff ? 'Listening for your request now.' : 'Listening. Speak now.');
  };

  recognition.onresult = (event) => {
    if (!recognitionLifecycle.isCurrent(recognition) || recognitionLifecycle.isStopping(recognition)) return;
    clearRecognitionStartTimer();
    const { transcript, finalResult } = readSpeechRecognitionResult(event);
    if (state.recognitionWakeSession) {
      const alternatives = readSpeechRecognitionAlternatives(event);
      if (alternatives.length) {
        wakeWordRecoveryPolicy.recordSpeechResult();
        state.wakeWordRestartDelay = 600;
      }
      const matchedTranscript = alternatives.find((candidate) => matchWakeWord(candidate).matched);
      const wakeTranscript = matchedTranscript || transcript;
      const matchResult = matchWakeWord(wakeTranscript);
      reportSpeechDiagnostic('SpeechRecognition results received', {
        language: recognition.lang,
        purpose: state.recognitionPurpose || purpose,
        resultCount: event.results?.length || 0,
        alternativeCount: alternatives.length,
        finalResult,
      });
      reportSpeechDiagnostic('Wake-word match evaluated', {
        language: recognition.lang,
        purpose: state.recognitionPurpose || purpose,
        matched: matchResult.matched,
        activated: matchResult.matched && !state.wakeWordTriggered,
        alreadyActivated: state.wakeWordTriggered,
        finalResult,
      });
      const wakeResult = readWakeWordCommand(
        wakeTranscript,
        state.wakeWordTriggered,
        state.wakeWordTriggered ? elements.message.value : '',
      );
      if (!wakeResult.triggered) return;
      if (wakeResult.activated) {
        state.wakeWordTriggered = true;
        state.recognitionPurpose = 'wake-command';
        elements.message.value = '';
        showFeedback(wakeResult.command
          ? 'Wake word detected. Processing your request.'
          : 'Wake word detected. Say your request now, or repeat the wake phrase with your request.');
        setAssistantState('listening', 'JARVIS ACTIVATED');
      }
      elements.message.value = wakeResult.command;
    } else {
      if (transcript) {
        wakeWordRecoveryPolicy.recordSpeechResult();
        state.wakeWordRestartDelay = 600;
      }
      elements.message.value = transcript;
    }
    if (finalResult && elements.message.value) {
      requestStopListening(recognition);
      elements.form.requestSubmit();
    }
  };
  recognition.onerror = (event) => {
    if (state.recognition !== recognition) return;
    clearRecognitionStartTimer();
    state.recognitionError = event.error || 'unknown';
    reportSpeechDiagnostic('SpeechRecognition error', {
      error: event.error || 'unknown',
      language: recognition.lang,
      purpose: state.recognitionPurpose || purpose,
    });
    const message = getSpeechRecognitionErrorMessage(event.error);
    const wakeSession = state.recognitionWakeSession;
    if (event.error === 'not-allowed') {
      microphonePermissionGuard.invalidate();
      state.microphonePermission = 'denied';
      renderMicrophoneStatus();
    }
    const wakeCommandSession = state.recognitionPurpose === 'wake-command';
    const wakeWorkflow = wakeSession || wakeCommandSession;
    if (wakeWorkflow && isFatalSpeechRecognitionError(event.error)) {
      disableWakeWord(message);
    } else if (wakeWorkflow && event.error === 'no-speech') {
      showFeedback('No speech detected. Restarting wake-word listening shortly.');
    } else if (!wakeSession || event.error !== 'no-speech') {
      showFeedback(message);
    }
    if (message && event.error !== 'no-speech' && event.error !== 'aborted') setAssistantState('error', 'VOICE INPUT ERROR');
  };
  recognition.onend = () => {
    clearRecognitionStartTimer();
    if (!recognitionLifecycle.isCurrent(recognition)) return;
    const wakeWorkflow = state.recognitionWakeSession || state.recognitionPurpose === 'wake-command';
    const unexpected = wakeWorkflow && !recognitionLifecycle.isStopping(recognition);
    const sessionDurationMs = state.recognitionStartedAt === null
      ? null
      : Math.max(0, Math.round(performance.now() - state.recognitionStartedAt));
    if (wakeWorkflow) {
      reportSpeechDiagnostic('SpeechRecognition ended', {
        language: recognition.lang,
        purpose: state.recognitionPurpose || purpose,
        unexpected,
        wakeWordTriggered: state.wakeWordTriggered,
        ...(sessionDurationMs === null ? {} : { durationMs: sessionDurationMs }),
        ...(state.recognitionError ? { error: state.recognitionError } : {}),
      });
    }
    stopListening(recognition, { unexpected, sessionDurationMs });
  };
  clearRecognitionStartTimer();
  state.recognitionStartTimer = window.setTimeout(() => {
    state.recognitionStartTimer = null;
    if (!recognitionLifecycle.isCurrent(recognition) || recognitionLifecycle.isStopping(recognition)) return;
    const message = 'Speech recognition did not start. Check microphone permission and try again.';
    if (purpose === 'wake' || wakeHandoff) {
      reportSpeechDiagnostic('SpeechRecognition start failed', {
        error: 'timeout',
        language: recognition.lang,
        purpose: state.recognitionPurpose || purpose,
      });
    }
    showFeedback(wakeHandoff || purpose === 'wake'
      ? 'Wake listening did not start. Retrying shortly; check microphone permission if this continues.'
      : message);
    setAssistantState('error', 'MICROPHONE START TIMED OUT');
    requestStopListening(recognition);
  }, 10_000);
  try {
    recognition.start();
  } catch (error) {
    clearRecognitionStartTimer();
    const startError = getSpeechRecognitionStartError(error);
    const message = startError.message;
    if (purpose === 'wake' || wakeHandoff) {
      reportSpeechDiagnostic('SpeechRecognition start failed', {
        error: error?.name || 'unknown',
        language: recognition.lang,
        purpose: state.recognitionPurpose || purpose,
      });
    }
    if (startError.permissionDenied) {
      microphonePermissionGuard.invalidate();
      state.microphonePermission = 'denied';
      renderMicrophoneStatus();
    }
    if (startError.permissionDenied || error?.name === 'SecurityError') {
      disableWakeWord(message);
    } else if (purpose === 'wake' || wakeHandoff) {
      showFeedback(`${message} Wake-word listening will retry shortly.`);
      state.wakeWordResumePending = true;
    } else {
      showFeedback(message);
    }
    setAssistantState('error', startError.permissionDenied ? 'MICROPHONE PERMISSION DENIED' : 'MICROPHONE UNAVAILABLE');
    stopListening(recognition, { unexpected: purpose === 'wake' || wakeHandoff });
  }
}

function requestStopListening(recognition = state.recognition) {
  if (!recognition || recognition !== state.recognition || !recognitionLifecycle.requestStop(recognition)) return;
  try {
    recognition.stop();
  } catch (error) {
    reportSpeechDiagnostic('SpeechRecognition stop failed', {
      error: error?.name || 'unknown',
      language: recognition.lang,
      purpose: state.recognitionPurpose || 'command',
    });
  }
}

function stopListening(recognition = state.recognition, { unexpected = false, sessionDurationMs = null } = {}) {
  if (recognition && (recognition !== state.recognition || !recognitionLifecycle.finish(recognition))) return;
  clearRecognitionStartTimer();
  const wakeSession = state.recognitionWakeSession;
  const wakeWasTriggered = state.wakeWordTriggered;
  const wakeCommandSession = state.recognitionPurpose === 'wake-command';
  const manualWakeRetry = state.wakeWordManualRetryPending;
  if (manualWakeRetry) {
    state.wakeWordManualRetryPending = false;
    wakeWordRecoveryPolicy.resetForManualRetry();
    state.wakeWordRestartDelay = 600;
  }
  if (wakeWordRecoveryPolicy.recordSessionDuration(sessionDurationMs)) state.wakeWordRestartDelay = 600;
  state.recognition = null;
  state.recognitionPurpose = null;
  state.recognitionWakeSession = false;
  state.wakeWordTriggered = false;
  state.recognitionStartedAt = null;
  state.recognitionError = null;
  state.listening = false;
  elements.mic.classList.remove('is-active');
  elements.mic.setAttribute('aria-label', 'Start voice input');
  elements.mic.setAttribute('aria-pressed', 'false');
  elements.dashboardMicButton.classList.remove('is-active');
  elements.dashboardMicButton.setAttribute('aria-label', 'Start voice input');
  elements.dashboardMicButton.setAttribute('aria-pressed', 'false');
  if (state.assistantMode === 'listening') setAssistantState('', 'SYSTEM STANDBY');
  const manualTakeoverPending = state.wakeWordManualTakeoverPending;
  state.wakeWordManualTakeoverPending = false;
  if (manualTakeoverPending && !state.preferences.wakeWordEnabled && isPageForeground(document.visibilityState, pageIsFocused())) {
    startListening('command');
    return;
  }
  const pendingSpeechText = state.pendingSpeechText;
  if (pendingSpeechText) {
    const pendingSpeechOptions = state.pendingSpeechOptions;
    state.pendingSpeechText = null;
    state.pendingSpeechOptions = null;
    state.speechOutputTexts.delete(pendingSpeechText);
    state.wakeWordResumePending ||= wakeSession;
    speak(pendingSpeechText, pendingSpeechOptions || {});
    return;
  }
  if (manualWakeRetry && state.preferences.wakeWordEnabled) {
    state.wakeWordResumePending = true;
    resumeWakeWordDetection('manual-retry');
    return;
  }
  if (wakeSession && wakeWasTriggered) state.wakeWordRestartDelay = 600;
  if (wakeSession && wakeWasTriggered && state.preferences.wakeWordEnabled && !state.pending
    && isPageForeground(document.visibilityState, pageIsFocused()) && state.microphonePermission !== 'denied') {
    state.wakeWordResumePending = true;
    startListening('command', true);
    return;
  }
  if (wakeCommandSession && state.preferences.wakeWordEnabled && !state.pending) {
    scheduleWakeWordRecovery('recognition-ended-after-activation');
  }
  if ((wakeSession || state.wakeWordResumePending) && state.preferences.wakeWordEnabled) {
    state.wakeWordResumePending = true;
    if (!wakeWasTriggered && unexpected) state.wakeWordRestartDelay = nextWakeWordRestartDelay(state.wakeWordRestartDelay);
    resumeWakeWordDetection(wakeSession ? 'recognition-ended-before-activation' : 'recognition-ended');
  }
}

function syncSettings() {
  elements.language.value = state.preferences.language;
  elements.speechRate.value = String(state.preferences.speechRate);
  elements.speechRateValue.textContent = Number(state.preferences.speechRate).toFixed(1);
  elements.voiceEnabled.checked = state.preferences.voiceEnabled;
  updateWakeWordSupport();
  elements.memoryEnabled.checked = state.preferences.memoryEnabled;
  elements.leftMemoryStatus.textContent = state.preferences.memoryEnabled ? 'LOCAL' : 'OFF';
  elements.leftMicStatus.textContent = getSpeechRecognitionConstructor(window) ? 'AVAILABLE' : 'UNSUPPORTED';
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
  const requestSequence = ++healthRequestSequence;
  updateDeviceMonitor();
  elements.memoryValue.textContent = state.preferences.memoryEnabled ? 'Local storage' : 'Disabled';
  loadSystemMetrics();
  if (!navigator.onLine) {
    if (requestSequence !== healthRequestSequence) return;
    state.holoOnline = false;
    updateHologramState();
    elements.backendConnectionValue.textContent = 'Offline';
    elements.connection.className = 'connection-indicator is-offline';
    elements.connection.lastElementChild.textContent = 'OFFLINE';
    elements.dashboardConnection.textContent = 'OFFLINE';
    elements.leftAiStatus.textContent = 'OFFLINE';
    elements.leftAiDetail.textContent = 'The server cannot be reached while this device is offline.';
    elements.leftSessionStatus.textContent = 'OFFLINE';
    return;
  }
  try {
    const response = await fetch('/api/health', {
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    const data = await readApiResponse(response);
    if (requestSequence !== healthRequestSequence) return;
    state.holoOnline = true;
    updateHologramState();
    state.aiConfigured = data.aiConfigured === true;
    state.accessRequired = data.accessRequired === true;
    const ollamaSelected = data.provider === 'ollama';
    const aiReady = data.aiConfigured && (!ollamaSelected || data.aiAvailable);
    if (!state.aiSettingsLoaded) {
      state.aiSettingsLoaded = true;
      elements.aiProvider.value = data.provider || 'openai-compatible';
      elements.aiModel.value = data.model || (ollamaSelected ? 'qwen2.5:3b' : 'gemini-3.5-flash-lite');
      if (data.baseUrl) elements.aiBaseUrl.value = data.baseUrl;
      updateAIProviderFields();
    }
    elements.aiSetupStatus.textContent = data.aiConfigured
      ? `Current: ${data.provider === 'ollama' ? 'Ollama' : 'OpenAI-compatible'} · ${data.model} · ${data.providerSource === 'environment' ? 'deployment environment secret' : data.providerSource === 'session' ? 'temporary server-session setting' : 'server configuration'}`
      : 'No AI provider is configured. Choose a provider and model here, then save.';
    elements.connection.className = aiReady ? 'connection-indicator' : 'connection-indicator is-warning';
    elements.connection.lastElementChild.textContent = aiReady
      ? ollamaSelected ? 'OLLAMA READY' : 'AI CONFIGURED'
      : ollamaSelected && !data.ollamaAvailable ? 'OLLAMA OFFLINE'
        : ollamaSelected ? 'MODEL MISSING' : 'NO AI MODEL';
    elements.dashboardConnection.textContent = aiReady ? 'CONNECTED' : 'SETUP REQUIRED';
    elements.providerNote.textContent = !data.aiConfigured
      ? 'No AI provider is configured. Open Settings → AI provider to select a model and configure Ollama or an OpenAI-compatible provider.'
      : ollamaSelected && !data.ollamaAvailable
        ? 'Ollama is selected but unreachable from this server. Start the Ollama daemon on the server host.'
        : ollamaSelected && !data.modelInstalled
          ? `Ollama is running, but ${data.model} is not installed there.`
          : ollamaSelected
            ? `Ollama and ${data.model} are available on the server.`
            : data.providerSource === 'session'
              ? 'A temporary provider key is active in server memory only. Set AI_API_KEY in the hosting provider’s environment secrets to keep it across restarts. Live availability is confirmed when you send a message.'
              : 'AI provider is configured through the server environment. Live availability is confirmed when you send a message.';
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
    elements.leftAiDetail.textContent = ollamaSelected
      ? data.aiAvailable ? `${data.model} is available on this server.` : data.ollamaAvailable ? `${data.model} is not installed.` : 'Ollama is not reachable from this server.'
      : data.aiConfigured ? 'Provider is configured. Availability is confirmed when you send a message.' : 'Open Settings to configure an AI provider and model.';
    elements.leftSessionStatus.textContent = 'CONNECTED';
    elements.backendConnectionValue.textContent = 'Connected';
    elements.leftMemoryStatus.textContent = state.preferences.memoryEnabled ? 'LOCAL' : 'OFF';
    elements.footerStatus.textContent = aiReady ? 'SERVER AI · LOCAL HISTORY · PERMISSION-BOUND' : 'AI UNAVAILABLE · LOCAL HISTORY · PERMISSION-BOUND';
  } catch {
    if (requestSequence !== healthRequestSequence) return;
    state.holoOnline = false;
    updateHologramState();
    elements.connection.className = 'connection-indicator is-offline';
    elements.connection.lastElementChild.textContent = 'SERVER OFFLINE';
    elements.dashboardConnection.textContent = 'SERVER OFFLINE';
    elements.providerNote.textContent = 'The app server is not responding. Chat and web search require a connection to this server.';
    elements.modelValue.textContent = 'Unavailable';
    elements.leftAiStatus.textContent = 'UNAVAILABLE';
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
  const recognitionSupported = Boolean(getSpeechRecognitionConstructor(window));
  const isListening = state.assistantMode === 'listening';
  elements.dashboardMicButton.setAttribute('aria-pressed', String(isListening));
  elements.dashboardVoiceMicButton.setAttribute('aria-pressed', String(isListening));
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
  const requestVersion = microphonePermissionGuard.begin();
  if (!elements.voiceValue) return;
  const recognitionSupported = Boolean(getSpeechRecognitionConstructor(window));
  if (!recognitionSupported) {
    elements.voiceValue.textContent = 'Not available';
    return;
  }
  if (!navigator.permissions?.query && !permissionStatus) {
    elements.voiceValue.textContent = 'Permission status unavailable';
    reportSpeechDiagnostic('Microphone permission status', {
      permission: 'unknown',
      reason: 'permissions-api-unavailable',
    });
    return;
  }
  try {
    const status = permissionStatus || await navigator.permissions.query({ name: 'microphone' });
    if (!microphonePermissionGuard.isCurrent(requestVersion)) return;
    state.microphonePermission = status.state;
    reportSpeechDiagnostic('Microphone permission status', {
      permission: status.state,
      source: permissionStatus ? 'change' : 'query',
    });
    renderMicrophoneStatus();
    if (status.state === 'denied') {
      if (state.preferences.wakeWordEnabled) disableWakeWord('Microphone permission was denied. Wake-word detection is off until permission is granted again.');
      reportWakeWordStatus('setting-changed');
      if (state.recognition) requestStopListening();
      renderMicrophoneStatus();
    }
    if (!permissionStatus) status.addEventListener?.('change', () => updateMicrophonePermission(status));
  } catch {
    if (!microphonePermissionGuard.isCurrent(requestVersion)) return;
    state.microphonePermission = 'unknown';
    reportSpeechDiagnostic('Microphone permission status', {
      permission: 'unknown',
      reason: 'query-failed',
    });
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

function pauseVoiceForPageLifecycle() {
  state.wakeWordPagePaused = true;
  window.clearTimeout(state.wakeWordRestartTimer);
  state.wakeWordRestartTimer = null;
  if (state.pendingSpeechText || state.assistantMode === 'speaking'
    || window.speechSynthesis?.speaking || window.speechSynthesis?.pending || window.speechSynthesis?.paused) {
    stopSpeechOutput();
    showFeedback('Voice playback stopped when J.A.R.V.I.S. lost focus. The text reply is still available.');
  }
  if (state.recognitionWakeSession && state.preferences.wakeWordEnabled) {
    state.wakeWordResumePending = true;
    showFeedback('Wake-word detection paused while J.A.R.V.I.S. is unfocused or in the background.');
  }
  if (state.recognition) {
    if (!state.recognitionWakeSession) showFeedback('Voice input paused while J.A.R.V.I.S. is unfocused or in the background. Tap the microphone to resume.');
    requestStopListening();
  }
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
    ? 'Use Google Gemini’s OpenAI-compatible chat completions API or another compatible provider. Saving here stores the key only in server memory until restart. This form cannot change deployment secrets; set AI_API_KEY in your hosting provider’s environment/secrets dashboard for persistence. The key is never saved in this browser or returned by the server. Use a trusted server over HTTPS.'
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
      elements.aiSetupStatus.textContent = data.providerSource === 'environment'
        ? `Using deployment environment configuration: ${data.provider === 'ollama' ? 'Ollama' : 'OpenAI-compatible'} · ${data.model}.`
        : `Saved temporarily in this server session: ${data.provider === 'ollama' ? 'Ollama' : 'OpenAI-compatible'} · ${data.model}. Configure AI_API_KEY as a hosting environment secret to keep the key across restarts.`;
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
    lab: elements.labLayout,
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

function openJarvisLab() {
  switchWorkspaceView('lab', {
    dashboard: elements.dashboardLayout,
    conversation: elements.conversationView,
    lab: elements.labLayout,
    body: document.body,
    navigationItems: document.querySelectorAll('[data-nav]'),
  });
  document.querySelector('#new-interface-button').setAttribute('aria-pressed', 'false');
  document.querySelector('#old-interface-button').setAttribute('aria-pressed', 'false');
  document.querySelector('#jarvis-lab-title').focus();
}

function returnToJarvisWorkspace() {
  setWorkspaceView(state.workspaceView, { remember: false });
  if (state.workspaceView === 'dashboard') elements.dashboardMessage.focus();
  else elements.message.focus();
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

async function startScreenCapture(captureSequence) {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    elements.captureStatus.textContent = 'Screen capture is not supported in this browser.';
    elements.captureFrameButton.textContent = 'Screen capture unavailable';
    return;
  }
  elements.captureFrameButton.disabled = true;
  elements.captureFrameButton.textContent = 'Waiting for screen permission';
  elements.captureStatus.textContent = 'Choose a screen or window in the browser permission picker.';
  try {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    if (captureSequence !== state.visionCaptureSequence
      || !elements.screenCaptureDialog.open
      || !state.preferences.fullAccessEnabled) {
      displayStream.getTracks().forEach((track) => track.stop());
      return;
    }
    state.displayStream = displayStream;
    elements.capturePreview.srcObject = state.displayStream;
    elements.capturePreview.hidden = false;
    elements.captureFrameButton.disabled = false;
    elements.captureFrameButton.textContent = 'Capture one frame';
    elements.stopCaptureButton.disabled = false;
    elements.captureStatus.textContent = 'Screen sharing is active only while the browser indicator is visible.';
    state.displayStream.getVideoTracks()[0]?.addEventListener('ended', stopScreenCapture, { once: true });
    logActivity('Screen sharing approved by user');
  } catch (error) {
    if (captureSequence !== state.visionCaptureSequence || !elements.screenCaptureDialog.open) return;
    elements.captureStatus.textContent = error.name === 'NotAllowedError'
      ? 'Screen capture was cancelled or denied.'
      : `Screen capture unavailable: ${error.message}`;
    elements.captureFrameButton.disabled = false;
    elements.captureFrameButton.textContent = 'Choose screen again';
  }
}

function stopScreenCapture() {
  state.displayStream?.getTracks().forEach((track) => track.stop());
  state.displayStream = null;
  elements.capturePreview.srcObject = null;
  elements.capturePreview.hidden = true;
  elements.captureFrameButton.disabled = false;
  elements.captureFrameButton.textContent = 'Choose screen again';
  elements.captureStatus.textContent = 'Screen sharing stopped.';
}

function updateVisionSendButton() {
  elements.visionSendButton.disabled = !state.visionFrame
    || state.visionSending
    || !elements.visionQuestion.value.trim();
}

function clearVisionFrame() {
  state.visionFrame = null;
  if (state.captureObjectUrl) URL.revokeObjectURL(state.captureObjectUrl);
  state.captureObjectUrl = null;
  elements.captureFramePreview.removeAttribute('src');
  elements.captureFramePreview.hidden = true;
  elements.downloadCapture.removeAttribute('href');
  elements.downloadCapture.hidden = true;
  elements.visionQuestion.value = '';
  elements.visionQuestion.disabled = true;
  updateVisionSendButton();
}

function openVisionDialog() {
  if (!state.preferences.fullAccessEnabled) return;
  if (elements.applicationDialog.open) elements.applicationDialog.close();
  const captureSequence = ++state.visionCaptureSequence;
  clearVisionFrame();
  elements.captureFrameButton.disabled = true;
  elements.stopCaptureButton.disabled = false;
  elements.captureStatus.textContent = '';
  elements.screenCaptureDialog.showModal();
  startScreenCapture(captureSequence);
}

function emergencyStopVision() {
  state.visionCaptureSequence += 1;
  state.visionAbortController?.abort();
  stopScreenCapture();
  clearVisionFrame();
  elements.stopCaptureButton.disabled = true;
  elements.captureFrameButton.disabled = false;
  elements.captureFrameButton.textContent = 'Choose screen again';
  elements.captureStatus.textContent = 'Emergency Stop: screen sharing stopped, pending request cancelled, and local preview cleared.';
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

async function createVisionFrame(video, canvas) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const scale = Math.min(1, maxVisionDimension / Math.max(sourceWidth, sourceHeight));
  let width = Math.max(1, Math.round(sourceWidth * scale));
  let height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Screen capture is unavailable in this browser.');

  for (let attempt = 0; attempt < 8; attempt += 1) {
    canvas.width = width;
    canvas.height = height;
    context.drawImage(video, 0, 0, width, height);
    const blob = await canvasToJpeg(canvas, Math.max(.48, .82 - attempt * .05));
    if (blob?.type === 'image/jpeg' && blob.size <= maxVisionImageBytes) {
      return { blob, width, height };
    }
    if (!blob) throw new Error('The browser could not encode this screen frame.');
    const nextScale = Math.min(.82, Math.sqrt(maxVisionImageBytes / blob.size) * .9);
    width = Math.max(1, Math.floor(width * nextScale));
    height = Math.max(1, Math.floor(height * nextScale));
  }
  throw new Error('Could not compress this screen frame below 500 KB.');
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result), { once: true });
    reader.addEventListener('error', () => reject(new Error('The screen frame could not be prepared for sending.')), { once: true });
    reader.readAsDataURL(blob);
  });
}

async function captureScreenFrame() {
  const video = elements.capturePreview;
  if (!state.displayStream || !video.videoWidth || !video.videoHeight || state.visionFrame) {
    elements.captureStatus.textContent = 'No active screen stream is available.';
    return;
  }
  elements.captureFrameButton.disabled = true;
  elements.captureStatus.textContent = 'Preparing one local preview. It will not be sent until you choose Send.';
  try {
    const frame = await createVisionFrame(video, elements.captureCanvas);
    state.visionFrame = frame.blob;
    state.captureObjectUrl = URL.createObjectURL(frame.blob);
    elements.captureFramePreview.src = state.captureObjectUrl;
    elements.captureFramePreview.hidden = false;
    elements.downloadCapture.href = state.captureObjectUrl;
    elements.downloadCapture.hidden = false;
    elements.visionQuestion.disabled = false;
    stopScreenCapture();
    elements.captureFrameButton.disabled = true;
    elements.captureStatus.textContent = `Local preview ready: ${frame.width} × ${frame.height}, ${Math.ceil(frame.blob.size / 1024)} KB. Nothing has been sent.`;
    elements.visionQuestion.focus();
    logActivity('One screen frame captured locally');
    updateVisionSendButton();
  } catch (error) {
    elements.captureStatus.textContent = error.message;
    elements.captureFrameButton.disabled = !state.displayStream;
  }
}

async function sendVisionFrame() {
  if (!state.preferences.fullAccessEnabled) {
    emergencyStopVision();
    return;
  }
  if (!state.visionFrame || state.visionSending) return;
  const question = elements.visionQuestion.value.trim();
  if (!question || question.length > 500) {
    elements.captureStatus.textContent = 'Enter a question of 1 to 500 characters before sending this frame.';
    return;
  }

  state.visionSending = true;
  const requestSequence = state.visionCaptureSequence;
  const controller = new AbortController();
  state.visionAbortController = controller;
  const timeoutId = window.setTimeout(() => controller.abort(), 50_000);
  updateVisionSendButton();
  elements.captureStatus.textContent = 'Sending this one frame to J.A.R.V.I.S. for analysis...';
  try {
    const image = await readBlobAsDataUrl(state.visionFrame);
    const response = await fetch('/api/vision', {
      method: 'POST',
      headers: apiHeaders(true),
      body: JSON.stringify({ question, image }),
      signal: controller.signal,
    });
    const data = await readApiResponse(response);
    addMessage({ role: 'user', content: `[Screen Vision] ${question}` });
    addMessage({ role: 'assistant', content: data.reply });
    logActivity('One screen frame analyzed by J.A.R.V.I.S.');
    elements.captureStatus.textContent = `Analysis complete via ${data.provider}.`;
    elements.screenCaptureDialog.close();
  } catch (error) {
    if (elements.screenCaptureDialog.open && requestSequence === state.visionCaptureSequence) {
      clearVisionFrame();
      elements.captureFrameButton.disabled = false;
      elements.captureFrameButton.textContent = 'Choose screen again';
      elements.captureStatus.textContent = getRequestErrorMessage(error, 'Vision request');
    }
  } finally {
    window.clearTimeout(timeoutId);
    if (state.visionAbortController === controller) state.visionAbortController = null;
    state.visionSending = false;
    updateVisionSendButton();
  }
}

function handleNavigation(event) {
  const button = event.target.closest('[data-nav]');
  if (!button) return;
  if (event.currentTarget === elements.moreNavigationDialog && elements.moreNavigationDialog.open) {
    elements.moreNavigationDialog.close();
  }
  const destination = button.dataset.nav;
  if (destination === 'lab') {
    openJarvisLab();
  } else if (destination === 'dashboard') {
    setWorkspaceView('dashboard');
  } else if (destination === 'chat') {
    if (state.workspaceView === 'dashboard' && elements.labLayout.hidden) {
      elements.dashboardMessage.focus();
      elements.dashboardChatPanel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      setWorkspaceView('chat');
      elements.message.focus();
    }
  } else if (destination === 'voice') {
    if (state.workspaceView !== 'dashboard' || !elements.labLayout.hidden) setWorkspaceView('chat');
    startListeningFromUserGesture();
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
    selectNavigation('news');
    document.querySelector('.briefing-panel').open = true;
    if (matchMedia('(max-width: 780px)').matches) document.body.classList.add('mobile-news-open');
    if (!elements.briefingResults.childElementCount) loadBriefing();
    document.querySelector('#briefing-title').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else if (destination === 'settings') {
    selectNavigation(destination);
    openSettings();
  } else if (destination === 'activity') {
    setWorkspaceView('dashboard');
    selectNavigation(destination);
    document.querySelector('#activity-panel').open = true;
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
    startListeningFromUserGesture();
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
    const results = Array.isArray(data.results) ? data.results.slice(0, 3) : [];
    elements.briefingResults.replaceChildren();
    if (!results.length) {
      const notice = document.createElement('p');
      notice.textContent = data.notice || 'No source-backed headlines were returned.';
      elements.briefingResults.append(notice);
    }
    for (const result of results) {
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
    logActivity(`Briefing retrieved: ${results.length} source${results.length === 1 ? '' : 's'}`);
  } catch (error) {
    elements.briefingResults.replaceChildren();
    const notice = document.createElement('p');
    notice.textContent = getRequestErrorMessage(error, 'news briefing');
    elements.briefingResults.append(notice);
    logActivity('Briefing unavailable');
  } finally {
    elements.briefingButton.disabled = false;
  }
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

async function copyTextToClipboard(text) {
  if (window.jarvisDesktop?.copyText) {
    try {
      if (await window.jarvisDesktop.copyText(text)) return true;
    } catch {
      // Fall back to the browser clipboard APIs.
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Try the browser's legacy clipboard API below.
    }
  }
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) return false;
  return true;
}

async function copyPublicLink() {
  if (!publicShareUrl) return;
  if (!await copyTextToClipboard(publicShareUrl)) {
    throw new Error('Clipboard access was denied. Copy the HTTPS address from the browser address bar instead.');
  }
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
document.querySelector('#lab-return-button').addEventListener('click', returnToJarvisWorkspace);
document.querySelector('[data-lab-module="personalize"]').addEventListener('click', openPersonalizePanel);
document.querySelector('[data-lab-module="personalize"]').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  openPersonalizePanel();
});
document.querySelector('[data-lab-module="ai-modify"]').addEventListener('click', openLabAiModifyPanel);
document.querySelector('[data-lab-module="ai-modify"]').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  openLabAiModifyPanel();
});
document.querySelector('[data-lab-module="code-studio"]').addEventListener('click', openCodeStudioPanel);
document.querySelector('[data-lab-module="code-studio"]').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  openCodeStudioPanel();
});
document.querySelector('[data-lab-module="extensions"]').addEventListener('click', openExtensionsPanel);
document.querySelector('[data-lab-module="extensions"]').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  openExtensionsPanel();
});
document.querySelector('#ai-modify-analyze').addEventListener('click', submitLabAiModifyRequest);
document.querySelector('#ai-modify-back').addEventListener('click', closeLabAiModifyPanel);
document.querySelector('#ai-modify-cancel').addEventListener('click', cancelLabAiModifyRequest);
document.querySelector('#ai-modify-reject').addEventListener('click', rejectLabAiModifyRequest);
document.querySelector('#code-studio-back').addEventListener('click', closeCodeStudioPanel);
elements.codeStudioEditor.addEventListener('input', updateCodeStudioReview);
elements.codeStudioLanguage.addEventListener('change', () => {
  const language = CODE_STUDIO_LANGUAGES.find(({ id }) => id === elements.codeStudioLanguage.value);
  elements.codeStudioStatus.textContent = `${language?.label || 'Plain text'} selected. Syntax highlighting is unavailable; content remains plain text and is never executed.`;
});
elements.codeStudioReadonly.addEventListener('change', updateCodeStudioEditorState);
document.querySelector('#code-studio-import').addEventListener('click', prepareCodeStudioImport);
elements.codeStudioFile.addEventListener('change', importCodeStudioFile);
document.querySelector('#code-studio-copy').addEventListener('click', copyCodeStudioText);
document.querySelector('#code-studio-clear').addEventListener('click', clearCodeStudioText);
document.querySelector('#code-studio-export').addEventListener('click', exportCodeStudioText);
document.querySelector('#extensions-back').addEventListener('click', closeExtensionsPanel);
document.querySelector('#extensions-import').addEventListener('click', promptExtensionImport);
elements.extensionsFile.addEventListener('change', importLabExtension);
elements.extensionsList.addEventListener('click', handleLabExtensionAction);
elements.personalizeForm.addEventListener('change', () => {
  personalizeDraft = readPersonalizeForm();
  renderPersonalizePreview(personalizeDraft);
  elements.personalizeStatus.textContent = 'Changes are preview-only until applied.';
});
document.querySelector('#personalize-cancel').addEventListener('click', closePersonalizePanel);
document.querySelector('#personalize-cancel-footer').addEventListener('click', closePersonalizePanel);
document.querySelector('#personalize-reset').addEventListener('click', resetPersonalizeDraft);
document.querySelector('#personalize-apply').addEventListener('click', applyPersonalizeDraft);
document.querySelector('#more-tools-button').addEventListener('click', () => {
  elements.settings.close();
  elements.moreNavigationDialog.showModal();
});
document.querySelectorAll('.primary-nav, .mobile-nav, .feature-toolbar, .right-rail').forEach((nav) => nav.addEventListener('click', handleNavigation));
document.querySelector('.new-feature-bar').addEventListener('click', handleDashboardFeature);
document.querySelector('.avatar-hero').addEventListener('click', handleDashboardFeature);
elements.briefingButton.addEventListener('click', loadBriefing);
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
    localStorage.removeItem(LAB_PREFERENCES_KEY);
    localStorage.removeItem(LAB_AI_MODIFY_HISTORY_KEY);
  } catch {
    storageCleared = false;
  }
  state.preferences = { ...defaults };
  state.labPreferences = resetLabPreferencesDraft();
  applyLabPreferences(state.labPreferences, document);
  syncSettings();
  showFeedback(storageCleared
    ? 'Saved data cleared from this browser.'
    : 'Active settings were reset, but the browser could not confirm that all saved data was cleared.');
});
elements.dashboardCommandForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.submitter === elements.dashboardSend) primeVoiceOutput();
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
    primeVoiceOutput();
    elements.dashboardCommandForm.requestSubmit();
  }
});
elements.fileSearchQuery.addEventListener('input', searchAttachedFiles);
document.querySelector('#history-open-chat').addEventListener('click', () => {
  elements.historyDialog.close();
  setWorkspaceView('chat');
  elements.message.focus();
});
document.querySelectorAll('[data-quick-action="capture"]').forEach((button) => button.addEventListener('click', () => {
  openVisionDialog();
}));
elements.captureFrameButton.addEventListener('click', () => {
  if (state.displayStream) {
    captureScreenFrame();
    return;
  }
  if (!state.preferences.fullAccessEnabled) return;
  const captureSequence = ++state.visionCaptureSequence;
  startScreenCapture(captureSequence);
});
elements.visionQuestion.addEventListener('input', updateVisionSendButton);
elements.visionSendButton.addEventListener('click', sendVisionFrame);
elements.stopCaptureButton.addEventListener('click', emergencyStopVision);
elements.screenCaptureDialog.addEventListener('close', () => {
  state.visionCaptureSequence += 1;
  if (state.displayStream) stopScreenCapture();
  elements.stopCaptureButton.disabled = true;
  state.visionAbortController?.abort();
  clearVisionFrame();
  elements.captureStatus.textContent = '';
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
    primeVoiceOutput();
    elements.form.requestSubmit();
  }
});
elements.searchToggle.addEventListener('click', () => {
  state.searchMode = !state.searchMode;
  updateSearchMode();
  elements.message.focus();
});
elements.mic.addEventListener('click', startListeningFromUserGesture);
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
    startListeningFromUserGesture();
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
  updateVoiceList();
  savePreferences();
  if (state.recognitionWakeSession) requestStopListening();
});
elements.accessToken.addEventListener('input', () => {
  state.accessToken = elements.accessToken.value.trim();
});
elements.aiProvider.addEventListener('change', () => {
  elements.aiModel.value = elements.aiProvider.value === 'ollama' ? 'qwen2.5:3b' : 'gemini-3.5-flash-lite';
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
  if (!state.preferences.voiceEnabled && 'speechSynthesis' in window) {
    stopSpeechOutput();
  }
  else primeVoiceOutput();
  savePreferences();
});
elements.wakeWordEnabled.addEventListener('change', () => {
  state.preferences.wakeWordEnabled = elements.wakeWordEnabled.checked;
  state.wakeWordResumePending = false;
  if (state.preferences.wakeWordEnabled && wakeWordRecoveryPolicy.circuitOpen) {
    state.wakeWordManualRetryPending = true;
  } else if (!state.preferences.wakeWordEnabled) {
    state.wakeWordManualRetryPending = false;
  }
  window.clearTimeout(state.wakeWordRestartTimer);
  state.wakeWordRestartTimer = null;
  savePreferences();
  reportWakeWordStatus('permission-updated');
  if (state.preferences.wakeWordEnabled) {
    state.wakeWordManualTakeoverPending = false;
    startListening('wake');
    primeVoiceOutput();
  } else {
    if (state.recognitionWakeSession) requestStopListening();
    showFeedback('Wake-word detection is off.');
  }
});
elements.dashboardMicButton.addEventListener('click', () => {
  startListeningFromUserGesture();
});
elements.dashboardVoiceMicButton.addEventListener('click', () => {
  startListeningFromUserGesture();
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
const resumeVoiceForPageLifecycle = () => {
  const focused = pageIsFocused();
  if (!isPageForeground(document.visibilityState, focused)) {
    pauseVoiceForPageLifecycle();
    return;
  }
  state.wakeWordPagePaused = false;
  if (shouldRunWakeWord(state.preferences.wakeWordEnabled, document.visibilityState, state.wakeWordPagePaused, state.microphonePermission, focused)) {
    state.wakeWordResumePending = true;
    resumeWakeWordDetection();
  }
};
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    pauseVoiceForPageLifecycle();
  } else resumeVoiceForPageLifecycle();
});
window.addEventListener('blur', pauseVoiceForPageLifecycle);
window.addEventListener('focus', resumeVoiceForPageLifecycle);
window.addEventListener('pagehide', pauseVoiceForPageLifecycle);
window.addEventListener('pageshow', resumeVoiceForPageLifecycle);
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
applyLabPreferences(state.labPreferences, document);
syncSettings();
reportWakeWordStatus('startup');
if (state.preferences.wakeWordEnabled && !elements.wakeWordEnabled.disabled) startListening('wake');
renderMessages();
initializeAppHubs({
  onActivity: logActivity,
  onOpenVision: openVisionDialog,
  canLaunchIntent: () => state.preferences.fullAccessEnabled,
  openDesktopExternal: window.jarvisDesktop?.openExternalUrl.bind(window.jarvisDesktop),
  copyUserText: copyTextToClipboard,
});
updateSearchMode();
setWorkspaceView(state.workspaceView, { remember: false });
initializeDeviceMonitor();
window.setInterval(loadSystemMetrics, 30_000);
checkServer();
logActivity('Interface initialized');
updateInstallButton();

if ('speechSynthesis' in window) window.speechSynthesis.addEventListener('voiceschanged', updateVoiceList);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('/service-worker.js?hud=49', { updateViaCache: 'none' }).then((registration) => {
    registration.update().catch(() => {});
  }).catch(() => {});
}

window.dispatchEvent(new Event('jarvis:app-ready'));