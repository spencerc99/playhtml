// ABOUTME: Restore collection events from the server for this browser's participant.
// ABOUTME: Used by the dev-mode "restore from server" button after local data loss.

import type { CollectionEvent, CollectionEventType } from "../collectors/types";
import {
  signRestorePageRequest,
  type RestoreCursor,
  type RestorePageResponse,
} from "../utils/restoreRequest";
import { getConfig } from "./sync";

const ALL_TYPES: CollectionEventType[] = [
  "cursor",
  "navigation",
  "viewport",
  "keyboard",
];

const MAX_PAGE_ATTEMPTS = 3;

export interface RestoreProgress {
  /** The event type currently being fetched. */
  type: CollectionEventType;
  /** Total events restored so far across all types. */
  total: number;
}

export interface RestoreResult {
  imported: number;
  countsByType: Record<CollectionEventType, number>;
}

export interface RestoreIdentity {
  publicKey: string;
  privateKey: JsonWebKey;
}

async function fetchRestorePage(
  workerUrl: string,
  identity: RestoreIdentity,
  type: CollectionEventType,
  before: RestoreCursor | null,
): Promise<RestorePageResponse> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_PAGE_ATTEMPTS; attempt++) {
    // Sign each attempt so a retry after a slow failure is never stale.
    const request = await signRestorePageRequest(identity.privateKey, {
      pid: identity.publicKey,
      type,
      before,
      signedAt: Date.now(),
    });
    try {
      const res = await fetch(`${workerUrl}/events/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (res.ok) return (await res.json()) as RestorePageResponse;
      const detail = await res.text().catch(() => "");
      lastError = new Error(
        `Server returned ${res.status} restoring ${type}: ${detail}`,
      );
      // Client errors (bad signature, malformed request) will not succeed on retry.
      if (res.status < 500 && res.status !== 429) throw lastError;
    } catch (error) {
      if (error === lastError) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
  }
  throw lastError ?? new Error(`Restoring ${type} failed`);
}

/**
 * Restores every server-held event of each type for this participant, newest
 * first, saving each page as it arrives so memory stays flat for long histories.
 * Saving is idempotent by event id, so a restore can be rerun after a failure.
 */
export async function restoreEventsFromServer(
  identity: RestoreIdentity,
  saveEvents: (events: CollectionEvent[]) => Promise<void>,
  options: {
    types?: CollectionEventType[];
    onProgress?: (p: RestoreProgress) => void;
  } = {},
): Promise<RestoreResult> {
  const { types = ALL_TYPES, onProgress } = options;
  const { workerUrl } = await getConfig();

  const countsByType: Record<CollectionEventType, number> = {
    cursor: 0,
    navigation: 0,
    viewport: 0,
    keyboard: 0,
    element: 0,
  };
  let imported = 0;

  for (const type of types) {
    let before: RestoreCursor | null = null;
    do {
      const page = await fetchRestorePage(workerUrl, identity, type, before);
      if (page.events.length > 0) await saveEvents(page.events);
      countsByType[type] += page.events.length;
      imported += page.events.length;
      onProgress?.({ type, total: imported });
      before = page.nextCursor;
    } while (before);
    console.log(`[Restore] ${type}: ${countsByType[type]} events`);
  }

  console.log(`[Restore] Total: ${imported} events restored`);
  return { imported, countsByType };
}
