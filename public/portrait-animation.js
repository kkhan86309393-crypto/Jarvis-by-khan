const BLINK_MIN_INTERVAL_MS = 2_500;
const BLINK_INTERVAL_RANGE_MS = 3_500;
const SPEAKING_BLINK_FACTOR = 0.8;
const DOUBLE_BLINK_CHANCE = 1 / 6;
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
} = {}) {
  let blink = 'open';
  let viseme = 'neutral';
  let speaking = false;
  let eyeMode = 'idle';
  let activePlaybackId = null;
  let destroyed = false;
  const blinkTimers = new Set();

  function emit() {
    if (!destroyed) onChange({ blink, viseme, speaking, eyeMode });
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

  function runBlink() {
    blink = 'closed';
    emit();
    scheduleBlink(() => {
      blink = 'open';
      emit();
      if (random() < DOUBLE_BLINK_CHANCE) {
        scheduleNextBlink(180 + random() * 70);
      } else {
        scheduleNextBlink();
      }
    }, 90);
  }

  function scheduleNextBlink(delay) {
    if (destroyed) return;
    const speakingRange = BLINK_INTERVAL_RANGE_MS * SPEAKING_BLINK_FACTOR;
    const interval = delay ?? BLINK_MIN_INTERVAL_MS + random()
      * (speaking ? speakingRange : BLINK_INTERVAL_RANGE_MS);
    scheduleBlink(runBlink, interval);
  }

  emit();
  scheduleNextBlink();

  function cancelSpeech() {
    if (destroyed) return false;
    activePlaybackId = null;
    speaking = false;
    viseme = 'neutral';
    emit();
    return true;
  }

  function destroy() {
    if (destroyed) return;
    cancelSpeech();
    clearBlinkTimers();
    blink = 'open';
    emit();
    destroyed = true;
  }

  return {
    blink() {
      if (destroyed) return false;
      clearBlinkTimers();
      runBlink();
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
      eyeMode = ['idle', 'thinking', 'listening'].includes(nextMode) ? nextMode : 'idle';
      emit();
      return true;
    },
    startSpeech(playbackId) {
      if (destroyed || playbackId === null || playbackId === undefined) return false;
      activePlaybackId = playbackId;
      speaking = true;
      viseme = 'neutral';
      emit();
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
      return true;
    },
    resumeSpeech(playbackId) {
      if (destroyed || playbackId !== activePlaybackId) return false;
      speaking = true;
      viseme = 'neutral';
      emit();
      return true;
    },
    finishSpeech(playbackId) {
      if (destroyed || playbackId !== activePlaybackId) return false;
      activePlaybackId = null;
      speaking = false;
      viseme = 'neutral';
      emit();
      return true;
    },
    cancelSpeech,
    destroy,
  };
}
