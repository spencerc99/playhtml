// ABOUTME: Calibrates the Internet Commute against the server clock.
// ABOUTME: Estimates the offset between local time and the server's timestamp sample.

export function estimateServerTimeOffset(
  serverTimestamp: number,
  requestStartedAt: number,
  responseReceivedAt: number,
): number {
  if (
    !Number.isFinite(serverTimestamp) ||
    !Number.isFinite(requestStartedAt) ||
    !Number.isFinite(responseReceivedAt) ||
    responseReceivedAt < requestStartedAt
  ) {
    throw new Error("Internet Commute requires a valid server timing sample");
  }

  const requestMidpoint =
    requestStartedAt + (responseReceivedAt - requestStartedAt) / 2;
  return serverTimestamp - requestMidpoint;
}
