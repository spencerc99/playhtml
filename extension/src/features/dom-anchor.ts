// ABOUTME: Builds stable CSS selectors for host-page elements used by persistent extension effects.
// ABOUTME: Prefers element ids and falls back to an nth-of-type path rooted at the body.

function escapeIdentifier(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

export function buildStructuralSelector(element: Element): string | null {
  const parts: string[] = [];
  let current: Element | null = element;

  while (
    current &&
    current !== document.body &&
    current !== document.documentElement
  ) {
    if (current.id && /^[a-z][\w-]+$/i.test(current.id)) {
      parts.unshift(`#${escapeIdentifier(current.id)}`);
      return parts.join(" > ");
    }

    const parent: Element | null = current.parentElement;
    if (!parent) return null;

    const tag = current.tagName.toLowerCase();
    let matchingSiblingIndex = 0;
    let currentIndex = -1;
    for (const sibling of Array.from(parent.children)) {
      if (sibling.tagName.toLowerCase() !== tag) continue;
      matchingSiblingIndex += 1;
      if (sibling === current) currentIndex = matchingSiblingIndex;
    }
    if (currentIndex === -1) return null;

    parts.unshift(`${tag}:nth-of-type(${currentIndex})`);
    current = parent;
  }

  parts.unshift("body");
  return parts.join(" > ");
}
