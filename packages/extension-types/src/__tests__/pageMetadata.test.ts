// ABOUTME: Pins buildMetadataHash output so the stored metadata_hash format stays stable.
// ABOUTME: Expected values are FNV-1a over title + U+0001 + favicon URL.
import { describe, it, expect } from "vitest";
import { buildMetadataHash } from "../pageMetadata";

describe("buildMetadataHash", () => {
  it("produces stable hashes for fixed inputs", () => {
    expect(buildMetadataHash("foo", "bar.ico")).toBe("mh_3760a98c");
    expect(buildMetadataHash("", "")).toBe("mh_040c5b8c");
    expect(
      buildMetadataHash("GitHub", "https://github.com/favicon.ico"),
    ).toBe("mh_407056ca");
  });

  it("separates title and favicon so shifted boundaries do not collide", () => {
    expect(buildMetadataHash("foob", "ar.ico")).toBe("mh_9313baae");
    expect(buildMetadataHash("foob", "ar.ico")).not.toBe(
      buildMetadataHash("foo", "bar.ico"),
    );
  });
});
