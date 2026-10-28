import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { estimateMouthCue } from './avatar-cues.js';

export { applySpeechBoundaryCue, estimateAudioMouthOpening, estimateMouthCue } from './avatar-cues.js';

const MAX_MODEL_BYTES = 20 * 1024 * 1024;
const MOUTH_PATTERN = /(?:jaw[\s._-]*open|mouth[\s._-]*open|viseme[\s._-]*(?:aa|a|ee|ih|oh|ou))/i;
const BLINK_PATTERN = /(?:blink|eye[\s._-]*closed|eyes[\s._-]*closed)/i;
const SMILE_PATTERN = /(?:smile|happy|joy)/i;
const ATTENTIVE_PATTERN = /(?:attentive|interest|listening)/i;
const THINK_PATTERN = /(?:think|brow[\s._-]*(?:down|inner)|concern)/i;
const FROWN_PATTERN = /(?:frown|sad|angry)/i;

function collectMorphTargets(root) {
  const targets = [];
  root.traverse((object) => {
    if (!object.isMesh || !object.morphTargetDictionary || !object.morphTargetInfluences) return;
    for (const [name, index] of Object.entries(object.morphTargetDictionary)) {
      targets.push({ object, index, name });
    }
  });
  return targets;
}

function findMorphs(targets, pattern) {
  return targets.filter(({ name }) => pattern.test(name));
}

function disposeScene(root) {
  root.traverse((object) => {
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value?.isTexture) value.dispose();
      }
      material.dispose();
    }
  });
}

function disposeParsedAvatar(gltf) {
  const vrm = gltf?.userData?.vrm;
  if (vrm) VRMUtils.deepDispose(vrm.scene);
  else if (gltf?.scene) disposeScene(gltf.scene);
}

export function inspectAvatarRig(root) {
  const morphTargets = collectMorphTargets(root);
  return {
    morphTargets,
    mouthTargets: findMorphs(morphTargets, MOUTH_PATTERN),
    blinkTargets: findMorphs(morphTargets, BLINK_PATTERN),
    smileTargets: findMorphs(morphTargets, SMILE_PATTERN),
    attentiveTargets: findMorphs(morphTargets, ATTENTIVE_PATTERN),
    thinkTargets: findMorphs(morphTargets, THINK_PATTERN),
    frownTargets: findMorphs(morphTargets, FROWN_PATTERN),
  };
}

export function validateAvatarFile(file) {
  if (!file || !/\.(?:glb|vrm)$/i.test(file.name)) {
    throw new Error('Choose a self-contained .glb or .vrm file. External .gltf assets are not loaded.');
  }
  if (file.size > MAX_MODEL_BYTES) {
    throw new Error('The avatar file must be 20 MB or smaller.');
  }
}

export async function readAvatarFile(file, onProgress = () => {}) {
  if (typeof file.stream !== 'function') return file.arrayBuffer();
  const reader = file.stream().getReader();
  const chunks = [];
  let loaded = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress(loaded, file.size);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

export function validateSelfContainedGlb(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error('The file is not a valid GLB 2.0 model.');
  }
  if (view.getUint32(8, true) !== view.byteLength) {
    throw new Error('The GLB file length is invalid.');
  }
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || jsonLength + 20 > view.byteLength) {
    throw new Error('The GLB does not contain a valid JSON chunk.');
  }
  let document;
  try {
    document = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
  } catch {
    throw new Error('The GLB JSON chunk is invalid.');
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('The GLB does not contain a valid model document.');
  }
  const resources = [...(document.buffers || []), ...(document.images || [])];
  if (resources.some((resource) => typeof resource.uri === 'string' && !resource.uri.startsWith('data:'))) {
    throw new Error('The GLB references external files; embed all buffers and textures in the model.');
  }
  return document;
}

export function parseAvatarGlb(buffer, loader) {
  validateSelfContainedGlb(buffer);
  const gltfLoader = loader || new GLTFLoader();
  gltfLoader.register((parser) => new VRMLoaderPlugin(parser));
  return new Promise((resolve, reject) => gltfLoader.parse(buffer, '', resolve, reject));
}

