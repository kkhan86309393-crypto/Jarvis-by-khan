export const DEFAULT_PORTRAIT_LIVELINESS = 0.6;
export const REDUCED_MOTION_LIVELINESS = 0.15;

const MAX_TILT_DEGREES = 3;
const MAX_MOUTH_OPENING = 0.42;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const randomBetween = (random, minimum, maximum) => minimum + random() * (maximum - minimum);

export function getPortraitLiveliness(reducedMotion = false) {
  return reducedMotion ? REDUCED_MOTION_LIVELINESS : DEFAULT_PORTRAIT_LIVELINESS;
}

export function createPortraitMotion({
  stage = globalThis.document?.querySelector('#holo-stage'),
  portraitFrame = globalThis.document?.querySelector('.portrait-cutout-frame'),
  portraitArtwork = globalThis.document?.querySelector('.portrait-artwork'),
  sphere = globalThis.document?.querySelector('.holo-sphere-shell'),
  mouth = globalThis.document?.querySelector('.portrait-mouth'),
  windowRef = globalThis.window,
  reducedMotionQuery = windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)'),
  quality = 'auto',
  random = Math.random,
  requestFrame = windowRef?.requestAnimationFrame?.bind(windowRef),
  cancelFrame = windowRef?.cancelAnimationFrame?.bind(windowRef),
  now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  if (!stage || !portraitFrame || !portraitArtwork || !sphere || !mouth) {
    throw new TypeError('Portrait motion requires the existing portrait and hologram layers.');
  }

  const scheduleFrame = requestFrame || ((callback) => setTimeout(() => callback(now()), 16));
  const stopFrame = cancelFrame || clearTimeout;
  const current = {
    tiltX: 0,
    tiltY: 0,
    depthX: 0,
    depthY: 0,
    sphereDepthX: 0,
    sphereDepthY: 0,
    gazeX: 0,
    gazeY: 0,
    headDrift: 0,
    nod: 0,
    mouthOpening: 0,
  };
  let running = false;
  let frameId = 0;
  let lastFrameTime = null;
  let pointer = null;
  let dragging = false;
  let orientation = null;
  let orientationListening = false;
  let orientationPermissionRequested = false;
  let reducedMotion = Boolean(reducedMotionQuery?.matches);
  let selectedQuality = quality;
  let eyeMode = 'idle';
  let speaking = false;
  let audioLevel = null;
  let speechCue = 0;
  let speechCueAt = -Infinity;
  let nodStartedAt = -Infinity;
  let nodDuration = 220;
  let nextGazeChange = 0;
  let thinkingGlanceUntil = 0;
  let thinkingGazeX = 0;
  let targetGazeX = 0;
  let targetGazeY = 0;
  let destroyed = false;

  function motionScale() {
    return getPortraitLiveliness(reducedMotion) / DEFAULT_PORTRAIT_LIVELINESS;
  }

  function readAudioLevel() {
    const level = windowRef?.jarvisAudioLevel;
    return Number.isFinite(level) ? clamp(level, 0, 1) : audioLevel;
  }

  function applyStyle(target, name, value, unit = '') {
    target.style.setProperty(name, `${value.toFixed(3)}${unit}`);
  }

  function applyMotion(timestamp) {
    const scale = motionScale();
    const input = pointer || orientation;
    const tiltScale = selectedQuality === 'low' ? 0 : scale;
    const targetTiltX = input ? clamp(-input.y * MAX_TILT_DEGREES * tiltScale, -MAX_TILT_DEGREES, MAX_TILT_DEGREES) : 0;
    const targetTiltY = input ? clamp(input.x * MAX_TILT_DEGREES * tiltScale, -MAX_TILT_DEGREES, MAX_TILT_DEGREES) : 0;
    const depthScale = selectedQuality === 'low' ? 0 : scale;
    const targetDepthX = input ? input.x * 5 * depthScale : 0;
    const targetDepthY = input ? input.y * 4 * depthScale : 0;
    const targetSphereDepthX = -targetDepthX * 0.7;
    const targetSphereDepthY = -targetDepthY * 0.7;
    const smoothing = 1 - Math.exp(-Math.max(1, timestamp - (lastFrameTime ?? timestamp - 16)) / 85);
    lastFrameTime = timestamp;

    if (eyeMode === 'idle' && timestamp >= nextGazeChange) {
      if (targetGazeX || targetGazeY) {
        targetGazeX = 0;
        targetGazeY = 0;
        nextGazeChange = timestamp + randomBetween(random, 800, 3_000);
      } else {
        targetGazeX = randomBetween(random, -1.35, 1.35) * scale;
        targetGazeY = randomBetween(random, -0.75, 0.45) * scale;
        nextGazeChange = timestamp + randomBetween(random, 220, 420);
      }
    } else if (eyeMode === 'thinking') {
      if (timestamp < thinkingGlanceUntil) {
        targetGazeX = thinkingGazeX * scale;
        targetGazeY = -1.15 * scale;
      } else {
        targetGazeX = 0;
        targetGazeY = 0;
      }
    } else {
      targetGazeX = 0;
      targetGazeY = 0;
    }

    const breath = 1 + Math.sin(timestamp * (2 * Math.PI / 4_600)) * 0.006 * scale;
    const drift = (
      Math.sin(timestamp / 3_100 + 0.8) * 0.9
      + Math.sin(timestamp / 5_200 + 2.1) * 0.6
    ) * scale;
    const listeningTilt = eyeMode === 'listening' ? 0.35 * scale : 0;
    const nodElapsed = timestamp - nodStartedAt;
    const nod = nodElapsed >= 0 && nodElapsed < nodDuration
      ? -Math.sin((nodElapsed / nodDuration) * Math.PI) * 1.5 * scale
      : 0;
    const audio = speaking ? readAudioLevel() : null;
    const fallbackEnvelope = 0.08 + ((Math.sin(timestamp / 95) + 1) / 2) * 0.12;
    const cueAge = timestamp - speechCueAt;
    const activeCue = cueAge < 420 ? speechCue * (1 - cueAge / 420) : 0;
    const speechSignal = audio === null
      ? activeCue * 0.72 + fallbackEnvelope * 0.28
      : Math.max(activeCue * 0.35, audio * 0.42);
    const targetMouth = speaking
      ? clamp(speechSignal * scale, 0, MAX_MOUTH_OPENING)
      : 0;

    current.tiltX += (targetTiltX - current.tiltX) * smoothing;
    current.tiltY += (targetTiltY - current.tiltY) * smoothing;
    current.depthX += (targetDepthX - current.depthX) * smoothing;
    current.depthY += (targetDepthY - current.depthY) * smoothing;
    current.sphereDepthX += (targetSphereDepthX - current.sphereDepthX) * smoothing;
    current.sphereDepthY += (targetSphereDepthY - current.sphereDepthY) * smoothing;
    current.gazeX += (targetGazeX - current.gazeX) * smoothing;
    current.gazeY += (targetGazeY - current.gazeY) * smoothing;
    const targetHeadDrift = clamp(drift + listeningTilt, -1.5 * scale, 1.5 * scale);
    current.headDrift += (targetHeadDrift - current.headDrift) * smoothing;
    current.nod += (nod - current.nod) * smoothing;
    current.mouthOpening = targetMouth;

    applyStyle(portraitFrame, '--portrait-tilt-x', current.tiltX, 'deg');
    applyStyle(portraitFrame, '--portrait-tilt-y', current.tiltY, 'deg');
    applyStyle(portraitFrame, '--portrait-head-drift', current.headDrift, 'deg');
    applyStyle(portraitFrame, '--portrait-nod', current.nod, 'deg');
    applyStyle(portraitFrame, '--portrait-breath', breath);
    applyStyle(portraitFrame, '--portrait-depth-x', current.depthX, 'px');
    applyStyle(portraitFrame, '--portrait-depth-y', current.depthY, 'px');
    applyStyle(portraitArtwork, '--portrait-gaze-x', current.gazeX, 'px');
    applyStyle(portraitArtwork, '--portrait-gaze-y', current.gazeY, 'px');
    applyStyle(sphere, '--sphere-depth-x', current.sphereDepthX, 'px');
    applyStyle(sphere, '--sphere-depth-y', current.sphereDepthY, 'px');
    applyStyle(mouth, '--portrait-mouth-open', current.mouthOpening);
  }

  function animate(timestamp) {
    if (!running || destroyed) return;
    applyMotion(Number.isFinite(timestamp) ? timestamp : now());
    frameId = scheduleFrame(animate);
  }

  function start() {
    if (running || destroyed) return;
    running = true;
    frameId = scheduleFrame(animate);
  }

  function stop() {
    if (!running) return;
    running = false;
    stopFrame(frameId);
    frameId = 0;
    lastFrameTime = null;
  }

  function updatePointer(event) {
    if (selectedQuality === 'low') return;
    const bounds = stage.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    pointer = {
      x: clamp(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -1, 1),
      y: clamp(((event.clientY - bounds.top) / bounds.height) * 2 - 1, -1, 1),
    };
  }

  function handlePointerMove(event) {
    if (event.pointerType === 'mouse' || dragging) updatePointer(event);
  }

  function handlePointerDown(event) {
    if (selectedQuality === 'low') return;
    requestDeviceOrientation();
    if (event.pointerType !== 'mouse') dragging = true;
    updatePointer(event);
  }

  function handlePointerEnd() {
    dragging = false;
    pointer = null;
  }

  function handlePointerLeave() {
    if (!dragging) pointer = null;
  }

  function handleOrientation(event) {
    if (selectedQuality === 'low') return;
    if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
    orientation = {
      x: clamp(event.gamma / 25, -1, 1),
      y: clamp(event.beta / 25, -1, 1),
    };
  }

  function addOrientationListener() {
    if (orientationListening || !windowRef?.addEventListener) return;
    windowRef.addEventListener('deviceorientation', handleOrientation);
    orientationListening = true;
  }

  async function requestDeviceOrientation() {
    if (orientationPermissionRequested) return;
    const orientationApi = windowRef?.DeviceOrientationEvent;
    if (typeof orientationApi?.requestPermission !== 'function') {
      addOrientationListener();
      orientationPermissionRequested = true;
      return;
    }
    orientationPermissionRequested = true;
    try {
      const permission = await orientationApi.requestPermission();
      if (permission === 'granted') addOrientationListener();
    } catch (error) {
      windowRef?.console?.warn?.('J.A.R.V.I.S. could not enable device orientation.', error);
    }
  }

  function handleReducedMotionChange(event) {
    reducedMotion = Boolean(event.matches);
  }

  function handleVisibilityChange() {
    if (windowRef?.document?.hidden) stop();
    else start();
  }

  stage.addEventListener('pointermove', handlePointerMove, { passive: true });
  stage.addEventListener('pointerdown', handlePointerDown, { passive: true });
  stage.addEventListener('pointerleave', handlePointerLeave, { passive: true });
  windowRef?.addEventListener?.('pointerup', handlePointerEnd, { passive: true });
  windowRef?.addEventListener?.('pointercancel', handlePointerEnd, { passive: true });
  windowRef?.document?.addEventListener?.('visibilitychange', handleVisibilityChange);
  if (reducedMotionQuery?.addEventListener) reducedMotionQuery.addEventListener('change', handleReducedMotionChange);
  else reducedMotionQuery?.addListener?.(handleReducedMotionChange);
  if (typeof windowRef?.DeviceOrientationEvent?.requestPermission !== 'function') addOrientationListener();
  start();

  return {
    setSpeaking(active) {
      speaking = Boolean(active);
      if (!speaking) {
        audioLevel = null;
        speechCue = 0;
        speechCueAt = -Infinity;
        nodStartedAt = -Infinity;
      }
    },
    setEyeMode(mode) {
      eyeMode = ['idle', 'thinking', 'listening'].includes(mode) ? mode : 'idle';
      nextGazeChange = 0;
      if (eyeMode === 'thinking') {
        thinkingGazeX = random() < 0.5 ? -1.15 : 1.15;
        thinkingGlanceUntil = now() + 700;
      } else {
        targetGazeX = 0;
        targetGazeY = 0;
      }
    },
    setSpeechCue(opening, _viseme, { emphasis = false } = {}) {
      if (!speaking || !Number.isFinite(opening)) return false;
      speechCue = clamp(opening, 0, 0.9) * MAX_MOUTH_OPENING;
      speechCueAt = now();
      if (emphasis) {
        nodStartedAt = speechCueAt;
        nodDuration = randomBetween(random, 190, 260);
      }
      return true;
    },
    setAudioLevel(level) {
      audioLevel = Number.isFinite(level) ? clamp(level, 0, 1) : null;
    },
    setQuality(nextQuality) {
      selectedQuality = ['auto', 'high', 'medium', 'low'].includes(nextQuality) ? nextQuality : 'auto';
      if (selectedQuality === 'low') {
        pointer = null;
        orientation = null;
        current.tiltX = 0;
        current.tiltY = 0;
        current.depthX = 0;
        current.depthY = 0;
        current.sphereDepthX = 0;
        current.sphereDepthY = 0;
      }
    },
    get liveliness() {
      return getPortraitLiveliness(reducedMotion);
    },
    getState() {
      return {
        quality: selectedQuality,
        liveliness: getPortraitLiveliness(reducedMotion),
        eyeMode,
        speaking,
        ...current,
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      stage.removeEventListener('pointermove', handlePointerMove);
      stage.removeEventListener('pointerdown', handlePointerDown);
      stage.removeEventListener('pointerleave', handlePointerLeave);
      windowRef?.removeEventListener?.('pointerup', handlePointerEnd);
      windowRef?.removeEventListener?.('pointercancel', handlePointerEnd);
      windowRef?.removeEventListener?.('deviceorientation', handleOrientation);
      windowRef?.document?.removeEventListener?.('visibilitychange', handleVisibilityChange);
      if (reducedMotionQuery?.removeEventListener) reducedMotionQuery.removeEventListener('change', handleReducedMotionChange);
      else reducedMotionQuery?.removeListener?.(handleReducedMotionChange);
    },
  };
}
