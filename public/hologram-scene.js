import * as THREE from 'three';

const BLUE = new THREE.Color(0x2ea8ff);
const CYAN = new THREE.Color(0x00e5ff);
const PURPLE = new THREE.Color(0x8b5cf6);
const GREEN = new THREE.Color(0x22e58b);

export function applyHologramMaterial(root) {
  root.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((source, index) => {
      if (source.userData?.jarvisHologram) return;
      source.onBeforeCompile = (shader) => {
        shader.uniforms.uHologramTime = source.userData.uHologramTime ||= { value: 0 };
        shader.uniforms.uHologramStrength = source.userData.uHologramStrength ||= { value: 0.62 };
        shader.vertexShader = shader.vertexShader.replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vHoloNormal;\nvarying vec3 vHoloView;',
        ).replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvec4 holoViewPosition = modelViewMatrix * vec4(position, 1.0);\nvHoloNormal = normalize(normalMatrix * normal);\nvHoloView = -holoViewPosition.xyz;',
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vHoloNormal;\nvarying vec3 vHoloView;\nuniform float uHologramTime;\nuniform float uHologramStrength;',
        ).replace(
          '#include <opaque_fragment>',
          `float holoFresnel = pow(1.0 - abs(dot(normalize(vHoloNormal), normalize(vHoloView))), 2.25);
          float holoScan = sin((vHoloView.y * 18.0) - uHologramTime * 5.0) * 0.5 + 0.5;
          float holoGlitch = step(0.992, sin(uHologramTime * 37.0) * sin(uHologramTime * 7.0));
          vec3 holoTint = mix(vec3(0.18, 0.66, 1.0), vec3(0.0, 0.90, 1.0), holoScan);
          outgoingLight = mix(outgoingLight, outgoingLight * holoTint, uHologramStrength * 0.72);
          outgoingLight += holoTint * (holoFresnel * 0.95 + holoScan * 0.025 + holoGlitch * 0.12);
          diffuseColor.a *= 0.86;
          \n#include <opaque_fragment>`,
        );
      };
      source.transparent = true;
      source.depthWrite = source.depthWrite !== false;
      source.userData.jarvisHologram = true;
      source.needsUpdate = true;
      if (Array.isArray(object.material)) object.material[index] = source;
      else object.material = source;
    });
  });
}

export function removeHologramMaterial(root) {
  root.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      if (material.userData?.jarvisHologram) {
        material.transparent = false;
        material.userData.jarvisHologram = false;
        material.onBeforeCompile = undefined;
        material.needsUpdate = true;
      }
    });
  });
}

function createTextPanel(label, accent, position, rotation) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext?.('2d');
  if (!context || typeof context.fillRect !== 'function') return null;
  context.fillStyle = 'rgba(5, 24, 48, 0.72)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = accent;
  context.lineWidth = 4;
  context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  context.fillStyle = '#bdf6ff';
  context.font = 'bold 18px monospace';
  context.fillText(label, 24, 34);
  context.strokeStyle = accent;
  context.lineWidth = 3;
  context.beginPath();
  for (let x = 24; x < 232; x += 5) {
    const y = 78 + Math.sin(x * 0.12) * 14 + Math.random() * 6;
    if (x === 24) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.82, 0.41),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.68, depthWrite: false, side: THREE.DoubleSide }),
  );
  mesh.position.copy(position);
  mesh.rotation.set(rotation.x, rotation.y, rotation.z);
  mesh.userData.texture = texture;
  mesh.userData.baseY = position.y;
  return mesh;
}

