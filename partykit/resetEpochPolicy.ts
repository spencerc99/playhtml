// ABOUTME: Provides pure reset-epoch parsing and staleness helpers for PartyServer.
// ABOUTME: Keeps reset boundary decisions consistent for client, bridge, and socket checks.
export function parseClientResetEpoch(value: string | null): number | null {
  if (value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isResetEpochStale(
  candidateEpoch: number | null,
  serverEpoch: number | null
): boolean {
  return (
    serverEpoch !== null &&
    (candidateEpoch === null || candidateEpoch < serverEpoch)
  );
}

export type AutosaveResetEpochDecision =
  | { kind: "save" }
  | { kind: "skip"; reason: string }
  | { kind: "promote-server-epoch"; resetEpoch: number };

export function getAutosaveResetEpochDecision(
  docResetEpoch: number | null,
  serverResetEpoch: number | null
): AutosaveResetEpochDecision {
  if (isResetEpochStale(docResetEpoch, serverResetEpoch)) {
    const reason =
      docResetEpoch === null
        ? `doc reset epoch missing while server epoch=${serverResetEpoch}`
        : `doc reset epoch ${docResetEpoch} < server epoch ${serverResetEpoch}`;
    return { kind: "skip", reason };
  }

  if (
    docResetEpoch !== null &&
    (serverResetEpoch === null || docResetEpoch > serverResetEpoch)
  ) {
    return { kind: "promote-server-epoch", resetEpoch: docResetEpoch };
  }

  return { kind: "save" };
}
