import { PropsWithChildren, createContext, useEffect, useState } from "react";
import playhtml from "./playhtml-singleton";
import { InitOptions, CursorOptions } from "playhtml";
import { useLocation } from "./hooks/useLocation";

export interface PlayContextInfo
  extends Pick<
    typeof playhtml,
    | "setupPlayElements"
    | "dispatchPlayEvent"
    | "registerPlayEventListener"
    | "removePlayEventListener"
  > {
  hasSynced: boolean;
  isProviderMissing: boolean;
  configureCursors: (options: Partial<CursorOptions>) => void;
  getMyPlayerIdentity: () => { color: string; name: string };
  getCursors: () => {
    allColors: string[];
    count: number;
    myColor: string;
    myName: string;
  };
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
  getCursors: () => ({
    allColors: [],
    count: 0,
    myColor: "",
    myName: "",
  }),
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

  const getCursors = () => {
    // Direct access to current cursor information
    const cursors = (window as any).cursors;
    return {
      allColors: cursors?.allColors || [],
      count: cursors?.count || 0,
      myColor: cursors?.color || "",
      myName: cursors?.name || "",
    };
  };

  return (
    <PlayContext.Provider
      value={{
        setupPlayElements: playhtml.setupPlayElements,
        dispatchPlayEvent: playhtml.dispatchPlayEvent,
        registerPlayEventListener: playhtml.registerPlayEventListener,
        removePlayEventListener: playhtml.removePlayEventListener,
        hasSynced,
        isProviderMissing: false,
        configureCursors,
        getMyPlayerIdentity,
        getCursors,
      }}
    >
      {children}
    </PlayContext.Provider>
  );
}
