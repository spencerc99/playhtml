// Reads playhtml.people for docs demos. The docs site initializes playhtml
// globally and never renders <PlayProvider>, so React hooks like usePeople
// would wait forever; this subscribes to the singleton once it's ready.
import { useEffect, useState } from "react";
import { playhtml, type Person } from "playhtml";

export function usePagePeople(keys?: string | string[]): Person[] {
  const [everyone, setEveryone] = useState<Person[]>([]);
  const keyDependency = JSON.stringify(keys ?? null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    playhtml.ready.then(() => {
      if (cancelled) return;
      unsubscribe =
        keys === undefined
          ? playhtml.people.onChange(setEveryone)
          : playhtml.people.onChange(keys, setEveryone);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [keyDependency]);

  return everyone;
}
