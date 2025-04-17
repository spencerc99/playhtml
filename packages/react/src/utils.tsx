import {
  ElementAwarenessEventHandlerData,
  ElementInitializer,
  TagType,
} from "@playhtml/common";
import playhtml from "./playhtml-singleton";
import React, { PropsWithChildren } from "react";
import ReactIs from "react-is";

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

export function cloneThroughFragments<P = any>(
  element: React.ReactElement<P>,
  props: PropsWithChildren<P>,
  { fragmentId }: { fragmentId?: string } = {}
): React.ReactElement<P> {
  if (ReactIs.isFragment(element)) {
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

  // Keep track of whether props have been passed down
  let propsPassed = false;

  // Clone the element and pass down the props to the first DOM element
  const clonedChildren = React.Children.map(
    (element.props as PropsWithChildren).children,
    (child: React.ReactNode) => {
      // Check if props have been passed down and if the child is a DOM element
      if (
        !propsPassed &&
        React.isValidElement(child) &&
        typeof child.type === "string"
      ) {
        propsPassed = true;
        return domProps(child, propsToPass, true);
      }
      return child;
    }
  );

  if (!propsPassed && !isRecursing) {
    throw new Error(`no DOM element found in children of ${element}`);
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
