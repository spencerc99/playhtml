// ABOUTME: Covers ElementHandler state, awareness, event data, and setup behavior.
// ABOUTME: Verifies handler-level write semantics used by playhtml capabilities.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ElementHandler } from "../elements";
import type {
  ElementAwarenessEventHandlerData,
  ElementData,
  ElementEventHandlerData,
} from "@playhtml/common";

describe("ElementHandler", () => {
  let element: HTMLElement;

  beforeEach(() => {
    element = document.createElement("div");
    document.body.appendChild(element);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("initializes with default data and calls updateElement once", () => {
    const updateElement = vi.fn(
      (data: ElementEventHandlerData<any, any, any>) => {}
    );
    const onChange = vi.fn();
    const onAwarenessChange = vi.fn();

    const elementData: ElementData<any, any, any> = {
      element,
      defaultData: { a: 1, nested: { b: 2 } },
      updateElement,
      onChange,
      onAwarenessChange,
      triggerAwarenessUpdate: () => {},
    } as unknown as ElementData;

    const handler = new ElementHandler(elementData);

    expect(handler.data).toEqual({ a: 1, nested: { b: 2 } });
    expect(updateElement).toHaveBeenCalledTimes(1);
  });

  it("removes built-in click, drag, and reset listeners on destroy", () => {
    const onClick = vi.fn();
    const onDrag = vi.fn();
    const handler = new ElementHandler({
      element,
      defaultData: {},
      onClick,
      onDrag,
      resetShortcut: "shiftKey",
      onChange: vi.fn(),
      onAwarenessChange: vi.fn(),
      triggerAwarenessUpdate: vi.fn(),
    } as unknown as ElementData);
    const reset = vi.spyOn(handler, "reset");

    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));

    expect(onClick).toHaveBeenCalledTimes(2);
    expect(onDrag).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);

    handler.destroy();
    handler.destroy();
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));

    expect(onClick).toHaveBeenCalledTimes(2);
    expect(onDrag).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("removes an active drag's document listeners on destroy", () => {
    const onDrag = vi.fn();
    const handler = new ElementHandler({
      element,
      defaultData: {},
      onDrag,
      onChange: vi.fn(),
      onAwarenessChange: vi.fn(),
      triggerAwarenessUpdate: vi.fn(),
    } as unknown as ElementData);

    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(element.classList.contains("cursordown")).toBe(true);

    handler.destroy();
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    expect(onDrag).not.toHaveBeenCalled();
    expect(element.classList.contains("cursordown")).toBe(false);
  });

  it("removes an active touch drag's document listeners on destroy", () => {
    const onDrag = vi.fn();
    const handler = new ElementHandler({
      element,
      defaultData: {},
      onDrag,
      onChange: vi.fn(),
      onAwarenessChange: vi.fn(),
      triggerAwarenessUpdate: vi.fn(),
    } as unknown as ElementData);

    element.dispatchEvent(new Event("touchstart", { bubbles: true, cancelable: true }));
    expect(element.classList.contains("cursordown")).toBe(true);

    handler.destroy();
    document.dispatchEvent(new Event("touchmove", { bubbles: true, cancelable: true }));
    document.dispatchEvent(new Event("touchend", { bubbles: true }));

    expect(onDrag).not.toHaveBeenCalled();
    expect(element.classList.contains("cursordown")).toBe(false);
  });

  it("reinstalls built-in listeners once after destroy and reinitialize", () => {
    const onClick = vi.fn();
    const onDrag = vi.fn();
    const elementData = {
      element,
      defaultData: {},
      onClick,
      onDrag,
      resetShortcut: "shiftKey" as const,
      onChange: vi.fn(),
      onAwarenessChange: vi.fn(),
      triggerAwarenessUpdate: vi.fn(),
    } as unknown as ElementData;
    const handler = new ElementHandler(elementData);
    const reset = vi.spyOn(handler, "reset");

    handler.destroy();
    handler.reinitializeElementData(elementData);
    handler.reinitializeElementData(elementData);
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDrag).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("installs callbacks added after setup without duplicate listeners", () => {
    const onClick = vi.fn();
    const onDragStart = vi.fn();
    const onDrag = vi.fn();
    const handler = new ElementHandler({
      element,
      defaultData: {},
      onChange: vi.fn(),
      onAwarenessChange: vi.fn(),
      triggerAwarenessUpdate: vi.fn(),
    } as unknown as ElementData);

    handler.setEventHandlers({ onClick, onDragStart, onDrag });
    handler.setEventHandlers({ onClick, onDragStart, onDrag });
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDrag).toHaveBeenCalledTimes(1);
  });

  it("keeps imperative callbacks disabled for views", () => {
    const onClick = vi.fn();
    const handler = new ElementHandler({
      element,
      defaultData: {},
      view: () => "" as any,
      onChange: vi.fn(),
      onAwarenessChange: vi.fn(),
      triggerAwarenessUpdate: vi.fn(),
    } as unknown as ElementData);

    handler.setEventHandlers({ onClick });
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it("setData calls onChange and does not directly mutate internal state", () => {
    const updateElement = vi.fn();
    const onChange = vi.fn();
    const onAwarenessChange = vi.fn();

    const handler = new ElementHandler({
      element,
      defaultData: { a: 1 },
      updateElement,
      onChange,
      onAwarenessChange,
      triggerAwarenessUpdate: () => {},
    } as unknown as ElementData);

    handler.setData({ a: 2 });
    expect(onChange).toHaveBeenCalledWith({ a: 2 });
    // Internal state only updates via __data setter (i.e., from sync layer)
    expect(handler.data).toEqual({ a: 1 });
  });

  it("can schedule setup setData writes without delaying public setData", () => {
    const updateElement = vi.fn();
    const onChange = vi.fn();
    const onAwarenessChange = vi.fn();
    const pendingWrites: Array<() => void> = [];

    const handler = new ElementHandler({
      element,
      defaultData: { a: 1 },
      updateElement,
      onChange,
      onAwarenessChange,
      triggerAwarenessUpdate: () => {},
      onMount: ({ setData }) => {
        setData({ a: 2 });
      },
    } as unknown as ElementData, {
      scheduleSetupDataWrite: (write) => {
        pendingWrites.push(write);
      },
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(pendingWrites).toHaveLength(1);

    pendingWrites[0]();
    expect(onChange).toHaveBeenCalledWith({ a: 2 });

    handler.setData({ a: 3 });
    expect(onChange).toHaveBeenLastCalledWith({ a: 3 });
  });

  it("notifies data update listeners when internal data changes", () => {
    const updateElement = vi.fn();
    const onChange = vi.fn();
    const onAwarenessChange = vi.fn();

    const handler = new ElementHandler({
      element,
      defaultData: { a: 1 },
      updateElement,
      onChange,
      onAwarenessChange,
      triggerAwarenessUpdate: () => {},
    } as unknown as ElementData);

    const listener = vi.fn();
    const unsubscribe = handler.onDataUpdate(listener);

    handler.__data = { a: 2 };

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    handler.__data = { a: 3 };

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("setDataDebounced delays onChange", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const updateElement = vi.fn();
    const onAwarenessChange = vi.fn();

    const handler = new ElementHandler({
      element,
      defaultData: { a: 1 },
      debounceMs: 50,
      updateElement,
      onChange,
      onAwarenessChange,
      triggerAwarenessUpdate: () => {},
    } as unknown as ElementData);

    handler.setDataDebounced({ a: 3 });
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60);
    expect(onChange).toHaveBeenCalledWith({ a: 3 });
  });

  it("awareness setters call updateElementAwareness and onAwarenessChange", () => {
    const updateElement = vi.fn();
    const onChange = vi.fn();
    const onAwarenessChange = vi.fn();
    const updateElementAwareness = vi.fn(
      (data: ElementAwarenessEventHandlerData<any, any, any>) => {}
    );
    const triggerAwarenessUpdate = vi.fn();

    const handler = new ElementHandler({
      element,
      defaultData: {},
      updateElement,
      updateElementAwareness,
      onChange,
      onAwarenessChange,
      triggerAwarenessUpdate,
    } as unknown as ElementData);

    handler.updateAwareness(
      [{ who: "A" } as any, { who: "B" } as any],
      new Map([["stable-id-a", { who: "A" } as any], ["stable-id-b", { who: "B" } as any]])
    );
    expect(updateElementAwareness).toHaveBeenCalledTimes(1);

    handler.setMyAwareness({ me: "X" } as any);
    expect(onAwarenessChange).toHaveBeenCalledWith({ me: "X" });
    expect(triggerAwarenessUpdate).toHaveBeenCalled();
  });
});
