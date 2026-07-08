// ABOUTME: Shared wall-clock epoch for multi-screen installations, over localStorage + BroadcastChannel.
// ABOUTME: Every window computes its own scaled-elapsed from an agreed epoch, so no window depends on another's rAF.

import { useCallback, useEffect, useRef } from "react";
import { parseInstallationRoleFromUrl } from "../config";

/** Same-origin channel every installation window joins to announce/adopt the
 * shared epoch. */
const CHANNEL_NAME = "wewe-installation-clock";

/** localStorage key holding the shared epoch (ms since Unix epoch). Survives
 * reload and is shared across same-origin windows. */
const EPOCH_STORAGE_KEY = "wewe-installation-epoch";

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
   * falls back to local accumulation while null (before an epoch is adopted,
   * or for standalone windows). Read through this accessor each frame so
   * incoming messages don't re-run the animation-loop effect. */
  getScaledElapsedMs: (animationSpeed: number) => number | null;
}

function readStoredEpoch(): number | null {
  try {
    const raw = localStorage.getItem(EPOCH_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredEpoch(epoch: number): void {
  try {
    localStorage.setItem(EPOCH_STORAGE_KEY, String(epoch));
  } catch {
    /* localStorage may be unavailable (private mode); the in-memory ref still
     * holds the epoch for this window's own frames. */
  }
}

/** Wires a shared wall-clock epoch keyed off `?role=`. Any installation window
 * (master OR follower) establishes an epoch if none exists and adopts the
 * earliest epoch it sees (earliest-wins converges all windows). Inert when no
 * role is present: `getScaledElapsedMs` returns null so a standalone window
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

    // On load, adopt any epoch already persisted for this origin.
    epochRef.current = readStoredEpoch();

    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(CHANNEL_NAME)
        : null;

    /** Adopt `epoch` when it's earlier than ours (or we have none). Earliest
     * wins so two windows that establish simultaneously converge to one. */
    const adopt = (epoch: number) => {
      if (!Number.isFinite(epoch)) return;
      if (epochRef.current === null || epoch < epochRef.current) {
        epochRef.current = epoch;
        writeStoredEpoch(epoch);
      }
    };

    if (channel) {
      channel.onmessage = (event: MessageEvent<ClockMessage>) => {
        const msg = event.data;
        if (!msg) return;
        if (msg.type === "epoch") {
          const before = epochRef.current;
          adopt(msg.epoch);
          // If our (earlier) epoch won, re-announce it so the sender adopts it.
          if (before !== null && before < msg.epoch) {
            channel.postMessage({ type: "epoch", epoch: before });
          }
        } else if (msg.type === "epoch-request") {
          if (epochRef.current !== null) {
            channel.postMessage({ type: "epoch", epoch: epochRef.current });
          }
        }
      };
    }

    if (epochRef.current === null) {
      // No epoch anywhere we know of yet: establish one and announce it.
      const epoch = Date.now();
      epochRef.current = epoch;
      writeStoredEpoch(epoch);
      channel?.postMessage({ type: "epoch", epoch });
    } else {
      // We have a stored epoch: announce it so any other window converges down.
      channel?.postMessage({ type: "epoch", epoch: epochRef.current });
    }

    // Ask anyone already running to reply with their epoch, covering the case
    // where our localStorage was cleared but a peer window is live.
    channel?.postMessage({ type: "epoch-request" });

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
