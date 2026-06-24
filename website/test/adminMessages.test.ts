// ABOUTME: Tests admin console messages for disruptive saved-data operations.
// ABOUTME: Ensures operators see how many active clients a database reset will affect.
import { describe, expect, test } from "bun:test";
import {
  formatAdminResetSuccess,
  formatAdminResetWarning,
} from "../adminMessages";

describe("admin reset messages", () => {
  test("warns with the active client count before an admin reset", () => {
    expect(
      formatAdminResetWarning({
        action: "Save edited database data",
        activeConnections: 4,
        detail: "This will make the edited database data authoritative.",
      }),
    ).toContain("briefly disconnect 4 active clients");
  });

  test("uses singular client copy", () => {
    expect(
      formatAdminResetWarning({
        action: "Remove selected records",
        activeConnections: 1,
      }),
    ).toContain("briefly disconnect 1 active client");
  });

  test("summarizes the committed reset result", () => {
    expect(
      formatAdminResetSuccess({
        action: "Saved edited database data",
        closedConnections: 3,
        documentSize: 120,
      }),
    ).toContain("Reset 3 active clients");
  });
});
