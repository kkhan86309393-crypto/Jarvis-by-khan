import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import {
  initializeAvatar3d,
  applyVrmExpressions,
  applySpeechBoundaryCue,
  applyHeadMotion,
  estimateAudioMouthOpening,
  estimateMouthCue,
  frameAvatarPortrait,
  inspectAvatarRig,
  parseAvatarGlb,
  readAvatarFile,
  validateAvatarFile,
  validateSelfContainedGlb,
} from '../public/avatar3d.js';

function makeMorphMesh(names) {
  const mesh = new THREE.Mesh();
  mesh.morphTargetDictionary = Object.fromEntries(names.map((name, index) => [name, index]));
  mesh.morphTargetInfluences = names.map(() => 0);
  const root = new THREE.Group();
  root.add(mesh);
  return root;
}

function makeGlb(document = {}) {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const buffer = new ArrayBuffer(20 + jsonLength);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20).fill(0x20);
  new Uint8Array(buffer, 20, json.length).set(json);
  return buffer;
}

test('detects usable mouth, blink, and expression morph targets', () => {
  const rig = inspectAvatarRig(makeMorphMesh([
    'jawOpen',
    'eyeBlinkLeft',
    'mouthSmileLeft',
    'browInnerUp',
    'listening',
  ]));

  assert.deepEqual(rig.mouthTargets.map(({ name }) => name), ['jawOpen']);
  assert.deepEqual(rig.blinkTargets.map(({ name }) => name), ['eyeBlinkLeft']);
  assert.deepEqual(rig.smileTargets.map(({ name }) => name), ['mouthSmileLeft']);
  assert.deepEqual(rig.thinkTargets.map(({ name }) => name), ['browInnerUp']);
  assert.deepEqual(rig.attentiveTargets.map(({ name }) => name), ['listening']);
});

test('rejects a face rig without a recognized mouth control', () => {
  const rig = inspectAvatarRig(makeMorphMesh(['eyeBlinkLeft', 'mouthSmileLeft']));
  assert.equal(rig.mouthTargets.length, 0);
});

test('rejects invalid files and GLBs that reference external assets', () => {
  assert.throws(() => validateAvatarFile({ name: 'avatar.gltf', size: 12 }), /self-contained \.glb/i);
  assert.doesNotThrow(() => validateAvatarFile({ name: 'avatar.vrm', size: 12 }));
  assert.throws(() => validateAvatarFile({ name: 'avatar.glb', size: 20 * 1024 * 1024 + 1 }), /20 MB/i);
  assert.throws(() => validateSelfContainedGlb(new ArrayBuffer(24)), /valid GLB 2\.0/i);
  assert.throws(() => validateSelfContainedGlb(makeGlb({ buffers: [{ uri: 'mesh.bin' }] })), /external files/i);
  assert.deepEqual(validateSelfContainedGlb(makeGlb({ asset: { version: '2.0' } })).asset, { version: '2.0' });
});

test('reads streamed model files and reports byte progress', async () => {
  const progress = [];
  const file = {
    size: 3,
    stream() {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3]));
          controller.close();
        },
      });
    },
  };

  assert.deepEqual(
    [...new Uint8Array(await readAvatarFile(file, (loaded, total) => progress.push([loaded, total])))],
    [1, 2, 3],
  );
  assert.deepEqual(progress, [[2, 3], [3, 3]]);
  assert.deepEqual([...new Uint8Array(await readAvatarFile({
    async arrayBuffer() { return new Uint8Array([4, 5]).buffer; },
  }))], [4, 5]);
});

test('surfaces GLTFLoader parse failures to the avatar fallback handler', async () => {
  let registeredPlugin = null;
  const loader = {
    register(pluginFactory) { registeredPlugin = pluginFactory({ json: {} }); },
    parse(_buffer, _path, _onLoad, onError) {
      onError(new Error('synthetic parser failure'));
    },
  };

  await assert.rejects(parseAvatarGlb(makeGlb(), loader), /synthetic parser failure/);
  assert.ok(registeredPlugin instanceof VRMLoaderPlugin);
});

test('maps VRM aa, ee, ih, oh, ou, blink, and happy presets and resets them', () => {
  const presets = new Set(['aa', 'ee', 'ih', 'oh', 'ou', 'blink', 'happy']);
  const values = new Map();
  const expressions = {
    getExpression(name) { return presets.has(name) ? { presetName: name } : null; },
    setValue(name, value) { values.set(name, value); },
  };

  applyVrmExpressions(expressions, {
    mouthViseme: 'ee',
    mouthValue: 0.65,
    blinkValue: 0.4,
    happy: 0.3,
  });
  for (const viseme of ['aa', 'ih', 'oh', 'ou']) assert.equal(values.get(viseme), 0);
  assert.equal(values.get('ee'), 0.65);
  assert.equal(values.get('blink'), 0.4);
  assert.equal(values.get('happy'), 0.3);

  applyVrmExpressions(expressions);
  for (const preset of presets) assert.equal(values.get(preset), 0);
});

test('maps live audio amplitude to a bounded mouth opening', () => {
  assert.equal(estimateAudioMouthOpening(new Float32Array(64)), 0);
  assert.equal(estimateAudioMouthOpening(new Float32Array()), 0);
  assert.ok(Math.abs(estimateAudioMouthOpening(new Float32Array(64).fill(0.1)) - 0.34) < 1e-6);
  assert.equal(estimateAudioMouthOpening(new Float32Array(64).fill(1)), 0.9);
});

