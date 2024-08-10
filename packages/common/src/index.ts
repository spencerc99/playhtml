export type ModifierKey = "ctrlKey" | "altKey" | "shiftKey" | "metaKey";

// TODO: should be able to have set of allowable elements
// TODO: should be able to accept arbitrary input? (like max/min)
// TODO: should be able to add permission conditions?
// TODO: add new method for preventing updates while someone else is moving it?
export interface ElementInitializer<T = any, U = any, V = any> {
  defaultData: T | ((element: HTMLElement) => T);
  defaultLocalData?: U | ((element: HTMLElement) => U);
  myDefaultAwareness?: V | ((element: HTMLElement) => V);
  updateElement: (data: ElementEventHandlerData<T, U, V>) => void;
  updateElementAwareness?: (
    data: ElementAwarenessEventHandlerData<T, U, V>
  ) => void;

  // Event handlers
  // Abstracts to handle clicking and dragging the element to handle both mouse and touch events.
  // Takes inspiration from https://github.com/react-grid-layout/react-draggable
  onDrag?: (
    e: MouseEvent | TouchEvent,
    eventData: ElementEventHandlerData<T, U, V>
  ) => void;
  onClick?: (
    e: MouseEvent,
    eventData: ElementEventHandlerData<T, U, V>
  ) => void;
  onDragStart?: (
    e: MouseEvent | TouchEvent,
    eventData: ElementEventHandlerData<T, U, V>
  ) => void;
  // @deprecated use onMount instead
  additionalSetup?: (eventData: ElementSetupData<T, U, V>) => void;
  // Used to set up any additional event handlers
  onMount?: (eventData: ElementSetupData<T, U, V>) => void;

  // Advanced settings
  resetShortcut?: ModifierKey;
  debounceMs?: number;
  isValidElementForTag?: (element: HTMLElement) => boolean;
}

export interface ElementData<T = any, U = any, V = any>
  extends ElementInitializer<T> {
  data?: T;
  localData?: U;
  awareness?: V;
  element: HTMLElement;
  onChange: (data: T) => void;
  onAwarenessChange: (data: V) => void;
  // Gets the current set of awareness data for the element.
  triggerAwarenessUpdate: () => void;
}

export interface ElementEventHandlerData<T = any, U = any, V = any> {
  data: T;
  localData: U;
  awareness: V[];
  element: HTMLElement;
  setData: (data: T) => void;
  // TODO: should probably rename to "setTemporaryData" and use setLocalData to set indexeddb data
  setLocalData: (data: U) => void;
  setMyAwareness: (data: V) => void;
}

export interface ElementAwarenessEventHandlerData<T = any, U = any, V = any>
  extends ElementEventHandlerData<T, U, V> {
  myAwareness?: V;
}

export interface ElementSetupData<T = any, U = any, V = any> {
  getData: () => T;
  getLocalData: () => U;
  getAwareness: () => V[];
  getElement: () => HTMLElement;
  setData: (data: T) => void;
  setLocalData: (data: U) => void;
  setMyAwareness: (data: V) => void;
}

interface EventData<T = any> {
  eventPayload: T;
}

export type EventMessage<T = any> = Pick<PlayEvent<T>, "type"> &
  Partial<EventData<T>>;

export interface PlayEvent<T = any> {
  type: string;
  onEvent: (eventPayload: EventData<T>) => void;
}

export interface RegisteredPlayEvent<T = any> extends PlayEvent<T> {
  id: string;
}

/**
 * Custom Capabilities data types
 */
export type MoveData = {
  x: number;
  y: number;
};
export type SpinData = {
  rotation: number;
};
export type GrowData = {
  scale: number;
  maxScale: number;
  isHovering: boolean;
};
export const CanDuplicateTo = "can-duplicate-to";

