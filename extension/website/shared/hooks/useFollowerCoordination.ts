// ABOUTME: Coordinates which cursor each follower window rides, over a same-origin BroadcastChannel.
// ABOUTME: Owns the claims map + pruning + heartbeat + race resolution; exposes a stable pickSubject.

import { useCallback, useEffect, useRef } from "react";
import { parseInstallationRoleFromUrl, parseFollowerIdFromUrl } from "../config";

/** Same-origin channel every follower window joins to publish/read cursor
 * claims. Separate from the clock channel so claim traffic and time traffic
 * don't interleave; all followers on one machine share it. */
const CHANNEL_NAME = "wewe-installation-claims";

/** A claim goes stale this long after its last heartbeat. A crashed/closed
 * follower's claim then frees up so others can pick that cursor again. Must be
 * comfortably larger than HEARTBEAT_MS so a live claim never lapses between
 * beats. */
const STALE_MS = 2500;

/** How often a follower re-broadcasts a claim for the cursor it currently
 * rides, so peers keep its entry fresh. */
const HEARTBEAT_MS = 1000;

/** One entry per claimed cursor: who claims it and when we last heard. */
interface ClaimEntry {
  by: string;
  ts: number;
}

interface ClaimMessage {
  type: "claim" | "release";
  cursor: number;
  by: string;
  ts?: number;
}

type Candidate = { index: number; x: number; y: number; progress: number };

/** The selector signature the cinematic camera calls in follow mode. */
export type PickSubject = (
  candidates: Candidate[],
  currentIndex: number | null,
) => number | null;

export interface FollowerCoordination {
  /** True when this window is a follower participating in coordination. */
  isFollower: boolean;
  /** A STABLE (identity-preserving) selector to hand the cinematic camera. When
   * this window is a follower it filters out cursors claimed by OTHER followers
   * and picks randomly among the rest; otherwise it just picks lowest-progress.
   * Never changes identity across renders, so injecting it into the cinematic
   * config doesn't thrash the camera's setConfig. */
  pickSubject: PickSubject;
}

/** Lowest-progress pick — prefer a trail early in its draw so the camera rides
 * most of it. Matches the camera's built-in default; used when this window
 * isn't coordinating. */
function pickLowestProgress(
  candidates: Candidate[],
  currentIndex: number | null,
): number | null {
  let best: number | null = null;
  let bestProgress = Infinity;
  for (const c of candidates) {
    if (c.index === currentIndex) continue;
    if (c.progress < bestProgress) {
      bestProgress = c.progress;
      best = c.index;
    }
  }
  if (best === null && candidates.length > 0) best = candidates[0].index;
  return best;
}

/** Wires the claims BroadcastChannel keyed off `?role=follower`. Inert for any
 * other window: `pickSubject` just does lowest-progress and no channel opens, so
 * the archive/portrait pages and a single-window auto-pick are unaffected. */
