// ABOUTME: Manages per-element playhtml handlers, state updates, rendering, and events.
// ABOUTME: Bridges shared data, local data, awareness, and DOM capability callbacks.
/// <reference lib="dom"/>
import { render } from "lit-html";
import {
  ElementAwarenessEventHandlerData,
  ElementData,
  ElementEventHandlerData,
  ElementSetupData,
  ModifierKey,
  ViewTemplate,
} from "@playhtml/common";

// @ts-ignore
const debounce = (fn: Function, ms = 300) => {
  let timeoutId: ReturnType<typeof setTimeout>;
  return function (this: any, ...args: any[]) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), ms);
  };
};

type ElementDataWrite<T> = T | ((draft: T) => void);

interface ElementHandlerOptions {
  scheduleSetupDataWrite?: (write: () => void) => void;
}

// TODO: turn this into just an extension of HTMLElement and initialize all the methods / do all the state tracking
// on the element itself??
export class ElementHandler<T = any, U = any, V = any> {
  defaultData: T | undefined;
  localData: U;
  awareness: V[] = [];
  awarenessByStableId: Map<string, V> = new Map();
  selfAwareness?: V;
  element: HTMLElement;
  _data: T;
  onChange: (data: T) => void;
  onAwarenessChange: (data: V) => void;
  debouncedOnChange: (data: T) => void;
  resetShortcut?: ModifierKey;
  // TODO: change this to receive the delta instead of the whole data object so you don't have to maintain
  // internal state for expressing the delta.
  updateElement?: (data: ElementEventHandlerData<T, U, V>) => void;
  view?: (data: ElementEventHandlerData<T, U, V>) => ViewTemplate;
  updateElementAwareness?: (
    data: ElementAwarenessEventHandlerData<T, U, V>
  ) => void;
  triggerAwarenessUpdate?: () => void;
  devMode?: boolean;
  // Set while a `view` render is in flight, so setData/setLocalData/
  // setMyAwareness can detect (and reject) writes made synchronously during
  // render — a re-render loop.
  private isRendering = false;
  // Cleanup returned by onMount, invoked on destroy()/removePlayElement so
  // rAF loops, timers, and event listeners set up in onMount don't leak.
  private onUnmount?: () => void;
  // Allows the runtime to wire up capability descendants emitted by a view
  // (e.g. mount points for `define`d capabilities). Driven by descendantObserver.
  onAfterRender?: (element: HTMLElement) => void;
  private descendantObserver?: MutationObserver;
  private dataUpdateListeners = new Set<() => void>();
  private scheduleSetupDataWrite?: (write: () => void) => void;
  private clickListener?: (e: MouseEvent) => void;
  private touchStartListener?: (e: TouchEvent) => void;
  private mouseDownListener?: (e: MouseEvent) => void;
  private resetShortcutListener?: (e: MouseEvent) => void;
  private activeDragCleanup?: () => void;

  // event handlers
  onClick?: (
    e: MouseEvent,
    eventData: ElementEventHandlerData<T, U, V>
  ) => void;
  onDrag?: (
    e: MouseEvent | TouchEvent,
    eventData: ElementEventHandlerData<T, U, V>
  ) => void;
  onDragStart?: (
    e: MouseEvent | TouchEvent,
    eventData: ElementEventHandlerData<T, U, V>
  ) => void;

