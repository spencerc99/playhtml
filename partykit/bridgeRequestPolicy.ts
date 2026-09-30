// ABOUTME: Resolves the registered direction of incoming room bridge mutations.
// ABOUTME: Rejects senders that have no matching source or consumer relationship.
import type { BridgeDirection } from "./bridgeHealth";

type BridgeApplyRelationshipOptions = {
  sender: string;
  originKind: BridgeDirection;
  subscriberRoomIds: readonly string[];
  sourceRoomIds: readonly string[];
};

export function getBridgeApplyRelationship({
  sender,
  originKind,
  subscriberRoomIds,
  sourceRoomIds,
}: BridgeApplyRelationshipOptions): BridgeDirection | null {
  if (originKind === "consumer" && subscriberRoomIds.includes(sender)) {
    return "consumer";
  }
  if (originKind === "source" && sourceRoomIds.includes(sender)) {
    return "source";
  }
  return null;
}
