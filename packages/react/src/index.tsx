// TODO: idk why but this is not getting registered otherwise??
import React from "react";
import ReactIs from "react-is";
import { useEffect, useRef, useState } from "react";
import { ElementInitializer, TagType } from "@playhtml/common";
import playhtml from "./playhtml-singleton";
import {
  ReactElementEventHandlerData,
  ReactElementInitializer,
  cloneThroughFragments,
  getCurrentElementHandler,
} from "./utils";

// TODO: make the mapping to for TagType -> ReactElementInitializer
// TODO: semantically, it should not be `can-play` for all of the pre-defined ones..
// @deprecated use `withPlay` instead
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
    setMyAwareness: (newLocalAwareness) => {
      getCurrentElementHandler(
        TagType.CanPlay,
        ref.current?.id || ""
      )?.setMyAwareness(newLocalAwareness);
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

export const withPlay =
  <P extends object = {}>() =>
  <T extends object = object, V = any>(
    playConfig: WithPlayProps<T, V> | ((props: P) => WithPlayProps<T, V>),
    component: (
      props: ReactElementEventHandlerData<T, V> & { props: P }
    ) => React.ReactElement
  ) =>
    withPlayBase<P, T, V>(playConfig, component);

// TODO: This is the ideal API but won't work until typescript supports
// partial inference of generics. See https://github.com/microsoft/TypeScript/pull/26349
// export function withPlay<
//   P extends object = {},
//   T extends object = {},
//   V extends object = {}
// >(
//   {
//     tagInfo,
//     id,
//     ...elementProps
//   }: Omit<
//     ReactElementInitializer<T, V> & {
//       tagInfo?: Partial<{ [k in TagType]: string }>;
//     },
//     "children"
//   >,
//   component: (
//     props: ReactElementEventHandlerData<T, V> & P
//   ) => React.ReactElement
// ): (props: P) => React.ReactElement {

type WithPlayProps<T, V> = Omit<
  ReactElementInitializer<T, V> & {
    tagInfo?: Partial<{ [k in TagType]: string }>;
  },
  "children"
>;

export function withPlayBase<P = {}, T extends object = object, V = any>(
  playConfig: WithPlayProps<T, V> | ((props: P) => WithPlayProps<T, V>),
  component: (
    props: ReactElementEventHandlerData<T, V> & { props: P }
  ) => React.ReactElement
): (props: P) => React.ReactElement {
  const renderChildren = (props: P) => {
    return (
      <CanPlayElement
        {...(typeof playConfig === "function" ? playConfig(props) : playConfig)}
      >
        {(playData) => component({ props, ...playData })}
      </CanPlayElement>
    );
  };

  // console.log("rendering", ref.current?.id, data, awareness, myAwareness);
  return (props) => renderChildren(props);
}

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
