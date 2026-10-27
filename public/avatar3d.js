import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

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

export function estimateMouthCue(word) {
  const normalized = word.toLocaleLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');
  if (!normalized) return { opening: 0, viseme: 'aa' };
  if (!/^\p{Script=Latin}+$/u.test(normalized.replace(/\p{M}/gu, ''))) {
    const viseme = /[उऊुू]/u.test(normalized) ? 'ou'
      : /[ओऔोौ]/u.test(normalized) ? 'oh'
        : /[इईिी]/u.test(normalized) ? 'ih'
          : /[एऐेै]/u.test(normalized) ? 'ee' : 'aa';
    return { opening: /[मबप]/.test(normalized[0]) ? 0.08 : 0.55, viseme };
  }
  if (/[mbp]/.test(normalized[0])) return { opening: 0.08, viseme: 'aa' };
    const firstVowel = normalized.match(/[aeiou]/)?.[0];
    if (firstVowel === 'u') return { opening: 0.5, viseme: 'ou' };
    if (firstVowel === 'o') return { opening: 0.58, viseme: 'oh' };
    if (firstVowel === 'i') return { opening: 0.28, viseme: 'ih' };
    if (firstVowel === 'e') return { opening: 0.36, viseme: 'ee' };
    if (firstVowel === 'a') return { opening: 0.72, viseme: 'aa' };
  return { opening: 0.16, viseme: 'aa' };
}

export function applySpeechBoundaryCue(text, event, onCue) {
  if (!event || (event.name && event.name !== 'word') || typeof onCue !== 'function') return;
  const start = Number.isInteger(event.charIndex) ? event.charIndex : 0;
  const word = text.slice(start, start + (event.charLength || 0))
    || text.slice(start).match(/^[\p{L}\p{N}']+/u)?.[0]
    || '';
  const { opening, viseme } = estimateMouthCue(word);
  onCue(opening, viseme);
}

export function estimateAudioMouthOpening(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  let count = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) continue;
    sum += sample * sample;
    count += 1;
  }
  if (!count) return 0;
  const rms = Math.sqrt(sum / count);
  return THREE.MathUtils.clamp((rms - 0.015) * 4, 0, 0.9);
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
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
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

  fileInput.addEventListener('change', () => {
    const [file] = fileInput.files || [];
    loadModel(file);
    fileInput.value = '';
  });
  modelButton.addEventListener('click', () => fileInput.click());
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

  return { loadModel, setState, setMouth, setViseme, unload: unloadModel };
}