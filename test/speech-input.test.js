import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMicrophonePermissionGuard,
  createRecognitionLifecycle,
  createSpeechReplayController,
  createWakeWordRecoveryPolicy,
  getSpeechRecognitionErrorMessage,
  getSpeechRecognitionConstructor,
  getSpeechRecognitionLanguage,
  getSpeechRecognitionStartError,
  isFatalSpeechRecognitionError,
  getSpeechSynthesisErrorMessage,
  getWakeWordListeningBlockReason,
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
} from '../public/speech-input.js';

test('offers one user-gesture replay after a speech start failure and hides it after playback starts', () => {
  const changes = [];
  const controller = createSpeechReplayController((message, status) => changes.push([message, status]));
  const message = { role: 'assistant', content: 'A response' };

  controller.track(message);
  assert.equal(controller.getStatus(message), 'pending');
  assert.equal(controller.markNotStarted(message), true);
  assert.equal(controller.getStatus(message), 'available');
  assert.equal(controller.beginReplay(message), true);
  assert.equal(controller.getStatus(message), 'replaying');
  assert.equal(controller.beginReplay(message), false);
  assert.equal(controller.markStarted(message), true);
  assert.equal(controller.getStatus(message), 'spoken');
  assert.equal(controller.beginReplay(message), false);
  assert.equal(controller.markNotStarted(message), false);
  assert.deepEqual(changes, [
    [message, 'available'],
    [message, 'replaying'],
    [message, 'spoken'],
  ]);
});

test('keeps earlier finalized speech when a later recognition result changes', () => {
  const event = {
    resultIndex: 1,
    results: [
      Object.assign([{ transcript: 'Hello ' }], { isFinal: true }),
      Object.assign([{ transcript: 'J.A.R.V.I.S.' }], { isFinal: true }),
    ],
  };

  assert.deepEqual(readSpeechRecognitionResult(event), {
    transcript: 'Hello J.A.R.V.I.S.',
    finalResult: true,
  });
});

test('reads alternate recognition transcripts so a secondary wake phrase can activate', () => {
  const event = {
    results: [
      Object.assign(
        [{ transcript: 'Hey Jarvis' }, { transcript: 'Hey J.A.R.V.I.S.' }],
        { isFinal: true },
      ),
      Object.assign(
        [{ transcript: 'what time is it?' }, { transcript: 'what time is it?' }],
        { isFinal: false },
      ),
    ],
  };

  assert.deepEqual(readSpeechRecognitionAlternatives(event), [
    'Hey Jarviswhat time is it?',
    'Hey Jarvis what time is it?',
    'Hey J.A.R.V.I.S.what time is it?',
    'Hey J.A.R.V.I.S. what time is it?',
  ]);
  const alternate = readSpeechRecognitionAlternatives(event).find((transcript) => matchWakeWord(transcript).matched);
  assert.deepEqual(readWakeWordCommand(alternate), {
    triggered: true,
    activated: true,
    command: 'what time is it?',
  });
});

test('resolves standard and Android-prefixed recognition with the selected locale', () => {
  const standardRecognition = function StandardRecognition() {};
  const webkitRecognition = function WebkitRecognition() {};

  assert.equal(getSpeechRecognitionConstructor({ SpeechRecognition: standardRecognition }), standardRecognition);
  assert.equal(getSpeechRecognitionConstructor({ webkitSpeechRecognition: webkitRecognition }), webkitRecognition);
  assert.equal(getSpeechRecognitionConstructor({}), null);
  assert.equal(getSpeechRecognitionLanguage('hi'), 'hi-IN');
  assert.equal(getSpeechRecognitionLanguage('en'), 'en-US');
});

test('enables spoken replies by default only when synthesis is supported and preserves saved choice', () => {
  assert.equal(resolveVoiceOutputEnabled(undefined, true), true);
  assert.equal(resolveVoiceOutputEnabled(undefined, false), false);
  assert.equal(resolveVoiceOutputEnabled(false, true), false);
  assert.equal(resolveVoiceOutputEnabled(true, true), true);
  assert.equal(resolveVoiceOutputEnabled(true, false), false);
});

