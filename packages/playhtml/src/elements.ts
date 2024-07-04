/// <reference lib="dom"/>
import {
  ElementAwarenessEventHandlerData,
  ElementData,
  ElementEventHandlerData,
  ElementSetupData,
  ModifierKey,
} from "@playhtml/common";

// @ts-ignore
const debounce = (fn: Function, ms = 300) => {
  let timeoutId: ReturnType<typeof setTimeout>;
  return function (this: any, ...args: any[]) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), ms);
  };
};

// TODO: turn this into just an extension of HTMLElement and initialize all the methods / do all the state tracking
// on the element itself??
export class ElementHandler<T = any, U = any, V = any> {
  defaultData: T;
  localData: U;
  awareness: V[] = [];
  selfAwareness?: V;
  element: HTMLElement;
  _data: T;
  onChange: (data: T) => void;
  onAwarenessChange: (data: V) => void;
  debouncedOnChange: (data: T) => void;
  resetShortcut?: ModifierKey;
  // TODO: change this to receive the delta instead of the whole data object so you don't have to maintain
  // internal state for expressing the delta.
  updateElement: (data: ElementEventHandlerData<T, U, V>) => void;
  updateElementAwareness?: (
    data: ElementAwarenessEventHandlerData<T, U, V>
  ) => void;
  triggerAwarenessUpdate?: () => void;

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

  constructor(elementData: ElementData<T>) {
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
      updateElementAwareness,
      onMount,
      debounceMs,
      triggerAwarenessUpdate,
    } = elementData;
    // console.log("🔨 constructing ", element.id);
    this.element = element;
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
      this.__awareness = awarenessData;
    }
    const myInitialAwareness =
      myDefaultAwareness instanceof Function
        ? myDefaultAwareness(element)
        : myDefaultAwareness;
    if (myInitialAwareness !== undefined) {
      this.setMyAwareness(myInitialAwareness);
    }
    // Needed to get around the typescript error even though it is assigned in __data.
    this._data = initialData;
    this.__data = initialData;

    this.reinitializeElementData(elementData);

    if (onMount) {
      onMount(this.getSetupData());
    }
  }

  reinitializeElementData({
    element,
    onChange,
    onAwarenessChange,
    updateElement,
    updateElementAwareness,
    onClick,
    onDrag,
    onDragStart,
    resetShortcut,
    debounceMs,
    triggerAwarenessUpdate,
  }: ElementData<T>) {
    this.triggerAwarenessUpdate = triggerAwarenessUpdate;
    this.onChange = onChange;
    this.debouncedOnChange = debounce(this.onChange, debounceMs);
    this.onAwarenessChange = onAwarenessChange;
    this.updateElement = updateElement;
    this.updateElementAwareness = updateElementAwareness;

    // Handle all the event handlers
    if (onClick && !this.onClick) {
      element.addEventListener("click", (e) => {
        this.onClick?.(e, this.getEventHandlerData());
      });
    }
    this.onClick = onClick;
    if (onDrag && !this.onDrag) {
      element.addEventListener("touchstart", (e) => {
        // To prevent scrolling the page while dragging
        e.preventDefault();
        element.classList.add("cursordown");

        // Need to be able to not persist everything in the data, causing some lag.
        this.onDragStart?.(e, this.getEventHandlerData());

        const onMove = (e: TouchEvent) => {
          e.preventDefault();
          this.onDrag?.(e, this.getEventHandlerData());
        };
        const onDragStop = (e: TouchEvent) => {
          element.classList.remove("cursordown");
          document.removeEventListener("touchmove", onMove);
          document.removeEventListener("touchend", onDragStop);
        };
        document.addEventListener("touchmove", onMove);
        document.addEventListener("touchend", onDragStop);
      });
      element.addEventListener("mousedown", (e) => {
        // To prevent dragging images behavior conflicting.
        e.preventDefault();
        // Need to be able to not persist everything in the data, causing some lag.
        this.onDragStart?.(e, this.getEventHandlerData());
        element.classList.add("cursordown");

        const onMouseMove = (e: MouseEvent) => {
          e.preventDefault();
          this.onDrag?.(e, this.getEventHandlerData());
        };
        const onMouseUp = (e: MouseEvent) => {
          element.classList.remove("cursordown");
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
        };
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      });
    }
    this.onDrag = onDrag;
    this.onDragStart = onDragStart;

    // Handle advanced settings
    if (resetShortcut && !this.resetShortcut) {
      // @ts-ignore
      element.reset = this.reset;

      element.addEventListener("click", (e) => {
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
      });
    }
    this.resetShortcut = resetShortcut;
  }

  get data(): T {
    return this._data;
  }

  setLocalData(localData: U): void {
    this.localData = localData;
  }

  /**
   * // PRIVATE USE ONLY \\
   *
   * Updates the internal state with the given data and handles all the downstream effects. Should only be used by the sync code to ensure one-way
   * reactivity.
   * (e.g. calling `updateElement` and `onChange`)
   */
  set __data(data: T) {
    this._data = data;
    this.updateElement(this.getEventHandlerData());
  }

  set __awareness(data: V[]) {
    if (!this.updateElementAwareness) {
      return;
    }
    this.awareness = data;
    this.updateElementAwareness(this.getAwarenessEventHandlerData());
  }

  getEventHandlerData(): ElementEventHandlerData<T, U, V> {
    return {
      element: this.element,
      data: this.data,
      localData: this.localData,
      awareness: this.awareness,
      setData: (newData) => this.setData(newData),
      setLocalData: (newData) => this.setLocalData(newData),
      setMyAwareness: (newData) => this.setMyAwareness(newData),
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
      setData: (newData) => this.setData(newData),
      setLocalData: (newData) => this.setLocalData(newData),
      setMyAwareness: (newData) => this.setMyAwareness(newData),
    };
  }

  /**
   * Public-use setter for data that makes the change to all clients.
   */
  setData(data: T): void {
    this.onChange(data);
  }

  // TODO: this should be keyed on the element to avoid conflicts
  setMyAwareness(data: V): void {
    if (data === this.selfAwareness) {
      // avoid duplicate broadcasts
      return;
    }

    this.selfAwareness = data;
    this.onAwarenessChange(data);
    // For some reason unless it's the first time, the localState changing is not called in the `change` observer callback for awareness. So we have to manually update
    // the element's awareness rendering here.
    this.triggerAwarenessUpdate?.();
  }

  setDataDebounced(data: T) {
    this.debouncedOnChange(data);
  }

  /**
   * Resets the element to its default state.
   */
  reset() {
    this.setData(this.defaultData);
  }
}
