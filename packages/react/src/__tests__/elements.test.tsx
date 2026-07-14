// ABOUTME: Tests for React can-* element wrappers.
// ABOUTME: Verifies that built-in capability updateElement functions are called alongside React state updates.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import "@testing-library/dom";
import { CanPlayElement, withSharedState } from "../index";
import { CanMoveElement, CanToggleElement } from "../elements";
import playhtml from "../playhtml-singleton";
import { TagType } from "playhtml";
import type { ElementAwarenessEventHandlerData } from "playhtml";
import { ReactiveOrb } from "../../examples/ReactiveOrb";

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

  it("refreshes built-in event handlers after a React rerender", async () => {
    const { ElementHandler } = await import("../../../playhtml/src/elements");
    const handlers = new Map([[TagType.CanPlay, new Map()]]);
    const originalHandlers = playhtml.elementHandlers;
    playhtml.elementHandlers = handlers as any;
    vi.mocked(playhtml.setupPlayElement).mockReset();

    const firstClick = vi.fn();
    const firstDragStart = vi.fn();
    const secondClick = vi.fn();
    const secondDragStart = vi.fn();
    const secondDrag = vi.fn();
    const renderElement = (props: {
      onClick?: () => void;
      onDragStart?: () => void;
      onDrag?: () => void;
    }) => (
      <CanPlayElement
        id="rerender-handler"
        defaultData={{}}
        onClick={props.onClick}
        onDragStart={props.onDragStart}
        onDrag={props.onDrag}
      >
        {() => <div>play</div>}
      </CanPlayElement>
    );

    const { container, rerender, unmount } = render(
      renderElement({}),
    );
    const element = container.querySelector("[can-play]") as HTMLElement;
    handlers.get(TagType.CanPlay)!.set(
      element.id,
      new ElementHandler({
        element,
        defaultData: {},
        onClick: (element as any).onClick,
        onDrag: (element as any).onDrag,
        onDragStart: (element as any).onDragStart,
        onChange: vi.fn(),
        onAwarenessChange: vi.fn(),
        triggerAwarenessUpdate: vi.fn(),
      } as any),
    );

    rerender(
      renderElement({
        onClick: firstClick,
        onDragStart: firstDragStart,
      }),
    );
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    rerender(
      renderElement({
        onClick: secondClick,
        onDragStart: secondDragStart,
        onDrag: secondDrag,
      }),
    );
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    rerender(renderElement({}));
    const mouseDownAfterRemoval = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(mouseDownAfterRemoval);

    expect(firstClick).toHaveBeenCalledTimes(1);
    expect(firstDragStart).toHaveBeenCalledTimes(1);
    expect(secondClick).toHaveBeenCalledTimes(1);
    expect(secondDragStart).toHaveBeenCalledTimes(1);
    expect(secondDrag).toHaveBeenCalledTimes(1);
    expect(mouseDownAfterRemoval.defaultPrevented).toBe(false);
    expect(element.classList.contains("cursordown")).toBe(false);

    unmount();
    playhtml.elementHandlers = originalHandlers;
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

  it("CanToggleElement stamps read-only consumers", () => {
    const { container } = render(
      <CanToggleElement dataSource="/room#toggle" readOnly standalone>
        <button id="read-only-toggle">toggle</button>
      </CanToggleElement>,
    );
    const element = container.querySelector("#read-only-toggle") as HTMLElement;

    expect(element).toHaveAttribute("data-source", "/room#toggle");
    expect(element).toHaveAttribute("data-source-read-only");
  });

  it("does not re-render when synced data is a fresh reference but equal in value", () => {
    vi.spyOn(playhtml, "setupPlayElement").mockImplementation(() => {});
    vi.spyOn(playhtml, "removePlayElement").mockImplementation(() => {});

    let renderCount = 0;

    const { container } = render(
      <CanPlayElement
        // @ts-ignore array data mirrors can-duplicate's shape
        tagInfo={[TagType.CanDuplicate]}
        defaultData={["a", "b"]}
        defaultLocalData={[]}
        updateElement={() => {}}
      >
        {({ data }) => {
          renderCount++;
          return <div id="array-child">{JSON.stringify(data)}</div>;
        }}
      </CanPlayElement>,
    );

    const element = container.querySelector("[can-duplicate]") as HTMLElement;
    expect(element).toBeTruthy();

    const rendersAfterMount = renderCount;

    // Simulate the data observer firing several times with a NEW array reference
    // each time but identical contents — exactly how a Yjs collection snapshot
    // arrives. Equal-by-value syncs must not schedule re-renders.
    for (let i = 0; i < 3; i++) {
      act(() => {
        (element as any).updateElement({
          data: ["a", "b"],
          awareness: [],
          awarenessByStableId: new Map(),
          myAwareness: undefined,
          element,
          localData: [],
          setData: vi.fn(),
          setLocalData: vi.fn(),
          setMyAwareness: vi.fn(),
        });
      });
    }

    expect(renderCount).toBe(rendersAfterMount);
  });

  it("re-renders when synced data actually changes in value", () => {
    vi.spyOn(playhtml, "setupPlayElement").mockImplementation(() => {});
    vi.spyOn(playhtml, "removePlayElement").mockImplementation(() => {});

    let lastData: unknown;

    const { container } = render(
      <CanPlayElement
        // @ts-ignore
        tagInfo={[TagType.CanDuplicate]}
        defaultData={["a"]}
        defaultLocalData={[]}
        updateElement={() => {}}
      >
        {({ data }) => {
          lastData = data;
          return <div id="array-child">{JSON.stringify(data)}</div>;
        }}
      </CanPlayElement>,
    );

    const element = container.querySelector("[can-duplicate]") as HTMLElement;

    act(() => {
      (element as any).updateElement({
        data: ["a", "b"],
        awareness: [],
        awarenessByStableId: new Map(),
        myAwareness: undefined,
        element,
        localData: [],
        setData: vi.fn(),
        setLocalData: vi.fn(),
        setMyAwareness: vi.fn(),
      });
    });

    expect(lastData).toEqual(["a", "b"]);
  });

  it("re-renders when awarenessByStableId Map contents change", () => {
    vi.spyOn(playhtml, "setupPlayElement").mockImplementation(() => {});
    vi.spyOn(playhtml, "removePlayElement").mockImplementation(() => {});

    let lastByStableId: Map<string, unknown> | undefined;

    const { container } = render(
      <CanPlayElement
        // @ts-ignore
        tagInfo={[TagType.CanHover]}
        defaultData={{}}
        myDefaultAwareness={{ isHovering: false }}
        updateElement={() => {}}
        updateElementAwareness={() => {}}
      >
        {({ awarenessByStableId }) => {
          lastByStableId = awarenessByStableId as Map<string, unknown>;
          return <div id="awareness-child" />;
        }}
      </CanPlayElement>,
    );

    const element = container.querySelector("[can-hover]") as HTMLElement;

    act(() => {
      (element as any).updateElementAwareness({
        data: {},
        awareness: [{ isHovering: true }],
        // A new Map reference with real content. Maps have no enumerable own
        // keys, so a naive object comparison would wrongly treat this as equal
        // to the empty initial Map and drop the presence update.
        awarenessByStableId: new Map([["alice", { isHovering: true }]]),
        myAwareness: { isHovering: false },
        element,
        localData: undefined,
        setData: vi.fn(),
        setLocalData: vi.fn(),
        setMyAwareness: vi.fn(),
      });
    });

    expect(lastByStableId?.get("alice")).toEqual({ isHovering: true });
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

  it("uses the withSharedState id instead of a conflicting child id", () => {
    const SharedElement = withSharedState(
      { id: "configured-id", defaultData: { count: 0 } },
      ({ data }) => <div id="child-id">{data.count}</div>,
    );

    const { container } = render(<SharedElement />);

    expect(container.querySelector("#configured-id")).toBeTruthy();
    expect(container.querySelector("#child-id")).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('id="configured-id"'),
    );
  });

  it("removes the previous binding before registering a changed configured id", () => {
    const setupIds: string[] = [];
    const removeIds: string[] = [];
    vi.spyOn(playhtml, "setupPlayElement").mockImplementation((element) => {
      setupIds.push((element as HTMLElement).id);
    });
    vi.spyOn(playhtml, "removePlayElement").mockImplementation((element) => {
      removeIds.push((element as HTMLElement).id);
    });

    const SharedElement = withSharedState(
      ({ sharedId }: { sharedId: string }) => ({
        id: sharedId,
        defaultData: { count: 0 },
      }),
      ({ data }) => <div id="child-id">{data.count}</div>,
    );

    const { rerender } = render(<SharedElement sharedId="first-id" />);

    rerender(<SharedElement sharedId="second-id" />);

    expect(setupIds).toEqual(["first-id", "second-id"]);
    expect(removeIds).toEqual(["first-id"]);
  });

  it("reports the data-source binding id when id conflict uses dataSource", () => {
    const SharedElement = withSharedState(
      {
        id: "configured-id",
        dataSource: "/room#source-id",
        defaultData: { count: 0 },
      },
      ({ data }) => <div id="child-id">{data.count}</div>,
    );

    render(<SharedElement />);

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('data-source="/room#source-id"'),
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('source-id'),
    );
    expect(console.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Using id="configured-id" for shared state.'),
    );
  });

  it("warns when an empty configured id is provided", () => {
    const SharedElement = withSharedState(
      { id: "", defaultData: { count: 0 } },
      ({ data }) => <div id="child-id">{data.count}</div>,
    );

    const { container } = render(<SharedElement />);

    expect(container.querySelector("#child-id")).toBeTruthy();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("empty id"),
    );
  });

  it("logs each id conflict warning once per conflict", () => {
    const SharedElement = withSharedState(
      { id: "configured-id", defaultData: { count: 0 } },
      ({ data }) => <div id="child-id">{data.count}</div>,
    );

    const { container } = render(<SharedElement />);
    const element = container.querySelector("#configured-id") as HTMLElement;

    act(() => {
      (element as any).updateElement({
        data: { count: 1 },
        awareness: [],
        awarenessByStableId: new Map(),
        myAwareness: undefined,
        element,
        localData: undefined,
        setData: vi.fn(),
        setLocalData: vi.fn(),
        setMyAwareness: vi.fn(),
      });
    });

    const conflictWarnings = vi
      .mocked(console.warn)
      .mock.calls.filter(([message]) =>
        String(message).includes('child element has id="child-id"'),
      );
    expect(conflictWarnings).toHaveLength(1);
  });

  it("increments ReactiveOrb clicks through the current shared data", () => {
    const setData = vi.fn();
    const elementHandlers = new Map([
      [TagType.CanPlay, new Map([["orb-test", { setData }]])],
    ]);
    vi.spyOn(playhtml, "setupPlayElement").mockImplementation(() => {});
    vi.spyOn(playhtml, "removePlayElement").mockImplementation(() => {});
    vi.spyOn(playhtml, "elementHandlers", "get").mockReturnValue(
      elementHandlers as typeof playhtml.elementHandlers,
    );

    const { container } = render(
      <ReactiveOrb id="orb-test" className="orb-test" />,
    );

    fireEvent.click(container.querySelector("#orb-test") as HTMLElement);

    expect(setData).toHaveBeenCalledTimes(1);
    const update = setData.mock.calls[0][0];
    expect(update).toBeInstanceOf(Function);

    const draft = { clicks: 41 };
    update(draft);
    expect(draft).toEqual({ clicks: 42 });
  });
});
