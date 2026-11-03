const BLINK_MIN_INTERVAL_MS = 2_500;
const BLINK_INTERVAL_RANGE_MS = 3_500;
const REDUCED_MOTION_MIN_INTERVAL_MS = 4_000;
const REDUCED_MOTION_INTERVAL_RANGE_MS = 4_000;
const SPEAKING_BLINK_FACTOR = 0.9;
const LISTENING_BLINK_FACTOR = 0.98;
const THINKING_BLINK_FACTOR = 0.95;
const DOUBLE_BLINK_CHANCE = 1 / 6;
const REDUCED_MOTION_DOUBLE_BLINK_CHANCE = 1 / 10;
const VISMESES = new Set(['neutral', 'aa', 'ee', 'ih', 'oh', 'ou']);
export const PORTRAIT_ANIMATION_EVENT = 'jarvis:portrait-animation';

export const PORTRAIT_OVERLAY_CONFIG = Object.freeze({
  reference: {
    eyes: { y: 0.264, leftX: 0.435, rightX: 0.565 },
    mouth: { x: 0.5, y: 0.438 },
    chin: { y: 0.52 },
  },
  cutout: {
    eyes: { y: 0.288, leftX: 0.436, rightX: 0.589, rightY: 0.276, width: 0.11, height: 0.05 },
    mouth: { x: 0.529, y: 0.423, width: 0.11 },
    chin: { x: 0.517, y: 0.50 },
  },
});

