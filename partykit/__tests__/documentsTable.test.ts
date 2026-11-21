// ABOUTME: Verifies which Supabase table each deployment may store room documents in.
// ABOUTME: Covers the missing-setting failure and staging and production refusing each other's table.

import { describe, expect, test } from "bun:test";
import {
  getDeploymentForHostname,
  getDocumentsTableError,
  parseDocumentsTable,
} from "../documentsTable";

describe("parseDocumentsTable", () => {
  test("accepts the two known tables", () => {
    expect(parseDocumentsTable("documents")).toBe("documents");
    expect(parseDocumentsTable("documents_staging")).toBe("documents_staging");
  });

  test("throws when the setting is missing or unknown", () => {
    expect(() => parseDocumentsTable(undefined)).toThrow(
      "DOCUMENTS_TABLE must be one of documents, documents_staging, got undefined.",
    );
    expect(() => parseDocumentsTable("")).toThrow("DOCUMENTS_TABLE must be");
    expect(() => parseDocumentsTable("collection_events")).toThrow(
      'got "collection_events"',
    );
  });
});

describe("getDeploymentForHostname", () => {
  test("recognises staging, production, and local hosts", () => {
    expect(getDeploymentForHostname("api-staging.playhtml.fun")).toBe("staging");
    expect(
      getDeploymentForHostname("playhtml-staging.example.workers.dev"),
    ).toBe("staging");
    expect(getDeploymentForHostname("api.playhtml.fun")).toBe("production");
    expect(getDeploymentForHostname("playhtml.example.workers.dev")).toBe(
      "production",
    );
    expect(getDeploymentForHostname("localhost")).toBe("local");
    expect(getDeploymentForHostname("127.0.0.1")).toBe("local");
  });
});

describe("getDocumentsTableError", () => {
  test("allows each deployment its own table", () => {
    expect(
      getDocumentsTableError("api-staging.playhtml.fun", "documents_staging"),
    ).toBeNull();
    expect(getDocumentsTableError("api.playhtml.fun", "documents")).toBeNull();
  });

  test("refuses staging on the production table", () => {
    expect(getDocumentsTableError("api-staging.playhtml.fun", "documents")).toBe(
      "The staging server must store room documents in documents_staging, but DOCUMENTS_TABLE is documents.",
    );
    expect(
      getDocumentsTableError(
        "playhtml-staging.example.workers.dev",
        "documents",
      ),
    ).toContain("staging server must store");
  });

  test("refuses production on the staging table", () => {
    expect(getDocumentsTableError("api.playhtml.fun", "documents_staging")).toBe(
      "The production server must store room documents in documents, but DOCUMENTS_TABLE is documents_staging.",
    );
  });

  test("refuses any host when the setting is missing", () => {
    expect(getDocumentsTableError("localhost", undefined)).toContain(
      "DOCUMENTS_TABLE must be one of",
    );
    expect(getDocumentsTableError("api.playhtml.fun", undefined)).toContain(
      "DOCUMENTS_TABLE must be one of",
    );
  });

  test("lets a local server use either table", () => {
    expect(getDocumentsTableError("localhost", "documents")).toBeNull();
    expect(getDocumentsTableError("localhost", "documents_staging")).toBeNull();
  });
});
