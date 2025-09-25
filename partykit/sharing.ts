import { deriveRoomId } from "@playhtml/common";

export type SharedElementPermissions = "read-only" | "read-write";

// --- Helper: compute source room id from domain and pathOrRoom
export function getSourceRoomId(domain: string, pathOrRoom: string): string {
  return deriveRoomId(domain, pathOrRoom);
}

// --- Helper: parse shared references array from connection/request URL
export function parseSharedReferencesFromUrl(url: string): Array<{
  domain: string;
  path: string;
  elementId: string;
}> {
  try {
    const u = new URL(url);
    const raw = u.searchParams.get("sharedReferences");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

// --- Helper: parse shared elements (declared on source) from URL params
export function parseSharedElementsFromUrl(url: string): Array<{
  elementId: string;
  permissions?: SharedElementPermissions;
}> {
  try {
    const u = new URL(url);
    const raw = u.searchParams.get("sharedElements");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}
