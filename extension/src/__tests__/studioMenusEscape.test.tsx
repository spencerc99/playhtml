// ABOUTME: Tests that Escape closes the studio's export menu and share popover without reaching the studio.
// ABOUTME: Also that a signed link whose maker cannot be read says it is not updated.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportMenu } from "../entrypoints/scraps/ExportMenu";
import { PublishSection } from "../entrypoints/scraps/PublishSection";
import { ShareButton } from "../entrypoints/scraps/ShareButton";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
/** Stands where the studio's own keydown listener sits: on the window, bubbling. */
const studioKeys = vi.fn();

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  studioKeys.mockClear();
  window.addEventListener("keydown", studioKeys);
});

afterEach(() => {
  window.removeEventListener("keydown", studioKeys);
  if (root) {
    const mounted = root;
    root = null;
    act(() => mounted.unmount());
  }
  container?.remove();
  container = null;
});

function pressEscape() {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
}

function opener(label: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(label),
  );
  if (!found) throw new Error(`no button reading ${label}`);
  return found;
}

describe("Escape in a studio menu", () => {
  it("closes the export menu and goes no further", () => {
    act(() =>
      root!.render(
        <ExportMenu
          hasPieces
          running={null}
          onPicture={() => {}}
          onVideo={() => {}}
          onFile={() => {}}
        />,
      ),
    );
    act(() => opener("export").click());
    expect(opener("export").getAttribute("aria-expanded")).toBe("true");

    pressEscape();
    expect(opener("export").getAttribute("aria-expanded")).toBe("false");
    expect(studioKeys).not.toHaveBeenCalled();

    // With the menu closed, Escape belongs to the studio again.
    pressEscape();
    expect(studioKeys).toHaveBeenCalledTimes(1);
  });

  it("closes the share popover and goes no further", () => {
    act(() =>
      root!.render(
        <ShareButton
          share={undefined}
          canShare
          record={() => ({
            title: "",
            createdAt: 1,
            frame: { width: 640, height: 426 },
            paper: { color: "#faf7f2", grain: true },
            pieces: [],
          })}
          workerUrl="http://localhost:8787"
          materialFor={() => {
            throw new Error("nothing is shared in this test");
          }}
          onShared={() => {}}
          onUnshared={() => {}}
          onProblem={() => {}}
        />,
      ),
    );
    act(() => opener("share to view").click());
    expect(opener("share to view").getAttribute("aria-expanded")).toBe("true");

    pressEscape();
    expect(opener("share to view").getAttribute("aria-expanded")).toBe("false");
    expect(studioKeys).not.toHaveBeenCalled();
  });
});

describe("a signed link whose maker cannot be read", () => {
  it("says it is not updated rather than up to date", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onProblem = vi.fn();
    await act(async () =>
      root!.render(
        <PublishSection
          share={{
            id: "pub_1",
            deleteToken: "token",
            sharedAt: 1,
            url: "https://wewere.online/c/pub_1",
            signature: { color: "#4a9a8a", name: "someone" },
            // What the link showed before the collage changed.
            contentKey: "an older collage",
          }}
          canShare
          record={() => ({
            title: "moved on",
            createdAt: 1,
            frame: { width: 640, height: 426 },
            paper: { color: "#faf7f2", grain: true },
            pieces: [],
          })}
          workerUrl="http://localhost:8787"
          materialFor={() => {
            throw new Error("nothing is uploaded in this test");
          }}
          onShared={() => {}}
          onUnshared={() => {}}
          onProblem={onProblem}
          signer={{
            load: async () => {
              throw new Error("the identity store is locked");
            },
            saveName: async () => {},
          }}
        />,
      ),
    );
    await act(async () => {});

    expect(
      container!.querySelector(".collage-share__foot")?.textContent,
    ).toContain("not updated");
    expect(onProblem).toHaveBeenCalledTimes(1);
    expect(onProblem).toHaveBeenCalledWith(
      "could not update the link — the identity store is locked",
    );
    expect(warn).toHaveBeenCalledWith(
      "[collage publish] could not read who is sharing:",
      expect.objectContaining({ message: "the identity store is locked" }),
    );
    warn.mockRestore();
  });
});
