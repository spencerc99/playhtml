// ABOUTME: Verifies that bridge apply requests require a registered relationship.
// ABOUTME: Prevents authenticated but unrelated rooms from replacing shared subtrees.
import { describe, expect, it } from "bun:test";
import { getBridgeApplyRelationship } from "../bridgeRequestPolicy";

describe("getBridgeApplyRelationship", () => {
  const relationships = {
    subscriberRoomIds: ["consumer-room"],
    sourceRoomIds: ["source-room"],
  };

  it("recognizes registered senders in the declared direction", () => {
    expect(
      getBridgeApplyRelationship({
        ...relationships,
        sender: "consumer-room",
        originKind: "consumer",
      })
    ).toBe("consumer");
    expect(
      getBridgeApplyRelationship({
        ...relationships,
        sender: "source-room",
        originKind: "source",
      })
    ).toBe("source");
  });

  it("rejects unknown senders and direction mismatches", () => {
    expect(
      getBridgeApplyRelationship({
        ...relationships,
        sender: "unknown-room",
        originKind: "source",
      })
    ).toBeNull();
    expect(
      getBridgeApplyRelationship({
        ...relationships,
        sender: "consumer-room",
        originKind: "source",
      })
    ).toBeNull();
  });
});
