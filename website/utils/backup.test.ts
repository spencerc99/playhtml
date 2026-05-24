// ABOUTME: Verifies streamed parsing for PostgreSQL backup document rows.
// ABOUTME: Covers room lookup behavior without loading whole backup files.
import { describe, expect, test } from "bun:test";

import { findDocumentRowInBackup } from "./backup";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }

      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
}

function streamThatFailsAfterTarget(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = [
    "COPY public.documents (id, created_at, document, name) FROM stdin;\n",
    "1\t2026-05-23T10:00:00.000Z\tAAAA\troom-a\n",
  ];
  let index = 0;

  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        throw new Error("Read past target row");
      }

      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
}

describe("findDocumentRowInBackup", () => {
  test("finds a matching room from split chunks", async () => {
    const row = await findDocumentRowInBackup(
      streamFromChunks([
        "irrelevant prelude\n",
        "COPY public.documents (id, created_at, document, name) FROM stdin;\n",
        "1\t2026-05-23T10:00:00.000Z\tAAAA\troom-a\n2\t2026-05-23T11:",
        "00:00.000Z\tBBBB\troom-b\n\\.\ntrailing data",
      ]),
      "room-b"
    );

    expect(row).toEqual({
      timestamp: "2026-05-23T11:00:00.000Z",
      base64Doc: "BBBB",
    });
  });

  test("returns null when the documents section does not contain the room", async () => {
    const row = await findDocumentRowInBackup(
      streamFromChunks([
        "COPY public.documents (id, created_at, document, name) FROM stdin;\n",
        "1\t2026-05-23T10:00:00.000Z\tAAAA\troom-a\n\\.\n",
      ]),
      "room-b"
    );

    expect(row).toBeNull();
  });

  test("stops reading after it finds the matching room", async () => {
    const row = await findDocumentRowInBackup(
      streamThatFailsAfterTarget(),
      "room-a"
    );

    expect(row).toEqual({
      timestamp: "2026-05-23T10:00:00.000Z",
      base64Doc: "AAAA",
    });
  });

  test("throws when a matching row is missing document data", async () => {
    await expect(
      findDocumentRowInBackup(
        streamFromChunks([
          "COPY public.documents (id, created_at, document, name) FROM stdin;\n",
          "1\t2026-05-23T10:00:00.000Z\t\troom-a\n",
        ]),
        "room-a"
      )
    ).rejects.toThrow("Backup documents row is missing document data");
  });

  test("throws when the documents section is missing", async () => {
    await expect(
      findDocumentRowInBackup(
        streamFromChunks(["COPY public.other FROM stdin;\n\\."]),
        "room-a"
      )
    ).rejects.toThrow(
      "Could not find COPY public.documents section in backup file"
    );
  });
});
