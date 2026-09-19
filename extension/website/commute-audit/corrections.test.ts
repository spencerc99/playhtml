// ABOUTME: Tests manual correction validation and candidate scoping.
// ABOUTME: Protects review ground truth from malformed imported files.
import { expect, test } from "vitest";
import { parseCorrections } from "./corrections";

test("retains valid corrections only for candidates in the dataset", () => {
  const correction = { judgment: "Promote", updatedAt: "2026-09-18T00:00:00Z" };
  expect(parseCorrections({ page: correction, missing: correction }, new Set(["page"]))).toEqual({ page: correction });
});
test("rejects null records and invalid labels before storing them", () => {
  expect(() => parseCorrections({ page: null }, new Set(["page"]))).toThrow();
  expect(() => parseCorrections({ page: { judgment: 12, updatedAt: "2026-09-18" } }, new Set(["page"]))).toThrow();
});
