// ABOUTME: Full-screen overlay rendering a combined MovementCanvas for session PIDs.
// ABOUTME: Admin-triggered; fetches each participant's events by PID and merges them.

import React, { useEffect, useState } from "react";
import { MovementCanvas } from "@movement/components/MovementCanvas";
import type { CollectionEvent } from "@movement/types";
import { fetchPortraitEvents } from "./portraitData";

const PORTRAIT_VIZ = ["trails"];

interface PortraitOverlayProps {
  pids: string[];
  onClose: () => void;
}

export function PortraitOverlay({ pids, onClose }: PortraitOverlayProps) {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = React.useCallback(() => {
    setLoading(true);
    setError(null);
    fetchPortraitEvents(pids, PORTRAIT_VIZ)
      .then((evts) => {
        setEvents(evts);
        if (evts.length === 0) {
          setError("No browsing data found for these participants yet.");
        }
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load portrait"),
      )
      .finally(() => setLoading(false));
  }, [pids]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="portrait-overlay">
      <button className="portrait-close" onClick={onClose} title="Close portrait">
        ×
      </button>
      <MovementCanvas
        events={events}
        loading={loading}
        error={error}
        fetchEvents={load}
        activeVisualizations={PORTRAIT_VIZ}
        onSetActiveVisualizations={() => {}}
      />
    </div>
  );
}