test('primes speech synthesis silently for English and Hindi user gestures', () => {
  const spoken = [];
  let resumed = 0;
  class FakeUtterance {
    constructor(text) {
      this.text = text;
      this.volume = 1;
      this.lang = '';
    }
  }
  const synthesis = {
    resume() { resumed += 1; },
    speak(utterance) { spoken.push(utterance); },
  };

  assert.equal(primeSpeechSynthesis(synthesis, FakeUtterance, 'en'), true);
  assert.equal(primeSpeechSynthesis(synthesis, FakeUtterance, 'hi'), true);
  assert.deepEqual(spoken.map(({ text, volume, lang }) => ({ text, volume, lang })), [
    { text: ' ', volume: 0, lang: 'en-US' },
    { text: ' ', volume: 0, lang: 'hi-IN' },
  ]);
  assert.equal(resumed, 2);
  assert.equal(primeSpeechSynthesis(synthesis, FakeUtterance, 'en', true), false);
  assert.equal(spoken.length, 2);
  assert.equal(primeSpeechSynthesis({}, FakeUtterance, 'en'), false);
  assert.equal(primeSpeechSynthesis(synthesis, null, 'en'), false);
  assert.equal(primeSpeechSynthesis({ speak() { throw new Error('blocked'); } }, FakeUtterance, 'en'), false);
});

test('maps Android speech synthesis restrictions to actionable feedback', () => {
  assert.match(getSpeechSynthesisErrorMessage('not-allowed'), /tap Preview voice/i);
  assert.match(getSpeechSynthesisErrorMessage('voice-unavailable'), /System default/i);
  assert.match(getSpeechSynthesisErrorMessage('language-not-supported'), /text-to-speech settings/i);
  assert.match(getSpeechSynthesisErrorMessage('synthesis-failed'), /device text-to-speech/i);
  assert.match(getSpeechSynthesisErrorMessage('timeout'), /did not start/i);
  assert.match(getSpeechSynthesisErrorMessage('canceled'), /playback was canceled/i);
  assert.match(getSpeechSynthesisErrorMessage('interrupted'), /playback was interrupted/i);
});

test('retries Android speech synthesis resume while startup is delayed', () => {
  let now = 0;
  let nextTimerId = 0;
  const timers = new Map();
  const scheduler = {
    setTimer(callback, delay) {
      const id = ++nextTimerId;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(duration) {
      const end = now + duration;
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].due - b[1].due)[0];
        if (!next || next[1].due > end) break;
        timers.delete(next[0]);
        now = next[1].due;
        next[1].callback();
      }
      now = end;
    },
  };
  let resumeCount = 0;
  let timedOut = 0;
  const cancelMonitor = monitorSpeechSynthesisStart({
    resume() { resumeCount += 1; },
  }, {
    interval: 100,
    timeout: 500,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer,
    onTimeout() { timedOut += 1; },
  });

  scheduler.advance(300);
  assert.equal(resumeCount, 3);
  assert.equal(timedOut, 0);

  cancelMonitor();
  scheduler.advance(500);
  assert.equal(resumeCount, 3);
  assert.equal(timedOut, 0);
});

test('reports speech synthesis startup failure after its recovery window', () => {
  let now = 0;
  let nextTimerId = 0;
  const timers = new Map();
  const scheduler = {
    setTimer(callback, delay) {
      const id = ++nextTimerId;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(duration) {
      const end = now + duration;
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].due - b[1].due)[0];
        if (!next || next[1].due > end) break;
        timers.delete(next[0]);
        now = next[1].due;
        next[1].callback();
      }
      now = end;
    },
  };
  let timedOut = 0;

  monitorSpeechSynthesisStart({}, {
    interval: 100,
    timeout: 300,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer,
    onTimeout() { timedOut += 1; },
  });

  scheduler.advance(500);
  assert.equal(timedOut, 1);
});

test('does not submit earlier final speech while the changed result is interim', () => {
  const event = {
    resultIndex: 1,
    results: [
      Object.assign([{ transcript: 'Hello ' }], { isFinal: true }),
      Object.assign([{ transcript: 'there' }], { isFinal: false }),
    ],
  };

  assert.deepEqual(readSpeechRecognitionResult(event), {
    transcript: 'Hello there',
    finalResult: false,
  });
});

