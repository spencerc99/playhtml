// ABOUTME: Reads a .json.gz export of any size as a stream: events in batches, then collages, pictures and identity.
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
const COLON = 58;

/** Top-level arrays whose elements are handed back one at a time. */
const STREAMED_SECTIONS = new Set(["events", "collages", "images"]);

/** What the file says it holds, written before any events. */
export interface ExportContents {
  history?: number;
  scraps?: number;
  collages?: number;
  pictures?: number;
  you?: boolean;
  /** The cursor color of the person the file remembers. */
  youColor?: string;
}

/** The part of an export before its events. */
export interface ExportHeader {
  version: 1;
  exportedAt?: number;
  /** Older exports carry no contents: just events and a public identity. */
  contents?: ExportContents;
  /** The browser the file was packed up in, when known. */
  packedIn?: string;
}

/** One element of a streamed array, or one whole value from after the header. */
export interface ExportItem {
  section: string;
  value: unknown;
}

/**
 * Scans export JSON text chunk by chunk. Each element of the "events",
 * "collages" and "images" arrays comes back as soon as it is complete, and any
 * other top-level value after the header comes back whole. Only one element
 * is ever held in memory, so the file size does not matter.
 */
export class ExportScanner {
  private depth = 0;
  private inString = false;
  private escaped = false;
  private expectKey = false;
  private key = "";
  private lastKey = "";
  private header = "";
  private headerDone = false;
  private streaming: string | null = null;
  private pendingElement = "";
  private elementStart = -1;
  private capturing = false;
  private captured = "";
  private ended = false;
  private finishedSections = new Set<string>();

  /** The parsed header, available once the events array has started. */
  meta: ExportHeader | null = null;

  push(chunk: string): ExportItem[] {
    const items: ExportItem[] = [];
    if (this.ended) return items;

    let headerStart = this.headerDone ? -1 : 0;
    let captureStart = this.capturing ? 0 : -1;
    const finishCapture = (end: number) => {
      const text =
        this.captured +
        chunk.slice(captureStart === -1 ? 0 : captureStart, end);
      this.captured = "";
      this.capturing = false;
      captureStart = -1;
      items.push({ section: this.lastKey, value: JSON.parse(text) });
    };

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
        else if (
          this.depth === 2 &&
          code === OPEN_BRACKET &&
          STREAMED_SECTIONS.has(this.lastKey) &&
          (this.headerDone || this.lastKey === "events")
        ) {
          if (!this.headerDone) {
            this.readHeader(chunk.slice(headerStart, i));
            headerStart = -1;
          }
          this.capturing = false;
          this.captured = "";
          captureStart = -1;
          this.streaming = this.lastKey;
        } else if (this.depth === 3 && this.streaming) {
          this.elementStart = i;
        }
      } else if (code === CLOSE_BRACE || code === CLOSE_BRACKET) {
        if (this.depth === 3 && this.streaming) {
          const text =
            this.pendingElement +
            chunk.slice(
              this.elementStart === -1 ? 0 : this.elementStart,
              i + 1,
            );
          this.pendingElement = "";
          this.elementStart = -1;
          items.push({ section: this.streaming, value: JSON.parse(text) });
        } else if (this.depth === 2 && this.streaming) {
          this.finishedSections.add(this.streaming);
          this.streaming = null;
        } else if (this.depth === 1) {
          if (this.capturing) finishCapture(i);
          this.depth--;
          this.ended = true;
          break;
        }
        this.depth--;
      } else if (this.depth === 1 && code === COMMA) {
        if (this.capturing) finishCapture(i);
        this.expectKey = true;
      } else if (this.depth === 1 && code === COLON && this.headerDone) {
        this.capturing = true;
        this.captured = "";
        captureStart = i + 1;
      }
    }

    if (headerStart !== -1 && !this.headerDone) {
      this.header += chunk.slice(headerStart);
      if (this.header.length > MAX_HEADER_LENGTH)
        throw new Error("This file is not a we were online export");
    }
    if (this.streaming && this.depth >= 3) {
      this.pendingElement += chunk.slice(
        this.elementStart === -1 ? 0 : this.elementStart,
      );
      this.elementStart = -1;
    }
    if (this.capturing) {
      this.captured += chunk.slice(captureStart === -1 ? 0 : captureStart);
    }
    return items;
  }

  /** Whether a streamed array has been read to its end. */
  finished(section: string): boolean {
    return this.finishedSections.has(section);
  }

  /** Throws unless the whole file was read. */
  finish(): void {
    if (!this.finishedSections.has("events"))
      throw new Error("This file ended before all of its events were read");
    if (!this.ended)
      throw new Error("This file ended before everything in it was read");
  }

  private readHeader(lastHeaderPiece: string) {
    const header = this.header + lastHeaderPiece;
    this.header = "";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(`${header}[]}`);
    } catch {
      throw new Error("This file is not a we were online export");
    }
    if (parsed.version !== 1)
      throw new Error("This export was made by a version we can't read");
    this.meta = {
      version: 1,
      ...(typeof parsed.exportedAt === "number"
        ? { exportedAt: parsed.exportedAt }
        : {}),
      ...(parsed.contents && typeof parsed.contents === "object"
        ? { contents: parsed.contents as ExportContents }
        : {}),
      ...(typeof parsed.packedIn === "string"
        ? { packedIn: parsed.packedIn }
        : {}),
    };
    this.headerDone = true;
  }
}

