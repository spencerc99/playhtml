// ABOUTME: Measures engine-owned audio nodes and scheduled automation for development.
// ABOUTME: Collects render-capacity events without touching audio values or timing.

type CapacityEvent = Event & {
  timestamp: number;
  averageLoad: number;
  peakLoad: number;
  underrunRatio: number;
};

type RenderCapacity = {
  onupdate: ((event: CapacityEvent) => void) | null;
  start(options: { updateInterval: number }): void;
  stop(): void;
};

type PlaybackStats = {
  readonly underrunDuration: number;
  readonly underrunEvents: number;
  readonly totalDuration: number;
};

export class SoundPerformance {
  private liveNodes = 0;
  private automationEvents = 0;
  private automationEventsTotal = 0;
  private cancellations = 0;
  private sampledAt = performance.now();
  private capacitySample: {
    timestamp: number;
    averageLoad: number;
    peakLoad: number;
    underrunRatio: number;
  } | null = null;
  private readonly capacity: RenderCapacity | undefined;
  private readonly restore: Array<() => void> = [];

  constructor(private readonly ctx: AudioContext) {
    this.capacity = (ctx as AudioContext & { renderCapacity?: RenderCapacity }).renderCapacity;
    if (this.capacity) {
      this.capacity.onupdate = (event) => {
        this.capacitySample = {
          timestamp: event.timestamp,
          averageLoad: event.averageLoad,
          peakLoad: event.peakLoad,
          underrunRatio: event.underrunRatio,
        };
      };
      this.capacity.start({ updateInterval: 1 });
    }
    const factories = [
      "createGain", "createOscillator", "createBiquadFilter",
      "createStereoPanner", "createConvolver", "createDynamicsCompressor",
      "createBufferSource",
    ] as const;
    for (const name of factories) {
      const original: () => AudioNode = ctx[name];
      Object.defineProperty(ctx, name, {
        configurable: true,
        value: () => this.track(original.call(ctx)),
      });
      this.restore.push(() => { delete (ctx as unknown as Record<string, unknown>)[name]; });
    }
  }

  private track<T extends AudioNode>(node: T): T {
    let live = true;
    this.liveNodes++;
    const release = () => {
      if (!live) return;
      live = false;
      this.liveNodes--;
    };
    node.disconnect = new Proxy(node.disconnect, {
      apply: (method, receiver, args) => {
        const result: unknown = Reflect.apply(method, receiver, args);
        if (args.length === 0) release();
        return result;
      },
    });
    node.connect = new Proxy(node.connect, {
      apply: (method, receiver, args) => {
        const result: unknown = Reflect.apply(method, receiver, args);
        if (!live) {
          live = true;
          this.liveNodes++;
        }
        return result;
      },
    });
    if ("start" in node) node.addEventListener("ended", release, { once: true });
    for (const name of ["gain", "frequency", "detune", "Q", "pan", "threshold", "knee", "ratio", "attack", "release", "playbackRate"]) {
      const param = (node as unknown as Record<string, AudioParam | undefined>)[name];
      if (!param || typeof param.setValueAtTime !== "function") continue;
      for (const method of ["setValueAtTime", "linearRampToValueAtTime", "exponentialRampToValueAtTime", "setTargetAtTime", "setValueCurveAtTime", "cancelAndHoldAtTime", "cancelScheduledValues"] as const) {
        if (typeof param[method] !== "function") continue;
        Object.defineProperty(param, method, { configurable: true, value: new Proxy(param[method], {
          apply: (original, receiver, args) => {
            const result: unknown = Reflect.apply(original, receiver, args);
            if (method === "cancelAndHoldAtTime" || method === "cancelScheduledValues") {
              this.cancellations++;
            } else {
              this.automationEvents++;
              this.automationEventsTotal++;
            }
            return result;
          },
        }) });
      }
    }
    return node;
  }

  snapshot() {
    const now = performance.now();
    const sampleSeconds = (now - this.sampledAt) / 1000;
    const playback = (this.ctx as AudioContext & {
      playbackStats?: PlaybackStats;
    }).playbackStats;
    const sample = {
      renderCapacitySupported: this.capacity !== undefined,
      capacity: this.capacitySample,
      playback: playback ? {
        underrunDuration: playback.underrunDuration,
        underrunEvents: playback.underrunEvents,
        totalDuration: playback.totalDuration,
      } : null,
      contextState: this.ctx.state,
      audioTime: this.ctx.currentTime,
      sampleRate: this.ctx.sampleRate,
      sampleSeconds,
      automationEventsPerSecond: this.automationEvents / sampleSeconds,
      automationEventsTotal: this.automationEventsTotal,
      cancellationsPerSecond: this.cancellations / sampleSeconds,
      liveNodeCount: this.liveNodes,
    };
    this.sampledAt = now;
    this.automationEvents = 0;
    this.cancellations = 0;
    return sample;
  }

  stop(): void {
    if (this.capacity) {
      this.capacity.stop();
      this.capacity.onupdate = null;
    }
    for (const restore of this.restore) restore();
  }
}
