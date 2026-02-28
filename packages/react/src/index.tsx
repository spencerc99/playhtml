// TODO: idk why but this is not getting registered otherwise??
import React from "react";
import { useContext, useEffect, useRef, useState } from "react";
import { ElementInitializer, TagType, getIdForElement } from "@playhtml/common";
import playhtml from "./playhtml-singleton";
import {
  cloneThroughFragments,
  getCurrentElementHandler,
  isReactFragment,
} from "./utils";
import type {
  ReactElementInitializer,
  ReactElementEventHandlerData,
} from "./utils";
import { PlayContext } from "./PlayProvider";

// Loading configuration options for React components
export interface LoadingOptions {
  behavior?: "auto" | "hidden" | "animate" | "none";
  customClass?: string;
  style?: "breathing" | "pulse" | "fade" | "none";
}

// Shared binding props for both generic and tag-specific React elements
export type WithPlayOptionalProps = {
  dataSource?: string;
  shared?: boolean | string;
  dataSourceReadOnly?: boolean;
  standalone?: boolean;
  loading?: LoadingOptions;
};

export type WithPlayProps<T, V> =
  | (Omit<ReactElementInitializer<T, V>, "children"> & WithPlayOptionalProps)
  | (Omit<ReactElementInitializer<T, V>, "defaultData" | "children"> & {
      tagInfo?: Partial<{ [k in TagType]: string }> | TagType[];
      defaultData: undefined;
    } & WithPlayOptionalProps);

export type CanPlayProps<T extends object, V = any> =
  | (ReactElementInitializer<T, V> & WithPlayOptionalProps)
  | (Omit<ReactElementInitializer<T, V>, "defaultData"> & {
      tagInfo?: Partial<{ [k in TagType]: string }> | TagType[];
      defaultData: undefined;
    } & WithPlayOptionalProps);

