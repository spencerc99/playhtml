import { TagTypeToElement, TagType } from "@playhtml/common";
import classNames from "classnames";
import React, { useState } from "react";
import { CanPlayElement, WithPlayOptionalProps } from ".";
import playhtml from "./playhtml-singleton";
import { SingleChildOrPlayable, renderSingleChildOrPlayable } from "./utils";

export function CanMoveElement({
  children,
  dataSource,
  shared,
}: { children: SingleChildOrPlayable } & WithPlayOptionalProps) {
  return (
    <CanPlayElement
      // @ts-ignore
      tagInfo={[TagType.CanMove]}
      {...TagTypeToElement[TagType.CanMove]}
      {...(dataSource ? { dataSource } : {})}
      {...(shared ? { shared } : {})}
      children={(renderData) => {
        const renderedChildren = renderSingleChildOrPlayable(
          children,
          renderData
        );
        return renderedChildren;
      }}
    />
  );
}

export function CanToggleElement({
  children,
  dataSource,
  shared,
  readOnly,
}: { children: SingleChildOrPlayable } & WithPlayOptionalProps & {
    readOnly?: boolean;
  }) {
  return (
    <CanPlayElement
      // @ts-ignore
      tagInfo={[TagType.CanToggle]}
      {...TagTypeToElement[TagType.CanToggle]}
      {...(dataSource ? { dataSource } : {})}
      {...(shared ? { shared } : {})}
      {...(readOnly ? { "data-source-read-only": "" } : {})}
      children={(renderData) => {
        const renderedChildren = renderSingleChildOrPlayable(
          children,
          renderData
        );
        return renderedChildren;
      }}
    />
  );
}

export function CanSpinElement({
  children,
  dataSource,
  shared,
}: { children: SingleChildOrPlayable } & WithPlayOptionalProps) {
  return (
    <CanPlayElement
      // @ts-ignore
      tagInfo={[TagType.CanSpin]}
      {...TagTypeToElement[TagType.CanSpin]}
      {...(dataSource ? { dataSource } : {})}
      {...(shared ? { shared } : {})}
      children={(renderData) => {
        const renderedChildren = renderSingleChildOrPlayable(
          children,
          renderData
        );
        return renderedChildren;
      }}
    />
  );
}

export function CanGrowElement({
  children,
  dataSource,
  shared,
}: { children: SingleChildOrPlayable } & WithPlayOptionalProps) {
  return (
    <CanPlayElement
      // @ts-ignore
      tagInfo={[TagType.CanGrow]}
      {...TagTypeToElement[TagType.CanGrow]}
      {...(dataSource ? { dataSource } : {})}
      {...(shared ? { shared } : {})}
      children={(renderData) => {
        const renderedChildren = renderSingleChildOrPlayable(
          children,
          renderData
        );
        return renderedChildren;
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
      // @ts-ignore
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
        onMount: ({ setMyAwareness, getElement }) => {
          const element = getElement();
          element.addEventListener("mouseover", () => {
            setMyAwareness({ isHovering: true });
          });
          element.addEventListener("mouseout", () => {
            setMyAwareness({ isHovering: false });
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
              // TODO: fix these type errors
              // @ts-ignore
              renderedChildren?.props?.className,
              // @ts-ignore
              awareness.some((ele) => ele.isHovering) ? "hovering" : ""
            ),
          }
        );
      }}
    />
  );
}
