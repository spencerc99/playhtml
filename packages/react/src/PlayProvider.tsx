import { PropsWithChildren, createContext, useEffect } from "react";
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
  > {}

export const PlayContext = createContext<PlayContextInfo>({
  setupPlayElements: () => {},
  dispatchPlayEvent: () => {},
  registerPlayEventListener: () => {
    throw new Error("not yet implemented");
  },
  removePlayEventListener: () => {},
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
    playhtml.init(initOptions);
  }, []);
  useEffect(() => {
    // in future migrate this to a more "reactful" way by having all the elements rely state on this context
    playhtml.setupPlayElements();
  }, [location]);

  return (
    <PlayContext.Provider
      value={{
        setupPlayElements: playhtml.setupPlayElements,
        dispatchPlayEvent: playhtml.dispatchPlayEvent,
        registerPlayEventListener: playhtml.registerPlayEventListener,
        removePlayEventListener: playhtml.removePlayEventListener,
      }}
    >
      {children}
    </PlayContext.Provider>
  );
}