test('waits for later interim fragments after a changed result becomes final', () => {
  const event = {
    resultIndex: 0,
    results: [
      Object.assign([{ transcript: 'Hello ' }], { isFinal: true }),
      Object.assign([{ transcript: 'there' }], { isFinal: false }),
    ],
  };

  assert.deepEqual(readSpeechRecognitionResult(event), {
    transcript: 'Hello there',
    finalResult: false,
  });
});

test('selects a system voice that matches the conversation language', () => {
  const voices = [
    { voiceURI: 'english', lang: 'en-US', default: true },
    { voiceURI: 'hindi', lang: 'hi-IN', default: false },
  ];

  assert.equal(selectSpeechSynthesisVoice(voices, 'hi', 'english').voiceURI, 'hindi');
  assert.equal(selectSpeechSynthesisVoice(voices, 'en', 'english').voiceURI, 'english');
});

test('uses a same-language default voice and never falls back to another language', () => {
  const voices = [
    { voiceURI: 'hindi-secondary', lang: 'hi-IN', default: false },
    { voiceURI: 'hindi-default', lang: 'hi_IN', default: true },
  ];

  assert.equal(selectSpeechSynthesisVoice(voices, 'hi').voiceURI, 'hindi-default');
  assert.equal(selectSpeechSynthesisVoice(voices, 'en'), null);
});

test('maps microphone permission and speech service failures to actionable messages', () => {
  assert.match(getSpeechRecognitionErrorMessage('not-allowed'), /permission was denied/i);
  assert.match(getSpeechRecognitionErrorMessage('audio-capture'), /microphone is available/i);
  assert.match(getSpeechRecognitionErrorMessage('network'), /current network/i);
  assert.equal(getSpeechRecognitionErrorMessage('aborted'), '');
});

test('classifies terminal microphone/configuration errors separately from transient recognition errors', () => {
  for (const error of ['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']) {
    assert.equal(isFatalSpeechRecognitionError(error), true);
  }
  for (const error of ['network', 'no-speech', 'aborted', 'unknown']) {
    assert.equal(isFatalSpeechRecognitionError(error), false);
  }
});

test('distinguishes synchronous microphone permission and secure-origin failures', () => {
  assert.deepEqual(getSpeechRecognitionStartError({ name: 'NotAllowedError' }), {
    permissionDenied: true,
    message: 'Microphone permission was denied. Allow microphone access in your browser settings to use voice input.',
  });
  assert.match(getSpeechRecognitionStartError({ name: 'SecurityError' }).message, /secure HTTPS/);
  assert.equal(getSpeechRecognitionStartError({ name: 'InvalidStateError' }).permissionDenied, false);
});

test('prevents duplicate recognition sessions and ignores stale completion events', () => {
  const lifecycle = createRecognitionLifecycle();
  const first = {};
  const second = {};

  assert.equal(lifecycle.begin(first), true);
  assert.equal(lifecycle.begin(second), false);
  assert.equal(lifecycle.requestStop(first), true);
  assert.equal(lifecycle.requestStop(first), false);
  assert.equal(lifecycle.begin(second), false);
  assert.equal(lifecycle.finish(first), true);
  assert.equal(lifecycle.begin(second), true);
  assert.equal(lifecycle.finish(first), false);
  assert.equal(lifecycle.isCurrent(second), true);
});

test('keeps recognition active after an error until the matching end event', () => {
  const lifecycle = createRecognitionLifecycle();
  const first = {};
  const second = {};

  assert.equal(lifecycle.begin(first), true);
  assert.equal(lifecycle.isCurrent(first), true);
  assert.equal(lifecycle.begin(second), false);
  assert.equal(lifecycle.finish(first), true);
  assert.equal(lifecycle.begin(second), true);
});