// Supported Tags
export enum TagType {
  "CanPlay" = "can-play",
  "CanMove" = "can-move",
  "CanSpin" = "can-spin",
  "CanGrow" = "can-grow",
  "CanToggle" = "can-toggle",
  "CanDuplicate" = "can-duplicate",
  "CanHover" = "can-hover",
  "CanResize" = "can-resize",
  "CanMirror" = "can-mirror",
  // "CanRearrange" = "can-rearrange",
  // "CanDrag" = "can-drag",
  // "CanDraw" = "can-draw",
  // "CanBounce" = "can-bounce",
  // "CanDrive" = "can-drive",
  // "CanHighlight" = "can-highlight",
  // "CanStamp" = "can-stamp",
  // canZoom
  // canScroll

  // "CanFall" = "can-fall", See https://mrdoob.com/projects/chromeexperiments/google-space/
  // "CanAge" = "can-age",
  // "CanFingerprint" = "can-fingerprint",
  // "CanTake" = "can-take",
  // "CanPlace" = "can-place",
  // "CanBreak" = "can-break",
  // "CanUse" = "can-use",
  // A BUNCH FROM Copilot completions
  // "CanOpen" = "can-open",
  // "CanClose" = "can-close",
  // "CanChat" = "can-chat",
  // "CanRead" = "can-read",
  // "CanWrite" = "can-write",
  // "CanEat" = "can-eat",
  // "CanDrink" = "can-drink",
  // "CanWear" = "can-wear",
  // "CanWield" = "can-wield",
  // "CanTalk" = "can-talk",
  // "CanListen" = "can-listen",
  // "CanLook" = "can-look",
  // "CanSmell" = "can-smell",
  // "CanTaste" = "can-taste",
  // "CanFeel" = "can-feel",
  // "CanThink" = "can-think",
  // "CanSleep" = "can-sleep",
  // "CanWake" = "can-wake",
  // "CanBreathe" = "can-breathe",
}

export function getIdForElement(ele: HTMLElement): string | undefined {
  return ele.id;
}

const growCursor: string = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'  width='44' height='53' viewport='0 0 100 100' style='fill:black;font-size:26px;'><text y='40%'>🚿</text></svg>")
      16 0,
    auto`;
const cutCursor: string = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'  width='40' height='48' viewport='0 0 100 100' style='fill:black;font-size:24px;'><text y='50%'>✂️</text></svg>") 16 0,auto`;
function canGrowCursorHandler(
  e: MouseEvent | KeyboardEvent,
  { getData, getElement, getLocalData, setLocalData }: ElementSetupData
) {
  const data = getData();
  const localData = getLocalData();
  const element = getElement();

  localData.isHovering = true;
  if (e.altKey) {
    if (data.scale <= 0.5) {
      element.style.cursor = "not-allowed";
      return;
    }
    element.style.cursor = cutCursor;
  } else {
    if (data.scale >= data.maxScale) {
      element.style.cursor = "not-allowed";
      return;
    }
    element.style.cursor = growCursor;
  }

  setLocalData(localData);
}

function getClientCoordinates(e: MouseEvent | TouchEvent): {
  clientX: number;
  clientY: number;
} {
  if ("touches" in e) {
    const { clientX, clientY } = e.touches[0];
    return { clientX, clientY };
  }
  return { clientX: e.clientX, clientY: e.clientY };
}

// @ts-ignore
export const TagTypeToElement: Record<
  Exclude<TagType, "can-play">,
  ElementInitializer
