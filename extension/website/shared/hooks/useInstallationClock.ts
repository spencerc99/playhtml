// ABOUTME: Shared animation clock for multi-screen installations, over BroadcastChannel.
// ABOUTME: A master window broadcasts its scaled-elapsed each frame; follower windows render it.

import { useCallback, useEffect, useRef } from "react";
import { parseInstallationRoleFromUrl } from "../config";

/** Same-origin channel every installation window joins. Same for all windows
 * so the master's broadcasts reach all followers on the same machine. */
const CHANNEL_NAME = "wewe-installation-clock";

interface InstallationClockMessage {
  elapsed: number;
}

export interface InstallationClock {
  role: "master" | "follower" | null;
  isFollower: boolean;
  /** Accessor a follower reads each animation frame to get the latest RAW
   * scaled-elapsed pushed by the master, or null when there's nothing to
   * follow (no message yet, or this window is master/standalone). Reading
   * through this accessor avoids a React re-render per broadcast (60/sec). */
  getOverrideElapsedMs: () => number | null;
  /** A master posts its RAW pre-modulo scaled-elapsed each frame. No-op for
   * follower/standalone windows. */
  broadcastElapsed: (scaledElapsed: number) => void;
}

/** Wires a BroadcastChannel-backed shared clock keyed off `?role=`. Inert when
 * no role is present: `getOverrideElapsedMs` returns null and `broadcastElapsed`
 * is a no-op, so a standalone window drives its own clock exactly as before. */
export function useInstallationClock(): InstallationClock {
  const roleRef = useRef<"master" | "follower" | null>(
    parseInstallationRoleFromUrl(),
  );
  const role = roleRef.current;
  const isFollower = role === "follower";

  const channelRef = useRef<BroadcastChannel | null>(null);
  const overrideElapsedRef = useRef<number | null>(null);

  useEffect(() => {
    if (role === null) return;
    if (typeof BroadcastChannel === "undefined") return;

    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;

    if (isFollower) {
      channel.onmessage = (event: MessageEvent<InstallationClockMessage>) => {
        const elapsed = event.data?.elapsed;
        if (typeof elapsed === "number" && Number.isFinite(elapsed)) {
          overrideElapsedRef.current = elapsed;
        }
      };
    }

    return () => {
      channel.onmessage = null;
      channel.close();
      channelRef.current = null;
    };
  }, [role, isFollower]);

  const getOverrideElapsedMs = useCallback(
    () => (isFollower ? overrideElapsedRef.current : null),
    [isFollower],
  );

  const broadcastElapsed = useCallback(
    (scaledElapsed: number) => {
      if (role !== "master") return;
      channelRef.current?.postMessage({ elapsed: scaledElapsed });
    },
    [role],
  );

  return { role, isFollower, getOverrideElapsedMs, broadcastElapsed };
}
