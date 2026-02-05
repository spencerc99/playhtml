import { PropsWithChildren, createContext, useEffect, useState } from "react";
import playhtml from "./playhtml-singleton";
import { InitOptions, CursorOptions } from "playhtml";
import { useLocation } from "./hooks/useLocation";
import { CursorEvents, CursorPresenceView, PlayerIdentity } from "@playhtml/common";

export interface PlayContextInfo
  extends Pick<
    typeof playhtml,
    | "setupPlayElements"
    | "dispatchPlayEvent"
    | "registerPlayEventListener"
    | "removePlayEventListener"
    | "deleteElementData"
  > {
  hasSynced: boolean;
  isProviderMissing: boolean;
  configureCursors: (options: Partial<CursorOptions>) => void;
  getMyPlayerIdentity: () => PlayerIdentity | null;
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
  deleteElementData: () => {
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
  initOptions?: InitOptions;
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

  useEffect(() => {
    playhtml.init(initOptions).then(
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

  const [cursorsState, setCursorsState] = useState<CursorEvents>({
    allColors: [] as string[],
    color: "",
    name: undefined,
  });

  const [cursorPresences, setCursorPresences] = useState<
    Map<string, CursorPresenceView>
  >(new Map());

  useEffect(() => {
    const client = playhtml.cursorClient;
    if (!client || !initOptions?.cursors?.enabled) return;

    // Initialize from current values
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
    };
  }, [hasSynced]);

  // Subscribe to cursor presences
  useEffect(() => {
    if (!playhtml.cursorClient) return;

    // Initial load
    setCursorPresences(playhtml.cursorClient.getCursorPresences());

    // Subscribe to changes
    const unsubscribe = playhtml.cursorClient.onCursorPresencesChange(
      (presences) => {
        setCursorPresences(new Map(presences)); // Create new Map to trigger re-render
      }
    );

    return unsubscribe;
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
        isProviderMissing: false,
        configureCursors,
        getMyPlayerIdentity,
        cursors: cursorsState,
        cursorPresences,
      }}
    >
      {children}
    </PlayContext.Provider>
  );
}