  constructor(
    elementData: ElementData<T>,
    options: ElementHandlerOptions = {},
  ) {
    const {
      element,
      onChange,
      onAwarenessChange,
      defaultData,
      defaultLocalData,
      myDefaultAwareness,
      data,
      awareness: awarenessData,
      updateElement,
      view,
      updateElementAwareness,
      onMount,
      debounceMs,
      triggerAwarenessUpdate,
      devMode,
    } = elementData;
    // console.log("🔨 constructing ", element.id);
    this.scheduleSetupDataWrite = options.scheduleSetupDataWrite;
    this.element = element;
    this.view = view;
    this.devMode = devMode;
    this.defaultData =
      defaultData instanceof Function ? defaultData(element) : defaultData;
    this.localData =
      defaultLocalData instanceof Function
        ? defaultLocalData(element)
        : defaultLocalData;
    this.triggerAwarenessUpdate = triggerAwarenessUpdate;
    this.onChange = onChange;
    this.debouncedOnChange = debounce(this.onChange, debounceMs);
    this.onAwarenessChange = onAwarenessChange;
    this.updateElement = updateElement;
    this.updateElementAwareness = updateElementAwareness;
    const initialData = data === undefined ? this.defaultData : data;

    if (awarenessData !== undefined) {
      this.awareness = awarenessData;
    }
    const myInitialAwareness =
      myDefaultAwareness instanceof Function
        ? myDefaultAwareness(element)
        : myDefaultAwareness;
    if (myInitialAwareness !== undefined) {
      this.setMyAwareness(myInitialAwareness);
    }
    // Needed to get around the typescript error even though it is assigned in __data.
    this._data = initialData as T;
    this.__data = initialData as T;

    this.reinitializeElementData(elementData);

    if (onMount) {
      const cleanup = onMount(this.getSetupData());
      if (typeof cleanup === "function") {
        this.onUnmount = cleanup;
      }
    }
  }

  /**
   * Tears down anything onMount set up (rAF loops, timers, listeners).
   * Called by removePlayElement / unregister(). Idempotent.
   */
  destroy(): void {
    this.descendantObserver?.disconnect();
    this.descendantObserver = undefined;
    if (this.clickListener) {
      this.element.removeEventListener("click", this.clickListener);
      this.clickListener = undefined;
    }
    if (this.touchStartListener) {
      this.element.removeEventListener("touchstart", this.touchStartListener);
      this.touchStartListener = undefined;
    }
    if (this.mouseDownListener) {
      this.element.removeEventListener("mousedown", this.mouseDownListener);
      this.mouseDownListener = undefined;
    }
    if (this.resetShortcutListener) {
      this.element.removeEventListener("click", this.resetShortcutListener);
      this.resetShortcutListener = undefined;
    }
    this.removeActiveDragListeners();
    this.onClick = undefined;
    this.onDrag = undefined;
    this.onDragStart = undefined;
    this.resetShortcut = undefined;
    const cleanup = this.onUnmount;
    this.onUnmount = undefined;
    if (cleanup) {
      try {
        cleanup();
      } catch (e) {
        console.error(`[playhtml] onMount cleanup for "${this.element.id}" threw`, e);
      }
    }
  }

  reinitializeElementData({
    element,
    onChange,
    onAwarenessChange,
    updateElement,
    view,
    updateElementAwareness,
    onClick,
    onDrag,
    onDragStart,
    resetShortcut,
    debounceMs,
    triggerAwarenessUpdate,
    devMode,
  }: ElementData<T>) {
    this.triggerAwarenessUpdate = triggerAwarenessUpdate;
    this.onChange = onChange;
    this.debouncedOnChange = debounce(this.onChange, debounceMs);
    this.onAwarenessChange = onAwarenessChange;
    this.updateElement = updateElement;
    this.view = view;
    this.devMode = devMode;

    // `view` and `updateElement` are mutually exclusive. register/define throw
    // on this, but React props / extraCapabilities reach this shared path
    // without that check, so enforce it here: `view` wins and `updateElement`
    // is dropped (with a diagnostic) instead of silently ignored.
    if (view && this.updateElement) {
      console.error(
        `[playhtml] "${element.id}" provides both \`view\` and \`updateElement\`. ` +
          `They are mutually exclusive — \`view\` is used and \`updateElement\` is ignored.`,
      );
      this.updateElement = undefined;
    }

    // In view mode, element-level event handlers are not wired — interactions
    // belong in the template (@click, etc.). Enforce the mutual exclusion here
    // (the shared binding path) so React props / extraCapabilities can't
    // silently run a view AND fire imperative onClick/onDrag handlers.
    if (view && (onClick || onDrag || onDragStart)) {
      console.error(
        `[playhtml] "${element.id}" provides a \`view\` alongside onClick/onDrag/onDragStart. ` +
          `In view mode these are ignored — attach events inside the template (e.g. @click). `,
      );
      onClick = undefined;
      onDrag = undefined;
      onDragStart = undefined;
    }

    this.setEventHandlers({ onClick, onDrag, onDragStart });

    // Handle advanced settings
    if (resetShortcut && !this.resetShortcutListener) {
      // @ts-ignore
      element.reset = this.reset;

      this.resetShortcutListener = (e) => {
        switch (this.resetShortcut) {
          case "ctrlKey":
            if (!e.ctrlKey) {
              return;
            }
            break;
          case "altKey":
            if (!e.altKey) {
              return;
            }
            break;
          case "shiftKey":
            if (!e.shiftKey) {
              return;
            }
            break;
          case "metaKey":
            if (!e.metaKey) {
              return;
            }
            break;
          default:
            return;
        }
        this.reset();
        e.preventDefault();
        e.stopPropagation();
      };
      element.addEventListener("click", this.resetShortcutListener);
    }
    this.resetShortcut = resetShortcut;
  }

