// ABOUTME: Gzip compression/decompression helpers using the browser's built-in CompressionStream API
// ABOUTME: Used for export/import of local event data as compact .json.gz files

import type { PlayerIdentity } from "@playhtml/common";
import type { CollectionEvent } from "@playhtml/extension-types";

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

/**
 * Builds a .json.gz export by pulling events a page at a time, so the full
 * history never has to sit in memory or cross a single extension message.
 * The file format matches what `readExportFiles` imports.
 */
export async function gzipEventExportPages(
  readPage: EventPageReader,
  identity: PlayerIdentity | null,
  exportedAt: number,
  onProgress?: (eventsWritten: number) => void,
): Promise<Blob> {
  async function* jsonChunks(): AsyncGenerator<string> {
    yield `{"version":1,"exportedAt":${exportedAt},"events":[`;
    let written = 0;
    while (true) {
      const page = await readPage();
      if (!page) break;
      const parts: string[] = [];
      for (const event of page) {
        parts.push(JSON.stringify(event));
      }
      if (parts.length > 0) {
        yield (written > 0 ? "," : "") + parts.join(",");
        written += parts.length;
        onProgress?.(written);
      }
    }
    yield `],"identity":${JSON.stringify(identity)}}`;
  }

  return gzipChunks(jsonChunks());
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
