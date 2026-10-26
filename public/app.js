const HISTORY_KEY = 'jarvis.history.v1';
const PREFERENCES_KEY = 'jarvis.preferences.v1';
const INTERFACE_MODE_KEY = 'jarvis.interface.mode.v4';
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
  dashboardLayout: document.querySelector('#dashboard-layout'),
  conversationView: document.querySelector('#conversation-view'),
  assistantState: document.querySelector('#assistant-state'),
  presenceTitle: document.querySelector('#presence-title'),
  providerNote: document.querySelector('#provider-note'),
  connection: document.querySelector('#connection-status'),
  settings: document.querySelector('#settings-dialog'),
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
  memoryValue: document.querySelector('#memory-value'),
  modelValue: document.querySelector('#model-value'),
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
  leftMicStatus: document.querySelector('#left-mic-status'),
  leftModeStatus: document.querySelector('#left-mode-status'),
  leftLanguageStatus: document.querySelector('#left-language-status'),
  studyIndicator: document.querySelector('#study-mode-indicator'),
  studyQuickIndicator: document.querySelector('#study-quick-indicator'),
  cpuValue: document.querySelector('#cpu-value'),
  ramValue: document.querySelector('#ram-value'),
  diskValue: document.querySelector('#disk-value'),
  monitorContext: document.querySelector('#monitor-context'),
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
  voiceMotionTimer: null,
  voiceMotionInterval: null,
  workspaceView: 'dashboard',
  displayStream: null,
  focusRemaining: 25 * 60,
  focusTimerId: null,
  captureObjectUrl: null,
};

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
  elements.stage.classList.remove('is-listening', 'is-speaking', 'is-thinking');
  if (mode) elements.stage.classList.add(`is-${mode}`);
  elements.assistantState.textContent = label;
  elements.presenceTitle.textContent = mode === 'listening' ? "I'm listening." : mode === 'thinking' ? 'One moment.' : mode === 'speaking' ? 'Speaking.' : 'At your service.';
  elements.voiceConsoleStatus.textContent = label;
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
  elements.transcript.replaceChildren();
  if (!state.messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const title = document.createElement('strong');
    title.textContent = 'Your session begins here.';
    const description = document.createElement('span');
    description.textContent = 'Ask a question, start a voice conversation, or search for a source-backed answer.';
    empty.append(title, description);
    elements.transcript.append(empty);
    return;
  }

  for (const message of state.messages) elements.transcript.append(messageElement(message));
  elements.transcript.scrollTop = elements.transcript.scrollHeight;
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

function apiHeaders(json = false) {
  const headers = {};
  if (json) headers['content-type'] = 'application/json';
  if (state.accessToken) headers.authorization = `Bearer ${state.accessToken}`;
  return headers;
}

async function sendChat(text) {
  const context = state.messages
    .filter((message) => !message.kind && ['user', 'assistant'].includes(message.role))
    .slice(-20)
    .map(({ role, content }) => ({ role, content }));
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
    addMessage({ role: 'assistant', content: data.reply });
    elements.providerNote.textContent = `Connected through ${data.provider}. Search results are retrieved separately and linked to their sources.`;
    elements.modelValue.textContent = data.provider;
    elements.leftAiStatus.textContent = 'AI RESPONDED';
    elements.leftAiDetail.textContent = `Most recent successful reply came from ${data.provider}.`;
    logActivity('Assistant reply received');
    if (state.preferences.voiceEnabled) speak(data.reply);
  } catch (error) {
    addMessage({ role: 'assistant', content: error.message });
    elements.leftAiStatus.textContent = 'REQUEST FAILED';
    elements.leftAiDetail.textContent = error.message;
    logActivity('Chat request unavailable');
    setAssistantState('', 'SYSTEM STANDBY');
  } finally {
    state.pending = false;
    elements.send.disabled = false;
    if (!state.preferences.voiceEnabled || !('speechSynthesis' in window)) setAssistantState('', 'SYSTEM STANDBY');
  }
}

