// TODO: idk why but this is not getting registered otherwise??
import React from "react";
import ReactIs from "react-is";
import { useContext, useEffect, useRef, useState } from "react";
import { ElementInitializer, TagType } from "@playhtml/common";
import playhtml from "./playhtml-singleton";
import { cloneThroughFragments, getCurrentElementHandler } from "./utils";
import type {
  ReactElementInitializer,
  ReactElementEventHandlerData,
} from "./utils";
import { PlayContext } from "./PlayProvider";

export type WithPlayProps<T, V> =
  | Omit<ReactElementInitializer<T, V>, "children">
  | (Omit<ReactElementInitializer<T, V>, "children" | "defaultData"> & {
      tagInfo?: Partial<{ [k in TagType]: string }> | TagType[];
      standalone?: boolean; // Allow standalone mode without provider
    });

// Add standalone to the ReactElementInitializer type
export type ReactElementInitializerWithStandalone<T, V> =
  | (ReactElementInitializer<T, V> & { standalone?: boolean })
  | (Omit<ReactElementInitializer<T, V>, "defaultData"> & {
      defaultData: undefined;
      tagInfo?: Partial<{ [k in TagType]: string }> | TagType[];
      standalone?: boolean;
    });

// TODO: make the mapping to for TagType -> ReactElementInitializer
// TODO: semantically, it should not be `can-play` for all of the pre-defined ones..
export function CanPlayElement<T, V>({
  children,
  id,
  standalone = false,
  ...restProps
}: ReactElementInitializerWithStandalone<T, V>) {
  const playContext = useContext(PlayContext);

  if (playContext.isProviderMissing && !standalone) {
    console.error(
      `[@playhtml/react] No PlayProvider found in the component tree. Make sure to wrap your app with <PlayProvider>.
      Without a PlayProvider, playhtml components won't work correctly.

      Add this to your app:

      import { PlayProvider } from "@playhtml/react";

      function App() {
        return (
          <PlayProvider>
            {/* your app content */}
          </PlayProvider>
        );
      }

      Alternatively, you can use the 'standalone' prop on individual components
      `
    );
  }

  // Ensure playhtml is initialized if in standalone mode
  useEffect(() => {
    if (standalone && playContext.isProviderMissing) {
      // Initialize playhtml in standalone mode
      playhtml
        .init()
        .catch((err) =>
          console.error("Error initializing playhtml in standalone mode:", err)
        );
    }
  }, [standalone, playContext.isProviderMissing]);

  const { tagInfo = { "can-play": "" }, ...elementProps } = {
    tagInfo: undefined,
    ...restProps,
  };
  const computedTagInfo = tagInfo
    ? Array.isArray(tagInfo)
      ? Object.fromEntries(tagInfo.map((t) => [t, ""]))
      : tagInfo
    : { "can-play": "" };
  const ref = useRef<HTMLElement>(null);
  const { defaultData, myDefaultAwareness } = elementProps;
  const [data, setData] = useState<T | undefined>(defaultData);
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
      // console.log("setting up", ref.current.id);
      const existingData = playhtml.globalData
        ?.get("can-play")
        ?.get(ref.current.id);
      if (existingData) {
        setData(existingData);
      }
    }
    // console.log("setting up", elementProps.defaultData, ref.current);

    return () => {
      if (!ref.current || !playhtml.elementHandlers) return;
      playhtml.removePlayElement(ref.current);
    };
  }, [elementProps, ref.current]);
  const renderedChildren = children({
    // @ts-ignore
    data,
    awareness,
    setData: (newData) => {
      // console.log("settingdata", newData);
      // console.log(ref.current?.id);
      // console.log(
      //   getCurrentElementHandler(TagType.CanPlay, ref.current?.id || "")
      // );
      if (!ref.current?.id) {
        console.warn(`[@playhtml/react] No id set for element ${ref.current}`);
        return;
      }
      const handler = getCurrentElementHandler(TagType.CanPlay, ref.current.id);
      if (!handler) {
        console.warn(
          `[@playhtml/react] No handler found for element ${ref.current?.id}`
        );
        return;
      }
      handler.setData(newData);
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
      // @ts-ignore
      ref,
      ...computedTagInfo,
    },
    { fragmentId: id }
  );
}

export type CanPlayProps<
  T extends object,
  V = any
> = ReactElementEventHandlerData<T, V>;

/**
 * Wrapper to create a higher order component that passes down shared, global state to a component.
 * You can either pass in a named function or pass an inline one. See examples below:
 *
 * interface ColorChange {}
 * interface Props {}
 * 1) NAMED FUNCTION
 * function color(
 *   props: Props,
 *   { data, setData }: CanPlayProps<{ colors: ColorChange[] }>
 * ) {
 *   return <div>...</div>;
 * }
 * export const Color = withSharedState(
 *   { defaultData: { colors: [] }, },
 *   color
 * );
 *
 * 2) INLINE FUNCTION
 * export const ColorInline = withSharedState(
 *   { defaultData: { colors: [] as ColorChange[] }, },
 *   ({ data, setData }, props: Props) => {
 *      return <div>...</div>;
 *   }
 * );
 */
