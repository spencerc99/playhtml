// ABOUTME: Lists collected satchel items with previews, per-item removal, and a clear-all action.
// ABOUTME: Shown from the Bag settings section of the extension Settings page.

import React from "react";
import { GameInventory, InventoryItem } from "../types";

interface InventoryProps {
  inventory: GameInventory;
  onBack: () => void;
  onRemoveItem: (itemId: string) => void;
  onClearInventory: () => void;
}

const PREVIEW_IMAGE_STYLE: React.CSSProperties = {
  maxWidth: "90px",
  maxHeight: "50px",
  objectFit: "contain",
};

const FALLBACK_SITE_ICON = `data:image/svg+xml;base64,${btoa(
  [
    '<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">',
    '<rect width="32" height="32" fill="#4a9a8a" rx="4"/>',
    '<circle cx="16" cy="16" r="8" fill="none" stroke="white" stroke-width="1.5"/>',
    '<ellipse cx="16" cy="16" rx="4" ry="8" fill="none" stroke="white" stroke-width="1.5"/>',
    '<line x1="8" y1="16" x2="24" y2="16" stroke="white" stroke-width="1.5"/>',
    "</svg>",
  ].join(""),
)}`;

/** Image sources collected from pages: only web images and inline raster/SVG data. */
export function getSafeImageSrc(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/^data:image\//i.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** Colors collected from pages: hex, rgb/hsl functions with plain numbers, or a color keyword. */
export function getSafeColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const color = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^(rgb|rgba|hsl|hsla)\([0-9.,%\s/-]+\)$/i.test(color)) return color;
  if (/^[a-z]+$/i.test(color)) return color;
  return null;
}

function getSiteFavicon(item: InventoryItem): string {
  const favicon = getSafeImageSrc(item.data?.favicon);
  if (favicon) return favicon;
  try {
    return `${new URL(item.sourceUrl).origin}/favicon.ico`;
  } catch {
    return FALLBACK_SITE_ICON;
  }
}

function ImagePreview({ src, label }: { src: string; label?: string }) {
  const [failed, setFailed] = React.useState(false);
  if (failed) {
    return label ? (
      <div style={{ fontSize: "10px", color: "#6b7280", textAlign: "center" }}>
        {label}
      </div>
    ) : null;
  }
  return (
    <img src={src} style={PREVIEW_IMAGE_STYLE} onError={() => setFailed(true)} />
  );
}

function ElementPreview({ item }: { item: InventoryItem }) {
  const snapshot = item.data?.snapshot;

  // Legacy items stored the snapshot as an image source string.
  if (typeof snapshot === "string") {
    const src = getSafeImageSrc(snapshot);
    return src ? <ImagePreview src={src} /> : null;
  }

  if (snapshot && typeof snapshot === "object") {
    const metadata = snapshot.metadata ?? {};
    const tagName =
      typeof metadata.tagName === "string" ? metadata.tagName : undefined;

    if (metadata.hasImage) {
      const src = getSafeImageSrc(metadata.imageUrl);
      if (src) return <ImagePreview src={src} label={tagName} />;
    }

    const textContent =
      typeof metadata.textContent === "string"
        ? metadata.textContent.slice(0, 30)
        : "";
    const text = textContent || tagName || "element";

    return (
      <div
        style={{
          width: "90px",
          height: "50px",
          background: getSafeColor(snapshot.styles?.backgroundColor) ?? "#f9fafb",
          color: getSafeColor(snapshot.styles?.color) ?? "#1f2937",
          fontSize: "9px",
          padding: "4px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          overflow: "hidden",
          wordBreak: "break-word",
        }}
      >
        {text}
      </div>
    );
  }

  // Items without snapshot data show their type.
  return (
    <div
      style={{
        width: "90px",
        height: "50px",
        background: "#f9fafb",
        color: "#6b7280",
        fontSize: "9px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
      }}
    >
      {item.type}
    </div>
  );
}

