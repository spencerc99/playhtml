import React, { useEffect, useMemo, useRef, useState } from "react";
import { withSharedState } from "@playhtml/react";

type TimerData = {
  state: "idle" | "running" | "paused";
  startAtMs: number; // wall clock when started
  elapsedMs: number; // accumulated elapsed when paused
  durationMs?: number; // optional countdown target
};

interface SharedTimerProps {
  durationMs?: number; // if provided, acts as a countdown
}

export const SharedTimer = withSharedState<TimerData, any, SharedTimerProps>(
  ({ durationMs }) => ({
    defaultData: {
      state: "idle",
      startAtMs: 0,
      elapsedMs: 0,
      durationMs,
    },
  }),
  ({ data, setData }) => {
    const [now, setNow] = useState(Date.now());
    const rafRef = useRef<number | null>(null);

    const runningElapsed = useMemo(() => {
      if (data.state !== "running") return data.elapsedMs;
      return data.elapsedMs + (now - data.startAtMs);
    }, [data.state, data.elapsedMs, data.startAtMs, now]);

    const remainingMs = data.durationMs
      ? Math.max(0, data.durationMs - runningElapsed)
      : undefined;

    useEffect(() => {
      if (data.state !== "running") return;
      const tick = () => {
        setNow(Date.now());
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      };
    }, [data.state]);

    useEffect(() => {
      if (data.durationMs && remainingMs === 0 && data.state === "running") {
        // auto-stop at end
        setData((draft) => {
          draft.state = "paused";
          draft.elapsedMs = data.durationMs!;
        });
      }
    }, [remainingMs, data, setData]);

    const start = () => {
      if (data.state === "running") return;
      setData((draft) => {
        draft.state = "running";
        draft.startAtMs = Date.now();
      });
    };
    const pause = () => {
      if (data.state !== "running") return;
      const elapsed = runningElapsed;
      setData({ ...data, state: "paused", elapsedMs: elapsed });
    };
    const reset = () => {
      setData({ ...data, state: "idle", elapsedMs: 0, startAtMs: 0 });
    };

    const format = (ms: number) => {
      const s = Math.floor(ms / 1000);
      const mm = Math.floor(s / 60)
        .toString()
        .padStart(2, "0");
      const ss = (s % 60).toString().padStart(2, "0");
      return `${mm}:${ss}`;
    };

    return (
      <div
        id="shared-timer"
        style={{ display: "inline-flex", gap: 8, alignItems: "center" }}
      >
        <div
          style={{
            fontVariantNumeric: "tabular-nums",
            minWidth: 60,
            textAlign: "center",
          }}
        >
          {data.durationMs ? format(remainingMs || 0) : format(runningElapsed)}
        </div>
        <button onClick={start}>Start</button>
        <button onClick={pause}>Pause</button>
        <button onClick={reset}>Reset</button>
      </div>
    );
  }
);