export function withSharedState<T extends object, V = any, P = any>(
  playConfig: WithPlayProps<T, V> | ((props: P) => WithPlayProps<T, V>),
  component: (
    playProps: ReactElementEventHandlerData<T, V>,
    props: P
  ) => React.ReactElement,
  options?: { standalone?: boolean }
): (props: P) => React.ReactElement {
  const renderChildren = (props: P) => {
    const configForProps =
      typeof playConfig === "function" ? playConfig(props) : playConfig;

    return (
      <CanPlayElement
        tagInfo={undefined}
        defaultData={undefined}
        standalone={options?.standalone}
        {...configForProps}
      >
        {(playData) => component(playData, props)}
      </CanPlayElement>
    );
  };

  return (props) => renderChildren(props);
}

// export function useSharedState<T extends object, V = any>({
//   id,
//   ...restProps
// }: WithPlayProps<T, V> & { id: string }): ReactElementEventHandlerData<T, V> {
//   const { tagInfo = { "can-play": "" }, ...elementProps } = {
//     defaultData: undefined,
//     ...restProps,
//   };
//   const computedTagInfo = tagInfo
//     ? Array.isArray(tagInfo)
//       ? Object.fromEntries(tagInfo.map((t) => [t, ""]))
//       : tagInfo
//     : { "can-play": "" };
//   const ref = useRef<HTMLElement>(null);
//   const { defaultData, myDefaultAwareness } = elementProps;
//   const [data, setData] = useState<T | undefined>(defaultData);
//   const [awareness, setAwareness] = useState<V[]>(
//     myDefaultAwareness ? [myDefaultAwareness] : []
//   );
//   const [myAwareness, setMyAwareness] = useState<V | undefined>(
//     myDefaultAwareness
//   );
//   // TODO: maybe have a separate one for free-form variables?
//   playhtml.globalData?.get("can-play")?.set(id, data);

//   // TODO: this is kinda a hack but it works for now since it is called whenever we set data.
//   const updateElement: ElementInitializer["updateElementAwareness"] = ({
//     data: newData,
//     awareness: newAwareness,
//     myAwareness,
//   }) => {
//     setData(newData);
//     setAwareness(newAwareness);
//     setMyAwareness(myAwareness);
//   };

//   useEffect(() => {
//     if (!ref.current) {
//       let ele = document.getElementById(id);
//       if (!ele) {
//         ele = document.createElement("div");
//         for (const [tag, value] of Object.entries(computedTagInfo)) {
//           ele.setAttribute(tag, value);
//         }
//         document.body.appendChild(ele).id = id;
//       }
//       ref.current = ele;
//     }

//     for (const [key, value] of Object.entries(elementProps)) {
//       // @ts-ignore
//       ref.current[key] = value;
//     }
//     // @ts-ignore
//     ref.current.updateElement = updateElement;
//     // @ts-ignore
//     ref.current.updateElementAwareness = updateElement;
//     playhtml.setupPlayElement(ref.current, { ignoreIfAlreadySetup: true });
//     console.log("setting up", ref.current.id);
//     const existingData = playhtml.globalData
//       ?.get("can-play")
//       ?.get(ref.current.id);
//     if (existingData) {
//       setData(existingData);
//     }
//     // console.log("setting up", elementProps.defaultData, ref.current);

//     return () => {
//       if (!ref.current || !playhtml.elementHandlers) return;
//       playhtml.removePlayElement(ref.current);
//     };
//   }, [playConfig, ref.current]);

//   return {
//     // @ts-ignore
//     data,
//     awareness,
//     setData: (newData) => {
//       // console.log("settingdata", newData);
//       // console.log(ref.current?.id);
//       // console.log(
//       //   getCurrentElementHandler(TagType.CanPlay, ref.current?.id || "")
//       // );
//       if (!ref.current?.id) {
//         console.warn(`[@playhtml/react] No id set for element ${ref.current}`);
//         return;
//       }
//       const handler = getCurrentElementHandler(TagType.CanPlay, ref.current.id);
//       if (!handler) {
//         console.warn(
//           `[@playhtml/react] No handler found for element ${ref.current?.id}`
//         );
//         return;
//       }
//       handler.setData(newData);
//     },
//     setMyAwareness: (newLocalAwareness) => {
//       getCurrentElementHandler(
//         TagType.CanPlay,
//         ref.current?.id || ""
//       )?.setMyAwareness(newLocalAwareness);
//     },
//     myAwareness,
//     ref,
//   };
// }

export { playhtml };
export { PlayProvider, PlayContext } from "./PlayProvider";
export {
  CanMoveElement,
  CanSpinElement,
  CanToggleElement,
  CanGrowElement,
  CanDuplicateElement,
  CanHoverElement,
} from "./elements";
