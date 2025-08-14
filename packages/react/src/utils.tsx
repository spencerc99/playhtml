import {
  ElementAwarenessEventHandlerData,
  ElementInitializer,
  TagType,
} from "@playhtml/common";
import playhtml from "./playhtml-singleton";
import React, { PropsWithChildren } from "react";

export type ReactElementEventHandlerData<T, V> = Omit<
  ElementAwarenessEventHandlerData<T, any, V>,
  "localData" | "setLocalData" | "element"
> & { ref: React.RefObject<HTMLElement | null> };

export interface PlayableChildren<T = object, V = any> {
  // TODO: force this to return a single child?
  children: (data: ReactElementEventHandlerData<T, V>) => React.ReactElement;
}

// NOTE: localData is not included because you can handle that purely within your parent React component since it doesn't need to handle any
// syncing logic.
export type ReactElementInitializer<T = object, V = any> = Omit<
  ElementInitializer<T, any, V>,
  | "updateElement"
  | "defaultData"
  | "defaultLocalData"
  | "myDefaultAwareness"
  | "updateElementAwareness"
> & {
  defaultData: T;
  myDefaultAwareness?: V;
  id?: string;
} & PlayableChildren<T, V>;

export function getCurrentElementHandler(tag: TagType, id: string) {
  return playhtml.elementHandlers?.get(tag)?.get(id);
}

function isDOMElement(element: React.ReactElement): boolean {
  return typeof element.type === "string";
}

/**
 * Reliable React Fragment detection helper.
 *
 * Background: We discovered that ReactIs.isFragment() was consistently returning false
 * even for valid React Fragments, even with correct react-is@18.3.1 matching react@18.3.1.
 * This was causing Fragment IDs to be lost, resulting in random element IDs instead of
 * the specified ones.
 *
 * This implementation is designed to be robust across React versions and bundling scenarios:
 * 1. Direct comparison with current React.Fragment (same instance)
 * 2. Global symbol registry lookup (cross-instance compatibility)
 * 3. String representation fallback (emergency compatibility)
 * 4. Strict validation to prevent false positives
 *
 * @param element React element to check
 * @returns true if element is a React Fragment, false otherwise (never false positive)
 */
export function isReactFragment(element: React.ReactElement): boolean {
  // Defensive check: must be a valid React element
  if (!element || typeof element !== "object" || !element.type) {
    return false;
  }

  // TypeScript doesn't know that element.type can be a symbol for fragments,
  // so we need to cast it to unknown first to avoid type errors
  const elementType = element.type as unknown;

  // Method 1: Direct comparison with current React.Fragment instance
  // This works when both the element and our code use the same React instance
  if (elementType === React.Fragment) {
    return true;
  }

  // Method 2: Global symbol registry lookup
  // This works across different React instances as long as they use the same symbol
  if (elementType === Symbol.for("react.fragment")) {
    return true;
  }

  // Method 3: Additional robustness - check if it's a symbol and looks like a fragment
  // This handles cases where React versions might use different symbol creation methods
  if (typeof elementType === "symbol") {
    const symbolString = elementType.toString();
    // Only match exact fragment symbols to avoid false positives
    if (
      symbolString === "Symbol(react.fragment)" ||
      symbolString === "Symbol.for(react.fragment)"
    ) {
      return true;
    }
  }

  return false;
}

export function cloneThroughFragments<P = any>(
  element: React.ReactElement<P>,
  props: PropsWithChildren<P>,
  { fragmentId }: { fragmentId?: string } = {}
): React.ReactElement<P> {
  if (isReactFragment(element)) {
    if (!fragmentId) {
      throw new Error(`Fragments must have an id attribute`);
    }

    return (
      <>
        <div id={fragmentId} {...props}></div>
        {
          // if given fragment render an empty div to be our "play info" holder.
          React.Children.toArray(
            // @ts-ignore
            element.props["children"] || []
          )
        }
      </>
    );
  } else if (!isDOMElement(element)) {
    // TODO: FIX this type error
    // @ts-ignore
    return domProps(element, props);
  }

  return React.cloneElement(element, props);
}

// Clones the element in order to pass the props down to the first DOM element it finds
function domProps(
  element: React.ReactElement,
  propsToPass: object,
  isRecursing: boolean = false
): React.ReactElement {
  // Check if the element is a valid React element
  if (!React.isValidElement(element)) {
    return element;
  }

  // If this is already a DOM element, just apply props directly
  if (typeof element.type === "string") {
    return React.cloneElement(element, propsToPass);
  }

  // Keep track of whether props have been passed down
  let propsPassed = false;

  // Clone the element and pass down the props to the first DOM element
  const clonedChildren = React.Children.map(
    (element.props as PropsWithChildren).children,
    (child: React.ReactNode) => {
      // Skip non-React elements (text, numbers, null, etc.)
      if (!React.isValidElement(child)) {
        return child;
      }

      // Check if props have been passed down and if the child is a DOM element
      if (!propsPassed && typeof child.type === "string") {
        propsPassed = true;
        return domProps(child, propsToPass, true);
      }

      // For non-DOM elements, recursively search their children
      if (!propsPassed && typeof child.type !== "string") {
        try {
          const result = domProps(child, propsToPass, true);
          if (result !== child) {
            propsPassed = true;
            return result;
          }
        } catch {
          // Continue searching other children if this one doesn't have DOM elements
        }
      }

      return child;
    }
  );

  // If we still haven't found a DOM element, try a more forgiving approach
  if (!propsPassed && !isRecursing) {
    throw new Error(
      `[@playhtml/react] no DOM element found in children of ${element}. Please ensure that your component has a direct DOM child.`
    );
  }

  const clonedElement = React.cloneElement(element, {
    ...(propsPassed ? {} : propsToPass),
    // @ts-ignore
    children: clonedChildren?.length === 1 ? clonedChildren[0] : clonedChildren,
  });

  return clonedElement;
}

export type SingleChildOrPlayable<T = any, V = any> =
  | React.ReactElement
  | PlayableChildren<T, V>["children"];

export function renderSingleChildOrPlayable<T, V>(
  children: SingleChildOrPlayable<T, V>,
  data: ReactElementEventHandlerData<T, V>
): React.ReactElement {
  if (typeof children === "function") {
    return children(data);
  } else {
    return children;
  }
}
