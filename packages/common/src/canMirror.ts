// ABOUTME: Implements the can-mirror capability for syncing DOM element state
// ABOUTME: such as attributes, direct children, and form values across clients.

import type { ElementInitializer } from "./index";
// Ephemeral attributes managed via awareness, not Yjs state.
// The MutationObserver must ignore these to avoid polluting
// persistent state with transient per-user presence.
const EPHEMERAL_ATTRS = ["data-playhtml-hover", "data-playhtml-focus"];
const LOCAL_CLASS_NAMES = [
  "__playhtml-element",
  "ph-flash",
  "ph-inspect-highlight",
  "ph-inspect-highlight-hover",
  "ph-inspect-selected",
  "playhtml-loading",
];
const LOCAL_LOADING_ATTRIBUTE_VALUES: Record<string, string> = {
  "aria-busy": "true",
  "aria-live": "polite",
};
const CAN_MIRROR_OBSERVER_OPTIONS: MutationObserverInit = {
  childList: true,
  attributes: true,
  subtree: false,
  characterData: true,
};

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

    const observer = observeElementChanges(
      element,
      (mutations) => {
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
      },
      CAN_MIRROR_OBSERVER_OPTIONS,
    );
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
    // for input/change events. Contenteditable typing also lands here, since
    // the observer doesn't watch the subtree. Reconcile against a fresh
    // snapshot and write only what differs: replacing the whole subtree on
    // every keystroke re-sent (and permanently stored) every sibling.
    const syncInputState = (event: Event) => {
      // Fast path: a form control changed. Write just its form state, found by
      // its position, without snapshotting the whole element on every key.
      const target = event.target;
      if (
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement) &&
        !target.isContentEditable
      ) {
        const path = getMirroredPath(element, target);
        const formState = captureFormState(target);
        if (path && formState) {
          let applied = false;
          setDataAny((draft: any) => {
            const node = getStateAtPath(draft, path);
            if (
              node &&
              isHTMLElementState(node) &&
              node.tagName === target.tagName.toLowerCase()
            ) {
              reconcileFormStateInPlace(node, formState);
              applied = true;
            }
          });
          if (applied) return;
        }
      }
      const current = constructInitialState(element);
      setDataAny((draft: any) => {
        reconcileStateInPlace(draft, current);
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
      obs.observe(element, CAN_MIRROR_OBSERVER_OPTIONS);
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

    const attrs1 = getMirroredAttributes(state1.attributes);
    const attrs2 = getMirroredAttributes(state2.attributes);
    if (Object.keys(attrs1).length !== Object.keys(attrs2).length) {
      return false;
    }

    for (const [key, value] of Object.entries(attrs1)) {
      if (attrs2[key] !== value) {
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

    const children1 = getMirroredChildStates(state1.children);
    const children2 = getMirroredChildStates(state2.children);
    if (children1.length !== children2.length) {
      return false;
    }

    for (let i = 0; i < children1.length; i++) {
      if (!areStatesEqual(children1[i], children2[i])) {
        return false;
      }
    }
  }

  return true;
}

// --- MutationObserver setup ---

export function observeElementChanges(
  element: HTMLElement,
  callback: (mutations: MutationRecord[]) => void,
  options: MutationObserverInit,
): MutationObserver {
  const observer = new MutationObserver(callback);
  observer.observe(element, options);
  return observer;
}

// --- Granular mutation application (Yjs proxy compatible) ---

function applyMutationsInPlace(
  state: ElementState,
  mutations: MutationRecord[]
): void {
  // updateChildList resyncs a target's whole child list from the live DOM, so
  // one pass per target covers every childList record for it. Running it per
  // record made bulk edits quadratic (200 appends took about a second).
  const childListTargets = new Set<Node>();
  mutations.forEach((mutation) => {
    switch (mutation.type) {
      case "attributes":
        updateAttributes(state, mutation);
        break;
      case "childList":
        if (childListTargets.has(mutation.target)) break;
        childListTargets.add(mutation.target);
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
    const context = getMirrorContextFromElement(mutation.target);
    if (attributeValue !== null) {
      const mirroredValue = getMirroredAttributeValue(
        attributeName,
        attributeValue,
        context,
      );
      if (mirroredValue === null) {
        if (attributeName in state.attributes) {
          delete state.attributes[attributeName];
        }
      } else if (state.attributes[attributeName] !== mirroredValue) {
        state.attributes[attributeName] = mirroredValue;
      }
    } else if (attributeName in state.attributes) {
      delete state.attributes[attributeName];
    }
  }
}

function updateChildList(state: ElementState, mutation: MutationRecord) {
  if (state.nodeType === NodeType.Text) {
    return;
  }

  // Resync the children array from the live DOM by position. The mutation's
  // added/removed nodes can't be matched back to state entries by value,
  // because identical children (e.g. repeated <img> tiles) are
  // indistinguishable — value-matching would dedupe them and drop the wrong
  // entry. The DOM after the mutation is the source of truth for order and
  // count, so rebuild from it. splice() is the only Yjs-proxy-safe way to
  // replace array contents in place.
  if (!(mutation.target instanceof HTMLElement)) {
    return;
  }
  const newChildren: ElementState[] = [];
  mutation.target.childNodes.forEach((child) => {
    if (isMirroredNode(child)) {
      newChildren.push(constructInitialState(child));
    }
  });
  const mirroredCurrentChildren = getMirroredChildStates(state.children);
  if (mirroredCurrentChildren.length !== state.children.length) {
    // Local-only entries slipped into shared state; rewrite from the DOM.
    state.children.splice(0, state.children.length, ...newChildren);
    return;
  }
  reconcileChildrenInPlace(state.children, newChildren);
}

// --- Minimal in-place writes (Yjs proxy compatible) ---

function canReconcileInPlace(a: ElementState, b: ElementState): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (isHTMLElementState(a) && isHTMLElementState(b)) {
    return a.tagName === b.tagName;
  }
  return true;
}

/**
 * Brings `draft` (a shared-state proxy) in line with `next`, writing only the
 * fields that differ. Each write becomes a sync message and stays in the
 * room's saved history, so rewriting unchanged siblings is expensive.
 */
function reconcileStateInPlace(draft: ElementState, next: ElementState): void {
  if (draft.nodeType === NodeType.Text && next.nodeType === NodeType.Text) {
    if (draft.textContent !== next.textContent) {
      draft.textContent = next.textContent;
    }
    return;
  }
  if (!isHTMLElementState(draft) || !isHTMLElementState(next)) return;

  for (const [name, value] of Object.entries(next.attributes)) {
    if (draft.attributes[name] !== value) draft.attributes[name] = value;
  }
  for (const name of Object.keys(draft.attributes)) {
    if (!(name in next.attributes)) delete draft.attributes[name];
  }

  reconcileFormStateInPlace(draft, next.formState);
  reconcileChildrenInPlace(draft.children, next.children);
}

function reconcileFormStateInPlace(
  draft: HTMLElementState,
  next: HTMLElementState["formState"],
): void {
  if (!next) {
    if (draft.formState) delete draft.formState;
    return;
  }
  if (!draft.formState) {
    draft.formState = { ...next };
    return;
  }
  const fields = ["checked", "value", "selectedIndex"] as const;
  for (const field of fields) {
    const value = next[field];
    if (value === undefined) {
      if (field in draft.formState) delete draft.formState[field];
    } else if (draft.formState[field] !== value) {
      (draft.formState as Record<string, unknown>)[field] = value;
    }
  }
}

/** Child indexes (among mirrored nodes) from `root` down to `target`. */
function getMirroredPath(root: HTMLElement, target: Node): number[] | null {
  const path: number[] = [];
  let node: Node = target;
  while (node !== root) {
    const parent = node.parentNode;
    if (!parent || !isMirroredNode(node)) return null;
    let index = 0;
    for (const sibling of Array.from(parent.childNodes)) {
      if (sibling === node) break;
      if (isMirroredNode(sibling)) index += 1;
    }
    path.unshift(index);
    node = parent;
  }
  return path;
}

function getStateAtPath(
  state: ElementState,
  path: number[],
): ElementState | undefined {
  let node: ElementState | undefined = state;
  for (const index of path) {
    if (!node || !isHTMLElementState(node)) return undefined;
    node = node.children[index];
  }
  return node;
}

/**
 * Updates a shared children array to match `next`: unchanged children at the
 * start and end are left alone, same-kind children in the changed middle are
 * updated in place, and only the rest is spliced. Appending one item to a
 * long list then sends one item, not the whole list.
 */
function reconcileChildrenInPlace(
  children: ElementState[],
  next: ElementState[],
): void {
  let start = 0;
  while (
    start < children.length &&
    start < next.length &&
    areStatesEqual(children[start], next[start])
  ) {
    start += 1;
  }
  let endOld = children.length;
  let endNew = next.length;
  while (
    endOld > start &&
    endNew > start &&
    areStatesEqual(children[endOld - 1], next[endNew - 1])
  ) {
    endOld -= 1;
    endNew -= 1;
  }
  if (start === endOld && start === endNew) return;

  const oldCount = endOld - start;
  const newCount = endNew - start;
  if (oldCount === newCount) {
    let allInPlace = true;
    for (let i = 0; i < oldCount; i++) {
      if (!canReconcileInPlace(children[start + i], next[start + i])) {
        allInPlace = false;
        break;
      }
    }
    if (allInPlace) {
      for (let i = 0; i < oldCount; i++) {
        reconcileStateInPlace(children[start + i], next[start + i]);
      }
      return;
    }
  }
  children.splice(start, oldCount, ...next.slice(start, endNew));
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

function isLocalNode(node: Node): boolean {
  return (
    node instanceof HTMLElement && node.classList.contains("ph-inspect-label")
  );
}

function isMirroredNode(node: Node): node is HTMLElement | Text {
  return isValidNode(node) && !isLocalNode(node);
}

function hasClassValue(value: string | undefined, className: string): boolean {
  return Boolean(value?.split(/\s+/).includes(className));
}

function isLocalElementState(state: ElementState): boolean {
  return (
    state.nodeType === NodeType.HTMLElement &&
    hasClassValue(state.attributes.class, "ph-inspect-label")
  );
}

function getMirroredChildStates(children: ElementState[]): ElementState[] {
  return children.filter((child) => !isLocalElementState(child));
}

interface MirrorContext {
  classValue?: string;
  localClassNames: Set<string>;
}

function getLocalClassNames(
  classValue?: string,
  loadingClass?: string | null,
): Set<string> {
  const classNames = new Set(LOCAL_CLASS_NAMES);
  if (loadingClass && hasClassValue(classValue, "playhtml-loading")) {
    classNames.add(loadingClass);
  }
  return classNames;
}

function getMirrorContextFromElement(element: HTMLElement): MirrorContext {
  const classValue = element.getAttribute("class") || undefined;
  return {
    classValue,
    localClassNames: getLocalClassNames(
      classValue,
      element.getAttribute("loading-class"),
    ),
  };
}

function getMirrorContextFromAttributes(
  attributes: Record<string, string>,
): MirrorContext {
  return {
    classValue: attributes.class,
    localClassNames: getLocalClassNames(
      attributes.class,
      attributes["loading-class"],
    ),
  };
}

function isLocalAttribute(
  name: string,
  value: string,
  context: MirrorContext,
): boolean {
  if (EPHEMERAL_ATTRS.includes(name)) {
    return true;
  }
  return (
    hasClassValue(context.classValue, "playhtml-loading") &&
    LOCAL_LOADING_ATTRIBUTE_VALUES[name] === value
  );
}

function getMirroredAttributeValue(
  name: string,
  value: string,
  context: MirrorContext,
): string | null {
  if (isLocalAttribute(name, value, context)) {
    return null;
  }
  if (name === "class") {
    const mirroredClassValue = getMirroredClassValue(
      value,
      context.localClassNames,
    );
    return mirroredClassValue || null;
  }
  return value;
}

function getMirroredAttributes(
  attributes: Record<string, string>,
): Record<string, string> {
  const mirrored: Record<string, string> = {};
  const context = getMirrorContextFromAttributes(attributes);
  for (const [name, value] of Object.entries(attributes)) {
    const mirroredValue = getMirroredAttributeValue(name, value, context);
    if (mirroredValue !== null) {
      mirrored[name] = mirroredValue;
    }
  }
  return mirrored;
}

function getMirroredClassValue(
  value: string,
  localClassNames: Set<string>,
): string {
  return value
    .split(/\s+/)
    .filter((className) => className && !localClassNames.has(className))
    .join(" ");
}

function getLocalClassValue(
  value: string,
  localClassNames: Set<string>,
): string {
  return value
    .split(/\s+/)
    .filter((className) => localClassNames.has(className))
    .join(" ");
}

function mergeClassValue(
  mirroredValue: string,
  currentValue: string,
  localClassNames: Set<string>,
): string {
  const classNames = [
    ...mirroredValue.split(/\s+/).filter(Boolean),
    ...getLocalClassValue(currentValue, localClassNames)
      .split(/\s+/)
      .filter(Boolean),
  ];
  return Array.from(new Set(classNames)).join(" ");
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
  const context = getMirrorContextFromElement(element);
  for (const attr of element.attributes) {
    const mirroredValue = getMirroredAttributeValue(
      attr.name,
      attr.value,
      context,
    );
    if (mirroredValue !== null) {
      state.attributes[attr.name] = mirroredValue;
    }
  }

  // Capture form element IDL properties that aren't reflected as attributes
  const formState = captureFormState(element);
  if (formState) {
    state.formState = formState;
  }

  element.childNodes.forEach((child) => {
    if (isMirroredNode(child)) {
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

    // Always reconcile children, even when the target state has none: an
    // element that was emptied remotely must have its stale DOM children
    // removed. updateChildrenFromState handles the empty case.
    updateChildrenFromState(element as HTMLElement, newState);
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
      ? getMirroredAttributes((state as any).attributes as Record<string, string>)
      : {};
  const context = getMirrorContextFromElement(element);
  for (const [key, value] of Object.entries(attrs)) {
    const nextValue =
      key === "class"
        ? mergeClassValue(
            value,
            element.getAttribute("class") || "",
            context.localClassNames,
          )
        : value;
    if (element.getAttribute(key) !== nextValue) {
      element.setAttribute(key, nextValue);
    }
  }

  Array.from(element.attributes).forEach((attr) => {
    if (isLocalAttribute(attr.name, attr.value, context)) {
      return;
    }
    if (attr.name === "class") {
      const localClassValue = getLocalClassValue(
        attr.value,
        context.localClassNames,
      );
      if (!("class" in attrs) && localClassValue) {
        element.setAttribute("class", localClassValue);
        return;
      }
    }
    if (!(attr.name in attrs)) element.removeAttribute(attr.name);
  });
}

function createNodeForState(state: ElementState): HTMLElement | Text {
  return state.nodeType === NodeType.Text
    ? document.createTextNode(state.textContent)
    : document.createElement(state.tagName);
}

// A DOM node can be updated in place from a state entry only if they are the
// same kind of node — same nodeType, and for elements the same tag. Otherwise
// the node must be replaced, because updating an element's attributes against
// text state (or vice versa) is meaningless and throws.
function canUpdateInPlace(node: HTMLElement | Text, state: ElementState) {
  if (state.nodeType === NodeType.Text) {
    return node instanceof Text;
  }
  return (
    node instanceof HTMLElement &&
    node.tagName.toLowerCase() === state.tagName
  );
}

function updateChildrenFromState(
  element: HTMLElement,
  state: HTMLElementState
) {
  const domChildren = Array.from(element.childNodes).filter(isMirroredNode);
  const childStates = getMirroredChildStates(state.children);

  // Reconcile existing children in place by position, replacing any whose
  // kind no longer matches the target state.
  const commonLen = Math.min(domChildren.length, childStates.length);
  for (let i = 0; i < commonLen; i++) {
    const domChild = domChildren[i] as HTMLElement | Text;
    const childState = childStates[i];
    if (canUpdateInPlace(domChild, childState)) {
      updateElementFromState(domChild, childState);
    } else {
      const replacement = createNodeForState(childState);
      element.replaceChild(replacement, domChild);
      updateElementFromState(replacement, childState);
    }
  }

  // Append any extra children from state
  for (let i = commonLen; i < childStates.length; i++) {
    const childState = childStates[i];
    const newChild = createNodeForState(childState);
    const localChild = Array.from(element.childNodes).find(isLocalNode);
    element.insertBefore(newChild, localChild ?? null);
    updateElementFromState(newChild, childState);
  }

  // Remove excess DOM children
  for (let i = domChildren.length - 1; i >= commonLen; i--) {
    element.removeChild(domChildren[i]);
  }
}
