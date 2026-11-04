// ABOUTME: Authenticates administrative PartyServer and Worker requests.
// ABOUTME: Keeps shared token handling independent from room and control handlers.
export function getAdminAuthError(
  request: Request,
  adminToken: string | undefined
): Response | null {
  // Fail closed: a missing ADMIN_TOKEN (unset secret, misconfigured
  // deployment) must not silently authorize every admin request — these
  // routes can overwrite or destroy live room data.
  if (!adminToken) {
    return new Response(
      JSON.stringify({ error: "Admin endpoint misconfigured: ADMIN_TOKEN is not set" }),
      {
        status: 500,
        headers: {
          "content-type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

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
