// ABOUTME: Tests the shared admin-token gate used by PartyKit and Worker admin routes.
// ABOUTME: A missing ADMIN_TOKEN must fail closed, not silently authorize every request.
import { describe, expect, it } from "bun:test";
import { getAdminAuthError } from "../adminAuth";

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe("getAdminAuthError", () => {
  it("rejects with 500 when ADMIN_TOKEN is unset, rather than authorizing the request", () => {
    const res = getAdminAuthError(request("https://api.example.com/admin/hard-reset"), undefined);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(500);
  });

  it("rejects with 500 when ADMIN_TOKEN is an empty string", () => {
    const res = getAdminAuthError(request("https://api.example.com/admin/hard-reset"), "");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(500);
  });

  it("rejects requests with no token when ADMIN_TOKEN is configured", () => {
    const res = getAdminAuthError(
      request("https://api.example.com/admin/hard-reset"),
      "secret",
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("rejects requests with the wrong token", () => {
    const res = getAdminAuthError(
      request("https://api.example.com/admin/hard-reset?token=wrong"),
      "secret",
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("authorizes a request with the correct token via query param", () => {
    const res = getAdminAuthError(
      request("https://api.example.com/admin/hard-reset?token=secret"),
      "secret",
    );
    expect(res).toBeNull();
  });

  it("authorizes a request with the correct token via Authorization header", () => {
    const res = getAdminAuthError(
      request("https://api.example.com/admin/hard-reset", {
        Authorization: "Bearer secret",
      }),
      "secret",
    );
    expect(res).toBeNull();
  });
});
