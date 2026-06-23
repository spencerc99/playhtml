// ABOUTME: Provides React component wrappers for built-in playhtml capabilities.
// ABOUTME: Bridges React children into can-move, can-toggle, and related elements.
import {
  CanDuplicateTo,
  CanMoveBounds,
  CanMoveBoundsMinVisible,
  CanMoveBoundsMinVisiblePx,
  TagTypeToElement,
  TagType,
} from "@playhtml/common";
import classNames from "classnames";
import * as React from "react";
import { useEffect, useId, useState } from "react";
import { CanPlayElement, WithPlayOptionalProps } from ".";
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
  // The capability finds the template and container by id through the
  // `can-duplicate` / `can-duplicate-to` attributes, but the consumer hands us
  // refs. Refs only resolve once their elements are committed, so track the ids
  // in state and re-render once they're available to stamp onto the trigger.
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [duplicateToId, setDuplicateToId] = useState<string | undefined>(
    undefined
  );

  // The trigger needs a stable id so its handler isn't re-registered under a
  // fresh content-hash on every render. Use the child's own id if it has one.
  const generatedTriggerId = useId();
  const childId =
    React.isValidElement(children) &&
    typeof (children.props as { id?: string }).id === "string"
      ? (children.props as { id: string }).id
      : undefined;
  const triggerId = childId ?? generatedTriggerId;

  // Refs are populated before any effect runs, so a one-shot mount effect is
  // enough to resolve the template/container ids.
  useEffect(() => {
    const resolvedTemplateId = elementToDuplicate.current?.id;
    if (!elementToDuplicate.current) {
      console.error(
        `[@playhtml/react] <CanDuplicateElement> elementToDuplicate ref is not attached to an element. Cannot duplicate.`
      );
      return;
    }
    if (!resolvedTemplateId) {
      console.error(
        `[@playhtml/react] <CanDuplicateElement> elementToDuplicate must have an "id" so clones can reference it. Cannot duplicate.`
      );
      return;
    }
    setTemplateId(resolvedTemplateId);
    setDuplicateToId(canDuplicateTo?.current?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Until the template ref resolves we can't register the capability (it needs
  // the template id), so hold off rendering the trigger to avoid registering it
  // as an inert can-play element.
  if (!templateId) {
    return null;
  }

  // Both attributes go through `tagInfo` so they land on the trigger element as
  // real DOM attributes — the capability reads them via getAttribute.
  const tagInfo: Record<string, string> = {
    [TagType.CanDuplicate]: templateId,
  };
  if (duplicateToId) {
    tagInfo[CanDuplicateTo] = duplicateToId;
  }

  return (
    <CanPlayElement
      // @ts-ignore
      tagInfo={tagInfo}
      {...TagTypeToElement[TagType.CanDuplicate]}
      children={(renderData) => {
        const renderedChild = renderSingleChildOrPlayable(children, renderData);
        // Stamp a stable id onto the trigger if the consumer didn't give one,
        // so its handler is keyed consistently instead of by content hash.
        if (
          !childId &&
          React.isValidElement(renderedChild) &&
          typeof renderedChild.type === "string"
        ) {
          return React.cloneElement(
            renderedChild as React.ReactElement<{ id?: string }>,
            { id: triggerId }
          );
        }
        return renderedChild;
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
