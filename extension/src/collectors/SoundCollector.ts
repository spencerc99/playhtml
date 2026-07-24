// ABOUTME: Collects metadata when audio or video starts playing in a browser tab.
// ABOUTME: Validates MAIN-world bridge messages and stores deduplicated local events.

import { BaseCollector } from './BaseCollector';
import {
  SoundAcquisition,
  type SoundAcquisitionResult,
  type SoundPlaybackForAcquisition,
} from './SoundAcquisition';
import type { SoundEventData } from './types';

export const SOUND_PLAY_MESSAGE_TYPE = 'wewe:sound-play';
export const SOUND_DEDUP_WINDOW_MS = 3000;
export const SOUND_DENIED_HOSTNAMES = [
  'meet.google.com',
  'zoom.us',
  'teams.microsoft.com',
  'discord.com',
  'app.slack.com',
  'whereby.com',
] as const;

const MAX_MEDIA_SRC_LENGTH = 2048;
const MAX_BRIDGE_SRC_LENGTH = 16384;
const MAX_PAGE_TITLE_LENGTH = 512;
const MAX_DURATION_SECONDS = Number.MAX_SAFE_INTEGER / 1000;
const MAX_CAPTURE_ID_LENGTH = 128;
const MESSAGE_KEYS = new Set([
  'type',
  'src',
  'mediaKind',
  'detached',
  'duration',
  'timestamp',
  'captureId',
]);

interface SoundPlayMessage {
  type: typeof SOUND_PLAY_MESSAGE_TYPE;
  src: string;
  mediaKind: 'audio' | 'video';
  detached: boolean;
  duration?: number;
  timestamp: number;
  captureId: string;
}

interface SoundClipAcquirer {
  start(): void;
  stop(): void;
  acquire(
    playback: SoundPlaybackForAcquisition,
  ): Promise<SoundAcquisitionResult>;
}

export function isSoundCollectionDenied(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase();
  return SOUND_DENIED_HOSTNAMES.some(
    (deniedHostname) =>
      normalizedHostname === deniedHostname ||
      normalizedHostname.endsWith(`.${deniedHostname}`),
  );
}

export function normalizeMediaSrc(src: string): string | undefined {
  const trimmedSrc = src.trim();
  if (!trimmedSrc) return undefined;

  try {
    const url = new URL(trimmedSrc, window.location.href);
    url.search = '';
    url.hash = '';
    return url.href.slice(0, MAX_MEDIA_SRC_LENGTH);
  } catch {
    return undefined;
  }
}

function parseSoundPlayMessage(data: unknown): SoundPlayMessage | undefined {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !MESSAGE_KEYS.has(key)) ||
    record.type !== SOUND_PLAY_MESSAGE_TYPE ||
    typeof record.src !== 'string' ||
    record.src.length > MAX_BRIDGE_SRC_LENGTH ||
    (record.mediaKind !== 'audio' && record.mediaKind !== 'video') ||
    typeof record.detached !== 'boolean' ||
    !Number.isSafeInteger(record.timestamp) ||
    (record.timestamp as number) < 0 ||
    typeof record.captureId !== 'string' ||
    record.captureId.length === 0 ||
    record.captureId.length > MAX_CAPTURE_ID_LENGTH
  ) {
    return undefined;
  }

  const duration = record.duration;
  if (
    duration !== undefined &&
    (typeof duration !== 'number' ||
      !Number.isFinite(duration) ||
      duration < 0 ||
      duration > MAX_DURATION_SECONDS)
  ) {
    return undefined;
  }

  return {
    type: SOUND_PLAY_MESSAGE_TYPE,
    src: record.src,
    mediaKind: record.mediaKind,
    detached: record.detached,
    duration,
    timestamp: record.timestamp as number,
    captureId: record.captureId,
  };
}

export class SoundCollector extends BaseCollector<SoundEventData> {
  readonly type = 'sound' as const;
  readonly description = 'Captures metadata when audio or video starts playing';

  private lastEmittedBySrc = new Map<string, number>();
  private messageHandler?: (event: MessageEvent<unknown>) => void;
  private pendingSoundEvents = new Set<Promise<void>>();

  constructor(
    private readonly acquisition: SoundClipAcquirer = new SoundAcquisition(),
  ) {
    super();
  }

  start(): void {
    if (isSoundCollectionDenied(window.location.hostname)) return;
    this.acquisition.start();

    this.messageHandler = (event: MessageEvent<unknown>) => {
      try {
        if (event.source !== window) return;

        const message = parseSoundPlayMessage(event.data);
        if (!message) return;

        const mediaSrc = normalizeMediaSrc(message.src);
        const now = Date.now();
        if (mediaSrc) {
          for (const [src, lastEmittedAt] of this.lastEmittedBySrc) {
            if (now - lastEmittedAt >= SOUND_DEDUP_WINDOW_MS) {
              this.lastEmittedBySrc.delete(src);
            }
          }
          const lastEmittedAt = this.lastEmittedBySrc.get(mediaSrc);
          if (
            lastEmittedAt !== undefined &&
            now - lastEmittedAt < SOUND_DEDUP_WINDOW_MS
          ) {
            return;
          }
          this.lastEmittedBySrc.set(mediaSrc, now);
        }

        const pageTitle = document.title.trim().slice(0, MAX_PAGE_TITLE_LENGTH);
        const data: SoundEventData = {
          mediaKind: message.mediaKind,
          detached: message.detached,
          playedAtMs: now,
        };

        if (mediaSrc) {
          data.mediaSrc = mediaSrc;
        }
        if (message.duration !== undefined) {
          data.mediaDurationMs = Math.round(message.duration * 1000);
        }
        if (pageTitle) {
          data.pageTitle = pageTitle;
        }

        let sourceUrl = message.src;
        try {
          sourceUrl = new URL(message.src, window.location.href).href;
        } catch {
          // captureStream can still acquire media backed by srcObject.
        }

        const pending = this.acquireAndEmit(data, {
          sourceUrl,
          captureId: message.captureId,
          mediaDurationMs: data.mediaDurationMs,
        }).finally(() => {
          this.pendingSoundEvents.delete(pending);
        });
        this.pendingSoundEvents.add(pending);
      } catch {
        // The page controls this message channel, so malformed values are ignored.
      }
    };

    window.addEventListener('message', this.messageHandler);
  }

  stop(): void {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = undefined;
    }
    this.acquisition.stop();
    this.lastEmittedBySrc.clear();
  }

  async waitForPendingEvents(): Promise<void> {
    await Promise.all(Array.from(this.pendingSoundEvents));
    await super.waitForPendingEvents();
  }

  private async acquireAndEmit(
    data: SoundEventData,
    playback: SoundPlaybackForAcquisition,
  ): Promise<void> {
    let result: SoundAcquisitionResult;
    try {
      result = await this.acquisition.acquire(playback);
    } catch {
      result = { acquisition: 'none' };
    }

    data.acquisition = result.acquisition;
    if (result.clipId) data.clipId = result.clipId;
    if (result.mimeType) data.mimeType = result.mimeType;
    if (result.clipDurationMs !== undefined) {
      data.clipDurationMs = result.clipDurationMs;
    }
    if (result.sizeBytes !== undefined) data.sizeBytes = result.sizeBytes;
    this.emit(data);
  }
}
