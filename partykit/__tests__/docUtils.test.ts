// ABOUTME: Verifies Y.Doc snapshot relationship helpers with real encoded updates.
// ABOUTME: Covers compaction safety checks that depend on live-vs-persisted history.
import { describe, expect, it } from "bun:test";
import {
  documentContainsSnapshot,
  encodeDocToBase64,
  jsonToDoc,
  replaceDocState,
} from "../docUtils";

describe("documentContainsSnapshot", () => {
  it("recognizes a live document that contains the persisted snapshot", () => {
    const liveDoc = jsonToDoc({
      "can-play": {
        "week-attendance": {
          attendees: [{ pid: "a", name: "Ada" }],
        },
      },
    });
    const persistedBase64 = encodeDocToBase64(liveDoc);

    replaceDocState(liveDoc, {
      "can-play": {
        "week-attendance": {
          attendees: [
            { pid: "a", name: "Ada" },
            { pid: "b", name: "Ben" },
          ],
        },
      },
    });

    expect(
      documentContainsSnapshot(encodeDocToBase64(liveDoc), persistedBase64)
    ).toBe(true);
  });

  it("rejects a stale live document that is missing persisted updates", () => {
    const liveDoc = jsonToDoc({
      "can-play": {
        "week-attendance": {
          attendees: [{ pid: "a", name: "Ada" }],
        },
      },
    });
    const persistedDoc = jsonToDoc({
      "can-play": {
        "week-attendance": {
          attendees: [
            { pid: "a", name: "Ada" },
            { pid: "b", name: "Ben" },
          ],
        },
      },
    });

    expect(
      documentContainsSnapshot(
        encodeDocToBase64(liveDoc),
        encodeDocToBase64(persistedDoc)
      )
    ).toBe(false);
  });
});
