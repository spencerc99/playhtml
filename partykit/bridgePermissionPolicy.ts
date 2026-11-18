// ABOUTME: Parses, stores, and filters source-declared sharing permissions.
// ABOUTME: Keeps hydration and live fan-out from exposing unexported elements.

export type SharedElementPermission = "read-only" | "read-write";

export type SharedElementPermissionMap = Record<
  string,
  SharedElementPermission
>;

// Mirrors the client's reading of the `shared` attribute: any value containing
// "read-only", or exactly "ro", is read-only. Anything else, including a bare
// `shared` with no value, is read-write.
export function parseSharedElementPermission(
  value: unknown
): SharedElementPermission {
  if (typeof value !== "string") return "read-write";
  const normalized = value.trim().toLowerCase();
  return normalized.includes("read-only") || normalized === "ro"
    ? "read-only"
    : "read-write";
}

// Own-property lookup, so element ids such as "constructor" never resolve to
// Object.prototype members.
export function getSharedElementPermission(
  permissions: SharedElementPermissionMap,
  elementId: string
): SharedElementPermission | undefined {
  return Object.prototype.hasOwnProperty.call(permissions, elementId)
    ? permissions[elementId]
    : undefined;
}

export type SharedPermissionsUpdate = {
  permissions: SharedElementPermissionMap;
  changed: boolean;
  ignoredForCap: number;
};

function readDeclaration(
  entry: unknown
): { elementId: string; permission: SharedElementPermission } | null {
  if (!entry || typeof entry !== "object") return null;
  const { elementId, permissions } = entry as {
    elementId?: unknown;
    permissions?: unknown;
  };
  if (typeof elementId !== "string" || !elementId) return null;
  if (elementId === "__proto__") return null;
  // An omitted `permissions` means read-write; a present non-string one is
  // malformed rather than a reason to guess read-write.
  if (permissions !== undefined && typeof permissions !== "string") return null;
  return { elementId, permission: parseSharedElementPermission(permissions) };
}

function samePermissions(
  a: SharedElementPermissionMap,
  b: SharedElementPermissionMap
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every(
    (elementId) => getSharedElementPermission(b, elementId) === a[elementId]
  );
}

// Builds the map a connecting source page declares; it replaces the room's
// stored map. Malformed entries are skipped, and distinct ids beyond
// `maxEntries` are ignored. A declaration with no well-formed entry leaves the
// stored map as it is, the same as an empty declaration.
export function replaceSharedElementPermissions(
  existing: SharedElementPermissionMap,
  declared: unknown[],
  maxEntries: number
): SharedPermissionsUpdate {
  const permissions: SharedElementPermissionMap = {};
  let declaredCount = 0;
  let count = 0;
  let ignoredForCap = 0;
  for (const entry of declared) {
    const declaration = readDeclaration(entry);
    if (!declaration) continue;
    declaredCount += 1;
    const { elementId, permission } = declaration;
    const isNew =
      getSharedElementPermission(permissions, elementId) === undefined;
    if (isNew && count >= maxEntries) {
      ignoredForCap += 1;
      continue;
    }
    if (isNew) count += 1;
    permissions[elementId] = permission;
  }
  if (declaredCount === 0) {
    return { permissions: existing, changed: false, ignoredForCap: 0 };
  }
  return {
    permissions,
    changed: !samePermissions(existing, permissions),
    ignoredForCap,
  };
}

export type SharedElementRegistration = SharedPermissionsUpdate & {
  // True when the element's permission is stored after the update, so the
  // element may be fanned out to subscribers.
  accepted: boolean;
};

// Sets one runtime-registered element's permission on a copy of the stored
// map. A malformed declaration is refused, and so is a new id once the map
// holds `maxEntries` entries.
export function setSharedElementPermission(
  existing: SharedElementPermissionMap,
  declared: unknown,
  maxEntries: number
): SharedElementRegistration {
  const declaration = readDeclaration(declared);
  if (!declaration) {
    return {
      permissions: existing,
      changed: false,
      ignoredForCap: 0,
      accepted: false,
    };
  }
  const { elementId, permission } = declaration;
  const current = getSharedElementPermission(existing, elementId);
  if (current === permission) {
    return {
      permissions: existing,
      changed: false,
      ignoredForCap: 0,
      accepted: true,
    };
  }
  if (current === undefined && Object.keys(existing).length >= maxEntries) {
    return {
      permissions: existing,
      changed: false,
      ignoredForCap: 1,
      accepted: false,
    };
  }
  return {
    permissions: { ...existing, [elementId]: permission },
    changed: true,
    ignoredForCap: 0,
    accepted: true,
  };
}

export function getPermittedSharedElementIds(
  requestedIds: string[],
  permissions: SharedElementPermissionMap
): string[] {
  return requestedIds.filter((elementId) => {
    return getSharedElementPermission(permissions, elementId) !== undefined;
  });
}
