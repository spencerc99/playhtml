// ABOUTME: Tests catalog API errors used by the curation desk authentication flow.
// ABOUTME: Preserves HTTP status details so rejected admin keys can be handled safely.

import { describe, expect, it } from "vitest";
import {
  CatalogApiError,
  isCatalogUnauthorized,
  readCatalogResponse,
  resolveCatalogWorkerUrl,
} from "./catalogApi";

describe("catalog authentication", () => {
  it("preserves an unauthorized response as a typed error", async () => {
    await expect(
      readCatalogResponse(new Response("Unauthorized", { status: 401 })),
    ).rejects.toEqual(new CatalogApiError("Unauthorized", 401));
  });

  it("recognizes only catalog 401 errors as rejected credentials", () => {
    expect(isCatalogUnauthorized(new CatalogApiError("Unauthorized", 401)))
      .toBe(true);
    expect(isCatalogUnauthorized(new CatalogApiError("Unavailable", 503)))
      .toBe(false);
    expect(isCatalogUnauthorized(new Error("Unauthorized"))).toBe(false);
  });
});

describe("catalog Worker routing", () => {
  it("uses the local Worker for a localhost curation desk", () => {
    expect(resolveCatalogWorkerUrl("127.0.0.1", undefined, "https://worker.example"))
      .toBe("http://127.0.0.1:8787");
    expect(resolveCatalogWorkerUrl("localhost", undefined, "https://worker.example"))
      .toBe("http://127.0.0.1:8787");
  });

  it("keeps the configured or deployed Worker elsewhere", () => {
    expect(resolveCatalogWorkerUrl(
      "127.0.0.1",
      "http://localhost:8799/",
      "https://worker.example",
    )).toBe("http://localhost:8799");
    expect(resolveCatalogWorkerUrl(
      "wewere.online",
      undefined,
      "https://worker.example/",
    )).toBe("https://worker.example");
  });
});
