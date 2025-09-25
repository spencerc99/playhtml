import React, { useEffect, useState } from "react";
import "./ComponentStore.scss";
import { randomizeArray } from "../utils/array";

interface StoreItem {
  id: string;
  src?: string;
  emoji?: string;
  state: boolean;
}

const storeItems: StoreItem[] = [
  // Existing lamps
  {
    id: "akari-1n",
    src: "/lamps/Akari-1N.png",
    state: false,
  },
  {
    id: "akari-1a",
    src: "/lamps/Akari-1A.png",
    state: true,
  },
  {
    id: "akari-1p",
    src: "/lamps/Akari-1P.png",
    state: false,
  },

  // Household appliances (using emojis for concept)
  {
    id: "coffee-maker",
    emoji: "☕",
    state: false,
  },
  {
    id: "toaster",
    emoji: "🍞",
    state: true,
  },
  {
    id: "fan",
    emoji: "🌀",
    state: false,
  },

  // Decorative items
  {
    id: "candle",
    emoji: "🕯️",
    state: true,
  },
  {
    id: "plant",
    emoji: "🪴",
    state: false,
  },
  {
    id: "clock",
    emoji: "⏰",
    state: true,
  },
  {
    id: "chair",
    emoji: "🪑",
    state: false,
  },
  {
    id: "sofa",
    emoji: "🛋️",
    state: true,
  },
  {
    id: "controller",
    emoji: "🎛️",
    state: false,
  },
  {
    id: "monitor",
    emoji: "📟",
    state: true,
  },
  {
    id: "box",
    emoji: "📦",
    state: false,
  },
  {
    id: "scissors",
    emoji: "✂️",
    state: true,
  },
  {
    id: "boomerang",
    emoji: "🪃",
    state: false,
  },
  {
    id: "clamp",
    emoji: "🗜️",
    state: true,
  },
  {
    id: "ladder",
    emoji: "🪜",
    state: false,
  },
  {
    id: "binoculars",
    emoji: "🔭",
    state: true,
  },
  {
    id: "toilet",
    emoji: "🚽",
    state: false,
  },
  {
    id: "fire extinguisher",
    emoji: "🧯",
    state: true,
  },
  {
    id: "broom",
    emoji: "🧹",
    state: false,
  },
  {
    id: "screwdriver",
    emoji: "🪤",
    state: true,
  },
];

export function ComponentStore() {
  const [items, setItems] = useState(randomizeArray(storeItems));

  // Auto-toggle random items to simulate activity
  useEffect(() => {
    const interval = setInterval(() => {
      setItems((prev) => {
        const newItems = [...prev];
        const randomIndex = Math.floor(Math.random() * newItems.length);
        newItems[randomIndex] = {
          ...newItems[randomIndex],
          state:
            Math.random() > 0.7
              ? !newItems[randomIndex].state
              : newItems[randomIndex].state,
        };
        return newItems;
      });
    }, 500);

    return () => clearInterval(interval);
  }, []);

  const handleItemClick = (id: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, state: !item.state } : item
      )
    );
  };

  return (
    <div className="component-store">
      <div className="items-grid">
        {items.map((item, idx) => (
          <div
            key={`${item.id}-${idx}`}
            className={`store-item ${item.state ? "active" : "inactive"}`}
            onClick={() => handleItemClick(item.id)}
          >
            <div className="item-visual">
              {item.src ? (
                <img
                  src={item.src}
                  alt={item.id}
                  className={`item-image ${item.state ? "on" : "off"}`}
                />
              ) : (
                <div className={`item-emoji ${item.state ? "active" : ""}`}>
                  {item.emoji}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
