import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const diagnosticsSource = await readFile(new URL('../public/diagnostics.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

function runDiagnostics(search = '?diagnostics=1&token=private', cacheVersion = 'jarvis-shell-v61') {
  const windowListeners = new Map();
  const documentListeners = new Map();
  const output = { textContent: '' };
  const panel = { hidden: true };
  const closeButton = { addEventListener() {} };
  const voiceSetting = { checked: true };
  const dashboard = {
    hidden: false,
    getBoundingClientRect: () => ({ width: 320, height: 480 }),
  };
  const worker = {
    postMessage(_message, ports) {
      ports[0].peer.onmessage({ data: { cacheVersion } });
    },
  };
  const window = {
    isSecureContext: true,
    SpeechRecognition: function SpeechRecognition() {},
    webkitSpeechRecognition: function WebkitSpeechRecognition() {},
    speechSynthesis: {
      speak() {},
      getVoices: () => [
        { name: 'Google US English', lang: 'en-US' },
        { name: 'Google हिन्दी', lang: 'hi-IN' },
      ],
      addEventListener() {},
    },
    addEventListener: (type, listener) => windowListeners.set(type, listener),
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval() {},
  };
  const document = {
    visibilityState: 'visible',
    hasFocus: () => true,
    querySelector(selector) {
      return {
        '#runtime-diagnostics': panel,
        '#runtime-diagnostics-output': output,
        '#close-runtime-diagnostics': closeButton,
        '#voice-enabled': voiceSetting,
        '#dashboard-layout': dashboard,
      }[selector] || null;
    },
    addEventListener: (type, listener) => documentListeners.set(type, listener),
  };
  class MessageChannel {
    constructor() {
      this.port1 = { onmessage: null, close() {} };
      this.port2 = { peer: this.port1 };
    }
  }

  runInNewContext(diagnosticsSource, {
    document,
    window,
    navigator: {
      userAgent: 'Mozilla/5.0 Chrome/124.0.0.0 Mobile Safari/537.36',
      serviceWorker: {
        controller: worker,
        addEventListener() {},
      },
    },
    location: {
      search,
      protocol: 'https:',
      origin: 'https://jarvis.example',
      pathname: '/app',
    },
    getComputedStyle: () => ({ display: 'grid', visibility: 'visible', opacity: '1' }),
    MessageChannel,
    URLSearchParams,
    Date,
    Math,
  });

  return { documentListeners, output, panel, windowListeners };
}

test('diagnostics show browser, speech capabilities, voices, settings, and active worker version', () => {
  const { output, panel } = runDiagnostics();

  assert.equal(panel.hidden, false);
  assert.match(output.textContent, /App URL \(query and fragment omitted\): https:\/\/jarvis\.example\/app/);
  assert.match(output.textContent, /HTTPS active: yes; secure context: yes/);
  assert.match(output.textContent, /Browser: Chrome 124\.0\.0\.0/);
  assert.match(output.textContent, /SpeechRecognition: available/);
  assert.match(output.textContent, /webkitSpeechRecognition: available/);
  assert.match(output.textContent, /speechSynthesis: available/);
  assert.match(output.textContent, /Google US English \[en-US\]/);
  assert.match(output.textContent, /Google हिन्दी \[hi-IN\]/);
  assert.match(output.textContent, /Voice Output setting: enabled/);
  assert.match(output.textContent, /visibility=visible, focused=true/);
  assert.match(output.textContent, /Service-worker cache version: jarvis-shell-v61/);
  assert.doesNotMatch(output.textContent, /token=private|secret|reply text/);
});

test('diagnostics show exact recognition errors and timestamps without recording speech text', () => {
  const { output, windowListeners } = runDiagnostics();
  windowListeners.get('jarvis:speech-diagnostic')({
    detail: {
      timestamp: '2025-01-02T03:04:05.000Z',
      event: 'SpeechRecognition error',
      error: 'network',
      language: 'hi-IN',
      purpose: 'wake',
      text: 'private transcript',
    },
  });

  assert.match(output.textContent, /2025-01-02T03:04:05\.000Z SpeechRecognition error \(error=network, language=hi-IN, purpose=wake\)/);
  assert.doesNotMatch(output.textContent, /private transcript/);
});

test('diagnostics capture TTS voice, synthesis state, queue timing, and missing start without speech text', () => {
  const { output, windowListeners } = runDiagnostics();
  const recordSpeechEvent = windowListeners.get('jarvis:speech-diagnostic');

  recordSpeechEvent({
    detail: {
      timestamp: '2025-01-02T03:04:05.000Z',
      event: 'TTS utterance onstart',
      language: 'en-US',
      voiceName: 'Google US English',
      voiceLanguage: 'en-US',
      speaking: true,
      pending: false,
      paused: false,
      queueDurationMs: 250,
      text: 'private reply',
    },
  });
  recordSpeechEvent({
    detail: {
      event: 'TTS utterance onend',
      language: 'hi-IN',
      voiceName: 'Google हिन्दी',
      voiceLanguage: 'hi-IN',
      speaking: false,
      pending: false,
      paused: false,
      started: false,
      elapsedMs: 3_000,
      text: 'private reply',
    },
  });
  recordSpeechEvent({
    detail: {
      event: 'TTS utterance skipped',
      reason: 'page-unfocused',
      speaking: false,
      pending: false,
      paused: false,
    },
  });

  assert.match(output.textContent, /TTS utterance onstart \(language=en-US, voiceName=Google US English, voiceLanguage=en-US, speaking=true, pending=false, paused=false, queueDurationMs=250\)/);
  assert.match(output.textContent, /TTS utterance onend \(language=hi-IN, voiceName=Google हिन्दी, voiceLanguage=hi-IN, speaking=false, pending=false, paused=false, started=false, elapsedMs=3000\)/);
  assert.match(output.textContent, /TTS utterance skipped \(speaking=false, pending=false, paused=false, reason=page-unfocused\)/);
  assert.doesNotMatch(output.textContent, /private reply/);
});

test('diagnostics show wake recognition lifecycle, match results, and restart attempts without transcripts', () => {
  const { output, windowListeners } = runDiagnostics();
  const recordSpeechEvent = windowListeners.get('jarvis:speech-diagnostic');
  const events = [
    {
      event: 'SpeechRecognition start requested',
      language: 'en-US',
      purpose: 'wake',
      continuous: true,
      maxAlternatives: 3,
      transcript: 'private transcript',
    },
    {
      event: 'SpeechRecognition results received',
      language: 'en-US',
      purpose: 'wake',
      resultCount: 1,
      alternativeCount: 2,
      finalResult: false,
      transcript: 'private transcript',
    },
    {
      event: 'Wake-word match evaluated',
      language: 'en-US',
      purpose: 'wake',
      matched: false,
      activated: false,
      alreadyActivated: false,
      transcript: 'private transcript',
    },
    {
      event: 'Wake-word status',
      enabled: true,
      language: 'hi-IN',
      microphonePermission: 'granted',
      visibility: 'visible',
      focused: true,
      secureContext: true,
      reason: 'startup',
      transcript: 'private transcript',
    },
    {
      event: 'Wake-word listening blocked',
      reason: 'page-unfocused',
      transcript: 'private transcript',
    },
    {
      event: 'Microphone permission status',
      permission: 'denied',
      source: 'query',
      transcript: 'private transcript',
    },
    {
      event: 'SpeechRecognition ended',
      language: 'en-US',
      purpose: 'wake',
      unexpected: true,
      wakeWordTriggered: false,
      error: 'network',
      durationMs: 1_234,
      transcript: 'private transcript',
    },
    {
      event: 'Wake-word automatic restart attempted',
      purpose: 'wake',
      attempt: 2,
      delayMs: 1_200,
      reason: 'recognition-ended-before-activation',
      transcript: 'private transcript',
    },
  ];

  for (const detail of events) recordSpeechEvent({ detail });

  assert.match(output.textContent, /SpeechRecognition start requested \(language=en-US, purpose=wake, continuous=true, maxAlternatives=3\)/);
  assert.match(output.textContent, /SpeechRecognition results received \(language=en-US, purpose=wake, finalResult=false, resultCount=1, alternativeCount=2\)/);
  assert.match(output.textContent, /Wake-word match evaluated \(language=en-US, purpose=wake, matched=false, activated=false, alreadyActivated=false\)/);
  assert.match(output.textContent, /Wake-word status \(language=hi-IN, microphonePermission=granted, visibility=visible, enabled=true, focused=true, secureContext=true, reason=startup\)/);
  assert.match(output.textContent, /Wake-word listening blocked \(reason=page-unfocused\)/);
  assert.match(output.textContent, /Microphone permission status \(permission=denied, source=query\)/);
  assert.match(output.textContent, /SpeechRecognition ended \(error=network, language=en-US, purpose=wake, unexpected=true, wakeWordTriggered=false, durationMs=1234\)/);
  assert.match(output.textContent, /Wake-word automatic restart attempted \(purpose=wake, attempt=2, delayMs=1200, reason=recognition-ended-before-activation\)/);
  assert.doesNotMatch(output.textContent, /private transcript/);
});

test('diagnostics identify recognition stop reasons and TTS priming overlap without transcripts', () => {
  const { output, windowListeners } = runDiagnostics();
  const recordSpeechEvent = windowListeners.get('jarvis:speech-diagnostic');

  recordSpeechEvent({
    detail: {
      event: 'SpeechRecognition stop requested',
      language: 'en-US',
      purpose: 'wake',
      reason: 'page-lifecycle',
      started: true,
      transcript: 'private transcript',
    },
  });
  recordSpeechEvent({
    detail: {
      event: 'TTS silent priming attempted',
      language: 'en-US',
      reason: 'recognition-active',
      recognitionActive: true,
      queued: true,
      transcript: 'private transcript',
    },
  });
  recordSpeechEvent({
    detail: {
      event: 'Wake-word retry cooldown scheduled',
      attempt: 5,
      delayMs: 30_000,
      reason: 'retry-limit-reached',
      transcript: 'private transcript',
    },
  });
  recordSpeechEvent({
    detail: {
      event: 'Wake-word retry cooldown ended',
      attempt: 0,
      reason: 'cooldown-expired',
      transcript: 'private transcript',
    },
  });

  assert.match(output.textContent, /SpeechRecognition stop requested \(language=en-US, purpose=wake, started=true, reason=page-lifecycle\)/);
  assert.match(output.textContent, /TTS silent priming attempted \(language=en-US, recognitionActive=true, queued=true, reason=recognition-active\)/);
  assert.match(output.textContent, /Wake-word retry cooldown scheduled \(attempt=5, delayMs=30000, reason=retry-limit-reached\)/);
  assert.match(output.textContent, /Wake-word retry cooldown ended \(attempt=0, reason=cooldown-expired\)/);
  assert.doesNotMatch(output.textContent, /private transcript/);
});

test('diagnostics remain hidden unless explicitly enabled in the URL', () => {
  const { panel, output, windowListeners } = runDiagnostics('?diagnostics=0');

  assert.equal(panel.hidden, true);
  assert.equal(output.textContent, '');
  assert.equal(windowListeners.size, 0);
});

test('speech paths report AI, recognition, and TTS lifecycle events to diagnostics', () => {
  assert.match(appSource, /reportSpeechDiagnostic\('AI reply reaches speak\(\)'/);
  assert.match(appSource, /reportSpeechDiagnostic\('SpeechRecognition error'/);
  assert.match(appSource, /reportSpeechDiagnostic\('SpeechRecognition start requested'/);
  assert.match(appSource, /reportSpeechDiagnostic\('SpeechRecognition stop requested'/);
  assert.match(appSource, /reportSpeechDiagnostic\('SpeechRecognition started'/);
  assert.match(appSource, /reportSpeechDiagnostic\('SpeechRecognition results received'/);
  assert.match(appSource, /reportSpeechDiagnostic\('Wake-word match evaluated'/);
  assert.match(appSource, /reportSpeechDiagnostic\('SpeechRecognition ended'/);
  assert.match(appSource, /reportSpeechDiagnostic\('Wake-word automatic restart attempted'/);
  assert.match(appSource, /wakeWordRecoveryPolicy\.startCooldown\(\)/);
  assert.match(appSource, /wakeWordRecoveryPolicy\.finishCooldown\(\)/);
  assert.match(appSource, /resumeWakeWordDetection\('retry-cooldown-ended'\)/);
  assert.doesNotMatch(appSource, /if \(wakeWordRecoveryPolicy\.circuitOpen\) return/);
  assert.match(appSource, /reportSpeechDiagnostic\('Wake-word listening blocked'/);
  assert.match(appSource, /reportSpeechDiagnostic\('Microphone permission status'/);
  assert.match(appSource, /reportWakeWordStatus\('startup'\)/);
  assert.match(appSource, /reportTtsDiagnostic\('TTS utterance onstart'/);
  assert.match(appSource, /reportTtsDiagnostic\('TTS utterance onerror'/);
  assert.match(appSource, /reportTtsDiagnostic\('TTS utterance onend'/);
  assert.match(appSource, /reportTtsDiagnostic\('TTS silent priming attempted'/);
  assert.match(appSource, /state\.preferences\.language,\s*Boolean\(state\.recognition\)/);
});

test('TTS completion does not count as a playback start', () => {
  const endHandler = /utterance\.onend = \(\) => \{([\s\S]*?)\n  \};/.exec(appSource)?.[1];

  assert.ok(endHandler);
  assert.match(endHandler, /started: playbackStarted/);
  assert.doesNotMatch(endHandler, /markPlaybackStarted/);
});

test('recognition errors defer lifecycle cleanup to onend and retries remain bounded', () => {
  const errorHandler = /recognition\.onerror = \(event\) => \{([\s\S]*?)\n  \};\n  recognition\.onend/.exec(appSource)?.[1];
  const endHandler = /recognition\.onend = \(\) => \{([\s\S]*?)\n  \};\n  clearRecognitionStartTimer/.exec(appSource)?.[1];

  assert.ok(errorHandler);
  assert.doesNotMatch(errorHandler, /stopListening\(|recognitionLifecycle\.finish/);
  assert.match(errorHandler, /state\.recognitionError = event\.error/);
  assert.ok(endHandler);
  assert.match(endHandler, /durationMs/);
  assert.match(endHandler, /state\.recognitionError/);
  assert.match(endHandler, /stopListening\(recognition, \{ unexpected, sessionDurationMs \}\)/);
  assert.match(appSource, /WAKE_WORD_MAX_RESTART_ATTEMPTS = 5|WAKE_WORD_MAX_RESTART_ATTEMPTS/);
  assert.match(appSource, /wakeWordRecoveryPolicy\.recordRestartAttempt\(\)/);
  assert.doesNotMatch(appSource, /if \(purpose === 'wake'\) state\.wakeWordRestartAttemptCount = 0/);
});

test('transient recognition errors retry, fatal errors disable wake mode, and manual retry waits for the active end', () => {
  const errorHandler = /recognition\.onerror = \(event\) => \{([\s\S]*?)\n  \};\n  recognition\.onend/.exec(appSource)?.[1];
  const stopListeningStart = appSource.indexOf('function stopListening(');
  const stopListeningEnd = appSource.indexOf('\nfunction syncSettings', stopListeningStart);
  const endHandler = stopListeningStart >= 0 && stopListeningEnd > stopListeningStart
    ? appSource.slice(stopListeningStart, stopListeningEnd)
    : '';

  assert.ok(errorHandler);
  assert.match(errorHandler, /isFatalSpeechRecognitionError\(event\.error\)/);
  assert.match(errorHandler, /disableWakeWord\(message\)/);
  assert.doesNotMatch(errorHandler, /stopListening\(/);
  assert.ok(endHandler);
  assert.match(endHandler, /manualWakeRetry/);
  assert.match(endHandler, /resumeWakeWordDetection\('manual-retry'\)/);
  assert.match(appSource, /state\.wakeWordManualRetryPending = true/);
  assert.match(appSource, /wakeWordRecoveryPolicy\.resetForManualRetry\(\)/);
});
