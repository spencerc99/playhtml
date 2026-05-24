// ABOUTME: Reads PostgreSQL backup streams for room document data.
// ABOUTME: Keeps admin backup comparison parsing bounded to relevant rows.
export interface BackupDocumentRow {
  timestamp: string;
  base64Doc: string;
}

const DOCUMENTS_COPY_HEADER =
  "COPY public.documents (id, created_at, document, name) FROM stdin;";
const COPY_END_MARKER = "\\.";

type LineResult = BackupDocumentRow | "section-end" | null;

function parseBackupLine(
  line: string,
  encodedRoomId: string,
  state: { isInDocumentsSection: boolean; foundDocumentsSection: boolean }
): LineResult {
  const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;

  if (!state.isInDocumentsSection) {
    if (normalizedLine === DOCUMENTS_COPY_HEADER) {
      state.isInDocumentsSection = true;
      state.foundDocumentsSection = true;
    }

    return null;
  }

  if (normalizedLine === COPY_END_MARKER) {
    state.isInDocumentsSection = false;
    return "section-end";
  }

  if (!normalizedLine.trim()) {
    return null;
  }

  const cols = normalizedLine.split("\t");
  if (cols[3] !== encodedRoomId) {
    return null;
  }

  if (!cols[1]) {
    throw new Error("Backup documents row is missing timestamp data");
  }

  if (!cols[2]) {
    throw new Error("Backup documents row is missing document data");
  }

  return {
    timestamp: cols[1],
    base64Doc: cols[2],
  };
}

export async function findDocumentRowInBackup(
  stream: ReadableStream<Uint8Array>,
  encodedRoomId: string
): Promise<BackupDocumentRow | null> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const state = {
    isInDocumentsSection: false,
    foundDocumentsSection: false,
  };
  let pendingText = "";

  const processLine = (line: string): LineResult =>
    parseBackupLine(line, encodedRoomId, state);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        pendingText += decoder.decode();
        break;
      }

      pendingText += decoder.decode(value, { stream: true });
      let newlineIndex = pendingText.indexOf("\n");

      while (newlineIndex !== -1) {
        const line = pendingText.slice(0, newlineIndex);
        pendingText = pendingText.slice(newlineIndex + 1);

        const result = processLine(line);
        if (result === "section-end") {
          return null;
        }
        if (result) {
          await reader.cancel();
          return result;
        }

        newlineIndex = pendingText.indexOf("\n");
      }
    }

    if (pendingText) {
      const result = processLine(pendingText);
      if (result && result !== "section-end") {
        return result;
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!state.foundDocumentsSection) {
    throw new Error(
      "Could not find COPY public.documents section in backup file"
    );
  }

  return null;
}
