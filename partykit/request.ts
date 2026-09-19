// ABOUTME: Defines typed internal HTTP request and response payloads for PartyServer.
// ABOUTME: Keeps bridge, subscription, and permission request guards in one place.

export interface SubscribeRequest {
  action: "subscribe";
  consumerRoomId: string;
  elementIds?: string[];
  consumerResetEpoch?: number | null;
}

export interface ExportPermissionsRequest {
  action: "export-permissions";
  elementIds: string[];
}

export interface ApplySubtreesImmediateRequest {
  action: "apply-subtrees-immediate";
  subtrees: Record<string, Record<string, unknown>>;
  sender: string;
  originKind: "consumer" | "source";
  resetEpoch?: number | null;
}

export type PartyKitRequest =
  | SubscribeRequest
  | ExportPermissionsRequest
  | ApplySubtreesImmediateRequest;

export interface SubscribeResponse {
  ok: true;
  subscribed: true;
  elementIds: string[];
  sourceResetEpoch?: number | null;
  subtrees?: Record<string, Record<string, unknown>>;
}

export interface ExportPermissionsResponse {
  permissions: Record<string, "read-only" | "read-write">;
}

export interface ApplySubtreesResponse {
  ok: true;
  // Whether the receiving room actually applied the subtrees. False when the
  // apply was rejected (e.g. stale reset epoch) or skipped (transient mode).
  // The sender uses this to back off a misconfigured bridge pair instead of
  // re-sending on every flush. Optional so older callers reading only `ok`
  // keep working; absence is treated as applied.
  applied?: boolean;
}

export interface GenericErrorResponse {
  error: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalResetEpoch(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

export function isSubscribeRequest(body: unknown): body is SubscribeRequest {
  return (
    isRecord(body) &&
    body.action === "subscribe" &&
    typeof body.consumerRoomId === "string" &&
    (body.elementIds === undefined || isStringArray(body.elementIds)) &&
    isOptionalResetEpoch(body.consumerResetEpoch)
  );
}

export function isExportPermissionsRequest(
  body: unknown
): body is ExportPermissionsRequest {
  return (
    isRecord(body) &&
    body.action === "export-permissions" &&
    isStringArray(body.elementIds)
  );
}

export function isApplySubtreesImmediateRequest(
  body: unknown
): body is ApplySubtreesImmediateRequest {
  return (
    isRecord(body) &&
    body.action === "apply-subtrees-immediate" &&
    isRecord(body.subtrees) &&
    Object.values(body.subtrees).every(isRecord) &&
    typeof body.sender === "string" &&
    (body.originKind === "consumer" || body.originKind === "source") &&
    isOptionalResetEpoch(body.resetEpoch)
  );
}