/**
 * Reads only the events of an export, stopping at the end of the events
 * array. Kept for callers that have no use for the other sections.
 */
export class ExportEventScanner {
  private scanner = new ExportScanner();

  get meta(): ExportHeader | null {
    return this.scanner.meta;
  }

  push(chunk: string): CollectionEvent[] {
    if (this.scanner.finished("events")) return [];
    return this.scanner
      .push(chunk)
      .filter((item) => item.section === "events")
      .map((item) => item.value as CollectionEvent);
  }

  finish(): void {
    if (!this.scanner.finished("events"))
      throw new Error("This file ended before all of its events were read");
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
  onItem?: (item: ExportItem, progress: ImportReadProgress) => Promise<void>,
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

    const scanner = new ExportScanner();
    let batch: CollectionEvent[] = [];
    const progress = () => ({
      bytesRead: bytesBefore + fileBytesRead,
      totalBytes,
      eventsRead,
    });
    const flush = async () => {
      const events = batch;
      batch = [];
      await onBatch(events, progress());
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const item of scanner.push(value)) {
          if (item.section === "events") {
            batch.push(item.value as CollectionEvent);
            eventsRead++;
            if (batch.length >= IMPORT_BATCH_SIZE) await flush();
          } else if (onItem) {
            // Events always come first, so they are all saved before the rest.
            if (batch.length > 0) await flush();
            await onItem(item, progress());
          }
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
 * Reads just the start of an export, enough to know what it holds, without
 * reading the rest of the file.
 */
export async function readExportHeader(
  file: ImportFile,
): Promise<ExportHeader> {
  const gunzip = new DecompressionStream("gzip");
  const writer = gunzip.writable.getWriter();
  const reader = gunzip.readable
    .pipeThrough(new TextDecoderStream())
    .getReader();
  let stop = false;
  const feed = (async () => {
    for (let start = 0; start < file.size && !stop; start += READ_PIECE_BYTES) {
      const end = Math.min(start + READ_PIECE_BYTES, file.size);
      await writer.write(
        new Uint8Array(await file.slice(start, end).arrayBuffer()),
      );
    }
    if (!stop) await writer.close();
  })();
  feed.catch(() => {});

  const scanner = new ExportScanner();
  try {
    while (!scanner.meta) {
      const { done, value } = await reader.read();
      if (done) break;
      scanner.push(value);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("export")) throw error;
    throw new Error("This file is not a we were online export");
  } finally {
    stop = true;
    await reader.cancel().catch(() => {});
    await writer.abort().catch(() => {});
  }
  if (!scanner.meta)
    throw new Error("This file is not a we were online export");
  return scanner.meta;
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