  setEventHandlers({
    onClick,
    onDrag,
    onDragStart,
  }: Pick<ElementData<T>, "onClick" | "onDrag" | "onDragStart">): void {
    const element = this.element;
    const hadDragHandler = Boolean(this.onDrag || this.onDragStart);
    if (this.view) {
      if (hadDragHandler) {
        this.removeActiveDragListeners();
      }
      this.onClick = undefined;
      this.onDrag = undefined;
      this.onDragStart = undefined;
      return;
    }
    const hasDragHandler = Boolean(onDrag || onDragStart);
    if (hadDragHandler && !hasDragHandler) {
      this.removeActiveDragListeners();
    }
    if (onClick && !this.clickListener) {
      this.clickListener = (e) => {
        this.onClick?.(e, this.getEventHandlerData());
      };
      element.addEventListener("click", this.clickListener);
    }
    if (hasDragHandler && !this.touchStartListener) {
      this.touchStartListener = (e) => {
        if (!this.onDrag && !this.onDragStart) return;
        // To prevent scrolling the page while dragging
        e.preventDefault();
        this.removeActiveDragListeners();
        element.classList.add("cursordown");

        // Need to be able to not persist everything in the data, causing some lag.
        this.onDragStart?.(e, this.getEventHandlerData());

        const onMove = (e: TouchEvent) => {
          e.preventDefault();
          this.onDrag?.(e, this.getEventHandlerData());
        };
        const onDragStop = () => {
          element.classList.remove("cursordown");
          document.removeEventListener("touchmove", onMove);
          document.removeEventListener("touchend", onDragStop);
          if (this.activeDragCleanup === onDragStop) {
            this.activeDragCleanup = undefined;
          }
        };
        this.activeDragCleanup = onDragStop;
        document.addEventListener("touchmove", onMove);
        document.addEventListener("touchend", onDragStop);
      };
      element.addEventListener("touchstart", this.touchStartListener);
    }
    if (hasDragHandler && !this.mouseDownListener) {
      this.mouseDownListener = (e) => {
        if (!this.onDrag && !this.onDragStart) return;
        // To prevent dragging images behavior conflicting.
        e.preventDefault();
        this.removeActiveDragListeners();
        // Need to be able to not persist everything in the data, causing some lag.
        this.onDragStart?.(e, this.getEventHandlerData());
        element.classList.add("cursordown");

        const onMouseMove = (e: MouseEvent) => {
          e.preventDefault();
          this.onDrag?.(e, this.getEventHandlerData());
        };
        const onMouseUp = () => {
          element.classList.remove("cursordown");
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
          if (this.activeDragCleanup === onMouseUp) {
            this.activeDragCleanup = undefined;
          }
        };
        this.activeDragCleanup = onMouseUp;
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      };
      element.addEventListener("mousedown", this.mouseDownListener);
    }
    this.onClick = onClick;
    this.onDrag = onDrag;
    this.onDragStart = onDragStart;
  }

