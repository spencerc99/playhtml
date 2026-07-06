// ABOUTME: Verifies orphaned Yjs awareness ID detection for PartyServer cleanup.
// ABOUTME: Keeps stale presence pruning scoped to IDs without live owners.

import { describe, expect, it } from "bun:test";
import {
  getConnectionAwarenessIds,
  getOrphanedAwarenessIds,
  Y_PARTYSERVER_AWARENESS_IDS_STATE_KEY,
} from "../awarenessCleanup";

describe("awareness cleanup", () => {
  it("reads numeric awareness IDs from connection state", () => {
    expect(
      getConnectionAwarenessIds({
        state: {
          [Y_PARTYSERVER_AWARENESS_IDS_STATE_KEY]: [12, "bad", 19, 2.5],
        },
      }),
    ).toEqual([12, 19]);
  });

  it("returns awareness IDs not claimed by any live connection", () => {
    const orphaned = getOrphanedAwarenessIds(
      [1, 2, 3, 4],
      [
        { state: { [Y_PARTYSERVER_AWARENESS_IDS_STATE_KEY]: [1, 4] } },
        { state: { [Y_PARTYSERVER_AWARENESS_IDS_STATE_KEY]: [3] } },
      ],
    );

    expect(orphaned).toEqual([2]);
  });
});
