export function readSpeechRecognitionResult(event) {
  const results = event?.results || [];
  let transcript = '';
  for (let index = 0; index < results.length; index += 1) {
    transcript += results[index][0]?.transcript || '';
  }

  const firstChangedResult = Number.isInteger(event?.resultIndex)
    ? Math.min(event.resultIndex, results.length)
    : 0;
  let finalResult = firstChangedResult < results.length;
  for (let index = firstChangedResult; index < results.length; index += 1) {
    finalResult &&= Boolean(results[index].isFinal);
  }

  return { transcript: transcript.trim(), finalResult };
}

export function readSpeechRecognitionAlternatives(event) {
  const results = event?.results || [];
  const alternativeCount = Math.max(0, ...Array.from(results, (result) => result?.length || 0));
  const alternatives = [];

  for (let alternativeIndex = 0; alternativeIndex < alternativeCount; alternativeIndex += 1) {
    const parts = Array.from(results, (result) => (
      result?.[alternativeIndex]?.transcript || result?.[0]?.transcript || ''
    ));
    for (const transcript of [parts.join(''), parts.join(' ')]) {
      const normalizedTranscript = transcript.trim().replace(/\s+/gu, ' ');
      if (normalizedTranscript && !alternatives.includes(normalizedTranscript)) alternatives.push(normalizedTranscript);
    }
  }
  return alternatives;
}

export function getSpeechRecognitionConstructor(browserWindow) {
  return browserWindow?.SpeechRecognition || browserWindow?.webkitSpeechRecognition || null;
}

export function getSpeechRecognitionLanguage(language) {
  return language === 'hi' ? 'hi-IN' : 'en-US';
}

export function resolveVoiceOutputEnabled(savedPreference, speechSynthesisSupported) {
  if (!speechSynthesisSupported) return false;
  return typeof savedPreference === 'boolean' ? savedPreference : true;
}

