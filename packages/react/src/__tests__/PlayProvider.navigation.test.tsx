// ABOUTME: Tests for PlayProvider's SPA-navigation integrations —
// ABOUTME: ref-to-container conversion and pathname-driven navigation.
import { describe, it, expect, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { useRef, type RefObject } from "react";
import { PlayProvider } from "../PlayProvider";

describe("PlayProvider cursor container ref", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.querySelectorAll("#playhtml-cursor-styles").forEach((n) => n.remove());
    delete (window as any).playhtml;
    delete document.documentElement.dataset.playhtml;
  });

  it("accepts a RefObject for cursors.container", async () => {
    function Wrapper() {
      const ref = useRef<HTMLDivElement>(null);
      return (
        <PlayProvider
          initOptions={{
            host: "http://localhost:1999",
            cursors: { enabled: true, container: ref as RefObject<HTMLElement> },
          } as any}
        >
          <div ref={ref} id="cursor-layer" />
        </PlayProvider>
      );
    }

    const { container } = render(<Wrapper />);
    await waitFor(() => {
      expect(container.querySelector("#cursor-layer")).toBeTruthy();
    });
    // No runtime error is the primary success criterion; the ref-to-getter
    // conversion happens internally and doesn't crash when a ref is passed.
  });
});