> = {
  [TagType.CanMove]: {
    defaultData: { x: 0, y: 0 },
    defaultLocalData: { startMouseX: 0, startMouseY: 0 },
    updateElement: ({ element, data }) => {
      element.style.transform = `translate(${data.x}px, ${data.y}px)`;
    },
    onDragStart: (e: MouseEvent | TouchEvent, { setLocalData }) => {
      const { clientX, clientY } = getClientCoordinates(e);
      setLocalData({
        startMouseX: clientX,
        startMouseY: clientY,
      });
    },
    onDrag: (
      e: MouseEvent | TouchEvent,
      { data, localData, setData, setLocalData, element }
    ) => {
      const { clientX, clientY } = getClientCoordinates(e);
      const { top, left, bottom, right } = element.getBoundingClientRect();
      if (
        (right > window.outerWidth && clientX > localData.startMouseX) ||
        (bottom > window.innerHeight && clientY > localData.startMouseY) ||
        (left < 0 && clientX < localData.startMouseX) ||
        (top < 0 && clientY < localData.startMouseY)
      )
        return;
      setData({
        x: data.x + clientX - localData.startMouseX,
        y: data.y + clientY - localData.startMouseY,
      });
      setLocalData({ startMouseX: clientX, startMouseY: clientY });
    },
    resetShortcut: "shiftKey",
  } as ElementInitializer<MoveData>,
  [TagType.CanSpin]: {
    defaultData: { rotation: 0 },
    defaultLocalData: { startMouseX: 0 },
    updateElement: ({ element, data }) => {
      element.style.transform = `rotate(${data.rotation}deg)`;
    },
    onDragStart: (e: MouseEvent | TouchEvent, { setLocalData }) => {
      const { clientX } = getClientCoordinates(e);
      setLocalData({
        startMouseX: clientX,
      });
    },
    onDrag: (
      e: MouseEvent | TouchEvent,
      { data, localData, setData, setLocalData }
    ) => {
      const { clientX } = getClientCoordinates(e);
      // Calculate distance mouse has moved from the last known position
      // TODO: scale this according to size
      let distance = Math.abs(clientX - localData.startMouseX) * 2;
      let rotation = data.rotation;

      if (clientX > localData.startMouseX) {
        // Move right
        rotation += distance; // Change rotation proportional to the distance moved
      } else if (clientX < localData.startMouseX) {
        // Move left
        rotation -= distance; // Change rotation proportional to the distance moved
      }

      setData({ rotation });
      setLocalData({ startMouseX: clientX });
    },
    resetShortcut: "shiftKey",
  } as ElementInitializer<SpinData>,
  [TagType.CanToggle]: {
    defaultData: { on: false },
    updateElement: ({ element, data }) => {
      // handling migration from "boolean" to "{on: boolean}" type
      const on = typeof data === "object" ? data.on : data;
      element.classList.toggle("clicked", on);
    },
    onClick: (e: MouseEvent, { data, setData }) => {
      // handling migration from "boolean" to "{on: boolean}" type
      const on = typeof data === "object" ? data.on : data;
      setData({ on: !on });
    },
    resetShortcut: "shiftKey",
  },
  [TagType.CanGrow]: {
    defaultData: { scale: 1 },
    defaultLocalData: { maxScale: 2, isHovering: false },
    updateElement: ({ element, data }) => {
      element.style.transform = `scale(${data.scale})`;
    },
    onClick: (e: MouseEvent, { data, element, setData, localData }) => {
      let { scale } = data;
      if (e.altKey) {
        // shrink
        if (data.scale <= 0.5) {
          return;
        }

        scale -= 0.1;
      } else {
        // grow
        element.style.cursor = growCursor;
        if (data.scale >= localData.maxScale) {
          return;
        }

        scale += 0.1;
      }
      setData({ ...data, scale });
    },
    onMount: (eventData) => {
      eventData.getElement().addEventListener("mouseenter", (e) => {
        canGrowCursorHandler(e, eventData);
        const onKeyDownUp = (e: KeyboardEvent) =>
          canGrowCursorHandler(e, eventData);
        document.addEventListener("keydown", onKeyDownUp);
        document.addEventListener("keyup", onKeyDownUp);

        eventData.getElement().addEventListener("mouseleave", (e) => {
          document.removeEventListener("keydown", onKeyDownUp);
          document.removeEventListener("keyup", onKeyDownUp);
        });
      });
    },
    resetShortcut: "shiftKey",
  } as ElementInitializer<GrowData>,
  // TODO: add ability to add max # of duplicates
  // TODO: add lifespan to automatically prune
  // TODO: add limit per person / per timeframe.
  [TagType.CanDuplicate]: {
    defaultData: [],
    defaultLocalData: [],
    updateElement: ({ data, localData, setLocalData, element }) => {
      const duplicateElementId = element.getAttribute(TagType.CanDuplicate)!;
      const elementToDuplicate = document.getElementById(duplicateElementId);
      let lastElement: HTMLElement | null =
        document.getElementById(localData.slice(-1)?.[0]) ?? null;
      if (!elementToDuplicate) {
        console.error(
          `Element with id ${duplicateElementId} not found. Cannot duplicate.`
        );
        return;
      }

      const canDuplicateTo = element.getAttribute(CanDuplicateTo);
      function insertDuplicatedElement(newElement: Node) {
        if (canDuplicateTo) {
          const duplicateToElement =
            document.getElementById(canDuplicateTo) ||
            document.querySelector(canDuplicateTo);
          if (duplicateToElement) {
            duplicateToElement.appendChild(newElement);
            return;
          }
        }

        // By default insert after the latest element inserted (or the element to duplicate if none yet)
        elementToDuplicate!.parentNode!.insertBefore(
          newElement,
          (lastElement || elementToDuplicate!).nextSibling
        );
      }

      const addedElements = new Set(localData);
      for (const elementId of data) {
        if (addedElements.has(elementId)) continue;

        const newElement = elementToDuplicate.cloneNode(true) as HTMLElement;
        Object.assign(newElement, { ...elementToDuplicate });
        newElement.id = elementId;

        insertDuplicatedElement(newElement);
        localData.push(elementId);
        // TODO: import this to make it work not in browser
        // @ts-ignore
        window.playhtml.setupPlayElement(newElement);
        lastElement = newElement;
      }
      setLocalData(localData);
    },
    onClick: (_e: MouseEvent, { data, element, setData }) => {
      const duplicateElementId = element.getAttribute(TagType.CanDuplicate)!;
      const newElementId =
        duplicateElementId + "-" + Math.random().toString(36).substr(2, 9);

      setData([...data, newElementId]);
    },
    isValidElementForTag: (element) => {
      const tagAttribute = element.getAttribute(TagType.CanDuplicate);
      if (!tagAttribute) {
        return false;
      }

      if (!document.getElementById(tagAttribute)) {
        console.warn(
          `${TagType.CanDuplicate} element (${element.id}) duplicate element ("${tagAttribute}") not found.`
        );
      }

      return true;
    },
  } as ElementInitializer<string[]>,
  [TagType.CanMirror]: {
    defaultData: (element: HTMLElement) => constructInitialState(element),
    onMount: ({ getElement, setData, getData }) => {
      const element = getElement();
      // console.log("mirroring", element);

      observeElementChanges(element, (mutations) => {
        const currentState = getData();
        // console.log(mutations);
        const newState = updateStateWithMutation(currentState, mutations);
        setData(newState);
      });
    },
    updateElement: ({ element, data }) => {
      // console.log("new data", data);
      const currentState = constructInitialState(element);
      if (areStatesEqual(currentState, data)) {
        return;
      }
      updateElementFromState(element, data);
    },
  },
};

