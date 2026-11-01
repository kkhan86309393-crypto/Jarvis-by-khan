import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

function getFunction(name, nextName, context) {
  const asyncStart = app.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : app.indexOf(`function ${name}(`);
  const nextSync = app.indexOf(`\nfunction ${nextName}(`, start + 1);
  const nextAsync = app.indexOf(`\nasync function ${nextName}(`, start + 1);
  const end = [nextSync, nextAsync].filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? -1;
  assert.notEqual(start, -1, `Expected ${name} to exist in app.js`);
  assert.notEqual(end, -1, `Expected ${nextName} to follow ${name} in app.js`);
  return vm.runInNewContext(`${app.slice(start, end)}\n${name}`, context);
}

function createVisionElements() {
  return {
    screenCaptureDialog: {
      open: true,
      showModal() {
        this.open = true;
      },
    },
    capturePreview: { srcObject: null, hidden: true },
    captureFramePreview: {
      hidden: true,
      removeAttribute(name) {
        this[name] = '';
      },
    },
    captureFrameButton: { disabled: false, textContent: 'Capture one frame' },
    stopCaptureButton: { disabled: true },
    captureStatus: { textContent: '' },
    visionQuestion: {
      value: '',
      disabled: true,
      focus() {
        this.focused = true;
      },
    },
    visionSendButton: { disabled: true },
    downloadCapture: {
      hidden: true,
      removeAttribute(name) {
        this[name] = '';
      },
    },
    captureCanvas: {},
  };
}

function track() {
  return {
    stopCount: 0,
    stop() {
      this.stopCount += 1;
    },
    addEventListener(name, callback, options) {
      this.listener = { name, callback, options };
    },
  };
}

function captureState(overrides = {}) {
  return {
    visionCaptureSequence: 4,
    visionAbortController: null,
    visionFrame: null,
    captureObjectUrl: null,
    visionSending: false,
    preferences: { fullAccessEnabled: true },
    displayStream: null,
    ...overrides,
  };
}

