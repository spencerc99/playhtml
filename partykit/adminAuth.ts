// ABOUTME: Authenticates administrative PartyServer and Worker requests.
// ABOUTME: Keeps shared token handling independent from room and control handlers.
import { secretMatches } from "./secretMatch";

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match ? match[1] : null;
}

// The Authorization header is the supported way to send the admin token. The
// `?token=` query parameter is a fallback; each use logs a warning (path only,
// never the token) so its remaining callers are visible in server logs.
function presentedToken(request: Request): string | null {
  // A header that is present decides the outcome, valid or not: a malformed
  // one is rejected instead of falling through to the query parameter.
  if (request.headers.has("Authorization")) return bearerToken(request);

  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("token");
  if (!fromQuery) return null;
  console.warn(
    `[AdminAuth] admin token sent as ?token= query parameter (deprecated, use Authorization header): ${request.method} ${url.pathname}`,
  );
  return fromQuery;
}

export async function getAdminAuthError(
  request: Request,
  adminToken: string | undefined,
): Promise<Response | null> {
  // Fail closed: a missing ADMIN_TOKEN (unset secret, misconfigured
  // deployment) must not silently authorize every admin request — these
  // routes can overwrite or destroy live room data.
  if (!adminToken) {
    return jsonError(
      "Admin endpoint misconfigured: ADMIN_TOKEN is not set",
      500,
    );
  }

  const token = presentedToken(request);
  if (!token || !(await secretMatches(token, adminToken))) {
    return jsonError("Unauthorized", 401);
  }

  return null;
}
