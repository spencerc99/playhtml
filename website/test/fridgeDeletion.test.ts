// ABOUTME: Verifies deletion limits for visitors and the fridge owner.
// ABOUTME: Ensures only the owner's public key receives unlimited cleanup access.
import { describe, expect, test } from "bun:test";
import { canDeleteFridgeWord } from "../fridgeDeletion";

const FridgeOwnerPublicKey =
  "pk_04934976d2bc13f0a3a1e62a9124a3edb1e236b2eef64b618c646e25e3ade8ec77d2b56bedb39b78150d141be1b6b41a85b86010930941e02e82e96ce61af35d53";

describe("fridge word deletion", () => {
  test("limits public sessions to three deletions", () => {
    expect(canDeleteFridgeWord(2, "pk_someone_else")).toBe(true);
    expect(canDeleteFridgeWord(3, "pk_someone_else")).toBe(false);
    expect(canDeleteFridgeWord(3, undefined)).toBe(false);
  });

  test("does not limit the fridge owner", () => {
    expect(canDeleteFridgeWord(3, FridgeOwnerPublicKey)).toBe(true);
    expect(canDeleteFridgeWord(10_000, FridgeOwnerPublicKey)).toBe(true);
  });
});