// TODO: for inventory:
// TODO: move X to top right and probably hidden behind triple dot menu
// TODO: add filters / search / domain filter? Highlight ones from this domain?
// TODO: easy way to drag item
// TODO: add item detail view?
export function Inventory({
  inventory,
  onBack,
  onRemoveItem,
  onClearInventory,
}: InventoryProps) {
  const getItemTypeColor = (type: InventoryItem["type"]) => {
    switch (type) {
      case "element":
        return "#6366f1";
      case "site_signature":
        return "#10b981";
      case "interaction":
        return "#f59e0b";
      default:
        return "#6b7280";
    }
  };

  return (
    <div
      style={{
        padding: "16px",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header style={{ marginBottom: "16px" }}>
        <button
          onClick={onBack}
          style={{
            display: "block",
            background: "none",
            border: "none",
            fontSize: "12px",
            color: "#6b7280",
            cursor: "pointer",
            padding: 0,
            marginBottom: "8px",
          }}
        >
          ← back
        </button>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "18px", color: "#1f2937" }}>
            Inventory ({inventory.totalItems})
          </h1>

          {inventory.items.length > 0 && (
            <button
              onClick={onClearInventory}
              style={{
                background: "#ef4444",
                color: "white",
                border: "none",
                borderRadius: "4px",
                fontSize: "10px",
                padding: "4px 6px",
                cursor: "pointer",
              }}
              title="Clear all items"
            >
              Clear All
            </button>
          )}
        </div>
      </header>

      <main style={{ flex: 1, overflow: "auto" }}>
        {inventory.items.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "40px 20px",
              color: "#6b7280",
              fontSize: "14px",
            }}
          >
            <div style={{ marginBottom: "8px" }}>Your bag is empty</div>
            <div>Start exploring to collect items!</div>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "8px",
            }}
          >
            {inventory.items.map((item) => (
              <div
                key={item.id}
                style={{
                  background: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  padding: "8px",
                  fontSize: "11px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  textAlign: "center",
                  minHeight: "140px",
                }}
              >
                <div
                  style={{
                    marginBottom: "8px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "100%",
                    height: "60px",
                  }}
                >
                  {item.type === "site_signature" ? (
                    <img
                      src={getSiteFavicon(item)}
                      alt="Site favicon"
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "4px",
                        objectFit: "cover",
                      }}
                      onError={(e) => {
                        const image = e.target as HTMLImageElement;
                        if (image.src !== FALLBACK_SITE_ICON) {
                          image.src = FALLBACK_SITE_ICON;
                        }
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        maxWidth: "100px",
                        maxHeight: "60px",
                        borderRadius: "4px",
                        border: "1px solid #e5e7eb",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <ElementPreview item={item} />
                    </div>
                  )}
                </div>

                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    width: "100%",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontWeight: "bold",
                        fontSize: "12px",
                        color: "#1f2937",
                        marginBottom: "2px",
                        lineHeight: "1.2",
                      }}
                    >
                      {item.name.length > 25
                        ? item.name.slice(0, 25) + "..."
                        : item.name}
                    </div>
                    <div
                      style={{
                        color: "#6b7280",
                        fontSize: "10px",
                        marginBottom: "6px",
                        lineHeight: "1.2",
                      }}
                    >
                      {item.description.length > 40
                        ? item.description.slice(0, 40) + "..."
                        : item.description}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-end",
                      marginTop: "4px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      <span
                        style={{
                          background: getItemTypeColor(item.type),
                          color: "white",
                          padding: "1px 4px",
                          borderRadius: "3px",
                          fontSize: "9px",
                          fontWeight: "500",
                        }}
                      >
                        {item.type === "site_signature" ? "site" : "item"}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveItem(item.id);
                        }}
                        style={{
                          background: "#ef4444",
                          color: "white",
                          border: "none",
                          borderRadius: "2px",
                          fontSize: "8px",
                          padding: "1px 3px",
                          cursor: "pointer",
                          lineHeight: "1",
                        }}
                        title="Remove item"
                      >
                        ×
                      </button>
                    </div>
                    <span style={{ color: "#9ca3af", fontSize: "9px" }}>
                      {new Date(item.collectedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <footer
        style={{
          marginTop: "16px",
          paddingTop: "16px",
          borderTop: "1px solid #e5e7eb",
          fontSize: "10px",
          color: "#9ca3af",
          textAlign: "center",
        }}
      >
        {inventory.items.length > 0 &&
          `Last updated ${new Date(
            inventory.lastUpdated
          ).toLocaleDateString()}`}
      </footer>
    </div>
  );
}
