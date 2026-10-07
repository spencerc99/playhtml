// ABOUTME: Shared wall-clock epoch for multi-screen installations, over a BroadcastChannel.
// ABOUTME: Every window computes its own scaled-elapsed from the master's epoch, so no window depends on another's rAF.

import { useCallback, useEffect, useRef } from "react";
import { parseInstallationRoleFromUrl } from "../config";

/** Same-origin channel every installation window joins. The master announces
 * its epoch here; followers request and adopt it. */
const CHANNEL_NAME = "wewe-installation-clock";

interface EpochMessage {
  type: "epoch";
  epoch: number;
}

interface EpochRequestMessage {
  type: "epoch-request";
}

type ClockMessage = EpochMessage | EpochRequestMessage;

export interface InstallationClock {
  role: "master" | "follower" | null;
  isFollower: boolean;
  /** True when this window participates in the installation clock (any role). */
  isInstallation: boolean;
  /** Returns `(Date.now() - epoch) * animationSpeed` when this is an
   * installation window and an epoch is known, else null. The animate loop
   * falls back to local accumulation while null (before the master's epoch is
   * known, or for standalone windows). Read through this accessor each frame so
   * incoming messages don't re-run the animation-loop effect. */
  getScaledElapsedMs: (animationSpeed: number) => number | null;
}

/** Wires a shared wall-clock epoch keyed off `?role=`. The MASTER is
 * authoritative: every master (re)load stamps a fresh epoch = now (restarting
 * the cycle) and broadcasts it. FOLLOWERS never mint an epoch — they wait for
 * the master's and adopt its latest (a master reload re-syncs them). Inert when
 * no role is present: `getScaledElapsedMs` returns null so a standalone window
 * accumulates its own clock exactly as before. */
export function useInstallationClock(): InstallationClock {
  const roleRef = useRef<"master" | "follower" | null>(
    parseInstallationRoleFromUrl(),
  );
  const role = roleRef.current;
  const isFollower = role === "follower";
  const isInstallation = role !== null;

  const epochRef = useRef<number | null>(null);

  useEffect(() => {
    if (role === null) return;

    const isMaster = role === "master";
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(CHANNEL_NAME)
        : null;

    if (isMaster) {
      // The master is authoritative: every master (re)load stamps a FRESH epoch
      // = now, so the whole field restarts from the start of the cycle and all
      // followers snap to it. It never adopts anyone else's epoch.
      const epoch = Date.now();
      epochRef.current = epoch;
      if (channel) {
        channel.onmessage = (event: MessageEvent<ClockMessage>) => {
          // Answer followers asking for the current epoch; ignore stray epoch
          // announcements (the master owns the clock).
          const msg = event.data;
          if (msg?.type === "epoch-request") {
            channel.postMessage({ type: "epoch", epoch: epochRef.current! });
          }
        };
      }
      channel?.postMessage({ type: "epoch", epoch });
    } else {
      // A follower NEVER establishes an epoch. It waits for the master: until a
      // live master announces one (or answers our request), getScaledElapsedMs
      // returns null and the window holds. The stored epoch is deliberately NOT
      // trusted on load — it could be stale from a previous master run, and a
      // master reload always mints a new one, so we only ever use an epoch
      // received live this session.
      epochRef.current = null;
      if (channel) {
        channel.onmessage = (event: MessageEvent<ClockMessage>) => {
          const msg = event.data;
          if (msg?.type === "epoch" && Number.isFinite(msg.epoch)) {
            epochRef.current = msg.epoch;
          }
        };
      }
      // Ask the current master for its epoch (covers a follower that loads or
      // reloads after the master is already running).
      channel?.postMessage({ type: "epoch-request" });
    }

    return () => {
      if (channel) {
        channel.onmessage = null;
        channel.close();
      }
    };
  }, [role]);

  const getScaledElapsedMs = useCallback(
    (animationSpeed: number) => {
      if (role === null) return null;
      const epoch = epochRef.current;
      if (epoch === null) return null;
      return (Date.now() - epoch) * animationSpeed;
    },
    [role],
  );

  return { role, isFollower, isInstallation, getScaledElapsedMs };
}
