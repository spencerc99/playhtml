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
  subtrees: Record<string, Record<string, any>>;
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
  subtrees?: Record<string, Record<string, any>>;
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

export function isSubscribeRequest(body: any): body is SubscribeRequest {
  return body?.action === "subscribe" && typeof body?.consumerRoomId === "string";
}

export function isExportPermissionsRequest(body: any): body is ExportPermissionsRequest {
  return body?.action === "export-permissions" && Array.isArray(body?.elementIds);
}

export function isApplySubtreesImmediateRequest(body: any): body is ApplySubtreesImmediateRequest {
  return (
    body?.action === "apply-subtrees-immediate" &&
    typeof body?.subtrees === "object" &&
    typeof body?.sender === "string" &&
    (body?.originKind === "consumer" || body?.originKind === "source")
  );
}
