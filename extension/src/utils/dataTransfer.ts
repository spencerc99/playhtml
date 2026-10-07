// ABOUTME: Gzip compression/decompression helpers using the browser's built-in CompressionStream API
// ABOUTME: Used for export/import of local event data as compact .json.gz files

import type { PlayerIdentity } from "@playhtml/common";
import type { CollectionEvent } from "@playhtml/extension-types";

async function gzipChunks(chunks: Iterable<string>): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const cs = new CompressionStream("gzip");
  const compressed = new Response(cs.readable).arrayBuffer();
  const writer = cs.writable.getWriter();

  for (const chunk of chunks) {
    await writer.write(encoder.encode(chunk));
  }
  await writer.close();

  return new Uint8Array(await compressed);
}

export async function gzipString(str: string): Promise<Uint8Array> {
  return gzipChunks([str]);
}

export async function gzipEventExport(
  events: CollectionEvent[],
  identity: PlayerIdentity | null,
  exportedAt: number,
): Promise<Uint8Array> {
  function* jsonChunks(): Generator<string> {
    yield `{"version":1,"exportedAt":${exportedAt},"events":[`;
    for (let index = 0; index < events.length; index++) {
      if (index > 0) yield ",";
      yield JSON.stringify(events[index]);
    }
    yield `],"identity":${JSON.stringify(identity)}}`;
  }

  return gzipChunks(jsonChunks());
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
