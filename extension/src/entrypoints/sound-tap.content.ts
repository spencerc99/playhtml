// ABOUTME: Observes page media playback and records requested bounded audio snippets.
// ABOUTME: Bridges play metadata and validated clip buffers from MAIN to the isolated world.

export const SOUND_PLAY_MESSAGE_TYPE = "wewe:sound-play";
export const SOUND_CAPTURE_REQUEST_MESSAGE_TYPE = "wewe:sound-capture-request";
export const SOUND_CLIP_MESSAGE_TYPE = "wewe:sound-clip";
export const SOUND_CAPTURE_MAX_DURATION_MS = 12_000;
export const SOUND_BRIDGE_MAX_BYTES = 5 * 1024 * 1024;

const SOUND_CAPTURE_REFERENCE_TTL_MS = 30_000;
const SOUND_RECORDER_MIME_TYPE = "audio/webm;codecs=opus";
const SOUND_RECORDER_BITS_PER_SECOND = 64_000;
const SOUND_SIGNAL_SAMPLE_INTERVAL_MS = 50;
const MAX_PLAY_MESSAGE_SRC_LENGTH = 16_384;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_CAPTURE_ID_LENGTH = 128;
const CAPTURE_REQUEST_KEYS = new Set([
  "type",
  "captureId",
  "requestId",
  "maxDurationMs",
]);

type SoundMediaKind = "audio" | "video";

interface SoundPlayMessage {
  type: typeof SOUND_PLAY_MESSAGE_TYPE;
  src: string;
  mediaKind: SoundMediaKind;
  detached: boolean;
  duration?: number;
  timestamp: number;
  captureId: string;
}

interface SoundCaptureRequest {
  type: typeof SOUND_CAPTURE_REQUEST_MESSAGE_TYPE;
  captureId: string;
  requestId: string;
  maxDurationMs: number;
}

interface SoundRecording {
  buffer: ArrayBuffer;
  mimeType: string;
  durationMs: number;
}

interface SoundSignalProbe {
  hasSignal(): boolean;
  close(): Promise<void>;
}

interface SoundRecorder {
  readonly mimeType: string;
  readonly state: string;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  start(timeslice?: number): void;
  stop(): void;
}

function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

export interface SoundCaptureDependencies {
  captureStream(element: HTMLMediaElement): MediaStream;
  createAudioStream(tracks: MediaStreamTrack[]): MediaStream;
  createRecorder(stream: MediaStream): SoundRecorder;
  createSignalProbe(stream: MediaStream): Promise<SoundSignalProbe>;
  now(): number;
  setTimeout(callback: () => void, durationMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(timeoutId: ReturnType<typeof setTimeout>): void;
}

function createCaptureId(): string {
  try {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Page patches must not prevent metadata collection.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function parseCaptureRequest(data: unknown): SoundCaptureRequest | undefined {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !CAPTURE_REQUEST_KEYS.has(key)) ||
    record.type !== SOUND_CAPTURE_REQUEST_MESSAGE_TYPE ||
    typeof record.captureId !== "string" ||
    record.captureId.length === 0 ||
    record.captureId.length > MAX_CAPTURE_ID_LENGTH ||
    typeof record.requestId !== "string" ||
    record.requestId.length === 0 ||
    record.requestId.length > MAX_REQUEST_ID_LENGTH ||
    typeof record.maxDurationMs !== "number" ||
    !Number.isSafeInteger(record.maxDurationMs) ||
    record.maxDurationMs <= 0 ||
    record.maxDurationMs > SOUND_CAPTURE_MAX_DURATION_MS
  ) {
    return undefined;
  }

  return {
    type: SOUND_CAPTURE_REQUEST_MESSAGE_TYPE,
    captureId: record.captureId,
    requestId: record.requestId,
    maxDurationMs: record.maxDurationMs,
  };
}

async function createBrowserSignalProbe(
  stream: MediaStream,
): Promise<SoundSignalProbe> {
  const AudioContextConstructor =
    window.AudioContext ??
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error("AudioContext unavailable");
  }

