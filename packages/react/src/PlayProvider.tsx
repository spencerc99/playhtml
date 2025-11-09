import { PropsWithChildren, createContext, useEffect, useState } from "react";
import playhtml from "./playhtml-singleton";
import { InitOptions, CursorOptions } from "playhtml";
import { useLocation } from "./hooks/useLocation";
import { CursorEvents } from "@playhtml/common";

export interface PlayContextInfo
  extends Pick<
    typeof playhtml,
    | "setupPlayElements"
    | "dispatchPlayEvent"
    | "registerPlayEventListener"
    | "removePlayEventListener"
    | "removeElementData"
  > {
  hasSynced: boolean;
  isProviderMissing: boolean;
  configureCursors: (options: Partial<CursorOptions>) => void;
  getMyPlayerIdentity: () => { color: string; name: string };
  cursors: CursorEvents;
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
  removeElementData: () => {
    throw new Error(
      "[@playhtml/react]: PlayProvider element missing. please render it at the top-level or use the `standalone` prop"
    );
  },
  cursors: {
    allColors: [],
    color: "",
    name: undefined,
  },
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

  const getMyPlayerIdentity = () => {
    // Access the global cursors API that exposes the current player's information
    const cursors = (window as any).cursors;
    return {
      color: cursors.color,
      name: cursors.name,
    };
  };

  const [cursorsState, setCursorsState] = useState<CursorEvents>({
    allColors: [] as string[],
    color: "",
    name: undefined,
  });

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

  return (
    <PlayContext.Provider
      value={{
        setupPlayElements: playhtml.setupPlayElements,
        dispatchPlayEvent: playhtml.dispatchPlayEvent,
        registerPlayEventListener: playhtml.registerPlayEventListener,
        removePlayEventListener: playhtml.removePlayEventListener,
        removeElementData: playhtml.removeElementData,
        hasSynced,
        isProviderMissing: false,
        configureCursors,
        getMyPlayerIdentity,
        cursors: cursorsState,
      }}
    >
      {children}
    </PlayContext.Provider>
  );
}
