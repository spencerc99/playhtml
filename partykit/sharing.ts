// ABOUTME: Parses the shared-element declarations a client sends in its connection URL.
// ABOUTME: Drops malformed entries so untrusted query params cannot break room admission.
import { deriveRoomId } from "@playhtml/common";

export type SharedElementPermissions = "read-only" | "read-write";

// --- Helper: compute source room id from domain and pathOrRoom
export function getSourceRoomId(domain: string, pathOrRoom: string): string {
  return deriveRoomId(domain, pathOrRoom);
}

function parseJsonArrayParam(url: string, name: string): unknown[] {
  try {
    const raw = new URL(url).searchParams.get(name);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// --- Helper: parse shared references array from connection/request URL
export function parseSharedReferencesFromUrl(url: string): Array<{
  domain: string;
  path: string;
  elementId: string;
}> {
  return parseJsonArrayParam(url, "sharedReferences").flatMap((entry) =>
    isRecord(entry) &&
    typeof entry.domain === "string" &&
    typeof entry.path === "string" &&
    typeof entry.elementId === "string" &&
    entry.elementId !== ""
      ? [{ domain: entry.domain, path: entry.path, elementId: entry.elementId }]
      : []
  );
}

// --- Helper: parse shared elements (declared on source) from URL params
// `permissions` is the client's raw declaration; callers treat any value
// containing "read-only" as read-only and everything else as read-write.
export function parseSharedElementsFromUrl(url: string): Array<{
  elementId: string;
  permissions?: string;
}> {
  return parseJsonArrayParam(url, "sharedElements").flatMap((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.elementId !== "string" ||
      entry.elementId === ""
    ) {
      return [];
    }
    const permissions =
      typeof entry.permissions === "string" ? entry.permissions : undefined;
    return [{ elementId: entry.elementId, permissions }];
  });
}
