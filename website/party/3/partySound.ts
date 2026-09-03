// ABOUTME: Synthesizes the party's local sound cues with the Web Audio API.
// ABOUTME: Keeps autoplay-safe audio setup and cue envelopes out of the page components.

export type PartySound = "pop" | "bang" | "blow" | "bite" | "chime";

let audioContext: AudioContext | undefined;
let balloonInflateAudio: HTMLAudioElement | undefined;

function playBalloonInflate() {
  stopPartySound("blow");
  if (typeof Audio === "undefined") return;
  const audio = new Audio("/party/3/assets/balloon-inflate.mp3");
  audio.volume = 0.58;
  balloonInflateAudio = audio;
  audio.addEventListener(
    "ended",
    () => {
      if (balloonInflateAudio === audio) balloonInflateAudio = undefined;
    },
    { once: true },
  );
  void audio.play().catch(() => {
    if (balloonInflateAudio === audio) balloonInflateAudio = undefined;
  });
}

export function stopPartySound(sound: PartySound) {
  if (sound !== "blow" || !balloonInflateAudio) return;
  balloonInflateAudio.pause();
  if (balloonInflateAudio.readyState > 0) balloonInflateAudio.currentTime = 0;
  balloonInflateAudio = undefined;
}

function getAudioContext(): AudioContext | undefined {
  const AudioContextClass =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextClass) return undefined;
  audioContext ??= new AudioContextClass();
  return audioContext;
}

export function playPartySound(sound: PartySound, enabled: boolean) {
  if (!enabled) return;
  try {
    if (sound === "blow") {
      playBalloonInflate();
      return;
    }
    const context = getAudioContext();
    if (!context) return;
    if (context.state === "suspended") void context.resume();
    const start = context.currentTime;
    const gain = context.createGain();
    gain.connect(context.destination);

    if (sound === "pop" || sound === "bang") {
      const duration = sound === "bang" ? 0.32 : 0.13;
      const buffer = context.createBuffer(
        1,
        Math.floor(context.sampleRate * duration),
        context.sampleRate,
      );
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < channel.length; index += 1) {
        channel[index] =
          (Math.random() * 2 - 1) *
          Math.pow(1 - index / channel.length, sound === "bang" ? 1.6 : 2.6);
      }
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      source.buffer = buffer;
      filter.type = "bandpass";
      filter.frequency.value = sound === "bang" ? 900 : 1750;
      filter.Q.value = 0.7;
      source.connect(filter);
      filter.connect(gain);
      gain.gain.setValueAtTime(sound === "bang" ? 0.38 : 0.26, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      source.start(start);
      return;
    }

    if (sound === "bite") {
      const duration = 0.23;
      const buffer = context.createBuffer(
        1,
        Math.floor(context.sampleRate * duration),
        context.sampleRate,
      );
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < channel.length; index += 1) {
        const time = index / context.sampleRate;
        const crunch = [0.012, 0.055, 0.103, 0.158].reduce(
          (level, center, pulseIndex) =>
            level +
            Math.exp(
              -Math.pow((time - center) / (0.009 + pulseIndex * 0.002), 2),
            ) *
              (1 - pulseIndex * 0.14),
          0,
        );
        channel[index] = (Math.random() * 2 - 1) * crunch * 0.72;
      }
      const source = context.createBufferSource();
      const highpass = context.createBiquadFilter();
      const lowpass = context.createBiquadFilter();
      source.buffer = buffer;
      highpass.type = "highpass";
      highpass.frequency.value = 620;
      lowpass.type = "lowpass";
      lowpass.frequency.value = 5200;
      source.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(gain);
      gain.gain.setValueAtTime(0.34, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

      const jaw = context.createOscillator();
      const jawGain = context.createGain();
      jaw.type = "triangle";
      jaw.frequency.setValueAtTime(145 + Math.random() * 18, start);
      jaw.frequency.exponentialRampToValueAtTime(62, start + 0.105);
      jawGain.gain.setValueAtTime(0.13, start);
      jawGain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
      jaw.connect(jawGain);
      jawGain.connect(context.destination);
      source.start(start);
      jaw.start(start);
      jaw.stop(start + 0.13);
      return;
    }

    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    const frequency = 660;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(
      frequency * 1.5,
      start + 0.12,
    );
    oscillator.connect(gain);
    gain.gain.setValueAtTime(0.16, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
    oscillator.start(start);
    oscillator.stop(start + 0.34);
  } catch {
    // Sound is decorative. Unsupported or blocked audio leaves the party usable.
  }
}
