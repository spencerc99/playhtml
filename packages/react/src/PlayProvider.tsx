import { PropsWithChildren, createContext, useEffect, useState } from "react";
import playhtml from "./playhtml-singleton";
import { InitOptions } from "playhtml";
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
}

export const PlayContext = createContext<PlayContextInfo>({
  setupPlayElements: () => {},
  dispatchPlayEvent: () => {},
  registerPlayEventListener: () => {
    throw new Error("not yet implemented");
  },
  removePlayEventListener: () => {},
  hasSynced: false,
});

interface Props {
  initOptions?: InitOptions;
}

export function PlayProvider({
  children,
  initOptions,
}: PropsWithChildren<Props>) {
  const location = useLocation();
  useEffect(() => {
    // in future migrate this to a more "reactful" way by having all the elements rely state on this context
    playhtml.setupPlayElements();
  }, [location]);
  // useEffect(() => {
  //   playhtml.init(initOptions);
  // }, []);

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
  console.log("SYNCED", hasSynced);

  return (
    <PlayContext.Provider
      value={{
        // TODO: probably want to pass some sort of "synced" to handle
        // initial sync / differentiate default data state from empty state
        setupPlayElements: playhtml.setupPlayElements,
        dispatchPlayEvent: playhtml.dispatchPlayEvent,
        registerPlayEventListener: playhtml.registerPlayEventListener,
        removePlayEventListener: playhtml.removePlayEventListener,
        hasSynced,
      }}
    >
      {children}
      {/* {hasSynced ? children : null} */}
    </PlayContext.Provider>
  );
}
