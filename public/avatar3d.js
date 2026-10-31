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
const GLOBE_RENDER_SCALE = 1.5;
const GLOBE_CONTENT_RADIUS = 1.42;
const GLOBE_FRAME_PADDING = 1.06;
const EARTH_CONTINENTS = [
  [[-168, 70], [-145, 72], [-128, 62], [-123, 51], [-132, 48], [-124, 40], [-117, 32], [-108, 24], [-97, 17], [-83, 9], [-77, 25], [-61, 45], [-67, 55], [-91, 61], [-111, 72], [-140, 73]],
  [[-81, 12], [-70, 10], [-52, 4], [-36, -8], [-48, -22], [-54, -34], [-66, -53], [-74, -40], [-72, -15]],
  [[-12, 36], [0, 44], [8, 55], [25, 60], [35, 70], [60, 72], [85, 75], [112, 69], [138, 58], [158, 53], [151, 43], [132, 35], [121, 24], [108, 9], [99, 5], [91, 20], [78, 8], [68, 23], [54, 27], [44, 38], [30, 36], [20, 43], [10, 36]],
  [[-17, 36], [8, 38], [32, 31], [49, 12], [40, -8], [31, -25], [19, -35], [5, -27], [-3, -8], [-13, 12]],
  [[112, -11], [129, -10], [145, -17], [153, -29], [144, -39], [126, -43], [115, -34], [113, -22]],
  [[-53, 60], [-43, 61], [-38, 71], [-45, 82], [-57, 84], [-66, 77], [-62, 68]],
  [[47, -13], [50, -16], [49, -25], [45, -24]],
  [[-180, -68], [-150, -72], [-110, -70], [-70, -74], [-30, -69], [10, -72], [50, -68], [90, -73], [130, -69], [170, -72], [180, -68], [180, -90], [-180, -90]],
];

function isPointInPolygon(longitude, latitude, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [currentLongitude, currentLatitude] = polygon[index];
    const [previousLongitude, previousLatitude] = polygon[previous];
    const crossesLatitude = (currentLatitude > latitude) !== (previousLatitude > latitude);
    if (crossesLatitude && longitude < (
      ((previousLongitude - currentLongitude) * (latitude - currentLatitude))
      / (previousLatitude - currentLatitude) + currentLongitude
    )) inside = !inside;
  }
  return inside;
}