  private removeActiveDragListeners(): void {
    this.activeDragCleanup?.();
    this.activeDragCleanup = undefined;
    this.element.classList.remove("cursordown");
  }

  get data(): T {
    return this._data;
  }

  onDataUpdate(listener: () => void): () => void {
    this.dataUpdateListeners.add(listener);
    return () => {
      this.dataUpdateListeners.delete(listener);
    };
  }

  setLocalData(localData: U | ((draft: U) => void)): void {
    // setLocalData re-renders in view mode, so calling it during render would
    // recurse infinitely. Reject it like setData.
    if (this.rejectWriteDuringRender("setLocalData")) return;
    if (typeof localData === "function") {
      (localData as (draft: U) => void)(this.localData);
    } else {
      this.localData = localData;
    }
    // In view mode, localData is part of the rendered state (e.g. per-user UI
    // toggles), so a localData write should re-render. Imperative-mode
    // (updateElement) handlers manage their own DOM and call setLocalData
    // frequently during drags — re-rendering there would be wrong/expensive.
    if (this.view) {
      this.render();
    }
  }

  /**
   * // PRIVATE USE ONLY \\
   *
   * Updates the internal state with the given data and handles all the downstream effects. Should only be used by the sync code to ensure one-way
   * reactivity.
   * (e.g. calling `updateElement`/`view` and `onChange`)
   */
  set __data(data: T) {
    this._data = data;
    this.render();
    for (const listener of this.dataUpdateListeners) {
      listener();
    }
  }

  /**
   * Renders the element from current state: runs `view` and patches the
   * result into the DOM via lit-html, or falls back to imperative
   * `updateElement`. Safe to call repeatedly — lit-html diffs.
   */
  render(): void {
    if (this.view) {
      this.isRendering = true;
      try {
        render(
          this.view(this.getEventHandlerData()) as any,
          this.element,
        );
      } finally {
        this.isRendering = false;
      }
      // Descendant binding is driven by a MutationObserver (see
      // observeDescendants), NOT from here — re-running it on every render
      // would scan the whole subtree ~60fps for clock-driven views. The
      // observer only fires when child nodes actually change.
      return;
    }
    this.updateElement?.(this.getEventHandlerData());
  }

  /**
   * Begins binding capability descendants emitted by this view (mount points
   * for `define`d capabilities / `register`ed ids). Binds the current children
   * once, then re-binds only when the subtree's child structure changes — so a
   * text/attribute-only re-render (a ticking timer) does no scanning at all.
   * Called once by the runtime after `onAfterRender` is wired.
   */
  observeDescendants(): void {
    if (!this.onAfterRender || this.descendantObserver) return;
    this.onAfterRender(this.element); // bind children from the first render
    if (typeof MutationObserver !== "undefined") {
      this.descendantObserver = new MutationObserver(() => {
        this.onAfterRender?.(this.element);
      });
      this.descendantObserver.observe(this.element, {
        childList: true,
        subtree: true,
      });
    }
  }

  /**
   * Re-runs the view and repaints from current state. No-op for elements
   * without a `view` (it's the view-repaint primitive), and a no-op during an
   * in-flight render (calling it from inside `view` would recurse).
   */
  requestUpdate(): void {
    if (!this.view || this.isRendering) return;
    this.render();
  }

  /** Warns and returns true if a write was attempted during a view render. */
  private rejectWriteDuringRender(method: string): boolean {
    if (!this.isRendering) return false;
    console.error(
      `[playhtml] ${method}() was called during a view render for "${this.element.id}". ` +
        `Views must be pure — drive writes from @event handlers (e.g. @click) instead. Ignoring this write.`,
    );
    return true;
  }

  updateAwareness(data: V[], byStableId: Map<string, V>) {
    this.awareness = data;
    this.awarenessByStableId = byStableId;
    this.updateElementAwareness?.(this.getAwarenessEventHandlerData());
    // Views render from awareness too (e.g. "3 people here"), so an awareness
    // change must re-render — even when updateElementAwareness is also present
    // (otherwise the view goes stale while the callback runs).
    if (this.view) {
      this.render();
    }
  }

