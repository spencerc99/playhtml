// ABOUTME: Verifies parsing of untrusted PartyServer bridge request bodies.
// ABOUTME: Rejects malformed collections before bridge handlers inspect them.
import { describe, expect, it } from "bun:test";
import {
  isApplySubtreesImmediateRequest,
  isExportPermissionsRequest,
  isSubscribeRequest,
} from "../request";

describe("bridge request parsing", () => {
  it("accepts well-formed bridge requests", () => {
    expect(
      isSubscribeRequest({
        action: "subscribe",
        consumerRoomId: "consumer",
        elementIds: ["shared"],
      })
    ).toBe(true);
    expect(
      isExportPermissionsRequest({
        action: "export-permissions",
        elementIds: ["shared"],
      })
    ).toBe(true);
    expect(
      isApplySubtreesImmediateRequest({
        action: "apply-subtrees-immediate",
        subtrees: { "can-toggle": { shared: { active: true } } },
        sender: "source",
        originKind: "source",
        resetEpoch: null,
      })
    ).toBe(true);
  });

  it("rejects malformed element-id and subtree collections", () => {
    expect(
      isSubscribeRequest({
        action: "subscribe",
        consumerRoomId: "consumer",
        elementIds: ["shared", 12],
      })
    ).toBe(false);
    expect(
      isExportPermissionsRequest({
        action: "export-permissions",
        elementIds: [null],
      })
    ).toBe(false);
    expect(
      isApplySubtreesImmediateRequest({
        action: "apply-subtrees-immediate",
        subtrees: null,
        sender: "source",
        originKind: "source",
      })
    ).toBe(false);
    expect(
      isApplySubtreesImmediateRequest({
        action: "apply-subtrees-immediate",
        subtrees: { "can-toggle": [] },
        sender: "source",
        originKind: "source",
      })
    ).toBe(false);
  });
});