async function searchWeb(query) {
  setAssistantState('thinking', 'SEARCHING THE WEB');
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { headers: apiHeaders(), signal: AbortSignal.timeout(10_000) });
    const data = await readApiResponse(response);
    state.accessRequired = data.accessRequired === true;
    addMessage({ role: 'assistant', content: '', kind: 'search', data });
    elements.providerNote.textContent = `Retrieved results from ${data.source}. Results are shown as retrieved; no AI summary is implied.`;
    logActivity(`Web lookup: ${data.results.length} result${data.results.length === 1 ? '' : 's'}`);
  } catch (error) {
    addMessage({ role: 'assistant', content: error.message });
  } finally {
    state.pending = false;
    elements.send.disabled = false;
    setAssistantState('', 'SYSTEM STANDBY');
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
  window.speechSynthesis.cancel();
  clearTimeout(state.voiceMotionTimer);
  clearInterval(state.voiceMotionInterval);
  elements.avatar.classList.remove('mouth-speaking');
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = state.preferences.language === 'hi' ? 'hi-IN' : 'en-US';
  utterance.rate = state.preferences.speechRate;
  utterance.voice = selectedVoice();
  utterance.onstart = () => {
    setAssistantState('speaking', 'VOICE OUTPUT');
    state.voiceMotionInterval = window.setInterval(() => pulseAvatarMouth(130), 390);
    logActivity('Voice response started');
  };
  utterance.onboundary = () => pulseAvatarMouth(145);
  utterance.onend = () => {
    stopAvatarMouth();
    setAssistantState('', 'SYSTEM STANDBY');
    logActivity('Voice response complete');
  };
  utterance.onerror = () => {
    stopAvatarMouth();
    setAssistantState('', 'SYSTEM STANDBY');
    showFeedback('Speech output is unavailable for the selected voice on this device.');
  };
  window.speechSynthesis.speak(utterance);
}

function pulseAvatarMouth(duration) {
  clearTimeout(state.voiceMotionTimer);
  elements.avatar.classList.add('mouth-speaking');
  state.voiceMotionTimer = window.setTimeout(() => elements.avatar.classList.remove('mouth-speaking'), duration);
}

function stopAvatarMouth() {
  clearTimeout(state.voiceMotionTimer);
  clearInterval(state.voiceMotionInterval);
  elements.avatar.classList.remove('mouth-speaking');
}

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
    stopListening();
  };
  recognition.onend = stopListening;
  try {
    recognition.start();
  } catch {
    stopListening();
    showFeedback('The microphone could not be started. Check browser permissions and try again.');
  }
}

function stopListening() {
  state.listening = false;
  elements.mic.classList.remove('is-active');
  elements.mic.setAttribute('aria-label', 'Start voice input');
  if (elements.assistantState.textContent === 'LISTENING') setAssistantState('', 'SYSTEM STANDBY');
}

function syncSettings() {
  elements.language.value = state.preferences.language;
  elements.speechRate.value = String(state.preferences.speechRate);
  elements.speechRateValue.textContent = Number(state.preferences.speechRate).toFixed(1);
  elements.voiceEnabled.checked = state.preferences.voiceEnabled;
  elements.memoryEnabled.checked = state.preferences.memoryEnabled;
  elements.leftMemoryStatus.textContent = state.preferences.memoryEnabled ? 'LOCAL' : 'OFF';
  elements.leftMicStatus.textContent = window.SpeechRecognition || window.webkitSpeechRecognition ? 'AVAILABLE' : 'UNSUPPORTED';
  elements.leftLanguageStatus.textContent = state.preferences.language === 'hi' ? 'HINDI' : 'ENGLISH';
  elements.leftModeStatus.textContent = state.preferences.studyMode ? 'STUDY' : 'STANDARD';
  elements.studyIndicator.textContent = state.preferences.studyMode ? 'ON' : 'OFF';
  elements.studyQuickIndicator.textContent = state.preferences.studyMode ? 'ON' : 'OFF';
  elements.dashboardVoiceToggle.setAttribute('aria-pressed', String(state.preferences.voiceEnabled));
  elements.dashboardVoiceLabel.textContent = state.preferences.voiceEnabled ? 'Voice on' : 'Voice off';
  elements.dashboardVoiceToggle.disabled = !('speechSynthesis' in window);
  loadSystemMetrics();
  syncFullAccess();
  updateVoiceList();
}