test('bounds wake restart attempts and resets cooldown after speech or a stable session', () => {
  const policy = createWakeWordRecoveryPolicy({ maxAttempts: 3, stableDurationMs: 30_000, cooldownMs: 1_000 });

  for (let ending = 1; ending <= 3; ending += 1) {
    assert.equal(policy.recordRestartAttempt(), ending);
  }
  assert.equal(policy.canRetry(), false);
  assert.equal(policy.recordRestartAttempt(), null);
  assert.equal(policy.circuitOpen, false);
  assert.equal(policy.startCooldown(), 1_000);
  assert.equal(policy.circuitOpen, true);

  assert.equal(policy.recordSessionDuration(29_999), false);
  assert.equal(policy.circuitOpen, true);
  assert.equal(policy.recordSessionDuration(30_000), true);
  assert.equal(policy.circuitOpen, false);
  assert.equal(policy.restartAttempts, 0);

  assert.equal(policy.recordRestartAttempt(), 1);
  policy.recordSpeechResult();
  assert.equal(policy.restartAttempts, 0);
  assert.equal(policy.canRetry(), true);

  policy.recordRestartAttempt();
  policy.startCooldown();
  policy.resetForManualRetry();
  assert.equal(policy.circuitOpen, false);
  assert.equal(policy.restartAttempts, 0);
});

test('automatically retries beyond five short Android recognition sessions after cooldown', () => {
  let now = 1_000;
  const policy = createWakeWordRecoveryPolicy({
    maxAttempts: 5,
    cooldownMs: 30_000,
    now: () => now,
  });

  for (let cycle = 0; cycle < 2; cycle += 1) {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      assert.equal(policy.recordRestartAttempt(), attempt);
      assert.equal(policy.recordSessionDuration(5_500), false);
    }
    assert.equal(policy.canRetry(), false);
    assert.equal(policy.startCooldown(), 30_000);
    assert.equal(policy.circuitOpen, true);
    assert.equal(policy.cooldownRemainingMs, 30_000);

    now += 30_000;
    assert.equal(policy.finishCooldown(), true);
    assert.equal(policy.circuitOpen, false);
    assert.equal(policy.canRetry(), true);
  }
});

test('detects English and Hindi wake phrases and extracts a following command', () => {
  assert.deepEqual(matchWakeWord('Hey JARVIS, what is the weather?'), {
    matched: true,
    command: 'what is the weather?',
  });
  assert.deepEqual(matchWakeWord('हे जार्विस, आज मौसम कैसा है?'), {
    matched: true,
    command: 'आज मौसम कैसा है?',
  });
});

test('successfully activates Hey JARVIS and preserves its following request', () => {
  const result = readWakeWordCommand('Hey JARVIS, What time is it?', false);

  assert.deepEqual(result, {
    triggered: true,
    activated: true,
    command: 'What time is it?',
  });
});

test('preserves command capitalization and punctuation after the wake phrase', () => {
  assert.deepEqual(matchWakeWord('Hey, JARVIS: What time is it?'), {
    matched: true,
    command: 'What time is it?',
  });
});

test('matches dotted speech-recognition spellings of the English wake phrase', () => {
  assert.deepEqual(matchWakeWord('Hey, J.A.R.V.I.S., what time is it?'), {
    matched: true,
    command: 'what time is it?',
  });
  assert.deepEqual(matchWakeWord('Hey J A R V I S, what time is it?'), {
    matched: true,
    command: 'what time is it?',
  });
  assert.deepEqual(matchWakeWord('Hey J-A-R-V-I-S, what time is it?'), {
    matched: true,
    command: 'what time is it?',
  });
  assert.deepEqual(matchWakeWord('Hey. Jarvis, what time is it?'), {
    matched: true,
    command: 'what time is it?',
  });
});

test('accepts Hindi wake phrase punctuation and common speech transcription variants', () => {
  assert.equal(matchWakeWord('हे, जारविस। मौसम बताओ').matched, true);
  assert.equal(matchWakeWord('हे जार्विस, मौसम बताओ').command, 'मौसम बताओ');
});

test('does not activate for partial phrases and collapses repeated wake phrases', () => {
  assert.deepEqual(matchWakeWord('Jarvis, tell me a joke'), { matched: false, command: '' });
  assert.deepEqual(matchWakeWord('Hey there, Jarvis'), { matched: false, command: '' });
  assert.deepEqual(matchWakeWord('Hey Jarvis, hey JARVIS, hello'), {
    matched: true,
    command: 'hello',
  });
  assert.deepEqual(matchWakeWord('Hey J-A-R-V-I-S, hey J A R V I S, hello'), {
    matched: true,
    command: 'hello',
  });
});