test('frames a model around its head and falls back to model bounds', () => {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.7, 0.4)));
  const head = new THREE.Group();
  head.position.y = 0.62;
  root.add(head);
  root.position.y = -0.85;
  const camera = new THREE.PerspectiveCamera(33, 0.8, 0.01, 100);

  frameAvatarPortrait(camera, root, head);
  assert.ok(Math.abs(camera.position.y - (head.position.y + root.position.y)) < 1e-8);
  assert.ok(Math.abs(camera.position.z - 1.7 * 1.35) < 1e-6);
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).y < 0);

  frameAvatarPortrait(camera, root);
  assert.ok(Math.abs(camera.position.y - root.position.y) < 1e-8);
  assert.ok(Math.abs(camera.position.z - 1.7 * 1.35) < 1e-6);
});

test('adds subtle head movement without discarding the model rest pose', () => {
  const head = new THREE.Group();
  head.rotation.set(0.12, -0.08, 0.04);
  const baseRotation = head.rotation.clone();

  applyHeadMotion(head, baseRotation, 0, 0);
  assert.deepEqual(head.rotation.toArray(), baseRotation.toArray());
  applyHeadMotion(head, baseRotation, 1, 0.045);
  assert.equal(head.rotation.x, baseRotation.x + 0.045 + Math.sin(0.8) * 0.012);
  assert.equal(head.rotation.y, baseRotation.y + Math.sin(0.55) * 0.025);
  assert.equal(head.rotation.z, baseRotation.z + Math.sin(0.35) * 0.008);
});

test('speech word boundaries forward English and Hindi approximate viseme cues', () => {
  assert.deepEqual(estimateMouthCue('evening'), { opening: 0.36, viseme: 'ee' });
  assert.deepEqual(estimateMouthCue('सुनो'), { opening: 0.55, viseme: 'ou' });

  const cues = [];
  applySpeechBoundaryCue('evening now', { name: 'word', charIndex: 0, charLength: 7 }, (...cue) => cues.push(cue));
  applySpeechBoundaryCue('सुनो अब', { name: 'word', charIndex: 0, charLength: 4 }, (...cue) => cues.push(cue));
  applySpeechBoundaryCue('evening now', { name: 'sentence', charIndex: 0, charLength: 7 }, (...cue) => cues.push(cue));
  assert.deepEqual(cues, [[0.36, 'ee'], [0.55, 'ou']]);
});

test('opens the local file picker and preserves the portrait when a selected GLB fails', async () => {
  const previousWindow = globalThis.window;
  const listeners = new Map();
  let pickerClicks = 0;
  globalThis.window = { addEventListener() {} };

  const classList = { add() {}, remove() {} };
  const frame = { classList, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  const fileInput = {
    files: [],
    value: '',
    addEventListener(name, callback) { listeners.set(`file-${name}`, callback); },
    click() { pickerClicks += 1; },
  };
  const modelButton = {
    addEventListener(name, callback) { listeners.set(`button-${name}`, callback); },
  };
  const status = { textContent: '', dataset: {} };
  const canvas = { hidden: true, addEventListener() {} };
  const image = { classList };
  const mouthOverlay = { hidden: false };

  try {
    const avatar = initializeAvatar3d({
      frame,
      canvas,
      image,
      mouthOverlay,
      fileInput,
      modelButton,
      status,
    });
    listeners.get('button-click')();
    assert.equal(pickerClicks, 1);

    await avatar.loadModel({
      name: 'broken.glb',
      size: 24,
      async arrayBuffer() { return new ArrayBuffer(24); },
    });
    assert.match(status.textContent, /Could not load this model/);
    assert.match(status.textContent, /portrait remains active/);
    assert.equal(status.dataset.state, 'error');
    assert.equal(frame.attributes['aria-busy'], 'false');
    assert.equal(canvas.hidden, true);
    assert.equal(mouthOverlay.hidden, false);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('unload invalidates pending model loads and disposes their stale scene', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {} };
  let resolveParsed;
  let markParserStarted;
  const parserStarted = new Promise((resolve) => { markParserStarted = resolve; });
  let geometryDisposals = 0;
  const listeners = new Map();
  const classList = { add() {}, remove() {} };
  const frame = { classList, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry());
  mesh.geometry.dispose = () => { geometryDisposals += 1; };
  mesh.morphTargetDictionary = { jawOpen: 0 };
  mesh.morphTargetInfluences = [0];
  root.add(mesh);
  const fileInput = {
    files: [],
    value: '',
    addEventListener(name, callback) { listeners.set(name, callback); },
  };
  const status = { textContent: '', dataset: {} };
  const canvas = { hidden: true, addEventListener() {} };
  const image = { classList };

  try {
    const avatar = initializeAvatar3d({
      frame,
      canvas,
      image,
      mouthOverlay: { hidden: false },
      fileInput,
      modelButton: { addEventListener() {} },
      status,
      parseModel: () => {
        markParserStarted();
        return new Promise((resolve) => { resolveParsed = resolve; });
      },
    });
    const pendingLoad = avatar.loadModel({ name: 'delayed.glb', size: 12, async arrayBuffer() { return makeGlb(); } });
    await parserStarted;
    avatar.unload();
    resolveParsed({ scene: root, userData: {} });
    await pendingLoad;

    assert.equal(geometryDisposals, 1);
    assert.equal(canvas.hidden, true);
    assert.equal(status.textContent, 'Validating and parsing the local avatar...');
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});