import { TagTypeToElement, TagType } from "@playhtml/common";
import { Resizable } from "react-resizable";
import classNames from "classnames";
import React, { useState } from "react";
import { CanPlayElement } from ".";
import playhtml from "./playhtml-singleton";
import { SingleChildOrPlayable, renderSingleChildOrPlayable } from "./utils";
import "../../../node_modules/react-resizable/css/styles.css";

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

export function CanResizeElement({
  children,
  initialWidth,
  initialHeight,
}: {
  children: SingleChildOrPlayable;
  initialWidth?: number;
  initialHeight?: number;
}) {
  return (
    <CanPlayElement
      defaultData={{
        width: initialWidth,
        height: initialHeight,
      }}
      children={(renderData) => {
        const { data, setData } = renderData;
        const { width, height } = data;
        const renderedChildren = renderSingleChildOrPlayable(
          children,
          renderData
        );

        return (
          <Resizable
            width={width || initialWidth || undefined}
            height={height || initialHeight || undefined}
            lockAspectRatio
            onResize={(e, d) => {
              setData({
                width: d.size.width,
                height: d.size.height,
              });
            }}
            children={React.cloneElement(
              React.Children.only(renderedChildren) as any,
              {
                style: {
                  ...renderedChildren?.props.style,
                  width: `${width}px`,
                  height: `${height}px`,
                },
              }
            )}
          ></Resizable>
        );
      }}
    />
  );
}
