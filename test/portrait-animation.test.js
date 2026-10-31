import assert from 'node:assert/strict';
import test from 'node:test';
import { createPortraitAnimation } from '../public/portrait-animation.js';

function createHarness({ reducedMotion = false, random = () => 0 } = {}) {
  let now = 0;
  let nextTimerId = 0;
  const timers = new Map();
  const changes = [];
  const listeners = new Set();
  const reducedMotionQuery = {
    matches: reducedMotion,
    addEventListener(type, listener) {
      if (type === 'change') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'change') listeners.delete(listener);
    },
  };
  const animation = createPortraitAnimation({
    onChange: (state) => changes.push(state),
    reducedMotionQuery,
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

  return {
    animation,
    changes,
    timers,
    advance,
    setReducedMotion,
    get current() {
      return changes.at(-1);
    },
  };
}

test('blinking runs independently of speech with a short, staged closure', () => {
  const harness = createHarness();

  assert.equal(harness.current.blink, 'open');
  assert.equal(harness.current.speaking, false);
  harness.advance(2_800);
  assert.equal(harness.current.blink, 'half');
  assert.equal(harness.current.speaking, false);
  harness.advance(45);
  assert.equal(harness.current.blink, 'closed');
  harness.advance(65);
  assert.equal(harness.current.blink, 'half');
  harness.advance(55);
  assert.equal(harness.current.blink, 'open');

  harness.animation.destroy();
  assert.equal(harness.timers.size, 0);
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

test('reduced motion disables blink and mouth movement, including when enabled mid-playback', () => {
  const harness = createHarness({ reducedMotion: true });

  assert.equal(harness.timers.size, 0);
  assert.equal(harness.animation.startSpeech(3), true);
  assert.equal(harness.animation.setViseme(3, 'aa'), false);
  harness.setReducedMotion(false);
  assert.equal(harness.timers.size, 1);
  assert.equal(harness.animation.setViseme(3, 'aa'), true);
  harness.setReducedMotion(true);
  assert.equal(harness.current.blink, 'open');
  assert.equal(harness.current.viseme, 'neutral');
  assert.equal(harness.animation.setViseme(3, 'oh'), false);
  harness.advance(10_000);
  assert.equal(harness.current.blink, 'open');

  harness.animation.destroy();
  assert.equal(harness.timers.size, 0);
});
