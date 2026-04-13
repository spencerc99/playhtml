import {
  PropsWithChildren,
  createContext,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";
import playhtml from "./playhtml-singleton";
import {
  InitOptions,
  CursorContainer,
  CursorOptions,
  CursorZoneOptions,
} from "playhtml";
import { useLocation } from "./hooks/useLocation";
import { CursorEvents, CursorPresenceView, PlayerIdentity } from "@playhtml/common";

type PlayProviderCursorContainer = CursorContainer | RefObject<HTMLElement>;

function normalizeCursorContainer(
  c: PlayProviderCursorContainer | undefined,
): CursorContainer | undefined {
  if (!c) return undefined;
  if (typeof c === "object" && "current" in (c as object)) {
    const ref = c as RefObject<HTMLElement>;
    return () => ref.current;
  }
  return c as CursorContainer;
}

type PlayProviderCursorOptions = Omit<CursorOptions, "container"> & {
  container?: CursorContainer | RefObject<HTMLElement>;
};

type PlayProviderInitOptions = Omit<InitOptions, "cursors"> & {
  cursors?: PlayProviderCursorOptions;
};

export interface PlayContextInfo
  extends Pick<
    typeof playhtml,
    | "setupPlayElements"
    | "dispatchPlayEvent"
    | "registerPlayEventListener"
    | "removePlayEventListener"
    | "deleteElementData"
  > {
  /** @deprecated Use `isLoading` instead. */
  hasSynced: boolean;
  isLoading: boolean;
  isProviderMissing: boolean;
  configureCursors: (options: Partial<CursorOptions>) => void;
  getMyPlayerIdentity: () => PlayerIdentity | null;
  /**
   * Apply a CSS class to the actual cursor DOM element for the given stableId.
   * Returns true if applied; false if cursor not found.
   */
  triggerCursorAnimation: (stableId: string, animationClass: string, durationMs?: number) => boolean;
  registerCursorZone: (element: HTMLElement, options?: CursorZoneOptions) => void;
  unregisterCursorZone: (elementId: string) => void;
  cursors: CursorEvents;
  cursorPresences: Map<string, CursorPresenceView>;
}

export const PlayContext = createContext<PlayContextInfo>({
  setupPlayElements: () => {
    throw new Error(
      "[@playhtml/react]: PlayProvider element missing. please render it at the top-level or use the `standalone` prop"
    );
  },
  dispatchPlayEvent: () => {
    throw new Error(
      "[@playhtml/react]: PlayProvider element missing. please render it at the top-level or use the `standalone` prop"
    );
  },
  registerPlayEventListener: () => {
    throw new Error(
      "[@playhtml/react]: PlayProvider element missing. please render it at the top-level or use the `standalone` prop"
    );
  },
  removePlayEventListener: () => {},
  hasSynced: false,
  isLoading: true,
  isProviderMissing: true,
  configureCursors: () => {
    throw new Error(
      "[@playhtml/react]: PlayProvider element missing. please render it at the top-level or use the `standalone` prop"
    );
  },
  getMyPlayerIdentity: () => {
    throw new Error(
      "[@playhtml/react]: PlayProvider element missing. please render it at the top-level or use the `standalone` prop"
    );
  },
  triggerCursorAnimation: () => {
    throw new Error(
      "[@playhtml/react]: PlayProvider element missing. please render it at the top-level or use the `standalone` prop"
    );
  },
  deleteElementData: () => {
    throw new Error(
      "[@playhtml/react]: PlayProvider element missing. please render it at the top-level or use the `standalone` prop"
    );
  },
  registerCursorZone: () => {
    throw new Error(
      "[@playhtml/react]: PlayProvider element missing. please render it at the top-level or use the `standalone` prop"
    );
  },
  unregisterCursorZone: () => {
    throw new Error(
      "[@playhtml/react]: PlayProvider element missing. please render it at the top-level or use the `standalone` prop"
    );
  },
  cursors: {
    allColors: [],
    color: "",
    name: undefined,
  },
  cursorPresences: new Map(),
});

interface Props {
  initOptions?: PlayProviderInitOptions;
}

export function PlayProvider({
  children,
  initOptions,
}: PropsWithChildren<Props>) {
  const { pathname, search } = useLocation();
  useEffect(() => {
    // in future migrate this to a more "reactful" way by having all the elements rely state on this context
    playhtml.setupPlayElements();
  }, [pathname, search]);

  const [hasSynced, setHasSynced] = useState(false);

  const processedInitOptions = useMemo<InitOptions | undefined>(() => {
    if (!initOptions) return initOptions as InitOptions | undefined;
    if (!initOptions.cursors) return initOptions as InitOptions;
    return {
      ...initOptions,
      cursors: {
        ...initOptions.cursors,
        container: normalizeCursorContainer(initOptions.cursors.container),
      },
    } as InitOptions;
  }, [initOptions]);

  useEffect(() => {
    playhtml.init(processedInitOptions).then(
      () => {
        setHasSynced(true);
      },
      (err) => {
        console.error(err);
        setHasSynced(true);
      }
    );
  }, []);

  const configureCursors = (options: Partial<CursorOptions>) => {
    if (playhtml.cursorClient) {
      // Use the new configure method
      playhtml.cursorClient.configure(options);
    } else {
      console.warn(
        "[@playhtml/react]: Cursor client not initialized. Make sure cursors are enabled in initOptions."
      );
    }
  };

  const getMyPlayerIdentity = (): PlayerIdentity | null => {
    return playhtml.cursorClient?.getMyPlayerIdentity() ?? null;
  };

  const triggerCursorAnimation = (
    stableId: string,
    animationClass: string,
    durationMs?: number,
  ): boolean => {
    if (!playhtml.cursorClient) return false;
    return playhtml.cursorClient.triggerCursorAnimation(stableId, animationClass, durationMs);
  };

  const registerCursorZone = (element: HTMLElement, options?: CursorZoneOptions) => {
    playhtml.cursorClient?.registerZone(element, options);
  };

  const unregisterCursorZone = (elementId: string) => {
    playhtml.cursorClient?.unregisterZone(elementId);
  };

  const [cursorsState, setCursorsState] = useState<CursorEvents>({
    allColors: [] as string[],
    color: "",
    name: undefined,
  });

  const [cursorPresences, setCursorPresences] = useState<
    Map<string, CursorPresenceView>
  >(new Map());

  // Single effect: cursor client state and presence subscriptions when synced
  useEffect(() => {
    const client = playhtml.cursorClient;
    if (!client) return;

    setCursorPresences(client.getCursorPresences());
    const unsubPresences = client.onCursorPresencesChange((presences) => {
      setCursorPresences(new Map(presences)); // New Map to trigger re-render
    });

    if (!initOptions?.cursors?.enabled) {
      return unsubPresences;
    }

    const snap = client.getSnapshot();
    setCursorsState({
      allColors: snap.allColors || [],
      color: snap.color || "",
      name: snap.name || "",
    });
    const handleAllColors = (allColors: string[]) => {
      setCursorsState((prev) => ({ ...prev, allColors }));
    };
    const handleColor = (myColor: string) => {
      setCursorsState((prev) => ({ ...prev, color: myColor }));
    };
    const handleName = (myName?: string) => {
      setCursorsState((prev) => ({ ...prev, name: myName }));
    };
    client.on("allColors", handleAllColors);
    client.on("color", handleColor);
    client.on("name", handleName);

    return () => {
      client.off("allColors", handleAllColors);
      client.off("color", handleColor);
      client.off("name", handleName);
      unsubPresences();
    };
  }, [hasSynced]);

  return (
    <PlayContext.Provider
      value={{
        setupPlayElements: playhtml.setupPlayElements,
        dispatchPlayEvent: playhtml.dispatchPlayEvent,
        registerPlayEventListener: playhtml.registerPlayEventListener,
        removePlayEventListener: playhtml.removePlayEventListener,
        deleteElementData: playhtml.deleteElementData,
        hasSynced,
        isLoading: !hasSynced,
        isProviderMissing: false,
        configureCursors,
        getMyPlayerIdentity,
        triggerCursorAnimation,
        registerCursorZone,
        unregisterCursorZone,
        cursors: cursorsState,
        cursorPresences,
      }}
    >
      {children}
    </PlayContext.Provider>
  );
}
