import React, { PropsWithChildren, useEffect, useRef } from "react";
import { ElementInitializer, TagType } from "../../common/types";
import { TagTypeToElement } from "../../playhtml/src/elements";
import { playhtml } from "playhtml";

// Get the Yjs document and sync automatically using y-webrtc
export function Playable({
  tagInfo,
  children,
  ...elementProps
}: PropsWithChildren<
  ElementInitializer & {
    tagInfo?: { [k in TagType]: string };
  }
>) {
  const computedTagInfo = tagInfo || { "can-play": "" };
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (playhtml.firstSetup) {
      throw Error("playhtml not setup. Please call playhtml.init() first.");
    }
    if (ref.current) {
      for (const [key, value] of Object.entries(elementProps)) {
        // @ts-ignore
        ref.current[key] = value;
      }
      // TODO: how to handle if you are importing from unpkg too?
      playhtml.setupPlayElement(ref.current);
    }

    // TODO: remove play element when unmounted
  });

  return React.cloneElement(React.Children.only(children) as any, {
    ref,
    ...computedTagInfo,
  });
}

export function Movable(props: PropsWithChildren<{}>) {
  return (
    <Playable
      {...TagTypeToElement[TagType.CanMove]}
      children={props.children}
    />
  );
}
//TODO: export an equivalent element for each of the things in elements.ts?

export { playhtml };