  const context = new AudioContextConstructor();
  try {
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    const silentOutput = context.createGain();
    silentOutput.gain.value = 0;
    analyser.fftSize = 2048;
    source.connect(analyser);
    analyser.connect(silentOutput);
    silentOutput.connect(context.destination);

    const samples = new Float32Array(analyser.fftSize);
    let signalObserved = false;
    const sample = () => {
      analyser.getFloatTimeDomainData(samples);
      if (samples.some((value) => value !== 0)) {
        signalObserved = true;
      }
    };
    const intervalId = window.setInterval(
      sample,
      SOUND_SIGNAL_SAMPLE_INTERVAL_MS,
    );
    await context.resume().catch(() => undefined);

    return {
      hasSignal: () => {
        sample();
        return signalObserved;
      },
      close: async () => {
        clearInterval(intervalId);
        source.disconnect();
        analyser.disconnect();
        silentOutput.disconnect();
        await context.close().catch(() => undefined);
      },
    };
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
}

const browserCaptureDependencies: SoundCaptureDependencies = {
  captureStream(element) {
    const capturableElement = element as HTMLMediaElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    };
    const captureStream =
      capturableElement.captureStream ?? capturableElement.mozCaptureStream;
    if (!captureStream) {
      throw new Error("captureStream unavailable");
    }
    return captureStream.call(element);
  },
  createAudioStream: (tracks) => new MediaStream(tracks),
  createRecorder(stream) {
    if (
      typeof MediaRecorder === "undefined" ||
      !MediaRecorder.isTypeSupported(SOUND_RECORDER_MIME_TYPE)
    ) {
      throw new Error("MediaRecorder unavailable");
    }
    return new MediaRecorder(stream, {
      mimeType: SOUND_RECORDER_MIME_TYPE,
      audioBitsPerSecond: SOUND_RECORDER_BITS_PER_SECOND,
    });
  },
  createSignalProbe: createBrowserSignalProbe,
  now: () => Date.now(),
  setTimeout: (callback, durationMs) => setTimeout(callback, durationMs),
  clearTimeout: (timeoutId) => clearTimeout(timeoutId),
};

export async function recordSoundElement(
  element: HTMLMediaElement,
  maxDurationMs: number,
  dependencies: SoundCaptureDependencies = browserCaptureDependencies,
): Promise<SoundRecording | undefined> {
  let recorder: SoundRecorder;
  let probe: SoundSignalProbe;
  try {
    const capturedStream = dependencies.captureStream(element);
    const audioTracks = capturedStream.getAudioTracks();
    if (audioTracks.length === 0) return undefined;
    const audioStream = dependencies.createAudioStream(audioTracks);
    recorder = dependencies.createRecorder(audioStream);
    probe = await dependencies.createSignalProbe(audioStream);
  } catch {
    return undefined;
  }

  const chunks: Blob[] = [];
  const startedAt = dependencies.now();

  return new Promise((resolve) => {
    let settled = false;
    let stopTimeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      element.removeEventListener("pause", stopRecording);
      element.removeEventListener("ended", stopRecording);
      recorder.removeEventListener("dataavailable", onDataAvailable);
      recorder.removeEventListener("stop", onStop);
      recorder.removeEventListener("error", onError);
      if (stopTimeoutId !== undefined) {
        dependencies.clearTimeout(stopTimeoutId);
      }
    };

    const finish = async (recording: SoundRecording | undefined) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        await probe.close();
      } catch {
        // Page patches must not prevent the recorder promise from settling.
      }
      resolve(recording);
    };

    function stopRecording() {
      try {
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      } catch {
        void finish(undefined);
      }
    }

    const onDataAvailable: EventListener = (event) => {
      const data = (event as Event & { data?: Blob }).data;
      if (data && data.size > 0) {
        chunks.push(data);
      }
    };

    const onStop: EventListener = () => {
      void (async () => {
        try {
          if (!probe.hasSignal()) {
            await finish(undefined);
            return;
          }

          const blob = new Blob(chunks, {
            type: recorder.mimeType || SOUND_RECORDER_MIME_TYPE,
          });
          if (blob.size === 0 || blob.size > SOUND_BRIDGE_MAX_BYTES) {
            await finish(undefined);
            return;
          }

          const buffer = await readBlobAsArrayBuffer(blob);
          await finish({
            buffer,
            mimeType: blob.type,
            durationMs: Math.min(
              maxDurationMs,
              Math.max(0, dependencies.now() - startedAt),
            ),
          });
        } catch {
          await finish(undefined);
        }
      })();
    };

    const onError: EventListener = () => {
      void finish(undefined);
    };

    element.addEventListener("pause", stopRecording, { once: true });
    element.addEventListener("ended", stopRecording, { once: true });
    recorder.addEventListener("dataavailable", onDataAvailable);
    recorder.addEventListener("stop", onStop);
    recorder.addEventListener("error", onError);

    try {
      recorder.start(1000);
      stopTimeoutId = dependencies.setTimeout(stopRecording, maxDurationMs);
    } catch {
      void finish(undefined);
    }
  });
}

