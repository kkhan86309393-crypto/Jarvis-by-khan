import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import {
  initializeAvatar3d,
  applyVrmExpressions,
  applySpeechBoundaryCue,
  applyHeadMotion,
  animateBuiltInAvatar,
  createReferenceFaceTexture,
  createBuiltInAvatar,
  createHolographicGlobe,
  animateHolographicGlobe,
  estimateAudioMouthOpening,
  estimateMouthCue,
  frameAvatarPortrait,
  getAvatarRenderQuality,
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

test('selects reduced avatar quality for mobile and low-power devices', () => {
  assert.deepEqual(getAvatarRenderQuality({
    navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
    viewportWidth: 1280,
    devicePixelRatio: 2,
    hasCoarsePointer: false,
  }), {
    isMobile: false,
    isLowPower: false,
    antialias: true,
    pixelRatio: 1.35,
  });
  assert.deepEqual(getAvatarRenderQuality({
    navigator: { hardwareConcurrency: 8, userAgentData: { mobile: true } },
    viewportWidth: 390,
    devicePixelRatio: 3,
    hasCoarsePointer: true,
  }), {
    isMobile: true,
    isLowPower: false,
    antialias: false,
    pixelRatio: 1,
  });
  assert.deepEqual(getAvatarRenderQuality({
    navigator: { hardwareConcurrency: 4, connection: { saveData: false } },
    viewportWidth: 1280,
    devicePixelRatio: 1.5,
    hasCoarsePointer: false,
  }), {
    isMobile: false,
    isLowPower: true,
    antialias: false,
    pixelRatio: 1,
  });
});

test('maps the bundled reference photo onto a lightweight, lit face texture', () => {
  const previousDocument = globalThis.document;
  const drawCalls = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        drawImage(...args) { drawCalls.push(args); },
        save() {},
        translate() {},
        scale() {},
        restore() {},
      };
    },
  };
  const reference = { width: 1536, height: 1536 };
  globalThis.document = { createElement(name) {
    assert.equal(name, 'canvas');
    return canvas;
  } };

  try {
    const texture = createReferenceFaceTexture(reference);
    assert.equal(canvas.width, 256);
    assert.equal(canvas.height, 256);
    assert.equal(drawCalls.length, 2);
    assert.equal(drawCalls[0][0], reference);
    assert.equal(drawCalls[0][1], 1536 * 0.32);
    assert.equal(drawCalls[0][3], 1536 * 0.36);
    assert.equal(drawCalls[0][4], 1536 * 0.6);
    assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
    assert.equal(texture.minFilter, THREE.LinearFilter);
    assert.equal(texture.generateMipmaps, false);
    texture.dispose();
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('creates a built-in holographic avatar with facial controls and animation', () => {
  const { root, rig } = createBuiltInAvatar();
  assert.equal(root.name, 'jarvis-holographic-avatar');
  for (const name of ['face', 'hair-cap', 'left-side-hair', 'right-side-hair', 'eyelid-1', 'eyelid--1', 'iris-1', 'mouth', 'shoulders']) {
    assert.ok(root.getObjectByName(name), `expected built-in avatar part ${name}`);
  }
  assert.equal(root.getObjectByName('face').material.map.image.width, 128);
  assert.equal(root.getObjectByName('hair-cap').material.color.getHex(), 0x211711);
  assert.equal(root.getObjectByName('eyelid-1').material.color.getHex(), 0xd8ad98);
  assert.equal(root.getObjectByName('iris-1').children[0].material.color.getHex(), 0x70472e);
  for (const name of ['nose-bridge', 'nose-tip', 'nose-wing--1', 'nose-wing-1', 'sclera--1', 'sclera-1', 'eye-reflection--1', 'eye-reflection-1', 'upper-lip', 'lower-lip']) {
    assert.ok(root.getObjectByName(name), `expected refined facial detail ${name}`);
  }
  assert.equal(root.getObjectByName('nose-wing--1').position.x, -root.getObjectByName('nose-wing-1').position.x);
  assert.equal(root.getObjectByName('eye--1').position.x, -root.getObjectByName('eye-1').position.x);
  assert.equal(rig.lids[0].position.x, -0.19);
  assert.equal(rig.mouth.position.y, -0.32);
  assert.equal(rig.brows.length, 2);
  assert.ok(root.getObjectByName('brow--1'));
  assert.ok(root.getObjectByName('brow-1'));

  animateBuiltInAvatar(rig, { blinkValue: 0, mouthValue: 0 });
  const openLidScale = rig.lids[0].scale.y;
  const restingGazeX = rig.pupils[0].position.x;
  const closedMouthScale = rig.mouth.scale.y;
  rig.seconds = 1;
  animateBuiltInAvatar(rig, { blinkValue: 1, mouthValue: 0.8, mouthViseme: 'aa', happy: 0.4, attentive: 1 });
  assert.ok(rig.lids[0].scale.y > openLidScale);
  assert.ok(rig.lids[0].position.y < rig.lids[0].userData.openY);
  assert.notEqual(rig.pupils[0].position.x, restingGazeX);
  assert.ok(rig.mouth.scale.y > closedMouthScale);
  assert.ok(rig.mouth.scale.x > 0.068);
  assert.ok(rig.head.rotation.z > 0);

  root.traverse((object) => {
    object.geometry?.dispose();
    object.material?.dispose();
  });
});

test('creates a procedural Earth with continent texture, grid, orbit rings, particles, and scanline', () => {
  const { root, globe, orbitRings, particles, scanline } = createHolographicGlobe();
  assert.equal(root.name, 'jarvis-holographic-earth');
  for (const name of ['earth-globe', 'earth-atmosphere', 'earth-ocean', 'earth-continents', 'earth-latitude-0', 'earth-longitude-0']) {
    assert.ok(root.getObjectByName(name), `expected globe feature ${name}`);
  }
  assert.equal(orbitRings.length, 2);
  assert.equal(root.getObjectByName('earth-ocean').material.transparent, true);
  assert.ok(root.getObjectByName('earth-ocean').material.opacity < 0.2);
  assert.equal(root.getObjectByName('earth-ocean').material.depthWrite, false);
  assert.equal(particles.geometry.attributes.position.count, 84);
  assert.equal(scanline.geometry.attributes.position.count, 97);

  const texture = root.getObjectByName('earth-continents').material.map;
  assert.equal(texture.image.width, 768);
  assert.equal(texture.image.height, 384);
  const samplePixel = (longitude, latitude) => {
    const x = Math.round(((longitude + 180) / 360) * (texture.image.width - 1));
    const y = Math.round(((latitude + 90) / 180) * (texture.image.height - 1));
    const offset = (y * texture.image.width + x) * 4;
    return [...texture.image.data.slice(offset, offset + 4)];
  };
  assert.ok(samplePixel(-100, 40)[3] > samplePixel(-40, 0)[3], 'North America should be brighter than open ocean');
  assert.ok(samplePixel(-77.14, 1.06)[0] > 100, 'coastline pixels should have a bright cyan edge');
  assert.ok(samplePixel(-77.85, 1.06)[3] > samplePixel(-40, 0)[3], 'nearby ocean pixels should carry a soft coastal glow');

  const globeGrid = globe.children.filter((object) => /^earth-(latitude|longitude)-/.test(object.name));
  assert.equal(globeGrid.length, 53, 'the globe should use a denser ten-degree latitude/longitude grid');
  assert.ok(root.getObjectByName('earth-latitude--80'));
  assert.ok(root.getObjectByName('earth-longitude-350'));
  assert.equal(root.getObjectByName('earth-latitude-0').geometry.attributes.position.count, 181);

  animateHolographicGlobe({ globe, orbitRig: root.getObjectByName('earth-orbit-rings'), particles, scanline }, 4);
  assert.ok(globe.rotation.y > 0);
  const rotatedY = globe.rotation.y;
  animateHolographicGlobe({ globe, orbitRig: root.getObjectByName('earth-orbit-rings'), particles, scanline }, 8, { reducedMotion: true });
  assert.equal(globe.rotation.y, rotatedY);

  root.traverse((object) => {
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material?.dispose());
  });
});

