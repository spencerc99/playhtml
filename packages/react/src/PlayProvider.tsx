import { PropsWithChildren, createContext, useEffect } from "react";
import { useLocation } from "react-router-dom";
import playhtml from "./playhtml-singleton";
import { InitOptions } from "playhtml";

interface PlayContextInfo {}

const PlayContext = createContext({});

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
  return <PlayContext.Provider value={{}}>{children}</PlayContext.Provider>;
}
