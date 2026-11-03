import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPortraitMotion,
  DEFAULT_PORTRAIT_LIVELINESS,
  getPortraitLiveliness,
  REDUCED_MOTION_LIVELINESS,
} from '../public/portrait-motion.js';

function createHarness({ reducedMotion = false, quality = 'high', random = () => 0.5 } = {}) {
  let time = 0;
  let nextFrameId = 0;
  const frames = new Map();
  const queryListeners = new Set();
  const documentListeners = new Map();
  const styles = new Map();
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const context = {
    clearRect: noop,
    save: noop,
    restore: noop,
    translate: noop,
    beginPath: noop,
    ellipse: noop,
    moveTo: noop,
    quadraticCurveTo: noop,
    stroke: noop,
    fill: noop,
    createLinearGradient: () => gradient,
  };
  const portraitFrame = { style: { setProperty: (name, value) => styles.set(name, value) } };
  const portraitHead = { style: { setProperty: (name, value) => styles.set(name, value) } };
  const portraitArtwork = {};
  const portraitImage = {};
  const mouthCanvas = {
    width: 800,
    height: 875,
    getContext: () => context,
  };
  const reducedMotionQuery = {
    matches: reducedMotion,
    addEventListener(type, listener) {
      if (type === 'change') queryListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'change') queryListeners.delete(listener);
    },
  };
  const windowRef = {
    document: {
      hidden: false,
      addEventListener(type, listener) {
        const values = documentListeners.get(type) || new Set();
        values.add(listener);
        documentListeners.set(type, values);
      },
      removeEventListener(type, listener) {
        documentListeners.get(type)?.delete(listener);
      },
    },
    addEventListener: noop,
    removeEventListener: noop,
  };
  const motion = createPortraitMotion({
    portraitFrame,
    portraitHead,
    portraitArtwork,
    portraitImage,
    mouthCanvas,
    mouthConfig: { x: 0.517, y: 0.419, width: 0.11 },
    windowRef,
    reducedMotionQuery,
    quality,
    random,
    now: () => time,
    requestFrame(callback) {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      frames.delete(id);
    },
  });

  function tick(milliseconds = 16) {
    time += milliseconds;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(time));
  }

  return {
    motion,
    styles,
    tick,
    setReducedMotion(matches) {
      reducedMotionQuery.matches = matches;
      queryListeners.forEach((listener) => listener({ matches }));
    },
  };
}

test('portrait liveliness uses the default and reduced-motion values', () => {
  assert.equal(DEFAULT_PORTRAIT_LIVELINESS, 0.6);
  assert.equal(REDUCED_MOTION_LIVELINESS, 0.15);
  assert.equal(getPortraitLiveliness(), 0.6);
  assert.equal(getPortraitLiveliness(true), 0.15);
  assert.equal(getPortraitLiveliness(false, 0.9), 0.9);

  const harness = createHarness({ reducedMotion: true });
  assert.equal(harness.motion.liveliness, 0.15);
  harness.setReducedMotion(false);
  assert.equal(harness.motion.liveliness, 0.6);
  harness.motion.destroy();
});

test('only the head layer moves and its motion stays within the requested bounds', () => {
  const harness = createHarness({ random: () => 0.5 });
  for (let frame = 0; frame < 180; frame += 1) harness.tick(16);

  const state = harness.motion.getState();
  assert.ok(Math.abs(state.headRotation) <= 1.5);
  assert.ok(Math.abs(state.headTranslation) <= 2);
  assert.ok(Math.abs(state.headRotation) > 0);
  assert.ok(Math.abs(state.headTranslation) > 0);
  assert.equal(harness.styles.has('--portrait-breath'), false);
  assert.equal(harness.styles.has('--portrait-depth-x'), false);

  harness.motion.setQuality('low');
  for (let frame = 0; frame < 180; frame += 1) harness.tick(16);
  assert.ok(Math.abs(harness.motion.getState().headRotation) < 0.01);
  assert.ok(Math.abs(harness.motion.getState().headTranslation) < 0.01);
  harness.motion.destroy();
});

test('speech boundaries ease mouth movement to the 0.7 cap and add a subtle nod', () => {
  const harness = createHarness();
  harness.motion.setSpeaking(true);
  assert.equal(harness.motion.setSpeechCue(0.9, 'ou', { emphasis: true }), true);
  for (let frame = 0; frame < 20; frame += 1) harness.tick(16);

  const state = harness.motion.getState();
  assert.ok(state.mouthOpening > 0.2);
  assert.ok(state.mouthOpening <= 0.7);
  assert.ok(Math.abs(state.headRotation) <= 1.5);
  assert.equal(harness.styles.get('--portrait-mouth-open'), `${state.mouthOpening.toFixed(3)}`);

  harness.motion.setSpeaking(false);
  for (let frame = 0; frame < 40; frame += 1) harness.tick(16);
  assert.ok(harness.motion.getState().mouthOpening < 0.01);
  harness.motion.destroy();
});

test('thinking glance returns to center and listening applies only a tiny head tilt', () => {
  const harness = createHarness();
  harness.motion.setEyeMode('thinking');
  harness.tick();
  assert.notEqual(harness.motion.getState().gazeX, 0);

  for (let frame = 0; frame < 60; frame += 1) harness.tick(16);
  assert.ok(Math.abs(harness.motion.getState().gazeX) < 0.05);

  harness.motion.setEyeMode('listening');
  for (let frame = 0; frame < 12; frame += 1) harness.tick(16);
  assert.ok(Math.abs(harness.motion.getState().headRotation) <= 1.5);
  harness.motion.destroy();
});
