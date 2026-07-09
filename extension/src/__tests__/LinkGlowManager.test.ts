// ABOUTME: Tests Wikipedia link glow tracking against current article link shapes.
// ABOUTME: Verifies same-origin article links receive patina even when hrefs are absolute.

import type { PageDataChannel } from "@playhtml/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LinkGlowManager, type PageLinkData } from "../features/LinkGlowManager";

function setLocation(href: string) {
  const url = new URL(href);
  document.head.innerHTML = `<base href="${url.href}">`;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      href: url.href,
      pathname: url.pathname,
      origin: url.origin,
      hostname: url.hostname,
      hash: url.hash,
    },
  });
}

class MemoryPageDataChannel<T> implements PageDataChannel<T> {
  private listeners = new Set<(data: T) => void>();

  constructor(private data: T) {}

  getData(): T {
    return structuredClone(this.data);
  }

  setData(next: T | ((draft: T) => void)): void {
    if (typeof next === "function") {
      const draft = structuredClone(this.data);
      const mutate = next as (draft: T) => void;
      mutate(draft);
      this.data = draft;
    } else {
      this.data = structuredClone(next);
    }
    for (const listener of this.listeners) listener(this.getData());
  }

  onUpdate(callback: (data: T) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  destroy(): void {
    this.listeners.clear();
  }
}

class VisibleIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin = "0px";
  readonly thresholds: ReadonlyArray<number> = [];

  constructor(private callback: IntersectionObserverCallback) {}

  observe(target: Element): void {
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this,
    );
  }

  disconnect(): void {}
  unobserve(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function createPageDataWith(data: PageLinkData) {
  return <T,>(_name: string, _defaultValue: T): PageDataChannel<T> =>
    new MemoryPageDataChannel(data as T);
}

describe("LinkGlowManager", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    setLocation("https://en.wikipedia.org/wiki/Main_Page");
  });

  it("applies glow to protocol-relative same-origin article links", () => {
    setLocation("https://en.wikipedia.org/wiki/Main_Page");
    vi.stubGlobal("IntersectionObserver", VisibleIntersectionObserver);
    document.body.innerHTML = `
      <div id="mw-content-text">
        <div class="mw-parser-output">
          <h1>
            Welcome to
            <a id="home-link" href="//en.wikipedia.org/wiki/Wikipedia">Wikipedia</a>
          </h1>
          <a id="offsite-link" href="//example.com/wiki/Wikipedia">Other</a>
          <a id="namespace-link" href="//en.wikipedia.org/wiki/Help:Contents">Help</a>
        </div>
      </div>
    `;

    const manager = new LinkGlowManager(
      "#4a9a8a",
      createPageDataWith({
        links: {
          "/wiki/Wikipedia": {
            count: 107,
            recentColors: ["#ff0000", "#00ff00"],
          },
          "/wiki/Help:Contents": {
            count: 107,
            recentColors: ["#0000ff"],
          },
        },
        totalClicks: 0,
      }),
    );

    manager.init();

    expect(
      document
        .querySelector("#home-link")
        ?.classList.value.split(/\s+/)
        .some((className) => className.startsWith("plh-glow-")),
    ).toBe(true);
    expect(
      document
        .querySelector("#namespace-link")
        ?.classList.value.split(/\s+/)
        .some((className) => className.startsWith("plh-glow-")),
    ).toBe(false);
    expect(
      document
        .querySelector("#offsite-link")
        ?.classList.value.split(/\s+/)
        .some((className) => className.startsWith("plh-glow-")),
    ).toBe(false);

    manager.destroy();
  });
});
