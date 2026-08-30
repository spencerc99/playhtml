// ABOUTME: Verifies feedback from the WWO access-control admin form.
// ABOUTME: Covers invalid public IDs without making a Worker request.

// @vitest-environment jsdom

import { fireEvent, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@movement/config", () => ({ WORKER_URL: "https://worker.example" }));

const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
  features: [],
  cohorts: [{
    id: "closed-beta",
    name: "Closed beta",
    grantsAllUnreleased: true,
    featureIds: [],
  }],
  people: [],
  requests: [],
}), { status: 200 }));

describe("WWO admin access form", () => {
  beforeAll(async () => {
    document.body.innerHTML = '<div id="root"></div>';
    sessionStorage.setItem("wwo-admin-token", "secret");
    vi.stubGlobal("fetch", fetchMock);
    await import("./admin");
    await screen.findByRole("heading", { name: "Add person" });
  });

  it("shows invalid public ID feedback next to the form", () => {
    const publicIdInput = screen.getByRole("textbox", { name: "Public ID" });
    fireEvent.change(publicIdInput, { target: { value: "pk_short" } });
    fireEvent.click(screen.getByRole("button", { name: "Add person" }));

    expect(screen.getByRole("alert").textContent).toBe("Enter a valid public ID");
    expect(publicIdInput.getAttribute("aria-invalid")).toBe("true");
    expect(publicIdInput.getAttribute("aria-describedby")).toBe("add-person-error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
