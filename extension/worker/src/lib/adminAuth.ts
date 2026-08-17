// ABOUTME: Authenticates WWO Worker administration requests.
// ABOUTME: Keeps browser admin routes on the same bearer-token boundary.

const ADMIN_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
};

export function getAdminAuthError(
  request: Request,
  adminKey: string,
): Response | null {
  const authorization = request.headers.get('Authorization');
  if (!adminKey || authorization !== `Bearer ${adminKey}`) {
    return new Response('Unauthorized', {
      status: 401,
      headers: ADMIN_CORS_HEADERS,
    });
  }

  return null;
}
