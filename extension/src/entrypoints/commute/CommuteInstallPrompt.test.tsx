// ABOUTME: Verifies commute installation prompts and rotating station posters.
// ABOUTME: Covers extension detection, poster content, and overlay behavior.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXTENSION_INSTALL_ATTRIBUTE,
  markExtensionInstalled,
} from "../../utils/extensionInstallMarker";
import { CommuteInstallPrompt } from "./CommuteInstallPrompt";
import { CommuteStationPoster } from "./CommuteStationPoster";

async function renderPrompt(): Promise<{
  container: HTMLDivElement;
  root: Root;
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<CommuteInstallPrompt />);
  });

  return { container, root };
}

describe("CommuteInstallPrompt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.removeAttribute(EXTENSION_INSTALL_ATTRIBUTE);
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("appears after the extension detection window", async () => {
    const { container, root } = await renderPrompt();

    expect(container.querySelector(".commute-install-cta")).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(container.textContent).toContain("internet transit pass");
    expect(container.textContent).toContain("join the ride");
    expect(container.textContent).toContain("get the extension");
    expect(container.textContent).not.toContain("add your stops");
    const link = container.querySelector("a");
    expect(link?.href).toBe("https://wewere.online/");
    expect(link?.target).toBe("_blank");
    act(() => root.unmount());
  });

  it("stays hidden when the extension is already installed", async () => {
    markExtensionInstalled(document.documentElement);
    const { container, root } = await renderPrompt();

    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(container.querySelector(".commute-install-cta")).toBeNull();
    act(() => root.unmount());
  });

  it("disappears when the content script arrives after the page", async () => {
    const { container, root } = await renderPrompt();
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(container.querySelector(".commute-install-cta")).not.toBeNull();

    await act(async () => {
      markExtensionInstalled(document.documentElement);
      await Promise.resolve();
    });

    expect(container.querySelector(".commute-install-cta")).toBeNull();
    act(() => root.unmount());
  });

  it("opens and dismisses the station poster overlay", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<CommuteStationPoster domain="ad-0.test" stationVisible />);
    });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    const poster = container.querySelector<HTMLButtonElement>(
      ".station-install-poster",
    );
    expect(poster?.getAttribute("aria-label")).toBe(
      "Open the internet transit pass poster",
    );
    act(() => poster?.click());

    const dialog = document.querySelector<HTMLElement>(
      ".commute-poster-dialog",
    );
    expect(dialog?.textContent).toContain("internet transit pass");
    expect(dialog?.textContent).toContain("join the ride");
    expect(dialog?.textContent).toContain(
      "this line runs on the stops of riders like you — install we were online and the places you visit become stations on everyone's commute.",
    );
    expect(dialog?.querySelector("a")?.href).toBe("https://wewere.online/");

    act(() =>
      dialog
        ?.querySelector<HTMLButtonElement>(".commute-poster-dialog__close")
        ?.click(),
    );
    expect(document.querySelector(".commute-poster-dialog")).toBeNull();

    act(() => poster?.click());
    const backdrop = document.querySelector<HTMLElement>(
      ".commute-poster-backdrop",
    );
    act(() => {
      backdrop?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(document.querySelector(".commute-poster-dialog")).toBeNull();

    act(() => poster?.click());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.querySelector(".commute-poster-dialog")).toBeNull();
    act(() => root.unmount());
  });

  it("keeps the clicked transit-pass ad open when the extension marker arrives", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<CommuteStationPoster domain="ad-0.test" stationVisible />);
    });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    act(() =>
      container
        .querySelector<HTMLButtonElement>(".station-install-poster")
        ?.click(),
    );
    expect(
      document.querySelector<HTMLElement>(".commute-poster-dialog")
        ?.textContent,
    ).toContain("internet transit pass");

    await act(async () => {
      markExtensionInstalled(document.documentElement);
      await Promise.resolve();
    });

    expect(
      container
        .querySelector<HTMLButtonElement>(".station-install-poster")
        ?.getAttribute("aria-label"),
    ).toBe(
      "Open the poster: come learn to build seats for strangers — example sites included",
    );
    const dialog = document.querySelector<HTMLElement>(
      ".commute-poster-dialog",
    );
    expect(dialog?.textContent).toContain("internet transit pass");
    expect(dialog?.textContent).toContain("join the ride");
    expect(dialog?.querySelector("a")?.href).toBe("https://wewere.online/");
    act(() => root.unmount());
  });

  it("removes the poster trigger offscreen but keeps the clicked ad across a domain change", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <CommuteStationPoster domain="ad-1.test" stationVisible={false} />,
      );
    });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(container.querySelector(".station-install-poster")).toBeNull();

    act(() => {
      root.render(<CommuteStationPoster domain="ad-1.test" stationVisible />);
    });
    const poster = container.querySelector<HTMLButtonElement>(
      ".station-install-poster",
    );
    act(() => poster?.click());
    expect(
      document.querySelector<HTMLElement>(".commute-poster-dialog")
        ?.textContent,
    ).toContain("the internet is alive");

    act(() => {
      root.render(
        <CommuteStationPoster domain="ad-5.test" stationVisible={false} />,
      );
    });
    expect(container.querySelector(".station-install-poster")).toBeNull();
    const dialog = document.querySelector<HTMLElement>(
      ".commute-poster-dialog",
    );
    expect(dialog?.textContent).toContain("the internet is alive");
    expect(dialog?.textContent).not.toContain(
      "this train was built with it — make a site like this one",
    );
    expect(dialog?.querySelector("a")?.href).toBe(
      "https://news.spencer.place/p/alive-internet-theory",
    );

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.querySelector(".commute-poster-dialog")).toBeNull();
    act(() => root.unmount());
  });

  it("shows the artwork and accessible name for every eligible campaign poster", async () => {
    const cases = [
      {
        domain: "ad-5.test",
        headline: "this train was built with it — make a site like this one",
        artwork: "ad-playhtml.jpg",
      },
      {
        domain: "ad-3.test",
        headline:
          "come learn to build seats for strangers — example sites included",
        artwork: "ad-class.jpg",
      },
      {
        domain: "ad-4.test",
        headline: "the internet has no benches",
        artwork: "ad-benches.jpg",
      },
      {
        domain: "ad-1.test",
        headline: "the internet is alive",
        artwork: "ad-alive.jpg",
      },
      {
        domain: "ad-0.test",
        headline: "join the ride",
        artwork: null,
      },
    ];

    for (const posterCase of cases) {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      act(() => {
        root.render(
          <CommuteStationPoster domain={posterCase.domain} stationVisible />,
        );
      });
      await act(async () => {
        vi.advanceTimersByTime(800);
      });

      const poster = container.querySelector<HTMLButtonElement>(
        ".station-install-poster",
      );
      expect(poster?.getAttribute("aria-label")).toBe(
        posterCase.artwork === null
          ? "Open the internet transit pass poster"
          : `Open the poster: ${posterCase.headline}`,
      );
      const artwork = poster?.querySelector("img");
      if (posterCase.artwork === null) {
        expect(artwork).toBeNull();
      } else {
        expect(artwork?.getAttribute("src")).toContain(posterCase.artwork);
      }

      act(() => root.unmount());
      container.remove();
    }
  });

  it("renders campaign posters for installed extension users", async () => {
    markExtensionInstalled(document.documentElement);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<CommuteStationPoster domain="ad-1.test" stationVisible />);
    });

    const poster = container.querySelector<HTMLButtonElement>(
      ".station-install-poster",
    );
    expect(poster?.getAttribute("aria-label")).toBe(
      "Open the poster: this train was built with it — make a site like this one",
    );
    expect(poster?.querySelector("img")?.getAttribute("src")).toContain(
      "ad-playhtml.jpg",
    );
    act(() => root.unmount());
  });

  it("renders the approved copy and links for different campaign ads", async () => {
    markExtensionInstalled(document.documentElement);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<CommuteStationPoster domain="ad-1.test" stationVisible />);
    });
    act(() =>
      container
        .querySelector<HTMLButtonElement>(".station-install-poster")
        ?.click(),
    );
    let dialog = document.querySelector<HTMLElement>(".commute-poster-dialog");
    expect(dialog?.textContent).toContain(
      "this train was built with it — make a site like this one",
    );
    expect(dialog?.textContent).toContain("can-move");
    expect(dialog?.querySelector("a")?.href).toBe("https://playhtml.fun/");

    act(() =>
      dialog
        ?.querySelector<HTMLButtonElement>(".commute-poster-dialog__close")
        ?.click(),
    );
    act(() => {
      root.render(<CommuteStationPoster domain="ad-2.test" stationVisible />);
    });
    act(() =>
      container
        .querySelector<HTMLButtonElement>(".station-install-poster")
        ?.click(),
    );
    dialog = document.querySelector<HTMLElement>(".commute-poster-dialog");
    expect(dialog?.textContent).toContain("they say the internet is dead");
    expect(dialog?.textContent).toContain("the internet is alive");
    expect(dialog?.textContent).toContain(
      "every stop on this line is a page somebody real just visited — you're riding with them now",
    );
    expect(dialog?.querySelector("a")?.href).toBe(
      "https://news.spencer.place/p/alive-internet-theory",
    );
    expect(dialog?.querySelector("a")?.target).toBe("_blank");
    expect(dialog?.querySelector("a")?.rel).toBe("noreferrer");

    act(() => root.unmount());
  });
});
