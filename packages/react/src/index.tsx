// TODO: idk why but this is not getting registered otherwise??
import React, { PropsWithChildren } from "react";
import { useEffect, useRef, useState } from "react";
import {
  ElementInitializer,
  TagType,
  TagTypeToElement,
  ElementAwarenessEventHandlerData,
} from "@playhtml/common";
import playhtml from "./playhtml-singleton";
import classNames from "classnames";
import * as ReactIs from "react-is";

type ReactElementEventHandlerData<T, V> = Omit<
  ElementAwarenessEventHandlerData<T, any, V>,
  "localData" | "setLocalData" | "element"
> & { ref: React.RefObject<HTMLElement> };

interface PlayableChildren<T = any, V = any> {
  children: (data: ReactElementEventHandlerData<T, V>) => React.ReactElement;
}

// NOTE: localData is not included because you can handle that purely within your parent React component since it doesn't need to handle any
// syncing logic.
type ReactElementInitializer<T = any, V = any> = Omit<
  ElementInitializer<T, any, V>,
  | "updateElement"
  | "defaultData"
  | "defaultLocalData"
  | "myDefaultAwareness"
  | "updateElementAwareness"
> & {
  defaultData: T;
  myDefaultAwareness?: V;
} & PlayableChildren<T, V>;

function getCurrentElementHandler(tag: TagType, id: string) {
  return playhtml.elementHandlers?.get(tag)?.get(id);
}

function cloneThroughFragments<P = any>(
  element: React.ReactElement<P>,
  props: PropsWithChildren<P>
): React.ReactElement<P> {
  if (ReactIs.isFragment(element)) {
    return (
      <>
        {[
          // if given fragment render an empty div to be our "play info" holder.
          <div {...props}></div>,
          React.Children.toArray(
            // @ts-ignore
            element.props["children"] || []
          ),
        ]}
      </>
    );
  }

  return React.cloneElement(element, props);
}

// TODO: make the mapping to for TagType -> ReactElementInitializer
export function CanPlayElement<T, V>({
  tagInfo,
  children,
  ...elementProps
}: ReactElementInitializer<T, V> & {
  tagInfo?: Partial<{ [k in TagType]: string }>;
}) {
  const computedTagInfo = tagInfo || { "can-play": "" };
  const ref = useRef<HTMLElement>(null);
  const { defaultData, myDefaultAwareness } = elementProps;
  const [data, setData] = useState<T>(defaultData);
  const [awareness, setAwareness] = useState<V[]>(
    myDefaultAwareness ? [myDefaultAwareness] : []
  );
  const [myAwareness, setMyAwareness] = useState<V | undefined>(
    myDefaultAwareness
  );

  // TODO: this is kinda a hack but it works for now since it is called whenever we set data.
  const updateElement: ElementInitializer["updateElementAwareness"] = ({
    data: newData,
    awareness: newAwareness,
    myAwareness,
  }) => {
    setData(newData);
    setAwareness(newAwareness);
    setMyAwareness(myAwareness);
  };

  useEffect(() => {
    if (ref.current) {
      console.log(elementProps);
      for (const [key, value] of Object.entries(elementProps)) {
        // @ts-ignore
        ref.current[key] = value;
      }
      // @ts-ignore
      ref.current.updateElement = updateElement;
      // @ts-ignore
      ref.current.updateElementAwareness = updateElement;
      // TODO: how to handle if you are importing from unpkg too?
      playhtml.setupPlayElement(ref.current, { ignoreIfAlreadySetup: true });
      const existingData = playhtml.globalData
        ?.get("can-play")
        ?.get(ref.current.id);
      if (existingData) {
        setData(existingData);
      }
    }

    return () => playhtml.removePlayElement(ref.current);
  }, [elementProps]);

  return cloneThroughFragments(
    React.Children.only(
      children({
        data,
        awareness,
        setData: (newData) => {
          // console.log("settingdata", newData);
          // console.log(
          //   getCurrentElementHandler(TagType.CanPlay, ref.current?.id || "")
          // );
          getCurrentElementHandler(
            TagType.CanPlay,
            ref.current?.id || ""
          )?.setData(newData);
        },
        setLocalAwareness: (newLocalAwareness) => {
          getCurrentElementHandler(
            TagType.CanPlay,
            ref.current?.id || ""
          )?.setLocalAwareness(newLocalAwareness);
        },
        myAwareness,
        ref,
      })
    ),
    {
      ref,
      ...computedTagInfo,
    }
  );
}
/**
 * @deprecated use CanPlayElement instead
 */
export const Playable = CanPlayElement;

type SingleChildOrPlayable<T = any, V = any> =
  | React.ReactElement
  | PlayableChildren<T, V>["children"];

function renderSingleChildOrPlayable<T, V>(
  children: SingleChildOrPlayable<T, V>,
  data: ReactElementEventHandlerData<T, V>
): React.ReactElement {
  if (typeof children === "function") {
    return children(data);
  } else {
    return children;
  }
}

