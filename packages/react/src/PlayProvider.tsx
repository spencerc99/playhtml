import {
  PropsWithChildren,
  createContext,
  useEffect,
  useMemo,
  useRef,
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
  pathname?: string;
}

// Flips true the first time any PlayProvider with initOptions calls init().
// Used to detect and warn about a second init-owning PlayProvider mounting
// later (whose options would be silently ignored by playhtml.init()).
let hasInitOwner = false;
let hasWarnedConflictingInit = false;

/**
 * Test-only: reset the module-level init-owner tracking between tests.
 * Not part of the public API. The harness mocks playhtml itself, so this
 * just clears React's local bookkeeping that pairs with the mock reset.
 */
export function __resetInitOwnerForTests(): void {
  hasInitOwner = false;
  hasWarnedConflictingInit = false;
}

/**
 * PlayProvider has two modes:
 *
 * 1. Init-owning: render with `initOptions`. Calls `playhtml.init()` on
 *    mount. Use this once at your app root.
 *
 *    ```tsx
 *    <PlayProvider initOptions={{ cursors: { enabled: true } }}>
 *      <App />
 *    </PlayProvider>
 *    ```
 *
 * 2. Context-only: render bare (no `initOptions`). Does NOT call init —
 *    just relays context from the global playhtml singleton. Use this in
 *    additional React roots (e.g. Astro islands) that need
 *    `useCursorPresences`, `usePresenceRoom`, etc.
 *
 *    ```tsx
 *    <PlayProvider>
 *      <NestedIsland />
 *    </PlayProvider>
 *    ```
 *
 * The app must have either an init-owning provider OR call
 * `playhtml.init()` directly somewhere — context-only providers don't
 * trigger init.
 */
export function PlayProvider({
  children,
  initOptions,
  pathname: pathnameProp,
}: PropsWithChildren<Props>) {
  const previousPathname = useRef<string | undefined>(pathnameProp);

  useEffect(() => {
    if (previousPathname.current === undefined) {
      // First render with a pathname — capture, don't trigger.
      previousPathname.current = pathnameProp;
      return;
    }
    if (previousPathname.current !== pathnameProp) {
      previousPathname.current = pathnameProp;
      void playhtml.handleNavigation();
    }
  }, [pathnameProp]);

  const { pathname, search } = useLocation();
  useEffect(() => {
    // in future migrate this to a more "reactful" way by having all the elements rely state on this context
    playhtml.setupPlayElements();
  }, [pathname, search]);

  // Subscribe to playhtml's module-level isLoading. Multiple PlayProviders
  // mounted concurrently all observe the same `playhtml.ready` promise, so
  // they flip together once init's setup wiring completes.
  const [isLoading, setIsLoading] = useState(playhtml.isLoading);

  const processedInitOptions = useMemo<InitOptions | undefined>(() => {
    if (!initOptions) return undefined;
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
    // PlayProvider has two modes:
    //   1. init-owning: rendered with `initOptions`. Calls playhtml.init().
    //      Only one such provider per app. A second init-owning provider
    //      logs a warning — playhtml.init() is idempotent, so the late
    //      options are silently dropped and would otherwise be invisible.
    //   2. context-only: rendered without `initOptions` (typical for
    //      nested Astro islands). Does NOT call init — relays context
    //      from the global playhtml singleton. The app must have an
    //      init-owning provider somewhere, or call playhtml.init() directly.
    let cancelled = false;
    if (processedInitOptions) {
      if (hasInitOwner && !hasWarnedConflictingInit) {
        hasWarnedConflictingInit = true;
        console.warn(
          "[@playhtml/react] Multiple <PlayProvider> instances passed `initOptions`. " +
            "Only the first init-owning provider's options take effect; later options are " +
            "silently ignored. Pass `initOptions` to exactly one PlayProvider (typically " +
            "your app root) and render bare <PlayProvider> elsewhere for context-only mode.",
        );
      }
      hasInitOwner = true;
      playhtml.init(processedInitOptions).catch((err) => console.error(err));
    }

    // Whether or not we triggered init, wait for readiness so context
    // accurately reflects the global state.
    playhtml.ready.then(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
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
  }, [isLoading]);

  return (
    <PlayContext.Provider
      value={{
        setupPlayElements: playhtml.setupPlayElements,
        dispatchPlayEvent: playhtml.dispatchPlayEvent,
        registerPlayEventListener: playhtml.registerPlayEventListener,
        removePlayEventListener: playhtml.removePlayEventListener,
        deleteElementData: playhtml.deleteElementData,
        hasSynced: !isLoading,
        isLoading,
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
