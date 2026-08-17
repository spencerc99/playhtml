// ABOUTME: Tests per-collector collection mode capabilities and stored-value normalization.
// ABOUTME: Covers the scrap collector's local-only rule.

import { describe, expect, it } from "vitest";
import {
  collectionModeStorageKey,
  collectionModesFor,
  isCollectionMode,
  normalizeCollectionMode,
  supportsSharedCollection,
} from "../modes";

describe("collection modes", () => {
  it("offers all three modes to collectors that support sharing", () => {
    expect(collectionModesFor("cursor")).toEqual(["off", "local", "shared"]);
    expect(supportsSharedCollection("cursor")).toBe(true);
  });

  it("offers only off and local to the scrap collector", () => {
    expect(collectionModesFor("element")).toEqual(["off", "local"]);
    expect(supportsSharedCollection("element")).toBe(false);
  });

  it("keeps supported stored modes as-is", () => {
    expect(normalizeCollectionMode("cursor", "shared")).toBe("shared");
    expect(normalizeCollectionMode("cursor", "off")).toBe("off");
    expect(normalizeCollectionMode("element", "off")).toBe("off");
    expect(normalizeCollectionMode("element", "local")).toBe("local");
  });

  it("treats a stored shared scrap mode as local", () => {
    expect(normalizeCollectionMode("element", "shared")).toBe("local");
  });

  it("falls back to local for unset or unrecognized values", () => {
    expect(normalizeCollectionMode("cursor", undefined)).toBe("local");
    expect(normalizeCollectionMode("cursor", "bogus")).toBe("local");
    expect(isCollectionMode("bogus")).toBe(false);
    expect(isCollectionMode("shared")).toBe(true);
  });

  it("builds the storage key used for persisted modes", () => {
    expect(collectionModeStorageKey("element")).toBe("collection_mode_element");
  });
});
