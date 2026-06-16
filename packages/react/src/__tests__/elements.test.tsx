// ABOUTME: Tests for React can-* element wrappers.
// ABOUTME: Verifies that built-in capability updateElement functions are called alongside React state updates.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import "@testing-library/dom";
import { CanPlayElement } from "../index";
import { CanMoveElement } from "../elements";
import playhtml from "../playhtml-singleton";
import { TagType } from "@playhtml/common";
import type { ElementAwarenessEventHandlerData } from "@playhtml/common";

describe("CanPlayElement with built-in capabilities", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("composes capability updateElement with React state updates for CanMove", () => {
    const capabilityUpdateElement = vi.fn();

    const { container } = render(
      <CanPlayElement
        // @ts-ignore
        tagInfo={[TagType.CanMove]}
        defaultData={{ x: 0, y: 0 }}
        defaultLocalData={{ startMouseX: 0, startMouseY: 0 }}
        updateElement={capabilityUpdateElement}
        resetShortcut="shiftKey"
      >
        {({ data }) => <div id="move-child">{JSON.stringify(data)}</div>}
      </CanPlayElement>,
    );

    const element = container.querySelector("[can-move]") as HTMLElement;
    expect(element).toBeTruthy();

    // The composed updateElement on the DOM element should call the capability's version
    const composedUpdateElement = (element as any).updateElement;
    expect(composedUpdateElement).toBeDefined();

    const mockHandlerData = {
      data: { x: 10, y: 20 },
      awareness: [],
      awarenessByStableId: new Map(),
      myAwareness: undefined,
      element,
      localData: { startMouseX: 0, startMouseY: 0 },
      setData: vi.fn(),
      setLocalData: vi.fn(),
      setMyAwareness: vi.fn(),
    } as unknown as ElementAwarenessEventHandlerData;

    composedUpdateElement(mockHandlerData);

    expect(capabilityUpdateElement).toHaveBeenCalledWith(mockHandlerData);
  });

  it("composes capability updateElementAwareness with React state updates", () => {
    const capabilityUpdateElementAwareness = vi.fn();

    const { container } = render(
      <CanPlayElement
        // @ts-ignore
        tagInfo={[TagType.CanHover]}
        defaultData={{}}
        myDefaultAwareness={{ hover: false }}
        updateElement={() => {}}
        updateElementAwareness={capabilityUpdateElementAwareness}
      >
        {({ data }) => <div id="hover-child">{JSON.stringify(data)}</div>}
      </CanPlayElement>,
    );

    const element = container.querySelector("[can-hover]") as HTMLElement;
    expect(element).toBeTruthy();

    const composedUpdateElementAwareness = (element as any)
      .updateElementAwareness;
    expect(composedUpdateElementAwareness).toBeDefined();

    const mockHandlerData = {
      data: {},
      awareness: [{ hover: true }],
      awarenessByStableId: new Map(),
      myAwareness: { hover: true },
      element,
      localData: undefined,
      setData: vi.fn(),
      setLocalData: vi.fn(),
      setMyAwareness: vi.fn(),
    } as unknown as ElementAwarenessEventHandlerData;

    composedUpdateElementAwareness(mockHandlerData);

    expect(capabilityUpdateElementAwareness).toHaveBeenCalledWith(
      mockHandlerData,
    );
  });

  it("does not skip non-update element props from capability", () => {
    const capabilityOnDrag = vi.fn();

    const { container } = render(
      <CanPlayElement
        // @ts-ignore
        tagInfo={[TagType.CanMove]}
        defaultData={{ x: 0, y: 0 }}
        defaultLocalData={{ startMouseX: 0, startMouseY: 0 }}
        updateElement={() => {}}
        onDrag={capabilityOnDrag}
        resetShortcut="shiftKey"
      >
        {({ data }) => <div id="move-child">{JSON.stringify(data)}</div>}
      </CanPlayElement>,
    );

    const element = container.querySelector("[can-move]") as HTMLElement;
    expect(element).toBeTruthy();

    // onDrag should still be set on the element
    expect((element as any).onDrag).toBe(capabilityOnDrag);
  });

  it("does not remove the element when synced data updates React state", () => {
    const setupSpy = vi
      .spyOn(playhtml, "setupPlayElement")
      .mockImplementation(() => {});
    const removeSpy = vi
      .spyOn(playhtml, "removePlayElement")
      .mockImplementation(() => {});

    const { container } = render(
      <CanPlayElement
        // @ts-ignore
        tagInfo={[TagType.CanMove]}
        defaultData={{ x: 0, y: 0 }}
        defaultLocalData={{ startMouseX: 0, startMouseY: 0 }}
        updateElement={() => {}}
      >
        {({ data }) => <div id="stable-child">{JSON.stringify(data)}</div>}
      </CanPlayElement>,
    );

    const element = container.querySelector("[can-move]") as HTMLElement;
    expect(element).toBeTruthy();
    expect(setupSpy).toHaveBeenCalledTimes(1);

    act(() => {
      (element as any).updateElement({
        data: { x: 10, y: 5 },
        awareness: [],
        awarenessByStableId: new Map(),
        myAwareness: undefined,
        element,
        localData: { startMouseX: 0, startMouseY: 0 },
        setData: vi.fn(),
        setLocalData: vi.fn(),
        setMyAwareness: vi.fn(),
      });
    });

    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("refreshes element handler props without removing the element", () => {
    const observedOnDragCallbacks: Array<unknown> = [];
    const setupSpy = vi
      .spyOn(playhtml, "setupPlayElement")
      .mockImplementation((element) => {
        observedOnDragCallbacks.push((element as any).onDrag);
      });
    const removeSpy = vi
      .spyOn(playhtml, "removePlayElement")
      .mockImplementation(() => {});
    const firstOnDrag = vi.fn();
    const secondOnDrag = vi.fn();

    const { container, rerender } = render(
      <CanPlayElement
        // @ts-ignore
        tagInfo={[TagType.CanMove]}
        defaultData={{ x: 0, y: 0 }}
        defaultLocalData={{ startMouseX: 0, startMouseY: 0 }}
        updateElement={() => {}}
        onDrag={firstOnDrag}
      >
        {({ data }) => <div id="prop-update-child">{JSON.stringify(data)}</div>}
      </CanPlayElement>,
    );

    const element = container.querySelector("[can-move]") as HTMLElement;
    expect((element as any).onDrag).toBe(firstOnDrag);

    rerender(
      <CanPlayElement
        // @ts-ignore
        tagInfo={[TagType.CanMove]}
        defaultData={{ x: 0, y: 0 }}
        defaultLocalData={{ startMouseX: 0, startMouseY: 0 }}
        updateElement={() => {}}
        onDrag={secondOnDrag}
      >
        {({ data }) => <div id="prop-update-child">{JSON.stringify(data)}</div>}
      </CanPlayElement>,
    );

    expect((element as any).onDrag).toBe(secondOnDrag);
    expect(setupSpy).toHaveBeenCalledTimes(2);
    expect(observedOnDragCallbacks).toEqual([firstOnDrag, secondOnDrag]);
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("removes the mounted element on unmount", () => {
    const setupSpy = vi
      .spyOn(playhtml, "setupPlayElement")
      .mockImplementation(() => {});
    const removeSpy = vi
      .spyOn(playhtml, "removePlayElement")
      .mockImplementation(() => {});

    const { container, unmount } = render(
      <CanPlayElement
        // @ts-ignore
        tagInfo={[TagType.CanMove]}
        defaultData={{ x: 0, y: 0 }}
        defaultLocalData={{ startMouseX: 0, startMouseY: 0 }}
        updateElement={() => {}}
      >
        {({ data }) => <div id="cleanup-child">{JSON.stringify(data)}</div>}
      </CanPlayElement>,
    );

    const element = container.querySelector("[can-move]") as HTMLElement;
    expect(element).toBeTruthy();

    unmount();

    expect(setupSpy).toHaveBeenCalledWith(element, {
      ignoreIfAlreadySetup: true,
    });
    expect(removeSpy).toHaveBeenCalledWith(element);
  });

  it("CanMoveElement forwards bounds props as can-move-bounds* DOM attributes", () => {
    const { container } = render(
      <CanMoveElement
        standalone
        bounds="arena"
        boundsMinVisible={0.5}
        boundsMinVisiblePx={40}
      >
        <div id="bounded-child">drag me</div>
      </CanMoveElement>,
    );
    const element = container.querySelector("#bounded-child") as HTMLElement;
    expect(element).toBeTruthy();
    expect(element.getAttribute("can-move-bounds")).toBe("arena");
    expect(element.getAttribute("can-move-bounds-min-visible")).toBe("0.5");
    expect(element.getAttribute("can-move-bounds-min-visible-px")).toBe("40");
  });

  it("CanMoveElement omits bounds attributes when props are not set", () => {
    const { container } = render(
      <CanMoveElement standalone>
        <div id="unbounded-child">drag me</div>
      </CanMoveElement>,
    );
    const element = container.querySelector("#unbounded-child") as HTMLElement;
    expect(element).toBeTruthy();
    expect(element.hasAttribute("can-move-bounds")).toBe(false);
    expect(element.hasAttribute("can-move-bounds-min-visible")).toBe(false);
    expect(element.hasAttribute("can-move-bounds-min-visible-px")).toBe(false);
  });

  it("CanMoveElement accepts selector form for bounds (e.g. `#id`)", () => {
    const { container } = render(
      <CanMoveElement standalone bounds="#fridge">
        <div id="selector-bounded-child">drag me</div>
      </CanMoveElement>,
    );
    const element = container.querySelector(
      "#selector-bounded-child",
    ) as HTMLElement;
    expect(element.getAttribute("can-move-bounds")).toBe("#fridge");
  });

  it("works without a capability updateElement (pure can-play)", () => {
    const { container } = render(
      <CanPlayElement defaultData={{ count: 0 }}>
        {({ data }) => (
          <div id="play-child">{JSON.stringify(data)}</div>
        )}
      </CanPlayElement>,
    );

    const element = container.querySelector("[can-play]") as HTMLElement;
    expect(element).toBeTruthy();

    // The composed updateElement should still work (just updates React state)
    const composedUpdateElement = (element as any).updateElement;
    expect(composedUpdateElement).toBeDefined();

    // Should not throw when no capability updateElement exists
    expect(() =>
      composedUpdateElement({
        data: { count: 1 },
        awareness: [],
        awarenessByStableId: new Map(),
        myAwareness: undefined,
        element,
        localData: undefined,
        setData: vi.fn(),
        setLocalData: vi.fn(),
        setMyAwareness: vi.fn(),
      }),
    ).not.toThrow();
  });
});
