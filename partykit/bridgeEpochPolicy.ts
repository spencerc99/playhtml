// ABOUTME: Selects reset epochs for cross-room shared-element bridge requests.
// ABOUTME: Ensures each receiver validates bridge data against its own epoch.

export type BridgeApplyOriginKind = "source" | "consumer";

type BridgeApplyTargetResetEpochInput = {
  originKind: BridgeApplyOriginKind;
  consumerResetEpoch?: number | null;
  sourceResetEpoch?: number | null;
};

function normalizeResetEpoch(resetEpoch: number | null | undefined): number | null {
  return typeof resetEpoch === "number" && Number.isFinite(resetEpoch)
    ? resetEpoch
    : null;
}

export function getBridgeApplyTargetResetEpoch({
  originKind,
  consumerResetEpoch,
  sourceResetEpoch,
}: BridgeApplyTargetResetEpochInput): number | null {
  return originKind === "source"
    ? normalizeResetEpoch(consumerResetEpoch)
    : normalizeResetEpoch(sourceResetEpoch);
}
