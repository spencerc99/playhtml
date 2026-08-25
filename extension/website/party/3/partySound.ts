// ABOUTME: Synthesizes the party's local sound cues with the Web Audio API.
// ABOUTME: Keeps autoplay-safe audio setup and cue envelopes out of the page components.

export type PartySound = "pop" | "bang" | "blow" | "bite" | "chime";

let audioContext: AudioContext | undefined;

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

    if (sound === "blow") {
      const duration = 0.26;
      const buffer = context.createBuffer(
        1,
        Math.floor(context.sampleRate * duration),
        context.sampleRate,
      );
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < channel.length; index += 1) {
        const progress = index / channel.length;
        channel[index] =
          (Math.random() * 2 - 1) * Math.sin(progress * Math.PI) * 0.9;
      }
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      source.buffer = buffer;
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(500, start);
      filter.frequency.linearRampToValueAtTime(1300, start + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.gain.setValueAtTime(0.14, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      source.start(start);
      return;
    }

    const oscillator = context.createOscillator();
    oscillator.type = sound === "bite" ? "triangle" : "sine";
    const frequency = sound === "bite" ? 210 + Math.random() * 60 : 660;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(
      frequency * (sound === "bite" ? 0.55 : 1.5),
      start + 0.12,
    );
    oscillator.connect(gain);
    gain.gain.setValueAtTime(sound === "bite" ? 0.2 : 0.16, start);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      start + (sound === "bite" ? 0.14 : 0.3),
    );
    oscillator.start(start);
    oscillator.stop(start + 0.34);
  } catch {
    // Sound is decorative. Unsupported or blocked audio leaves the party usable.
  }
}