test('gives built-in avatar assistant states distinct facial cues', () => {
  const pose = (expression) => {
    const { root, rig } = createBuiltInAvatar();
    rig.seconds = 1;
    animateBuiltInAvatar(rig, expression);
    const result = {
      browY: rig.brows.map((brow) => brow.position.y),
      browRotation: rig.brows.map((brow) => brow.rotation.z),
      headRoll: rig.head.rotation.z,
      gazeY: rig.gazeY,
      mouthX: rig.mouth.scale.x,
      mouthY: rig.mouth.scale.y,
      mouthPositionY: rig.mouth.position.y,
      mouthRotation: rig.mouth.rotation.z,
      lidScale: rig.lids[0].scale.y,
    };
    root.traverse((object) => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
    return result;
  };

  const neutral = pose({});
  const happy = pose({ happy: 0.72 });
  const thinking = pose({ thinking: 0.68 });
  const listening = pose({ attentive: 0.62 });
  const speaking = pose({ mouthValue: 0.7, mouthViseme: 'oh' });
  const error = pose({ frown: 0.72 });

  assert.ok(happy.browY[0] > neutral.browY[0]);
  assert.ok(happy.mouthX > neutral.mouthX);
  assert.ok(thinking.browY[0] < neutral.browY[0]);
  assert.ok(thinking.gazeY > neutral.gazeY);
  assert.ok(listening.browY[0] > neutral.browY[0]);
  assert.ok(listening.headRoll > neutral.headRoll);
  assert.ok(speaking.mouthY > neutral.mouthY);
  assert.ok(error.mouthPositionY < neutral.mouthPositionY);
  assert.ok(error.mouthRotation < neutral.mouthRotation);
  assert.ok(error.lidScale > neutral.lidScale);
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

test('loads and unloads the holographic Earth through the shared renderer lifecycle', () => {
  const previousGlobals = new Map(
    ['window', 'document', 'ResizeObserver', 'IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame']
      .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const classes = new Set();
  const listeners = new Map();
  let animationCallback = null;
  let animationRequests = 0;
  let renderCount = 0;
  let rendererDisposed = false;
  let motionListenerRemoved = false;
  let clearAlpha;
  let renderedSize;
  let renderedScene;
  let renderedCamera;
  let devicePixelRatio = 1;
  const renderer = {
    outputColorSpace: null,
    setPixelRatio(value) { devicePixelRatio = value; },
    getPixelRatio() { return devicePixelRatio; },
    setSize(width, height) { renderedSize = [width, height]; },
    setClearColor(_color, alpha) { clearAlpha = alpha; },
    render(scene, camera) {
      renderCount += 1;
      renderedScene = scene;
      renderedCamera = camera;
    },
    dispose() { rendererDisposed = true; },
  };
  const frame = {
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
    },
    setAttribute() {},
    getBoundingClientRect() { return { width: 320, height: 320 }; },
  };
  const canvas = {
    hidden: true,
    addEventListener(name, callback) { listeners.set(name, callback); },
    getBoundingClientRect() { return { width: 640, height: 640 }; },
  };
  const image = {
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
    },
  };
  const status = { textContent: '', dataset: {} };

  globalThis.window = {
    matchMedia() {
      return {
        matches: true,
        addEventListener() {},
        removeEventListener() { motionListenerRemoved = true; },
      };
    },
    addEventListener() {},
  };
  globalThis.document = { visibilityState: 'visible', addEventListener() {} };
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.IntersectionObserver = undefined;
  globalThis.requestAnimationFrame = (callback) => {
    animationRequests += 1;
    animationCallback = callback;
    return animationRequests;
  };
  globalThis.cancelAnimationFrame = () => {};

  try {
    const globe = initializeAvatar3d({
      frame,
      canvas,
      image,
      mouthOverlay: { hidden: false },
      fileInput: null,
      modelButton: null,
      status,
      createRenderer: () => renderer,
    });

    assert.equal(globe.loadBuiltInGlobe(), true);
    assert.equal(canvas.hidden, false);
    assert.equal(clearAlpha, 0, 'transparent renderer clear must leave the portrait visible');
    assert.deepEqual(renderedSize, [640, 640], 'globe renderer should use the full stage canvas size');
    assert.ok(classes.has('is-3d-active'));
    assert.ok(classes.has('is-globe-active'));
    assert.equal(classes.has('is-3d-hidden'), false, 'the Earth must render behind the visible portrait');
    assert.equal(canvas.hidden, false);
    assert.match(status.textContent, /Holographic Earth online/);

    animationCallback(1_000);
    assert.equal(renderCount, 1);
    const globeRoot = renderedScene.getObjectByName('jarvis-holographic-earth');
    assert.ok(globeRoot, 'the Earth and orbital effects should share one transformed root');
    assert.equal(globeRoot.scale.x, 1.5, 'the Earth should fill more of the projection while remaining behind the portrait');
    assert.deepEqual(globeRoot.position.toArray(), [0, 0, 0], 'the Earth should align horizontally and vertically with the portrait');
    const halfVisibleAngle = Math.atan(
      Math.tan(THREE.MathUtils.degToRad(renderedCamera.fov / 2))
      * Math.min(renderedCamera.aspect, 1),
    );
    const visibleFrameRadius = renderedCamera.position.z * Math.sin(halfVisibleAngle);
    const particlePositions = globeRoot.getObjectByName('earth-particles').geometry.attributes.position;
    const outerParticle = Math.max(
      ...Array.from({ length: particlePositions.count }, (_, index) => {
        return Math.hypot(particlePositions.getX(index), particlePositions.getY(index), particlePositions.getZ(index));
      }),
    );
    const outerOrbit = Math.max(...globeRoot.getObjectByName('earth-orbit-rings').children.map(
      (ring) => ring.geometry.parameters.radius + ring.geometry.parameters.tube,
    ));
    const outerContentRadius = Math.max(outerParticle, outerOrbit, 1.075) * globeRoot.scale.x;
    assert.ok(
      visibleFrameRadius > outerContentRadius,
      'camera framing should include the complete globe, atmosphere, particles, and orbital rings',
    );
    assert.equal(animationRequests, 1, 'reduced-motion mode should render a still globe without an animation loop');

    assert.equal(globe.loadBuiltInAvatar(), true);
    assert.equal(classes.has('is-globe-active'), false);
    assert.equal(classes.has('is-3d-hidden'), true, 'the optional 3D avatar mode should retain its existing portrait replacement');

    globe.unload();
    assert.equal(rendererDisposed, true);
    assert.equal(motionListenerRemoved, true);
    assert.equal(canvas.hidden, true);
    assert.equal(classes.has('is-3d-hidden'), false);
    assert.equal(classes.has('is-globe-active'), false);
  } finally {
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});