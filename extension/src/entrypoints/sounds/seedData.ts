// ABOUTME: Generates a local demo day of sound events and synthesized WAV clips.
// ABOUTME: Stores seed clips and events through the extension background message pipeline.

import browser from "webextension-polyfill";
import type { CollectionEvent, SoundEventData } from "../../collectors/types";
import { generateULID } from "../../collectors/types";

const SAMPLE_RATE = 22_050;
const DEMO_CLIP_COUNT = 8;
const DEMO_EVENT_COUNT = 30;

interface StoredClipResponse {
  success?: boolean;
  clipId?: string;
  mimeType?: string;
  clipDurationMs?: number;
  sizeBytes?: number;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index++) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function encodeMonoWav(
  samples: Float32Array,
  sampleRate: number,
): ArrayBuffer {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);

  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(
      44 + index * bytesPerSample,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true,
    );
  }

  return buffer;
}

async function renderDemoClip(
  frequency: number,
  durationSeconds: number,
  chirpRatio: number,
): Promise<ArrayBuffer> {
  const frameCount = Math.ceil(SAMPLE_RATE * durationSeconds);
  const context = new OfflineAudioContext(1, frameCount, SAMPLE_RATE);
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, 0);
  oscillator.frequency.exponentialRampToValueAtTime(
    frequency * chirpRatio,
    durationSeconds,
  );
  gain.gain.setValueAtTime(0.0001, 0);
  gain.gain.linearRampToValueAtTime(0.32, Math.min(0.03, durationSeconds / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, durationSeconds);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(0);
  oscillator.stop(durationSeconds);

  const rendered = await context.startRendering();
  return encodeMonoWav(rendered.getChannelData(0), rendered.sampleRate);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function createDemoEvents(
  clips: Array<Required<Pick<StoredClipResponse, "clipId">> & {
    mimeType: string;
    durationMs: number;
    sizeBytes: number;
  }>,
): CollectionEvent[] {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const domains = [
    "field-notes.test",
    "quiet-arcade.test",
    "night-radio.test",
    "tiny-weather.test",
  ];
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return Array.from({ length: DEMO_EVENT_COUNT }, (_, index) => {
    const clip = clips[index % clips.length];
    const hourProgress = index / (DEMO_EVENT_COUNT - 1);
    const playedAtMs =
      dayStart.getTime() +
      (6.5 + hourProgress * 16) * 60 * 60 * 1000 +
      (index % 4) * 47_000;
    const domain = domains[index % domains.length];
    const url = `https://${domain}/sound/${index % 5}`;
    const data: SoundEventData = {
      mediaSrc: `https://${domain}/demo/${index % clips.length}.wav`,
      mediaKind: "audio",
      detached: index % 3 !== 0,
      mediaDurationMs: clip.durationMs,
      pageTitle: `${domain.replace(".test", "")} sound ${index + 1}`,
      playedAtMs,
      clipId: clip.clipId,
      acquisition: "capture-stream",
      mimeType: clip.mimeType,
      clipDurationMs: clip.durationMs,
      sizeBytes: clip.sizeBytes,
    };

    return {
      id: generateULID(),
      type: "sound",
      ts: playedAtMs,
      data,
      meta: {
        pid: "seed-demo",
        sid: "seed-demo",
        url,
        vw: window.innerWidth,
        vh: window.innerHeight,
        tz: timezone,
      },
      domain,
      normalizedUrl: url,
    };
  });
}

export async function seedSoundDemoData(): Promise<void> {
  const clips: Array<{
    clipId: string;
    mimeType: string;
    durationMs: number;
    sizeBytes: number;
  }> = [];
  for (let index = 0; index < DEMO_CLIP_COUNT; index++) {
    const durationSeconds = 0.3 + (index % 5) * 0.32;
    const wav = await renderDemoClip(
      180 + index * 73,
      durationSeconds,
      index % 2 === 0 ? 1.65 : 0.72,
    );
    const response = (await browser.runtime.sendMessage({
      type: "STORE_SOUND_CLIP",
      dataBase64: arrayBufferToBase64(wav),
      mimeType: "audio/wav",
      clipDurationMs: Math.round(durationSeconds * 1000),
    })) as StoredClipResponse;

    if (!response.success || !response.clipId) {
      throw new Error("The demo clip could not be stored.");
    }

    clips.push({
      clipId: response.clipId,
      mimeType: response.mimeType ?? "audio/wav",
      durationMs:
        response.clipDurationMs ?? Math.round(durationSeconds * 1000),
      sizeBytes: response.sizeBytes ?? wav.byteLength,
    });
  }

  const response = await browser.runtime.sendMessage({
    type: "STORE_EVENTS",
    events: createDemoEvents(clips),
  });
  if (!response?.success) {
    throw new Error("The demo sound events could not be stored.");
  }
}