export function applyVrmExpressions(expressions, {
  mouthViseme = 'aa',
  mouthValue = 0,
  blinkValue = 0,
  happy = 0,
  attentive = 0,
  thinking = 0,
  frown = 0,
} = {}) {
  if (!expressions?.getExpression || !expressions?.setValue) return;
  for (const viseme of ['aa', 'ee', 'ih', 'oh', 'ou']) {
    if (expressions.getExpression(viseme)) {
      expressions.setValue(viseme, viseme === mouthViseme ? mouthValue : 0);
    }
  }
  if (expressions.getExpression('blink')) expressions.setValue('blink', blinkValue);
  if (expressions.getExpression('happy')) expressions.setValue('happy', happy);
  if (expressions.getExpression('sad')) expressions.setValue('sad', frown);
  if (expressions.getExpression('relaxed')) expressions.setValue('relaxed', Math.max(attentive, thinking));
}

export function frameAvatarPortrait(camera, root, focusNode) {
  root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const focus = focusNode
    ? focusNode.getWorldPosition(new THREE.Vector3())
    : bounds.getCenter(new THREE.Vector3());
  const distance = Math.max(2.1, size.x * 2, size.y * 1.35);

  camera.position.set(focus.x, focus.y, focus.z + distance);
  camera.lookAt(focus.x, focus.y - Math.min(size.y * 0.1, 0.18), focus.z);
  camera.updateProjectionMatrix();
}

export function applyHeadMotion(head, baseRotation, seconds, tilt) {
  head.rotation.x = baseRotation.x + tilt + Math.sin(seconds * 0.8) * 0.012;
  head.rotation.y = baseRotation.y + Math.sin(seconds * 0.55) * 0.025;
  head.rotation.z = baseRotation.z + Math.sin(seconds * 0.35) * 0.008;
}

function addSphere(parent, name, material, position, scale) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
}

function addCurve(parent, name, material, points, radius = 0.012) {
  const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, radius, 5, false), material);
  mesh.name = name;
  parent.add(mesh);
  return mesh;
}

function createSkinTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const sample = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const grain = (sample - Math.floor(sample) - 0.5) * 5;
      data[offset] = 233 + grain;
      data[offset + 1] = 194 + grain;
      data[offset + 2] = 173 + grain;
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createReferenceFaceTexture(image) {
  const width = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = width;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the reference face texture canvas.');

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  context.drawImage(image, sourceWidth * 0.32, 0, sourceWidth * 0.36, sourceHeight * 0.6, 0, 0, width / 2, width);
  context.save();
  context.translate(width, 0);
  context.scale(-1, 1);
  context.drawImage(image, sourceWidth * 0.32, 0, sourceWidth * 0.36, sourceHeight * 0.6, 0, 0, width / 2, width);
  context.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

export function animateBuiltInAvatar(rig, {
  blinkValue = 0,
  mouthValue = 0,
  mouthViseme = 'aa',
  happy = 0,
  attentive = 0,
  thinking = 0,
  frown = 0,
} = {}) {
  if (!rig) return;
  const eyeOpen = 1 - THREE.MathUtils.clamp(blinkValue, 0, 1);
  for (const lid of rig.lids) {
    lid.scale.y = 0.012 + (1 - eyeOpen) * 0.09;
    lid.position.y = lid.userData.openY - (1 - eyeOpen) * 0.055;
  }
  for (const pupil of rig.pupils) {
    pupil.position.x = pupil.userData.baseX + Math.sin(rig.seconds * 0.31) * 0.012;
    pupil.position.y = pupil.userData.baseY + Math.sin(rig.seconds * 0.23) * 0.008;
  }
  const visemeScale = mouthViseme === 'oh' || mouthViseme === 'ou' ? 0.78 : mouthViseme === 'ee' ? 0.72 : 1;
  rig.mouth.scale.y = 0.001 + Math.max(mouthValue, happy * 0.3) * 0.042;
  rig.mouth.scale.x = 0.068 * (visemeScale + happy * 0.12);
  rig.mouth.position.y = -0.32 + happy * 0.008 - frown * 0.005;
  rig.brows.forEach((brow, index) => {
    const side = index === 0 ? 1 : -1;
    brow.position.y = 0.19 + thinking * 0.018 - frown * 0.01;
    brow.rotation.z = side * (0.08 + happy * 0.12 - thinking * 0.08);
  });
  rig.head.rotation.z = Math.sin(rig.seconds * 0.35) * 0.008
    + attentive * 0.025 - thinking * 0.018;
}

export function createBuiltInAvatar() {
  const root = new THREE.Group();
  root.name = 'jarvis-holographic-avatar';
  const skin = new THREE.MeshStandardMaterial({
    color: 0x78cfff,
    emissive: 0x1268a8,
    emissiveIntensity: 0.34,
    metalness: 0.28,
    roughness: 0.36,
    transparent: true,
    opacity: 0.82,
  });
  const hair = new THREE.MeshStandardMaterial({
    color: 0x092b65,
    emissive: 0x0879d8,
    emissiveIntensity: 0.52,
    metalness: 0.55,
    roughness: 0.29,
    transparent: true,
    opacity: 0.88,
  });
  const edge = new THREE.MeshStandardMaterial({
    color: 0x9ceeff,
    emissive: 0x46caff,
    emissiveIntensity: 1.15,
    metalness: 0.3,
    roughness: 0.24,
  });
  const faceSkin = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: createSkinTexture(),
    roughness: 0.78,
    metalness: 0,
  });
  const faceHair = new THREE.MeshStandardMaterial({
    color: 0x211711,
    emissive: 0x07121c,
    emissiveIntensity: 0.06,
    roughness: 0.76,
    metalness: 0.02,
  });
  const mouthInterior = new THREE.MeshStandardMaterial({
    color: 0x421d23,
    roughness: 0.74,
  });
  const irisMaterial = new THREE.MeshStandardMaterial({
    color: 0x70472e,
    roughness: 0.3,
    metalness: 0,
  });
  const pupilMaterial = new THREE.MeshStandardMaterial({
    color: 0x170f0c,
    roughness: 0.18,
  });
  const eyeHighlight = new THREE.MeshBasicMaterial({ color: 0xfff8ec });
  const eyelidMaterial = new THREE.MeshStandardMaterial({
    color: 0xd8ad98,
    roughness: 0.78,
    metalness: 0,
  });

  addSphere(root, 'shoulders', hair, [0, -0.48, 0], [0.58, 0.3, 0.28]);
  addSphere(root, 'upper-chest', skin, [0, -0.69, 0.015], [0.4, 0.3, 0.24]);
  addSphere(root, 'neck', skin, [0, -0.12, 0], [0.17, 0.31, 0.17]);
  addSphere(root, 'collar', edge, [0, -0.4, 0.22], [0.35, 0.045, 0.035]);
  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = 0.45;
  root.add(head);
  const faceGeometry = new THREE.SphereGeometry(1, 40, 28);
  const facePositions = faceGeometry.attributes.position;
  for (let index = 0; index < facePositions.count; index += 1) {
    const y = facePositions.getY(index);
    const jawTaper = Math.max(0, -y) * 0.2;
    const foreheadTaper = Math.max(0, y) * 0.06;
    facePositions.setX(index, facePositions.getX(index) * (1 - jawTaper - foreheadTaper));
  }
  facePositions.needsUpdate = true;
  faceGeometry.computeVertexNormals();
  const face = new THREE.Mesh(faceGeometry, faceSkin);
  face.name = 'face';
  face.scale.set(0.37, 0.51, 0.31);
  head.add(face);
  addSphere(head, 'hair-cap', faceHair, [0, 0.22, -0.2], [0.42, 0.39, 0.25]);
  addSphere(head, 'left-side-hair', faceHair, [-0.36, -0.11, -0.005], [0.11, 0.46, 0.26]);
  addSphere(head, 'right-side-hair', faceHair, [0.36, -0.11, -0.005], [0.11, 0.46, 0.26]);

  for (const side of [-1, 1]) {
    addCurve(head, `hair-lock-${side}`, faceHair, [
      [side * 0.31, 0.2, 0.04],
      [side * 0.43, -0.05, 0.03],
      [side * 0.39, -0.42, 0.04],
      [side * 0.3, -0.76, 0.06],
    ], 0.035);
  }

  const lids = [];
  const pupils = [];
  for (const side of [-1, 1]) {
    const eyeX = side * 0.19;
    const lid = addSphere(head, `eyelid-${side}`, eyelidMaterial, [eyeX, 0.14, 0.319], [0.096, 0.012, 0.026]);
    lid.userData.openY = lid.position.y;
    lids.push(lid);
    const iris = new THREE.Group();
    iris.name = `iris-${side}`;
    iris.position.set(eyeX, 0.065, 0.284);
    iris.userData.baseX = eyeX;
    iris.userData.baseY = iris.position.y;
    head.add(iris);
    addSphere(iris, `iris-color-${side}`, irisMaterial, [0, 0, 0], [0.03, 0.032, 0.009]);
    addSphere(iris, `pupil-${side}`, pupilMaterial, [0, 0, 0.008], [0.014, 0.019, 0.005]);
    addSphere(iris, `eye-glint-${side}`, eyeHighlight, [-0.007, 0.01, 0.013], [0.005, 0.006, 0.002]);
    pupils.push(iris);
  }

  addSphere(head, 'mouth', mouthInterior, [0, -0.32, 0.265], [0.068, 0.001, 0.012]);
  addSphere(head, 'ear-left', faceSkin, [-0.37, -0.02, 0], [0.055, 0.105, 0.07]);
  addSphere(head, 'ear-right', faceSkin, [0.37, -0.02, 0], [0.055, 0.105, 0.07]);
  return {
    root,
    rig: {
      head,
      lids,
      pupils,
      brows: [],
      mouth: head.getObjectByName('mouth'),
      seconds: 0,
    },
  };
}

