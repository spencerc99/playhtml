// ABOUTME: Authenticates administrative PartyServer and Worker requests.
// ABOUTME: Keeps shared token handling independent from room and control handlers.
export function getAdminAuthError(
  request: Request,
  adminToken: string | undefined
): Response | null {
  if (!adminToken) return null;

  const url = new URL(request.url);
  const token =
    url.searchParams.get("token") ||
    request.headers.get("Authorization")?.replace("Bearer ", "");

  if (!token || token !== adminToken) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  return null;
}
