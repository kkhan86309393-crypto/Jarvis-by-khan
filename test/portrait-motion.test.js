import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPortraitMotion,
  DEFAULT_PORTRAIT_LIVELINESS,
  getPortraitLiveliness,
  REDUCED_MOTION_LIVELINESS,
} from '../public/portrait-motion.js';

function createHarness({ reducedMotion = false, quality = 'high', random = () => 0.5, orientationApi } = {}) {
  let time = 0;
  let nextFrameId = 0;
  const frames = new Map();
  const createTarget = (bounds = { left: 0, top: 0, width: 100, height: 100 }) => {
    const listeners = new Map();
    const styles = new Map();
    return {
      listeners,
      styles,
      style: { setProperty: (name, value) => styles.set(name, value) },
      getBoundingClientRect: () => bounds,
      addEventListener(type, listener) {
        const values = listeners.get(type) || new Set();
        values.add(listener);
        listeners.set(type, values);
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener);
      },
      dispatch(type, event = {}) {
        for (const listener of listeners.get(type) || []) listener(event);
      },
    };
  };
  const stage = createTarget();
  const portraitFrame = createTarget();
  const portraitArtwork = createTarget();
  const sphere = createTarget();
  const mouth = createTarget();
  const queryListeners = new Set();
  const reducedMotionQuery = {
    matches: reducedMotion,
    addEventListener(type, listener) {
      if (type === 'change') queryListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'change') queryListeners.delete(listener);
    },
  };
  const windowListeners = new Map();
  const documentListeners = new Map();
  const windowRef = {
    DeviceOrientationEvent: orientationApi,
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
    addEventListener(type, listener) {
      const values = windowListeners.get(type) || new Set();
      values.add(listener);
      windowListeners.set(type, values);
    },
    removeEventListener(type, listener) {
      windowListeners.get(type)?.delete(listener);
    },
  };
  const motion = createPortraitMotion({
    stage,
    portraitFrame,
    portraitArtwork,
    sphere,
    mouth,
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

  function setReducedMotion(matches) {
    reducedMotionQuery.matches = matches;
    queryListeners.forEach((listener) => listener({ matches }));
  }

  return {
    motion,
    stage,
    portraitFrame,
    portraitArtwork,
    sphere,
    mouth,
    windowRef,
    windowListeners,
    tick,
    setReducedMotion,
  };
}

test('portrait liveliness uses the default and reduced-motion values', () => {
  assert.equal(DEFAULT_PORTRAIT_LIVELINESS, 0.6);
  assert.equal(REDUCED_MOTION_LIVELINESS, 0.15);
  assert.equal(getPortraitLiveliness(), 0.6);
  assert.equal(getPortraitLiveliness(true), 0.15);

  const harness = createHarness({ reducedMotion: true });
  assert.equal(harness.motion.liveliness, 0.15);
  harness.setReducedMotion(false);
  assert.equal(harness.motion.liveliness, 0.6);
  harness.motion.destroy();
});

test('pointer tilt is bounded, depth offsets oppose, and low quality disables the effect', () => {
  const harness = createHarness();
  harness.stage.dispatch('pointermove', {
    pointerType: 'mouse',
    clientX: 100,
    clientY: 0,
  });
  for (let frame = 0; frame < 24; frame += 1) harness.tick();

  const state = harness.motion.getState();
  assert.ok(Math.abs(state.tiltX) <= 3);
  assert.ok(Math.abs(state.tiltY) <= 3);
  assert.ok(state.tiltX > 2.8);
  assert.ok(state.depthX > 4);
  assert.ok(state.sphereDepthX < -2.8);

  harness.motion.setQuality('low');
  harness.tick();
  assert.equal(harness.motion.getState().tiltX, 0);
  assert.equal(harness.motion.getState().tiltY, 0);
  assert.equal(harness.motion.getState().depthX, 0);
  harness.motion.destroy();
});

test('speech cues open the mouth within the cap and emphasize with a small nod', () => {
  const harness = createHarness();
  harness.motion.setSpeaking(true);
  assert.equal(harness.motion.setSpeechCue(0.9, 'aa', { emphasis: true }), true);
  harness.tick();
  assert.ok(harness.motion.getState().mouthOpening > 0.2);
  assert.ok(harness.motion.getState().mouthOpening <= 0.42);
  for (let frame = 0; frame < 6; frame += 1) harness.tick(30);
  assert.ok(Math.abs(harness.motion.getState().nod) <= 1.5);
  harness.motion.setSpeaking(false);
  harness.tick();
  assert.equal(harness.motion.getState().mouthOpening, 0);
  harness.motion.destroy();
});

test('device orientation permission is requested only after a gesture when required', async () => {
  let permissionRequests = 0;
  const harness = createHarness({
    orientationApi: {
      requestPermission() {
        permissionRequests += 1;
        return Promise.resolve('granted');
      },
    },
  });

  assert.equal(permissionRequests, 0);
  harness.stage.dispatch('pointerdown', {
    pointerType: 'touch',
    clientX: 50,
    clientY: 50,
  });
  await Promise.resolve();
  assert.equal(permissionRequests, 1);
  assert.equal(harness.windowListeners.get('deviceorientation')?.size, 1);
  harness.motion.destroy();
});
