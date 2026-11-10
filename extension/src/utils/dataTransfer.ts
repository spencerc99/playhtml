// ABOUTME: Gzip compression/decompression helpers using the browser's built-in CompressionStream API
// ABOUTME: Used for export/import of events, pictures, collages and identity as compact .json.gz files

import type { PlayerIdentity } from "@playhtml/common";
import type { CollectionEvent } from "@playhtml/extension-types";
import type { StoredPlayerIdentity } from "../storage/playerIdentity";
import type { ExportContents } from "./importStream";

/** Events per export page; small enough that one page stays far below message limits. */
export const EXPORT_PAGE_SIZE = 1000;

async function gzipChunks(
  chunks: Iterable<string> | AsyncIterable<string>,
): Promise<Blob> {
  const encoder = new TextEncoder();
  const cs = new CompressionStream("gzip");
  // Read the compressed side while writing so output never piles up in the
  // stream, and let the browser hold the result as a Blob (which it can keep
  // on disk) instead of one large ArrayBuffer.
  const compressed = new Response(cs.readable).blob();
  const writer = cs.writable.getWriter();

  try {
    for await (const chunk of chunks) {
      await writer.write(encoder.encode(chunk));
    }
    await writer.close();
  } catch (error) {
    await writer.abort(error).catch(() => {});
    throw error;
  }

  return compressed;
}

export async function gzipString(str: string): Promise<Uint8Array> {
  return new Uint8Array(await (await gzipChunks([str])).arrayBuffer());
}

/** One page of events, or null once every event has been read. */
export type EventPageReader = () => Promise<CollectionEvent[] | null>;

/** One picture as file text: the URLs it was saved from and its bytes in base64. */
export interface ExportedImage {
  hash: string;
  srcs: string[];
  form: string;
  mimeType: string;
  width?: number;
  height?: number;
  base64: string;
}

export interface ExportSections {
  exportedAt: number;
  /** What the file holds, so an import can say so before reading it all. */
  contents?: ExportContents;
  packedIn?: string;
  readEventPage: EventPageReader;
  images?: AsyncIterable<ExportedImage>;
  /** Collage file envelopes, as `encodeCollageFile` writes them. */
  collages?: AsyncIterable<unknown>;
  identity: PlayerIdentity | null;
  /** The private side of the identity, only when the person chose to bring it. */
  you?: StoredPlayerIdentity | null;
  onProgress?: (
    section: "events" | "images" | "collages",
    written: number,
  ) => void;
}

/**
 * Builds a .json.gz export by pulling events a page at a time, then pictures
 * and collages one at a time, so nothing ever has to sit in memory all at once
 * or cross a single extension message. The file format is what
 * `readExportFiles` imports; builds that only know events stop after them.
 */
export async function gzipExport(sections: ExportSections): Promise<Blob> {
  const { onProgress } = sections;
  async function* jsonChunks(): AsyncGenerator<string> {
    let head = `{"version":1,"exportedAt":${sections.exportedAt}`;
    if (sections.packedIn)
      head += `,"packedIn":${JSON.stringify(sections.packedIn)}`;
    if (sections.contents)
      head += `,"contents":${JSON.stringify(sections.contents)}`;
    yield head + `,"events":[`;
    let written = 0;
    while (true) {
      const page = await sections.readEventPage();
      if (!page) break;
      const parts: string[] = [];
      for (const event of page) {
        parts.push(JSON.stringify(event));
      }
      if (parts.length > 0) {
        yield (written > 0 ? "," : "") + parts.join(",");
        written += parts.length;
        onProgress?.("events", written);
      }
    }
    yield "]";
    for (const section of ["images", "collages"] as const) {
      const items = sections[section];
      if (!items) continue;
      yield `,"${section}":[`;
      let count = 0;
      for await (const item of items) {
        yield (count > 0 ? "," : "") + JSON.stringify(item);
        count++;
        onProgress?.(section, count);
      }
      yield "]";
    }
    yield `,"identity":${JSON.stringify(sections.identity)}`;
    if (sections.you) yield `,"you":${JSON.stringify(sections.you)}`;
    yield "}";
  }

  return gzipChunks(jsonChunks());
}

/** An events-only export, in the shape every build can read. */
export async function gzipEventExportPages(
  readPage: EventPageReader,
  identity: PlayerIdentity | null,
  exportedAt: number,
  onProgress?: (eventsWritten: number) => void,
): Promise<Blob> {
  return gzipExport({
    exportedAt,
    readEventPage: readPage,
    identity,
    onProgress: onProgress && ((_, written) => onProgress(written)),
  });
}

export async function gzipEventExport(
  events: CollectionEvent[],
  identity: PlayerIdentity | null,
  exportedAt: number,
): Promise<Uint8Array> {
  let served = false;
  const blob = await gzipEventExportPages(
    async () => {
      if (served) return null;
      served = true;
      return events;
    },
    identity,
    exportedAt,
  );
  return new Uint8Array(await blob.arrayBuffer());
}

export async function gunzipToString(data: Uint8Array): Promise<string> {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  const input = new Uint8Array(data.length);
  input.set(data);
  writer.write(input);
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(combined);
}
