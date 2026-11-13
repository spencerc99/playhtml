// ABOUTME: React hook for the local person (pid, name, color) from playhtml.people.me.
// ABOUTME: Re-renders only when your own identity changes, not on other people's presence.
import { useEffect, useState } from "react";
import { usePlayContext } from "@playhtml/react";
import { playhtml } from "playhtml";

export type MyIdentity = {
  pid: string | undefined;
  name: string | undefined;
  color: string;
};

const BEFORE_SYNC: MyIdentity = { pid: undefined, name: undefined, color: "" };

/**
 * You, from `playhtml.people.me`. Unlike `usePeople().me`, this skips
 * re-renders when other people join, leave, or change their presence, so it
 * is safe in components that render large lists.
 */
export function useMe(): MyIdentity {
  const { isLoading } = usePlayContext();
  const [me, setMe] = useState(BEFORE_SYNC);

  useEffect(() => {
    if (isLoading) {
      setMe(BEFORE_SYNC);
      return;
    }
    const read = () => {
      const next = playhtml.people.me;
      setMe((prev) =>
        prev.pid === next.pid &&
        prev.name === next.name &&
        prev.color === next.color
          ? prev
          : { pid: next.pid, name: next.name, color: next.color },
      );
    };
    read();
    return playhtml.people.onChange([], read);
  }, [isLoading]);

  return me;
}

/**
 * `playhtml.people.me` (name and color are settable), or `null` before
 * playhtml has started. For code that can run before init.
 */
export function getMe(): typeof playhtml.people.me | null {
  try {
    return playhtml.people.me;
  } catch {
    return null;
  }
}
