const BLINK_MIN_INTERVAL_MS = 2_800;
const BLINK_INTERVAL_RANGE_MS = 4_200;
const VISMESES = new Set(['neutral', 'aa', 'ee', 'ih', 'oh', 'ou']);
export const PORTRAIT_ANIMATION_EVENT = 'jarvis:portrait-animation';

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
  let activePlaybackId = null;
  let destroyed = false;
  const blinkTimers = new Set();

  function emit() {
    if (!destroyed) onChange({ blink, viseme, speaking });
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