export function initializeAvatar3d({ frame, canvas, image, mouthOverlay, fileInput, modelButton, status, parseModel = parseAvatarGlb }) {
  let renderer = null;
  let scene = null;
  let camera = null;
  let modelRoot = null;
  let animationFrame = 0;
  let resizeObserver = null;
  let avatarState = 'normal';
  let mouthValue = 0;
  let targetMouthValue = 0;
  let nextBlinkAt = 0;
  let blinkStartedAt = 0;
  let activeTargets = [];
  let headNode = null;
  let headBaseRotation = new THREE.Euler();
  let modelBasePosition = new THREE.Vector3();
  let gazeTarget = null;
  let previousLookAtTarget;
  let eyeNodes = [];
  let eyeBaseRotations = [];
  let mouthTargets = [];
  let blinkTargets = [];
  let smileTargets = [];
  let attentiveTargets = [];
  let thinkTargets = [];
  let frownTargets = [];
  let builtInRig = null;
  let activeVrm = null;
  let mouthViseme = 'aa';
  let lastFrameTime = 0;
  let loadRequestId = 0;

  function report(message, kind = 'info') {
    status.textContent = message;
    status.dataset.state = kind;
    frame.setAttribute('aria-busy', String(kind === 'loading'));
  }

  function setState(nextState) {
    avatarState = ['normal', 'listening', 'thinking', 'speaking', 'happy', 'error'].includes(nextState)
      ? nextState
      : 'normal';
  }

  function setMouth(value) {
    targetMouthValue = Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0;
  }

  function setViseme(viseme) {
    mouthViseme = ['aa', 'ee', 'ih', 'oh', 'ou'].includes(viseme) ? viseme : 'aa';
  }

  function disposeModel() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = null;
    if (modelRoot && scene) scene.remove(modelRoot);
    if (gazeTarget && activeVrm?.lookAt?.target === gazeTarget) activeVrm.lookAt.target = previousLookAtTarget;
    if (gazeTarget && scene) scene.remove(gazeTarget);
    gazeTarget = null;
    previousLookAtTarget = undefined;
    if (activeVrm) {
      VRMUtils.deepDispose(activeVrm.scene);
    } else if (modelRoot) {
      modelRoot.traverse((object) => {
        object.geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material) continue;
          for (const value of Object.values(material)) {
            if (value?.isTexture) value.dispose();
          }
          material.dispose();
        }
      });
    }
    modelRoot = null;
    activeVrm = null;
    mouthViseme = 'aa';
    mouthValue = 0;
    targetMouthValue = 0;
    blinkStartedAt = 0;
    nextBlinkAt = 0;
    lastFrameTime = 0;
    activeTargets = [];
    headNode = null;
    eyeNodes = [];
    eyeBaseRotations = [];
    modelBasePosition.set(0, 0, 0);
    mouthTargets = [];
    blinkTargets = [];
    smileTargets = [];
    attentiveTargets = [];
    thinkTargets = [];
    frownTargets = [];
    builtInRig = null;
    if (renderer) {
      renderer.dispose();
      renderer = null;
    }
    scene = null;
    camera = null;
    frame.classList.remove('is-3d-active');
    canvas.hidden = true;
    if (image) image.classList.remove('is-3d-hidden');
    if (mouthOverlay) mouthOverlay.hidden = false;
  }

  function configureRenderer() {
    const lowPowerDevice = navigator.hardwareConcurrency <= 4 || navigator.connection?.saveData;
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: !lowPowerDevice,
      powerPreference: 'low-power',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPowerDevice ? 1 : 1.35));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(33, 1, 0.01, 100);
    camera.position.set(0, 0, 3.2);
    scene.add(new THREE.HemisphereLight(0xbdeaff, 0x071329, 2.2));
    const keyLight = new THREE.DirectionalLight(0x9bdcff, 3.2);
    keyLight.position.set(-1.5, 2, 3);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x277bf1, 2.4);
    rimLight.position.set(1.5, 0.5, -2);
    scene.add(rimLight);
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(frame);
  }

  function resize() {
    if (!renderer || !camera) return;
    const { width, height } = frame.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function setInfluence(targets, value) {
    for (const { object, index } of targets) {
      object.morphTargetInfluences[index] = THREE.MathUtils.lerp(
        object.morphTargetInfluences[index] || 0,
        value,
        0.16,
      );
    }
  }

  function animate(now) {
    animationFrame = requestAnimationFrame(animate);
    if (!modelRoot || !renderer || !scene || !camera) return;
    if (lastFrameTime && now - lastFrameTime < 30) return;

    const seconds = now / 1000;
    const deltaTime = lastFrameTime ? Math.min((now - lastFrameTime) / 1000, 0.05) : 1 / 60;
    lastFrameTime = now;
    mouthValue = THREE.MathUtils.damp(mouthValue, targetMouthValue, 13, deltaTime);
    const visemeTargets = mouthTargets.filter(({ name }) => /viseme/i.test(name));
    const happy = avatarState === 'happy' ? 0.32 : avatarState === 'speaking' ? 0.07 : 0;
    const attentive = avatarState === 'listening' ? 0.2 : 0;
    const thinking = avatarState === 'thinking' ? 0.18 : 0;
    const frown = avatarState === 'error' ? 0.16 : 0;
    if (now >= nextBlinkAt && !blinkStartedAt) {
      blinkStartedAt = now;
      nextBlinkAt = now + 2500 + Math.random() * 3200;
    }
    const blinkProgress = blinkStartedAt ? (now - blinkStartedAt) / 170 : 1;
    const blinkValue = blinkStartedAt && blinkProgress < 1 ? Math.sin(blinkProgress * Math.PI) : 0;
    if (blinkStartedAt && blinkProgress >= 1) blinkStartedAt = 0;
    if (builtInRig) {
      builtInRig.seconds = seconds;
      animateBuiltInAvatar(builtInRig, {
        blinkValue,
        mouthValue,
        mouthViseme,
        happy,
        attentive,
        thinking,
        frown,
      });
    }

    if (activeVrm) {
      applyVrmExpressions(activeVrm.expressionManager, {
        mouthViseme,
        mouthValue,
        blinkValue,
        happy,
        attentive,
        thinking,
        frown,
      });
      activeVrm.update(deltaTime);
    } else {
      if (visemeTargets.length) {
        const getViseme = (name) => name.match(/(?:viseme[\s._-]*)?(aa|a|ee|ih|oh|ou)$/i)?.[1].toLowerCase();
        const hasRequestedViseme = visemeTargets.some(({ name }) => getViseme(name) === mouthViseme);
        const fallbackTarget = visemeTargets.find(({ name }) => getViseme(name) === 'aa') || visemeTargets[0];
        for (const target of visemeTargets) {
          const targetViseme = getViseme(target.name);
          const matches = hasRequestedViseme
            ? targetViseme === mouthViseme
            : target === fallbackTarget;
          setInfluence([target], matches ? mouthValue : 0);
        }
      } else {
        setInfluence(mouthTargets, mouthValue);
      }
      setInfluence(blinkTargets, blinkValue);
      setInfluence(smileTargets, happy);
      setInfluence(attentiveTargets, attentive);
      setInfluence(thinkTargets, thinking);
      setInfluence(frownTargets, frown);
    }

    const tilt = avatarState === 'listening' ? 0.045 : avatarState === 'thinking' ? -0.035 : 0;
    if (headNode) applyHeadMotion(headNode, headBaseRotation, seconds, tilt);
    if (eyeNodes.length && !activeVrm?.lookAt) {
      const gazeX = Math.sin(seconds * 0.31) * 0.035;
      const gazeY = Math.sin(seconds * 0.23) * 0.018;
      eyeNodes.forEach((eye, index) => {
        const base = eyeBaseRotations[index];
        eye.rotation.x = base.x + gazeY;
        eye.rotation.y = base.y + gazeX;
      });
    }
    if (gazeTarget && headNode) {
      const headPosition = headNode.getWorldPosition(new THREE.Vector3());
      gazeTarget.position.set(
        headPosition.x + Math.sin(seconds * 0.31) * 0.08,
        headPosition.y + Math.sin(seconds * 0.23) * 0.04,
        headPosition.z + 1.5,
      );
    }
    modelRoot.position.y = modelBasePosition.y + Math.sin(seconds * 0.7) * 0.008;
    renderer.render(scene, camera);
  }

  async function loadModel(file) {
    if (!file) return;
    const requestId = ++loadRequestId;
    try {
      validateAvatarFile(file);
    } catch (error) {
      report(error.message, 'error');
      return;
    }

    report('Reading the local avatar file...', 'loading');
    let arrayBuffer;
    try {
      arrayBuffer = await readAvatarFile(file, (loaded, total) => {
        if (total > 0) report(`Reading avatar file... ${Math.round((loaded / total) * 100)}%`, 'loading');
      });
      report('Validating and parsing the local avatar...', 'loading');
      const gltf = await parseModel(arrayBuffer);
      if (requestId !== loadRequestId) {
        disposeParsedAvatar(gltf);
        return;
      }
      const root = gltf.scene;
      const vrm = gltf.userData?.vrm || null;
      const rig = inspectAvatarRig(root);
      const { morphTargets, mouthTargets: newMouthTargets } = rig;
      const expressionManager = vrm?.expressionManager;
      const hasVrmMouth = ['aa', 'ee', 'ih', 'oh', 'ou'].some((name) => expressionManager?.getExpression(name));
      if (!newMouthTargets.length && !hasVrmMouth) {
        disposeParsedAvatar(gltf);
        report('This model has no recognized mouth-open or speech viseme morph. The portrait remains active.', 'error');
        return;
      }

      const bounds = new THREE.Box3().setFromObject(root);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      if (!Number.isFinite(size.y) || size.y <= 0) {
        disposeParsedAvatar(gltf);
        report('This model has invalid dimensions. The portrait remains active.', 'error');
        return;
      }

      disposeModel();
      modelRoot = root;
      activeVrm = vrm;
      configureRenderer();
      root.scale.setScalar(1.7 / size.y);
      root.position.set(-center.x * root.scale.x, -center.y * root.scale.y, -center.z * root.scale.z);
      modelBasePosition.copy(root.position);
      scene.add(modelRoot);
      activeTargets = morphTargets;
      root.traverse((object) => {
        if (!headNode && /^(?:head|neck)(?:[_ .-]|$)/i.test(object.name)) headNode = object;
      });
      eyeNodes = [];
      root.traverse((object) => {
        if (/^(?:(?:left|right)[_. -]*eye|eye[_. -]*(?:left|right))$/i.test(object.name)) eyeNodes.push(object);
      });
      eyeBaseRotations = eyeNodes.map((eye) => eye.rotation.clone());
      mouthTargets = newMouthTargets;
      if (vrm?.humanoid) headNode = vrm.humanoid.getNormalizedBoneNode('head') || headNode;
      headBaseRotation = (headNode || modelRoot).rotation.clone();
      if (vrm?.lookAt && headNode) {
        gazeTarget = new THREE.Object3D();
        const headPosition = headNode.getWorldPosition(new THREE.Vector3());
        gazeTarget.position.set(headPosition.x, headPosition.y, headPosition.z + 1.5);
        scene.add(gazeTarget);
        previousLookAtTarget = vrm.lookAt.target;
        vrm.lookAt.target = gazeTarget;
      }
      frameAvatarPortrait(camera, modelRoot, headNode);
      blinkTargets = rig.blinkTargets;
      smileTargets = rig.smileTargets;
      attentiveTargets = rig.attentiveTargets;
      thinkTargets = rig.thinkTargets;
      frownTargets = rig.frownTargets;
      builtInRig = null;
      canvas.hidden = false;
      if (image) image.classList.add('is-3d-hidden');
      if (mouthOverlay) mouthOverlay.hidden = true;
      frame.classList.add('is-3d-active');
      resize();
      const expressions = [blinkTargets.length && 'blink', smileTargets.length && 'happy', attentiveTargets.length && 'listening', thinkTargets.length && 'thinking'].filter(Boolean);
      const mouthDescription = hasVrmMouth
        ? 'VRM aa/ee/ih/oh/ou expressions'
        : newMouthTargets.map(({ name }) => name).join(', ');
      const identity = vrm?.meta?.name ? ` ${vrm.meta.name}.` : '';
      report(`3D avatar ready.${identity} Mouth: ${mouthDescription}. Face controls: ${expressions.join(', ') || (hasVrmMouth ? 'VRM expressions' : 'mouth only')}.`, 'ready');
      animationFrame = requestAnimationFrame(animate);
    } catch (error) {
      if (requestId !== loadRequestId) return;
      disposeModel();
      report(`Could not load this model: ${error.message || 'unsupported or invalid model'}. The portrait remains active.`, 'error');
    }
  }

  function loadBuiltInAvatar() {
    try {
      const { root, rig } = createBuiltInAvatar();
      const face = root.getObjectByName('face');
      const bounds = new THREE.Box3().setFromObject(root);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      disposeModel();
      configureRenderer();
      modelRoot = root;
      builtInRig = rig;
      root.position.set(-center.x, -center.y, -center.z);
      modelBasePosition.copy(root.position);
      scene.add(modelRoot);
      headNode = rig.head;
      headBaseRotation.copy(headNode.rotation);
      frameAvatarPortrait(camera, modelRoot, headNode);
      canvas.hidden = false;
      if (image) image.classList.add('is-3d-hidden');
      if (mouthOverlay) mouthOverlay.hidden = true;
      frame.classList.add('is-3d-active');
      resize();
      report('Stylized 3D avatar ready. Load a compatible local VRM or GLB for a realistic, fully rigged face.', 'ready');
      animationFrame = requestAnimationFrame(animate);
      return true;
    } catch (error) {
      disposeModel();
      report(`Could not create the built-in avatar: ${error.message || 'WebGL is unavailable'}. The portrait remains active.`, 'error');
      return false;
    }
  }

  fileInput?.addEventListener('change', () => {
    const [file] = fileInput.files || [];
    loadModel(file);
    fileInput.value = '';
  });
  modelButton?.addEventListener('click', () => fileInput.click());
  window.addEventListener('jarvis:avatar-state', (event) => setState(event.detail?.state));
  window.addEventListener('jarvis:avatar-mouth', (event) => setMouth(event.detail?.value));
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    loadRequestId += 1;
    disposeModel();
    report('3D rendering stopped. The photographic avatar is active.', 'error');
  });

  function unloadModel() {
    loadRequestId += 1;
    disposeModel();
  }

  return { loadModel, loadBuiltInAvatar, setState, setMouth, setViseme, unload: unloadModel };
}