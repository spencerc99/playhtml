import { useContext } from "react";
import { PlayContext } from "./PlayProvider";

export function usePlayContext() {
  return useContext(PlayContext);
}