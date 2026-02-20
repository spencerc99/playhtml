import { PlayerIdentity } from "@playhtml/common";
export interface InventoryItem {
  id: string;
  type: "element" | "site_signature" | "interaction";
  name: string;
  description: string;
  collectedAt: number;
  sourceUrl: string;
  data?: any;
}

export interface GameInventory {
  items: InventoryItem[];
  totalItems: number;
  lastUpdated: number;
}

export interface PlayHTMLStatus {
  detected: boolean;
  elementCount: number;
  checking: boolean;
}

export type { PlayerIdentity };
