// ABOUTME: Tests for PlayProvider's SPA-navigation integrations —
// ABOUTME: ref-to-container conversion and pathname-driven navigation.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { useRef, useState, type RefObject } from "react";
import { PlayProvider } from "../PlayProvider";
import playhtml from "../playhtml-singleton";

describe("PlayProvider cursor container ref", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.querySelectorAll("#playhtml-cursor-styles").forEach((n) => n.remove());
    delete (window as any).playhtml;
    delete document.documentElement.dataset.playhtml;
  });

  it("converts a RefObject to a getter for cursors.container", async () => {
    const initSpy = vi.spyOn(playhtml, "init").mockResolvedValue(undefined as any);

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
      expect(initSpy).toHaveBeenCalled();
    });

    const callArgs = initSpy.mock.calls[0]?.[0] as any;
    expect(typeof callArgs?.cursors?.container).toBe("function");
    // Invoking the getter should return the rendered element.
    const resolved = callArgs.cursors.container();
    expect(resolved).toBe(container.querySelector("#cursor-layer"));

    initSpy.mockRestore();
  });
});

describe("PlayProvider pathname prop", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete (window as any).playhtml;
    delete document.documentElement.dataset.playhtml;
  });

  it("calls handleNavigation when pathname changes", async () => {
    const spy = vi.spyOn(playhtml, "handleNavigation").mockResolvedValue(undefined);

    function Wrapper() {
      const [path, setPath] = useState("/a");
      return (
        <>
          <button onClick={() => setPath("/b")}>nav</button>
          <PlayProvider
            initOptions={{ host: "http://localhost:1999" } as any}
            pathname={path}
          />
        </>
      );
    }

    const { getByText } = render(<Wrapper />);
    spy.mockClear(); // ignore any mount-time calls

    getByText("nav").click();
    await waitFor(() => {
      expect(spy).toHaveBeenCalled();
    });

    spy.mockRestore();
  });

  it("does not call handleNavigation on mount", async () => {
    const spy = vi.spyOn(playhtml, "handleNavigation").mockResolvedValue(undefined);
    spy.mockClear();

    render(
      <PlayProvider
        initOptions={{ host: "http://localhost:1999" } as any}
        pathname="/initial"
      />,
    );

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
