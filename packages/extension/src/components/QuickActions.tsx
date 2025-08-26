import React from "react";
import { GameInventory } from "../types";

interface QuickActionsProps {
  onTestConnection: () => void;
  onPickElement: () => void;
  onViewInventory: () => void;
  inventory: GameInventory;
}

export function QuickActions({ 
  onTestConnection, 
  onPickElement, 
  onViewInventory, 
  inventory 
}: QuickActionsProps) {
  return (
    <section>
      <h3
        style={{ margin: "0 0 8px 0", fontSize: "14px", color: "#374151" }}
      >
        Quick Actions
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <button
          onClick={onTestConnection}
          style={{
            padding: "8px 12px",
            background: "#6366f1",
            color: "white",
            border: "none",
            borderRadius: "6px",
            fontSize: "12px",
            cursor: "pointer",
          }}
        >
          Test Connection
        </button>
        <button
          style={{
            padding: "8px 12px",
            background: "#e5e7eb",
            color: "#374151",
            border: "none",
            borderRadius: "6px",
            fontSize: "12px",
            cursor: "pointer",
          }}
          onClick={onPickElement}
        >
          Pick Element
        </button>
        <button
          onClick={onViewInventory}
          style={{
            padding: "8px 12px",
            background: "#8b5cf6",
            color: "white",
            border: "none",
            borderRadius: "6px",
            fontSize: "12px",
            cursor: "pointer",
          }}
        >
          View Inventory ({inventory.totalItems})
        </button>
      </div>
    </section>
  );
}