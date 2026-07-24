// ABOUTME: Orchestrates refetch-first sound acquisition from the isolated content world.
// ABOUTME: Validates binary bridge messages and bounds all sound acquisition work.

import browser from 'webextension-polyfill';
import { createPrefixedId } from '../storage/ids';

export const SOUND_CAPTURE_REQUEST_MESSAGE_TYPE = 'wewe:sound-capture-request';
export const SOUND_CLIP_MESSAGE_TYPE = 'wewe:sound-clip';
export const SOUND_ACQUISITION_TIMEOUT_MS = 15_000;
export const SOUND_CAPTURE_MAX_DURATION_MS = 12_000;
export const SOUND_REFETCH_MAX_BYTES = 4 * 1024 * 1024;
export const SOUND_BRIDGE_MAX_BYTES = 5 * 1024 * 1024;
export const SOUND_REFETCH_TIMEOUT_MS = 8_000;

const MAX_REQUEST_ID_LENGTH = 128;
const MAX_CAPTURE_ID_LENGTH = 128;
const MAX_MIME_TYPE_LENGTH = 256;
const SOUND_CLIP_MESSAGE_KEYS = new Set([
  'type',
  'requestId',
  'buffer',
  'mimeType',
  'durationMs',
]);

export type SoundAcquisitionMethod = 'refetch' | 'capture-stream' | 'none';

export interface SoundAcquisitionResult {
  acquisition: SoundAcquisitionMethod;
  clipId?: string;
  mimeType?: string;
  clipDurationMs?: number;
  sizeBytes?: number;
}

export interface SoundPlaybackForAcquisition {
  sourceUrl: string;
  captureId: string;
  mediaDurationMs?: number;
}

export interface SoundClipBridgeMessage {
  type: typeof SOUND_CLIP_MESSAGE_TYPE;
  requestId: string;
  buffer: ArrayBuffer;
  mimeType: string;
  durationMs: number;
}

export interface RefetchedSoundClip {
  blob: Blob;
  mimeType: string;
}

export class SoundRefetchError extends Error {
  constructor(
    readonly code:
      | 'invalid-url'
      | 'fetch-failed'
      | 'http-error'
      | 'invalid-content-type'
      | 'size-limit'
      | 'timeout',
  ) {
    super(code);
    this.name = 'SoundRefetchError';
  }
}

export function getSoundAcquisitionMethod(sourceUrl: string): Exclude<
  SoundAcquisitionMethod,
  'none'
> {
  try {
    const protocol = new URL(sourceUrl).protocol;
    return protocol === 'http:' || protocol === 'https:'
      ? 'refetch'
      : 'capture-stream';
  } catch {
    return 'capture-stream';
  }
}

export function parseSoundClipBridgeMessage(
  data: unknown,
): SoundClipBridgeMessage | undefined {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !SOUND_CLIP_MESSAGE_KEYS.has(key)) ||
    record.type !== SOUND_CLIP_MESSAGE_TYPE ||
    typeof record.requestId !== 'string' ||
    record.requestId.length === 0 ||
    record.requestId.length > MAX_REQUEST_ID_LENGTH ||
    !(record.buffer instanceof ArrayBuffer) ||
    record.buffer.byteLength === 0 ||
    record.buffer.byteLength > SOUND_BRIDGE_MAX_BYTES ||
    typeof record.mimeType !== 'string' ||
    record.mimeType.length === 0 ||
    record.mimeType.length > MAX_MIME_TYPE_LENGTH ||
    !isSupportedSoundMimeType(record.mimeType) ||
    typeof record.durationMs !== 'number' ||
    !Number.isSafeInteger(record.durationMs) ||
    record.durationMs < 0 ||
    record.durationMs > SOUND_CAPTURE_MAX_DURATION_MS
  ) {
    return undefined;
  }

  return {
    type: SOUND_CLIP_MESSAGE_TYPE,
    requestId: record.requestId,
    buffer: record.buffer,
    mimeType: record.mimeType,
    durationMs: record.durationMs,
  };
}

