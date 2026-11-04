// ABOUTME: Returns the playhtml React context plus the people on the page.
// ABOUTME: People come from a separate context so presence changes only re-render readers of this hook.
import { useContext, useMemo } from "react";
import { PeopleContext, PlayContext } from "./PlayProvider";
import type { PlayContextInfo, PlayContextPeople } from "./PlayProvider";

/**
 * The playhtml context (`isLoading`, cursor helpers, ...) plus `people`:
 * `{ everyone, me, setMyPresence }` for this page. Re-renders when someone
 * joins, leaves, or changes name, color, or presence (not on cursor moves).
 * For cursors, or to re-render only on some keys, use `usePeople(keys)`.
 */
export function usePlayContext(): PlayContextInfo & { people: PlayContextPeople } {
  const context = useContext(PlayContext);
  const people = useContext(PeopleContext);
  return useMemo(() => ({ ...context, people }), [context, people]);
}
