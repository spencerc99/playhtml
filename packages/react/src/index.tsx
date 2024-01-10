// TODO: idk why but this is not getting registered otherwise??
import React from "react";
import ReactIs from "react-is";
import { useEffect, useRef, useState } from "react";
import { ElementInitializer, TagType } from "@playhtml/common";
import playhtml from "./playhtml-singleton";
import {
  ReactElementInitializer,
  cloneThroughFragments,
  getCurrentElementHandler,
} from "./utils";

// TODO: make the mapping to for TagType -> ReactElementInitializer
// TODO: semantically, it should not be `can-play` for all of the pre-defined ones..
export function CanPlayElement<T, V>({
  tagInfo,
  children,
  id,
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
      for (const [key, value] of Object.entries(elementProps)) {
        // @ts-ignore
        ref.current[key] = value;
      }
      // @ts-ignore
      ref.current.updateElement = updateElement;
      // @ts-ignore
      ref.current.updateElementAwareness = updateElement;
      playhtml.setupPlayElement(ref.current, { ignoreIfAlreadySetup: true });
      const existingData = playhtml.globalData
        ?.get("can-play")
        ?.get(ref.current.id);
      if (existingData) {
        setData(existingData);
      }
    }
    // console.log("setting up", elementProps.defaultData, ref.current);

    return () => playhtml.removePlayElement(ref.current);
  }, [elementProps, ref.current]);
  const renderedChildren = children({
    data,
    awareness,
    setData: (newData) => {
      // console.log("settingdata", newData);
      // console.log(
      //   getCurrentElementHandler(TagType.CanPlay, ref.current?.id || "")
      // );
      getCurrentElementHandler(TagType.CanPlay, ref.current?.id || "")?.setData(
        newData
      );
    },
    setLocalAwareness: (newLocalAwareness) => {
      getCurrentElementHandler(
        TagType.CanPlay,
        ref.current?.id || ""
      )?.setLocalAwareness(newLocalAwareness);
    },
    myAwareness,
    ref,
  });

  if (ReactIs.isFragment(renderedChildren) && !id) {
    throw new Error(
      `If you pass a single React Fragment as the children, you must also specify 'id' in the props`
    );
  }

  // console.log("rendering", ref.current?.id, data, awareness, myAwareness);
  return cloneThroughFragments(
    React.Children.only(renderedChildren),
    {
      ref,
      ...computedTagInfo,
    },
    { fragmentId: id }
  );
}
/**
 * @deprecated use CanPlayElement instead
 */
export const Playable = CanPlayElement;

export { playhtml };
export { PlayProvider } from "./PlayProvider";
export {
  CanMoveElement,
  CanSpinElement,
  CanToggleElement,
  CanGrowElement,
  CanDuplicateElement,
  CanHoverElement,
} from "./elements";
