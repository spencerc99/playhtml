export interface SubscribeRequest {
  action: "subscribe";
  consumerRoomId: string;
  elementIds?: string[];
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
}

export interface ExportPermissionsResponse {
  permissions: Record<string, "read-only" | "read-write">;
}

export interface ApplySubtreesResponse {
  ok: true;
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
