// ABOUTME: Finds which play elements a Yjs transaction touched, so bridge fan-out
// ABOUTME: only forwards shared elements that actually changed.
import * as Y from "yjs";

// "*" marks a change we can't pin to specific elements (the play map itself
// was replaced or a whole tag map changed). Callers treat it as "everything".
export const AllElements = "*";

/**
 * Collects the element ids under doc.play[tag][elementId] that a transaction
 * changed. A change anywhere inside an element's value counts for that
 * element. Changes outside the play map (page data, other roots) add nothing.
 */
export function collectChangedPlayElementIds(
  transaction: Y.Transaction,
  playMap: Y.AbstractType<any>,
  into: Set<string> = new Set(),
): Set<string> {
  transaction.changed.forEach((keys, type) => {
    if (type === playMap) {
      // A tag map was added, replaced or removed.
      into.add(AllElements);
      return;
    }
    // Climb to the play map, remembering the key under the tag map.
    let node: Y.AbstractType<any> = type;
    let childKey: string | null = null;
    while (node) {
      const parent = node._item?.parent as Y.AbstractType<any> | undefined;
      if (node === playMap) return;
      if (parent === playMap) {
        // `node` is a tag map. Changed keys on it directly are element ids;
        // otherwise the change came from inside the element at childKey.
        if (childKey !== null) {
          into.add(childKey);
        } else {
          keys.forEach((key) => {
            if (key !== null) into.add(key);
          });
        }
        return;
      }
      if (!parent) return; // Not under the play map.
      childKey = node._item?.parentSub ?? null;
      node = parent;
    }
  });
  return into;
}

/** True when any of `elementIds` changed, or the change can't be narrowed. */
export function touchesAny(
  changed: ReadonlySet<string>,
  elementIds: readonly string[],
): boolean {
  if (changed.has(AllElements)) return true;
  return elementIds.some((id) => changed.has(id));
}
