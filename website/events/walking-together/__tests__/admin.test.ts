// ABOUTME: Tests the admin gate — only an allowlisted pid grants admin.

import { describe, it, expect } from "vitest";
import { isAdmin } from "../admin";

const ADMIN_PID =
  "pk_04934976d2bc13f0a3a1e62a9124a3edb1e236b2eef64b618c646e25e3ade8ec77d2b56bedb39b78150d141be1b6b41a85b86010930941e02e82e96ce61af35d53";

describe("isAdmin", () => {
  it("is true for the admin pid", () => {
    expect(isAdmin(ADMIN_PID)).toBe(true);
  });

  it("is false for any other pid", () => {
    expect(isAdmin("pk_04deadbeef")).toBe(false);
    expect(isAdmin(ADMIN_PID.toUpperCase())).toBe(false);
  });

  it("is false for a missing pid", () => {
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin("")).toBe(false);
  });
});
