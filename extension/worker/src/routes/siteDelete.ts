// ABOUTME: POST /events/delete-site — deletes one batch of a participant's own events from one site.
// ABOUTME: The request must be signed with the participant's identity key, whose public half is the pid.

import { createSupabaseClient, type Env } from "../lib/supabase";
import { createIpRateLimiter } from "../lib/ipRateLimit";
import {
  ECDSA_SIGN_ALGORITHM,
  hexToBytes,
} from "../../../src/utils/restoreRequest";
import {
  SITE_DELETE_BATCH_SIZE,
  SITE_DELETE_SIGNATURE_MAX_AGE_MS,
  siteDeleteSigningMessage,
  type SiteDeleteRequest,
  type SiteDeleteResponse,
} from "../../../src/utils/siteDeleteRequest";

/** Uncompressed P-256 public key: 0x04 prefix, then 64 bytes of x and y. */
const PUBLIC_KEY_PID_PATTERN = /^pk_04[0-9a-f]{128}$/;
/** A normalized host as the extension stores it: lowercase labels, at least one dot. */
const HOST_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const rateLimiter = createIpRateLimiter(120, 60_000);

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function parseSiteDeleteRequest(
  body: unknown,
): SiteDeleteRequest | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const { pid, host, signedAt, signature } = value;
  if (typeof pid !== "string" || !PUBLIC_KEY_PID_PATTERN.test(pid)) return null;
  if (typeof host !== "string" || host.length > 253 || !HOST_PATTERN.test(host))
    return null;
  if (typeof signedAt !== "number" || !Number.isFinite(signedAt)) return null;
  if (typeof signature !== "string" || !/^[0-9a-f]{128}$/.test(signature))
    return null;
  return { pid, host, signedAt, signature };
}

export async function verifySiteDeleteSignature(
  request: SiteDeleteRequest,
  now: number,
): Promise<boolean> {
  if (Math.abs(now - request.signedAt) > SITE_DELETE_SIGNATURE_MAX_AGE_MS)
    return false;
  const publicKey = await crypto.subtle.importKey(
    "raw",
    hexToBytes(request.pid.slice("pk_".length)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    ECDSA_SIGN_ALGORITHM,
    publicKey,
    hexToBytes(request.signature),
    new TextEncoder().encode(siteDeleteSigningMessage(request)),
  );
}

export async function handleSiteDelete(
  request: Request,
  env: Env,
): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (rateLimiter.isLimited(ip, Date.now())) {
    return jsonResponse({ error: "Too many requests" }, 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  const deleteRequest = parseSiteDeleteRequest(body);
  if (!deleteRequest)
    return jsonResponse({ error: "Invalid delete request" }, 400);

  let verified = false;
  try {
    verified = await verifySiteDeleteSignature(deleteRequest, Date.now());
  } catch (error) {
    console.error("Site delete signature check failed:", error);
  }
  if (!verified) return jsonResponse({ error: "Invalid signature" }, 401);

  const supabase = createSupabaseClient(env);
  const { data, error } = await supabase.rpc("delete_participant_site_events", {
    p_participant_id: deleteRequest.pid,
    p_host: deleteRequest.host,
    p_limit: SITE_DELETE_BATCH_SIZE,
  });
  if (error) {
    console.error("Site delete query error:", error);
    return jsonResponse(
      { error: "Failed to delete events", details: error.message },
      500,
    );
  }

  const deleted = typeof data === "number" ? data : Number(data ?? 0);
  const response: SiteDeleteResponse = {
    deleted,
    more: deleted >= SITE_DELETE_BATCH_SIZE,
  };
  return jsonResponse(response, 200);
}
