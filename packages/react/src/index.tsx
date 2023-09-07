import React, { PropsWithChildren, useEffect, useRef } from "react";
import { playhtml } from "playhtml";
import { ElementInitializer, TagType } from "../../common/types";
import { TagTypeToElement } from "../../playhtml/src/elements";

// Get the Yjs document and sync automatically using y-webrtc

export function Playable(props: PropsWithChildren<ElementInitializer>) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (playhtml.firstSetup) {
      throw Error("playhtml not setup. Please call playhtml.init() first.");
    }
    if (ref.current) {
      playhtml.setupPlayElement(ref.current);
    }

    // TODO: remove play element when unmounted
  });
  return React.cloneElement(React.Children.only(props.children), {
    ...props,
    ref,
  });
}

export function Movable(props: PropsWithChildren<{}>) {
  return (
    <Playable {...TagTypeToElement[TagType.CanMove]}>{props.children}</Playable>
  );
}
//TODO: export an equivalent element for each of the things in elements.ts?
