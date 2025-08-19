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

    handler.__awareness = [{ who: "A" } as any, { who: "B" } as any];
    expect(updateElementAwareness).toHaveBeenCalledTimes(1);

    handler.setMyAwareness({ me: "X" } as any);
    expect(onAwarenessChange).toHaveBeenCalledWith({ me: "X" });
    expect(triggerAwarenessUpdate).toHaveBeenCalled();
  });
});
