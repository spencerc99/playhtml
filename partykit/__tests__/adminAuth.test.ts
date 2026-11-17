// ABOUTME: Tests the shared admin-token gate used by PartyKit and Worker admin routes.
// ABOUTME: Covers header and query-param tokens, fail-closed config, and constant-time matching.
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { getAdminAuthError } from "../adminAuth";
import { bytesEqualConstantTime, secretMatches } from "../secretMatch";

const ADMIN_URL = "https://api.example.com/admin/hard-reset";

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe("getAdminAuthError", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("rejects with 500 when ADMIN_TOKEN is unset, rather than authorizing the request", async () => {
    const res = await getAdminAuthError(
      request(ADMIN_URL, { Authorization: "Bearer secret" }),
      undefined,
    );
    expect(res?.status).toBe(500);
  });

  it("rejects with 500 when ADMIN_TOKEN is an empty string, in either form", async () => {
    expect(
      (
        await getAdminAuthError(
          request(ADMIN_URL, { Authorization: "Bearer " }),
          "",
        )
      )?.status,
    ).toBe(500);
    expect(
      (await getAdminAuthError(request(`${ADMIN_URL}?token=`), ""))?.status,
    ).toBe(500);
    expect(
      (await getAdminAuthError(request(`${ADMIN_URL}?token=anything`), ""))
        ?.status,
    ).toBe(500);
  });

  it("rejects requests with no token when ADMIN_TOKEN is configured", async () => {
    const res = await getAdminAuthError(request(ADMIN_URL), "secret");
    expect(res?.status).toBe(401);
  });

  it("authorizes a request with the correct token via Authorization header without warning", async () => {
    const res = await getAdminAuthError(
      request(ADMIN_URL, { Authorization: "Bearer secret" }),
      "secret",
    );
    expect(res).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("rejects the wrong token via Authorization header", async () => {
    const res = await getAdminAuthError(
      request(ADMIN_URL, { Authorization: "Bearer wrong!" }),
      "secret",
    );
    expect(res?.status).toBe(401);
  });

  it("rejects an Authorization header without the Bearer scheme", async () => {
    const res = await getAdminAuthError(
      request(ADMIN_URL, { Authorization: "secret" }),
      "secret",
    );
    expect(res?.status).toBe(401);
  });

  it("still authorizes the correct token via query param and warns once without the token", async () => {
    const token = "query-secret-value";
    const res = await getAdminAuthError(
      request(`${ADMIN_URL}?token=${token}`),
      token,
    );
    expect(res).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = warnSpy.mock.calls[0].join(" ");
    expect(logged).toContain("/admin/hard-reset");
    expect(logged).not.toContain(token);
  });

  it("rejects the wrong token via query param", async () => {
    const res = await getAdminAuthError(
      request(`${ADMIN_URL}?token=wrong!`),
      "secret",
    );
    expect(res?.status).toBe(401);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0].join(" ")).not.toContain("wrong!");
  });

  it("rejects tokens that differ only in length", async () => {
    for (const token of ["secre", "secrets", "s", "secret".repeat(50)]) {
      expect(
        (
          await getAdminAuthError(
            request(ADMIN_URL, { Authorization: `Bearer ${token}` }),
            "secret",
          )
        )?.status,
      ).toBe(401);
      expect(
        (
          await getAdminAuthError(
            request(`${ADMIN_URL}?token=${encodeURIComponent(token)}`),
            "secret",
          )
        )?.status,
      ).toBe(401);
    }
  });

  it("prefers the Authorization header when both forms are present", async () => {
    const res = await getAdminAuthError(
      request(`${ADMIN_URL}?token=secret`, { Authorization: "Bearer wrong" }),
      "secret",
    );
    expect(res?.status).toBe(401);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("secretMatches", () => {
  it("matches equal secrets and rejects different ones of any length", async () => {
    expect(await secretMatches("abc", "abc")).toBe(true);
    expect(await secretMatches("abd", "abc")).toBe(false);
    expect(await secretMatches("ab", "abc")).toBe(false);
    expect(await secretMatches("abcd", "abc")).toBe(false);
    expect(await secretMatches("", "abc")).toBe(false);
  });
});

describe("bytesEqualConstantTime", () => {
  it("compares every byte and rejects mismatched lengths", () => {
    expect(
      bytesEqualConstantTime(
        new Uint8Array([1, 2, 3]),
        new Uint8Array([1, 2, 3]),
      ),
    ).toBe(true);
    expect(
      bytesEqualConstantTime(
        new Uint8Array([1, 2, 3]),
        new Uint8Array([1, 2, 4]),
      ),
    ).toBe(false);
    expect(
      bytesEqualConstantTime(
        new Uint8Array([9, 2, 3]),
        new Uint8Array([1, 2, 3]),
      ),
    ).toBe(false);
    expect(
      bytesEqualConstantTime(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])),
    ).toBe(false);
  });
});
