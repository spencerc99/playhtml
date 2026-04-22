import {
  CanMoveBounds,
  CanMoveBoundsMinVisible,
  CanMoveBoundsMinVisiblePx,
  TagTypeToElement,
  TagType,
} from "@playhtml/common";
import classNames from "classnames";
import React, { useState } from "react";
import { CanPlayElement, WithPlayOptionalProps } from ".";
import playhtml from "./playhtml-singleton";
import { SingleChildOrPlayable, renderSingleChildOrPlayable } from "./utils";

/**
 * Props for clamping a `can-move` element to a container. Mirrors the
 * `can-move-bounds*` HTML attributes; see the core library for behavior
 * details. The cursor is never clamped — only the element's persisted
 * position is.
 */
export interface CanMoveBoundsProps {
  /** Id or selector of the container to keep the element inside of. */
  bounds?: string;
  /**
   * Fraction (0–1) of the element that must stay inside `bounds`. Default
   * 0.25. `1` pins fully inside, `0` drops the fraction constraint (pixel
   * floor still applies unless also zeroed).
   */
  boundsMinVisible?: number;
  /**
   * Absolute pixel floor on the keep-visible slice (default 60). The
   * effective slice is `max(boundsMinVisible × size, boundsMinVisiblePx)`.
   * Useful when an image has transparent padding around its paint.
   */
  boundsMinVisiblePx?: number;
}

function boundsAttrs({
  bounds,
  boundsMinVisible,
  boundsMinVisiblePx,
}: CanMoveBoundsProps): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (bounds) attrs[CanMoveBounds] = bounds;
  if (boundsMinVisible !== undefined)
    attrs[CanMoveBoundsMinVisible] = String(boundsMinVisible);
  if (boundsMinVisiblePx !== undefined)
    attrs[CanMoveBoundsMinVisiblePx] = String(boundsMinVisiblePx);
  return attrs;
}

export function CanMoveElement({
  children,
  dataSource,
  shared,
  standalone,
  bounds,
  boundsMinVisible,
  boundsMinVisiblePx,
}: { children: SingleChildOrPlayable } & WithPlayOptionalProps &
  CanMoveBoundsProps) {
  const extraAttrs = boundsAttrs({
    bounds,
    boundsMinVisible,
    boundsMinVisiblePx,
  });
  const hasExtraAttrs = Object.keys(extraAttrs).length > 0;
  return (
    <CanPlayElement
      // @ts-ignore
      tagInfo={[TagType.CanMove]}
      {...TagTypeToElement[TagType.CanMove]}
      {...(dataSource ? { dataSource } : {})}
      {...(shared ? { shared } : {})}
      {...(standalone ? { standalone } : {})}
      children={(renderData) => {
        const renderedChildren = renderSingleChildOrPlayable(
          children,
          renderData
        );
        // Clone the user's child to stamp the bounds attributes onto its
        // root DOM element — the same node `can-move` reads during drag.
        if (!hasExtraAttrs || !React.isValidElement(renderedChildren)) {
          return renderedChildren;
        }
        return React.cloneElement(renderedChildren, extraAttrs);
      }}
    />
  );
}

export function CanToggleElement({
  children,
  dataSource,
  shared,
  standalone,
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
      {...(standalone ? { standalone } : {})}
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
  standalone,
}: { children: SingleChildOrPlayable } & WithPlayOptionalProps) {
  return (
    <CanPlayElement
      // @ts-ignore
      tagInfo={[TagType.CanSpin]}
      {...TagTypeToElement[TagType.CanSpin]}
      {...(dataSource ? { dataSource } : {})}
      {...(shared ? { shared } : {})}
      {...(standalone ? { standalone } : {})}
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
  standalone,
}: { children: SingleChildOrPlayable } & WithPlayOptionalProps) {
  return (
    <CanPlayElement
      // @ts-ignore
      tagInfo={[TagType.CanGrow]}
      {...TagTypeToElement[TagType.CanGrow]}
      {...(dataSource ? { dataSource } : {})}
      {...(shared ? { shared } : {})}
      {...(standalone ? { standalone } : {})}
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
          React.Children.only(renderedChildren) as React.ReactElement<{ className?: string }>,
          {
            className: classNames(
              (renderedChildren?.props as { className?: string })?.className,
              awareness.some((ele: { isHovering?: boolean }) => ele.isHovering) ? "hovering" : ""
            ),
          }
        );
      }}
    />
  );
}
