import assert from 'node:assert/strict';
import test from 'node:test';
import { createPortraitAnimation } from '../public/portrait-animation.js';

function createHarness({ reducedMotion = false, initiallyHidden = false, random = () => 0 } = {}) {
  let now = 0;
  let nextTimerId = 0;
  const timers = new Map();
  const changes = [];
  const listeners = new Set();
  const documentListeners = new Set();
  const reducedMotionQuery = {
    matches: reducedMotion,
    addEventListener(type, listener) {
      if (type === 'change') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'change') listeners.delete(listener);
    },
  };
  const documentRef = {
    hidden: initiallyHidden,
    addEventListener(type, listener) {
      if (type === 'visibilitychange') documentListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'visibilitychange') documentListeners.delete(listener);
    },
  };
  const animation = createPortraitAnimation({
    onChange: (state) => changes.push(state),
    reducedMotionQuery,
    documentRef,
    random,
    schedule(callback, delay) {
      const id = ++nextTimerId;
      timers.set(id, { callback, dueAt: now + delay });
      return id;
    },
    cancel(id) {
      timers.delete(id);
    },
  });

  function advance(milliseconds) {
    now += milliseconds;
    while (true) {
      const next = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= now)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!next) return;
      timers.delete(next[0]);
      next[1].callback();
    }
  }

  function setReducedMotion(matches) {
    reducedMotionQuery.matches = matches;
    for (const listener of listeners) listener({ matches });
  }

  function setHidden(hidden) {
    documentRef.hidden = hidden;
    for (const listener of documentListeners) listener();
  }

  return {
    animation,
    changes,
    timers,
    advance,
    setReducedMotion,
    setHidden,
    documentListeners,
    get timerDelays() {
      return [...timers.values()].map(({ dueAt }) => dueAt - now);
    },
    get current() {
      return changes.at(-1);
    },
  };
}

test('blink transitions are synchronized, smoothly timed, and vary within a natural duration', () => {
  const harness = createHarness();

  assert.equal(harness.current.blink, 'open');
  assert.equal(harness.current.speaking, false);
  assert.deepEqual(harness.timerDelays, [2_500]);
  harness.advance(2_500);
  assert.equal(harness.current.blink, 'closed');
  const closed = harness.current;
  assert.ok(closed.blinkCloseDuration >= 45 && closed.blinkCloseDuration <= 60);
  assert.ok(closed.blinkOpenDuration >= 70 && closed.blinkOpenDuration <= 95);
  harness.advance(79);
  assert.equal(harness.current.blink, 'closed');
  harness.advance(1);
  assert.equal(harness.current.blink, 'open');
  const open = harness.current;
  const totalDuration = closed.blinkCloseDuration + 35 + open.blinkOpenDuration;
  assert.ok(totalDuration >= 120 && totalDuration <= 220);
  assert.equal(harness.timerDelays.length, 1);

  harness.animation.setEyeMode('thinking');
  harness.animation.setSpeaking(true);
  assert.ok(harness.timerDelays[0] >= 2_500 && harness.timerDelays[0] <= 5_650);
  harness.animation.setSpeaking(false);
  assert.ok(harness.timerDelays[0] >= 2_500 && harness.timerDelays[0] <= 5_825);

  harness.animation.destroy();
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.documentListeners.size, 0);
});

test('randomized blink intervals stay bounded and continue in each assistant state', () => {
  const harness = createHarness({ random: () => 0.999 });

  assert.ok(harness.timerDelays[0] >= 2_500 && harness.timerDelays[0] <= 6_000);
  for (const mode of ['idle', 'listening', 'thinking']) {
    harness.animation.setEyeMode(mode);
    assert.equal(harness.timers.size, 1);
    assert.equal(harness.animation.blink(), true);
    assert.equal(harness.current.blink, 'closed');
    harness.advance(220);
    assert.equal(harness.current.blink, 'open');
  }
  harness.animation.setSpeaking(true);
  assert.ok(harness.timerDelays[0] >= 2_500 && harness.timerDelays[0] <= 5_650);

  harness.setReducedMotion(true);
  assert.ok(harness.timerDelays[0] >= 4_000 && harness.timerDelays[0] <= 7_600);
  harness.animation.destroy();
});

