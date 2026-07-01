// ABOUTME: Filters bridge element ids by source-declared sharing permissions.
// ABOUTME: Keeps hydration and live fan-out from exposing unexported elements.

export type SharedElementPermissionMap = Record<
  string,
  "read-only" | "read-write"
>;

export function getPermittedSharedElementIds(
  requestedIds: string[],
  permissions: SharedElementPermissionMap
): string[] {
  return requestedIds.filter((elementId) => {
    return Boolean(permissions[elementId]);
  });
}