export function installSoundTap(): () => void {
  const mediaPrototype = HTMLMediaElement.prototype;
  const originalPlay = mediaPrototype.play;
  const captureElements = new Map<string, HTMLMediaElement>();
  const captureExpiryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  const rememberElement = (element: HTMLMediaElement): string => {
    const captureId = createCaptureId();
    captureElements.set(captureId, element);
    const timeoutId = setTimeout(() => {
      captureElements.delete(captureId);
      captureExpiryTimers.delete(captureId);
    }, SOUND_CAPTURE_REFERENCE_TTL_MS);
    captureExpiryTimers.set(captureId, timeoutId);
    return captureId;
  };

  const postSoundPlay = (element: HTMLMediaElement): void => {
    try {
      const duration = element.duration;
      const rawSrc = element.currentSrc || element.src;
      const message: SoundPlayMessage = {
        type: SOUND_PLAY_MESSAGE_TYPE,
        src: rawSrc.startsWith("data:")
          ? rawSrc.slice(0, MAX_PLAY_MESSAGE_SRC_LENGTH)
          : rawSrc,
        mediaKind:
          element.tagName.toLowerCase() === "video" ? "video" : "audio",
        detached: !element.isConnected,
        timestamp: Date.now(),
        captureId: rememberElement(element),
      };

      if (Number.isFinite(duration)) {
        message.duration = duration;
      }

      window.postMessage(message, "*");
    } catch {
      // Page-defined media accessors and postMessage patches must not affect playback.
    }
  };

  function play(
    this: HTMLMediaElement,
    ...args: Parameters<HTMLMediaElement["play"]>
  ) {
    postSoundPlay(this);
    return Reflect.apply(originalPlay, this, args);
  }

  const playEventHandler = (event: Event) => {
    try {
      if (event.target instanceof HTMLMediaElement) {
        postSoundPlay(event.target);
      }
    } catch {
      // Page-defined event properties must not affect other document listeners.
    }
  };

  const captureRequestHandler = (event: MessageEvent<unknown>) => {
    try {
      if (event.source !== window) return;
      const request = parseCaptureRequest(event.data);
      if (!request) return;
      const element = captureElements.get(request.captureId);
      if (!element) return;

      captureElements.delete(request.captureId);
      const expiryTimer = captureExpiryTimers.get(request.captureId);
      if (expiryTimer !== undefined) {
        clearTimeout(expiryTimer);
        captureExpiryTimers.delete(request.captureId);
      }

      void recordSoundElement(element, request.maxDurationMs).then(
        (recording) => {
          if (!recording) return;
          window.postMessage(
            {
              type: SOUND_CLIP_MESSAGE_TYPE,
              requestId: request.requestId,
              buffer: recording.buffer,
              mimeType: recording.mimeType,
              durationMs: recording.durationMs,
            },
            "*",
          );
        },
      );
    } catch {
      // Capture failures and page-forged requests must never affect playback.
    }
  };

  try {
    mediaPrototype.play = play;
    document.addEventListener("play", playEventHandler, true);
    window.addEventListener("message", captureRequestHandler);
  } catch {
    // A page may lock either object before this document-start script runs.
  }

  return () => {
    try {
      document.removeEventListener("play", playEventHandler, true);
      window.removeEventListener("message", captureRequestHandler);
      for (const timeoutId of captureExpiryTimers.values()) {
        clearTimeout(timeoutId);
      }
      captureExpiryTimers.clear();
      captureElements.clear();
      if (mediaPrototype.play === play) {
        mediaPrototype.play = originalPlay;
      }
    } catch {
      // Cleanup must not overwrite a page's later patch or throw into page code.
    }
  };
}

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_start",
  allFrames: false,
  world: "MAIN",
  main() {
    installSoundTap();
  },
});