  getEventHandlerData(): ElementEventHandlerData<T, U, V> {
    return {
      element: this.element,
      data: this.data,
      localData: this.localData,
      awareness: this.awareness,
      awarenessByStableId: this.awarenessByStableId,
      setData: (newData) => this.setData(newData),
      setLocalData: (newData) => this.setLocalData(newData),
      setMyAwareness: (newData) => this.setMyAwareness(newData),
      requestUpdate: () => this.requestUpdate(),
    };
  }

  getAwarenessEventHandlerData(): ElementAwarenessEventHandlerData<T, U, V> {
    return {
      ...this.getEventHandlerData(),
      myAwareness: this.selfAwareness,
    };
  }

  getSetupData(): ElementSetupData<T, U> {
    return {
      getElement: () => this.element,
      getData: () => this.data,
      getLocalData: () => this.localData,
      getAwareness: () => this.awareness,
      setData: (newData) => this.setSetupData(newData),
      setLocalData: (newData) => this.setLocalData(newData),
      setMyAwareness: (newData) => this.setMyAwareness(newData),
      requestUpdate: () => this.requestUpdate(),
    };
  }

  private setSetupData(data: ElementDataWrite<T>): void {
    if (!this.scheduleSetupDataWrite) {
      this.setData(data);
      return;
    }
    if (this.rejectWriteDuringRender("setData")) return;
    this.scheduleSetupDataWrite(() => {
      this.onChange(data as unknown as T);
    });
  }

  /**
   * Public setter for element data.
   *
   * Semantics:
   * - Mutator form: setData((draft) => { ... })
   *   When data is backed by SyncedStore/Yjs (dataMode = "syncedstore"),
   *   the draft is a live CRDT proxy. You can mutate nested arrays/objects
   *   and the change will be merged across clients without conflicts.
   *   Example:
   *     setData(d => { d.list.push(item); });
   *
   * - Value form: setData(value)
   *   Replaces the entire data snapshot. Use this when you need canonical
   *   replacement semantics (e.g., snapshot from a mirror) or when running
   *   in legacy plain mode. Example:
   *     setData({ on: true });
   *
   * Notes:
   * - In plain mode, only the value form results in a sync; mutating draft
   *   is a no-op. Prefer the mutator form for merge-friendly edits.
   * - Directly mutating eventData.data may work in SyncedStore mode, but the
   *   recommended portable pattern is setData(draft => { ... }).
   */
  setData(data: ElementDataWrite<T>): void {
    // Writing shared data from inside a view render is a re-render loop:
    // the write triggers another render, which writes again. Reject it.
    if (this.rejectWriteDuringRender("setData")) return;
    // The onChange implementation in index.ts understands both forms.
    // Cast is safe because the callee inspects and branches by typeof.
    this.onChange(data as unknown as T);
  }

  // TODO: this should be keyed on the element to avoid conflicts
  setMyAwareness(data: V): void {
    // In view mode an awareness change re-renders, so writing awareness during
    // render would loop. Reject it like the other write paths.
    if (this.rejectWriteDuringRender("setMyAwareness")) return;
    if (data === this.selfAwareness) {
      // avoid duplicate broadcasts
      return;
    }

    this.selfAwareness = data;
    this.onAwarenessChange(data);
    // Render our own awareness change locally right away. The awareness "change"
    // observer also fires (onAwarenessChange writes a fresh state object, so
    // y-protocols detects the change and broadcasts it), but that path reflects
    // the write back asynchronously; updating here keeps the local view immediate.
    this.triggerAwarenessUpdate?.();
  }

  setDataDebounced(data: T) {
    this.debouncedOnChange(data);
  }

  /**
   * Resets the element to its default state.
   */
  reset() {
    if (this.defaultData === undefined) return;
    this.setData(this.defaultData);
  }
}