export function primeSpeechSynthesis(synthesis, UtteranceConstructor, language) {
  if (typeof synthesis?.speak !== 'function' || typeof UtteranceConstructor !== 'function') return false;
  try {
    const utterance = new UtteranceConstructor(' ');
    utterance.lang = getSpeechRecognitionLanguage(language);
    utterance.volume = 0;
    try { synthesis.resume?.(); } catch {}
    synthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

export function monitorSpeechSynthesisStart(synthesis, {
  onTimeout,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  interval = 1_000,
  timeout = 20_000,
} = {}) {
  let elapsed = 0;
  let timer = null;
  let stopped = false;

  const check = () => {
    if (stopped) return;
    elapsed += interval;
    if (elapsed >= timeout) {
      stopped = true;
      onTimeout?.();
      return;
    }
    try {
      synthesis.resume?.();
    } catch {}
    timer = setTimer(check, interval);
  };

  timer = setTimer(check, interval);
  return () => {
    stopped = true;
    if (timer !== null) clearTimer(timer);
  };
}

export function createSpeechReplayController(onChange = () => {}) {
  const statuses = new WeakMap();

  const update = (message, status, expectedStatuses) => {
    if (!expectedStatuses.includes(statuses.get(message))) return false;
    statuses.set(message, status);
    onChange(message, status);
    return true;
  };

  return {
    track(message) {
      statuses.set(message, 'pending');
    },
    getStatus(message) {
      return statuses.get(message) || 'untracked';
    },
    beginReplay(message) {
      return update(message, 'replaying', ['available']);
    },
    markStarted(message) {
      return update(message, 'spoken', ['pending', 'replaying']);
    },
    markNotStarted(message) {
      return update(message, 'available', ['pending', 'replaying']);
    },
  };
}

export function getSpeechSynthesisErrorMessage(error) {
  const messages = {
    'not-allowed': 'Speech was blocked by the browser. Tap Preview voice in Settings, then send another message.',
    'voice-unavailable': 'The selected speech voice is unavailable. Choose System default or install a voice for this language in device settings.',
    'language-not-supported': 'No speech voice supports the selected language. Install an English or Hindi voice in device text-to-speech settings.',
    'synthesis-failed': 'Speech synthesis failed. Check that device text-to-speech is enabled, then try Preview voice in Settings.',
    timeout: 'Speech output did not start. Check device text-to-speech settings, then try Preview voice in Settings.',
    network: 'The device speech service could not be reached. Check the connection and text-to-speech settings.',
    canceled: 'Speech playback was canceled before it finished. Try Preview voice, then retry.',
    interrupted: 'Speech playback was interrupted before it finished. Try Preview voice, then retry.',
  };

  return messages[error] || 'Speech output could not start on this device. Try Preview voice in Settings.';
}

export function matchWakeWord(transcript) {
  const text = String(transcript || '').normalize('NFC');
  const match = /(?:^|[\s,!?।])(?:hey[\s,!?।.-]+j[\s.]*a[\s.]*r[\s.]*v[\s.]*i[\s.]*s|हे[\s,!?।.:;-]+ज[\s‌‍]*ा[\s‌‍]*र्?[\s‌‍]*व[\s‌‍]*ि[\s‌‍]*स)(?=\s|[,.:;!?।]|$)/iu.exec(text);
  if (!match) return { matched: false, command: '' };

  let command = text.slice(match.index + match[0].length).replace(/^[\s,.:;!?-]+/u, '');
  const repeatedWakeWord = /^[\s,.:;!?-]*(?:hey[\s,!?।.-]+j[\s.]*a[\s.]*r[\s.]*v[\s.]*i[\s.]*s|हे[\s,!?।.:;-]+ज[\s‌‍]*ा[\s‌‍]*र्?[\s‌‍]*व[\s‌‍]*ि[\s‌‍]*स)(?=$|[\s,.:;!?-])/iu;
  while (repeatedWakeWord.test(command)) {
    command = command.replace(repeatedWakeWord, '').replace(/^[\s,.:;!?-]+/u, '');
  }
  return { matched: true, command };
}

export function readWakeWordCommand(transcript, alreadyTriggered = false, previousCommand = '') {
  const match = matchWakeWord(transcript);
  if (match.matched) {
    return {
      triggered: true,
      activated: !alreadyTriggered,
      command: match.command || (alreadyTriggered ? previousCommand : ''),
    };
  }
  if (!alreadyTriggered) return { triggered: false, activated: false, command: '' };

  const command = String(transcript || '').trim();
  return {
    triggered: true,
    activated: false,
    command: command || previousCommand,
  };
}

export function nextWakeWordRestartDelay(delay) {
  const currentDelay = Number.isFinite(delay) ? Math.max(600, delay) : 600;
  return Math.min(currentDelay * 2, 2_400);
}

export const WAKE_WORD_MAX_RESTART_ATTEMPTS = 5;
export const WAKE_WORD_STABLE_SESSION_DURATION_MS = 30_000;

export function createWakeWordRecoveryPolicy({
  maxAttempts = WAKE_WORD_MAX_RESTART_ATTEMPTS,
  stableDurationMs = WAKE_WORD_STABLE_SESSION_DURATION_MS,
} = {}) {
  let restartAttempts = 0;
  let circuitOpen = false;

  const reset = () => {
    restartAttempts = 0;
    circuitOpen = false;
  };
  const canRetry = () => !circuitOpen && restartAttempts < maxAttempts;

  return {
    get restartAttempts() {
      return restartAttempts;
    },
    get circuitOpen() {
      return circuitOpen;
    },
    canRetry,
    recordRestartAttempt() {
      if (!canRetry()) {
        circuitOpen = true;
        return null;
      }
      restartAttempts += 1;
      return restartAttempts;
    },
    openCircuit() {
      circuitOpen = true;
    },
    resetForManualRetry() {
      reset();
    },
    recordSpeechResult() {
      reset();
    },
    recordSessionDuration(durationMs) {
      if (!Number.isFinite(durationMs) || durationMs < stableDurationMs) return false;
      reset();
      return true;
    },
  };
}

export function isPageForeground(visibilityState, focused) {
  return visibilityState !== 'hidden' && focused === true;
}

export function getWakeWordListeningBlockReason(enabled, visibilityState, lifecyclePaused = false, microphonePermission = 'unknown', focused = true) {
  if (enabled !== true) return 'disabled';
  if (microphonePermission === 'denied') return 'permission-denied';
  if (visibilityState === 'hidden') return 'page-hidden';
  if (focused !== true) return 'page-unfocused';
  if (lifecyclePaused === true) return 'page-lifecycle-paused';
  return '';
}

export function shouldPlaySpeech(visibilityState, focused) {
  return isPageForeground(visibilityState, focused);
}

export function shouldRunWakeWord(enabled, visibilityState, lifecyclePaused = false, microphonePermission = 'unknown', focused = true) {
  return !getWakeWordListeningBlockReason(enabled, visibilityState, lifecyclePaused, microphonePermission, focused);
}

export function selectSpeechSynthesisVoice(voices, language, preferredVoiceURI = '') {
  const languageCode = language === 'hi' ? 'hi' : 'en';
  const locale = languageCode === 'hi' ? 'hi-IN' : 'en-US';
  const normalizedLanguage = (voice) => String(voice.lang || '').replace('_', '-').toLowerCase();
  const compatibleVoices = voices.filter((voice) => (
    normalizedLanguage(voice) === languageCode || normalizedLanguage(voice).startsWith(`${languageCode}-`)
  ));
  const exactLocaleVoices = compatibleVoices.filter((voice) => normalizedLanguage(voice) === locale.toLowerCase());

  return compatibleVoices.find((voice) => voice.voiceURI === preferredVoiceURI)
    || exactLocaleVoices.find((voice) => voice.default)
    || exactLocaleVoices[0]
    || compatibleVoices.find((voice) => voice.default)
    || compatibleVoices[0]
    || null;
}

export function getSpeechRecognitionErrorMessage(error) {
  const messages = {
    'not-allowed': 'Microphone permission was denied. Allow microphone access in your browser settings to use voice input.',
    'service-not-allowed': 'The browser speech service is unavailable or blocked for this site.',
    'no-speech': 'No speech was detected. Try again when you are ready.',
    'network': 'Browser speech recognition is unavailable over the current network.',
    'audio-capture': 'No microphone is available. Connect or enable a microphone, then try again.',
    'language-not-supported': 'Speech recognition does not support the selected language on this device.',
  };

  if (error === 'aborted') return '';
  return messages[error] || `Voice input stopped: ${error || 'unknown error'}.`;
}

export function isFatalSpeechRecognitionError(error) {
  return ['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(error);
}

export function getSpeechRecognitionStartError(error) {
  if (error?.name === 'NotAllowedError') {
    return {
      permissionDenied: true,
      message: 'Microphone permission was denied. Allow microphone access in your browser settings to use voice input.',
    };
  }
  if (error?.name === 'SecurityError') {
    return {
      permissionDenied: false,
      message: 'Voice input requires a secure HTTPS connection or localhost.',
    };
  }
  return {
    permissionDenied: false,
    message: 'The microphone could not be started. Check browser permissions and try again.',
  };
}

export function createRecognitionLifecycle() {
  let activeRecognition = null;
  let stopping = false;

  return {
    begin(recognition) {
      if (activeRecognition) return false;
      activeRecognition = recognition;
      stopping = false;
      return true;
    },
    isCurrent(recognition) {
      return activeRecognition === recognition;
    },
    isStopping(recognition) {
      return activeRecognition === recognition && stopping;
    },
    requestStop(recognition) {
      if (activeRecognition !== recognition || stopping) return false;
      stopping = true;
      return true;
    },
    finish(recognition) {
      if (activeRecognition !== recognition) return false;
      activeRecognition = null;
      stopping = false;
      return true;
    },
  };
}

export function createMicrophonePermissionGuard() {
  let version = 0;

  return {
    begin() {
      version += 1;
      return version;
    },
    invalidate() {
      version += 1;
      return version;
    },
    isCurrent(requestVersion) {
      return version === requestVersion;
    },
  };
}