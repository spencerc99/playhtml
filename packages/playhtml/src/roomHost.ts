// ABOUTME: Resolves the domain namespace used to identify PlayHTML rooms.
// ABOUTME: Preserves the embedding page's namespace inside srcdoc examples.

export function resolveRoomHost(
  location: Pick<Location, "host" | "protocol">,
  referrer: string,
): string {
  if (location.host || location.protocol !== "about:") return location.host;

  try {
    return new URL(referrer).host;
  } catch {
    return location.host;
  }
}
