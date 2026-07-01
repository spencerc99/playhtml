// ABOUTME: Ambient pill showing how many unique people (deduped by playerIdentity)
// ABOUTME: are present in a non-cursor presence room across all of their open tabs.

import React, { useEffect, useState } from "react";
import { usePresenceRoom } from "@playhtml/react";
import type { PresenceView } from "playhtml";

interface Props {
  roomName?: string;
  label?: string;
}

interface Stats {
  uniquePeople: number;
  totalTabs: number;
  swatches: string[];
}

function computeStats(presences: Map<string, PresenceView>): Stats {
  const byPublicKey = new Map<string, { tabs: number; color: string }>();
  let totalTabs = 0;

  for (const view of presences.values()) {
    totalTabs++;
    const pk = view.playerIdentity?.publicKey;
    if (!pk) continue;
    const existing = byPublicKey.get(pk);
    if (existing) {
      existing.tabs++;
    } else {
      const color = view.playerIdentity?.playerStyle?.colorPalette?.[0] ?? "#888";
      byPublicKey.set(pk, { tabs: 1, color });
    }
  }

  return {
    uniquePeople: byPublicKey.size,
    totalTabs,
    swatches: Array.from(byPublicKey.values()).map((v) => v.color),
  };
}

export const UniquePeoplePill: React.FC<Props> = ({
  roomName = "unique-people-demo",
  label = "people here",
}) => {
  const room = usePresenceRoom(roomName);
  const [stats, setStats] = useState<Stats>({
    uniquePeople: 0,
    totalTabs: 0,
    swatches: [],
  });

  useEffect(() => {
    if (!room) return;
    // Each tab announces itself with a tab-id payload so the room actually has
    // a presence channel populated. The dedupe relies entirely on playerIdentity.
    const tabId = Math.random().toString(36).slice(2, 10);
    room.presence.setMyPresence("tab", { tabId, openedAt: Date.now() });

    const update = () => setStats(computeStats(room.presence.getPresences()));
    update();
    const unsub = room.presence.onPresenceChange("tab", update);
    return unsub;
  }, [room]);

  const ready = room !== null;
  const dedupedTabs = stats.totalTabs - stats.uniquePeople;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        borderRadius: 999,
        background: "#f5f0e8",
        border: "1px solid #d8d0c4",
        color: "#3d3833",
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
      }}
    >
      <span style={{ display: "inline-flex", gap: 4 }}>
        {stats.swatches.length === 0 ? (
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#c4c0b8",
            }}
          />
        ) : (
          stats.swatches.map((color, i) => (
            <span
              key={i}
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: color,
                border: "1px solid rgba(0,0,0,0.1)",
              }}
            />
          ))
        )}
      </span>
      <span>
        <strong>{stats.uniquePeople}</strong> {label}
      </span>
      <span style={{ color: "#8a8279", fontSize: 12 }}>
        {ready
          ? `${stats.totalTabs} tab${stats.totalTabs === 1 ? "" : "s"}${
              dedupedTabs > 0 ? ` · ${dedupedTabs} deduped` : ""
            }`
          : "connecting…"}
      </span>
    </div>
  );
};