async function checkServer() {
  elements.networkValue.textContent = navigator.onLine ? 'Online' : 'Offline';
  elements.voiceValue.textContent = window.SpeechRecognition || window.webkitSpeechRecognition ? 'Available' : 'Unsupported';
  elements.memoryValue.textContent = state.preferences.memoryEnabled ? 'Local storage' : 'Disabled';
  loadSystemMetrics();
  if (!navigator.onLine) {
    elements.connection.className = 'connection-indicator is-offline';
    elements.connection.lastElementChild.textContent = 'OFFLINE';
    elements.leftAiStatus.textContent = 'OFFLINE';
    elements.leftAiDetail.textContent = 'The server cannot be reached while this device is offline.';
    elements.leftSessionStatus.textContent = 'OFFLINE';
    return;
  }
  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(5_000) });
    const data = await readApiResponse(response);
    state.accessRequired = data.accessRequired === true;
    const ollamaSelected = data.ollamaAvailable !== null;
    const aiReady = data.aiConfigured && (!ollamaSelected || data.aiAvailable);
    elements.connection.className = aiReady ? 'connection-indicator' : 'connection-indicator is-warning';
    elements.connection.lastElementChild.textContent = aiReady
      ? ollamaSelected ? 'OLLAMA READY' : 'AI CONFIGURED'
      : ollamaSelected && !data.ollamaAvailable ? 'OLLAMA OFFLINE'
        : ollamaSelected ? 'MODEL MISSING' : 'NO AI MODEL';
    elements.providerNote.textContent = !data.aiConfigured
      ? 'No AI provider configured. Set OLLAMA_BASE_URL for local Ollama, or AI_API_KEY and AI_MODEL on the server.'
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
    elements.leftAiDetail.textContent = ollamaSelected
      ? data.aiAvailable ? `${data.model} is available on this server.` : data.ollamaAvailable ? `${data.model} is not installed.` : 'Ollama is not reachable from this server.'
      : data.aiConfigured ? 'Provider is configured. Availability is confirmed when you send a message.' : 'Set up Ollama or configure a server-side AI provider.';
    elements.leftSessionStatus.textContent = 'CONNECTED';
    elements.leftMemoryStatus.textContent = state.preferences.memoryEnabled ? 'LOCAL' : 'OFF';
    elements.footerStatus.textContent = aiReady ? 'SERVER AI · LOCAL HISTORY · PERMISSION-BOUND' : 'AI UNAVAILABLE · LOCAL HISTORY · PERMISSION-BOUND';
  } catch {
    elements.connection.className = 'connection-indicator is-offline';
    elements.connection.lastElementChild.textContent = 'SERVER OFFLINE';
    elements.providerNote.textContent = 'The app server is not responding. Chat and web search require a connection to this server.';
    elements.modelValue.textContent = 'Unavailable';
    elements.leftAiStatus.textContent = 'UNAVAILABLE';
    elements.leftAiDetail.textContent = 'The J.A.R.V.I.S. server did not respond.';
    elements.leftSessionStatus.textContent = 'OFFLINE';
  }
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return 'Unavailable';
  const units = ['B', 'KB', 'GB', 'TB'];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function loadSystemMetrics() {
  try {
    const response = await fetch('/api/system', { headers: apiHeaders(), signal: AbortSignal.timeout(4_000) });
    const metrics = await readApiResponse(response);
    elements.cpuValue.textContent = `${metrics.cpuLoad1mPercent}% / ${metrics.cpuCount} cores`;
    elements.ramValue.textContent = `${formatBytes(metrics.memoryUsedBytes)} / ${formatBytes(metrics.memoryTotalBytes)} (${metrics.memoryPercent}%)`;
    elements.diskValue.textContent = `${formatBytes(metrics.diskUsedBytes)} / ${formatBytes(metrics.diskTotalBytes)} (${metrics.diskPercent}%)`;
    elements.monitorContext.textContent = `Live ${metrics.source} metrics · ${new Date(metrics.measuredAt).toLocaleTimeString()}`;
  } catch {
    elements.cpuValue.textContent = 'Unavailable';
    elements.ramValue.textContent = 'Unavailable';
    elements.diskValue.textContent = 'Unavailable';
    elements.monitorContext.textContent = 'Server metrics unavailable. These readings describe the server container, not your physical device.';
  }
}

function openSettings() {
  if (!elements.settings.open) elements.settings.showModal();
}

