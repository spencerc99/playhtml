// ABOUTME: Implements the can-mirror capability for syncing full DOM element
// ABOUTME: state (attributes, children, form values) across connected clients.

import type { ElementInitializer } from "./index";

// Ephemeral attributes managed via awareness, not Yjs state.
// The MutationObserver must ignore these to avoid polluting
// persistent state with transient per-user presence.
const EPHEMERAL_ATTRS = ["data-playhtml-hover", "data-playhtml-focus"];

enum NodeType {
  Text = "Text",
  HTMLElement = "HTMLElement",
}

export type ElementState = HTMLElementState | TextState;

interface HTMLElementState {
  nodeType: NodeType.HTMLElement;
  tagName: string;
  attributes: { [key: string]: string };
  children: ElementState[];
  // Captures IDL properties that aren't reflected as attributes (checkbox
  // checked, input value, select selectedIndex, etc.)
  formState?: {
    checked?: boolean;
    value?: string;
    selectedIndex?: number;
  };
}

interface TextState {
  nodeType: NodeType.Text;
  textContent: string;
}

export const canMirrorInitializer: ElementInitializer<ElementState> = {
  defaultData: (element: HTMLElement) => constructInitialState(element),
  myDefaultAwareness: { hover: false, focus: false },
  onMount: ({ getElement, setData, setMyAwareness }) => {
    const element = getElement();

    const setDataAny = setData as unknown as (data: any) => void;

    const observer = observeElementChanges(element, (mutations) => {
      // Filter out mutations for ephemeral awareness-managed attributes
      const persistentMutations = mutations.filter(
        (m) =>
          m.type !== "attributes" ||
          !EPHEMERAL_ATTRS.includes(m.attributeName || "")
      );
      if (persistentMutations.length === 0) return;
      setDataAny((draft: any) => {
        applyMutationsInPlace(draft, persistentMutations);
      });
    });
    // Store the observer on the element so updateElement can
    // disconnect it while applying remote state. MutationObserver
    // callbacks are async, so a boolean flag doesn't work.
    (element as any).__playhtml_observer = observer;

    // Sync :hover via awareness (ephemeral, per-user).
    // Style with [data-playhtml-hover] instead of :hover.
    // TODO: auto-duplicate :hover CSS rules to [data-playhtml-hover] via CSSOM
    // so users don't need to manually rewrite their hover styles.
    element.addEventListener("mouseenter", () => {
      setMyAwareness({ hover: true, focus: element.hasAttribute("data-playhtml-focus") });
      element.setAttribute("data-playhtml-hover", "");
    });
    element.addEventListener("mouseleave", () => {
      setMyAwareness({ hover: false, focus: element.hasAttribute("data-playhtml-focus") });
      element.removeAttribute("data-playhtml-hover");
    });

    // Sync :focus via awareness (ephemeral, per-user).
    element.addEventListener("focusin", () => {
      setMyAwareness({ hover: element.hasAttribute("data-playhtml-hover"), focus: true });
      element.setAttribute("data-playhtml-focus", "");
    });
    element.addEventListener("focusout", () => {
      setMyAwareness({ hover: element.hasAttribute("data-playhtml-hover"), focus: false });
      element.removeAttribute("data-playhtml-focus");
    });

    // Sync form element internal state (checked, value, selectedIndex).
    // These IDL properties don't trigger attribute mutations, so we listen
    // for input/change events and push a full state snapshot.
    const syncFormStateRecursive = (
      currentState: HTMLElementState,
      draft: any
    ) => {
      if (currentState.formState) {
        draft.formState = currentState.formState;
      }
      if (currentState.children && draft.children) {
        for (let i = 0; i < currentState.children.length; i++) {
          const childState = currentState.children[i];
          if (
            childState.nodeType === NodeType.HTMLElement &&
            draft.children[i]
          ) {
            syncFormStateRecursive(
              childState as HTMLElementState,
              draft.children[i]
            );
          }
        }
      }
    };
    const syncInputState = () => {
      setDataAny((draft: any) => {
        const current = constructInitialState(element) as HTMLElementState;
        syncFormStateRecursive(current, draft);
        // Also sync children for contenteditable elements where
        // text/child changes fire input events but not attribute
        // mutations visible to the MutationObserver (subtree: false).
        if (current.children) {
          draft.children.splice(0, draft.children.length, ...current.children);
        }
      });
    };
    element.addEventListener("input", syncInputState);
    element.addEventListener("change", syncInputState);
  },
  updateElement: ({ element, data }) => {
    const currentState = constructInitialState(element);
    if (areStatesEqual(currentState, data)) {
      return;
    }
    // Disconnect the MutationObserver while applying remote state
    // to prevent a feedback loop. MutationObserver callbacks are
    // async, so a boolean flag gets cleared before they fire.
    const obs: MutationObserver | undefined =
      (element as any).__playhtml_observer;
    if (obs) {
      obs.takeRecords();
      obs.disconnect();
    }
    updateElementFromState(element, data);
    if (obs) {
      obs.observe(element, {
        childList: true,
        attributes: true,
        subtree: false,
        characterData: true,
      });
    }
  },
  updateElementAwareness: ({ element, awareness }) => {
    // Any client hovering or focusing this element should show
    // the visual indicator on all connected clients.
    const anyHover = awareness.some((a) => a?.hover);
    const anyFocus = awareness.some((a) => a?.focus);
    if (anyHover) {
      element.setAttribute("data-playhtml-hover", "");
    } else {
      element.removeAttribute("data-playhtml-hover");
    }
    if (anyFocus) {
      element.setAttribute("data-playhtml-focus", "");
    } else {
      element.removeAttribute("data-playhtml-focus");
    }
  },
};