export function useFollowerCoordination(): FollowerCoordination {
  const roleRef = useRef(parseInstallationRoleFromUrl());
  const isFollower = roleRef.current === "follower";

  // Stable window id: the URL-set follower id, or a random one generated once
  // so an id-less follower still participates (and two id-less windows diverge).
  const idRef = useRef<string>(
    parseFollowerIdFromUrl() ??
      `f-${Math.random().toString(36).slice(2, 8)}`,
  );

  const channelRef = useRef<BroadcastChannel | null>(null);
  // Everyone's current claims (including our own), last-seen timestamp.
  const claimsRef = useRef<Map<number, ClaimEntry>>(new Map());
  // The cursor index this window currently rides (null = none yet).
  const myClaimRef = useRef<number | null>(null);

  const now = () =>
    typeof performance !== "undefined" ? performance.now() : Date.now();

  const broadcastClaim = useCallback((cursor: number) => {
    const message: ClaimMessage = {
      type: "claim",
      cursor,
      by: idRef.current,
      ts: now(),
    };
    channelRef.current?.postMessage(message);
    // Reflect our own claim locally too, so a fresh window's pickSubject sees it
    // without waiting for the message to round-trip.
    claimsRef.current.set(cursor, { by: idRef.current, ts: message.ts! });
  }, []);

  useEffect(() => {
    if (!isFollower) return;
    if (typeof BroadcastChannel === "undefined") return;

    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;

    channel.onmessage = (event: MessageEvent<ClaimMessage>) => {
      const msg = event.data;
      if (!msg || typeof msg.cursor !== "number" || typeof msg.by !== "string") {
        return;
      }
      if (msg.by === idRef.current) return; // ignore our own echoes

      if (msg.type === "release") {
        const entry = claimsRef.current.get(msg.cursor);
        if (entry && entry.by === msg.by) claimsRef.current.delete(msg.cursor);
        return;
      }

      // type === "claim": record the peer's claim.
      claimsRef.current.set(msg.cursor, {
        by: msg.by,
        ts: typeof msg.ts === "number" ? msg.ts : now(),
      });

      // Race resolution: if a peer claims the cursor WE currently ride, the
      // lower id keeps it (string compare). If the peer's id is lower, we yield
      // — drop our claim so pickSubject re-picks a fresh cursor next call.
      if (
        myClaimRef.current === msg.cursor &&
        msg.by < idRef.current
      ) {
        myClaimRef.current = null;
      }
    };

    // Heartbeat: keep our current claim fresh for peers, and prune stale claims
    // from windows that went away.
    const heartbeat = window.setInterval(() => {
      const t = now();
      for (const [cursor, entry] of claimsRef.current) {
        if (t - entry.ts > STALE_MS) claimsRef.current.delete(cursor);
      }
      if (myClaimRef.current !== null) broadcastClaim(myClaimRef.current);
    }, HEARTBEAT_MS);

    return () => {
      window.clearInterval(heartbeat);
      if (myClaimRef.current !== null) {
        const release: ClaimMessage = {
          type: "release",
          cursor: myClaimRef.current,
          by: idRef.current,
        };
        channel.postMessage(release);
      }
      channel.onmessage = null;
      channel.close();
      channelRef.current = null;
      claimsRef.current.clear();
      myClaimRef.current = null;
    };
  }, [isFollower, broadcastClaim]);

  // STABLE selector handed to the camera. Reads refs so its identity never
  // changes — the camera reads config.pickSubject fresh each tick, so live
  // claims are always current without re-running setConfig.
  const pickSubject = useCallback<PickSubject>(
    (candidates, currentIndex) => {
      if (!isFollower) return pickLowestProgress(candidates, currentIndex);
      if (candidates.length === 0) return null;

      const t = now();
      const me = idRef.current;
      const claimedByOther = (index: number): boolean => {
        const entry = claimsRef.current.get(index);
        if (!entry) return false;
        if (entry.by === me) return false;
        if (t - entry.ts > STALE_MS) return false; // stale claims don't block
        return true;
      };

      // Keep the current subject if it's still an active candidate and not
      // claimed by another follower — don't hop unnecessarily.
      if (
        currentIndex !== null &&
        candidates.some((c) => c.index === currentIndex) &&
        !claimedByOther(currentIndex)
      ) {
        // Make sure our claim is recorded (e.g. after yielding then re-keeping).
        if (myClaimRef.current !== currentIndex) {
          myClaimRef.current = currentIndex;
          broadcastClaim(currentIndex);
        }
        return currentIndex;
      }

      // Prefer cursors no other follower claims; fall back to all candidates so
      // more-followers-than-cursors allows a temporary duplicate over freezing.
      const free = candidates.filter((c) => !claimedByOther(c.index));
      const pool = free.length > 0 ? free : candidates;
      const chosen = pool[Math.floor(Math.random() * pool.length)].index;

      myClaimRef.current = chosen;
      broadcastClaim(chosen);
      return chosen;
    },
    [isFollower, broadcastClaim],
  );

  return { isFollower, pickSubject };
}
