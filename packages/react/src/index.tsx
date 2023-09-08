import React from "react";
import { useEffect, useRef, useState } from "react";
import { ElementInitializer, TagType } from "@playhtml/common";
// TODO: this probably doesn't work as it stands lol
// import { TagTypeToElement } from "../../playhtml/src/elements";
import { playhtml } from "playhtml";

type ReactElementInitializer<T, U, V> = Omit<
  ElementInitializer<T, U, V>,
  "updateElement" | "defaultData" | "defaultLocalData" | "myDefaultAwareness"
> & {
  defaultData: T;
  defaultLocalData?: U;
  myDefaultAwareness?: V;
  children: (
    defaultData: T,
    defaultLocalData: U,
    awareness: V
  ) => React.ReactNode;
};

// TODO: make the mapping to for TagType -> ReactElementInitializer

// Get the Yjs document and sync automatically using y-webrtc
export function Playable<T, U, V>({
  tagInfo,
  children,
  ...elementProps
}: ReactElementInitializer<T, U, V> & {
  tagInfo?: { [k in TagType]: string };
}) {
  const computedTagInfo = tagInfo || { "can-play": "" };
  const ref = useRef<HTMLElement>(null);
  const { defaultData, defaultLocalData, myDefaultAwareness } = elementProps;
  const [data, setData] = useState<T>(defaultData);
  // TODO: this needs to handle if its a function and requires the element itself?
  const [localData, setLocalData] = useState<any>(defaultLocalData);
  const [awareness, setAwareness] = useState<any>(myDefaultAwareness);

  // TODO: this is kinda a hack but it works for now since it is called whenever we set data.
  const updateElement: ElementInitializer["updateElement"] = ({
    data: newData,
    localData: newLocalData,
    awareness: newAwareness,
  }) => {
    setData(newData);
    setLocalData(newLocalData);
    setAwareness(newAwareness);
  };

  useEffect(() => {
    if (playhtml.firstSetup) {
      throw Error("playhtml not setup. Please call playhtml.init() first.");
    }
    if (ref.current) {
      for (const [key, value] of Object.entries(elementProps)) {
        // @ts-ignore
        ref.current[key] = value;
      }
      // @ts-ignore
      ref.current.updateElement = updateElement;
      // @ts-ignore
      ref.current.updateElementAwareness = updateElement;
      // TODO: how to handle if you are importing from unpkg too?
      playhtml.setupPlayElement(ref.current);
    }

    // TODO: remove play element when unmounted
  }, []);

  // Pass data to children to render.. or what's the most reactive way to do this?
  // should user give a function to render children with the data + set data operations?
  return React.cloneElement(
    React.Children.only(children(data, localData, awareness)) as any,
    {
      ref,
      ...computedTagInfo,
    }
  );
}

// export function Movable(props: PropsWithChildren<{}>) {
//   return (
//     <Playable
//       {...TagTypeToElement[TagType.CanMove]}
//       children={props.children}
//     />
//   );
// }
//TODO: export an equivalent element for each of the things in elements.ts?

export { playhtml };
