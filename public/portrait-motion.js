export const DEFAULT_PORTRAIT_LIVELINESS = 0.6;
export const REDUCED_MOTION_LIVELINESS = 0.15;

const MAX_HEAD_ROTATION = 1.5;
const MAX_HEAD_TRANSLATION = 1.2;
const MAX_MOUTH_OPENING = 0.7;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const randomBetween = (random, minimum, maximum) => minimum + random() * (maximum - minimum);

export function getPortraitLiveliness(reducedMotion = false, configured = DEFAULT_PORTRAIT_LIVELINESS) {
  if (reducedMotion) return REDUCED_MOTION_LIVELINESS;
  return Number.isFinite(configured) ? clamp(configured, 0, 1) : DEFAULT_PORTRAIT_LIVELINESS;
}

export function createPortraitMotion({
  portraitFrame = globalThis.document?.querySelector('.portrait-cutout-frame'),
  portraitHead = portraitFrame?.querySelector('.portrait-head-content'),
  portraitArtwork = globalThis.document?.querySelector('.portrait-artwork'),
  portraitImage = globalThis.document?.querySelector('#ai-avatar'),
  mouthCanvas = portraitFrame?.querySelector('.portrait-mouth-canvas'),
  mouthConfig = { x: 0.517, y: 0.419, width: 0.11 },
  windowRef = globalThis.window,
  reducedMotionQuery = windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)'),
  quality = 'auto',
  liveliness = DEFAULT_PORTRAIT_LIVELINESS,
  random = Math.random,
  requestFrame = windowRef?.requestAnimationFrame?.bind(windowRef),
  cancelFrame = windowRef?.cancelAnimationFrame?.bind(windowRef),
  now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  if (!portraitFrame || !portraitHead || !portraitArtwork || !portraitImage || !mouthCanvas) {
    throw new TypeError('Portrait motion requires the head layer, portrait image, and mouth canvas.');
  }
  const context = mouthCanvas.getContext('2d');
  if (!context) throw new TypeError('Portrait motion requires a 2D mouth canvas context.');

  const scheduleFrame = requestFrame || ((callback) => setTimeout(() => callback(now()), 16));
  const stopFrame = cancelFrame || clearTimeout;
  const current = {
    headRotation: 0,
    headTranslation: 0,
    nod: 0,
    gazeX: 0,
    gazeY: 0,
    mouthOpening: 0,
  };
  let running = false;
  let frameId = 0;
  let lastFrameTime = null;
  let reducedMotion = Boolean(reducedMotionQuery?.matches);
  let selectedQuality = quality;
  let configuredLiveliness = liveliness;
  let eyeMode = 'idle';
  let speaking = false;
  let audioLevel = null;
  let speechCue = 0;
  let speechViseme = 'neutral';
  let speechCueAt = -Infinity;
  let nodStartedAt = -Infinity;
  let nodDuration = 220;
  let motionTime = 0;
  const stateBlend = { listening: 0, thinking: 0, speaking: 0 };
  let nextGazeChange = 0;
  let thinkingGlanceUntil = 0;
  let thinkingGazeX = 0;
  let targetGazeX = 0;
  let targetGazeY = 0;
  let destroyed = false;

  function motionScale() {
    return getPortraitLiveliness(reducedMotion, configuredLiveliness) / DEFAULT_PORTRAIT_LIVELINESS;
  }

  function readAudioLevel() {
    const level = windowRef?.jarvisAudioLevel;
    return Number.isFinite(level) ? clamp(level, 0, 1) : audioLevel;
  }

  function applyStyle(target, name, value, unit = '') {
    target.style.setProperty(name, `${value.toFixed(3)}${unit}`);
  }

  function drawMouth(opening, viseme) {
    context.clearRect(0, 0, mouthCanvas.width, mouthCanvas.height);
    if (opening <= 0.005) return;

    const centerX = mouthConfig.x * mouthCanvas.width;
    const centerY = mouthConfig.y * mouthCanvas.height;
    const width = Math.min(mouthConfig.width * mouthCanvas.width * 0.72, 66)
      * (viseme === 'ou' ? 0.82 : 1);
    const height = 3 + opening * 25;

    context.save();
    context.translate(centerX, centerY);
    context.beginPath();
    context.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2);
    const interior = context.createLinearGradient(0, -height / 2, 0, height / 2);
    interior.addColorStop(0, '#24121a');
    interior.addColorStop(0.58, '#180b11');
    interior.addColorStop(1, '#713846');
    context.fillStyle = interior;
    context.fill();

    context.beginPath();
    context.ellipse(0, -height * 0.34, width * 0.43, Math.max(1, height * 0.1), 0, 0, Math.PI);
    context.strokeStyle = 'rgba(201, 111, 121, .78)';
    context.lineWidth = 2.2;
    context.stroke();

    if (opening > 0.48) {
      context.beginPath();
      context.ellipse(0, -height * 0.24, width * 0.34, Math.max(1, height * 0.09), 0, 0, Math.PI);
      context.fillStyle = 'rgba(255, 231, 218, .92)';
      context.fill();
    }

    if (portraitImage.complete && portraitImage.naturalWidth > 0) {
      context.save();
      context.beginPath();
      context.ellipse(0, height * 0.28 + opening * 2, width * 0.48, height * 0.42, 0, 0, Math.PI);
      context.clip();
      context.globalAlpha = 0.9;
      context.drawImage(
        portraitImage,
        centerX - width / 2,
        centerY + 2,
        width,
        12,
        -width / 2,
        height * 0.28 + opening * 2,
        width,
        12,
      );
      context.restore();
    }

    context.beginPath();
    context.moveTo(-width * 0.35, height * 0.31);
    context.quadraticCurveTo(0, height * 0.62, width * 0.35, height * 0.31);
    context.strokeStyle = 'rgba(180, 91, 104, .82)';
    context.lineWidth = 2;
    context.stroke();
    context.restore();
  }

  function applyMotion(timestamp) {
    const scale = motionScale();
    const delta = clamp(timestamp - (lastFrameTime ?? timestamp - 16), 1, 32);
    const smoothing = 1 - Math.exp(-delta / 75);
    lastFrameTime = timestamp;
    motionTime += delta;
    const stateSmoothing = 1 - Math.exp(-delta / 350);
    stateBlend.listening += ((eyeMode === 'listening' ? 1 : 0) - stateBlend.listening) * stateSmoothing;
    stateBlend.thinking += ((eyeMode === 'thinking' ? 1 : 0) - stateBlend.thinking) * stateSmoothing;
    stateBlend.speaking += ((speaking ? 1 : 0) - stateBlend.speaking) * stateSmoothing;

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
      targetGazeX = timestamp < thinkingGlanceUntil ? thinkingGazeX * scale : 0;
      targetGazeY = timestamp < thinkingGlanceUntil ? -0.8 * scale : 0;
    } else {
      targetGazeX = 0;
      targetGazeY = 0;
    }

    const noise = (
      Math.sin(motionTime * (2 * Math.PI / 7_000))
      + Math.sin(motionTime * (2 * Math.PI / 11_000) + 1.4) * 0.7
      + Math.sin(motionTime * (2 * Math.PI / 17_000) + 2.2) * 0.5
    ) / 2.2;
    const listeningTurn = stateBlend.listening * 0.25;
    const thinkingTurn = stateBlend.thinking * thinkingGazeX * 0.22;
    const nodElapsed = timestamp - nodStartedAt;
    const nod = nodElapsed >= 0 && nodElapsed < nodDuration
      ? -Math.sin((nodElapsed / nodDuration) * Math.PI) * 1
      : 0;
    const cueAge = timestamp - speechCueAt;
    const cueEnvelope = cueAge < 360 ? speechCue * (1 - cueAge / 360) : 0;
    const pseudoEnvelope = (
      Math.sin(timestamp / 83) * 0.15
      + Math.sin(timestamp / 137 + 1.9) * 0.11
      + Math.sin(timestamp / 211 + 0.6) * 0.08
    );
    const audio = speaking ? readAudioLevel() : null;
    const targetMouth = speaking
      ? clamp((audio === null ? 0.12 + Math.max(0, pseudoEnvelope) + cueEnvelope : audio * 0.62 + cueEnvelope), 0, MAX_MOUTH_OPENING)
      : 0;
    const headScale = selectedQuality === 'low' ? 0 : scale;
    const targetRotation = clamp(
      noise * 0.82 * headScale + listeningTurn * headScale + thinkingTurn * headScale
        + nod * headScale * stateBlend.speaking,
      -MAX_HEAD_ROTATION,
      MAX_HEAD_ROTATION,
    );
    const targetTranslation = noise * MAX_HEAD_TRANSLATION * headScale;

    current.headRotation += (targetRotation - current.headRotation) * smoothing;
    current.headTranslation += (targetTranslation - current.headTranslation) * smoothing;
    current.nod += (nod - current.nod) * smoothing;
    current.gazeX += (targetGazeX - current.gazeX) * smoothing;
    current.gazeY += (targetGazeY - current.gazeY) * smoothing;
    current.mouthOpening += (targetMouth - current.mouthOpening) * smoothing;

    applyStyle(portraitHead, '--portrait-head-rotation', current.headRotation, 'deg');
    applyStyle(portraitHead, '--portrait-head-y', current.headTranslation, 'px');
    applyStyle(portraitHead, '--portrait-gaze-x', current.gazeX, 'px');
    applyStyle(portraitHead, '--portrait-gaze-y', current.gazeY, 'px');
    applyStyle(portraitFrame, '--portrait-mouth-open', current.mouthOpening);
    drawMouth(current.mouthOpening, cueAge < 360 ? speechViseme : 'neutral');
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

  function handleReducedMotionChange(event) {
    reducedMotion = Boolean(event.matches);
  }

  function handleVisibilityChange() {
    if (windowRef?.document?.hidden) stop();
    else start();
  }

  windowRef?.document?.addEventListener?.('visibilitychange', handleVisibilityChange);
  if (reducedMotionQuery?.addEventListener) reducedMotionQuery.addEventListener('change', handleReducedMotionChange);
  else reducedMotionQuery?.addListener?.(handleReducedMotionChange);
  start();

  return {
    setSpeaking(active) {
      speaking = Boolean(active);
      if (!speaking) {
        audioLevel = null;
        speechCue = 0;
        speechViseme = 'neutral';
        speechCueAt = -Infinity;
        nodStartedAt = -Infinity;
      }
    },
    setEyeMode(mode) {
      eyeMode = ['idle', 'thinking', 'listening'].includes(mode) ? mode : 'idle';
      nextGazeChange = 0;
      if (eyeMode === 'thinking') {
        thinkingGazeX = random() < 0.5 ? -1 : 1;
        thinkingGlanceUntil = now() + 700;
      } else {
        targetGazeX = 0;
        targetGazeY = 0;
      }
    },
    setSpeechCue(opening, viseme, { emphasis = false } = {}) {
      if (!speaking || !Number.isFinite(opening)) return false;
      speechCue = clamp(opening, 0, 1) * MAX_MOUTH_OPENING;
      speechViseme = ['aa', 'ee', 'ih', 'oh', 'ou'].includes(viseme) ? viseme : 'neutral';
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
    },
    setLiveliness(value) {
      if (Number.isFinite(value)) configuredLiveliness = clamp(value, 0, 1);
    },
    get liveliness() {
      return getPortraitLiveliness(reducedMotion, configuredLiveliness);
    },
    getState() {
      return {
        quality: selectedQuality,
        liveliness: getPortraitLiveliness(reducedMotion, configuredLiveliness),
        eyeMode,
        speaking,
        ...current,
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      windowRef?.document?.removeEventListener?.('visibilitychange', handleVisibilityChange);
      if (reducedMotionQuery?.removeEventListener) reducedMotionQuery.removeEventListener('change', handleReducedMotionChange);
      else reducedMotionQuery?.removeListener?.(handleReducedMotionChange);
    },
  };
}
