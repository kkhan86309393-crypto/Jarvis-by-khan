const diagnosticsPanel = document.querySelector('#runtime-diagnostics');
const diagnosticsOutput = document.querySelector('#runtime-diagnostics-output');
const diagnosticsEnabled = new URLSearchParams(location.search).get('diagnostics') === '1';

if (diagnosticsEnabled && diagnosticsPanel && diagnosticsOutput) {
  const runtimeErrors = [];
  const speechEvents = [];
  const speechEventNames = new Set([
    'AI reply reaches speak()',
    'SpeechRecognition error',
    'SpeechRecognition start requested',
    'SpeechRecognition started',
    'SpeechRecognition start failed',
    'SpeechRecognition results received',
    'SpeechRecognition stop requested',
    'Wake-word match evaluated',
    'Wake-word status',
    'Wake-word listening blocked',
    'Microphone permission status',
    'SpeechRecognition ended',
    'Wake-word automatic restart scheduled',
    'Wake-word automatic restart attempted',
    'Wake-word circuit breaker opened',
    'Wake-word retry cooldown scheduled',
    'Wake-word retry cooldown ended',
    'SpeechRecognition stop failed',
    'TTS utterance skipped',
    'TTS utterance deferred',
    'TTS utterance creation failed',
    'TTS utterance queue failed',
    'TTS utterance queued',
    'TTS utterance onstart',
    'TTS utterance onpause',
    'TTS utterance onresume',
    'TTS utterance onend',
    'TTS utterance onerror',
    'TTS utterance start timeout',
    'TTS silent priming attempted',
    'TTS resume failed',
  ]);
  const recognitionStopReasons = new Set([
    'chat-submit',
    'explicit-stop',
    'final-result-submitted',
    'language-changed',
    'manual-mic-toggle',
    'manual-wake-takeover',
    'microphone-permission-denied',
    'page-lifecycle',
    'start-timeout',
    'tts-deferred',
    'wake-word-disabled',
  ]);
  const wakeWordRestartReasons = new Set([
    'assistant-workflow-complete',
    'recognition-ended-after-activation',
    'recognition-ended-before-activation',
    'recognition-ended',
  ]);
  const wakeWordDiagnosticReasons = new Set([
    'startup',
    'start-attempt',
    'recognition-unavailable',
    'recognition-active',
    'disabled',
    'permission-denied',
    'page-hidden',
    'page-unfocused',
    'page-lifecycle-paused',
    'assistant-busy',
    'speech-output-busy',
    'permissions-api-unavailable',
    'query-failed',
    'permission-updated',
    'setting-changed',
    'retry-limit-reached',
    'cooldown-expired',
    'manual-retry-waiting-for-end',
    'manual-retry',
  ]);
  const ttsDiagnosticReasons = new Set([
    'speech-synthesis-unavailable',
    'voice-output-disabled',
    'empty-text',
    'duplicate-text',
    'page-unfocused',
    'recognition-active',
    'user-gesture',
  ]);
  let appReady = false;
  let serviceWorkerVersion = 'not available';

  function getBrowserDetails(userAgent) {
    const browsers = [
      ['Microsoft Edge', /Edg(?:A|iOS)?\/([\d.]+)/i],
      ['Samsung Internet', /SamsungBrowser\/([\d.]+)/i],
      ['Opera', /(?:OPR|Opera)\/([\d.]+)/i],
      ['Chrome', /(?:CriOS|Chrome)\/([\d.]+)/i],
      ['Firefox', /(?:FxiOS|Firefox)\/([\d.]+)/i],
      ['Safari', /Version\/([\d.]+).*Safari/i],
    ];
    for (const [name, pattern] of browsers) {
      const version = pattern.exec(userAgent)?.[1];
      if (version) return `${name} ${version}`;
    }
    return 'Browser not identified';
  }

  function getFocusState() {
    try {
      return typeof document.hasFocus === 'function' ? String(document.hasFocus()) : 'unavailable';
    } catch {
      return 'unavailable';
    }
  }

  function getVoices() {
    if (!window.speechSynthesis || typeof window.speechSynthesis.getVoices !== 'function') return [];
    try {
      return window.speechSynthesis.getVoices();
    } catch {
      return [];
    }
  }

  function renderDiagnostics() {
    const dashboard = document.querySelector('#dashboard-layout');
    const style = dashboard ? getComputedStyle(dashboard) : null;
    const bounds = dashboard?.getBoundingClientRect();
    const voices = getVoices();
    const appUrl = `${location.origin}${location.pathname}`;
    const lines = [
      `App startup: ${appReady ? 'ready' : 'not completed'}`,
      `App URL (query and fragment omitted): ${appUrl}`,
      `HTTPS active: ${location.protocol === 'https:' ? 'yes' : 'no'}; secure context: ${window.isSecureContext === true ? 'yes' : 'no'}`,
      `Browser: ${getBrowserDetails(navigator.userAgent || '')}`,
      `User agent: ${navigator.userAgent || 'unavailable'}`,
      `SpeechRecognition: ${typeof window.SpeechRecognition === 'function' ? 'available' : 'not available'}`,
      `webkitSpeechRecognition: ${typeof window.webkitSpeechRecognition === 'function' ? 'available' : 'not available'}`,
      `speechSynthesis: ${Boolean(window.speechSynthesis && typeof window.speechSynthesis.speak === 'function') ? 'available' : 'not available'}`,
      `TTS voices (${voices.length}): ${voices.length
        ? voices.map((voice) => `${voice.name || 'unnamed'} [${voice.lang || 'language unknown'}]`).join('; ')
        : 'none reported yet'}`,
      `Voice Output setting: ${document.querySelector('#voice-enabled')?.checked ? 'enabled' : 'disabled'}`,
      `Document: visibility=${document.visibilityState || 'unavailable'}, focused=${getFocusState()}`,
      `Service-worker cache version: ${serviceWorkerVersion}`,
      `Dashboard: ${dashboard ? 'found' : 'missing'}`,
      dashboard && style
        ? `Dashboard visible: hidden=${dashboard.hidden}, display=${style.display}, visibility=${style.visibility}, opacity=${style.opacity}`
        : 'Dashboard visible: unavailable',
      bounds ? `Dashboard size: ${Math.round(bounds.width)} × ${Math.round(bounds.height)} px` : 'Dashboard size: unavailable',
      `Active interface: ${dashboard && !dashboard.hidden ? 'new' : 'old'}`,
      `Service worker: ${navigator.serviceWorker?.controller ? 'controlling page' : 'not controlling page'}`,
      `JavaScript errors: ${runtimeErrors.length ? runtimeErrors.join(' | ') : 'none captured'}`,
      'Speech event log (latest first; speech text is not recorded):',
      ...(speechEvents.length ? speechEvents.slice().reverse() : ['none captured']),
    ];
    diagnosticsOutput.textContent = lines.join('\n');
  }

  function recordError(message) {
    runtimeErrors.push(`${new Date().toISOString()} ${message}`);
    if (runtimeErrors.length > 5) runtimeErrors.shift();
    renderDiagnostics();
  }

  function requestServiceWorkerVersion(worker) {
    if (!worker || typeof MessageChannel !== 'function') {
      serviceWorkerVersion = worker ? 'MessageChannel unavailable' : 'no active worker';
      renderDiagnostics();
      return;
    }
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      serviceWorkerVersion = 'worker did not respond';
      renderDiagnostics();
    }, 2_000);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      serviceWorkerVersion = typeof event.data?.cacheVersion === 'string'
        ? event.data.cacheVersion
        : 'worker returned no version';
      renderDiagnostics();
    };
    try {
      worker.postMessage({ type: 'JARVIS_DIAGNOSTICS' }, [channel.port2]);
    } catch {
      window.clearTimeout(timeout);
      channel.port1.close();
      serviceWorkerVersion = 'version request failed';
      renderDiagnostics();
    }
  }

  function queryServiceWorkerVersion() {
    if (navigator.serviceWorker?.controller) {
      requestServiceWorkerVersion(navigator.serviceWorker.controller);
      return;
    }
    navigator.serviceWorker?.ready.then((registration) => {
      requestServiceWorkerVersion(registration.active);
    }).catch(() => {
      serviceWorkerVersion = 'no active worker';
      renderDiagnostics();
    });
  }

  function recordSpeechEvent(event) {
    const detail = event.detail || {};
    const timestamp = typeof detail.timestamp === 'string' ? detail.timestamp : new Date().toISOString();
    const fields = [];
    const eventName = speechEventNames.has(detail.event) ? detail.event : 'Speech event';
    if (typeof detail.error === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(detail.error)) fields.push(`error=${detail.error}`);
    if (typeof detail.language === 'string' && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(detail.language)) fields.push(`language=${detail.language}`);
    if (typeof detail.voiceName === 'string' && /^[\p{L}\p{M}\p{N} ._-]{1,60}$/u.test(detail.voiceName)) fields.push(`voiceName=${detail.voiceName}`);
    if (typeof detail.voiceLanguage === 'string' && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(detail.voiceLanguage)) fields.push(`voiceLanguage=${detail.voiceLanguage}`);
    if (['wake', 'wake-command', 'command'].includes(detail.purpose)) fields.push(`purpose=${detail.purpose}`);
    if (['granted', 'prompt', 'denied', 'unknown'].includes(detail.microphonePermission)) fields.push(`microphonePermission=${detail.microphonePermission}`);
    if (['granted', 'prompt', 'denied', 'unknown'].includes(detail.permission)) fields.push(`permission=${detail.permission}`);
    if (['query', 'change'].includes(detail.source)) fields.push(`source=${detail.source}`);
    if (['visible', 'hidden', 'prerender'].includes(detail.visibility)) fields.push(`visibility=${detail.visibility}`);
    if (typeof detail.voiceOutputEnabled === 'boolean') fields.push(`voiceOutputEnabled=${detail.voiceOutputEnabled}`);
    for (const field of ['continuous', 'finalResult', 'matched', 'activated', 'alreadyActivated', 'unexpected', 'wakeWordTriggered', 'enabled', 'focused', 'secureContext', 'speaking', 'pending', 'paused', 'started', 'recognitionActive', 'queued']) {
      if (typeof detail[field] === 'boolean') fields.push(`${field}=${detail[field]}`);
    }
    for (const field of ['maxAlternatives', 'resultCount', 'alternativeCount', 'attempt', 'delayMs', 'durationMs', 'queueDurationMs', 'elapsedMs', 'limit']) {
      if (Number.isSafeInteger(detail[field]) && detail[field] >= 0) fields.push(`${field}=${detail[field]}`);
    }
    if (wakeWordRestartReasons.has(detail.reason)) fields.push(`reason=${detail.reason}`);
    else if (wakeWordDiagnosticReasons.has(detail.reason)) fields.push(`reason=${detail.reason}`);
    else if (recognitionStopReasons.has(detail.reason)) fields.push(`reason=${detail.reason}`);
    else if (ttsDiagnosticReasons.has(detail.reason)) fields.push(`reason=${detail.reason}`);
    speechEvents.push(`${timestamp} ${eventName}${fields.length ? ` (${fields.join(', ')})` : ''}`);
    if (speechEvents.length > 30) speechEvents.shift();
    renderDiagnostics();
  }

  window.addEventListener('error', (event) => {
    recordError(`${event.message || 'Script error'}${event.filename ? ` (${event.filename}:${event.lineno})` : ''}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    recordError(`Unhandled promise rejection: ${reason?.message || String(reason)}`);
  });
  window.addEventListener('jarvis:app-ready', () => {
    appReady = true;
    renderDiagnostics();
  });
  window.addEventListener('jarvis:speech-diagnostic', recordSpeechEvent);
  navigator.serviceWorker?.addEventListener('controllerchange', queryServiceWorkerVersion);
  window.speechSynthesis?.addEventListener?.('voiceschanged', renderDiagnostics);
  document.addEventListener('visibilitychange', renderDiagnostics);
  document.querySelector('#close-runtime-diagnostics')?.addEventListener('click', () => {
    diagnosticsPanel.hidden = true;
  });

  diagnosticsPanel.hidden = false;
  renderDiagnostics();
  queryServiceWorkerVersion();
  window.setInterval(renderDiagnostics, 1_000);
}
