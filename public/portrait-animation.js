const BLINK_MIN_INTERVAL_MS = 2_800;
const BLINK_INTERVAL_RANGE_MS = 4_200;
const VISMESES = new Set(['neutral', 'aa', 'ee', 'ih', 'oh', 'ou']);
export const PORTRAIT_ANIMATION_EVENT = 'jarvis:portrait-animation';

export const PORTRAIT_OVERLAY_CONFIG = Object.freeze({
  reference: {
    eyes: { y: 0.264, leftX: 0.435, rightX: 0.565 },
    mouth: { x: 0.5, y: 0.438 },
    chin: { y: 0.58 },
  },
  cutout: {
    eyes: { y: 0.285, leftX: 0.436, rightX: 0.585, width: 0.095, height: 0.030 },
    mouth: { x: 0.517, y: 0.419, width: 0.11 },
    chin: { y: 0.50 },
  },
});

export function createPortraitAnimation({
  onChange = () => {},
  reducedMotionQuery = globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)')
    || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)'),
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
    if (!destroyed)     onChange({ blink, viseme, speaking, eyeMode });
  }

  function scheduleBlink(callback, delay) {
    const timer = schedule(() => {
      blinkTimers.delete(timer);
      if (!destroyed && !reducedMotionQuery?.matches) callback();
    }, delay);
    blinkTimers.add(timer);
  }

  function clearBlinkTimers() {
    for (const timer of blinkTimers) cancel(timer);
    blinkTimers.clear();
  }

  function scheduleNextBlink() {
    if (destroyed || reducedMotionQuery?.matches) return;
    scheduleBlink(() => {
      blink = 'half';
      emit();
      scheduleBlink(() => {
        blink = 'closed';
        emit();
        scheduleBlink(() => {
          blink = 'half';
          emit();
          scheduleBlink(() => {
            blink = 'open';
            emit();
            scheduleNextBlink();
          }, 55);
        }, 65);
      }, 45);
    }, BLINK_MIN_INTERVAL_MS + random() * BLINK_INTERVAL_RANGE_MS);
  }

  function handleReducedMotionChange() {
    clearBlinkTimers();
    if (reducedMotionQuery?.matches) {
      blink = 'open';
      viseme = 'neutral';
      emit();
    } else {
      scheduleNextBlink();
    }
  }

  reducedMotionQuery?.addEventListener?.('change', handleReducedMotionChange);
  if (!reducedMotionQuery?.addEventListener) {
    reducedMotionQuery?.addListener?.(handleReducedMotionChange);
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
    reducedMotionQuery?.removeEventListener?.('change', handleReducedMotionChange);
    if (!reducedMotionQuery?.removeEventListener) {
      reducedMotionQuery?.removeListener?.(handleReducedMotionChange);
    }
  }

  return {
    setSpeaking(active) {
      if (destroyed) return false;
      speaking = Boolean(active);
      if (!speaking) viseme = 'neutral';
      emit();
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
        || reducedMotionQuery?.matches
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