// --- State snapshot & comparison ---

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

    // Compare form state (checked, value, selectedIndex)
    const fs1 = state1.formState;
    const fs2 = state2.formState;
    if (fs1 || fs2) {
      if (!fs1 || !fs2) return false;
      if (
        fs1.checked !== fs2.checked ||
        fs1.value !== fs2.value ||
        fs1.selectedIndex !== fs2.selectedIndex
      ) {
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

// --- MutationObserver setup ---

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
  const defaultOptions = {
    childList: true,
    attributes: true,
    subtree: false,
    characterData: true,
  };

  const config = { ...defaultOptions, ...options };

  const mutationCallback = (mutationsList: MutationRecord[]) => {
    const filteredMutations = mutationsList.filter((mutation) => {
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

  const observer = new MutationObserver(mutationCallback);
  observer.observe(element, config);
  return observer;
}

// --- Granular mutation application (Yjs proxy compatible) ---

function applyMutationsInPlace(
  state: ElementState,
  mutations: MutationRecord[]
): void {
  mutations.forEach((mutation) => {
    switch (mutation.type) {
      case "attributes":
        updateAttributes(state, mutation);
        break;
      case "childList":
        updateChildList(state, mutation);
        break;
      case "characterData":
        updateCharacterData(state, mutation);
        break;
    }
  });
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
    } else if (attributeName in state.attributes) {
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
      const nodeState = constructInitialState(node);
      if (state.children.find((child) => areStatesEqual(child, nodeState))) {
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

// --- DOM node helpers ---

function isValidNode(node: Node): node is HTMLElement | Text {
  return node instanceof HTMLElement || node instanceof Text;
}

function captureFormState(
  element: HTMLElement
): HTMLElementState["formState"] | undefined {
  if (element instanceof HTMLInputElement) {
    const state: HTMLElementState["formState"] = {};
    if (element.type === "checkbox" || element.type === "radio") {
      state.checked = element.checked;
    } else {
      state.value = element.value;
    }
    return state;
  }
  if (element instanceof HTMLTextAreaElement) {
    return { value: element.value };
  }
  if (element instanceof HTMLSelectElement) {
    return { selectedIndex: element.selectedIndex, value: element.value };
  }
  return undefined;
}

function constructInitialState(element: HTMLElement | Text): ElementState {
  if (element instanceof Text) {
    return {
      nodeType: NodeType.Text,
      textContent: element.textContent || "",
    };
  }

  const state: HTMLElementState = {
    nodeType: NodeType.HTMLElement,
    tagName: element.tagName.toLowerCase(),
    attributes: {},
    children: [],
  };

  // @ts-ignore
  for (const attr of element.attributes) {
    state.attributes[attr.name] = attr.value;
  }

  // Capture form element IDL properties that aren't reflected as attributes
  const formState = captureFormState(element);
  if (formState) {
    state.formState = formState;
  }

  element.childNodes.forEach((child) => {
    if (isValidNode(child)) {
      state.children.push(constructInitialState(child));
    }
  });

  return state;
}

// --- Applying remote state to DOM ---

function applyFormState(
  element: HTMLElement,
  formState?: HTMLElementState["formState"]
): void {
  if (!formState) return;
  if (element instanceof HTMLInputElement) {
    if (
      (element.type === "checkbox" || element.type === "radio") &&
      formState.checked !== undefined
    ) {
      element.checked = formState.checked;
    } else if (formState.value !== undefined) {
      element.value = formState.value;
    }
  } else if (
    element instanceof HTMLTextAreaElement &&
    formState.value !== undefined
  ) {
    element.value = formState.value;
  } else if (element instanceof HTMLSelectElement) {
    if (formState.selectedIndex !== undefined) {
      element.selectedIndex = formState.selectedIndex;
    }
  }
}

function updateElementFromState(
  element: HTMLElement | Text,
  newState: ElementState
) {
  updateCharacterDataFromState(element, newState);

  if (newState.nodeType === NodeType.HTMLElement) {
    updateAttributesFromState(element as HTMLElement, newState);
    applyFormState(element as HTMLElement, newState.formState);

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
}

function updateAttributesFromState(
  element: HTMLElement,
  state: HTMLElementState
) {
  if (!state) {
    return;
  }
  const attrs: Record<string, string> =
    (state as any).attributes && typeof (state as any).attributes === "object"
      ? ((state as any).attributes as Record<string, string>)
      : {};
  for (const [key, value] of Object.entries(attrs)) {
    if (element.getAttribute(key) !== value) element.setAttribute(key, value);
  }

  Array.from(element.attributes).forEach((attr) => {
    if (!(attr.name in attrs)) element.removeAttribute(attr.name);
  });
}

function updateChildrenFromState(
  element: HTMLElement,
  state: HTMLElementState
) {
  const domChildren = Array.from(element.childNodes).filter(isValidNode);

  // Update existing children in place by position
  const commonLen = Math.min(domChildren.length, state.children.length);
  for (let i = 0; i < commonLen; i++) {
    updateElementFromState(
      domChildren[i] as HTMLElement | Text,
      state.children[i]
    );
  }

  // Append any extra children from state
  for (let i = commonLen; i < state.children.length; i++) {
    const childState = state.children[i];
    const newChild =
      childState.nodeType === NodeType.Text
        ? document.createTextNode(childState.textContent)
        : document.createElement(childState.tagName);
    element.appendChild(newChild);
    updateElementFromState(newChild, childState);
  }

  // Remove excess DOM children
  for (let i = domChildren.length - 1; i >= commonLen; i--) {
    element.removeChild(domChildren[i]);
  }
}
