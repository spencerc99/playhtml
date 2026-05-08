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