export function createHologramScene({ quality = 'high' } = {}) {
  const root = new THREE.Group();
  root.name = 'jarvis-hologram-scene';
  const globe = new THREE.Group();
  root.add(globe);
  const rimMaterial = new THREE.MeshBasicMaterial({
    color: 0x2ea8ff, transparent: true, opacity: 0.18, side: THREE.BackSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.52, quality === 'high' ? 48 : 32, quality === 'high' ? 32 : 20), rimMaterial);
  globe.add(sphere);

  const wireGeometry = new THREE.SphereGeometry(1.505, 18, 12);
  const wire = new THREE.Mesh(wireGeometry, new THREE.MeshBasicMaterial({
    color: 0x42cfff, wireframe: true, transparent: true, opacity: 0.075,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  globe.add(wire);

  const rings = [];
  const nodes = [];
  for (let index = 0; index < 3; index += 1) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.68 + index * 0.09, 0.008, 5, 96),
      new THREE.MeshBasicMaterial({ color: index === 1 ? 0x00e5ff : 0x2ea8ff, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    ring.rotation.set(index === 0 ? 1.18 : 0.42 + index * 0.28, index * 0.4, index * 0.9);
    ring.userData.speed = (index % 2 ? -1 : 1) * (0.12 + index * 0.035);
    globe.add(ring);
    rings.push(ring);
    const node = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), new THREE.MeshBasicMaterial({
      color: 0xbffaff, blending: THREE.AdditiveBlending,
    }));
    node.userData.ringIndex = index;
    node.userData.phase = index * 2.1;
    globe.add(node);
    nodes.push(node);
  }

  const platform = new THREE.Group();
  platform.position.y = -1.48;
  for (let index = 0; index < 4; index += 1) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.28 + index * 0.19, 0.3 + index * 0.19, 96),
      new THREE.MeshBasicMaterial({ color: index % 2 ? 0x00e5ff : 0x2ea8ff, transparent: true, opacity: 0.48,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.userData.speed = (index % 2 ? -1 : 1) * (0.1 + index * 0.025);
    platform.add(ring);
    rings.push(ring);
  }
  root.add(platform);

  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0x2ea8ff, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.62, 2.9, 32, 1, true), beamMaterial);
  beam.position.y = -0.03;
  root.add(beam);

  let particles = null;
  if (quality !== 'low') {
    const count = quality === 'high' ? 240 : 150;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const radius = 0.2 + Math.random() * 1.18;
      const angle = Math.random() * Math.PI * 2;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = -1.35 + Math.random() * 2.7;
      positions[index * 3 + 2] = Math.sin(angle) * radius;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particles = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: 0x8cecff, size: 0.018, transparent: true, opacity: 0.42,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    root.add(particles);
  }

  const panels = [];
  if (quality !== 'low') {
    const panelSpecs = [
      ['SYS 03', 0x50dfff, new THREE.Vector3(-1.72, 0.72, 0.05), new THREE.Vector3(0, 0.32, -0.08)],
      ['VOICE 24K', 0x8c82ff, new THREE.Vector3(1.68, 0.18, -0.05), new THREE.Vector3(0, -0.35, 0.08)],
    ];
    panelSpecs.forEach(([label, color, position, rotation]) => {
      const panel = createTextPanel(label, `#${color.toString(16).padStart(6, '0')}`, position, rotation);
      if (panel) {
        root.add(panel);
        panels.push(panel);
      }
    });
  }

  let state = 'idle';
  let level = 0;
  const targetColor = new THREE.Color();
  targetColor.copy(BLUE);

  function setState(nextState, nextLevel = 0) {
    state = ['idle', 'listening', 'thinking', 'speaking'].includes(nextState) ? nextState : 'idle';
    level = THREE.MathUtils.clamp(Number(nextLevel) || 0, 0, 1);
    targetColor.copy(state === 'thinking' ? PURPLE : state === 'speaking' ? GREEN : CYAN);
  }

  function update(seconds, delta, reducedMotion) {
    targetColor.copy(state === 'thinking' ? PURPLE : state === 'speaking' ? GREEN : CYAN);
    rimMaterial.color.lerp(targetColor, THREE.MathUtils.damp(0, 1, 10, delta));
    rimMaterial.opacity = THREE.MathUtils.lerp(rimMaterial.opacity, (state === 'listening' ? 0.26 + level * 0.18 : state === 'thinking' ? 0.24 : 0.18), 0.12);
    beamMaterial.color.lerp(targetColor, THREE.MathUtils.damp(0, 1, 10, delta));
    beamMaterial.opacity = THREE.MathUtils.lerp(beamMaterial.opacity, state === 'speaking' ? 0.08 + level * 0.3 : 0.09, 0.12);
    wire.rotation.y += delta * (reducedMotion ? 0 : (state === 'thinking' ? 0.24 : 0.09));
    rings.forEach((ring, index) => {
      ring.rotation.z += delta * ring.userData.speed * (state === 'thinking' ? 3.3 : state === 'listening' ? 1 + level : 1);
      if (index < 3 && !reducedMotion) ring.rotation.y += delta * ring.userData.speed * 0.3;
    });
    nodes.forEach((node) => {
      const ring = rings[node.userData.ringIndex];
      const angle = seconds * (0.38 + node.userData.ringIndex * 0.08) + node.userData.phase;
      node.position.copy(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).applyEuler(ring.rotation).multiplyScalar(1.68 + node.userData.ringIndex * 0.09));
      node.position.y += 0;
    });
    if (particles && !reducedMotion) {
      const speed = state === 'thinking' ? 0.42 : 0.12;
      const positions = particles.geometry.attributes.position.array;
      for (let index = 0; index < positions.length; index += 3) {
        positions[index + 1] += delta * speed;
        if (positions[index + 1] > 1.38) positions[index + 1] = -1.38;
      }
      particles.geometry.attributes.position.needsUpdate = true;
      particles.rotation.y += delta * 0.05;
    }
    panels.forEach((panel, index) => {
      if (!reducedMotion) panel.position.y = panel.userData.baseY + Math.sin(seconds * 0.9 + index * 2) * 0.045;
    });
    if (!reducedMotion) root.position.y = Math.sin(seconds * 0.7) * 0.018;
  }

  function dispose() {
    root.traverse((object) => {
      object.geometry?.dispose();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
      else object.material?.dispose();
      if (object.userData?.texture) object.userData.texture.dispose();
    });
  }

  return { root, setState, update, dispose };
}