test('keeps wake activation latched when later recognition results omit the wake phrase', () => {
  const activated = readWakeWordCommand('Hey JARVIS', false);
  assert.deepEqual(activated, { triggered: true, activated: true, command: '' });

  const command = readWakeWordCommand('What time is it?', activated.triggered, activated.command);
  assert.deepEqual(command, { triggered: true, activated: false, command: 'What time is it?' });

  const duplicate = readWakeWordCommand('Hey JARVIS, what time is it?', command.triggered, command.command);
  assert.deepEqual(duplicate, { triggered: true, activated: false, command: 'what time is it?' });

  const hindiWake = readWakeWordCommand('हे जार्विस', false);
  const hindiCommand = readWakeWordCommand('आज मौसम बताओ', hindiWake.triggered, hindiWake.command);
  assert.deepEqual(hindiWake, { triggered: true, activated: true, command: '' });
  assert.deepEqual(hindiCommand, { triggered: true, activated: false, command: 'आज मौसम बताओ' });
});

test('preserves an existing wake command when a later recognition result is empty', () => {
  assert.deepEqual(readWakeWordCommand('', true, 'Tell me the time'), {
    triggered: true,
    activated: false,
    command: 'Tell me the time',
  });
});

test('backs off continuous wake recognition restarts up to a bounded delay', () => {
  assert.equal(nextWakeWordRestartDelay(600), 1_200);
  assert.equal(nextWakeWordRestartDelay(1_200), 2_400);
  assert.equal(nextWakeWordRestartDelay(2_400), 2_400);
  assert.equal(nextWakeWordRestartDelay(4_000), 2_400);
  assert.equal(nextWakeWordRestartDelay(Number.NaN), 1_200);
});

test('allows wake recognition only when enabled and the page is not hidden', () => {
  assert.equal(shouldRunWakeWord(true, 'visible'), true);
  assert.equal(shouldRunWakeWord(true, 'hidden'), false);
  assert.equal(shouldRunWakeWord(true, 'visible', true), false);
  assert.equal(shouldRunWakeWord(true, 'visible', false, 'denied'), false);
  assert.equal(shouldRunWakeWord(false, 'visible'), false);
  assert.equal(shouldRunWakeWord(true, undefined), true);
  assert.equal(shouldRunWakeWord(true, 'visible', false, 'granted', false), false);
});

test('explains why wake-word listening is blocked without changing its eligibility rules', () => {
  const cases = [
    [false, 'visible', false, 'unknown', true, 'disabled'],
    [true, 'visible', false, 'denied', true, 'permission-denied'],
    [true, 'hidden', false, 'granted', true, 'page-hidden'],
    [true, 'visible', false, 'granted', false, 'page-unfocused'],
    [true, 'visible', true, 'granted', true, 'page-lifecycle-paused'],
    [true, 'visible', false, 'granted', true, ''],
  ];

  for (const [enabled, visibility, paused, permission, focused, reason] of cases) {
    assert.equal(
      getWakeWordListeningBlockReason(enabled, visibility, paused, permission, focused),
      reason,
    );
    assert.equal(
      shouldRunWakeWord(enabled, visibility, paused, permission, focused),
      !reason,
    );
  }
});

test('allows speech playback only while the page is visible and focused', () => {
  assert.equal(isPageForeground('visible', true), true);
  assert.equal(isPageForeground('visible', false), false);
  assert.equal(shouldPlaySpeech('hidden', true), false);
  assert.equal(shouldPlaySpeech('visible', false), false);
});

test('ignores stale microphone permission results after a newer permission error', () => {
  const guard = createMicrophonePermissionGuard();
  const pendingRequest = guard.begin();

  guard.invalidate();

  assert.equal(guard.isCurrent(pendingRequest), false);
  const refreshedRequest = guard.begin();
  assert.equal(guard.isCurrent(refreshedRequest), true);
});