export function createPortraitAnimation({
  onChange = () => {},
  random = Math.random,
  schedule = globalThis.setTimeout,
  cancel = globalThis.clearTimeout,
  documentRef = globalThis.document,
  reducedMotionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null,
} = {}) {
  let blink = 'open';
  let viseme = 'neutral';
  let speaking = false;
  let eyeMode = 'idle';
  let activePlaybackId = null;
  let destroyed = false;
  let blinkCloseDuration = 50;
  let blinkOpenDuration = 90;
  const blinkTimers = new Set();

  function emit() {
    if (!destroyed) {
      onChange({
        blink,
        viseme,
        speaking,
        eyeMode,
        blinkCloseDuration,
        blinkOpenDuration,
      });
    }
  }

  function scheduleBlink(callback, delay) {
    const timer = schedule(() => {
      blinkTimers.delete(timer);
      if (!destroyed) callback();
    }, delay);
    blinkTimers.add(timer);
  }

  function clearBlinkTimers() {
    for (const timer of blinkTimers) cancel(timer);
    blinkTimers.clear();
  }

  function isVisible() {
    return !documentRef?.hidden;
  }

  function runBlink(holdDurationMs) {
    if (destroyed || !isVisible()) return;
    blinkCloseDuration = 45 + random() * 15;
    blinkOpenDuration = 70 + random() * 25;
    const closedHoldDuration = Number.isFinite(holdDurationMs)
      ? Math.min(500, Math.max(0, holdDurationMs))
      : 35 + random() * 25;
    blink = 'closed';
    emit();
    scheduleBlink(() => {
      blink = 'open';
      emit();
      const doubleBlinkChance = reducedMotionQuery?.matches
        ? REDUCED_MOTION_DOUBLE_BLINK_CHANCE
        : DOUBLE_BLINK_CHANCE;
      if (random() < doubleBlinkChance) {
        scheduleNextBlink(180 + random() * 70);
      } else {
        scheduleNextBlink();
      }
    }, blinkCloseDuration + closedHoldDuration);
  }

  function scheduleNextBlink(delay) {
    if (destroyed || !isVisible()) return;
    const minimum = reducedMotionQuery?.matches
      ? REDUCED_MOTION_MIN_INTERVAL_MS
      : BLINK_MIN_INTERVAL_MS;
    const range = reducedMotionQuery?.matches
      ? REDUCED_MOTION_INTERVAL_RANGE_MS
      : BLINK_INTERVAL_RANGE_MS;
    const stateFactor = speaking
      ? SPEAKING_BLINK_FACTOR
      : eyeMode === 'thinking' ? THINKING_BLINK_FACTOR
        : eyeMode === 'listening' ? LISTENING_BLINK_FACTOR : 1;
    const interval = delay ?? minimum + random() * range * stateFactor;
    scheduleBlink(runBlink, interval);
  }

  function handleVisibilityChange() {
    clearBlinkTimers();
    if (!isVisible()) {
      if (blink !== 'open') {
        blink = 'open';
        emit();
      }
      return;
    }
    scheduleNextBlink();
  }

  function handleReducedMotionChange() {
    if (blink !== 'open') return;
    clearBlinkTimers();
    scheduleNextBlink();
  }

  documentRef?.addEventListener?.('visibilitychange', handleVisibilityChange);
  if (reducedMotionQuery?.addEventListener) {
    reducedMotionQuery.addEventListener('change', handleReducedMotionChange);
  } else {
    reducedMotionQuery?.addListener?.(handleReducedMotionChange);
  }

  emit();
  scheduleNextBlink();

  function cancelSpeech() {
    if (destroyed) return false;
    const wasSpeaking = speaking;
    activePlaybackId = null;
    speaking = false;
    viseme = 'neutral';
    emit();
    if (wasSpeaking && blink === 'open') {
      clearBlinkTimers();
      scheduleNextBlink();
    }
    return true;
  }

  function destroy() {
    if (destroyed) return;
    cancelSpeech();
    clearBlinkTimers();
    documentRef?.removeEventListener?.('visibilitychange', handleVisibilityChange);
    if (reducedMotionQuery?.removeEventListener) {
      reducedMotionQuery.removeEventListener('change', handleReducedMotionChange);
    } else {
      reducedMotionQuery?.removeListener?.(handleReducedMotionChange);
    }
    blink = 'open';
    emit();
    destroyed = true;
  }

  return {
    blink(options = {}) {
      if (destroyed || !isVisible()) return false;
      clearBlinkTimers();
      runBlink(options?.holdDurationMs);
      return true;
    },
    setSpeaking(active) {
      if (destroyed) return false;
      const wasSpeaking = speaking;
      speaking = Boolean(active);
      if (!speaking) viseme = 'neutral';
      emit();
      if (speaking !== wasSpeaking && blink === 'open') {
        clearBlinkTimers();
        scheduleNextBlink();
      }
      return true;
    },
    setEyeMode(nextMode = 'idle') {
      if (destroyed) return false;
      const previousMode = eyeMode;
      eyeMode = ['idle', 'thinking', 'listening'].includes(nextMode) ? nextMode : 'idle';
      emit();
      if (eyeMode !== previousMode && blink === 'open') {
        clearBlinkTimers();
        scheduleNextBlink();
      }
      return true;
    },
    startSpeech(playbackId) {
      if (destroyed || playbackId === null || playbackId === undefined) return false;
      activePlaybackId = playbackId;
      const wasSpeaking = speaking;
      speaking = true;
      viseme = 'neutral';
      emit();
      if (!wasSpeaking && blink === 'open') {
        clearBlinkTimers();
        scheduleNextBlink();
      }
      return true;
    },
    setViseme(playbackId, nextViseme) {
      if (
        destroyed
        || playbackId !== activePlaybackId
        || !speaking
        || !VISMESES.has(nextViseme)
      ) return false;
      viseme = nextViseme;
      emit();
      return true;
    },
    pauseSpeech(playbackId) {
      if (destroyed || playbackId !== activePlaybackId) return false;
      speaking = false;
      viseme = 'neutral';
      emit();
      if (blink === 'open') {
        clearBlinkTimers();
        scheduleNextBlink();
      }
      return true;
    },
    resumeSpeech(playbackId) {
      if (destroyed || playbackId !== activePlaybackId) return false;
      speaking = true;
      viseme = 'neutral';
      emit();
      if (blink === 'open') {
        clearBlinkTimers();
        scheduleNextBlink();
      }
      return true;
    },
    finishSpeech(playbackId) {
      if (destroyed || playbackId !== activePlaybackId) return false;
      activePlaybackId = null;
      speaking = false;
      viseme = 'neutral';
      emit();
      if (blink === 'open') {
        clearBlinkTimers();
        scheduleNextBlink();
      }
      return true;
    },
    cancelSpeech,
    destroy,
  };
}
