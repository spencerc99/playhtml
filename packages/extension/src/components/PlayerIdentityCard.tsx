import React from "react";
import { PlayerIdentity } from "../types";

interface PlayerIdentityCardProps {
  playerIdentity: PlayerIdentity;
}

export function PlayerIdentityCard({ playerIdentity }: PlayerIdentityCardProps) {
  return (
    <section style={{ marginBottom: "16px" }}>
      <h3
        style={{
          margin: "0 0 8px 0",
          fontSize: "14px",
          color: "#374151",
        }}
      >
        Your Identity
      </h3>
      <div
        style={{
          background: "#f9fafb",
          padding: "8px",
          borderRadius: "6px",
          fontSize: "12px",
        }}
      >
        <div style={{ marginBottom: "4px" }}>
          <strong>ID:</strong> {playerIdentity.publicKey.slice(0, 12)}...
        </div>
        <div style={{ marginBottom: "4px" }}>
          <strong>Sites discovered:</strong>{" "}
          {playerIdentity.discoveredSites.length}
        </div>
        <div
          style={{ display: "flex", gap: "4px", alignItems: "center" }}
        >
          <strong>Colors:</strong>
          {playerIdentity.playerStyle.colorPalette.map((color, i) => (
            <div
              key={i}
              style={{
                width: "12px",
                height: "12px",
                backgroundColor: color,
                borderRadius: "2px",
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}