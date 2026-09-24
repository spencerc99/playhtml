// ABOUTME: Exercises the installation office's window launch and reload controls.
// ABOUTME: Verifies production links, launch feedback, confirmation, and errors.

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

  it("opens the Ars layout from the machine links", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    Object.defineProperties(window.screen, {
      availLeft: { configurable: true, value: 0 },
      availTop: { configurable: true, value: 0 },
      availWidth: { configurable: true, value: 1440 },
      availHeight: { configurable: true, value: 900 },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open all in Ars layout" }));
    });

    expect(open).toHaveBeenCalledTimes(9);
    expect(screen.getByRole("status").textContent).toContain("Allow pop-ups");
    open.mockClear();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Open" })[0]);
    });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][2]).toContain("popup=yes,noopener,left=");
    open.mockRestore();
  });

  it("shows all nine production links and warns on a non-production host", () => {
    expect(screen.getByRole("note").textContent).toContain("controls and links target production");
    expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(9);
    const links = screen.getAllByTitle(/^https:\/\/wewere\.online\//);
    expect(links).toHaveLength(9);
    expect(screen.getByRole("link", { name: "Installation" }).getAttribute("aria-current")).toBe("page");
  });

  it("tells the operator how to set up the browsing machine", () => {
    expect(
      screen.getByRole("heading", { name: "Installation mode" }).textContent,
    ).toBe("Installation mode");
    expect(document.body.textContent).toContain("Cmd/Ctrl+Shift+8");
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
