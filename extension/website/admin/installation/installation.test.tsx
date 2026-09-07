// ABOUTME: Exercises the installation office status and reload interaction.
// ABOUTME: Verifies production links, confirmation, progress, success, and errors.

// @vitest-environment jsdom

import { fireEvent, screen } from "@testing-library/react";
import { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const getControl = vi.fn();
const reloadScreens = vi.fn();

vi.mock("./installationControlApi", () => ({
  getCurrentInstallationControl: getControl,
  reloadInstallationScreens: reloadScreens,
}));

describe("installation office", () => {
  beforeAll(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '<div id="root"></div>';
    sessionStorage.setItem("wwo-admin-token", "admin-secret");
    getControl.mockResolvedValue({ generation: 4, updatedAt: "2026-09-06 12:00:00" });
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    vi.stubGlobal("confirm", vi.fn());
    await act(async () => {
      await import("./installation");
    });
    await screen.findByText("4");
  });

  beforeEach(() => {
    reloadScreens.mockReset();
    vi.mocked(window.confirm).mockReset();
  });

  it("shows all nine production links and warns on a non-production host", () => {
    expect(screen.getByRole("note").textContent).toContain("controls and links target production");
    expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(9);
    const links = screen.getAllByTitle(/^https:\/\/wewere\.online\//);
    expect(links).toHaveLength(9);
    expect(screen.getByRole("link", { name: "Installation" }).getAttribute("aria-current")).toBe("page");
  });

  it("does nothing when the production reload is not confirmed", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reload all production screens" }));
    });
    expect(reloadScreens).not.toHaveBeenCalled();
  });

  it("shows pending and success states for a confirmed reload", async () => {
    vi.mocked(window.confirm).mockReturnValue(true);
    let finish: ((value: { generation: number; updatedAt: string }) => void) | undefined;
    reloadScreens.mockReturnValue(new Promise((resolve) => { finish = resolve; }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reload all production screens" }));
    });
    expect((screen.getByRole("button", { name: "Triggering…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(reloadScreens).toHaveBeenCalledWith("admin-secret");

    await act(async () => finish?.({ generation: 5, updatedAt: "2026-09-06 12:01:00" }));
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("within about one minute");
  });

  it("shows a failed reload request", async () => {
    vi.mocked(window.confirm).mockReturnValue(true);
    reloadScreens.mockRejectedValue(new Error("Unauthorized"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reload all production screens" }));
    });
    expect(screen.getByRole("alert").textContent).toBe("Unauthorized");
  });
});
