// ABOUTME: Renders quick action buttons for testing connection, picking elements, and navigation
// ABOUTME: Used in the main popup home view for primary user interactions
import React from "react";
import { GameInventory } from "../types";
import "./QuickActions.scss";

interface QuickActionsProps {
  onTestConnection: () => void;
  onPickElement: () => void;
  onViewInventory: () => void;
  onViewCollections: () => void;
  onViewHistory: () => void;
  inventory: GameInventory;
  showBagFeatures?: boolean;
}

export function QuickActions({
  onTestConnection,
  onPickElement,
  onViewInventory,
  onViewCollections,
  onViewHistory,
  inventory,
  showBagFeatures = true,
}: QuickActionsProps) {
  return (
    <section className="quick-actions">
      <h3 className="quick-actions__heading">Quick Actions</h3>
      <div className="quick-actions__list">
        <button onClick={onTestConnection} className="btn-test-connection">
          Test Connection
        </button>
        {showBagFeatures && (
          <>
            <button className="btn-pick-element" onClick={onPickElement}>
              Pick Element
            </button>
            <button onClick={onViewInventory} className="btn-inventory">
              View Inventory ({inventory.totalItems})
            </button>
          </>
        )}
        <button onClick={onViewCollections} className="btn-collections">
          Collections
        </button>
        <button onClick={onViewHistory} className="btn-history">
          View Page History
        </button>
      </div>
    </section>
  );
}