function isHTMLElementState(state: ElementState): state is HTMLElementState {
  return state.nodeType === NodeType.HTMLElement;
}

function areStatesEqual(state1: ElementState, state2: ElementState): boolean {
  if (state1.nodeType !== state2.nodeType) {
    return false;
  }

  if (state1.nodeType === NodeType.Text && state2.nodeType === NodeType.Text) {
    return state1.textContent === state2.textContent;
  }

  if (isHTMLElementState(state1) && isHTMLElementState(state2)) {
    if (state1.tagName !== state2.tagName) {
      return false;
    }

    if (
      Object.keys(state1.attributes).length !==
      Object.keys(state2.attributes).length
    ) {
      return false;
    }

    for (const [key, value] of Object.entries(state1.attributes)) {
      if (state2.attributes[key] !== value) {
        return false;
      }
    }

    if (state1.children.length !== state2.children.length) {
      return false;
    }

    for (let i = 0; i < state1.children.length; i++) {
      if (!areStatesEqual(state1.children[i], state2.children[i])) {
        return false;
      }
    }
  }

  return true;
}

function observeElementChanges(
  element: HTMLElement,
  callback: (mutations: MutationRecord[]) => void,
  options?: {
    childList?: boolean;
    attributes?: boolean;
    characterData?: boolean;
    attributeFilter?: string[];
  }
): MutationObserver {
  // Options for the observer (which mutations to observe)
  const defaultOptions = {
    childList: true,
    attributes: true,
    // NOTE: this makes it such that innerhtml changes aren't picked up.. for now let's just be okay with that
    // can get around this by putting subtree to true but ignoring any target that isn't the immediate element's content
    subtree: false,
    characterData: true,
  };

  // Merge default options with provided options
  const config = { ...defaultOptions, ...options };

  // Callback function to execute when mutations are observed
  const mutationCallback = (mutationsList: MutationRecord[]) => {
    const filteredMutations = mutationsList.filter((mutation) => {
      // TODO: actually not sure if this line does anything lol but nothing unexpected is happening yet...
      if (mutation.target !== element) {
        return false;
      }

      if (config.childList && mutation.type === "childList") {
        return true;
      }

      if (config.attributes && mutation.type === "attributes") {
        if (config.attributeFilter) {
          if (config.attributeFilter.includes(mutation.attributeName || "")) {
            return true;
          }
        } else {
          return true;
        }
      }

      if (config.characterData && mutation.type === "characterData") {
        return true;
      }

      if (config.subtree && mutation.type === "childList") {
        return true;
      }

      return false;
    });

    callback(filteredMutations);
  };
  // Create an observer instance linked to the callback function
  const observer = new MutationObserver(mutationCallback);

  // Start observing the target element with the configured options
  observer.observe(element, config);

  // Return the observer instance in case you need to stop observing later
  return observer;
}

