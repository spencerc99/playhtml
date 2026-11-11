// ABOUTME: Recognizes UI the extension injects into host pages and text entry inside it.
// ABOUTME: Lets page observers skip our own DOM and keyboard shortcuts stay quiet while typing.

/**
 * Shadow hosts the extension appends to pages. Each feature mints its own host
 * id, so they are matched by id prefix.
 */
export const EXTENSION_HOST_SELECTOR =
  '[id^="we-were-online"], [id^="wewere-"], [id^="wwo-"], [id^="playhtml-historical-overlay"]';

/** Everything the extension adds to a page's light DOM: shadow hosts plus peer cursors. */
const EXTENSION_PAGE_UI_SELECTOR = `${EXTENSION_HOST_SELECTOR}, .playhtml-cursor-other, #playhtml-cursor-styles`;

/**
 * Closed shadow roots hide their focused element from page-level events, which
 * are retargeted to the host. Hosts holding text inputs register their root
 * here so keyboard shortcuts can still tell when the user is typing in them.
 */
const registeredShadowRoots = new WeakMap<Element, ShadowRoot>();

export function registerExtensionShadowRoot(
  host: Element,
  shadow: ShadowRoot,
): () => void {
  registeredShadowRoots.set(host, shadow);
  return () => {
    if (registeredShadowRoots.get(host) === shadow) {
      registeredShadowRoots.delete(host);
    }
  };
}

/** True when `node` is, or sits inside, UI the extension added to the page. */
export function isExtensionPageUi(node: Node | null): boolean {
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  if (!element) return false;
  return (
    registeredShadowRoots.has(element) ||
    element.closest(EXTENSION_PAGE_UI_SELECTOR) !== null
  );
}

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

function isTextEntry(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has(element.type);
  }
  if (element instanceof HTMLSelectElement) return true;
  return element instanceof HTMLElement && element.isContentEditable;
}

function focusedElementIn(root: ShadowRoot): Element | null {
  let active = root.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

/**
 * True when a keyboard event comes from somewhere the user is typing: a text
 * field on the page, one inside an open shadow root (seen through
 * `composedPath`), or one inside a registered extension shadow root.
 */
export function isTypingEvent(event: Event): boolean {
  for (const target of event.composedPath()) {
    if (!(target instanceof Element)) continue;
    if (isTextEntry(target)) return true;
    const shadow = registeredShadowRoots.get(target);
    if (shadow) {
      const focused = focusedElementIn(shadow);
      if (focused && isTextEntry(focused)) return true;
    }
  }
  return false;
}
