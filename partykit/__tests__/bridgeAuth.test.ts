// ABOUTME: Verifies authentication for internal room-to-room bridge requests.
// ABOUTME: Ensures public callers cannot forge bridge mutations.
import { describe, expect, it } from "bun:test";
import {
  BRIDGE_SECRET_HEADER,
  createBridgeRequest,
  getBridgeAuthFailure,
} from "../bridgeAuth";

const SECRET = "test-bridge-secret";

describe("bridge request authentication", () => {
  it("fails closed when the deployment secret is unavailable", async () => {
    const request = new Request("http://internal/apply", {
      headers: { [BRIDGE_SECRET_HEADER]: SECRET },
    });

    expect((await getBridgeAuthFailure(request, undefined))?.status).toBe(503);
    expect((await getBridgeAuthFailure(request, ""))?.status).toBe(503);
    expect(() => createBridgeRequest("/apply", {}, undefined)).toThrow(
      "PARTYKIT_BRIDGE_SECRET is not configured",
    );
  });

  it("rejects missing and incorrect credentials", async () => {
    expect(
      (await getBridgeAuthFailure(new Request("http://internal/apply"), SECRET))
        ?.status,
    ).toBe(401);
    for (const credential of ["wrong", "", SECRET.slice(0, -1), `${SECRET}x`]) {
      expect(
        (
          await getBridgeAuthFailure(
            new Request("http://internal/apply", {
              headers: { [BRIDGE_SECRET_HEADER]: credential },
            }),
            SECRET,
          )
        )?.status,
      ).toBe(403);
    }
  });

  it("attaches the configured credential to outbound requests", async () => {
    const request = createBridgeRequest(
      "/subscribe",
      { action: "subscribe" },
      SECRET,
    );

    expect(request.headers.get(BRIDGE_SECRET_HEADER)).toBe(SECRET);
    expect(await getBridgeAuthFailure(request, SECRET)).toBeNull();
  });
});
