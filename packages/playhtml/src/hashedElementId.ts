// ABOUTME: Gives an element with no id or selector-id one stable id hashed from its HTML.
// ABOUTME: Also lists the ids such an element could have been saved under before, per capability.
import { hashHtml } from "./utils";

export interface HashedElementId {
  /** The element's id, shared by all of its capabilities. */
  id: Promise<string>;
  /**
   * The other ids the element's data for `tag` may already be saved under,
   * most likely first. Hashed on first call.
   */
  previousIds(tag: string): Promise<string[]>;
}

export interface LoadingMarks {
  /** Applies the loading class and attributes an element carries before sync. */
  mark(element: HTMLElement): void;
  /** Removes them again. */
  clear(element: HTMLElement): void;
}

const LOADING_CLASS = "playhtml-loading";
const hashedIdByElement = new WeakMap<HTMLElement, HashedElementId>();

// Copies are built in a document that never renders, runs scripts or loads
// resources. One is enough for every element.
let inertDocument: Document | undefined;

/** The hashed id already given to `element`, if it got one. */
export function findHashedElementId(
  element: HTMLElement,
): HashedElementId | undefined {
  return hashedIdByElement.get(element);
}

/**
 * The HTML of `element` as it reads while loading and once ready.
 *
 * An element on the page at load is hashed while it carries the loading marks;
 * one added later is hashed without them. Both forms are built off the live
 * element, in an inert document, so nothing observes the changes and no
 * resource loads.
 */
function loadingAndReadyHtml(
  element: HTMLElement,
  marks: LoadingMarks,
): { loading: string; ready: string } {
  const current = element.outerHTML;
  inertDocument ??= document.implementation.createHTMLDocument("");
  const inert = inertDocument;
  const shell = inert.importNode(element, false) as HTMLElement;

  // Rebuilds the full HTML from a childless copy by putting the live
  // element's children back in front of the closing tag.
  const closingTag = `</${element.localName}>`;
  const withChildren = (copy: HTMLElement): string => {
    const html = copy.outerHTML;
    if (!html.endsWith(closingTag)) return html;
    return (
      html.slice(0, html.length - closingTag.length) +
      element.innerHTML +
      closingTag
    );
  };

  let copy = shell;
  let serialize = withChildren;
  if (withChildren(shell) !== current) {
    // Elements whose markup doesn't split cleanly (templates, foreign content)
    // are copied whole instead.
    copy = inert.importNode(element, true) as HTMLElement;
    serialize = (deepCopy) => deepCopy.outerHTML;
  }

  const wasLoading = element.classList.contains(LOADING_CLASS);
  let loading = current;
  let ready = current;
  if (wasLoading) {
    marks.clear(copy);
    if (copy.getAttribute("class") === "") copy.removeAttribute("class");
    ready = serialize(copy);
  } else {
    marks.mark(copy);
    loading = serialize(copy);
  }
  return { loading, ready };
}

/**
 * Returns the hashed id for an element that has no id of its own. The first
 * call reads the element's HTML, so it must run before playhtml changes the
 * element (its id, classes or styles). Later calls return the same result.
 *
 * `tags` are the element's capabilities in setup order. The id is the one the
 * first capability gets on a normal page load, so every capability shares it
 * and it is the same whether the element was on the page at load or added
 * afterwards.
 */
export function getHashedElementId(
  element: HTMLElement,
  tags: string[],
  marks: LoadingMarks,
): HashedElementId {
  const existing = hashedIdByElement.get(element);
  if (existing) return existing;

  const { loading, ready } = loadingAndReadyHtml(element, marks);
  const id = hashHtml(tags[0], loading);

  let hashesByTag: Promise<Map<string, string[]>> | undefined;
  const previousIds = async (tag: string): Promise<string[]> => {
    hashesByTag ??= (async () => {
      const forms = loading === ready ? [loading] : [loading, ready];
      const hashes = new Map<string, string[]>();
      await Promise.all(
        tags.map(async (elementTag) => {
          hashes.set(
            elementTag,
            await Promise.all(forms.map((html) => hashHtml(elementTag, html))),
          );
        }),
      );
      return hashes;
    })();
    const [currentId, hashes] = await Promise.all([id, hashesByTag]);
    // A capability's data sits under its own hash after a normal load. After
    // a re-setup, or for a capability added to the element later, it sits
    // under whichever hash was the element's id then, so the other
    // capabilities' hashes come next, last one first.
    const candidates = [
      ...(hashes.get(tag) ?? []),
      ...tags
        .filter((other) => other !== tag)
        .reverse()
        .flatMap((other) => hashes.get(other)!),
    ];
    return Array.from(new Set(candidates)).filter(
      (candidate) => candidate !== currentId,
    );
  };

  const hashed: HashedElementId = { id, previousIds };
  hashedIdByElement.set(element, hashed);
  return hashed;
}
