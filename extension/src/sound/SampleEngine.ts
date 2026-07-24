// ABOUTME: Plays locally stored audio clips through a shared Web Audio output bus.
// ABOUTME: Caches decoded buffers and normalizes gain as simultaneous voices overlap.

export interface PlayClipOptions {
  when?: number;
  offset?: number;
  gain?: number;
  pan?: number;
}

export type SoundClipLoader = (clipId: string) => Promise<ArrayBuffer>;

interface ActiveVoice {
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  panNode: StereoPannerNode;
  baseGain: number;
}

const MAX_CACHE_SIZE = 50;
const MAX_CLIP_DURATION_SECONDS = 12;

export class SampleEngine {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private decodedBuffers = new Map<string, AudioBuffer>();
  private pendingBuffers = new Map<string, Promise<AudioBuffer>>();
  private activeVoices = new Set<ActiveVoice>();
  private stopGeneration = 0;

  constructor(private readonly loadClip: SoundClipLoader) {}

  async init(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = 0.72;
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -24;
      this.compressor.knee.value = 24;
      this.compressor.ratio.value = 12;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.2;
      this.masterGain.connect(this.compressor);
      this.compressor.connect(this.context.destination);
    }
    await this.resume();
  }

  async resume(): Promise<void> {
    if (this.context?.state === "suspended") {
      await this.context.resume();
    }
  }

  async playClip(
    clipId: string,
    options: PlayClipOptions = {},
  ): Promise<void> {
    if (!this.context || !this.masterGain) {
      throw new Error("SampleEngine must be initialized from a user gesture.");
    }

    const playGeneration = this.stopGeneration;
    const buffer = await this.getDecodedBuffer(clipId);
    if (playGeneration !== this.stopGeneration) return;
    if (!this.context || !this.masterGain) return;

    const offset = Math.max(
      0,
      Math.min(options.offset ?? 0, Math.max(0, buffer.duration - 0.001)),
    );
    const duration = Math.min(
      MAX_CLIP_DURATION_SECONDS,
      Math.max(0, buffer.duration - offset),
    );
    if (duration === 0) return;

    const source = this.context.createBufferSource();
    const gainNode = this.context.createGain();
    const panNode = this.context.createStereoPanner();
    const voice: ActiveVoice = {
      source,
      gainNode,
      panNode,
      baseGain: Math.max(0, options.gain ?? 1),
    };

    source.buffer = buffer;
    gainNode.gain.value = 0;
    panNode.pan.value = Math.max(-1, Math.min(1, options.pan ?? 0));
    source.connect(gainNode);
    gainNode.connect(panNode);
    panNode.connect(this.masterGain);

    this.activeVoices.add(voice);
    this.updateVoiceGains();
    source.onended = () => {
      this.activeVoices.delete(voice);
      source.disconnect();
      gainNode.disconnect();
      panNode.disconnect();
      this.updateVoiceGains();
    };

    const startTime = Math.max(
      this.context.currentTime,
      options.when ?? this.context.currentTime,
    );
    source.start(startTime, offset, duration);
  }

  stopAll(): void {
    this.stopGeneration++;
    for (const voice of this.activeVoices) {
      voice.source.onended = null;
      try {
        voice.source.stop();
      } catch {
        // A source may have ended between iteration and stop().
      }
      voice.source.disconnect();
      voice.gainNode.disconnect();
      voice.panNode.disconnect();
    }
    this.activeVoices.clear();
  }

  dispose(): void {
    this.stopAll();
    this.masterGain?.disconnect();
    this.compressor?.disconnect();
    void this.context?.close();
    this.context = null;
    this.masterGain = null;
    this.compressor = null;
    this.decodedBuffers.clear();
    this.pendingBuffers.clear();
  }

  private async getDecodedBuffer(clipId: string): Promise<AudioBuffer> {
    const cached = this.decodedBuffers.get(clipId);
    if (cached) {
      this.decodedBuffers.delete(clipId);
      this.decodedBuffers.set(clipId, cached);
      return cached;
    }

    const pending = this.pendingBuffers.get(clipId);
    if (pending) return pending;
    if (!this.context) {
      throw new Error("SampleEngine has no AudioContext.");
    }

    const context = this.context;
    const decode = this.loadClip(clipId)
      .then((arrayBuffer) => context.decodeAudioData(arrayBuffer.slice(0)))
      .then((buffer) => {
        this.decodedBuffers.set(clipId, buffer);
        while (this.decodedBuffers.size > MAX_CACHE_SIZE) {
          const oldestClipId = this.decodedBuffers.keys().next().value;
          if (oldestClipId === undefined) break;
          this.decodedBuffers.delete(oldestClipId);
        }
        return buffer;
      })
      .finally(() => {
        this.pendingBuffers.delete(clipId);
      });
    this.pendingBuffers.set(clipId, decode);
    return decode;
  }

  private updateVoiceGains(): void {
    if (!this.context) return;
    const normalization = 1 / Math.sqrt(Math.max(1, this.activeVoices.size));
    const now = this.context.currentTime;
    for (const voice of this.activeVoices) {
      voice.gainNode.gain.cancelScheduledValues(now);
      voice.gainNode.gain.linearRampToValueAtTime(
        voice.baseGain * normalization,
        now + 0.04,
      );
    }
  }
}
