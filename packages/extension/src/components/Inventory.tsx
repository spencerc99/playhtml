import React from "react";
import { GameInventory, InventoryItem } from "../types";

interface InventoryProps {
  inventory: GameInventory;
  onBack: () => void;
  onRemoveItem: (itemId: string) => void;
  onClearInventory: () => void;
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
  const generateElementPreview = (item: InventoryItem): string => {
    // Handle legacy items that might have old snapshot format
    if (typeof item.data?.snapshot === "string") {
      return `<img src="${item.data.snapshot}" style="max-width: 90px; max-height: 50px; object-fit: contain;" />`;
    }

    // Handle new snapshot format
    if (item.data?.snapshot && typeof item.data.snapshot === "object") {
      const snapshot = item.data.snapshot;

      // For images, show the actual image
      if (snapshot.metadata?.hasImage && snapshot.metadata?.imageUrl) {
        return `
          <img src="${snapshot.metadata.imageUrl}" 
               style="max-width: 90px; max-height: 50px; object-fit: contain;" 
               onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
          <div style="display: none; font-size: 10px; color: #6b7280; text-align: center;">
            📷 ${snapshot.metadata.tagName}
          </div>
        `;
      }

      // For other elements, create a styled preview
      const text =
        snapshot.metadata?.textContent?.slice(0, 30) ||
        snapshot.metadata?.tagName ||
        "element";
      const bgColor = snapshot.styles?.backgroundColor || "#f9fafb";
      const textColor = snapshot.styles?.color || "#1f2937";

      return `
        <div style="
          width: 90px; 
          height: 50px; 
          background: ${bgColor};
          color: ${textColor};
          font-size: 9px;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          overflow: hidden;
          word-break: break-word;
        ">
          ${text}
        </div>
      `;
    }

    // Fallback for items without proper snapshot data
    return `
      <div style="
        width: 90px; 
        height: 50px; 
        background: #f9fafb;
        color: #6b7280;
        font-size: 9px;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
      ">
        📦 ${item.type}
      </div>
    `;
  };

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
      <header
        style={{
          marginBottom: "16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={onBack}
            style={{
              background: "none",
              border: "none",
              fontSize: "18px",
              cursor: "pointer",
              padding: "4px",
            }}
          >
            ←
          </button>
          <h1 style={{ margin: 0, fontSize: "18px", color: "#1f2937" }}>
            Inventory ({inventory.totalItems})
          </h1>
        </div>

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
                      src={
                        item.data?.favicon ||
                        `${new URL(item.sourceUrl).origin}/favicon.ico`
                      }
                      alt="Site favicon"
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "4px",
                        objectFit: "cover",
                      }}
                      onError={(e) => {
                        // Fallback to generic site icon SVG
                        (
                          e.target as HTMLImageElement
                        ).src = `data:image/svg+xml;base64,${btoa(`
                          <svg width="32" height="32" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
                            <rect width="32" height="32" fill="#10b981" rx="4"/>
                            <text x="16" y="20" font-family="Arial" font-size="12" fill="white" text-anchor="middle">🌐</text>
                          </svg>
                        `)}`;
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
                      dangerouslySetInnerHTML={{
                        __html: generateElementPreview(item),
                      }}
                    />
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
