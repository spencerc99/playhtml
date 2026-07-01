// ABOUTME: Verifies reset-epoch selection for shared-element bridge applies.
// ABOUTME: Keeps source-to-consumer and consumer-to-source reset guards aligned.
import { describe, expect, it } from "bun:test";

async function loadBridgeEpochPolicy(): Promise<{
  getBridgeApplyTargetResetEpoch: (input: {
    originKind: "source" | "consumer";
    consumerResetEpoch?: number | null;
    sourceResetEpoch?: number | null;
  }) => number | null;
}> {
  const module = await import("../bridgeEpochPolicy").catch(() => null);
  expect(module).not.toBeNull();
  return module as NonNullable<typeof module>;
}

describe("getBridgeApplyTargetResetEpoch", () => {
  it("uses the consumer reset epoch for source-to-consumer applies", async () => {
    const { getBridgeApplyTargetResetEpoch } = await loadBridgeEpochPolicy();

    expect(
      getBridgeApplyTargetResetEpoch({
        originKind: "source",
        consumerResetEpoch: 123,
        sourceResetEpoch: null,
      })
    ).toBe(123);
  });

  it("uses the source reset epoch for consumer-to-source applies", async () => {
    const { getBridgeApplyTargetResetEpoch } = await loadBridgeEpochPolicy();

    expect(
      getBridgeApplyTargetResetEpoch({
        originKind: "consumer",
        consumerResetEpoch: 123,
        sourceResetEpoch: 456,
      })
    ).toBe(456);
  });

  it("normalizes unknown target reset epochs to null", async () => {
    const { getBridgeApplyTargetResetEpoch } = await loadBridgeEpochPolicy();

    expect(
      getBridgeApplyTargetResetEpoch({
        originKind: "source",
      })
    ).toBeNull();
  });
});