function selectNavigation(destination) {
  document.querySelectorAll('[data-nav]').forEach((item) => item.classList.toggle('is-current', item.dataset.nav === destination));
}

function setWorkspaceView(view) {
  state.workspaceView = view;
  elements.dashboardLayout.hidden = view !== 'dashboard';
  elements.conversationView.hidden = view !== 'chat';
  document.body.classList.toggle('chat-view', view === 'chat');
  document.body.classList.remove('mobile-system-open', 'mobile-news-open', 'mobile-activity-open');
  selectNavigation(view);
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
    setWorkspaceView('chat');
    elements.message.focus();
  } else if (destination === 'voice') {
    setWorkspaceView('chat');
    startListening();
  } else if (destination === 'more') {
    elements.moreNavigationDialog.showModal();
  } else if (destination === 'history') {
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

async function loadBriefing() {
  elements.briefingButton.disabled = true;
  elements.briefingResults.replaceChildren();
  const status = document.createElement('p');
  status.textContent = 'Retrieving available instant answers...';
  elements.briefingResults.append(status);
  try {
    const response = await fetch('/api/search?q=latest%20technology%20news', {
      headers: apiHeaders(),
      signal: AbortSignal.timeout(10_000),
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
document.querySelectorAll('.primary-nav, .mobile-nav').forEach((nav) => nav.addEventListener('click', handleNavigation));
elements.moreNavigationDialog.addEventListener('click', handleNavigation);
document.querySelector('#clear-button').addEventListener('click', () => {
  state.messages = [];
  renderMessages();
  try { localStorage.removeItem(HISTORY_KEY); } catch { showFeedback('Saved history could not be cleared in this browser.'); }
});
document.querySelector('#settings-clear').addEventListener('click', () => {
  if (!window.confirm('Clear saved conversation history and preferences from this browser?')) return;
  state.messages = [];
  renderMessages();
  try {
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(PREFERENCES_KEY);
  } catch {
    showFeedback('Browser storage could not be cleared.');
  }
  state.preferences = { ...defaults };
  syncSettings();
  savePreferences();
  showFeedback('Saved data cleared from this browser.');
});
elements.dashboardCommandForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = elements.dashboardMessage.value.trim();
  if (!text) return;
  setWorkspaceView('chat');
  elements.message.value = text;
  elements.dashboardMessage.value = '';
  elements.form.requestSubmit();
});
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
    setWorkspaceView('chat');
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
document.querySelector('#interface-toggle').addEventListener('click', (event) => {
  const classic = document.body.classList.toggle('classic-mode');
  event.currentTarget.textContent = classic ? 'New UI' : 'Old UI';
  event.currentTarget.setAttribute('aria-pressed', String(classic));
  try { localStorage.setItem(INTERFACE_MODE_KEY, classic ? 'old' : 'new'); } catch {}
});
elements.language.addEventListener('change', () => {
  state.preferences.language = elements.language.value;
  elements.leftLanguageStatus.textContent = state.preferences.language === 'hi' ? 'HINDI' : 'ENGLISH';
  savePreferences();
});
elements.accessToken.addEventListener('input', () => {
  state.accessToken = elements.accessToken.value.trim();
});
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
  if (!state.preferences.voiceEnabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  savePreferences();
});
elements.dashboardMicButton.addEventListener('click', () => {
  setWorkspaceView('chat');
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
  elements.install.hidden = isInstalledApp();
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
setWorkspaceView('dashboard');
try {
  const classic = localStorage.getItem(INTERFACE_MODE_KEY) === 'old';
  document.body.classList.toggle('classic-mode', classic);
  document.querySelector('#interface-toggle').textContent = classic ? 'New UI' : 'Old UI';
  document.querySelector('#interface-toggle').setAttribute('aria-pressed', String(classic));
} catch {}
updateClock();
window.setInterval(updateClock, 30_000);
window.setInterval(loadSystemMetrics, 30_000);
checkServer();
logActivity('Interface initialized');
updateInstallButton();

if ('speechSynthesis' in window) window.speechSynthesis.addEventListener('voiceschanged', updateVoiceList);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('/service-worker.js?hud=10', { updateViaCache: 'none' }).then((registration) => {
    registration.update().catch(() => {});
  }).catch(() => {});
}