export function CanMoveElement({
  children,
}: {
  children: SingleChildOrPlayable;
}) {
  return (
    <CanPlayElement
      {...TagTypeToElement[TagType.CanMove]}
      children={(renderData) => {
        const { data } = renderData;
        const renderedChildren = renderSingleChildOrPlayable(
          children,
          renderData
        );
        return React.cloneElement(
          React.Children.only(renderedChildren) as any,
          {
            style: { transform: `translate(${data.x}px, ${data.y}px)` },
          }
        );
      }}
    />
  );
}

export function CanToggleElement({
  children,
}: {
  children: SingleChildOrPlayable;
}) {
  return (
    <CanPlayElement
      {...TagTypeToElement[TagType.CanToggle]}
      // TODO: decide whether to use existing html render logic or convert fully to react.
      // tagInfo={{ [TagType.CanToggle]: "" }}
      children={(renderData) => {
        const renderedChildren = renderSingleChildOrPlayable(
          children,
          renderData
        );
        const on =
          typeof renderData.data === "boolean"
            ? renderData.data
            : renderData.data.on;
        return React.cloneElement(
          React.Children.only(renderedChildren) as any,
          {
            className: classNames(
              renderedChildren?.props?.className,
              on ? "clicked" : ""
            ),
          }
        );
      }}
    />
  );
}

export function CanSpinElement({
  children,
}: {
  children: SingleChildOrPlayable;
}) {
  return (
    <CanPlayElement
      {...TagTypeToElement[TagType.CanSpin]}
      children={(renderData) => {
        const { data } = renderData;
        const renderedChildren = renderSingleChildOrPlayable(
          children,
          renderData
        );
        return React.cloneElement(
          React.Children.only(renderedChildren) as any,
          {
            style: { transform: `rotate(${data.rotation}deg)` },
          }
        );
      }}
    />
  );
}

export function CanGrowElement({
  children,
}: {
  children: SingleChildOrPlayable;
}) {
  return (
    <CanPlayElement
      {...TagTypeToElement[TagType.CanSpin]}
      children={(renderData) => {
        const { data } = renderData;
        const renderedChildren = renderSingleChildOrPlayable(
          children,
          renderData
        );
        return React.cloneElement(
          React.Children.only(renderedChildren) as any,
          {
            style: { transform: `scale(${data.scale}deg)` },
          }
        );
      }}
    />
  );
}

export function CanDuplicateElement({
  children,
  elementToDuplicate,
  canDuplicateTo,
}: {
  children: SingleChildOrPlayable;
  elementToDuplicate: React.RefObject<HTMLElement>;
  canDuplicateTo?: React.RefObject<HTMLElement>;
}) {
  const [addedElements, setAddedElements] = useState<string[]>([]);

  return (
    <CanPlayElement
      {...TagTypeToElement[TagType.CanDuplicate]}
      children={(renderData) => {
        const { data } = renderData;
        let lastElement: HTMLElement | null =
          document.getElementById(addedElements.slice(-1)?.[0]) ?? null;
        if (!elementToDuplicate?.current) {
          console.error(
            `Element ${elementToDuplicate} not found. Cannot duplicate.`
          );
          return renderSingleChildOrPlayable(children, renderData);
        }

        const eleToDuplicate = elementToDuplicate.current;

        function insertDuplicatedElement(newElement: Node) {
          if (canDuplicateTo?.current) {
            const duplicateToElement = canDuplicateTo.current;
            if (duplicateToElement) {
              duplicateToElement.appendChild(newElement);
              return;
            }
          }

          // By default insert after the latest element inserted (or the element to duplicate if none yet)
          eleToDuplicate!.parentNode!.insertBefore(
            newElement,
            (lastElement || eleToDuplicate!).nextSibling
          );
        }

        const addedElementsSet = new Set(addedElements);
        for (const elementId of data) {
          if (addedElementsSet.has(elementId)) continue;

          const newElement = eleToDuplicate.cloneNode(true) as HTMLElement;
          Object.assign(newElement, { ...elementToDuplicate });
          newElement.id = elementId;

          insertDuplicatedElement(newElement);
          addedElements.push(elementId);
          playhtml.setupPlayElement(newElement);
          lastElement = newElement;
        }
        setAddedElements(addedElements);

        return renderSingleChildOrPlayable(children, renderData);
      }}
    />
  );
}

export function CanHoverElement({
  children,
}: {
  children: SingleChildOrPlayable;
}) {
  return (
    <CanPlayElement
      {...{
        defaultData: {},
        myDefaultAwareness: { isHovering: false },
        additionalSetup: ({ setLocalAwareness, getElement }) => {
          const element = getElement();
          element.addEventListener("mouseover", () => {
            setLocalAwareness({ isHovering: true });
          });
          element.addEventListener("mouseout", () => {
            setLocalAwareness({ isHovering: false });
          });
        },
      }}
      children={(renderData) => {
        const { awareness } = renderData;
        const renderedChildren = renderSingleChildOrPlayable(
          children,
          renderData
        );

        return React.cloneElement(
          React.Children.only(renderedChildren) as any,
          {
            className: classNames(
              renderedChildren?.props?.className,
              awareness.some((ele) => ele.isHovering) ? "hovering" : ""
            ),
          }
        );
      }}
    />
  );
}

export { playhtml };
export { PlayProvider } from "./PlayProvider";
