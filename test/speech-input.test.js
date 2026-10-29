import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMicrophonePermissionGuard,
  createRecognitionLifecycle,
  getSpeechRecognitionErrorMessage,
  getSpeechRecognitionConstructor,
  getSpeechRecognitionLanguage,
  getSpeechRecognitionStartError,
  isPageForeground,
  matchWakeWord,
  nextWakeWordRestartDelay,
  readSpeechRecognitionResult,
  resolveVoiceOutputEnabled,
  selectSpeechSynthesisVoice,
  shouldPlaySpeech,
  shouldRunWakeWord,
} from '../public/speech-input.js';

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

test('preserves command capitalization and punctuation after the wake phrase', () => {
  assert.deepEqual(matchWakeWord('Hey, JARVIS: What time is it?'), {
    matched: true,
    command: 'What time is it?',
  });
});

test('does not activate for partial phrases and collapses repeated wake phrases', () => {
  assert.deepEqual(matchWakeWord('Jarvis, tell me a joke'), { matched: false, command: '' });
  assert.deepEqual(matchWakeWord('Hey there, Jarvis'), { matched: false, command: '' });
  assert.deepEqual(matchWakeWord('Hey Jarvis, hey JARVIS, hello'), {
    matched: true,
    command: 'hello',
  });
});

test('backs off continuous wake recognition restarts up to a bounded delay', () => {
  assert.equal(nextWakeWordRestartDelay(600), 1_200);
  assert.equal(nextWakeWordRestartDelay(4_000), 8_000);
  assert.equal(nextWakeWordRestartDelay(8_000), 8_000);
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