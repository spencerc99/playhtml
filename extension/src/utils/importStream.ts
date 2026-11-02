// ABOUTME: Reads a .json.gz export of any size as a stream and hands its events back in batches.
// ABOUTME: Keeps memory flat and reports how much of the file has been read for import progress.

import type { CollectionEvent } from "@playhtml/extension-types";

export const IMPORT_BATCH_SIZE = 2000;

/** The export header ({"version":1,...,"events":) is short; anything longer is not an export. */
const MAX_HEADER_LENGTH = 64 * 1024;

const OPEN_BRACE = 123;
const CLOSE_BRACE = 125;
const OPEN_BRACKET = 91;
const CLOSE_BRACKET = 93;
const QUOTE = 34;
const BACKSLASH = 92;
const COMMA = 44;

/**
 * Scans export JSON text chunk by chunk and returns each element of the
 * top-level "events" array as soon as it is complete. Only the events array
 * and the header before it are ever held in memory, so the file size does not
 * matter.
 */
export class ExportEventScanner {
  private depth = 0;
  private inString = false;
  private escaped = false;
  private expectKey = false;
  private key = "";
  private lastKey = "";
  private header = "";
  private inEvents = false;
  private eventsDone = false;
  private pendingEvent = "";
  private eventStart = -1;

  /** The parsed header, available once the events array has started. */
  meta: { version: unknown } | null = null;

  push(chunk: string): CollectionEvent[] {
    const events: CollectionEvent[] = [];
    if (this.eventsDone) return events;

    let headerStart = this.inEvents ? -1 : 0;
    for (let i = 0; i < chunk.length; i++) {
      const code = chunk.charCodeAt(i);

      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (code === BACKSLASH) this.escaped = true;
        else if (code === QUOTE) {
          this.inString = false;
          if (this.depth === 1 && this.expectKey) {
            this.lastKey = this.key;
            this.expectKey = false;
          }
        } else if (this.depth === 1 && this.expectKey) {
          this.key += chunk[i];
        }
        continue;
      }

      if (code === QUOTE) {
        this.inString = true;
        if (this.depth === 1 && this.expectKey) this.key = "";
      } else if (code === OPEN_BRACE || code === OPEN_BRACKET) {
        this.depth++;
        if (this.depth === 1) this.expectKey = code === OPEN_BRACE;
        if (
          this.depth === 2 &&
          code === OPEN_BRACKET &&
          this.lastKey === "events" &&
          !this.inEvents
        ) {
          this.startEvents(chunk.slice(headerStart, i));
          headerStart = -1;
        } else if (this.depth === 3 && this.inEvents) {
          this.eventStart = i;
        }
      } else if (code === CLOSE_BRACE || code === CLOSE_BRACKET) {
        if (this.depth === 3 && this.inEvents) {
          const text =
            this.pendingEvent +
            chunk.slice(this.eventStart === -1 ? 0 : this.eventStart, i + 1);
          this.pendingEvent = "";
          this.eventStart = -1;
          events.push(JSON.parse(text) as CollectionEvent);
        } else if (this.depth === 2 && this.inEvents) {
          this.inEvents = false;
          this.eventsDone = true;
          return events;
        }
        this.depth--;
      } else if (code === COMMA && this.depth === 1) {
        this.expectKey = true;
      }
    }

    if (headerStart !== -1) {
      this.header += chunk.slice(headerStart);
      if (this.header.length > MAX_HEADER_LENGTH)
        throw new Error("This file is not a we were online export");
    }
    if (this.inEvents && this.depth >= 3) {
      this.pendingEvent += chunk.slice(
        this.eventStart === -1 ? 0 : this.eventStart,
      );
      this.eventStart = -1;
    }
    return events;
  }

  /** Throws unless the whole events array was read. */
  finish(): void {
    if (!this.eventsDone)
      throw new Error("This file ended before all of its events were read");
  }

  private startEvents(lastHeaderPiece: string) {
    const header = this.header + lastHeaderPiece;
    this.header = "";
    let parsed: { version?: unknown };
    try {
      parsed = JSON.parse(`${header}[]}`);
    } catch {
      throw new Error("This file is not a we were online export");
    }
    if (parsed.version !== 1)
      throw new Error("This export was made by a version we can't read");
    this.meta = { version: parsed.version };
    this.inEvents = true;
  }
}

export interface ImportReadProgress {
  /** Compressed bytes read so far across every file. */
  bytesRead: number;
  /** Compressed bytes across every file. */
  totalBytes: number;
  /** Events read so far across every file. */
  eventsRead: number;
}

/** The part of a File this reader needs. */
export interface ImportFile {
  size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

/**
 * Compressed bytes handed to gunzip at a time. Small pieces keep the byte count
 * close to the events actually saved; a browser's own file stream reads ahead
 * in chunks large enough to show 100% long before the import is done.
 */
const READ_PIECE_BYTES = 256 * 1024;

/**
 * Streams each file through gunzip and the scanner, calling onBatch with up to
 * IMPORT_BATCH_SIZE events at a time. onBatch is awaited, so a slow consumer
 * slows the read instead of filling memory.
 */
export async function readExportFiles(
  files: ImportFile[],
  onBatch: (
    events: CollectionEvent[],
    progress: ImportReadProgress,
  ) => Promise<void>,
): Promise<void> {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  let bytesBefore = 0;
  let eventsRead = 0;

  for (const file of files) {
    let fileBytesRead = 0;
    const gunzip = new DecompressionStream("gzip");
    const writer = gunzip.writable.getWriter();
    const reader = gunzip.readable
      .pipeThrough(new TextDecoderStream())
      .getReader();
    // Each write waits until gunzip takes the piece, so this stays at most a
    // piece or two ahead of the events being read below.
    const feed = (async () => {
      for (let start = 0; start < file.size; start += READ_PIECE_BYTES) {
        const end = Math.min(start + READ_PIECE_BYTES, file.size);
        const piece = await file.slice(start, end).arrayBuffer();
        await writer.write(new Uint8Array(piece));
        fileBytesRead = end;
      }
      await writer.close();
    })();
    // Failures surface through the reader; this only keeps them from going unhandled.
    feed.catch(() => {});

    const scanner = new ExportEventScanner();
    let batch: CollectionEvent[] = [];
    const flush = async () => {
      const events = batch;
      batch = [];
      await onBatch(events, {
        bytesRead: bytesBefore + fileBytesRead,
        totalBytes,
        eventsRead,
      });
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const event of scanner.push(value)) {
          batch.push(event);
          eventsRead++;
          if (batch.length >= IMPORT_BATCH_SIZE) await flush();
        }
      }
      await feed;
      scanner.finish();
    } catch (error) {
      await reader.cancel(error).catch(() => {});
      await writer.abort(error).catch(() => {});
      throw error;
    }
    fileBytesRead = file.size;
    await flush();
    bytesBefore += file.size;
  }
}

/**
 * Estimates the time left from the share of bytes read so far. Returns null
 * until enough has been read for the rate to mean anything.
 */
export function estimateRemainingMs(
  elapsedMs: number,
  bytesRead: number,
  totalBytes: number,
): number | null {
  if (totalBytes <= 0 || bytesRead <= 0) return null;
  const share = bytesRead / totalBytes;
  if (elapsedMs < 2000 || share < 0.02) return null;
  return (elapsedMs * (1 - share)) / share;
}

export function formatRemaining(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${Math.max(seconds, 1)}s left`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min left`;
}
