const STATES = ['idle', 'listening', 'thinking', 'speaking'];

export function createMobileHome({
  root = document,
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)'),
} = {}) {
  let mode = 'idle';
  let audioContext = null;
  let analyser = null;
  let mediaStream = null;
  let animationFrame = 0;
  let recognition = null;
  let sessionSeconds = 0;
  let typingTimer = null;

  const stage = root.querySelector('#holo-stage');
  const micButtons = [...root.querySelectorAll('.mobile-home-mic:not(#dashboard-mic-button)')];
  const statusMessage = root.querySelector('#mobile-status-message');
  const bubble = root.querySelector('#mobile-assistant-bubble');
  const sessionTimer = root.querySelector('#mobile-session-time');
  const waveform = root.querySelector('#holo-waveform');
  const messageInput = root.querySelector('#dashboard-message');
  const commandForm = root.querySelector('#dashboard-command-form');
  let stateColor = [46, 168, 255];
  let targetColor = [46, 168, 255];
  let stateColorFrame = 0;

  const STATE_COLORS = {
    idle: [46, 168, 255],
    listening: [0, 229, 255],
    thinking: [139, 92, 246],
    speaking: [34, 229, 139],
  };

  function animateStateColor() {
    stateColor = stateColor.map((channel, index) =>
      channel + (targetColor[index] - channel) * 0.16,
    );
    stage?.style.setProperty('--assistant-state-rgb', stateColor.map((channel) => Math.round(channel)).join(', '));
    if (stateColor.some((channel, index) => Math.abs(channel - targetColor[index]) > 0.8)) {
      stateColorFrame = window.requestAnimationFrame(animateStateColor);
    } else {
      stateColor = [...targetColor];
      stage?.style.setProperty('--assistant-state-rgb', targetColor.join(', '));
      stateColorFrame = 0;
    }
  }

  function setMode(nextMode = 'idle', status = '') {
    mode = STATES.includes(nextMode) ? nextMode : 'idle';
    stage?.classList.toggle('is-listening', mode === 'listening');
    stage?.classList.toggle('is-thinking', mode === 'thinking');
    stage?.classList.toggle('is-speaking', mode === 'speaking');
    root.body?.classList.remove('is-listening', 'is-thinking', 'is-speaking');
    if (mode !== 'idle') root.body?.classList.add(`is-${mode}`);
    if (statusMessage && status) statusMessage.textContent = status;
    root.querySelectorAll('[data-mobile-state]').forEach((item) => {
      const active = item.dataset.mobileState === mode || (mode === 'idle' && item.dataset.mobileState === 'online');
      item.classList.toggle('is-current', active);
      item.classList.toggle('is-dimmed', !active);
      if (active) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    });
    if (mode === 'idle') window.jarvisAvatarAnimation?.setEyeMode('idle');
    if (mode === 'thinking') window.jarvisAvatarAnimation?.setEyeMode('thinking');
    if (mode === 'listening') window.jarvisAvatarAnimation?.setEyeMode('listening');
    window.jarvisAvatarAnimation?.setSpeaking(mode === 'speaking');
    targetColor = STATE_COLORS[mode];
    if (stateColorFrame) window.cancelAnimationFrame(stateColorFrame);
    if (reducedMotion.matches) {
      stateColor = [...targetColor];
      stage?.style.setProperty('--assistant-state-rgb', targetColor.join(', '));
      stateColorFrame = 0;
    } else {
      animateStateColor();
    }
  }

  function typeBubble(text) {
    if (!bubble) return;
    window.clearTimeout(typingTimer);
    bubble.textContent = '';
    if (reducedMotion.matches) {
      bubble.textContent = String(text).replace(/\s+/g, ' ').trim().slice(0, 120);
      return;
    }
    const value = String(text).replace(/\s+/g, ' ').trim().slice(0, 120);
    let index = 0;
    const type = () => {
      index += 1;
      bubble.textContent = value.slice(0, index);
      if (index < value.length) typingTimer = window.setTimeout(type, 18);
    };
    type();
  }

  function stopAudioMeter() {
    window.cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;
    analyser = null;
  }

  function animateWaveform() {
    if (!waveform || document.hidden) {
      animationFrame = window.requestAnimationFrame(animateWaveform);
      return;
    }
    const bars = [...waveform.querySelectorAll('i')];
    let level = 0;
    if (analyser) {
      const samples = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(samples);
      level = samples.reduce((total, sample) => total + Math.abs(sample - 128), 0) / samples.length / 128;
    } else if (mode === 'speaking') level = 0.18 + Math.random() * 0.35;
    bars.forEach((bar, index) => {
      const wave = mode === 'idle' ? 0.05 : Math.min(1, level + Math.abs(Math.sin(Date.now() / 180 + index * 0.55)) * level * 0.35);
      bar.style.transform = `scaleY(${Math.max(0.08, wave).toFixed(2)})`;
    });
    animationFrame = window.requestAnimationFrame(animateWaveform);
  }

  async function startMicMeter() {
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext ||= new AudioContext();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      audioContext.createMediaStreamSource(mediaStream).connect(analyser);
    } catch {
      setMode('idle', 'Microphone permission denied. Tap to try again.');
    }
  }

  function submitTranscript(transcript) {
    if (!transcript || !messageInput || !commandForm) return;
    messageInput.value = transcript;
    commandForm.requestSubmit();
  }

  function startListening() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      return;
    }
    stopAudioMeter();
    startMicMeter();
    recognition?.abort?.();
    recognition = new Recognition();
    recognition.lang = /[\u0900-\u097F]/u.test(navigator.language) ? 'hi-IN' : 'en-IN';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      let transcript = '';
      let final = false;
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript;
        final ||= event.results[index].isFinal;
      }
      if (messageInput) messageInput.value = transcript.trim();
      if (final) submitTranscript(transcript.trim());
    };
    recognition.onerror = (event) => {
      const denied = ['not-allowed', 'service-not-allowed'].includes(event.error);
      stopAudioMeter();
    };
    recognition.onend = () => {
      if (mode === 'listening') stopAudioMeter();
    };
    try {
      recognition.start();
    } catch {
      stopAudioMeter();
    }
  }

  function bindMicButtons() {
    micButtons.forEach((button) => button.addEventListener('click', () => {
      if (mode === 'listening') {
        recognition?.stop?.();
        stopAudioMeter();
      } else startListening();
    }));
  }

  bindMicButtons();
  window.addEventListener('jarvis:assistant-state', ({ detail }) => {
    const next = STATES.includes(detail?.mode) ? detail.mode : 'idle';
    setMode(next, next === 'idle' ? 'Ready' : ({ listening: 'Waiting for your voice…', thinking: 'Analyzing…', speaking: 'Generating response…' })[next]);
    if (next !== 'listening') stopAudioMeter();
  });
  window.addEventListener('jarvis:assistant-reply', ({ detail }) => typeBubble(detail?.text || ''));
  window.addEventListener('visibilitychange', () => {
    if (document.hidden && animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    } else if (!animationFrame) animateWaveform();
  });

  window.setInterval(() => {
    sessionSeconds += 1;
    if (sessionTimer) sessionTimer.textContent = `${String(Math.floor(sessionSeconds / 60)).padStart(2, '0')}:${String(sessionSeconds % 60).padStart(2, '0')}`;
  }, 1_000);
  setMode('idle', 'Ready');
  animateWaveform();

  return { setMode, typeBubble };
}