// TODO: make the mapping to for TagType -> ReactElementInitializer
// TODO: semantically, it should not be `can-play` for all of the pre-defined ones..
export function CanPlayElement<T extends object, V = any>({
  children,
  id,
  standalone = false,
  loading,
  ...restProps
}: CanPlayProps<T, V>) {
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
      `,
    );
  }

  // Ensure playhtml is initialized if in standalone mode
  useEffect(() => {
    if (standalone && playContext.isProviderMissing) {
      // Initialize playhtml in standalone mode
      playhtml
        .init()
        .catch((err) =>
          console.error("Error initializing playhtml in standalone mode:", err),
        );
    }
  }, [standalone, playContext.isProviderMissing]);

  const { tagInfo = { "can-play": "" }, ...elementProps } = {
    tagInfo: undefined,
    ...restProps,
  };
  const dataSource = restProps?.dataSource;
  const shared = restProps?.shared;
  const dataSourceReadOnly = restProps?.dataSourceReadOnly;
  const computedTagInfo = tagInfo
    ? Array.isArray(tagInfo)
      ? Object.fromEntries(tagInfo.map((t) => [t, ""]))
      : tagInfo
    : { "can-play": "" };
  const primaryTag = (Object.keys(computedTagInfo)[0] ?? TagType.CanPlay) as TagType;

  // Add loading attributes based on loading options
  const loadingAttributes: Record<string, string> = {};
  if (loading?.behavior) {
    loadingAttributes["loading-behavior"] = loading.behavior;
  }
  if (loading?.customClass) {
    loadingAttributes["loading-class"] = loading.customClass;
  }
  if (loading?.style) {
    loadingAttributes["loading-style"] = loading.style;
  }
  const ref = useRef<HTMLElement>(null);
  const { defaultData, myDefaultAwareness } = elementProps;
  const resolveDefaultData = (fnOrValue: T | ((el: HTMLElement) => T)) =>
    typeof fnOrValue === "function"
      ? // @ts-ignore
        (fnOrValue as (el: HTMLElement) => T)(ref.current as HTMLElement)
      : (fnOrValue as T);
  const resolveDefaultAwareness = (
    fnOrValue?: V | ((el: HTMLElement) => V),
  ): V | undefined =>
    typeof fnOrValue === "function"
      ? // @ts-ignore
        (fnOrValue as (el: HTMLElement) => V)(ref.current as HTMLElement)
      : fnOrValue;

  const [data, setData] = useState<T | undefined>(
    defaultData !== undefined
      ? resolveDefaultData(defaultData as T | ((el: HTMLElement) => T))
      : undefined,
  );
  const initialAwareness = resolveDefaultAwareness(
    myDefaultAwareness as V | ((el: HTMLElement) => V) | undefined,
  );
  const [awareness, setAwareness] = useState<V[]>(
    initialAwareness ? [initialAwareness] : [],
  );
  const [awarenessByStableId, setAwarenessByStableId] = useState<
    Map<string, V>
  >(new Map());
  const [myAwareness, setMyAwareness] = useState<V | undefined>(
    initialAwareness,
  );

  // TODO: this is kinda a hack but it works for now since it is called whenever we set data.
  const updateElement: ElementInitializer["updateElementAwareness"] = ({
    data: newData,
    awareness: newAwareness,
    awarenessByStableId: newAwarenessByStableId,
    myAwareness,
  }) => {
    setData(newData);
    setAwareness(newAwareness);
    setAwarenessByStableId(newAwarenessByStableId);
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

      // Setup the element, which will handle data-source discovery if needed
      try {
        playhtml.setupPlayElement(ref.current, { ignoreIfAlreadySetup: true });
      } catch (error) {
        console.warn("[@playhtml/react] Failed to setup play element:", error);

        // If playhtml isn't initialized yet, log a helpful message
        if (!playhtml.elementHandlers) {
          console.warn(
            "[@playhtml/react] PlayHTML not initialized yet. Element will be set up when PlayHTML initializes.",
          );
        }
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
    awarenessByStableId,
    setData: (newData: T | ((draft: T) => void)) => {
      // console.log("settingdata", newData);
      // console.log(ref.current?.id);
      // console.log(
      //   getCurrentElementHandler(TagType.CanPlay, ref.current?.id || "")
      // );
      const effectiveId = ref.current
        ? getIdForElement(ref.current as unknown as HTMLElement)
        : undefined;
      if (!effectiveId) {
        console.warn(
          `[@playhtml/react] No effective id for element`,
          ref.current,
        );
        return;
      }
      const handler = getCurrentElementHandler(primaryTag, effectiveId);
      if (!handler) {
        console.warn(
          `[@playhtml/react] No handler found for element ${effectiveId}`,
        );
        return;
      }
      handler.setData(newData);
    },
    setMyAwareness: (newLocalAwareness) => {
      const effectiveId = ref.current
        ? getIdForElement(ref.current as unknown as HTMLElement)
        : undefined;
      if (!effectiveId) return;
      getCurrentElementHandler(primaryTag, effectiveId)?.setMyAwareness(
        newLocalAwareness,
      );
    },
    myAwareness,
    ref,
  });

  if (isReactFragment(renderedChildren) && !id) {
    throw new Error(
      `If you pass a single React Fragment as the children, you must also specify 'id' in the props`,
    );
  }

  return cloneThroughFragments(
    React.Children.only(renderedChildren),
    {
      // @ts-ignore
      ref,
      ...computedTagInfo,
      ...loadingAttributes,
      ...(dataSource ? { "data-source": dataSource } : {}),
      ...(dataSourceReadOnly
        ? { "data-source-read-only": dataSourceReadOnly }
        : {}),
      ...(shared
        ? typeof shared === "string"
          ? { shared: shared }
          : { shared: "" }
        : {}),
    },
    { fragmentId: id },
  );
}

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
 *
 * @warning DATA STORAGE: The `tagInfo` property determines where element data is stored.
 * - `tagInfo: [TagType.CanMove]` → stores under "can-move"
 * - `tagInfo: [TagType.CanToggle]` → stores under "can-toggle"
 * - No `tagInfo` (default) → stores under "can-play"
 *
 * NEVER change the tagInfo of an existing element without implementing data migration,
 * or existing user data will be lost/orphaned.
 *
 * When customizing built-in capabilities (e.g., adding initial position to CanMove),
 * KEEP the tagInfo to preserve data storage location:
 *
 * // CORRECT - keeps data under "can-move"
 * withSharedState<MoveData>((props) => ({
 *   tagInfo: [TagType.CanMove],  // KEEP THIS
 *   defaultData: { x: props.x ?? 0, y: props.y ?? 0 },
 * }), renderFn);
 *
 * // WRONG - orphans existing "can-move" data, now stores under "can-play"
 * withSharedState<MoveData>((props) => ({
 *   defaultData: { x: props.x ?? 0, y: props.y ?? 0 },  // Missing tagInfo!
 * }), renderFn);
 */
export function withSharedState<T extends object, V = any, P = any>(
  playConfig: WithPlayProps<T, V> | ((props: P) => WithPlayProps<T, V>),
  component: (
    playProps: ReactElementEventHandlerData<T, V>,
    props: P,
  ) => React.ReactElement,
  options?: WithPlayOptionalProps,
): (props: P) => JSX.Element {
  const renderChildren = (props: P): JSX.Element => {
    const configForProps =
      typeof playConfig === "function" ? playConfig(props) : playConfig;

    return (
      <CanPlayElement
        standalone={options?.standalone}
        loading={options?.loading || configForProps.loading}
        {...configForProps}
        {...options}
      >
        {(playData) => component(playData, props)}
      </CanPlayElement>
    );
  };

  return renderChildren;
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
export { usePlayContext } from "./usePlayContext";
export { useCursorPresences } from "./hooks";
export {
  CanMoveElement,
  CanSpinElement,
  CanToggleElement,
  CanGrowElement,
  CanDuplicateElement,
  CanHoverElement,
} from "./elements";
