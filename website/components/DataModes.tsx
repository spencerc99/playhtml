// ABOUTME: Shows live homepage presence beside the persistent visit counter.
// ABOUTME: Publishes recent activity through one element-awareness channel.

import { useEffect, useRef, useState } from "react";
import { usePlayContext, withSharedState } from "@playhtml/react";
import { ViewCount } from "../../packages/react/examples/ViewCount";
import { formatLargeNumber } from "../../packages/react/examples/utils";
import {
  getRecentHomepagePresences,
  HomepagePresenceAwareness,
} from "../utils/homepagePresence";
import "./DataModes.scss";

const ACTIVITY_BROADCAST_INTERVAL_MS = 30_000;
const PRESENCE_REFRESH_INTERVAL_MS = 30_000;
const FALLBACK_PRESENCE_COLOR = "#ff6b35";

type HomepagePresenceProps = {
  color: string;
  playerId: string;
};

const HomepagePresence = withSharedState<
  Record<string, never>,
  HomepagePresenceAwareness,
  HomepagePresenceProps
>(
  ({ color, playerId }) => ({
    defaultData: {},
    id: "homepage-presence",
    myDefaultAwareness: {
      color: color || FALLBACK_PRESENCE_COLOR,
      lastActiveAt: Date.now(),
      playerId,
    },
  }),
  (
    { awareness, myAwareness, ref, setMyAwareness },
    { color, playerId },
  ) => {
    const [now, setNow] = useState(Date.now);
    const myAwarenessRef = useRef(myAwareness);
    const setMyAwarenessRef = useRef(setMyAwareness);
    myAwarenessRef.current = myAwareness;
    setMyAwarenessRef.current = setMyAwareness;

    useEffect(() => {
      const publishActivity = () => {
        const activityAt = Date.now();
        const previous = myAwarenessRef.current;
        const nextColor = color || previous?.color || FALLBACK_PRESENCE_COLOR;
        if (
          previous?.color === nextColor &&
          activityAt - previous.lastActiveAt < ACTIVITY_BROADCAST_INTERVAL_MS
        ) {
          return;
        }

        const nextAwareness = {
          color: nextColor,
          lastActiveAt: activityAt,
          playerId,
        };
        myAwarenessRef.current = nextAwareness;
        setMyAwarenessRef.current(nextAwareness);
        setNow(activityAt);
      };
      const publishVisibleActivity = () => {
        if (document.visibilityState === "visible") publishActivity();
      };

      publishActivity();
      window.addEventListener("focus", publishActivity);
      window.addEventListener("keydown", publishActivity);
      window.addEventListener("pointerdown", publishActivity);
      window.addEventListener("pointermove", publishActivity);
      window.addEventListener("scroll", publishActivity, { passive: true });
      document.addEventListener("visibilitychange", publishVisibleActivity);

      return () => {
        window.removeEventListener("focus", publishActivity);
        window.removeEventListener("keydown", publishActivity);
        window.removeEventListener("pointerdown", publishActivity);
        window.removeEventListener("pointermove", publishActivity);
        window.removeEventListener("scroll", publishActivity);
        document.removeEventListener("visibilitychange", publishVisibleActivity);
      };
    }, [color, playerId]);

    useEffect(() => {
      const refreshInterval = window.setInterval(
        () => setNow(Date.now()),
        PRESENCE_REFRESH_INTERVAL_MS,
      );
      return () => window.clearInterval(refreshInterval);
    }, []);

    const recentPresences = getRecentHomepagePresences(
      awareness,
      now,
    );
    const peopleCount = Math.max(recentPresences.length, 1);
    const displayedPresences =
      recentPresences.length > 0
        ? recentPresences
        : [
            myAwareness ?? {
              color: color || FALLBACK_PRESENCE_COLOR,
              lastActiveAt: now,
              playerId,
            },
          ];

    useEffect(() => {
      const countElement = document.getElementById("site-console-count-number");
      const countLabel = document.querySelector(".site-console__status-label");
      if (!countElement || !countLabel) return;

      countElement.textContent = String(peopleCount);
      countLabel.textContent = ` ${peopleCount === 1 ? "person" : "people"} here`;
    }, [peopleCount]);

    const maxDotsToShow = 12;
    const visiblePresences = displayedPresences.slice(0, maxDotsToShow);
    const hiddenCount = Math.max(0, peopleCount - maxDotsToShow);

    const formatted = formatLargeNumber(peopleCount);
    const isLargeNumber = typeof formatted === "object";

    return (
      <div
        className="data-mode-demo awareness"
        ref={ref as React.RefObject<HTMLDivElement>}
        title="People active on this page within the last 10 minutes"
      >
        <div className="user-dots">
          {visiblePresences.map((presence, index) => (
            <div
              key={`${presence.color}-${index}`}
              className="user-dot"
              style={{
                backgroundColor: presence.color,
                animationDelay: `${index * 0.1}s`,
              }}
              title={`recent visitor ${index + 1}`}
            />
          ))}
          {hiddenCount > 0 && (
            <div
              className="user-dot-overflow"
              title={`+${hiddenCount} more recent visitors`}
            >
              +{hiddenCount}
            </div>
          )}
        </div>
        <div className="mode-value">
          {isLargeNumber ? (
            <div className="large-number-display">
              <div className="number-main">{formatted.main}</div>
              <div className="number-suffix">{formatted.suffix}</div>
            </div>
          ) : (
            formatted
          )}
        </div>
        <div className="mode-description">here recently</div>
      </div>
    );
  },
);

export function OnlineNowIndicator() {
  const { cursors, getMyPlayerIdentity } = usePlayContext();

  return (
    <HomepagePresence
      color={cursors.color}
      playerId={getMyPlayerIdentity()?.publicKey ?? ""}
    />
  );
}

export function DataModes() {
  return (
    <div className="data-modes-container">
      <OnlineNowIndicator />
      <div className="data-mode-demo persistent">
        <ViewCount />
        <div className="mode-description">total visits</div>
      </div>
    </div>
  );
}