function createEarthSurfaceTexture() {
  const width = 768;
  const height = 384;
  const data = new Uint8Array(width * height * 4);
  const continents = EARTH_CONTINENTS.map((polygon) => ({
    polygon,
    minLongitude: Math.min(...polygon.map(([longitude]) => longitude)),
    maxLongitude: Math.max(...polygon.map(([longitude]) => longitude)),
    minLatitude: Math.min(...polygon.map(([, latitude]) => latitude)),
    maxLatitude: Math.max(...polygon.map(([, latitude]) => latitude)),
  }));
  const land = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const latitude = (y / (height - 1)) * 180 - 90;
    for (let x = 0; x < width; x += 1) {
      const longitude = (x / (width - 1)) * 360 - 180;
      if (continents.some(({ polygon, minLongitude, maxLongitude, minLatitude, maxLatitude }) => (
        longitude >= minLongitude && longitude <= maxLongitude
        && latitude >= minLatitude && latitude <= maxLatitude
        && isPointInPolygon(longitude, latitude, polygon)
      ))) land[y * width + x] = 1;
    }
  }

  for (let y = 0; y < height; y += 1) {
    const latitude = (y / (height - 1)) * 180 - 90;
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const offset = pixel * 4;
      const isLand = land[pixel] === 1;
      const coast = isLand && (
        !land[y * width + Math.max(0, x - 1)]
        || !land[y * width + Math.min(width - 1, x + 1)]
        || !land[Math.max(0, y - 1) * width + x]
        || !land[Math.min(height - 1, y + 1) * width + x]
      );
      let coastalGlow = 0;
      if (!isLand) {
        for (let yOffset = -2; yOffset <= 2; yOffset += 1) {
          for (let xOffset = -2; xOffset <= 2; xOffset += 1) {
            const distance = Math.abs(xOffset) + Math.abs(yOffset);
            if (distance > 2) continue;
            const neighborY = y + yOffset;
            if (neighborY < 0 || neighborY >= height) continue;
            const neighborX = (x + xOffset + width) % width;
            if (land[neighborY * width + neighborX]) {
              coastalGlow = Math.max(coastalGlow, distance === 1 ? 145 : 78);
            }
          }
        }
      }
      const longitude = (x / (width - 1)) * 360 - 180;
      const latitudeGridDistance = Math.min(Math.abs(latitude % 10), 10 - Math.abs(latitude % 10));
      const longitudeGridDistance = Math.min(Math.abs(longitude % 10), 10 - Math.abs(longitude % 10));
      const grid = latitudeGridDistance < 0.42 || longitudeGridDistance < 0.42;
      const relief = isLand && !coast
        ? Math.round((Math.sin(longitude * 0.22 + Math.sin(latitude * 0.11) * 2) + 1) * 9)
        : 0;
      let red = 8;
      let green = 38;
      let alpha = 28;
      if (coast) {
        red = 145;
        green = 242;
        alpha = 250;
      } else if (coastalGlow) {
        red = 58;
        green = 190;
        alpha = coastalGlow;
      } else if (isLand) {
        red = 34 + relief;
        green = 153 + relief;
        alpha = 164 + relief;
      } else if (grid) {
        red = 30;
        green = 121;
        alpha = 82;
      }
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = 255;
      data[offset + 3] = alpha;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function spherePoint(longitude, latitude, radius) {
  const longitudeRadians = THREE.MathUtils.degToRad(longitude);
  const latitudeRadians = THREE.MathUtils.degToRad(latitude);
  const latitudeRadius = Math.cos(latitudeRadians) * radius;
  return new THREE.Vector3(
    Math.sin(longitudeRadians) * latitudeRadius,
    Math.sin(latitudeRadians) * radius,
    Math.cos(longitudeRadians) * latitudeRadius,
  );
}

function addGlobeGrid(globe, material) {
  for (let latitude = -80; latitude <= 80; latitude += 10) {
    const points = [];
    for (let longitude = 0; longitude <= 360; longitude += 2) {
      points.push(spherePoint(longitude, latitude, 1.012));
    }
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material);
    line.name = `earth-latitude-${latitude}`;
    globe.add(line);
  }
  for (let longitude = 0; longitude < 360; longitude += 10) {
    const points = [];
    for (let latitude = -90; latitude <= 90; latitude += 2) {
      points.push(spherePoint(longitude, latitude, 1.012));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
    line.name = `earth-longitude-${longitude}`;
    globe.add(line);
  }
}

export function createHolographicGlobe() {
  const root = new THREE.Group();
  root.name = 'jarvis-holographic-earth';
  const globe = new THREE.Group();
  globe.name = 'earth-globe';
  root.add(globe);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.075, 56, 40),
    new THREE.MeshBasicMaterial({
      color: 0x168dff,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  atmosphere.name = 'earth-atmosphere';
  globe.add(atmosphere);

  const ocean = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 48),
    new THREE.MeshBasicMaterial({
      color: 0x063d86,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  ocean.name = 'earth-ocean';
  globe.add(ocean);

  const land = new THREE.Mesh(
    new THREE.SphereGeometry(1.006, 64, 48),
    new THREE.MeshBasicMaterial({
      map: createEarthSurfaceTexture(),
      transparent: true,
      opacity: 0.86,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  land.name = 'earth-continents';
  globe.add(land);

  const gridMaterial = new THREE.LineBasicMaterial({
    color: 0x66e8ff,
    transparent: true,
    opacity: 0.46,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  addGlobeGrid(globe, gridMaterial);

  const orbitRig = new THREE.Group();
  orbitRig.name = 'earth-orbit-rings';
  root.add(orbitRig);
  const orbitMaterials = [
    new THREE.MeshBasicMaterial({
      color: 0x9deeff,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
    }),
    new THREE.MeshBasicMaterial({
      color: 0x238cff,
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
    }),
  ];
  const orbitRings = [1.22, 1.34].map((radius, index) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, index ? 0.004 : 0.007, 6, 112), orbitMaterials[index]);
    ring.name = `earth-orbit-${index + 1}`;
    ring.rotation.set(index ? 0.92 : 1.12, index * 0.45, index ? 0.45 : -0.25);
    orbitRig.add(ring);
    return ring;
  });

  const particlePositions = new Float32Array(84 * 3);
  for (let index = 0; index < 84; index += 1) {
    const y = 1 - ((index + 0.5) / 84) * 2;
    const angle = index * 2.399963229728653;
    const radius = 1.13 + ((index * 17) % 29) / 100;
    const horizontalRadius = Math.sqrt(1 - y * y) * radius;
    particlePositions[index * 3] = Math.cos(angle) * horizontalRadius;
    particlePositions[index * 3 + 1] = y * radius;
    particlePositions[index * 3 + 2] = Math.sin(angle) * horizontalRadius;
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  const particles = new THREE.Points(
    particleGeometry,
    new THREE.PointsMaterial({
      color: 0x77ddff,
      size: 0.018,
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  particles.name = 'earth-particles';
  root.add(particles);

  const scanPositions = new Float32Array(97 * 3);
  const scanGeometry = new THREE.BufferGeometry();
  scanGeometry.setAttribute('position', new THREE.BufferAttribute(scanPositions, 3));
  const scanline = new THREE.LineLoop(
    scanGeometry,
    new THREE.LineBasicMaterial({
      color: 0xaff7ff,
      transparent: true,
      opacity: 0.64,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  scanline.name = 'earth-scanline';
  globe.add(scanline);
  const initialScanPositions = scanline.geometry.attributes.position;
  for (let index = 0; index < initialScanPositions.count; index += 1) {
    const longitude = (index / (initialScanPositions.count - 1)) * 360;
    const point = spherePoint(longitude, 0, 1.018);
    initialScanPositions.setXYZ(index, point.x, point.y, point.z);
  }
  initialScanPositions.needsUpdate = true;

  return { root, globe, orbitRig, orbitRings, particles, scanline };
}

export function animateHolographicGlobe(rig, seconds, { reducedMotion = false } = {}) {
  if (!rig || reducedMotion) return;
  rig.globe.rotation.y = seconds * 0.12;
  rig.orbitRig.rotation.y = seconds * 0.045;
  rig.particles.rotation.y = -seconds * 0.035;
  const latitude = Math.sin(seconds * 0.24) * 68;
  const positions = rig.scanline.geometry.attributes.position;
  const latitudeRadians = THREE.MathUtils.degToRad(latitude);
  const latitudeRadius = Math.cos(latitudeRadians) * 1.018;
  const vertical = Math.sin(latitudeRadians) * 1.018;
  for (let index = 0; index < positions.count; index += 1) {
    const longitudeRadians = THREE.MathUtils.degToRad((index / (positions.count - 1)) * 360);
    positions.setXYZ(
      index,
      Math.sin(longitudeRadians) * latitudeRadius,
      vertical,
      Math.cos(longitudeRadians) * latitudeRadius,
    );
  }
  positions.needsUpdate = true;
  rig.scanline.material.opacity = 0.42 + Math.sin(seconds * 0.9) * 0.16;
}

function frameHolographicGlobe(camera) {
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const halfVisibleAngle = Math.atan(
    Math.tan(verticalFov / 2) * Math.min(camera.aspect, 1),
  );
  const scaledRadius = GLOBE_CONTENT_RADIUS * GLOBE_RENDER_SCALE * GLOBE_FRAME_PADDING;
  const distance = scaledRadius / Math.sin(halfVisibleAngle);
  camera.position.set(0, 0, distance);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

export function getAvatarRenderQuality({
  navigator = globalThis.navigator,
  viewportWidth = globalThis.window?.innerWidth ?? Infinity,
  devicePixelRatio = globalThis.window?.devicePixelRatio ?? 1,
  hasCoarsePointer = globalThis.window?.matchMedia?.('(pointer: coarse)').matches ?? false,
} = {}) {
  const isMobile = Boolean(navigator?.userAgentData?.mobile) || hasCoarsePointer || viewportWidth <= 780;
  const isLowPower = (navigator?.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4)
    || (navigator?.deviceMemory > 0 && navigator.deviceMemory <= 4)
    || Boolean(navigator?.connection?.saveData);
  const reducedQuality = isMobile || isLowPower;
  return {
    isMobile,
    isLowPower,
    antialias: !reducedQuality,
    pixelRatio: Math.min(devicePixelRatio || 1, reducedQuality ? 1 : 1.35),
  };
}

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
  const geometries = new Set();
  const uniqueMaterials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) {
      if (!material) continue;
      uniqueMaterials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  textures.forEach((texture) => texture.dispose());
  uniqueMaterials.forEach((material) => material.dispose());
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

export function applyHeadMotion(head, baseRotation, seconds, tilt, { yaw = 0, roll = 0, nod = 0 } = {}) {
  head.rotation.x = baseRotation.x + tilt + Math.sin(seconds * 0.8) * 0.012 + nod;
  head.rotation.y = baseRotation.y + Math.sin(seconds * 0.55) * 0.025 + yaw;
  head.rotation.z = baseRotation.z + Math.sin(seconds * 0.35) * 0.008 + roll;
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
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const gaussian = (u, v, centerX, centerY, radiusX, radiusY) => Math.exp(
    -(((u - centerX) / radiusX) ** 2 + ((v - centerY) / radiusY) ** 2) * 0.5,
  );
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const sample = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const grain = (sample - Math.floor(sample) - 0.5) * 4;
      const u = x / (size - 1);
      const v = y / (size - 1);
      const cheeks = gaussian(u, v, 0.34, 0.58, 0.09, 0.08) + gaussian(u, v, 0.66, 0.58, 0.09, 0.08);
      const bridge = gaussian(u, v, 0.5, 0.54, 0.035, 0.2);
      const jawShade = Math.max(0, v - 0.72) * 22;
      data[offset] = 233 + grain + cheeks * 5 + bridge * 2 - jawShade;
      data[offset + 1] = 194 + grain + cheeks * 0.5 - jawShade * 0.78;
      data[offset + 2] = 173 + grain + cheeks * 0.2 - jawShade * 0.64;
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
  const deltaTime = rig.lastAnimationSeconds === undefined
    ? 1 / 60
    : THREE.MathUtils.clamp(rig.seconds - rig.lastAnimationSeconds, 0, 0.05);
  rig.lastAnimationSeconds = rig.seconds;
  const blink = THREE.MathUtils.clamp(blinkValue, 0, 1);
  for (const lid of rig.lids) {
    lid.scale.y = 0.012 + blink * 0.09 + attentive * 0.004 + thinking * 0.003 + frown * 0.004;
    lid.position.y = lid.userData.openY - blink * 0.055 + attentive * 0.003 - thinking * 0.003 - frown * 0.004;
  }
  rig.gazeX = THREE.MathUtils.damp(rig.gazeX || 0, -thinking * 0.018, 8, deltaTime);
  rig.gazeY = THREE.MathUtils.damp(rig.gazeY || 0, thinking * 0.018 + attentive * 0.004 - frown * 0.008, 8, deltaTime);
  for (const pupil of rig.pupils) {
    pupil.position.x = pupil.userData.baseX + Math.sin(rig.seconds * 0.31) * 0.012 + rig.gazeX;
    pupil.position.y = pupil.userData.baseY + Math.sin(rig.seconds * 0.23) * 0.008
      + rig.gazeY;
  }
  const targetVisemeScale = mouthViseme === 'oh' || mouthViseme === 'ou' ? 0.78 : mouthViseme === 'ee' ? 0.72 : 1;
  rig.visemeScale = THREE.MathUtils.damp(rig.visemeScale ?? 1, targetVisemeScale, 14, deltaTime);
  rig.mouth.scale.y = 0.001 + Math.max(mouthValue, happy * 0.3) * 0.042;
  rig.mouth.scale.x = 0.068 * (rig.visemeScale + happy * 0.2 - frown * 0.16);
  rig.mouth.position.y = -0.32 + happy * 0.012 - frown * 0.012;
  rig.mouth.rotation.z = -frown * 0.16;
  if (rig.lowerLip) {
    rig.lowerLip.position.y = rig.lowerLip.userData.openY - mouthValue * 0.012;
    rig.lowerLip.scale.x = 1 + happy * 0.12;
  }
  rig.brows.forEach((brow, index) => {
    const side = brow.userData.side || (index === 0 ? -1 : 1);
    brow.position.y = brow.userData.openY + happy * 0.014 + attentive * 0.017 - thinking * 0.012 - frown * 0.016;
    brow.rotation.z = side * happy * 0.24 + attentive * 0.08
      + (index === 0 ? -thinking * 0.2 : thinking * 0.08) - side * frown * 0.2;
  });
  rig.head.rotation.z = Math.sin(rig.seconds * 0.35) * 0.008
    + attentive * 0.025 - thinking * 0.018 + happy * 0.035 - frown * 0.055;
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
    emissive: 0x25110e,
    emissiveIntensity: 0.025,
    roughness: 0.68,
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
  const browMaterial = new THREE.MeshStandardMaterial({
    color: 0x342327,
    roughness: 0.82,
  });
  const secondaryGlint = new THREE.MeshBasicMaterial({ color: 0x9ceeff, transparent: true, opacity: 0.78 });
  const scleraMaterial = new THREE.MeshStandardMaterial({
    color: 0xd9e8ed,
    roughness: 0.28,
    metalness: 0.02,
  });
  const eyeRimMaterial = new THREE.MeshStandardMaterial({
    color: 0x956e70,
    roughness: 0.72,
  });
  const lipMaterial = new THREE.MeshStandardMaterial({
    color: 0x9b5960,
    roughness: 0.52,
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
    const cheekFullness = Math.exp(-(((y + 0.12) / 0.28) ** 2)) * 0.035;
    const jawTaper = Math.max(0, -y - 0.02) * 0.28;
    const foreheadTaper = Math.max(0, y) * 0.045;
    const width = 1 - jawTaper - foreheadTaper + cheekFullness;
    const depth = 1 + Math.exp(-(((y + 0.2) / 0.34) ** 2)) * 0.035;
    facePositions.setX(index, facePositions.getX(index) * width);
    facePositions.setZ(index, facePositions.getZ(index) * depth);
  }
  facePositions.needsUpdate = true;
  faceGeometry.computeVertexNormals();
  const face = new THREE.Mesh(faceGeometry, faceSkin);
  face.name = 'face';
  face.scale.set(0.37, 0.51, 0.31);
  head.add(face);
  addSphere(head, 'nose-bridge', faceSkin, [0, 0.005, 0.315], [0.031, 0.125, 0.043]);
  addSphere(head, 'nose-tip', faceSkin, [0, -0.105, 0.345], [0.047, 0.036, 0.034]);
  for (const side of [-1, 1]) {
    addSphere(head, `nose-wing-${side}`, faceSkin, [side * 0.037, -0.119, 0.329], [0.023, 0.019, 0.022]);
  }
  const noseHighlight = new THREE.MeshBasicMaterial({ color: 0xffe6d9, transparent: true, opacity: 0.26 });
  addSphere(head, 'nose-highlight', noseHighlight, [-0.009, -0.04, 0.354], [0.009, 0.055, 0.004]);
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
  const brows = [];
  for (const side of [-1, 1]) {
    const eyeX = side * 0.19;
    const brow = new THREE.Group();
    brow.name = `brow-${side}`;
    brow.position.set(eyeX, 0.215, 0.252);
    brow.userData.openY = brow.position.y;
    brow.userData.side = side;
    addCurve(brow, `brow-line-${side}`, browMaterial, [
      [-0.078, -0.003, 0],
      [-0.035, 0.014, 0.004],
      [0.025, 0.017, 0.004],
      [0.078, -0.002, 0],
    ], 0.009);
    head.add(brow);
    brows.push(brow);
    const eye = new THREE.Group();
    eye.name = `eye-${side}`;
    eye.position.set(eyeX, 0.065, 0.272);
    const sclera = addSphere(eye, `sclera-${side}`, scleraMaterial, [0, 0, 0], [0.061, 0.032, 0.012]);
    sclera.name = `sclera-${side}`;
    addCurve(eye, `upper-eye-rim-${side}`, eyeRimMaterial, [
      [-0.063, 0, 0.005],
      [-0.035, 0.027, 0.009],
      [0.018, 0.03, 0.009],
      [0.063, 0.004, 0.005],
    ], 0.0045);
    addCurve(eye, `lower-eye-rim-${side}`, eyeRimMaterial, [
      [-0.06, -0.004, 0.004],
      [-0.025, -0.027, 0.008],
      [0.025, -0.027, 0.008],
      [0.06, -0.004, 0.004],
    ], 0.0035);
    head.add(eye);
    const lid = addSphere(head, `eyelid-${side}`, eyelidMaterial, [eyeX, 0.14, 0.319], [0.096, 0.012, 0.026]);
    lid.userData.openY = lid.position.y;
    lids.push(lid);
    const iris = new THREE.Group();
    iris.name = `iris-${side}`;
    iris.position.set(eyeX, 0.065, 0.29);
    iris.userData.baseX = eyeX;
    iris.userData.baseY = iris.position.y;
    head.add(iris);
    addSphere(iris, `iris-color-${side}`, irisMaterial, [0, 0, 0], [0.03, 0.032, 0.009]);
    addSphere(iris, `pupil-${side}`, pupilMaterial, [0, 0, 0.008], [0.014, 0.019, 0.005]);
    addSphere(iris, `eye-glint-${side}`, eyeHighlight, [-0.007, 0.01, 0.013], [0.005, 0.006, 0.002]);
    addSphere(iris, `eye-reflection-${side}`, secondaryGlint, [0.011, -0.009, 0.013], [0.0035, 0.004, 0.0015]);
    pupils.push(iris);
  }

  const mouth = addSphere(head, 'mouth', mouthInterior, [0, -0.32, 0.265], [0.068, 0.001, 0.012]);
  const lips = new THREE.Group();
  lips.name = 'lips';
  lips.position.set(0, -0.32, 0.279);
  const upperLip = addCurve(lips, 'upper-lip', lipMaterial, [
    [-0.064, 0, 0],
    [-0.039, 0.008, 0.001],
    [-0.016, 0.006, 0.002],
    [0, 0.003, 0.002],
    [0.016, 0.006, 0.002],
    [0.039, 0.008, 0.001],
    [0.064, 0, 0],
  ], 0.006);
  const lowerLip = addCurve(lips, 'lower-lip', lipMaterial, [
    [-0.059, -0.002, 0],
    [-0.034, -0.011, 0.002],
    [0, -0.015, 0.003],
    [0.034, -0.011, 0.002],
    [0.059, -0.002, 0],
  ], 0.006);
  lowerLip.userData.openY = 0;
  head.add(lips);
  addSphere(head, 'ear-left', faceSkin, [-0.37, -0.02, 0], [0.055, 0.105, 0.07]);
  addSphere(head, 'ear-right', faceSkin, [0.37, -0.02, 0], [0.055, 0.105, 0.07]);
  return {
    root,
    rig: {
      head,
      lids,
      pupils,
      brows,
      mouth,
      lowerLip,
      seconds: 0,
    },
  };
}

export function initializeAvatar3d({
  frame,
  canvas,
  stage = canvas?.parentElement || frame,
  image,
  mouthOverlay,
  fileInput,
  modelButton,
  status,
  parseModel = parseAvatarGlb,
  createRenderer = (options) => new THREE.WebGLRenderer(options),
}) {
  let renderer = null;
  let scene = null;
  let camera = null;
  let modelRoot = null;
  let globeRig = null;
  let animationFrame = 0;
  let animationScheduled = false;
  let resizeObserver = null;
  let intersectionObserver = null;
  let frameVisible = true;
  let pageVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
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
  const expressionValues = { happy: 0, attentive: 0, thinking: 0, frown: 0, speaking: 0 };
  let activeVrm = null;
  let mouthViseme = 'aa';
  let lastFrameTime = 0;
  let loadRequestId = 0;
  const reducedMotionQuery = globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)');

  function canRender() {
    return Boolean(modelRoot && renderer && scene && camera && frameVisible && pageVisible);
  }

  function stopAnimation() {
    if (animationScheduled) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    animationScheduled = false;
    lastFrameTime = 0;
  }

  function scheduleAnimation() {
    if (!animationScheduled && canRender()) {
      animationScheduled = true;
      animationFrame = requestAnimationFrame(animate);
    }
  }

  function updateVisibility() {
    pageVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    if (canRender()) scheduleAnimation();
    else stopAnimation();
  }

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
    stopAnimation();
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
      disposeScene(modelRoot);
    }
    modelRoot = null;
    globeRig = null;
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
    for (const expression of Object.keys(expressionValues)) expressionValues[expression] = 0;
    if (renderer) {
      renderer.dispose();
      renderer = null;
    }
    scene = null;
    camera = null;
    frame.classList.remove('is-3d-active');
    frame.classList.remove('is-globe-active');
    stage.classList.remove('is-avatar-active', 'is-globe-active');
    canvas.hidden = true;
    if (image) image.classList.remove('is-3d-hidden');
    if (mouthOverlay) mouthOverlay.hidden = false;
  }

  function configureRenderer() {
    const quality = getAvatarRenderQuality();
    renderer = createRenderer({
      canvas,
      alpha: true,
      antialias: quality.antialias,
      powerPreference: 'low-power',
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(quality.pixelRatio);
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
    resizeObserver.observe(canvas);
  }

  function resize() {
    if (!renderer || !camera) return;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    const pixelRatio = getAvatarRenderQuality().pixelRatio;
    if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (globeRig) {
      frameHolographicGlobe(camera);
      if (reducedMotionQuery?.matches) scheduleAnimation();
    }
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
    animationScheduled = false;
    animationFrame = 0;
    if (!canRender()) return;
    if (lastFrameTime && now - lastFrameTime < 30) {
      scheduleAnimation();
      return;
    }

    const seconds = now / 1000;
    const deltaTime = lastFrameTime ? Math.min((now - lastFrameTime) / 1000, 0.05) : 1 / 60;
    lastFrameTime = now;
    mouthValue = THREE.MathUtils.damp(mouthValue, targetMouthValue, 13, deltaTime);
    const visemeTargets = mouthTargets.filter(({ name }) => /viseme/i.test(name));
    const expressionTargets = {
      happy: avatarState === 'happy' ? 0.72 : 0,
      attentive: avatarState === 'listening' ? 0.62 : 0,
      thinking: avatarState === 'thinking' ? 0.68 : 0,
      frown: avatarState === 'error' ? 0.72 : 0,
      speaking: avatarState === 'speaking' ? 1 : 0,
    };
    for (const [expression, target] of Object.entries(expressionTargets)) {
      expressionValues[expression] = THREE.MathUtils.damp(expressionValues[expression], target, 7, deltaTime);
    }
    const { happy, attentive, thinking, frown, speaking } = expressionValues;
    if (now >= nextBlinkAt && !blinkStartedAt) {
      blinkStartedAt = now;
      nextBlinkAt = now + 2500 + Math.random() * 3200;
    }
    const blinkProgress = blinkStartedAt ? (now - blinkStartedAt) / 170 : 1;
    const blinkValue = blinkStartedAt && blinkProgress < 1 ? Math.sin(blinkProgress * Math.PI) : 0;
    if (blinkStartedAt && blinkProgress >= 1) blinkStartedAt = 0;
    if (globeRig) {
      animateHolographicGlobe(globeRig, seconds, { reducedMotion: Boolean(reducedMotionQuery?.matches) });
    } else if (builtInRig) {
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

    const tilt = attentive * 0.095 - thinking * 0.075 - frown * 0.035;
    const yaw = -thinking * 0.075 + frown * 0.035;
    const roll = happy * 0.055 + attentive * 0.018 - frown * 0.04;
    const nod = Math.sin(seconds * 2.8) * speaking * 0.018;
    if (headNode) applyHeadMotion(headNode, headBaseRotation, seconds, tilt, { yaw, roll, nod });
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
    if (!globeRig) modelRoot.position.y = modelBasePosition.y + Math.sin(seconds * 0.7) * 0.008;
    renderer.render(scene, camera);
    if (!globeRig || !reducedMotionQuery?.matches) scheduleAnimation();
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
      stage.classList.add('is-avatar-active');
      resize();
      const expressions = [blinkTargets.length && 'blink', smileTargets.length && 'happy', attentiveTargets.length && 'listening', thinkTargets.length && 'thinking'].filter(Boolean);
      const mouthDescription = hasVrmMouth
        ? 'VRM aa/ee/ih/oh/ou expressions'
        : newMouthTargets.map(({ name }) => name).join(', ');
      const identity = vrm?.meta?.name ? ` ${vrm.meta.name}.` : '';
      report(`3D avatar ready.${identity} Mouth: ${mouthDescription}. Face controls: ${expressions.join(', ') || (hasVrmMouth ? 'VRM expressions' : 'mouth only')}.`, 'ready');
      scheduleAnimation();
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
      scheduleAnimation();
      return true;
    } catch (error) {
      disposeModel();
      report(`Could not create the built-in avatar: ${error.message || 'WebGL is unavailable'}. The portrait remains active.`, 'error');
      return false;
    }
  }

  function loadBuiltInGlobe() {
    let rig;
    try {
      rig = createHolographicGlobe();
    } catch (error) {
      disposeModel();
      report(`Could not create the holographic Earth: ${error.message || 'WebGL is unavailable'}. The portrait remains active.`, 'error');
      return false;
    }

    disposeModel();
    try {
      modelRoot = rig.root;
      globeRig = rig;
      modelRoot.scale.setScalar(GLOBE_RENDER_SCALE);
      modelRoot.position.set(0, 0, 0);
      configureRenderer();
      scene.add(modelRoot);
      canvas.hidden = false;
      if (image) image.classList.remove('is-3d-hidden');
      if (mouthOverlay) mouthOverlay.hidden = true;
      frame.classList.add('is-3d-active', 'is-globe-active');
      stage.classList.add('is-globe-active');
      resize();
      report('Holographic Earth online. Globe, orbital rings, and scan effects are active.', 'ready');
      scheduleAnimation();
      return true;
    } catch (error) {
      disposeModel();
      report(`Could not create the holographic Earth: ${error.message || 'WebGL is unavailable'}. The portrait remains active.`, 'error');
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

  if (typeof IntersectionObserver !== 'undefined') {
    intersectionObserver = new IntersectionObserver(([entry]) => {
      frameVisible = Boolean(entry?.isIntersecting);
      updateVisibility();
    });
    intersectionObserver.observe(frame);
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', updateVisibility);
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('orientationchange', resize, { passive: true });
  const onReducedMotionChange = () => {
    if (canRender()) scheduleAnimation();
  };
  reducedMotionQuery?.addEventListener?.('change', onReducedMotionChange);

  function unloadModel() {
    loadRequestId += 1;
    disposeModel();
    reducedMotionQuery?.removeEventListener?.('change', onReducedMotionChange);
  }

  return { loadModel, loadBuiltInAvatar, loadBuiltInGlobe, setState, setMouth, setViseme, unload: unloadModel };
}