test('Vision dialog exposes permission, preview, question, send, download, emergency-stop and status controls', () => {
  const dialog = html.match(/<dialog class="settings-dialog" id="screen-capture-dialog"[\s\S]*?<\/dialog>/)?.[0] || '';

  assert.match(dialog, /id="screen-capture-dialog"/);
  assert.match(dialog, /Choose a screen or window in the browser picker/);
  assert.match(dialog, /id="capture-preview"[^>]*hidden/);
  assert.match(dialog, /id="capture-frame-preview"[^>]*hidden/);
  assert.match(dialog, /id="capture-frame-button"[^>]*disabled/);
  assert.match(dialog, /id="vision-question"[^>]*maxlength="500"[^>]*disabled/);
  assert.match(dialog, /id="vision-send-button"[^>]*disabled/);
  assert.match(dialog, /id="download-capture"[^>]*hidden/);
  assert.match(dialog, /id="stop-capture-button"[^>]*disabled>Emergency Stop/);
  assert.match(dialog, /id="capture-status" role="status" aria-live="polite"/);
  assert.match(app, /elements\.captureFrameButton\.addEventListener\('click'/);
  assert.match(app, /elements\.stopCaptureButton\.addEventListener\('click', emergencyStopVision\)/);
  assert.match(app, /elements\.screenCaptureDialog\.addEventListener\('close'/);

  const captureHandler = app.slice(app.indexOf('async function captureScreenFrame'), app.indexOf('async function sendVisionFrame'));
  assert.doesNotMatch(captureHandler, /fetch\(|\/api\//);
});

test('Vision binds each request to the selected provider instead of silently routing elsewhere', () => {
  const start = app.indexOf('async function sendVisionFrame');
  const end = app.indexOf('\nfunction handleNavigation', start);
  const sendVisionFrame = app.slice(start, end);

  assert.match(sendVisionFrame, /provider: elements\.aiProvider\.value/);
  assert.match(sendVisionFrame, /fetch\('\/api\/vision'/);
});

test('screen picker success is mocked, user-approved, and limited to video capture', async () => {
  const videoTrack = track();
  const stream = {
    getTracks: () => [videoTrack],
    getVideoTracks: () => [videoTrack],
  };
  const elements = createVisionElements();
  const state = captureState();
  const requestedConstraints = [];
  const activities = [];
  const startScreenCapture = getFunction('startScreenCapture', 'stopScreenCapture', {
    navigator: {
      mediaDevices: {
        async getDisplayMedia(constraints) {
          requestedConstraints.push(constraints);
          return stream;
        },
      },
    },
    state,
    elements,
    stopScreenCapture() {},
    logActivity: (activity) => activities.push(activity),
  });

  await startScreenCapture(4);

  assert.deepEqual(JSON.parse(JSON.stringify(requestedConstraints)), [{ video: true, audio: false }]);
  assert.equal(state.displayStream, stream);
  assert.equal(elements.capturePreview.srcObject, stream);
  assert.equal(elements.capturePreview.hidden, false);
  assert.equal(elements.captureFrameButton.disabled, false);
  assert.equal(elements.captureFrameButton.textContent, 'Capture one frame');
  assert.equal(elements.stopCaptureButton.disabled, false);
  assert.equal(videoTrack.listener.name, 'ended');
  assert.equal(videoTrack.listener.options.once, true);
  assert.deepEqual(activities, ['Screen sharing approved by user']);
});

test('Vision reports unsupported and denied screen-picker states without opening a device prompt', async () => {
  const elements = createVisionElements();
  const state = captureState();
  const unsupportedStart = getFunction('startScreenCapture', 'stopScreenCapture', {
    navigator: {},
    state,
    elements,
    logActivity() {},
  });

  await unsupportedStart(4);
  assert.match(elements.captureStatus.textContent, /not supported/);
  assert.equal(elements.captureFrameButton.textContent, 'Screen capture unavailable');

  const deniedElements = createVisionElements();
  const deniedStart = getFunction('startScreenCapture', 'stopScreenCapture', {
    navigator: {
      mediaDevices: {
        async getDisplayMedia() {
          const error = new Error('Permission was denied');
          error.name = 'NotAllowedError';
          throw error;
        },
      },
    },
    state: captureState(),
    elements: deniedElements,
    logActivity() {},
  });

  await deniedStart(4);
  assert.equal(deniedElements.captureStatus.textContent, 'Screen capture was cancelled or denied.');
  assert.equal(deniedElements.captureFrameButton.disabled, false);
  assert.equal(deniedElements.captureFrameButton.textContent, 'Choose screen again');

  const failedElements = createVisionElements();
  const failedStart = getFunction('startScreenCapture', 'stopScreenCapture', {
    navigator: {
      mediaDevices: {
        async getDisplayMedia() {
          throw new Error('Browser picker failed');
        },
      },
    },
    state: captureState(),
    elements: failedElements,
    logActivity() {},
  });

  await failedStart(4);
  assert.equal(failedElements.captureStatus.textContent, 'Screen capture unavailable: Browser picker failed');
  assert.equal(failedElements.captureFrameButton.disabled, false);
  assert.equal(failedElements.captureFrameButton.textContent, 'Choose screen again');
});

test('stale picker results stop their tracks and never attach a stream', async () => {
  const videoTrack = track();
  const stream = { getTracks: () => [videoTrack], getVideoTracks: () => [videoTrack] };
  const elements = createVisionElements();
  const state = captureState();
  let resolvePicker;
  const startScreenCapture = getFunction('startScreenCapture', 'stopScreenCapture', {
    navigator: {
      mediaDevices: {
        getDisplayMedia: () => new Promise((resolve) => {
          resolvePicker = resolve;
        }),
      },
    },
    state,
    elements,
    logActivity() {},
  });

  const pickerRequest = startScreenCapture(4);
  state.visionCaptureSequence += 1;
  resolvePicker(stream);
  await pickerRequest;

  assert.equal(videoTrack.stopCount, 1);
  assert.equal(state.displayStream, null);
  assert.equal(elements.capturePreview.srcObject, null);
});

test('one frame stays a local preview and stops screen sharing before Send is enabled', async () => {
  const videoTrack = track();
  const blob = { size: 2_048 };
  const elements = createVisionElements();
  elements.capturePreview.videoWidth = 1280;
  elements.capturePreview.videoHeight = 720;
  const state = captureState({ displayStream: { getTracks: () => [videoTrack] } });
  const activities = [];
  let sendButtonUpdates = 0;
  const captureScreenFrame = getFunction('captureScreenFrame', 'sendVisionFrame', {
    state,
    elements,
    URL: { createObjectURL: () => 'blob:local-preview' },
    createVisionFrame: async () => ({ blob, width: 1280, height: 720 }),
    stopScreenCapture: getFunction('stopScreenCapture', 'updateVisionSendButton', { state, elements }),
    updateVisionSendButton() {
      sendButtonUpdates += 1;
      elements.visionSendButton.disabled = !(state.visionFrame && elements.visionQuestion.value.trim());
    },
    logActivity: (activity) => activities.push(activity),
  });

  await captureScreenFrame();

  assert.equal(state.visionFrame, blob);
  assert.equal(state.captureObjectUrl, 'blob:local-preview');
  assert.equal(elements.captureFramePreview.src, 'blob:local-preview');
  assert.equal(elements.captureFramePreview.hidden, false);
  assert.equal(elements.downloadCapture.href, 'blob:local-preview');
  assert.equal(elements.downloadCapture.hidden, false);
  assert.equal(elements.visionQuestion.disabled, false);
  assert.equal(elements.visionSendButton.disabled, true);
  assert.equal(elements.captureFrameButton.disabled, true);
  assert.equal(videoTrack.stopCount, 1);
  assert.match(elements.captureStatus.textContent, /Nothing has been sent/);
  assert.deepEqual(activities, ['One screen frame captured locally']);
  assert.equal(sendButtonUpdates, 1);
});

test('opening Vision is gated by Full Access and starts the browser picker only after approval', () => {
  const elements = createVisionElements();
  let clearedFrames = 0;
  const pickerSequences = [];
  const state = captureState({
    preferences: { fullAccessEnabled: false },
    visionCaptureSequence: 10,
  });
  const openVisionDialog = getFunction('openVisionDialog', 'emergencyStopVision', {
    elements: {
      ...elements,
      applicationDialog: { open: false, close() {} },
    },
    state,
    clearVisionFrame() {
      clearedFrames += 1;
    },
    startScreenCapture(sequence) {
      pickerSequences.push(sequence);
    },
  });

  openVisionDialog();
  assert.equal(elements.screenCaptureDialog.open, true);
  assert.equal(state.visionCaptureSequence, 10);
  assert.equal(clearedFrames, 0);
  assert.deepEqual(pickerSequences, []);

  state.preferences.fullAccessEnabled = true;
  openVisionDialog();
  assert.equal(state.visionCaptureSequence, 11);
  assert.equal(clearedFrames, 1);
  assert.deepEqual(pickerSequences, [11]);
});

test('Emergency Stop aborts pending work, stops capture, and clears local frame state', () => {
  const videoTrack = track();
  const elements = createVisionElements();
  const revokedUrls = [];
  let sendButtonUpdates = 0;
  let aborted = 0;
  const state = captureState({
    displayStream: { getTracks: () => [videoTrack] },
    visionFrame: { size: 12 },
    captureObjectUrl: 'blob:local-preview',
    visionAbortController: { abort: () => { aborted += 1; } },
  });
  const stopScreenCapture = getFunction('stopScreenCapture', 'updateVisionSendButton', {
    state,
    elements,
  });
  const emergencyStopVision = getFunction('emergencyStopVision', 'canvasToJpeg', {
    state,
    elements,
    URL: { revokeObjectURL: (url) => revokedUrls.push(url) },
    stopScreenCapture,
    clearVisionFrame: getFunction('clearVisionFrame', 'openVisionDialog', {
      state,
      elements,
      URL: { revokeObjectURL: (url) => revokedUrls.push(url) },
      updateVisionSendButton: () => { sendButtonUpdates += 1; },
    }),
  });

  emergencyStopVision();

  assert.equal(state.visionCaptureSequence, 5);
  assert.equal(aborted, 1);
  assert.equal(videoTrack.stopCount, 1);
  assert.equal(state.displayStream, null);
  assert.equal(state.visionFrame, null);
  assert.equal(state.captureObjectUrl, null);
  assert.deepEqual(revokedUrls, ['blob:local-preview']);
  assert.equal(elements.capturePreview.srcObject, null);
  assert.equal(elements.capturePreview.hidden, true);
  assert.equal(elements.captureFramePreview.hidden, true);
  assert.equal(elements.stopCaptureButton.disabled, true);
  assert.match(elements.captureStatus.textContent, /Emergency Stop/);
  assert.equal(sendButtonUpdates, 1);
});
