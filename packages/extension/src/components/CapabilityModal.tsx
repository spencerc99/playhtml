import React from "react";

interface Capability {
  name: string;
  description: string;
}

interface CapabilityModalProps {
  element: HTMLElement;
  elementHasPlayHTML: boolean;
  onCollect: () => void;
  onApplyCapability: (capability: string) => void;
  onCancel: () => void;
}

const CAPABILITIES: Capability[] = [
  { name: "can-move", description: "Make element draggable" },
  { name: "can-spin", description: "Make element rotatable" },
  { name: "can-toggle", description: "Add toggle on/off state" },
  { name: "can-grow", description: "Make element scalable" },
  { name: "can-duplicate", description: "Allow element cloning" },
];

export const CapabilityModal: React.FC<CapabilityModalProps> = ({
  element,
  elementHasPlayHTML,
  onCollect,
  onApplyCapability,
  onCancel,
}) => {
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onCancel}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          background: "rgba(0, 0, 0, 0.5)",
          zIndex: 1000000,
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "white",
          border: "1px solid #d1d5db",
          borderRadius: "8px",
          padding: "24px",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
          zIndex: 1000001,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          maxWidth: "400px",
        }}
      >
        <h3
          style={{
            margin: "0 0 16px 0",
            fontSize: "18px",
            color: "#1f2937",
          }}
        >
          Element Actions
        </h3>
        
        <p
          style={{
            margin: "0 0 16px 0",
            fontSize: "14px",
            color: "#6b7280",
          }}
        >
          Choose what to do with this element:
        </p>

        {/* Collect Element Section */}
        <div
          style={{
            marginBottom: elementHasPlayHTML ? "0" : "16px",
            padding: "12px",
            background: "#fef3c7",
            border: "1px solid #fbbf24",
            borderRadius: "6px",
          }}
        >
          <button
            onClick={onCollect}
            style={{
              width: "100%",
              padding: "12px",
              border: "2px solid #f59e0b",
              borderRadius: "6px",
              background: "#fbbf24",
              color: "white",
              cursor: "pointer",
              textAlign: "center",
              fontWeight: "bold",
              transition: "background-color 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#f59e0b";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "#fbbf24";
            }}
          >
            🎒 Collect Element
          </button>
          <p
            style={{
              margin: "8px 0 0 0",
              fontSize: "11px",
              color: "#92400e",
              textAlign: "center",
            }}
          >
            Add this element to your inventory
          </p>
        </div>

        {/* PlayHTML Capabilities Section - Only show if element doesn't have PlayHTML */}
        {!elementHasPlayHTML && (
          <div
            style={{
              borderTop: "1px solid #e5e7eb",
              paddingTop: "16px",
            }}
          >
            <h4
              style={{
                margin: "0 0 8px 0",
                fontSize: "14px",
                color: "#374151",
              }}
            >
              Or add PlayHTML capability:
            </h4>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              {CAPABILITIES.map((cap) => (
                <button
                  key={cap.name}
                  onClick={() => onApplyCapability(cap.name)}
                  style={{
                    padding: "12px",
                    border: "1px solid #d1d5db",
                    borderRadius: "6px",
                    background: "white",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background-color 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#f9fafb";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "white";
                  }}
                >
                  <strong>{cap.name}</strong>
                  <br />
                  <span style={{ fontSize: "12px", color: "#6b7280" }}>
                    {cap.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: "16px", display: "flex", gap: "8px" }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "8px 16px",
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              background: "white",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
};