export function isSupportedSoundMimeType(mimeType: string): boolean {
  const normalizedMimeType = mimeType.split(';', 1)[0].trim().toLowerCase();
  return (
    normalizedMimeType.startsWith('audio/') ||
    normalizedMimeType.startsWith('video/') ||
    normalizedMimeType === 'application/octet-stream'
  );
}

export async function refetchSoundClip(
  sourceUrl: string,
  options: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    maxBytes?: number;
  } = {},
): Promise<RefetchedSoundClip> {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new SoundRefetchError('invalid-url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SoundRefetchError('invalid-url');
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? SOUND_REFETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? SOUND_REFETCH_MAX_BYTES;
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const fetchTask = (async () => {
    let response: Response;
    try {
      response = await fetchImpl(url.href, {
        method: 'GET',
        signal: controller.signal,
      });
    } catch {
      throw new SoundRefetchError('fetch-failed');
    }

    if (!response.ok) {
      throw new SoundRefetchError('http-error');
    }

    const contentType = response.headers.get('content-type')?.trim() ?? '';
    if (!contentType || !isSupportedSoundMimeType(contentType)) {
      throw new SoundRefetchError('invalid-content-type');
    }

    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader !== null) {
      const contentLength = Number(contentLengthHeader);
      if (
        !Number.isSafeInteger(contentLength) ||
        contentLength < 0 ||
        contentLength > maxBytes
      ) {
        controller.abort();
        throw new SoundRefetchError('size-limit');
      }
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          controller.abort();
          await reader.cancel().catch(() => undefined);
          throw new SoundRefetchError('size-limit');
        }
        chunks.push(value);
      }
    } else {
      const bytes = new Uint8Array(await response.arrayBuffer());
      totalBytes = bytes.byteLength;
      if (totalBytes > maxBytes) {
        controller.abort();
        throw new SoundRefetchError('size-limit');
      }
      chunks.push(bytes);
    }

    if (totalBytes === 0) {
      throw new SoundRefetchError('fetch-failed');
    }

    const blobParts = chunks.map((chunk) => {
      const buffer = new ArrayBuffer(chunk.byteLength);
      new Uint8Array(buffer).set(chunk);
      return buffer;
    });
    return {
      blob: new Blob(blobParts, { type: contentType }),
      mimeType: contentType,
    };
  })();

  const timeoutTask = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new SoundRefetchError('timeout'));
    }, timeoutMs);
  });

  // The aborted fetch may reject after the timeout wins the race; mark it
  // handled so it never surfaces as an unhandled rejection.
  fetchTask.catch(() => undefined);

  try {
    return await Promise.race([fetchTask, timeoutTask]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

interface PendingSoundClip {
  resolve: (message: SoundClipBridgeMessage | undefined) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface SoundClipResponse {
  success: true;
  clipId: string;
  mimeType: string;
  clipDurationMs?: number;
  sizeBytes: number;
}

function parseSoundClipResponse(value: unknown): SoundClipResponse | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const response = value as Record<string, unknown>;
  if (
    response.success !== true ||
    typeof response.clipId !== 'string' ||
    response.clipId.length === 0 ||
    typeof response.mimeType !== 'string' ||
    !isSupportedSoundMimeType(response.mimeType) ||
    typeof response.sizeBytes !== 'number' ||
    !Number.isSafeInteger(response.sizeBytes) ||
    response.sizeBytes <= 0 ||
    (response.clipDurationMs !== undefined &&
      (typeof response.clipDurationMs !== 'number' ||
        !Number.isSafeInteger(response.clipDurationMs) ||
        response.clipDurationMs < 0))
  ) {
    return undefined;
  }

  return response as unknown as SoundClipResponse;
}

function isSoundClipBudgetRejection(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const response = value as Record<string, unknown>;
  return (
    response.success === false &&
    (response.reason === 'domain-daily-limit' ||
      response.reason === 'global-size-limit')
  );
}

export class SoundAcquisition {
  private pendingClips = new Map<string, PendingSoundClip>();
  private messageHandler?: (event: MessageEvent<unknown>) => void;

  start(): void {
    if (this.messageHandler) return;
    this.messageHandler = (event: MessageEvent<unknown>) => {
      if (event.source !== window) return;
      const message = parseSoundClipBridgeMessage(event.data);
      if (!message) return;
      const pending = this.pendingClips.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timeoutId);
      this.pendingClips.delete(message.requestId);
      pending.resolve(message);
    };
    window.addEventListener('message', this.messageHandler);
  }

  stop(): void {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = undefined;
    }
    for (const pending of this.pendingClips.values()) {
      clearTimeout(pending.timeoutId);
      pending.resolve(undefined);
    }
    this.pendingClips.clear();
  }

  async acquire(
    playback: SoundPlaybackForAcquisition,
  ): Promise<SoundAcquisitionResult> {
    const startedAt = Date.now();
    const method = getSoundAcquisitionMethod(playback.sourceUrl);

    if (method === 'refetch') {
      const response = await this.sendWithDeadline(
        {
          type: 'ACQUIRE_SOUND_CLIP',
          sourceUrl: playback.sourceUrl,
          mediaDurationMs: playback.mediaDurationMs,
        },
        startedAt,
      );
      const clip = parseSoundClipResponse(response);
      if (clip) {
        return {
          acquisition: 'refetch',
          clipId: clip.clipId,
          mimeType: clip.mimeType,
          clipDurationMs: clip.clipDurationMs,
          sizeBytes: clip.sizeBytes,
        };
      }
      if (isSoundClipBudgetRejection(response)) {
        return { acquisition: 'none' };
      }
    }

    const remainingMs = this.remainingMs(startedAt);
    if (
      remainingMs <= 0 ||
      !playback.captureId ||
      playback.captureId.length > MAX_CAPTURE_ID_LENGTH
    ) {
      return { acquisition: 'none' };
    }

    const requestId = createPrefixedId('sound_capture_');
    const clipPromise = this.waitForClip(requestId, remainingMs);
    window.postMessage(
      {
        type: SOUND_CAPTURE_REQUEST_MESSAGE_TYPE,
        captureId: playback.captureId,
        requestId,
        maxDurationMs: Math.min(SOUND_CAPTURE_MAX_DURATION_MS, remainingMs),
      },
      '*',
    );

    const message = await clipPromise;
    if (!message) return { acquisition: 'none' };

    const response = await this.sendWithDeadline(
      {
        type: 'STORE_SOUND_CLIP',
        dataBase64: arrayBufferToBase64(message.buffer),
        mimeType: message.mimeType,
        clipDurationMs: message.durationMs,
      },
      startedAt,
    );
    const clip = parseSoundClipResponse(response);
    if (!clip) return { acquisition: 'none' };

    return {
      acquisition: 'capture-stream',
      clipId: clip.clipId,
      mimeType: clip.mimeType,
      clipDurationMs: clip.clipDurationMs,
      sizeBytes: clip.sizeBytes,
    };
  }

  private remainingMs(startedAt: number): number {
    return Math.max(0, SOUND_ACQUISITION_TIMEOUT_MS - (Date.now() - startedAt));
  }

  private async sendWithDeadline(
    message: Record<string, unknown>,
    startedAt: number,
  ): Promise<unknown> {
    const remainingMs = this.remainingMs(startedAt);
    if (remainingMs <= 0) return undefined;

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(undefined), remainingMs);
      browser.runtime.sendMessage(message).then(
        (response) => {
          clearTimeout(timeoutId);
          resolve(response);
        },
        () => {
          clearTimeout(timeoutId);
          resolve(undefined);
        },
      );
    });
  }

  private waitForClip(
    requestId: string,
    timeoutMs: number,
  ): Promise<SoundClipBridgeMessage | undefined> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pendingClips.delete(requestId);
        resolve(undefined);
      }, timeoutMs);
      this.pendingClips.set(requestId, { resolve, timeoutId });
    });
  }
}
