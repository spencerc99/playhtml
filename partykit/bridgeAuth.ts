// ABOUTME: Authenticates PartyServer room-to-room HTTP bridge requests.
// ABOUTME: Builds bridge requests with the deployment's shared credential.

export const BRIDGE_SECRET_HEADER = "x-playhtml-bridge-secret";

function requireBridgeSecret(configuredSecret: string | undefined): string {
  if (typeof configuredSecret !== "string" || configuredSecret.length === 0) {
    throw new Error("PARTYKIT_BRIDGE_SECRET is not configured");
  }
  return configuredSecret;
}

export function getBridgeAuthFailure(
  request: Request,
  configuredSecret: string | undefined
): Response | null {
  if (typeof configuredSecret !== "string" || configuredSecret.length === 0) {
    return new Response("Bridge authentication unavailable", { status: 503 });
  }

  const credential = request.headers.get(BRIDGE_SECRET_HEADER);
  if (credential === null) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (credential !== configuredSecret) {
    return new Response("Forbidden", { status: 403 });
  }
  return null;
}

export function createBridgeRequest(
  path: string,
  body: unknown,
  configuredSecret: string | undefined
): Request {
  const credential = requireBridgeSecret(configuredSecret);
  return new Request(`http://internal${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [BRIDGE_SECRET_HEADER]: credential,
    },
    body: JSON.stringify(body),
  });
}