test('double blinks follow the first blink after a short randomized pause', () => {
  const randomValues = [0, 0, 0, 0, 0, 0];
  const harness = createHarness({ random: () => randomValues.shift() ?? 0 });

  harness.advance(2_500);
  assert.equal(harness.current.blink, 'closed');
  harness.advance(80);
  assert.equal(harness.current.blink, 'open');
  assert.deepEqual(harness.timerDelays, [180]);
  harness.advance(180);
  assert.equal(harness.current.blink, 'closed');

  harness.animation.destroy();
});

test('reduced motion keeps functional blinks but spaces them farther apart', () => {
  const harness = createHarness({ reducedMotion: true });

  assert.deepEqual(harness.timerDelays, [4_000]);
  harness.advance(4_000);
  assert.equal(harness.current.blink, 'closed');
  harness.advance(80);
  assert.equal(harness.current.blink, 'open');
  harness.animation.destroy();
  assert.equal(harness.timers.size, 0);
});

test('forced blinks use the same synchronized transition and can be interrupted safely', () => {
  const harness = createHarness();
  harness.advance(400);
  assert.equal(harness.animation.blink(), true);
  assert.equal(harness.current.blink, 'closed');
  harness.advance(80);
  assert.equal(harness.current.blink, 'open');
  harness.animation.destroy();
  assert.equal(harness.timers.size, 0);
});

test('hidden tabs pause blink timers and resume with a fresh interval', () => {
  const harness = createHarness({ initiallyHidden: true });

  assert.equal(harness.timers.size, 0);
  harness.setHidden(false);
  assert.deepEqual(harness.timerDelays, [2_500]);
  harness.advance(500);
  harness.setHidden(true);
  assert.equal(harness.timers.size, 0);
  harness.setHidden(false);
  assert.deepEqual(harness.timerDelays, [2_500]);

  harness.animation.destroy();
  assert.equal(harness.documentListeners.size, 0);
});

test('speech visemes are playback-scoped and return to neutral on pause, resume, and finish', () => {
  const harness = createHarness();
  const { animation } = harness;

  assert.equal(animation.startSpeech(12), true);
  assert.equal(animation.setViseme(12, 'oh'), true);
  assert.equal(harness.current.viseme, 'oh');
  assert.equal(animation.pauseSpeech(12), true);
  assert.equal(harness.current.viseme, 'neutral');
  assert.equal(harness.current.speaking, false);
  assert.equal(animation.setViseme(12, 'aa'), false);
  assert.equal(animation.resumeSpeech(12), true);
  assert.equal(animation.setViseme(12, 'ee'), true);
  assert.equal(animation.finishSpeech(12), true);
  assert.equal(harness.current.viseme, 'neutral');
  assert.equal(harness.current.speaking, false);
  assert.equal(animation.setViseme(12, 'oh'), false);

  animation.destroy();
});

test('stale playback callbacks cannot replace or clear the current mouth state', () => {
  const harness = createHarness();
  const { animation } = harness;

  animation.startSpeech(1);
  animation.setViseme(1, 'aa');
  animation.startSpeech(2);
  assert.equal(animation.finishSpeech(1), false);
  assert.equal(animation.setViseme(1, 'oh'), false);
  assert.equal(harness.current.speaking, true);
  assert.equal(harness.current.viseme, 'neutral');
  assert.equal(animation.setViseme(2, 'ee'), true);
  assert.equal(animation.cancelSpeech(), true);
  assert.equal(harness.current.viseme, 'neutral');
  assert.equal(animation.setViseme(2, 'aa'), false);

  animation.destroy();
});

test('reduced-motion preference does not disable functional blink or speech hooks', () => {
  const harness = createHarness({ reducedMotion: true });

  assert.equal(harness.timers.size, 1);
  assert.equal(harness.animation.startSpeech(3), true);
  assert.equal(harness.animation.setViseme(3, 'aa'), true);
  assert.equal(harness.current.viseme, 'aa');
  assert.equal(harness.animation.blink(), true);
  assert.equal(harness.current.blink, 'closed');
  assert.equal(harness.animation.setViseme(3, 'oh'), true);
  harness.advance(10_000);
  assert.ok(['open', 'closed'].includes(harness.current.blink));

  harness.animation.destroy();
  assert.equal(harness.timers.size, 0);
});