enum NodeType {
  Text = "Text",
  HTMLElement = "HTMLElement",
}

type ElementState = HTMLElementState | TextState;
interface HTMLElementState {
  nodeType: NodeType.HTMLElement;
  tagName: string;
  attributes: { [key: string]: string };
  children: ElementState[];
}
interface TextState {
  nodeType: NodeType.Text;
  textContent: string;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function updateStateWithMutation(
  state: ElementState,
  mutations: MutationRecord[]
): ElementState {
  let newState = deepClone(state);
  mutations.forEach((mutation) => {
    switch (mutation.type) {
      case "attributes":
        updateAttributes(newState, mutation);
        break;
      case "childList":
        updateChildList(newState, mutation);
        break;
      case "characterData":
        updateCharacterData(newState, mutation);
        break;
    }
  });

  return newState;
}

function updateAttributes(state: ElementState, mutation: MutationRecord) {
  if (state.nodeType === NodeType.Text) {
    return;
  }
  if (mutation.target instanceof HTMLElement) {
    const attributeName = mutation.attributeName!;
    const attributeValue = mutation.target.getAttribute(attributeName);
    if (attributeValue !== null) {
      state.attributes[attributeName] = attributeValue;
    } else {
      delete state.attributes[attributeName];
    }
  }
}

function updateChildList(state: ElementState, mutation: MutationRecord) {
  if (state.nodeType === NodeType.Text) {
    return;
  }

  if (mutation.removedNodes.length) {
    mutation.removedNodes.forEach((node) => {
      if (!isValidNode(node)) {
        return;
      }
      const nodeState = constructInitialState(node);
      const indexToRemove = state.children.findIndex((child) =>
        areStatesEqual(child, nodeState)
      );
      if (indexToRemove === -1) {
        // console.log("[remove] returning early!");
        return;
      }

      state.children.splice(indexToRemove, 1);
    });
  }

  if (mutation.addedNodes.length) {
    mutation.addedNodes.forEach((node: Node) => {
      if (!isValidNode(node)) {
        return;
      }
      // check to make sure this node is not already added.
      const nodeState = constructInitialState(node);
      if (state.children.find((child) => areStatesEqual(child, nodeState))) {
        // console.log("[add] returning early!");
        return;
      }

      state.children.push(nodeState);
    });
  }
}
function updateCharacterData(state: ElementState, mutation: MutationRecord) {
  const target = mutation.target;
  switch (state.nodeType) {
    case NodeType.Text:
      if (target instanceof Text) {
        state.textContent = target.textContent || "";
        return true;
      }
      break;
    case NodeType.HTMLElement:
      break;
  }

  return false;
}

function isValidNode(node: Node): node is HTMLElement | Text {
  return node instanceof HTMLElement || node instanceof Text;
}

function constructInitialState(element: HTMLElement | Text): ElementState {
  if (element instanceof Text) {
    return {
      nodeType: NodeType.Text,
      textContent: element.textContent || "",
    };
  }

  const state: ElementState = {
    nodeType: NodeType.HTMLElement,
    tagName: element.tagName.toLowerCase(),
    attributes: {},
    children: [],
  };

  // @ts-ignore
  for (const attr of element.attributes) {
    state.attributes[attr.name] = attr.value;
  }

  element.childNodes.forEach((child) => {
    if (isValidNode(child)) {
      state.children.push(constructInitialState(child));
    }
  });

  return state;
}

function updateElementFromState(
  element: HTMLElement | Text,
  newState: ElementState
) {
  // console.log("updating element from state", element, newState);
  updateCharacterDataFromState(element, newState);

  if (newState.nodeType === NodeType.HTMLElement) {
    updateAttributesFromState(element as HTMLElement, newState);

    if (newState.children.length > 0) {
      updateChildrenFromState(element as HTMLElement, newState);
    }
  }
}

function updateCharacterDataFromState(
  element: HTMLElement | Text,
  state: ElementState
) {
  if (!state) {
    return;
  }

  if (state.nodeType === NodeType.Text) {
    if (element.textContent !== state.textContent) {
      element.textContent = state.textContent || "";
    }
  }
  //  Ignore text content for html since its handled by children
}

function updateAttributesFromState(
  element: HTMLElement,
  state: HTMLElementState
) {
  if (!state) {
    return;
  }
  // Set new attributes from state
  for (const [key, value] of Object.entries(state.attributes)) {
    if (element.getAttribute(key) !== value) element.setAttribute(key, value);
  }

  Array.from(element.attributes).forEach((attr) => {
    if (!state.attributes[attr.name]) element.removeAttribute(attr.name);
  });
}

function updateChildrenFromState(
  element: HTMLElement,
  state: HTMLElementState
) {
  // Mapping to track the processed state children
  const processedChildren = new Set<Element | Text>();

  // Update or create elements as necessary
  state.children.forEach((childState) => {
    // @ts-ignore
    let childElement: HTMLElement | Text | undefined = Array.from(
      element.childNodes
    )
      .filter(isValidNode)
      .find(
        (el) =>
          // @ts-ignore
          areStatesEqual(constructInitialState(el), childState) &&
          !processedChildren.has(el)
      );

    if (!childElement) {
      // Create a new child element if not found
      childElement =
        childState.nodeType === NodeType.Text
          ? document.createTextNode(childState.textContent)
          : document.createElement(childState.tagName);
      element.appendChild(childElement);
    }

    processedChildren.add(childElement);
    updateElementFromState(childElement, childState);
  });

  // Remove any remaining unused elements
  Array.from(element.childNodes)
    .filter(isValidNode)
    .forEach((child) => {
      if (!processedChildren.has(child)) {
        element.removeChild(child);
      }
    });
}
